import 'server-only';
import { eq, gte, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { apifyRuns } from '../db/schema';
import { env } from '../env';
import { AppError } from '../errors';

/**
 * Client for Apify (https://docs.apify.com), which runs the scrapers that read
 * public video pages: YouTube captions, and the numbers and sound of one
 * TikTok or Instagram video. Each call runs one Actor and returns its dataset items.
 * Apify bills each run against the account's monthly platform credit.
 *
 * The Actor ids and input fields below are the defaults this client was
 * written against. Each Actor's input page on apify.com is the reference;
 * override the Actor with APIFY_ACTOR_* if it has changed.
 */

const APIFY_API = 'https://api.apify.com';
/** Apify stops a synchronous run after this many seconds. */
const RUN_TIMEOUT_SECONDS = 120;

export const DEFAULT_ACTORS = {
  youtubeTranscript: 'devsef~youtube-transcript-scraper',
  tiktok: 'clockworks~tiktok-scraper',
  instagram: 'apify~instagram-reel-scraper',
  instagramSearch: 'apify~instagram-search-scraper',
} as const;
type ActorKind = keyof typeof DEFAULT_ACTORS;

export function apifyConfigured(): boolean {
  return Boolean(env().APIFY_TOKEN);
}

function baseUrl(): string {
  const e = env();
  return e.NODE_ENV === 'test' && e.APIFY_BASE_URL ? e.APIFY_BASE_URL : APIFY_API;
}

function actorId(kind: ActorKind): string {
  const e = env();
  const override = {
    youtubeTranscript: e.APIFY_ACTOR_YOUTUBE_TRANSCRIPT,
    tiktok: e.APIFY_ACTOR_TIKTOK,
    instagram: e.APIFY_ACTOR_INSTAGRAM,
    instagramSearch: e.APIFY_ACTOR_INSTAGRAM_SEARCH,
  }[kind];
  return override || DEFAULT_ACTORS[kind];
}

const notConfigured = (message: string) => new AppError(503, 'transcripts_not_configured', message);

export type Item = Record<string, unknown>;

/**
 * Upper ends of the per-result prices on each Actor's Apify page at the time of
 * writing. The budget reserves at these prices, so an estimate never runs low.
 */
const PRICE_PER_RESULT_USD: Record<ActorKind, number> = {
  youtubeTranscript: 2 / 1000,
  // Free-plan prices are the highest current tier, so the reservation is safe
  // regardless of which Apify plan the server uses. Checked 2026-10-07.
  tiktok: 3.7 / 1000,
  instagram: 2.6 / 1000,
  instagramSearch: 2.7 / 1000,
};
const ACTOR_START_USD = 0.001;
/** The TikTok Actor's video-download add-on, used to get audio for transcription. */
const TIKTOK_VIDEO_DOWNLOAD_USD = 1.3 / 1000;
// Apify rejects Reel Scraper runs below this value before the Actor starts,
// even when a one-result price calculation would be lower.
const INSTAGRAM_MIN_RUN_USD = 0.0073;

/** Whatever APIFY_MONTHLY_BUDGET_USD says, this server never spends more than $5 in a month. */
const HARD_CAP_USD = 5;

export function apifyBudgetUsd(): number {
  return Math.min(env().APIFY_MONTHLY_BUDGET_USD, HARD_CAP_USD);
}

const monthStartUtc = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

/** Spend this calendar month (UTC). Runs with no known cost count at their reservation. */
export async function apifySpendThisMonth(): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ spent: sql<number>`coalesce(sum(coalesce(${apifyRuns.costUsd}, ${apifyRuns.reservedUsd})), 0)::float8` })
    .from(apifyRuns)
    .where(gte(apifyRuns.createdAt, monthStartUtc()));
  return Number(row?.spent ?? 0);
}

/**
 * Reserves the most a run can cost, and refuses it if this month's spend plus
 * the reservation would pass the budget. The check runs under a lock so two
 * runs at once cannot both fit in the last dollar.
 */
async function reserve(kind: ActorKind, results: number, extraPerResultUsd = 0): Promise<{ id: number; capUsd: number }> {
  const db = await getDb();
  const calculated = ACTOR_START_USD + (PRICE_PER_RESULT_USD[kind] + extraPerResultUsd) * results;
  const capUsd = Math.ceil(Math.max(calculated, kind === 'instagram' ? INSTAGRAM_MIN_RUN_USD : 0) * 1e6) / 1e6;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4242)`);
    const [row] = await tx
      .select({ spent: sql<number>`coalesce(sum(coalesce(${apifyRuns.costUsd}, ${apifyRuns.reservedUsd})), 0)::float8` })
      .from(apifyRuns)
      .where(gte(apifyRuns.createdAt, monthStartUtc()));
    const spent = Number(row?.spent ?? 0);
    const budget = apifyBudgetUsd();
    if (spent + capUsd > budget + 1e-9) {
      throw new AppError(402, 'apify_budget', `This server's Apify budget of $${budget} for the month is used up. Scraping resumes next month.`);
    }
    const [inserted] = await tx.insert(apifyRuns).values({ actor: actorId(kind), reservedUsd: capUsd }).returning({ id: apifyRuns.id });
    return { id: Number(inserted!.id), capUsd };
  });
}

async function finish(id: number, status: 'succeeded' | 'failed', costUsd: number | null): Promise<void> {
  const db = await getDb();
  await db.update(apifyRuns).set({ status, costUsd }).where(eq(apifyRuns.id, id));
}

/** Runs one Actor and returns the items it saved. An empty dataset is an empty list, not an error. */
export async function runActor(kind: ActorKind, input: Record<string, unknown>, results: number, extraPerResultUsd = 0): Promise<Item[]> {
  if (!env().APIFY_TOKEN) throw notConfigured('Automatic transcripts and video numbers need an Apify token on the server.');
  const reservation = await reserve(kind, results, extraPerResultUsd);
  let items: Item[];
  try {
    items = await callActor(kind, input, reservation.capUsd);
  } catch (err) {
    await finish(reservation.id, 'failed', null);
    throw err;
  }
  const resultCost = items.length ? ACTOR_START_USD + (PRICE_PER_RESULT_USD[kind] + extraPerResultUsd) * items.length : ACTOR_START_USD;
  await finish(reservation.id, 'succeeded', Math.min(reservation.capUsd, resultCost));
  return items;
}

async function callActor(kind: ActorKind, input: Record<string, unknown>, capUsd: number): Promise<Item[]> {
  const token = env().APIFY_TOKEN!;

  // Apify uses "~" in place of "/" between the owner and the Actor name.
  const url = new URL(`${baseUrl()}/v2/acts/${actorId(kind).replace('/', '~')}/run-sync-get-dataset-items`);
  url.searchParams.set('timeout', String(RUN_TIMEOUT_SECONDS));
  // Apify stops the run once it has spent this much, so a run can never exceed its reservation.
  url.searchParams.set('maxTotalChargeUsd', capUsd.toFixed(6));

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((RUN_TIMEOUT_SECONDS + 15) * 1000),
    });
  } catch {
    // The URL is not logged: it names the Actor, and the token is in a header, but errors can echo URLs.
    throw new AppError(503, 'transcripts_unavailable', 'The scraping service could not be reached. Please try again shortly.');
  }

  const body = (await res.json().catch(() => null)) as unknown;
  if (res.ok) return Array.isArray(body) ? (body as Item[]) : [];

  const providerError = body && typeof body === 'object' && 'error' in body ? (body as { error?: unknown }).error : null;
  const providerType = providerError && typeof providerError === 'object' && 'type' in providerError ? str((providerError as { type?: unknown }).type) : '';
  if (providerType === 'max-total-charge-usd-below-minimum') {
    throw new AppError(503, 'scraper_configuration', 'The scraper changed its minimum run price. Update the Apify spending cap before trying again.');
  }

  if (res.status === 401 || res.status === 403) {
    throw notConfigured('The Apify token was rejected. Check APIFY_TOKEN in the server settings.');
  }
  if (res.status === 402) {
    throw new AppError(402, 'transcript_plan_limit', 'The Apify plan on this server does not cover this request.');
  }
  if (res.status === 404) {
    throw notConfigured(`The Apify Actor ${actorId(kind)} was not found. Check the Actor name in the server settings.`);
  }
  if (res.status === 429) {
    throw new AppError(429, 'transcript_quota', "Apify is limiting requests right now. You can paste a transcript in instead.");
  }
  if (res.status === 408 || res.status === 504) {
    throw new AppError(504, 'transcript_timeout', 'The scrape is taking too long. Try again in a minute.');
  }
  if (res.status >= 500) throw new AppError(503, 'transcripts_unavailable', 'The scraping service is having problems. Please try again shortly.');
  throw new AppError(422, 'video_not_accessible', 'The scraping provider rejected this request before returning video data. Try again shortly or paste the transcript instead.');
}

export type Transcript = { text: string; lang: string | null };

export const str = (v: unknown): string => (typeof v === 'string' ? v : '');
export const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
/** Only http(s) links are kept; anything else from a third party is dropped. */
export const httpUrl = (v: unknown): string | null => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null);
export const date = (v: unknown): Date | null => {
  const d = typeof v === 'string' || typeof v === 'number' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

const YOUTUBE = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i;
const TIKTOK = /^https?:\/\/(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\//i;
const INSTAGRAM = /^https?:\/\/(?:www\.)?instagram\.com\//i;

/** Caption text from the transcript Actor's item. It may be a string or a list of segments. */
function transcriptText(item: Item): string {
  const raw = item.text ?? item.transcript ?? item.captions ?? item.content;
  if (typeof raw === 'string') return raw.replace(/\s+/g, ' ').trim();
  if (Array.isArray(raw)) {
    return raw
      .map((seg) => (seg && typeof seg === 'object' ? str((seg as { text?: unknown }).text) : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

const none = () => new AppError(422, 'transcript_unavailable', 'This video has no transcript available. You can paste one in instead.');

/** The captions of a YouTube video. TikTok and Instagram are transcribed from their audio instead. */
export async function fetchTranscript(videoUrl: string): Promise<Transcript> {
  if (!YOUTUBE.test(videoUrl)) throw new AppError(422, 'transcript_unavailable', 'Captions are only read from YouTube. You can paste a transcript in instead.');
  const [item] = await runActor('youtubeTranscript', { videoUrls: [videoUrl], language: 'en', includeSegments: false }, 1);
  if (!item) throw none();
  const text = transcriptText(item);
  if (!text) throw none();
  return { text, lang: str(item.language) || str(item.lang) || null };
}

/** Where to download a video's sound from. headers carries the Apify token for files kept in Apify storage. */
export type MediaSource = { url: string; headers: Record<string, string> };

const noMedia = () => new AppError(422, 'audio_unavailable', "The video's audio could not be fetched. You can paste a transcript in instead.");

/**
 * A downloadable copy of a TikTok or Instagram video's sound, for speech-to-text.
 * Instagram's normal result already links the media. TikTok needs the Actor's
 * video-download add-on, which saves the file to Apify storage.
 */
export async function fetchMediaSource(videoUrl: string): Promise<MediaSource> {
  let url: string | null = null;
  if (TIKTOK.test(videoUrl)) {
    const [item] = await runActor('tiktok', { postURLs: [videoUrl], resultsPerPage: 1, shouldDownloadVideos: true }, 1, TIKTOK_VIDEO_DOWNLOAD_USD);
    url = Array.isArray(item?.mediaUrls) ? httpUrl(item.mediaUrls[0]) : null;
  } else if (INSTAGRAM.test(videoUrl)) {
    const [item] = await runActor('instagram', { username: [videoUrl], resultsLimit: 1 }, 1);
    if (item) assertReadableInstagramItem(item);
    // The audio-only file is far smaller; the video file has the same sound.
    url = httpUrl(item?.audioUrl) ?? httpUrl(item?.videoUrl);
  } else {
    throw new AppError(422, 'transcript_unavailable', 'Audio transcripts work for TikTok and Instagram videos. You can paste one in instead.');
  }
  if (!url) throw noMedia();
  // The token is only ever sent back to Apify itself, never to a CDN.
  const apifyOrigin = new URL(baseUrl()).origin;
  const headers: Record<string, string> = new URL(url).origin === apifyOrigin ? { authorization: `Bearer ${env().APIFY_TOKEN}` } : {};
  return { url, headers };
}

export type VideoMetadata = {
  platform: 'tiktok' | 'instagram';
  id: string;
  url: string;
  title: string;
  description: string;
  author: { username: string; displayName: string; avatarUrl: string | null };
  views: number | null;
  likes: number | null;
  comments: number | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  createdAt: Date | null;
};

function tiktokMetadata(item: Item, videoUrl: string): VideoMetadata | null {
  const author = (item.authorMeta ?? {}) as Record<string, unknown>;
  const video = (item.videoMeta ?? {}) as Record<string, unknown>;
  const id = str(item.id);
  const username = str(author.name);
  if (!id || !username) return null;
  return {
    platform: 'tiktok',
    id,
    url: httpUrl(item.webVideoUrl) ?? videoUrl,
    title: (str(item.text).split('\n')[0] ?? '').slice(0, 200) || 'Untitled video',
    description: str(item.text).slice(0, 2000),
    author: { username, displayName: str(author.nickName) || username, avatarUrl: httpUrl(author.avatar) },
    views: int(item.playCount),
    likes: int(item.diggCount),
    comments: int(item.commentCount),
    durationSeconds: int(video.duration),
    thumbnailUrl: httpUrl(video.coverUrl),
    createdAt: date(item.createTimeISO) ?? date(item.createTime),
  };
}

function instagramMetadata(item: Item, videoUrl: string): VideoMetadata | null {
  const id = str(item.id) || str(item.shortCode);
  const username = str(item.ownerUsername);
  if (!id || !username) return null;
  const caption = str(item.caption);
  return {
    platform: 'instagram',
    id,
    url: httpUrl(item.url) ?? videoUrl,
    title: (caption.split('\n')[0] ?? '').slice(0, 200) || 'Untitled reel',
    description: caption.slice(0, 2000),
    author: { username, displayName: str(item.ownerFullName) || username, avatarUrl: httpUrl(item.ownerProfilePicUrl) },
    views: int(item.videoPlayCount ?? item.videoViewCount),
    likes: int(item.likesCount),
    comments: int(item.commentsCount),
    durationSeconds: int(item.videoDuration),
    thumbnailUrl: httpUrl(item.displayUrl),
    createdAt: date(item.timestamp),
  };
}

function assertReadableInstagramItem(item: Item): void {
  const code = str(item.error);
  if (!code) return;
  if (code === 'not_found') {
    throw new AppError(422, 'video_not_accessible', 'Instagram did not expose this post to the public scraper. Check that the link opens in an incognito window and that the account and post are public.');
  }
  throw new AppError(422, 'video_not_accessible', 'Apify could not read this Instagram post. The post may be restricted or Instagram may be blocking automated access.');
}

/** Public numbers and author of one TikTok or Instagram video, from its link. */
export async function fetchVideoMetadata(videoUrl: string): Promise<VideoMetadata> {
  let meta: VideoMetadata | null = null;
  if (TIKTOK.test(videoUrl)) {
    const [item] = await runActor('tiktok', { postURLs: [videoUrl], resultsPerPage: 1 }, 1);
    meta = item ? tiktokMetadata(item, videoUrl) : null;
  } else if (INSTAGRAM.test(videoUrl)) {
    // The maintained Reel Scraper uses one `username` array for profile names,
    // profile URLs and direct reel/post URLs.
    const [item] = await runActor('instagram', { username: [videoUrl], resultsLimit: 1 }, 1);
    if (item) assertReadableInstagramItem(item);
    meta = item ? instagramMetadata(item, videoUrl) : null;
  } else {
    throw new AppError(400, 'invalid_link', 'Only TikTok and Instagram videos are read this way.');
  }
  if (!meta) throw new AppError(404, 'video_not_found', 'No public video data was returned for this link. Check that it opens while logged out, then try again.');
  return meta;
}
