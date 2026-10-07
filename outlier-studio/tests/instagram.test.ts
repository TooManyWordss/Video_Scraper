import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { GET as listChannelsRoute, POST as addChannelRoute } from '@/app/api/channels/route';
import { GET as videosRoute, POST as addVideoRoute } from '@/app/api/videos/route';
import { POST as analyzeRoute } from '@/app/api/ai/analyze/route';
import { getDb } from '@/server/db/client';
import { channels } from '@/server/db/schema';
import { refreshDue } from '@/server/video/tracking';
import { parseChannelInput } from '@/shared/channel-url';
import { call, newUser, useTestApp } from './support/app';
import { APIFY_TOKEN, FakeApify } from './support/fake-apify';

const groq = useTestApp();
const apify = new FakeApify();

beforeAll(async () => {
  process.env.APIFY_BASE_URL = await apify.start();
});
beforeEach(() => {
  apify.reset();
  process.env.APIFY_TOKEN = APIFY_TOKEN;
  process.env.YOUTUBE_API_KEY = '';
  delete process.env.TRACK_INTERVAL_HOURS;
});
afterAll(() => apify.stop());

const add = (cookie: string, url: string) => call(addChannelRoute, 'POST', '/api/channels', { cookie, body: { url } });
const oneClick = (cookie: string, videoId: string) => call(analyzeRoute, 'POST', '/api/ai/analyze', { cookie, body: { videoId } });
const feed = async (cookie: string) => (await call(videosRoute, 'GET', '/api/videos?type=all&days=all', { cookie })).json();

function seedAccount(username = 'trailnotes') {
  apify.accounts.set(username, [
    { platform: 'instagram', id: 'CxYz123abcd', username, displayName: 'Trail Notes', title: 'The downhill mistake that wrecks your knees\nmore', views: 250000, likes: 9000, comments: 310, duration: 42, createdAt: new Date(Date.now() - 3600_000).toISOString() },
    { platform: 'instagram', id: 'CxYz999zzzz', username, displayName: 'Trail Notes', title: 'Older reel', views: 1200, likes: 40, comments: 2, duration: 20, createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString() },
  ]);
}

describe('Instagram profile links', () => {
  it('recognises profiles and refuses reels', () => {
    const ok = parseChannelInput('https://www.instagram.com/TrailNotes/');
    expect(ok).toEqual({ ok: true, channel: { platform: 'instagram', username: 'trailnotes' } });
    expect(parseChannelInput('instagram.com/trailnotes')).toMatchObject({ ok: true });
    expect(parseChannelInput('https://www.instagram.com/reel/CxYz123abcd/')).toMatchObject({ ok: false });
    expect(parseChannelInput('https://www.instagram.com/p/CxYz123abcd/')).toMatchObject({ ok: false });
  });

  it('tracks an account with its reels, ranked by views, and marks it monitored', async () => {
    seedAccount();
    const { cookie } = await newUser();
    const res = await add(cookie, 'https://www.instagram.com/trailnotes/');
    expect(res.status).toBe(201);

    const [channel] = (await (await call(listChannelsRoute, 'GET', '/api/channels', { cookie })).json()).items;
    expect(channel).toMatchObject({ platform: 'instagram', monitored: true, externalId: 'trailnotes', title: 'Trail Notes', handle: '@trailnotes', thumbnailUrl: 'https://cdn.example/trailnotes.jpg', lastError: null });

    const all = await feed(cookie);
    expect(all.items.map((v: { title: string }) => v.title)).toEqual(['The downhill mistake that wrecks your knees', 'Older reel']);
    expect(all.items[0]).toMatchObject({ platform: 'instagram', viewCount: 250000, likeCount: 9000, commentCount: 310, isShort: true, sourceUrl: 'https://www.instagram.com/reel/CxYz123abcd/' });
    expect(apify.calls.at(-1)).toMatchObject({ actor: 'apify~instagram-reel-scraper', input: { username: ['trailnotes'] } });
  });

  it('turns an account added earlier by a single reel link into a monitored one', async () => {
    seedAccount();
    const { cookie } = await newUser();
    apify.posts.set('https://www.instagram.com/reel/CxYz123abcd/', apify.accounts.get('trailnotes')![0]!);
    await call(addVideoRoute, 'POST', '/api/videos', { cookie, body: { url: 'https://www.instagram.com/reel/CxYz123abcd/' } });
    const before = (await (await call(listChannelsRoute, 'GET', '/api/channels', { cookie })).json()).items[0];
    expect(before.monitored).toBe(false);

    // Already on this user's watchlist, so the add reports that; the account itself is now monitored.
    expect((await add(cookie, 'instagram.com/trailnotes')).status).toBe(200);
    const after = (await (await call(listChannelsRoute, 'GET', '/api/channels', { cookie })).json()).items[0];
    expect(after.monitored).toBe(true);
  });

  it('accepts an Instagram /p/ video URL using the Actor current input schema', async () => {
    const url = 'https://www.instagram.com/p/Dbh2LTOxiJm/';
    const post = { platform: 'instagram' as const, id: 'Dbh2LTOxiJm', username: 'trailnotes', displayName: 'Trail Notes', title: 'Video uploaded from Instagram', views: 1200, likes: 80, comments: 4, duration: 31 };
    apify.posts.set(url, post);
    apify.media.set(post.id, Buffer.from('fake reel audio'));
    const { cookie } = await newUser();
    const added = await call(addVideoRoute, 'POST', '/api/videos', { cookie, body: { url } });
    expect(added.status).toBe(201);
    expect(apify.calls.at(-1)?.input).toMatchObject({ username: [url], resultsLimit: 1 });
    expect(apify.calls.at(-1)?.cap).toBe('0.007300');
    const { videoId } = await added.json();
    groq.enqueue({ kind: 'transcription', text: 'This is a complete spoken transcript from an Instagram video with enough words to analyze safely.' });
    groq.enqueue({ kind: 'json', content: JSON.stringify({ summary: 'Summary', hook: { text: 'This is a complete spoken transcript', pattern: 'Direct', whyItWorks: 'Clear' }, format: 'Explainer', structure: [], storytellingTactics: [], topics: [], takeaways: [], remixIdeas: [] }) });
    expect((await oneClick(cookie, videoId)).status).toBe(201);
    // The transcript comes from the reel's own audio, not the Actor's paid transcript add-on.
    expect(apify.calls.at(-1)?.input).toEqual({ username: [url], resultsLimit: 1 });
    expect(groq.calls[0]!.path).toBe('/openai/v1/audio/transcriptions');
  });

  it('says so when the account does not exist', async () => {
    const { cookie } = await newUser();
    const res = await add(cookie, 'https://www.instagram.com/nobodyhere/');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('channel_not_found');
  });

  it('refuses to add an account until the Apify token is set', async () => {
    seedAccount();
    delete process.env.APIFY_TOKEN;
    const { cookie } = await newUser();
    const res = await add(cookie, 'instagram.com/trailnotes');
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('video_data_not_configured');
  });

  it('is re-checked on the schedule, and a new reel appears on the next check', async () => {
    seedAccount();
    const { cookie } = await newUser();
    await add(cookie, 'instagram.com/trailnotes');
    const db = await getDb();
    await db.update(channels).set({ lastCheckedAt: sql`now() - interval '30 hours'` });

    seedAccount();
    apify.accounts.get('trailnotes')!.unshift({ platform: 'instagram', id: 'NEWREEL0001', username: 'trailnotes', displayName: 'Trail Notes', title: 'Brand new reel', views: 10, duration: 15 });
    expect(await refreshDue()).toEqual({ checked: 1, stoppedEarly: false });
    expect((await feed(cookie)).items.map((v: { title: string }) => v.title)).toContain('Brand new reel');
  });
});
