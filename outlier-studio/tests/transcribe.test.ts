import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as analyze } from '@/app/api/ai/analyze/route';
import { GET as videoRoute } from '@/app/api/videos/[id]/route';
import { POST as addVideoRoute } from '@/app/api/videos/route';
import { GET as listGenerations } from '@/app/api/generations/route';
import { call, newUser, requestRows, useTestApp } from './support/app';
import { APIFY_TOKEN, FakeApify } from './support/fake-apify';

const groq = useTestApp();
const apify = new FakeApify();

beforeAll(async () => {
  process.env.APIFY_BASE_URL = await apify.start();
});
beforeEach(() => {
  apify.reset();
  process.env.APIFY_TOKEN = APIFY_TOKEN;
  delete process.env.GROQ_AUDIO_MAX_MB;
  delete process.env.GROQ_MODEL_TRANSCRIBE;
});
afterAll(async () => {
  await apify.stop();
});

const TIKTOK = 'https://www.tiktok.com/@chefmaya/video/7301234567890123456';
const REEL = 'https://www.instagram.com/reel/CxYz123abcd/';
const SPOKEN = 'Stop rinsing your rice like this. Here is why it turns out gummy, and the one change that fixes it every time.';
const ANALYSIS = JSON.stringify({
  summary: 'A cook explains why rice turns gummy.', hook: { text: 'Stop rinsing your rice like this.', pattern: 'Contrarian', whyItWorks: 'Challenges a habit.' }, format: 'Myth buster',
  structure: [], techniques: [], topics: [], takeaways: [], remixIdeas: [], customFocus: [],
});

async function addVideo(cookie: string, url: string, platform: 'tiktok' | 'instagram', id: string) {
  apify.posts.set(url, { platform, id, username: 'chefmaya', displayName: 'Chef Maya', title: 'Stop rinsing your rice like this', views: 480000 });
  const res = await call(addVideoRoute, 'POST', '/api/videos', { cookie, body: { url } });
  expect(res.status).toBe(201);
  return (await res.json()).videoId as string;
}
const oneClick = (cookie: string, videoId: string) => call(analyze, 'POST', '/api/ai/analyze', { cookie, body: { videoId } });

describe('TikTok and Instagram transcripts from audio', () => {
  it('downloads a TikTok video through Apify storage, transcribes it with Whisper and reuses the result', async () => {
    const { cookie, user } = await newUser();
    const videoId = await addVideo(cookie, TIKTOK, 'tiktok', '7301234567890123456');
    apify.media.set('7301234567890123456', Buffer.alloc(4096, 1));

    groq.enqueue({ kind: 'transcription', text: SPOKEN, duration: 42 }, { kind: 'json', content: ANALYSIS });
    const res = await oneClick(cookie, videoId);
    expect(res.status).toBe(201);
    expect((await res.json()).generation.input.transcript).toBe(SPOKEN);

    // The TikTok Actor was asked for the video file, and its cap covers the download add-on.
    const run = apify.calls.at(-1)!;
    expect(run.input).toMatchObject({ postURLs: [TIKTOK], shouldDownloadVideos: true });
    expect(Number(run.cap)).toBeCloseTo(0.001 + 0.0037 + 0.0013, 6);
    // Files in Apify storage need the token; it is sent only there.
    expect(apify.mediaRequests).toEqual([{ path: '/v2/key-value-stores/videos/records/7301234567890123456.mp4', withToken: true }]);

    const audio = groq.calls[0]!;
    expect(audio.path).toBe('/openai/v1/audio/transcriptions');
    expect(audio.body).toMatchObject({ model: 'whisper-large-v3', response_format: 'verbose_json', temperature: '0', prompt: 'Stop rinsing your rice like this', fileBytes: 4096 });

    // Priced by audio length: 42 seconds at $0.111 an hour.
    const rows = await requestRows(user.id);
    expect(rows[0]).toMatchObject({ feature: 'transcribe', model: 'whisper-large-v3', status: 'succeeded', inputTokens: null });
    expect(Number(rows[0]!.estimatedCostUsd)).toBeCloseTo((42 / 3600) * 0.111, 8);

    // Stored on the video, so the next analysis needs no download and no transcription.
    const detail = await (await call(videoRoute, 'GET', `/api/videos/${videoId}`, { cookie, params: { id: videoId } })).json();
    expect(detail.video.transcript).toBe(SPOKEN);
    const runs = apify.calls.length;
    groq.enqueue({ kind: 'json', content: ANALYSIS });
    expect((await oneClick(cookie, videoId)).status).toBe(201);
    expect(apify.calls).toHaveLength(runs);
    expect(groq.calls.filter((c) => c.path.includes('audio'))).toHaveLength(1);
  });

  it('transcribes an Instagram reel from its audio link without sending the Apify token to the CDN', async () => {
    const { cookie } = await newUser();
    const videoId = await addVideo(cookie, REEL, 'instagram', 'CxYz123abcd');
    apify.media.set('CxYz123abcd', Buffer.alloc(2048, 2));

    groq.enqueue({ kind: 'transcription', text: SPOKEN }, { kind: 'json', content: ANALYSIS });
    expect((await oneClick(cookie, videoId)).status).toBe(201);
    expect(apify.calls.at(-1)!.input).toEqual({ username: [REEL], resultsLimit: 1 });
    expect(apify.mediaRequests).toEqual([{ path: '/cdn/CxYz123abcd.m4a', withToken: false }]);
    expect(groq.calls[0]!.body.fileBytes).toBe(2048);
  });

  it('drops what Whisper hears in music or silence', async () => {
    const { cookie } = await newUser();
    const videoId = await addVideo(cookie, REEL, 'instagram', 'CxYz123abcd');
    apify.media.set('CxYz123abcd', Buffer.alloc(100));
    groq.enqueue(
      {
        kind: 'transcription',
        text: 'Thank you for watching. Stop rinsing your rice like this, it turns out gummy every single time.',
        segments: [
          { text: 'Thank you for watching.', no_speech_prob: 0.92, avg_logprob: -1.4 },
          { text: 'Stop rinsing your rice like this, it turns out gummy every single time.', no_speech_prob: 0.02, avg_logprob: -0.15 },
        ],
      },
      { kind: 'json', content: ANALYSIS },
    );
    const res = await oneClick(cookie, videoId);
    expect(res.status).toBe(201);
    expect((await res.json()).generation.input.transcript).toBe('Stop rinsing your rice like this, it turns out gummy every single time.');
  });

  it('refuses audio over the size limit before calling Groq', async () => {
    process.env.GROQ_AUDIO_MAX_MB = '1';
    const { cookie, user } = await newUser();
    const videoId = await addVideo(cookie, TIKTOK, 'tiktok', '7301234567890123456');
    apify.media.set('7301234567890123456', Buffer.alloc(1024 * 1024 + 1));
    const res = await oneClick(cookie, videoId);
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('audio_too_large');
    expect(groq.calls).toHaveLength(0);
    expect(await requestRows(user.id)).toHaveLength(0);
  });

  it('says so when a video has no speech', async () => {
    const { cookie } = await newUser();
    const videoId = await addVideo(cookie, REEL, 'instagram', 'CxYz123abcd');
    apify.media.set('CxYz123abcd', Buffer.alloc(100));
    groq.enqueue({ kind: 'transcription', text: '', segments: [] });
    const res = await oneClick(cookie, videoId);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('transcript_unavailable');
    // Only the transcription was attempted; no analysis was run on nothing.
    expect(groq.calls).toHaveLength(1);
  });
});

describe('platform shown for saved outputs', () => {
  it('reports the platform of the video, of a pasted transcript, or none', async () => {
    const { cookie } = await newUser();
    const videoId = await addVideo(cookie, TIKTOK, 'tiktok', '7301234567890123456');
    groq.enqueue({ kind: 'json', content: ANALYSIS }, { kind: 'json', content: ANALYSIS }, { kind: 'json', content: ANALYSIS }, { kind: 'json', content: ANALYSIS });
    await call(analyze, 'POST', '/api/ai/analyze', { cookie, body: { videoId, transcript: SPOKEN } });
    await call(analyze, 'POST', '/api/ai/analyze', { cookie, body: { transcript: SPOKEN, title: 'Pasted reel', platform: 'instagram' } });
    await call(analyze, 'POST', '/api/ai/analyze', { cookie, body: { transcript: SPOKEN, title: 'Pasted short', platform: 'youtube_shorts' } });
    await call(analyze, 'POST', '/api/ai/analyze', { cookie, body: { transcript: SPOKEN, title: 'Unknown' } });

    const { items } = await (await call(listGenerations, 'GET', '/api/generations', { cookie })).json();
    const byTitle = Object.fromEntries(items.map((i: { title: string; platform: string | null }) => [i.title, i.platform]));
    expect(byTitle).toEqual({ 'Stop rinsing your rice like this': 'tiktok', 'Pasted reel': 'instagram', 'Pasted short': 'youtube', Unknown: null });
  });
});
