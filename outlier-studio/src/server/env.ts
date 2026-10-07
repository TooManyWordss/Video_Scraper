import 'server-only';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default('./.data/pglite'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL_QUALITY: z.string().min(1).default('openai/gpt-oss-120b'),
  GROQ_MODEL_FAST: z.string().min(1).default('openai/gpt-oss-20b'),
  /** Speech-to-text for TikTok and Instagram audio. whisper-large-v3 is Groq's most accurate model. */
  GROQ_MODEL_TRANSCRIBE: z.string().min(1).default('whisper-large-v3'),
  /** Largest audio file sent for transcription. Groq's free tier accepts 25 MB; the dev tier 100 MB. */
  GROQ_AUDIO_MAX_MB: z.coerce.number().min(1).max(100).default(25),
  GROQ_STRICT_JSON_MODELS: z.string().default('openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.8-27b'),
  GROQ_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(60_000),
  GROQ_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  GROQ_PRICING_JSON: z.string().optional(),
  /** Only set this for reasoning models; other models reject the parameter. */
  GROQ_REASONING_EFFORT: z.enum(['low', 'medium', 'high']).optional(),
  /** Google API key with the YouTube Data API v3 enabled. Needed for competitor tracking. */
  YOUTUBE_API_KEY: z.string().optional(),
  /** Apify API token: YouTube transcripts, and numbers and audio for TikTok and Instagram videos. */
  APIFY_TOKEN: z.string().optional(),
  /** Most this server may spend on Apify in a calendar month (UTC). Capped at $5 in code. */
  APIFY_MONTHLY_BUDGET_USD: z.coerce.number().min(0).default(5),
  /** Optional overrides of the Actors in video/apify.ts. */
  APIFY_ACTOR_YOUTUBE_TRANSCRIPT: z.string().optional(),
  APIFY_ACTOR_TIKTOK: z.string().optional(),
  APIFY_ACTOR_INSTAGRAM: z.string().optional(),
  APIFY_ACTOR_INSTAGRAM_SEARCH: z.string().optional(),
  /** Honoured only when NODE_ENV === 'test' (see video/apify.ts). */
  APIFY_BASE_URL: z.string().optional(),
  /** How often each tracked channel is re-checked. */
  TRACK_INTERVAL_HOURS: z.coerce.number().min(1).max(168).default(6),
  /** Set to 1 to stop the built-in background checker (for hosts that call /api/cron/refresh instead). */
  DISABLE_SCHEDULER: z.string().optional(),
  /** Bearer token for POST /api/cron/refresh. The endpoint is off when unset. */
  CRON_SECRET: z.string().min(16).optional(),
  /** Honoured only when NODE_ENV === 'test' (see video/youtube.ts). */
  YOUTUBE_API_BASE_URL: z.string().optional(),
  /** Honoured only when NODE_ENV === 'test' (see ai/client.ts). */
  GROQ_BASE_URL: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

/** Read on every call so tests can change process.env between cases. */
export function env(): Env {
  const cleaned: Record<string, string | undefined> = {};
  for (const key of Object.keys(schema.shape)) {
    const value = process.env[key];
    cleaned[key] = value === '' ? undefined : value;
  }
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}
