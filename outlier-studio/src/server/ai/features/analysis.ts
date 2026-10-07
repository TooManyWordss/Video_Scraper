import 'server-only';
import { z } from 'zod';
import { youtubeVideoUrl } from '@/shared/youtube-url';
import { AppError } from '../../errors';
import { saveGeneration } from '../../generations';
import { resolveInstructions } from '../../instructions';
import { getTrackedVideo } from '../../video/queries';
import { ensureTranscript } from '../../video/tracking';
import { generateJson } from '../service';
import { DATA_RULE, INSTRUCTIONS_RULE, instructionsBlock, PLATFORMS, quote, transcriptField } from './shared';

export const AnalysisInput = z.object({
  /** Required unless videoId is given, in which case it is fetched automatically when left out. */
  transcript: transcriptField.optional(),
  title: z.string().trim().max(200).optional(),
  platform: z.enum(PLATFORMS).optional(),
  sourceUrl: z.string().url().max(500).optional(),
  /** Optional numbers used to state how far the video beat its channel's normal. */
  views: z.number().int().min(0).optional(),
  channelMedianViews: z.number().int().min(1).optional(),
  /** A tracked video. Its title, link and numbers are read from the database, not trusted from the client. */
  videoId: z.string().uuid().optional(),
  /** A saved set of analysis instructions to follow, null for none, or left out to use the default set. */
  instructionsId: z.string().uuid().nullable().optional(),
}).refine((v) => v.transcript !== undefined || v.videoId !== undefined, { path: ['transcript'], message: 'Paste a transcript.' });
export type AnalysisInput = z.infer<typeof AnalysisInput>;

export const TECHNIQUE_KINDS = ['tactic', 'trick', 'technique'] as const;

const Output = z.object({
  summary: z.string(),
  hook: z.object({ text: z.string(), pattern: z.string(), whyItWorks: z.string() }),
  format: z.string(),
  structure: z.array(z.object({ section: z.string(), purpose: z.string(), summary: z.string() })),
  /** The short breakdown: every tactic, trick and technique the video uses. Defaults keep older fixtures valid. */
  techniques: z.array(z.object({ name: z.string(), kind: z.enum(TECHNIQUE_KINDS), quote: z.string(), effect: z.string() })).default([]),
  topics: z.array(z.string()),
  takeaways: z.array(z.string()),
  remixIdeas: z.array(z.object({ title: z.string(), angle: z.string() })),
  /** Answers to whatever the user's analysis instructions asked for. Empty when there were none. */
  customFocus: z.array(z.object({ point: z.string(), detail: z.string() })).default([]),
});

const SYSTEM = `You analyse short-form videos for creators who want to understand why a video performed.
You are given the spoken transcript only. You cannot see the visuals, editing or audio, so do not describe them or guess at them.

Produce:
- summary: two sentences on what the video is and its core idea.
- hook: the opening line quoted exactly from the transcript, the pattern it uses, and why it holds attention.
- format: the story format in a few words (for example: breakdown, tutorial, ranking, story, A vs B, case study).
- structure: the video split into its sections in order, each with its purpose and a one-line summary.
- techniques: every persuasion or retention device the video uses, 4 to 10 of them. kind is "tactic" for a strategic choice (what the video sets out to do, such as raising stakes or borrowing authority), "trick" for a small attention device (a pattern break, a teaser, a callback) and "technique" for a craft skill in the wording (rhythm, contrast, specificity, open loops). quote is the shortest exact words from the transcript that show it; effect is what it does to the viewer.
- topics: 2 to 5 topic tags.
- takeaways: 3 to 5 lessons another creator could apply.
- remixIdeas: 3 ideas for a new, original video on a different subject that reuses the structure, not the content.
- customFocus: if analysis instructions are given, one entry for each thing they ask you to look at, judge or produce that the fields above do not already cover; otherwise an empty list.

Ground every statement in the transcript. If performance numbers are provided, you may refer to them; never invent numbers.
${DATA_RULE}
${INSTRUCTIONS_RULE}`;

/** How far a video beat its channel's median, computed here rather than by the model. */
export function outlierMultiple(views?: number, channelMedianViews?: number): number | null {
  if (views === undefined || channelMedianViews === undefined) return null;
  return Math.round((views / channelMedianViews) * 10) / 10;
}

const PROMPT_PLATFORM = { tiktok: 'tiktok', instagram: 'instagram', youtube: 'youtube_shorts' } as const;
/** Long videos are cut to what the model can take in one go. */
const MAX_TRANSCRIPT_CHARS = 20_000;

export async function analyzeVideo(userId: string, request: AnalysisInput) {
  // Resolved before a transcript is fetched or a credit reserved, so a stale id fails cleanly.
  const instructions = await resolveInstructions(userId, request.instructionsId);
  let input = request;
  let transcript = request.transcript ?? '';
  if (request.videoId) {
    // 404s unless this user tracks the video's channel.
    const video = await getTrackedVideo(userId, request.videoId);
    // One-click path: no transcript in the request, so use the stored one or fetch it.
    // A failure here happens before any credit is reserved.
    if (!request.transcript) transcript = await ensureTranscript(video, userId);
    input = {
      ...request,
      title: video.title,
      platform: video.platform === 'youtube' && !video.isShort ? undefined : PROMPT_PLATFORM[video.platform],
      sourceUrl: video.sourceUrl ?? youtubeVideoUrl(video.externalId, video.isShort),
      views: video.viewCount ?? undefined,
      channelMedianViews: video.channelMedianViews && video.channelMedianViews > 0 ? video.channelMedianViews : undefined,
    };
  }
  transcript = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  if (transcript.trim().length < 40) throw new AppError(422, 'transcript_unavailable', 'This video has too few spoken words to break down.');
  const multiple = outlierMultiple(input.views, input.channelMedianViews);
  const lines = [
    input.title ? quote('title', input.title) : '',
    input.platform ? `Platform: ${input.platform}` : '',
    multiple !== null ? `Performance: ${input.views} views, ${multiple}x the channel's median of ${input.channelMedianViews}.` : '',
    quote('transcript', transcript),
    instructionsBlock(instructions),
  ];
  const result = await generateJson({
    userId,
    feature: 'analysis',
    tier: 'quality',
    system: SYSTEM,
    prompt: lines.filter(Boolean).join('\n\n'),
    schemaName: 'video_analysis',
    schema: Output,
    temperature: 0.3,
    maxOutputTokens: 8192,
  });

  const generation = await saveGeneration({
    userId,
    kind: 'analysis',
    title: input.title || result.data.summary,
    input: { ...input, transcript, instructions },
    output: { ...result.data, outlierMultiple: multiple, basis: 'transcript', instructionsName: instructions?.name ?? null },
    requestId: result.requestId,
    videoId: input.videoId,
  });
  return { generation, usage: result.usage, requestId: result.requestId };
}
