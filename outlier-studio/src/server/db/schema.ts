import { bigint, bigserial, boolean, doublePrecision, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
  plan: text('plan', { enum: ['starter', 'pro', 'visionary', 'titan'] }).notNull().default('starter'),
  /** The creator's own description of their niche, audience and voice. Shapes generated hooks and scripts. */
  persona: text('persona'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the cookie token. The raw token is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

const count = (name: string) => bigint(name, { mode: 'number' });

/**
 * A competitor channel. Rows are shared: if two users track the same channel
 * it is fetched once. Who may see it is decided by tracked_channels.
 */
export const channels = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platform: text('platform', { enum: ['youtube', 'tiktok', 'instagram'] }).notNull(),
    /**
     * True for YouTube channels, which are re-checked on a schedule. False for
     * TikTok and Instagram authors, where only videos added by link are known.
     */
    monitored: boolean('monitored').notNull().default(true),
    /** The platform's own id, e.g. a YouTube channel id starting with UC. */
    externalId: text('external_id').notNull(),
    handle: text('handle'),
    title: text('title').notNull(),
    thumbnailUrl: text('thumbnail_url'),
    uploadsPlaylistId: text('uploads_playlist_id'),
    /** Null when the channel hides its subscriber count. YouTube rounds this to three significant figures. */
    subscriberCount: count('subscriber_count'),
    viewCount: count('view_count'),
    videoCount: integer('video_count'),
    /** Median views of recent Shorts and of recent longer videos, the baselines for the outlier multiple. */
    medianShortViews: count('median_short_views'),
    medianLongViews: count('median_long_views'),
    lastCheckedAt: ts('last_checked_at'),
    lastError: text('last_error'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('channels_platform_external_idx').on(t.platform, t.externalId), index('channels_last_checked_idx').on(t.lastCheckedAt)],
);

export const trackedChannels = pgTable(
  'tracked_channels',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
    /** The user's own channel rather than a competitor. */
    isOwn: boolean('is_own').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channelId] }), index('tracked_channels_channel_idx').on(t.channelId)],
);

/** One row per check, so growth can be measured between any two dates. */
export const channelSnapshots = pgTable(
  'channel_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
    takenAt: ts('taken_at').notNull().defaultNow(),
    subscriberCount: count('subscriber_count'),
    viewCount: count('view_count'),
    videoCount: integer('video_count'),
  },
  (t) => [index('channel_snapshots_channel_taken_idx').on(t.channelId, t.takenAt)],
);

export const videos = pgTable(
  'videos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    publishedAt: ts('published_at').notNull(),
    durationSeconds: integer('duration_seconds'),
    isShort: boolean('is_short').notNull().default(false),
    thumbnailUrl: text('thumbnail_url'),
    /** The video's own page, for platforms where it cannot be built from the id. */
    sourceUrl: text('source_url'),
    /** Spoken words, fetched once on first analysis and reused after that. */
    transcript: text('transcript'),
    transcriptLang: text('transcript_lang'),
    /** Null when the uploader hides the figure. */
    viewCount: count('view_count'),
    likeCount: count('like_count'),
    commentCount: count('comment_count'),
    /** Views divided by the channel's median for videos of the same kind. */
    outlierMultiple: doublePrecision('outlier_multiple'),
    /** Views gained per hour between the two most recent checks. Null until there are two. */
    viewsPerHour: doublePrecision('views_per_hour'),
    lastCheckedAt: ts('last_checked_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('videos_channel_external_idx').on(t.channelId, t.externalId),
    index('videos_channel_published_idx').on(t.channelId, t.publishedAt),
  ],
);

export const videoSnapshots = pgTable(
  'video_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    videoId: uuid('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
    takenAt: ts('taken_at').notNull().defaultNow(),
    viewCount: count('view_count'),
    likeCount: count('like_count'),
    commentCount: count('comment_count'),
  },
  (t) => [index('video_snapshots_video_taken_idx').on(t.videoId, t.takenAt)],
);

/** Saved outputs: generated hooks, scripts and video analyses. */
export const generations = pgTable(
  'generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['hooks', 'script', 'analysis', 'report'] }).notNull(),
    /** The tracked video an analysis was made from, if any. */
    videoId: uuid('video_id').references(() => videos.id, { onDelete: 'set null' }),
    /** The channel a report was written about, if any. */
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    input: jsonb('input').notNull(),
    output: jsonb('output').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('generations_user_created_idx').on(t.userId, t.createdAt), index('generations_video_idx').on(t.videoId)],
);

/**
 * A user's own guidance for video analysis, written by hand or imported from a
 * file. The one marked default is applied to every new analysis.
 */
export const analysisInstructions = pgTable(
  'analysis_instructions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    content: text('content').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('analysis_instructions_user_idx').on(t.userId)],
);

/** Follow-up chat about one saved analysis. */
export const analysisMessages = pgTable(
  'analysis_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    generationId: uuid('generation_id').notNull().references(() => generations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('analysis_messages_generation_created_idx').on(t.generationId, t.createdAt)],
);

/** One row per Groq request, written by the usage recorder. */
export const aiRequests = pgTable(
  'ai_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    generationId: uuid('generation_id').references(() => generations.id, { onDelete: 'set null' }),
    feature: text('feature').notNull(),
    model: text('model').notNull(),
    status: text('status', { enum: ['pending', 'succeeded', 'failed'] }).notNull().default('pending'),
    /** Token counts exactly as reported by Groq. Null when Groq reported none. */
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens'),
    /** Estimate from the price table at request time. Null when the model has no known price. */
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 14, scale: 8 }),
    creditsCharged: integer('credits_charged').notNull().default(0),
    latencyMs: integer('latency_ms'),
    groqRequestId: text('groq_request_id'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: ts('created_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
  },
  (t) => [index('ai_requests_user_created_idx').on(t.userId, t.createdAt)],
);

/**
 * One row per Apify run. reservedUsd is the most the run may cost (the cap sent
 * to Apify); costUsd is what it did cost, or null when unknown, in which case the
 * reservation counts. Failed runs keep their reservation, so the budget errs low.
 */
export const apifyRuns = pgTable(
  'apify_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actor: text('actor').notNull(),
    reservedUsd: doublePrecision('reserved_usd').notNull(),
    costUsd: doublePrecision('cost_usd'),
    status: text('status', { enum: ['pending', 'succeeded', 'failed'] }).notNull().default('pending'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('apify_runs_created_idx').on(t.createdAt)],
);

/** Admin-editable configuration, e.g. key "limits". */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

/** Per-user overrides of the plan defaults. Null means "use the default". */
export const userLimits = pgTable('user_limits', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  monthlyCredits: integer('monthly_credits'),
  requestsPerMinute: integer('requests_per_minute'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Sliding-window counters for non-AI rate limits (login, signup). */
export const rateLimitHits = pgTable(
  'rate_limit_hits',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    key: text('key').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('rate_limit_hits_key_created_idx').on(t.key, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Generation = typeof generations.$inferSelect;
export type AiRequest = typeof aiRequests.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Video = typeof videos.$inferSelect;
export type AnalysisInstructions = typeof analysisInstructions.$inferSelect;
export type AnalysisMessage = typeof analysisMessages.$inferSelect;
