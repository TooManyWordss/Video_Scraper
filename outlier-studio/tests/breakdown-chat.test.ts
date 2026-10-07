import { describe, expect, it } from 'vitest';
import { POST as analyze } from '@/app/api/ai/analyze/route';
import { POST as breakdown } from '@/app/api/analyses/[id]/breakdown/route';
import { DELETE as clearChat, GET as getChat, POST as chat } from '@/app/api/analyses/[id]/chat/route';
import { POST as create } from '@/app/api/instructions/route';
import { POST as hooks } from '@/app/api/ai/hooks/route';
import { splitScript } from '@/server/ai/features/breakdown';
import { TRANSCRIPT, call, newUser, readSse, requestRows, useTestApp } from './support/app';

const groq = useTestApp();

const ANALYSIS = JSON.stringify({
  summary: 'A runner argues against static stretching.',
  hook: { text: 'Most people stretch before they run', pattern: 'contrarian', whyItWorks: 'Challenges a habit.' },
  format: 'myth buster',
  structure: [{ section: 'Hook', purpose: 'Stop the scroll', summary: 'Contrarian claim' }],
  techniques: [],
  topics: ['running'],
  takeaways: [],
  remixIdeas: [],
  customFocus: [],
});

async function analysisFor(cookie: string): Promise<string> {
  groq.enqueue({ kind: 'json', content: ANALYSIS });
  const res = await call(analyze, 'POST', '/api/ai/analyze', { cookie, body: { transcript: TRANSCRIPT, title: 'Stretching myth' } });
  expect(res.status).toBe(201);
  groq.reset();
  return (await res.json()).generation.id;
}

describe('splitScript', () => {
  it('splits on sentence ends and drops timestamps', () => {
    expect(splitScript('[0:01] Stop stretching. Why? 00:04 Because it "slows you down!" Try this instead')).toEqual([
      'Stop stretching.',
      'Why?',
      'Because it "slows you down!"',
      'Try this instead',
    ]);
  });

  it('cuts unpunctuated captions into readable pieces', () => {
    const words = Array.from({ length: 50 }, (_, i) => `w${i}`).join(' ');
    const lines = splitScript(words);
    expect(lines).toHaveLength(3);
    expect(lines[0]!.split(' ')).toHaveLength(20);
    expect(lines.join(' ')).toBe(words);
  });
});

describe('long breakdown', () => {
  it('annotates every sentence of the saved transcript and stores it on the analysis', async () => {
    const { cookie, user } = await newUser();
    await call(create, 'POST', '/api/instructions', { cookie, body: { name: 'Coach', content: 'Explain everything for a beginner creator.' } });
    const id = await analysisFor(cookie);
    const sentences = splitScript(TRANSCRIPT);
    expect(sentences).toHaveLength(2);

    groq.enqueue({
      kind: 'json',
      content: JSON.stringify({
        lines: [
          { n: 1, role: 'Hook', technique: 'Contrarian claim', explanation: 'Challenges a habit the viewer has.' },
          { n: 2, role: 'Promise', technique: 'Open loop', explanation: 'Promises an answer later.' },
        ],
      }),
    });
    const res = await call(breakdown, 'POST', `/api/analyses/${id}/breakdown`, { cookie, params: { id } });
    expect(res.status).toBe(201);
    const { generation } = await res.json();
    const lines = generation.output.longBreakdown.lines;
    expect(lines.map((l: { text: string }) => l.text)).toEqual(sentences);
    expect(lines[0]).toMatchObject({ role: 'Hook', technique: 'Contrarian claim' });
    // The original analysis is kept alongside it.
    expect(generation.output.summary).toBe('A runner argues against static stretching.');

    const prompt = groq.calls[0]!.body.messages.at(-1).content as string;
    expect(prompt).toContain('<annotate>\n1. Most people stretch');
    // It follows the instructions the analysis was made with.
    expect(prompt).toContain('Explain everything for a beginner creator.');
    const rows = await requestRows(user.id);
    expect(rows.at(-1)).toMatchObject({ feature: 'breakdown', status: 'succeeded', generationId: id });
  });

  it('only works on the owner’s analyses', async () => {
    const alice = await newUser('alice-b@example.com');
    const bob = await newUser('bob-b@example.com');
    const id = await analysisFor(alice.cookie);
    expect((await call(breakdown, 'POST', `/api/analyses/${id}/breakdown`, { cookie: bob.cookie, params: { id } })).status).toBe(404);
    expect(groq.calls).toHaveLength(0);
  });

  it('refuses outputs that are not analyses', async () => {
    const { cookie } = await newUser();
    groq.enqueue({ kind: 'json', content: JSON.stringify({ hooks: [{ text: 'Stop stretching.', pattern: 'contrarian', why: 'Bold.' }] }) });
    const created = await (await call(hooks, 'POST', '/api/ai/hooks', { cookie, body: { topic: 'Warm ups for runners', count: 3 } })).json();
    const id = created.generation.id;
    groq.reset();
    expect((await call(breakdown, 'POST', `/api/analyses/${id}/breakdown`, { cookie, params: { id } })).status).toBe(404);
  });
});

describe('analysis chat', () => {
  it('streams an answer grounded in the analysis, saves the exchange and sends history next time', async () => {
    const { cookie, user } = await newUser();
    const id = await analysisFor(cookie);

    groq.enqueue({ kind: 'stream', pieces: ['It contradicts ', 'a habit.'] });
    const res = await call(chat, 'POST', `/api/analyses/${id}/chat`, { cookie, params: { id }, body: { message: 'Why does the hook work?' } });
    expect(res.status).toBe(200);
    const events = await readSse(res);
    expect(events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('')).toBe('It contradicts a habit.');
    const done = events.find((e) => e.event === 'done')!.data;
    expect(done.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);

    const sent = groq.calls[0]!.body.messages;
    expect(sent[0].content).toContain('<transcript>');
    expect(sent[0].content).toContain('A runner argues against static stretching.');
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'Why does the hook work?' });

    groq.enqueue({ kind: 'stream', pieces: ['Yes.'] });
    await readSse(await call(chat, 'POST', `/api/analyses/${id}/chat`, { cookie, params: { id }, body: { message: 'Is it a myth buster?' } }));
    expect(groq.calls[1]!.body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);

    const { messages } = await (await call(getChat, 'GET', `/api/analyses/${id}/chat`, { cookie, params: { id } })).json();
    expect(messages.map((m: { content: string }) => m.content)).toEqual(['Why does the hook work?', 'It contradicts a habit.', 'Is it a myth buster?', 'Yes.']);
    expect((await requestRows(user.id)).filter((r) => r.feature === 'chat')).toHaveLength(2);

    expect((await call(clearChat, 'DELETE', `/api/analyses/${id}/chat`, { cookie, params: { id } })).status).toBe(200);
    expect((await (await call(getChat, 'GET', `/api/analyses/${id}/chat`, { cookie, params: { id } })).json()).messages).toEqual([]);
  });

  it('saves nothing when the answer fails', async () => {
    const { cookie } = await newUser();
    const id = await analysisFor(cookie);
    groq.enqueue({ kind: 'stream', pieces: ['Half', ' an answer'], errorAfter: 1 });
    const events = await readSse(await call(chat, 'POST', `/api/analyses/${id}/chat`, { cookie, params: { id }, body: { message: 'Explain the structure.' } }));
    expect(events.at(-1)!.event).toBe('error');
    expect((await (await call(getChat, 'GET', `/api/analyses/${id}/chat`, { cookie, params: { id } })).json()).messages).toEqual([]);
  });

  it('keeps chats private to the analysis owner', async () => {
    const alice = await newUser('alice-c@example.com');
    const bob = await newUser('bob-c@example.com');
    const id = await analysisFor(alice.cookie);
    expect((await call(getChat, 'GET', `/api/analyses/${id}/chat`, { cookie: bob.cookie, params: { id } })).status).toBe(404);
    expect((await call(chat, 'POST', `/api/analyses/${id}/chat`, { cookie: bob.cookie, params: { id }, body: { message: 'Hi' } })).status).toBe(404);
    expect((await call(clearChat, 'DELETE', `/api/analyses/${id}/chat`, { cookie: bob.cookie, params: { id } })).status).toBe(404);
    expect(groq.calls).toHaveLength(0);
  });
});
