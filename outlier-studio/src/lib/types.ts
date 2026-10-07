/** Shapes returned by the API, as the interface uses them. */
import type { HookPattern } from '@/shared/catalog';
import type { VideoPlatform } from '@/shared/video-url';

export type SessionUser = { id: string; email: string; name: string; role: 'user' | 'admin' };
export type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number };

export type Hook = { text: string; pattern: HookPattern; why: string };
export type Analysis = {
  summary: string;
  hook: { text: string; pattern: string; whyItWorks: string };
  format: string;
  structure: { section: string; purpose: string; summary: string }[];
  /** New analyses list techniques; older ones have storytellingTactics instead. */
  techniques?: Technique[];
  storytellingTactics?: string[];
  topics: string[];
  takeaways: string[];
  remixIdeas: { title: string; angle: string }[];
  /** Answers to what the user's analysis instructions asked for. */
  customFocus?: { point: string; detail: string }[];
  /** Name of the instructions set the analysis followed, if any. */
  instructionsName?: string | null;
  /** Added when the user asks for the sentence-by-sentence breakdown. */
  longBreakdown?: LongBreakdown;
  outlierMultiple: number | null;
};

export type Technique = { name: string; kind: 'tactic' | 'trick' | 'technique'; quote: string; effect: string };
export type BreakdownLine = { text: string; role: string; technique: string; explanation: string };
export type LongBreakdown = { lines: BreakdownLine[]; createdAt: string; truncated: boolean };

export type AnalysisInstructions = { id: string; name: string; content: string; isDefault: boolean; createdAt: string; updatedAt: string };
export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };

type Base = { id: string; title: string; createdAt: string };
export type Generation =
  | (Base & { kind: 'hooks'; input: { topic: string }; output: { hooks: Hook[] } })
  | (Base & { kind: 'script'; input: { idea: string }; output: { text: string } })
  | (Base & { kind: 'analysis'; input: { transcript: string; title?: string; views?: number; channelMedianViews?: number; instructions?: { id: string; name: string } | null }; output: Analysis })
  | (Base & { kind: 'report'; input: { channelId: string; channelTitle: string }; output: Report });

export type Report = {
  summary: string;
  whatIsWorking: { pattern: string; evidence: string }[];
  whatIsNot: string[];
  topics: { topic: string; note: string }[];
  titlePatterns: string[];
  recommendations: string[];
  facts: { subscribers: number | null; uploadsInLast30Days: number; typicalShortViews: number | null; typicalLongViews: number | null; videosConsidered: number };
  isOwn: boolean;
};

export type HookLibraryItem = {
  generationId: string;
  title: string;
  createdAt: string;
  hook: { text: string; pattern: string; whyItWorks: string };
  format: string;
  video: { id: string; title: string; viewCount: number | null; outlierMultiple: number | null; channelTitle: string; platform: VideoPlatform } | null;
};

export type GenerationSummary = { id: string; kind: Generation['kind']; title: string; createdAt: string; platform: VideoPlatform | null };

type Totals = {
  requests: number; failed: number; credits: number;
  inputTokens: number; outputTokens: number; totalTokens: number;
  estimatedCostUsd: number; unpricedRequests: number; avgLatencyMs: number;
};
export type Usage = {
  requestsPerMinute: number;
  periodStart: string;
  month: Totals;
  byFeature: (Totals & { feature: string })[];
  byModel: (Totals & { model: string })[];
  recent: {
    id: string; feature: string; model: string; status: 'pending' | 'succeeded' | 'failed';
    inputTokens: number | null; outputTokens: number | null; totalTokens: number | null;
    estimatedCostUsd: number | null; creditsCharged: number; latencyMs: number | null;
    errorCode: string | null; generationId: string | null; createdAt: string;
  }[];
  costNote: string;
};

export type TrackedChannel = {
  id: string; platform: VideoPlatform; monitored: boolean; isOwn: boolean; externalId: string; title: string; handle: string | null; thumbnailUrl: string | null;
  subscriberCount: number | null; videoCount: number | null;
  medianShortViews: number | null; medianLongViews: number | null;
  lastCheckedAt: string | null; lastError: string | null; trackedSince: string;
  subscribersGained: number | null; growthSince: string | null; uploadsLast7Days: number;
};
export type ChannelList = {
  items: TrackedChannel[];
  /** True when at least one monitored platform has credentials. */
  configured: boolean;
  /** Per platform: whether its credentials are set on the server. */
  platforms: Record<'youtube' | 'instagram', boolean>;
  transcriptsConfigured: boolean;
  /** Apify spend this calendar month, and the monthly limit (never above $5). */
  apifyBudget: { spentUsd: number; budgetUsd: number };
  intervalHours: number;
  limit: number;
};

export type FeedVideo = {
  id: string; externalId: string; title: string; publishedAt: string; durationSeconds: number | null; isShort: boolean;
  thumbnailUrl: string | null; viewCount: number | null; likeCount: number | null; commentCount: number | null;
  outlierMultiple: number | null; viewsPerHour: number | null; lastCheckedAt: string;
  channelId: string; channelTitle: string; channelHandle: string | null;
  platform: VideoPlatform; monitored: boolean; sourceUrl: string | null; hasTranscript: boolean;
  /** Only on list results: whether you have broken this video down. */
  analyzed?: boolean;
};
export type VideoCheck = { takenAt: string; viewCount: number | null; likeCount: number | null; commentCount: number | null };
export type VideoDetail = {
  video: FeedVideo & { description: string; transcript: string | null; channelExternalId: string; channelMedianViews: number | null };
  history: VideoCheck[];
  latestAnalysis: Extract<Generation, { kind: 'analysis' }> | null;
  analyses: { id: string; title: string; createdAt: string }[];
  transcriptsConfigured: boolean;
};

export type Limits = { requestsPerMinute: number; trackedChannelsPerUser: number };
