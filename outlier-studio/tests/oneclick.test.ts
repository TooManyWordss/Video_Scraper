import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { POST as addChannelRoute, GET as listChannelsRoute } from '@/app/api/channels/route';
import { PUT as setOwnRoute } from '@/app/api/channels/[id]/route';
import { POST as refreshChannelRoute } from '@/app/api/channels/[id]/refresh/route';
import { GET as videosRoute, POST as addVideoRoute } from '@/app/api/videos/route';
import { GET as videoRoute } from '@/app/api/videos/[id]/route';
import { POST as refreshVideoRoute } from '@/app/api/videos/[id]/refresh/route';
import { GET as hookLibraryRoute } from '@/app/api/hook-library/route';
import { GET as getProfile, PUT as putProfile } from '@/app/api/profile/route';
import { POST as analyze } from '@/app/api/ai/analyze/route';
import { POST as hooks } from '@/app/api/ai/hooks/route';
import { POST as script } from '@/app/api/ai/script/route';
import { POST as report } from '@/app/api/ai/report/route';
import { GET as listGenerations } from '@/app/api/generations/route';
import { getDb } from '@/server/db/client';
import { channels, videos, videoSnapshots } from '@/server/db/schema';
import { refreshDue } from '@/server/video/tracking';
import { parseVideoLink } from '@/shared/video-url';
import { TRANSCRIPT, call, newUser, readSse, requestRows, useTestApp } from './support/app';
import { APIFY_TOKEN, FakeApify } from './support/fake-apify';
import { FakeYouTube, sampleChannel } from './support/fake-youtube';

const groq = useTestApp();
const youtube = new FakeYouTube();
const apify = new FakeApify();

beforeAll(async () => {
  process.env.YOUTUBE_API_BASE_URL = await youtube.start();
  process.env.APIFY_BASE_URL = await apify.start();
});
beforeEach(() => {
  youtube.reset();
  apify.reset();
  process.env.YOUTUBE_API_KEY = 'yt_test_key';
  process.env.APIFY_TOKEN = APIFY_TOKEN;
});
afterAll(async () => {
  await youtube.stop();
  await apify.stop();
});

const ANALYSIS = JSON.stringify({
  summary: 'A runner argues against stretching.', hook: { text: 'Stretching is slowing you down.', pattern: 'Contrarian', whyItWorks: 'Challenges a habit.' }, format: 'Myth buster',
  structure: [], storytellingTactics: [], topics: [], takeaways: [], remixIdeas: [],
});
const REPORT = JSON.stringify({
  summary: 's', whatIsWorking: [{ pattern: 'Contrarian titles', evidence: 'Why stretching... at 15x' }], whatIsNot: ['Generic tips'],
  topics: [{ topic: 'Warm-ups', note: 'strong' }], titlePatterns: ['Why X slows you down'], recommendations: ['Lead with the myth'],
});
const HOOKS = JSON.stringify({ hooks: [{ text: 'Stop stretching.', pattern: 'contrarian', why: 'w' }] });
const TIKTOK = 'https://www.tiktok.com/@chefmaya/video/7301234567890123456';

async function trackSample(cookie: string) {
  youtube.add(sampleChannel());
  await call(addChannelRoute, 'POST', '/api/channels', { cookie, body: { url: '@runfaster' } });
  const feed = await (await call(videosRoute, 'GET', '/api/videos', { cookie })).json();
  return feed.items[0] as { id: string; title: string };
}
const oneClick = (cookie: string, videoId: string, extra: object = {}) => call(analyze, 'POST', '/api/ai/analyze', { cookie, body: { videoId, ...extra } });

describe('video link parsing', () => {
  it('accepts single videos on the three platforms and explains the rest', () => {
    expect(parseVideoLink(TIKTOK + '?is_from_webapp=1')).toEqual({ ok: true, platform: 'tiktok', url: TIKTOK });
    expect(parseVideoLink('https://vm.tiktok.com/ZMabc123/')).toMatchObject({ ok: true, platform: 'tiktok' });
    expect(parseVideoLink('https://www.instagram.com/reel/CxYz123_ab/?igsh=x')).toEqual({ ok: true, platform: 'instagram', url: 'https://www.instagram.com/reel/CxYz123_ab/' });
    expect(parseVideoLink('instagram.com/someone/reel/CxYz123')).toMatchObject({ ok: true, platform: 'instagram' });
    expect(parseVideoLink('https://youtu.be/dQw4w9WgXcQ')).toMatchObject({ ok: true, platform: 'youtube' });
    expect(parseVideoLink('https://www.tiktok.com/@chefmaya')).toMatchObject({ ok: false, reason: expect.stringMatching(/not a profile/) });
    expect(parseVideoLink('https://www.instagram.com/chefmaya/')).toMatchObject({ ok: false, reason: expect.stringMatching(/not a profile/) });
    expect(parseVideoLink('https://www.youtube.com/@runfaster')).toMatchObject({ ok: false, reason: expect.stringMatching(/channel link/) });
    expect(parseVideoLink('javascript:alert(1)')).toMatchObject({ ok: false });
    expect(parseVideoLink('https://tiktok.com.evil.example/@a/video/1')).toMatchObject({ ok: false });
  });
});

describe('one-click analysis', () => {
  it('fetches the transcript itself, analyses, and reuses the stored transcript next time', async () => {
    const { cookie, user } = await newUser();
    const video = await trackSample(cookie);
    apify.transcripts.set('https://www.youtube.com/shorts/a0000000050', TRANSCRIPT);
    groq.enqueue({ kind: 'json', content: ANALYSIS }, { kind: 'json', content: ANALYSIS });

    const res = await oneClick(cookie, video.id);
    expect(res.status).toBe(201);
    const { generation } = await res.json();
    expect(generation.input.transcript).toBe(TRANSCRIPT);
    expect(generation.output.outlierMultiple).toBe(15);
    expect(apify.calls).toHaveLength(1);
    expect(apify.calls[0]).toMatchObject({ actor: 'devsef~youtube-transcript-scraper', key: APIFY_TOKEN, input: { videoUrls: ['https://www.youtube.com/shorts/a0000000050'] } });
    expect(groq.calls[0]!.body.messages[1].content).toContain(TRANSCRIPT);

    const detail = await (await call(videoRoute, 'GET', `/api/videos/${video.id}`, { cookie, params: { id: video.id } })).json();
    expect(detail.video).toMatchObject({ hasTranscript: true, transcript: TRANSCRIPT, platform: 'youtube' });
    expect(detail.latestAnalysis.id).toBe(generation.id);
    expect(detail.transcriptsConfigured).toBe(true);

    expect((await oneClick(cookie, video.id)).status).toBe(201);
    expect(apify.calls).toHaveLength(1);
    expect(await requestRows(user.id)).toHaveLength(2);
    expect(JSON.stringify(detail)).not.toContain(APIFY_TOKEN);
  });

  it('says when there is no transcript, charges nothing, and accepts a pasted one instead', async () => {
    const { cookie, user } = await newUser();
    const video = await trackSample(cookie);
    const res = await oneClick(cookie, video.id);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('transcript_unavailable');
    expect(groq.calls).toHaveLength(0);
    expect(await requestRows(user.id)).toHaveLength(0);

    groq.enqueue({ kind: 'json', content: ANALYSIS });
    expect((await oneClick(cookie, video.id, { transcript: TRANSCRIPT })).status).toBe(201);
    // A pasted transcript is one user's text: it is not stored on the shared video.
    const detail = await (await call(videoRoute, 'GET', `/api/videos/${video.id}`, { cookie, params: { id: video.id } })).json();
    expect(detail.video.hasTranscript).toBe(false);
  });

  it('reports a missing key, a rejected key and a used-up allowance', async () => {
    const { cookie } = await newUser();
    const video = await trackSample(cookie);
    delete process.env.APIFY_TOKEN;
    const none = await oneClick(cookie, video.id);
    expect(none.status).toBe(503);
    expect((await none.json()).error.code).toBe('transcripts_not_configured');
    expect(apify.calls).toHaveLength(0);

    process.env.APIFY_TOKEN = APIFY_TOKEN;
    apify.failNext = { status: 401, message: 'unauthorized' };
    expect((await (await oneClick(cookie, video.id)).json()).error.code).toBe('transcripts_not_configured');
    apify.failNext = { status: 429, message: 'limit exceeded' };
    const quota = await oneClick(cookie, video.id);
    expect(quota.status).toBe(429);
    expect((await quota.json()).error.code).toBe('transcript_quota');
    expect(groq.calls).toHaveLength(0);
  });

  it("refuses another account's video before any request is spent", async () => {
    const alice = await newUser('alice@example.com');
    const bob = await newUser('bob@example.com');
    const video = await trackSample(alice.cookie);
    apify.defaultTranscript = TRANSCRIPT;
    expect((await oneClick(bob.cookie, video.id)).status).toBe(404);
    expect((await call(refreshVideoRoute, 'POST', `/api/videos/${video.id}/refresh`, { cookie: bob.cookie, params: { id: video.id } })).status).toBe(404);
    expect(apify.calls).toHaveLength(0);
    expect(groq.calls).toHaveLength(0);
  });
});

describe('adding a single video by link', () => {
  const post = { platform: 'tiktok' as const, id: '7301234567890123456', username: 'chefmaya', displayName: 'Chef Maya', title: 'Stop rinsing your rice like this', views: 480000, likes: 31000, comments: 900 };

  it('reads a TikTok video, files it under its author, and analyses it once a transcript is pasted in', async () => {
    const { cookie } = await newUser();
    apify.posts.set(TIKTOK, post);
    const added = await call(addVideoRoute, 'POST', '/api/videos', { cookie, body: { url: `${TIKTOK}?lang=en` } });
    expect(added.status).toBe(201);
    const { videoId, platform } = await added.json();
    expect(platform).toBe('tiktok');
    expect(youtube.calls).toHaveLength(0);

    const feed = await (await call(videosRoute, 'GET', '/api/videos?days=all', { cookie })).json();
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({ id: videoId, platform: 'tiktok', monitored: false, title: 'Stop rinsing your rice like this', viewCount: 480000, channelTitle: 'Chef Maya', channelHandle: '@chefmaya', outlierMultiple: null, sourceUrl: TIKTOK, isShort: true });
    expect((await (await call(videosRoute, 'GET', '/api/videos?days=all&platform=youtube', { cookie })).json()).items).toEqual([]);

    const list = await (await call(listChannelsRoute, 'GET', '/api/channels', { cookie })).json();
    expect(list.items[0]).toMatchObject({ platform: 'tiktok', monitored: false, title: 'Chef Maya' });
    expect(list.transcriptsConfigured).toBe(true);

    // When the video's audio cannot be fetched, the analysis falls back to a pasted transcript.
    const noTranscript = await oneClick(cookie, videoId);
    expect(noTranscript.status).toBe(422);
    expect((await noTranscript.json()).error.code).toBe('audio_unavailable');
    expect(groq.calls).toHaveLength(0);

    groq.enqueue({ kind: 'json', content: ANALYSIS });
    const res = await oneClick(cookie, videoId, { transcript: TRANSCRIPT });
    expect(res.status).toBe(201);
    expect(groq.calls[0]!.body.messages[1].content).toContain('Platform: tiktok');
    expect((await res.json()).generation.input.sourceUrl).toBe(TIKTOK);
  });

  it('never schedules checks for TikTok or Instagram authors, and updates their videos only on request', async () => {
    const { cookie } = await newUser();
    apify.posts.set(TIKTOK, post);
    const { videoId } = await (await call(addVideoRoute, 'POST', '/api/videos', { cookie, body: { url: TIKTOK } })).json();
    const db = await getDb();
    await db.update(channels).set({ lastCheckedAt: sql`now() - interval '30 days'` });
    expect(await refreshDue()).toEqual({ checked: 0, stoppedEarly: false });
    const channelId = (await (await call(listChannelsRoute, 'GET', '/api/channels', { cookie })).json()).items[0].id;
    const whole = await call(refreshChannelRoute, 'POST', `/api/channels/${channelId}/refresh`, { cookie, params: { id: channelId } });
    expect(whole.status).toBe(400);
    expect((await whole.json()).error.code).toBe('not_monitored');

    const soon = await call(refreshVideoRoute, 'POST', `/api/videos/${videoId}/refresh`, { cookie, params: { id: videoId } });
    expect(soon.status).toBe(429);
    await db.update(videos).set({ lastCheckedAt: sql`now() - interval '2 hours'` });
    await db.update(videoSnapshots).set({ takenAt: sql`now() - interval '2 hours'` });
    apify.posts.set(TIKTOK, { ...post, views: 500000 });
    const before = apify.calls.length;
    expect((await call(refreshVideoRoute, 'POST', `/api/videos/${videoId}/refresh`, { cookie, params: { id: videoId } })).status).toBe(200);
    expect(apify.calls.length).toBe(before + 1);
    const detail = await (await call(videoRoute, 'GET', `/api/videos/${videoId}`, { cookie, params: { id: videoId } })).json();
    expect(detail.video.viewCount).toBe(500000);
    expect(detail.video.viewsPerHour).toBeGreaterThan(9900);
    expect(detail.history).toHaveLength(2);
  });

  it('rejects profile links before spending a request, and reports missing videos', async () => {
    const { cookie } = await newUser();
    const profile = await call(addVideoRoute, 'POST', '/api/videos', { cookie, body: { url: 'https://www.instagram.com/chefmaya/' } });
    expect(profile.status).toBe(400);
    expect((await profile.json()).error.message).toMatch(/not a profile/);
    expect(apify.calls).toHaveLength(0);
    const missing = await call(addVideoRoute, 'POST', '/api/videos', { cookie, body: { url: TIKTOK } });
    expect(missing.status).toBe(404);
    expect((await call(addVideoRoute, 'POST', '/api/videos', { body: { url: TIKTOK } })).status).toBe(401);
  });

  it('adds a YouTube video through the free YouTube API and tracks its channel', async () => {
    const { cookie } = await newUser();
    youtube.add(sampleChannel());
    const res = await call(addVideoRoute, 'POST', '/api/videos', { cookie, body: { url: 'https://www.youtube.com/shorts/a0000000050' } });
    expect(res.status).toBe(201);
    const { videoId } = await res.json();
    expect(apify.calls).toHaveLength(0);
    const detail = await (await call(videoRoute, 'GET', `/api/videos/${videoId}`, { cookie, params: { id: videoId } })).json();
    expect(detail.video).toMatchObject({ title: 'Why stretching before a run slows you down', monitored: true, outlierMultiple: 15 });
    expect((await (await call(listChannelsRoute, 'GET', '/api/channels', { cookie })).json()).items).toHaveLength(1);
  });
});

describe('hook library, creator profile, drafts and reports', () => {
  it('collects the hooks from your breakdowns with their source video', async () => {
    const { cookie } = await newUser();
    const video = await trackSample(cookie);
    apify.defaultTranscript = TRANSCRIPT;
    groq.enqueue({ kind: 'json', content: ANALYSIS }, { kind: 'json', content: ANALYSIS });
    await oneClick(cookie, video.id);
    await call(analyze, 'POST', '/api/ai/analyze', { cookie, body: { transcript: TRANSCRIPT, title: 'Pasted one' } });
    const { items } = await (await call(hookLibraryRoute, 'GET', '/api/hook-library', { cookie })).json();
    expect(items).toHaveLength(2);
    expect(items.find((i: any) => i.video)).toMatchObject({ hook: { text: 'Stretching is slowing you down.', pattern: 'Contrarian' }, format: 'Myth buster', video: { id: video.id, outlierMultiple: 15, channelTitle: 'Run Faster', platform: 'youtube' } });
    expect(items.find((i: any) => !i.video).title).toBe('Pasted one');
    const other = await newUser('other@example.com');
    expect((await (await call(hookLibraryRoute, 'GET', '/api/hook-library', { cookie: other.cookie })).json()).items).toEqual([]);
  });

  it('applies the creator profile to hooks and scripts, and improves a pasted draft', async () => {
    const { cookie } = await newUser();
    expect((await (await call(getProfile, 'GET', '/api/profile', { cookie })).json()).persona).toBe('');
    const saved = await call(putProfile, 'PUT', '/api/profile', { cookie, body: { persona: '  I coach beginner runners over 40. Dry humour.  ' } });
    expect((await saved.json()).persona).toBe('I coach beginner runners over 40. Dry humour.');
    expect((await call(putProfile, 'PUT', '/api/profile', { cookie, body: { persona: 'x'.repeat(2000) } })).status).toBe(400);

    groq.enqueue({ kind: 'json', content: HOOKS });
    await call(hooks, 'POST', '/api/ai/hooks', { cookie, body: { topic: 'Warm ups for runners' } });
    expect(groq.calls[0]!.body.messages[1].content).toContain('<creator_profile>\nI coach beginner runners over 40. Dry humour.');

    const draft = 'So today I want to talk about stretching. Lots of people stretch before running. I think that is wrong and here is why.';
    groq.enqueue({ kind: 'stream', pieces: ['HOOK\n', 'Stop stretching.\n'] });
    const events = await readSse(await call(script, 'POST', '/api/ai/script', { cookie, body: { draft } }));
    expect(events.at(-1)!.event).toBe('done');
    const prompt = groq.calls[1]!.body.messages[1].content as string;
    expect(prompt).toContain('Improve the draft into a 45-second script');
    expect(prompt).toContain(`<draft>\n${draft}`);
    expect(prompt).toContain('<creator_profile>');
    expect(events.at(-1)!.data.generation.title).toBe(draft);

    const neither = await call(script, 'POST', '/api/ai/script', { cookie, body: { tone: 'dry' } });
    expect(neither.status).toBe(400);
    const other = await newUser('other@example.com');
    expect((await (await call(getProfile, 'GET', '/api/profile', { cookie: other.cookie })).json()).persona).toBe('');
  });

  it('writes a channel report from the tracked numbers and saves it', async () => {
    const { cookie, user } = await newUser();
    await trackSample(cookie);
    const channelId = (await (await call(listChannelsRoute, 'GET', '/api/channels', { cookie })).json()).items[0].id;
    groq.enqueue({ kind: 'json', content: REPORT });
    const res = await call(report, 'POST', '/api/ai/report', { cookie, body: { channelId } });
    expect(res.status).toBe(201);
    const { generation } = await res.json();
    expect(generation).toMatchObject({ kind: 'report', title: 'Report: Run Faster', channelId });
    expect(generation.output.facts).toMatchObject({ subscribers: 52000, typicalShortViews: 10000, videosConsidered: 11 });
    const prompt = groq.calls[0]!.body.messages[1].content as string;
    expect(prompt).toContain('"Why stretching before a run slows you down" | short 58s');
    expect(prompt).toContain('150000 views | 15x');
    expect(prompt).toContain('This is a competitor of the reader.');
    expect((await requestRows(user.id))[0]).toMatchObject({ feature: 'report', status: 'succeeded' });
    const listed = await (await call(listGenerations, 'GET', '/api/generations?kind=report', { cookie })).json();
    expect(listed.items).toHaveLength(1);

    const other = await newUser('other@example.com');
    expect((await call(report, 'POST', '/api/ai/report', { cookie: other.cookie, body: { channelId } })).status).toBe(404);
  });

  it('needs five videos for a report', async () => {
    const { cookie } = await newUser();
    apify.posts.set(TIKTOK, { platform: 'tiktok', id: '1', username: 'chefmaya', displayName: 'Chef Maya', title: 't', views: 5 });
    await call(addVideoRoute, 'POST', '/api/videos', { cookie, body: { url: TIKTOK } });
    const channelId = (await (await call(listChannelsRoute, 'GET', '/api/channels', { cookie })).json()).items[0].id;
    const res = await call(report, 'POST', '/api/ai/report', { cookie, body: { channelId } });
    expect(res.status).toBe(422);
    expect(groq.calls).toHaveLength(0);
  });

  it('separates your own channels from competitors in the feed', async () => {
    const { cookie } = await newUser();
    await trackSample(cookie);
    const channelId = (await (await call(listChannelsRoute, 'GET', '/api/channels', { cookie })).json()).items[0].id;
    expect((await call(setOwnRoute, 'PUT', `/api/channels/${channelId}`, { cookie, params: { id: channelId }, body: { isOwn: true } })).status).toBe(200);
    expect((await (await call(videosRoute, 'GET', '/api/videos', { cookie })).json()).items).toEqual([]);
    expect((await (await call(videosRoute, 'GET', '/api/videos?scope=mine', { cookie })).json()).items).toHaveLength(9);
    expect((await (await call(listChannelsRoute, 'GET', '/api/channels', { cookie })).json()).items[0].isOwn).toBe(true);
    const other = await newUser('other@example.com');
    expect((await call(setOwnRoute, 'PUT', `/api/channels/${channelId}`, { cookie: other.cookie, params: { id: channelId }, body: { isOwn: true } })).status).toBe(404);
  });
});
