import { env } from '../env';

type Price = { input: number; output: number };

/** Date the table below was read from https://console.groq.com/docs/models. */
export const PRICING_AS_OF = '2026-10-04';

/** USD per 1M tokens. Models priced "contact sales" are deliberately absent. */
const LIST_PRICES: Record<string, Price> = {
  'openai/gpt-oss-120b': { input: 0.15, output: 0.6 },
  'openai/gpt-oss-20b': { input: 0.075, output: 0.3 },
  'openai/gpt-oss-safeguard-20b': { input: 0.075, output: 0.3 },
  'qwen/qwen3.8-27b': { input: 0.8, output: 4.0 },
};

function overrides(): Record<string, Price> {
  const raw = env().GROQ_PRICING_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<Price>>;
    const out: Record<string, Price> = {};
    for (const [model, p] of Object.entries(parsed)) {
      if (typeof p?.input === 'number' && typeof p?.output === 'number') out[model] = { input: p.input, output: p.output };
    }
    return out;
  } catch {
    console.warn('GROQ_PRICING_JSON is not valid JSON; using built-in prices.');
    return {};
  }
}

/**
 * An estimate from list prices, not a bill: it ignores cached-token discounts,
 * service tiers and price changes after PRICING_AS_OF. Returns null when the
 * model has no known price, rather than guessing.
 */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = overrides()[model] ?? LIST_PRICES[model];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/** USD per hour of audio, from https://console.groq.com/docs/speech-to-text on PRICING_AS_OF. */
const AUDIO_PRICES: Record<string, number> = {
  'whisper-large-v3': 0.111,
  'whisper-large-v3-turbo': 0.04,
};

/** Groq bills every transcription as at least this many seconds. */
const MIN_BILLED_SECONDS = 10;

/** Estimated cost of transcribing `seconds` of audio, or null when the model has no known price. */
export function estimateAudioCostUsd(model: string, seconds: number): number | null {
  const perHour = AUDIO_PRICES[model];
  if (perHour === undefined) return null;
  return (Math.max(seconds, MIN_BILLED_SECONDS) / 3600) * perHour;
}
