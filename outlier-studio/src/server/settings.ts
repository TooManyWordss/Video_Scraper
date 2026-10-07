import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Tx } from './db/client';
import { appSettings } from './db/schema';

/** Every AI-powered feature. Adding one here gives it usage tracking. */
export const FEATURES = ['hooks', 'script', 'analysis', 'report', 'breakdown', 'chat', 'transcribe'] as const;
export type Feature = (typeof FEATURES)[number];

export const LimitsSchema = z.object({
  requestsPerMinute: z.number().int().min(1).max(600),
  /** How many competitor channels the account may track. */
  trackedChannelsPerUser: z.number().int().min(0).max(1000).default(200),
});
export type Limits = z.infer<typeof LimitsSchema>;

/** Safety limits only; there are no plans or credit quotas. Editable at /api/admin/limits. */
export const DEFAULT_LIMITS: Limits = {
  requestsPerMinute: 30,
  trackedChannelsPerUser: 200,
};

const KEY = 'limits';

export async function getLimits(db: Db | Tx): Promise<Limits> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
  if (!row) return DEFAULT_LIMITS;
  // Rows saved before plans were removed still carry the old fields; zod drops them.
  const parsed = LimitsSchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_LIMITS;
}

export async function setLimits(db: Db, value: Limits, adminId: string): Promise<Limits> {
  const now = new Date();
  await db
    .insert(appSettings)
    .values({ key: KEY, value, updatedBy: adminId, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: adminId, updatedAt: now } });
  return value;
}
