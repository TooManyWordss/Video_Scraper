/** Option lists shared by the server (validation, prompts) and the interface (labels). */

export const PLATFORMS = ['tiktok', 'instagram', 'youtube_shorts'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABELS: Record<Platform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram Reels',
  youtube_shorts: 'YouTube Shorts',
};

export const HOOK_PATTERNS = [
  'curiosity_gap',
  'contrarian',
  'bold_claim',
  'question',
  'story_open',
  'mistake_warning',
  'how_to',
  'list_tease',
  'before_after',
  'direct_callout',
] as const;
export type HookPattern = (typeof HOOK_PATTERNS)[number];
export const HOOK_PATTERN_LABELS: Record<HookPattern, string> = {
  curiosity_gap: 'Curiosity gap',
  contrarian: 'Contrarian',
  bold_claim: 'Bold claim',
  question: 'Question',
  story_open: 'Story opening',
  mistake_warning: 'Mistake warning',
  how_to: 'How-to',
  list_tease: 'List tease',
  before_after: 'Before and after',
  direct_callout: 'Direct callout',
};

/** General storytelling structures, described in our own words. */
export const FRAMEWORKS = {
  problem_solution: { label: 'Problem, then fix', guide: 'Name a painful problem, agitate it briefly, then deliver the fix step by step.' },
  story: { label: 'Story', guide: 'Open in the middle of a moment, build tension, then land the lesson.' },
  breakdown: { label: 'Breakdown', guide: 'Make a claim about something that worked, then explain the reasons in order.' },
  list: { label: 'List', guide: 'Promise a number of items, deliver them fast, save the strongest for last.' },
  myth_buster: { label: 'Myth buster', guide: 'State a common belief, show why it is wrong, give the better approach.' },
  tutorial: { label: 'Tutorial', guide: 'Show the end result first, then the steps to get there.' },
} as const;
export type Framework = keyof typeof FRAMEWORKS;
export const FRAMEWORK_KEYS = Object.keys(FRAMEWORKS) as [Framework, ...Framework[]];

/** Speaking pace used for script length targets and timing marks. */
export const WORDS_PER_SECOND = 2.5;

export const FEATURE_LABELS: Record<string, string> = { hooks: 'Hooks', script: 'Scripts', analysis: 'Video analysis', report: 'Channel reports', breakdown: 'Long breakdowns', chat: 'Analysis chat', transcribe: 'Transcripts' };
