import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from './db/client';
import { analysisInstructions, type AnalysisInstructions } from './db/schema';
import { AppError, notFound } from './errors';

export const INSTRUCTIONS_NAME_MAX = 80;
export const INSTRUCTIONS_MAX = 20_000;
const SETS_PER_USER = 50;

export const InstructionsInput = z.object({
  name: z.string().trim().min(1, 'Give these instructions a name.').max(INSTRUCTIONS_NAME_MAX),
  content: z.string().trim().min(10, 'Write at least a sentence of instructions.').max(INSTRUCTIONS_MAX),
  isDefault: z.boolean().optional(),
});
export type InstructionsInput = z.infer<typeof InstructionsInput>;

/** What a saved analysis records about the instructions it followed. */
export type AppliedInstructions = { id: string; name: string; content: string };

/** Every query below filters by userId, so one user can never read or change another's instructions. */
export async function listInstructions(userId: string): Promise<AnalysisInstructions[]> {
  const db = await getDb();
  return db.select().from(analysisInstructions).where(eq(analysisInstructions.userId, userId)).orderBy(asc(analysisInstructions.createdAt));
}

export async function getInstructions(userId: string, id: string): Promise<AnalysisInstructions> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(analysisInstructions)
    .where(and(eq(analysisInstructions.id, id), eq(analysisInstructions.userId, userId)))
    .limit(1);
  if (!row) throw notFound();
  return row;
}

export async function createInstructions(userId: string, input: InstructionsInput): Promise<AnalysisInstructions> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`instructions:${userId}`}))`);
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(analysisInstructions).where(eq(analysisInstructions.userId, userId));
    const existing = count?.n ?? 0;
    if (existing >= SETS_PER_USER) throw new AppError(409, 'instructions_limit', `You can keep up to ${SETS_PER_USER} sets of instructions. Delete one first.`);
    // The first set a user writes becomes their default, since that is almost always the intent.
    const isDefault = input.isDefault ?? existing === 0;
    if (isDefault) await tx.update(analysisInstructions).set({ isDefault: false }).where(eq(analysisInstructions.userId, userId));
    const [row] = await tx.insert(analysisInstructions).values({ userId, name: input.name, content: input.content, isDefault }).returning();
    if (!row) throw new Error('Failed to save instructions');
    return row;
  });
}

export async function updateInstructions(userId: string, id: string, input: Partial<InstructionsInput>): Promise<AnalysisInstructions> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    if (input.isDefault) await tx.update(analysisInstructions).set({ isDefault: false }).where(eq(analysisInstructions.userId, userId));
    const [row] = await tx
      .update(analysisInstructions)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(analysisInstructions.id, id), eq(analysisInstructions.userId, userId)))
      .returning();
    if (!row) throw notFound();
    return row;
  });
}

export async function deleteInstructions(userId: string, id: string): Promise<void> {
  const db = await getDb();
  const deleted = await db
    .delete(analysisInstructions)
    .where(and(eq(analysisInstructions.id, id), eq(analysisInstructions.userId, userId)))
    .returning({ id: analysisInstructions.id });
  if (deleted.length === 0) throw notFound();
}

/**
 * The instructions an analysis should follow: a chosen set, none (null), or,
 * when the caller leaves it out, the user's default set if they have one.
 */
export async function resolveInstructions(userId: string, choice: string | null | undefined): Promise<AppliedInstructions | null> {
  if (choice === null) return null;
  let row: AnalysisInstructions | undefined;
  if (choice) {
    row = await getInstructions(userId, choice);
  } else {
    const db = await getDb();
    [row] = await db
      .select()
      .from(analysisInstructions)
      .where(and(eq(analysisInstructions.userId, userId), eq(analysisInstructions.isDefault, true)))
      .limit(1);
  }
  return row ? { id: row.id, name: row.name, content: row.content } : null;
}
