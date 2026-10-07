/**
 * Runs the stand-in Groq server on a fixed port with canned answers, so the
 * interface can be exercised in a browser without network access:
 *
 *   npx tsx tests/support/serve-fake-groq.ts
 *   NODE_ENV=test GROQ_BASE_URL=http://127.0.0.1:4010 GROQ_API_KEY=test \
 *     YOUTUBE_API_BASE_URL=http://127.0.0.1:4011 YOUTUBE_API_KEY=test \
 *     APIFY_BASE_URL=http://127.0.0.1:4012 APIFY_TOKEN=apify_test_token npx next start
 *
 * It also serves a stand-in YouTube API on port 4011 with two made-up channels
 * (@runfaster and @kitchenshortcuts), and a stand-in Apify on port 4012
 * that knows one TikTok and one Instagram video (links printed at start-up).
 *
 * Test tooling only. The app ignores both base URLs unless NODE_ENV is "test".
 */
import http from 'node:http';
import { FakeGroq } from './fake-groq';
import { FakeApify } from './fake-apify';
import { FakeYouTube, sampleChannel } from './fake-youtube';

const SCRIPT = `HOOK
Stretching before your run is making you slower.

BODY
I know, your coach told you to do it.
But holding a stretch tells the muscle to relax.
And a relaxed muscle is a slow muscle.
So here is what I do instead.
Two minutes. Leg swings, high knees, ten easy strides.
You are warm, and your legs are still switched on.
Save the long stretches for after.

CALL TO ACTION
Try it on your next run and tell me how the first mile feels.`;

const HOOKS = {
  hooks: [
    { text: 'Stretching before your run is making you slower.', pattern: 'contrarian', why: 'It contradicts advice the viewer already follows.' },
    { text: 'Do this for two minutes before every run.', pattern: 'how_to', why: 'A small, specific promise is easy to stay for.' },
    { text: 'Why do the fastest runners skip the stretch?', pattern: 'question', why: 'It opens a loop the viewer wants closed.' },
    { text: 'I stopped stretching and my first mile changed.', pattern: 'story_open', why: 'A personal turn invites the viewer to hear what happened.' },
    { text: 'The warm-up mistake almost every new runner makes.', pattern: 'mistake_warning', why: 'Nobody wants to be the one making the mistake.' },
  ],
};

const ANALYSIS = {
  summary: 'A runner argues that static stretching before a run hurts performance and offers a short dynamic warm-up instead.',
  hook: { text: 'Most people stretch before they run and it is making them slower.', pattern: 'Contrarian', whyItWorks: 'It tells viewers a habit they trust is costing them something.' },
  format: 'Myth buster',
  structure: [
    { section: 'Hook', purpose: 'Stop the scroll with a claim that contradicts a habit.', summary: 'Stretching makes you slower.' },
    { section: 'Proof', purpose: 'Earn belief before giving advice.', summary: 'Points to what the research says.' },
    { section: 'Replacement', purpose: 'Pay off the hook with something to do.', summary: 'A two-minute warm-up.' },
  ],
  techniques: [
    { name: 'Overturn a trusted habit', kind: 'tactic', quote: 'Most people stretch before they run', effect: 'The viewer feels personally implicated and stays to find out if they are doing it wrong.' },
    { name: 'Borrowed authority', kind: 'tactic', quote: 'what the research actually says', effect: 'Makes the claim feel settled rather than one person’s opinion.' },
    { name: 'Open loop', kind: 'trick', quote: 'Here is what the research actually says', effect: 'Promises an answer, so leaving now means missing it.' },
    { name: 'Small, specific fix', kind: 'technique', quote: 'the two minute warm up', effect: 'A number makes the advice feel easy enough to try today.' },
    { name: 'Rhythmic list', kind: 'technique', quote: 'First, leg swings. Then high knees.', effect: 'Short parallel lines are easy to follow and remember.' },
  ],
  customFocus: [{ point: 'Hook score: 8 out of 10', detail: 'It contradicts a habit most viewers have, but it could name the cost more sharply, for example "slower by 5%".' }],
  topics: ['running', 'warm-ups'],
  takeaways: ['Lead with the habit you are about to overturn', 'Give the replacement a number'],
  remixIdeas: [
    { title: 'Stop meal prepping on Sunday', angle: 'Same myth-buster arc: the habit, why it backfires, the smaller fix.' },
    { title: 'Your morning routine is too long', angle: 'Overturn a popular routine and replace it with a two-minute version.' },
  ],
};

const REPORT = {
  summary: 'Run Faster posts short running advice several times a week. One contrarian video far outperformed the rest. Routine tips sit close to the channel normal.',
  whatIsWorking: [
    { pattern: 'Overturning a habit runners already have', evidence: '"Why stretching before a run slows you down" reached 15x the channel normal.' },
    { pattern: 'A specific promise in the title', evidence: 'Titles that name the outcome sit above 1x; numbered tips sit at or below it.' },
  ],
  whatIsNot: ['Numbered "Running tip" titles with no stated payoff stay between 0.8x and 1.2x.'],
  topics: [
    { topic: 'Warm-ups and injury myths', note: 'The clear winner.' },
    { topic: 'General tips', note: 'Steady but flat.' },
  ],
  titlePatterns: ['Why [common habit] [bad outcome]', 'Stop [doing the usual thing]'],
  recommendations: ['Open with the habit you are about to overturn.', 'Replace numbered titles with the payoff.', 'Follow the 15x video with a part two within a week.'],
};

const CHAT = 'The hook works because it tells runners a habit they trust is costing them speed. That creates a small threat, and the only way to resolve it is to keep watching.';
const ROLES = ['Hook', 'Promise', 'Step', 'Step', 'Step'];

/** Line-by-line notes for whatever numbered lines the long breakdown asks about. */
function lineNotes(prompt: string) {
  const block = /<annotate>\n([\s\S]*?)\n<\/annotate>/.exec(prompt)?.[1] ?? '';
  const numbers = [...block.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  return { lines: numbers.map((n) => ({ n, role: ROLES[n - 1] ?? 'Step', technique: n === 1 ? 'Contrarian claim' : n === 2 ? 'Open loop' : '', explanation: 'Moves the viewer one step closer to the payoff.' })) };
}

const groq = new FakeGroq();
groq.fallback = (body) => {
  if (String(body.model ?? '').startsWith('whisper')) return { kind: 'transcription', text: TRANSCRIPT, duration: 34 };
  const system = String(body.messages?.[0]?.content ?? '');
  if (body.stream) {
    const text = system.startsWith('You are the analyst') ? CHAT : SCRIPT;
    return { kind: 'stream', pieces: text.match(/[^ ]+ ?|\n+/g) ?? [text], delayMs: 25 };
  }
  const name = body.response_format?.json_schema?.name;
  if (system.startsWith('You explain short-form video scripts')) return { kind: 'json', content: JSON.stringify(lineNotes(String(body.messages.at(-1)?.content ?? ''))) };
  return { kind: 'json', content: JSON.stringify(name === 'hooks' ? HOOKS : name === 'channel_report' ? REPORT : ANALYSIS) };
};

const PORT = Number(process.env.FAKE_GROQ_PORT ?? 4010);
const server = (groq as unknown as { server: http.Server }).server;
server.listen(PORT, '127.0.0.1', () => console.log(`Stand-in Groq listening on http://127.0.0.1:${PORT}`));

// Picture stand-ins so screens are not full of broken images when offline.
const picture = (hue: number, label: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="hsl(${hue} 45% 32%)"/><text x="160" y="100" text-anchor="middle" font-family="sans-serif" font-size="28" fill="white">${label}</text></svg>`)}`;

const youtube = new FakeYouTube();
const run = sampleChannel();
const cook = sampleChannel('UCbbbbbbbbbbbbbbbbbbbbbb', '@kitchenshortcuts', 'b');
cook.title = 'Kitchen Shortcuts';
cook.subscribers = 181000;
cook.videos.forEach((v, i) => {
  v.title = ['One-pan dinner in 12 minutes', 'Stop rinsing your rice like this', 'The knife skill nobody teaches', 'Freezer meals that are not sad', 'Three sauces from one jar', 'Why your pasta water matters', 'Crispy potatoes every time', 'Meal prep without the boredom', 'I tested the viral egg trick', 'A full week of dinners', 'Pantry tour'][i] ?? v.title;
  v.views = v.views === undefined ? undefined : Math.round(v.views * 3.4);
});
for (const [n, channel] of [run, cook].entries()) {
  channel.thumb = picture(n ? 20 : 215, channel.title[0]!);
  channel.videos.forEach((v, i) => (v.thumb = picture((n ? 20 : 215) + i * 9, v.duration)));
  youtube.add(channel);
}
void youtube.start(Number(process.env.FAKE_YOUTUBE_PORT ?? 4011)).then((url) => console.log(`Stand-in YouTube API listening on ${url}`));

const TRANSCRIPT =
  'Most people stretch before they run and it is making them slower. Here is what the research actually says, and the two minute warm up I use instead before every single run. First, leg swings. Then high knees. Then ten easy strides.';
const TIKTOK = 'https://www.tiktok.com/@chefmaya/video/7301234567890123456';
const REEL = 'https://www.instagram.com/reel/CxYz123abcd/';
const apify = new FakeApify();
apify.defaultTranscript = TRANSCRIPT;
// One video without a transcript, to exercise the paste-it-in path.
apify.transcripts.set('https://www.youtube.com/shorts/a0000000003', null);
apify.posts.set(TIKTOK, { platform: 'tiktok', id: '7301234567890123456', username: 'chefmaya', displayName: 'Chef Maya', title: 'Stop rinsing your rice like this', views: 480000, likes: 31000, comments: 900, duration: 34 });
// Sound for the TikTok and the reel, so both are transcribed from audio.
apify.media.set('7301234567890123456', Buffer.alloc(4096));
apify.media.set('CxYz123abcd', Buffer.alloc(4096));
apify.posts.set(REEL, { platform: 'instagram', id: 'CxYz123abcd', username: 'trailnotes', displayName: 'Trail Notes', title: 'The downhill mistake that wrecks your knees', views: 212000, likes: 14000, comments: 310, duration: 41 });
void apify.start(Number(process.env.FAKE_APIFY_PORT ?? 4012)).then((url) => console.log(`Stand-in Apify listening on ${url}\n  TikTok: ${TIKTOK}\n  Instagram: ${REEL}`));
