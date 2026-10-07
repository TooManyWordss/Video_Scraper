import 'server-only';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { parseVideoLink } from '@/shared/video-url';
import { parseChannelInput } from '@/shared/channel-url';
import { parseYouTubeInput, SHORT_MAX_SECONDS, youtubeVideoUrl } from '@/shared/youtube-url';
import { getDb } from '../db/client';
import { channels, channelSnapshots, trackedChannels, videos, videoSnapshots } from '../db/schema';
import { env } from '../env';
import { AppError, notFound } from '../errors';
import { getLimits } from '../settings';
import { baselineViews, outlierMultiple, viewsPerHour } from './metrics';
import { transcribeMedia } from '../ai/transcribe';
import { fetchMediaSource, fetchTranscript, fetchVideoMetadata } from './apify';
import { fetchVideos, type ChannelInfo, type VideoInfo } from './youtube';
import { fetchSnapshot, lookupChannel, MONITORED_PLATFORMS, platformConfigured, type MonitoredPlatform } from './platforms';

const SNAPSHOT_RETENTION_DAYS = 90;
/** A person can re-check a channel by hand at most this often. */
const MANUAL_REFRESH_MINUTES = 15;
const MIN_VIDEOS_FOR_BASELINE = 5;

function channelColumns(info: ChannelInfo) {
  return {
    title: info.title,
    handle: info.handle,
    thumbnailUrl: info.thumbnailUrl,
    uploadsPlaylistId: info.uploadsPlaylistId,
    subscriberCount: info.subscriberCount,
    viewCount: info.viewCount,
    videoCount: info.videoCount,
  };
}

/** Starts tracking a channel for a user, from a channel link, @handle or video link. */
export async function addChannel(userId: string, input: string): Promise<{ channelId: string; alreadyTracked: boolean }> {
  const parsed = parseChannelInput(input);
  if (!parsed.ok) throw new AppError(400, 'invalid_link', parsed.reason);
  const platform = parsed.channel.platform;
  if (!platformConfigured(platform)) {
    throw new AppError(503, 'video_data_not_configured', `Tracking ${platform === 'youtube' ? 'YouTube' : 'Instagram'} needs its API credentials on the server.`);
  }

  const db = await getDb();
  const limit = (await getLimits(db)).trackedChannelsPerUser;
  // TikTok and Instagram authors that came from single pasted links do not count towards the limit.
  const [mine] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(trackedChannels)
    .innerJoin(channels, eq(channels.id, trackedChannels.channelId))
    .where(and(eq(trackedChannels.userId, userId), eq(channels.monitored, true)));
  const tracked = mine?.n ?? 0;

  const found = await lookupChannel(parsed.channel);
  if (!found) throw new AppError(404, 'channel_not_found', `${platform === 'youtube' ? 'YouTube' : 'Instagram'} has no channel or video at that link.`);
  const { info } = found;

  // A profile first added by a single pasted link is already in the table, unmonitored: it becomes monitored here.
  const [channel] = await db
    .insert(channels)
    .values({ platform, monitored: true, externalId: info.externalId, ...channelColumns(info) })
    .onConflictDoUpdate({ target: [channels.platform, channels.externalId], set: { monitored: true, ...channelColumns(info) } })
    .returning({ id: channels.id, lastCheckedAt: channels.lastCheckedAt });
  if (!channel) throw new Error('Failed to save channel');

  const [existing] = await db
    .select({ channelId: trackedChannels.channelId })
    .from(trackedChannels)
    .where(and(eq(trackedChannels.userId, userId), eq(trackedChannels.channelId, channel.id)))
    .limit(1);
  if (existing) return { channelId: channel.id, alreadyTracked: true };

  if (tracked >= limit) {
    throw new AppError(403, 'channel_limit', `You can track up to ${limit} channels. Remove one to add another.`);
  }
  await db.insert(trackedChannels).values({ userId, channelId: channel.id }).onConflictDoNothing();

  // First check happens straight away so the feed is not empty. A failure here
  // is recorded on the channel and retried by the scheduler.
  if (!channel.lastCheckedAt) await refreshChannel(channel.id, { known: info, knownVideos: found.videos }).catch(() => undefined);
  return { channelId: channel.id, alreadyTracked: false };
}

export async function removeChannel(userId: string, channelId: string): Promise<void> {
  const db = await getDb();
  const removed = await db
    .delete(trackedChannels)
    .where(and(eq(trackedChannels.userId, userId), eq(trackedChannels.channelId, channelId)))
    .returning({ channelId: trackedChannels.channelId });
  if (removed.length === 0) throw notFound();
  // Nobody tracking it any more: drop the channel and, by cascade, its videos and history.
  const [still] = await db.select({ n: sql<number>`count(*)::int` }).from(trackedChannels).where(eq(trackedChannels.channelId, channelId));
  if ((still?.n ?? 0) === 0) await db.delete(channels).where(eq(channels.id, channelId));
}

export async function assertTracks(userId: string, channelId: string): Promise<void> {
  const db = await getDb();
  const [row] = await db
    .select({ channelId: trackedChannels.channelId })
    .from(trackedChannels)
    .where(and(eq(trackedChannels.userId, userId), eq(trackedChannels.channelId, channelId)))
    .limit(1);
  if (!row) throw notFound();
}

/** A manual re-check requested by someone who tracks the channel. */
export async function refreshChannelNow(userId: string, channelId: string): Promise<void> {
  await assertTracks(userId, channelId);
  const db = await getDb();
  const [channel] = await db.select({ monitored: channels.monitored }).from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel?.monitored) {
    throw new AppError(400, 'not_monitored', 'TikTok accounts cannot be checked as a whole. Update a video\'s numbers from its own page.');
  }
  const claimed = await refreshChannel(channelId, { minMinutesSinceLast: MANUAL_REFRESH_MINUTES, rethrow: true });
  if (!claimed) {
    throw new AppError(429, 'checked_recently', `This channel was checked in the last ${MANUAL_REFRESH_MINUTES} minutes. Try again later.`, {
      retryAfterSeconds: MANUAL_REFRESH_MINUTES * 60,
    });
  }
}

/**
 * Fetches a channel's current numbers and recent uploads, records a snapshot
 * of each, and recomputes baselines, outlier multiples and momentum.
 * Returns false if another check of this channel ran too recently.
 */
export async function refreshChannel(
  channelId: string,
  opts: { minMinutesSinceLast?: number; known?: ChannelInfo; knownVideos?: VideoInfo[]; rethrow?: boolean } = {},
): Promise<boolean> {
  const db = await getDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - (opts.minMinutesSinceLast ?? 0) * 60_000);

  // Claim the channel so two servers (or a timer and a click) never check it at once.
  const [claimed] = await db
    .update(channels)
    .set({ lastCheckedAt: now })
    .where(and(eq(channels.id, channelId), eq(channels.monitored, true), or(isNull(channels.lastCheckedAt), lt(channels.lastCheckedAt, cutoff))))
    .returning({ externalId: channels.externalId, platform: channels.platform });
  if (!claimed) return false;

  try {
    // Read this before fetching so the platform client can decide whether the
    // channel needs a full-history backfill or only a recent-video refresh.
    const known = await db.select({ id: videos.id, externalId: videos.externalId, viewsPerHour: videos.viewsPerHour }).from(videos).where(eq(videos.channelId, channelId));
    const snapshot =
      opts.known && opts.knownVideos
        ? { info: opts.known, videos: opts.knownVideos }
        : await fetchSnapshot(claimed.platform as MonitoredPlatform, claimed.externalId, opts.known, known.length);
    if (!snapshot) throw new AppError(404, 'channel_not_found', 'This channel no longer exists on its platform.');
    const { info } = snapshot;

    await db.update(channels).set({ ...channelColumns(info), lastError: null }).where(eq(channels.id, channelId));
    await db.insert(channelSnapshots).values({
      channelId,
      takenAt: now,
      subscriberCount: info.subscriberCount,
      viewCount: info.viewCount,
      videoCount: info.videoCount,
    });

    const fetched = snapshot.videos;

    // Previous snapshot of each video, read before the new ones are written.
    const knownByExternal = new Map(known.map((k) => [k.externalId, k]));
    const previous =
      known.length === 0
        ? []
        : await db
            .selectDistinctOn([videoSnapshots.videoId], { videoId: videoSnapshots.videoId, viewCount: videoSnapshots.viewCount, takenAt: videoSnapshots.takenAt })
            .from(videoSnapshots)
            .where(inArray(videoSnapshots.videoId, known.map((k) => k.id)))
            .orderBy(videoSnapshots.videoId, desc(videoSnapshots.takenAt));
    const previousByVideo = new Map(previous.map((p) => [p.videoId, p]));

    for (const v of fetched) {
      const existing = knownByExternal.get(v.externalId);
      const rate = existing ? viewsPerHour(previousByVideo.get(existing.id), v.viewCount, now) : null;
      // Keep the last known rate when this check came too soon after the previous one to measure a new one.
      await upsertVideo(channelId, v, now, rate ?? existing?.viewsPerHour ?? null);
    }

    await recomputeBaselines(channelId, now);

    const old = new Date(now.getTime() - SNAPSHOT_RETENTION_DAYS * 86_400_000);
    await db.delete(channelSnapshots).where(and(eq(channelSnapshots.channelId, channelId), lt(channelSnapshots.takenAt, old)));
    await db.delete(videoSnapshots).where(
      and(lt(videoSnapshots.takenAt, old), inArray(videoSnapshots.videoId, db.select({ id: videos.id }).from(videos).where(eq(videos.channelId, channelId)))),
    );
    return true;
  } catch (err) {
    const message = err instanceof AppError ? err.message : 'The last check failed unexpectedly.';
    await db.update(channels).set({ lastError: message }).where(eq(channels.id, channelId));
    if (!(err instanceof AppError)) console.error(`[tracking] check of channel ${channelId} failed`, err);
    if (opts.rethrow) throw err;
    return true;
  }
}

type VideoRow = Omit<VideoInfo, 'channelExternalId'> & { sourceUrl?: string | null; isShort?: boolean };

/** Writes a video's current numbers and a snapshot of them. Returns the video's id. */
async function upsertVideo(channelId: string, v: VideoRow, now: Date, rate: number | null): Promise<string> {
  const db = await getDb();
  const columns = {
    title: v.title,
    description: v.description,
    publishedAt: v.publishedAt,
    durationSeconds: v.durationSeconds,
    isShort: v.isShort ?? (v.durationSeconds !== null && v.durationSeconds > 0 && v.durationSeconds <= SHORT_MAX_SECONDS),
    thumbnailUrl: v.thumbnailUrl,
    viewCount: v.viewCount,
    likeCount: v.likeCount,
    commentCount: v.commentCount,
    viewsPerHour: rate,
    lastCheckedAt: now,
    ...(v.sourceUrl ? { sourceUrl: v.sourceUrl } : {}),
  };
  const [row] = await db
    .insert(videos)
    .values({ channelId, externalId: v.externalId, ...columns })
    .onConflictDoUpdate({ target: [videos.channelId, videos.externalId], set: columns })
    .returning({ id: videos.id });
  if (!row) throw new Error('Failed to save video');
  await db.insert(videoSnapshots).values({ videoId: row.id, takenAt: now, viewCount: v.viewCount, likeCount: v.likeCount, commentCount: v.commentCount });
  return row.id;
}

async function recomputeBaselines(channelId: string, now: Date): Promise<void> {
  const db = await getDb();
  const recent = await db
    .select({ id: videos.id, viewCount: videos.viewCount, publishedAt: videos.publishedAt, isShort: videos.isShort })
    .from(videos)
    .where(eq(videos.channelId, channelId))
    .orderBy(desc(videos.publishedAt))
    .limit(50);

  const [channel] = await db.select({ monitored: channels.monitored }).from(channels).where(eq(channels.id, channelId)).limit(1);
  // For authors known only from pasted links, a "normal" needs at least five videos to mean anything.
  const enough = (list: typeof recent) => channel?.monitored || list.length >= MIN_VIDEOS_FOR_BASELINE;
  const shorts = recent.filter((v) => v.isShort);
  const longs = recent.filter((v) => !v.isShort);
  const shortBase = enough(shorts) ? baselineViews(shorts, now) : null;
  const longBase = enough(longs) ? baselineViews(longs, now) : null;
  await db.update(channels).set({ medianShortViews: shortBase, medianLongViews: longBase }).where(eq(channels.id, channelId));
  for (const v of recent) {
    await db
      .update(videos)
      .set({ outlierMultiple: outlierMultiple(v.viewCount, v.isShort ? shortBase : longBase) })
      .where(eq(videos.id, v.id));
  }
}

/**
 * Checks every tracked channel that is due. Called by the built-in scheduler
 * and by POST /api/cron/refresh. Stops early if the YouTube quota runs out.
 */
export async function refreshDue(max = 20): Promise<{ checked: number; stoppedEarly: boolean }> {
  const db = await getDb();
  const intervalMinutes = env().TRACK_INTERVAL_HOURS * 60;
  const cutoff = new Date(Date.now() - intervalMinutes * 60_000);
  const configured = MONITORED_PLATFORMS.filter(platformConfigured);
  if (configured.length === 0) return { checked: 0, stoppedEarly: false };
  const due = await db
    .selectDistinct({ id: channels.id, platform: channels.platform, lastCheckedAt: channels.lastCheckedAt })
    .from(channels)
    .innerJoin(trackedChannels, eq(trackedChannels.channelId, channels.id))
    .where(
      and(
        eq(channels.monitored, true),
        inArray(channels.platform, configured),
        or(isNull(channels.lastCheckedAt), lt(channels.lastCheckedAt, cutoff)),
      ),
    )
    .orderBy(sql`${channels.lastCheckedAt} asc nulls first`, asc(channels.id))
    .limit(max);

  // A platform that runs out of quota or rejects its credentials is skipped for the rest of this run.
  let checked = 0;
  const halted = new Set<string>();
  for (const channel of due) {
    if (halted.has(channel.platform)) continue;
    try {
      if (await refreshChannel(channel.id, { minMinutesSinceLast: intervalMinutes, rethrow: true })) checked++;
    } catch (err) {
      checked++;
      if (err instanceof AppError && (err.code === 'video_data_quota' || err.code === 'video_data_not_configured' || err.code === 'apify_budget')) {
        halted.add(channel.platform);
      }
    }
  }
  return { checked, stoppedEarly: halted.size > 0 };
}

/**
 * Adds one video from its link and returns its id.
 * YouTube: tracks the video's channel through the official API (free).
 * TikTok and Instagram: reads that single video through Apify; the author
 * is saved so the video has a home, but the account is not monitored.
 */
export async function addVideoByLink(userId: string, input: string): Promise<{ videoId: string; platform: string }> {
  const link = parseVideoLink(input);
  if (!link.ok) throw new AppError(400, 'invalid_link', link.reason);
  const db = await getDb();
  const now = new Date();

  if (link.platform === 'youtube') {
    const parsed = parseYouTubeInput(link.url);
    if (!parsed.ok || parsed.ref.kind !== 'video') throw new AppError(400, 'invalid_link', 'Paste a link to one video.');
    const { channelId } = await addChannel(userId, link.url);
    const find = () => db.select({ id: videos.id }).from(videos).where(and(eq(videos.channelId, channelId), eq(videos.externalId, parsed.ref.kind === 'video' ? parsed.ref.videoId : ''))).limit(1);
    let [video] = await find();
    if (!video) {
      // Older than the channel's 50 most recent uploads: fetch it on its own.
      const [info] = await fetchVideos([parsed.ref.videoId]);
      if (!info) throw new AppError(404, 'video_not_found', 'YouTube has no video at that link.');
      await upsertVideo(channelId, info, now, null);
      await recomputeBaselines(channelId, now);
      [video] = await find();
    }
    if (!video) throw new AppError(404, 'video_not_found', 'YouTube has no video at that link.');
    return { videoId: video.id, platform: 'youtube' };
  }

  const meta = await fetchVideoMetadata(link.url);
  if (meta.platform !== link.platform) throw new AppError(400, 'invalid_link', 'That link is not a video the transcript service can read.');
  const author = { title: meta.author.displayName, handle: `@${meta.author.username}`, thumbnailUrl: meta.author.avatarUrl };
  const [channel] = await db
    .insert(channels)
    .values({ platform: meta.platform, externalId: meta.author.username.toLowerCase(), monitored: false, lastCheckedAt: now, ...author })
    .onConflictDoUpdate({ target: [channels.platform, channels.externalId], set: author })
    .returning({ id: channels.id });
  if (!channel) throw new Error('Failed to save author');
  await db.insert(trackedChannels).values({ userId, channelId: channel.id }).onConflictDoNothing();

  const videoId = await upsertVideo(
    channel.id,
    {
      externalId: meta.id,
      title: meta.title,
      description: meta.description,
      publishedAt: meta.createdAt ?? now,
      durationSeconds: meta.durationSeconds,
      // TikTok and Instagram video is short-form by nature, even when a duration is missing.
      isShort: true,
      thumbnailUrl: meta.thumbnailUrl,
      viewCount: meta.views,
      likeCount: meta.likes,
      commentCount: meta.comments,
      sourceUrl: meta.url,
    },
    now,
    null,
  );
  await recomputeBaselines(channel.id, now);
  return { videoId, platform: meta.platform };
}

/** Re-reads one TikTok or Instagram video's numbers. YouTube videos are updated with their channel. */
export async function refreshVideoNow(userId: string, videoId: string): Promise<void> {
  const db = await getDb();
  const [video] = await db
    .select({ id: videos.id, channelId: videos.channelId, externalId: videos.externalId, sourceUrl: videos.sourceUrl, lastCheckedAt: videos.lastCheckedAt, monitored: channels.monitored, publishedAt: videos.publishedAt })
    .from(videos)
    .innerJoin(channels, eq(channels.id, videos.channelId))
    .innerJoin(trackedChannels, and(eq(trackedChannels.channelId, channels.id), eq(trackedChannels.userId, userId)))
    .where(eq(videos.id, videoId))
    .limit(1);
  if (!video) throw notFound();
  if (video.monitored) return refreshChannelNow(userId, video.channelId);
  if (!video.sourceUrl) throw notFound();

  const now = new Date();
  // Claim first, so two clicks cannot both spend a request.
  const cutoff = new Date(now.getTime() - MANUAL_REFRESH_MINUTES * 60_000);
  const [claimed] = await db.update(videos).set({ lastCheckedAt: now }).where(and(eq(videos.id, videoId), lt(videos.lastCheckedAt, cutoff))).returning({ id: videos.id });
  if (!claimed) {
    throw new AppError(429, 'checked_recently', `These numbers were updated in the last ${MANUAL_REFRESH_MINUTES} minutes. Try again later.`, { retryAfterSeconds: MANUAL_REFRESH_MINUTES * 60 });
  }
  const [previous] = await db
    .select({ viewCount: videoSnapshots.viewCount, takenAt: videoSnapshots.takenAt })
    .from(videoSnapshots)
    .where(eq(videoSnapshots.videoId, videoId))
    .orderBy(desc(videoSnapshots.takenAt))
    .limit(1);
  const meta = await fetchVideoMetadata(video.sourceUrl);
  await upsertVideo(
    video.channelId,
    {
      externalId: video.externalId,
      title: meta.title,
      description: meta.description,
      publishedAt: meta.createdAt ?? video.publishedAt,
      durationSeconds: meta.durationSeconds,
      isShort: true,
      thumbnailUrl: meta.thumbnailUrl,
      viewCount: meta.views,
      likeCount: meta.likes,
      commentCount: meta.comments,
    },
    now,
    viewsPerHour(previous, meta.views, now),
  );
  await recomputeBaselines(video.channelId, now);
}

/**
 * The spoken words of a tracked video. Fetched from the transcript service the
 * first time and stored on the video, so analysing it again (by anyone who
 * tracks it) costs no further request.
 */
/**
 * The video's spoken words, fetched once and then reused by everyone who tracks
 * it. YouTube uses its captions; TikTok and Instagram are transcribed from their
 * audio, which is recorded as the requesting user's AI usage.
 */
export async function ensureTranscript(
  video: { id: string; externalId: string; isShort: boolean; platform: string; sourceUrl: string | null; durationSeconds: number | null; transcript: string | null; title?: string },
  userId: string,
): Promise<string> {
  if (video.transcript) return video.transcript;
  const url = video.sourceUrl ?? (video.platform === 'youtube' ? youtubeVideoUrl(video.externalId, video.isShort) : null);
  if (!url) throw notFound();
  const fetched = video.platform === 'youtube' ? await fetchTranscript(url) : await transcribeMedia(userId, await fetchMediaSource(url), video.title);
  const db = await getDb();
  await db.update(videos).set({ transcript: fetched.text.slice(0, 60_000), transcriptLang: fetched.lang }).where(eq(videos.id, video.id));
  return fetched.text;
}

export async function setOwnChannel(userId: string, channelId: string, isOwn: boolean): Promise<void> {
  const db = await getDb();
  const updated = await db
    .update(trackedChannels)
    .set({ isOwn })
    .where(and(eq(trackedChannels.userId, userId), eq(trackedChannels.channelId, channelId)))
    .returning({ channelId: trackedChannels.channelId });
  if (updated.length === 0) throw notFound();
}
