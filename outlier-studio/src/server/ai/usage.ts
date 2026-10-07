import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb, type Tx } from '../db/client';
import { aiRequests } from '../db/schema';
import type { AppError } from '../errors';
import type { Feature } from '../settings';
import { estimateCostUsd, PRICING_AS_OF } from './pricing';

/**
 * Usage recorder. The generation service calls this around every Groq
 * request, so features never write usage rows themselves and a new feature is
 * tracked without extra work.
 */

/** Token counts as reported by Groq. Null means Groq reported none; we never estimate them. */
export type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number };

export function readUsage(u: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined): TokenUsage | null {
  if (!u || typeof u.prompt_tokens !== 'number' || typeof u.completion_tokens !== 'number') return null;
  return {
    inputTokens: u.prompt_tokens,
    outputTokens: u.completion_tokens,
    totalTokens: typeof u.total_tokens === 'number' ? u.total_tokens : u.prompt_tokens + u.completion_tokens,
  };
}

export async function startRequest(
  tx: Tx,
  input: { userId: string; feature: Feature; model: string; credits: number },
): Promise<string> {
  const [row] = await tx
    .insert(aiRequests)
    .values({ userId: input.userId, feature: input.feature, model: input.model, creditsCharged: input.credits })
    .returning({ id: aiRequests.id });
  if (!row) throw new Error('Failed to create AI request record');
  return row.id;
}

function usageColumns(model: string, usage: TokenUsage | null) {
  if (!usage) return {};
  const cost = estimateCostUsd(model, usage.inputTokens, usage.outputTokens);
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    estimatedCostUsd: cost === null ? null : cost.toFixed(8),
  };
}

/** costUsd is given for requests not priced by tokens, such as transcriptions priced by audio length. */
type Outcome = { model: string; usage: TokenUsage | null; latencyMs: number; groqRequestId?: string | null; costUsd?: number | null };

export async function completeRequest(id: string, o: Outcome): Promise<void> {
  const db = await getDb();
  const cost = o.costUsd === undefined ? {} : { estimatedCostUsd: o.costUsd === null ? null : o.costUsd.toFixed(8) };
  await db
    .update(aiRequests)
    .set({ status: 'succeeded', latencyMs: o.latencyMs, groqRequestId: o.groqRequestId ?? null, completedAt: new Date(), ...usageColumns(o.model, o.usage), ...cost })
    .where(eq(aiRequests.id, id));
}

/** Failed requests refund their credits unless the user already received output. */
export async function failRequest(id: string, o: Outcome & { error: AppError; keepCredits?: boolean }): Promise<void> {
  const db = await getDb();
  await db
    .update(aiRequests)
    .set({
      status: 'failed',
      latencyMs: o.latencyMs,
      groqRequestId: o.groqRequestId ?? null,
      errorCode: o.error.code,
      errorMessage: o.error.message.slice(0, 500),
      completedAt: new Date(),
      ...(o.keepCredits ? {} : { creditsCharged: 0 }),
      ...usageColumns(o.model, o.usage),
    })
    .where(eq(aiRequests.id, id));
}

export async function attachGeneration(requestId: string, generationId: string): Promise<void> {
  const db = await getDb();
  await db.update(aiRequests).set({ generationId }).where(eq(aiRequests.id, requestId));
}

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const int = (expr: ReturnType<typeof sql>) => sql<number>`coalesce(${expr}, 0)::int`;

/** Everything the usage dashboard shows, scoped to one user. */
export async function usageSummary(userId: string) {
  const db = await getDb();
  const since = monthStart();
  const scope = and(eq(aiRequests.userId, userId), gte(aiRequests.createdAt, since));

  const totals = {
    requests: sql<number>`count(*)::int`,
    failed: sql<number>`count(*) filter (where ${aiRequests.status} = 'failed')::int`,
    credits: int(sql`sum(${aiRequests.creditsCharged})`),
    inputTokens: int(sql`sum(${aiRequests.inputTokens})`),
    outputTokens: int(sql`sum(${aiRequests.outputTokens})`),
    totalTokens: int(sql`sum(${aiRequests.totalTokens})`),
    estimatedCostUsd: sql<number>`coalesce(sum(${aiRequests.estimatedCostUsd}), 0)::float8`,
    /** Requests whose cost is not in the sum: no token report, or a model with no known price. */
    unpricedRequests: sql<number>`count(*) filter (where ${aiRequests.estimatedCostUsd} is null and ${aiRequests.status} = 'succeeded')::int`,
    avgLatencyMs: int(sql`avg(${aiRequests.latencyMs})`),
  };

  const [month] = await db.select(totals).from(aiRequests).where(scope);
  const byFeature = await db.select({ feature: aiRequests.feature, ...totals }).from(aiRequests).where(scope).groupBy(aiRequests.feature);
  const byModel = await db.select({ model: aiRequests.model, ...totals }).from(aiRequests).where(scope).groupBy(aiRequests.model);
  const recent = await db
    .select({
      id: aiRequests.id,
      feature: aiRequests.feature,
      model: aiRequests.model,
      status: aiRequests.status,
      inputTokens: aiRequests.inputTokens,
      outputTokens: aiRequests.outputTokens,
      totalTokens: aiRequests.totalTokens,
      estimatedCostUsd: aiRequests.estimatedCostUsd,
      creditsCharged: aiRequests.creditsCharged,
      latencyMs: aiRequests.latencyMs,
      errorCode: aiRequests.errorCode,
      generationId: aiRequests.generationId,
      createdAt: aiRequests.createdAt,
    })
    .from(aiRequests)
    .where(eq(aiRequests.userId, userId))
    .orderBy(desc(aiRequests.createdAt))
    .limit(50);

  return {
    periodStart: since.toISOString(),
    month,
    byFeature,
    byModel,
    recent: recent.map((r) => ({ ...r, estimatedCostUsd: r.estimatedCostUsd === null ? null : Number(r.estimatedCostUsd) })),
    costNote: `Costs are estimates from Groq list prices as of ${PRICING_AS_OF}, not billed amounts.`,
  };
}
