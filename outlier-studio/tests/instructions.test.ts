import { describe, expect, it } from 'vitest';
import { POST as analyze } from '@/app/api/ai/analyze/route';
import { GET as list, POST as create } from '@/app/api/instructions/route';
import { DELETE as remove, PUT as update } from '@/app/api/instructions/[id]/route';
import { POST as importFile } from '@/app/api/instructions/import/route';
import { ORIGIN, TRANSCRIPT, call, newUser, useTestApp } from './support/app';

const groq = useTestApp();

const ANALYSIS = JSON.stringify({
  summary: 'A runner argues against static stretching.',
  hook: { text: 'Most people stretch before they run', pattern: 'contrarian', whyItWorks: 'Challenges a habit.' },
  format: 'myth buster',
  structure: [],
  techniques: [{ name: 'Open loop', kind: 'trick', quote: 'Here is what the research actually says', effect: 'Makes the viewer wait for the answer.' }],
  topics: ['running'],
  takeaways: [],
  remixIdeas: [],
  customFocus: [{ point: 'Hook score', detail: '8 out of 10: it contradicts a habit most viewers have.' }],
});

const SET = { name: 'Persuasion', content: 'Score the hook out of ten and name every persuasion trigger.' };

async function createSet(cookie: string, body: Record<string, unknown> = SET) {
  const res = await call(create, 'POST', '/api/instructions', { cookie, body });
  expect(res.status).toBe(201);
  return (await res.json()).instructions as { id: string; name: string; isDefault: boolean };
}

/** Uploads a file to the import route as a browser would. */
function upload(cookie: string, name: string, bytes: Uint8Array<ArrayBuffer> | string, type = 'application/octet-stream') {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type }));
  return importFile(new Request(`${ORIGIN}/api/instructions/import`, { method: 'POST', headers: { cookie, origin: ORIGIN }, body: form }));
}

/** The smallest valid PDF with one line of text, with a correct cross-reference table. */
function tinyPdf(text: string): Uint8Array<ArrayBuffer> {
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe('analysis instructions', () => {
  it('makes the first set the default and keeps only one default', async () => {
    const { cookie } = await newUser();
    const first = await createSet(cookie);
    expect(first.isDefault).toBe(true);
    const second = await createSet(cookie, { name: 'Education', content: 'Explain how each idea is simplified for beginners.' });
    expect(second.isDefault).toBe(false);

    const res = await call(update, 'PUT', `/api/instructions/${second.id}`, { cookie, params: { id: second.id }, body: { isDefault: true } });
    expect(res.status).toBe(200);
    const { items } = await (await call(list, 'GET', '/api/instructions', { cookie })).json();
    expect(items.filter((i: { isDefault: boolean }) => i.isDefault).map((i: { id: string }) => i.id)).toEqual([second.id]);
  });

  it('validates input', async () => {
    const { cookie } = await newUser();
    const res = await call(create, 'POST', '/api/instructions', { cookie, body: { name: '', content: 'short' } });
    expect(res.status).toBe(400);
  });

  it('keeps each user’s instructions private', async () => {
    const alice = await newUser('alice-i@example.com');
    const bob = await newUser('bob-i@example.com');
    const set = await createSet(alice.cookie);

    expect((await (await call(list, 'GET', '/api/instructions', { cookie: bob.cookie })).json()).items).toEqual([]);
    expect((await call(update, 'PUT', `/api/instructions/${set.id}`, { cookie: bob.cookie, params: { id: set.id }, body: { name: 'Mine now' } })).status).toBe(404);
    expect((await call(remove, 'DELETE', `/api/instructions/${set.id}`, { cookie: bob.cookie, params: { id: set.id } })).status).toBe(404);
    // Bob cannot run an analysis with Alice's instructions either, and nothing is sent to the AI.
    const res = await call(analyze, 'POST', '/api/ai/analyze', { cookie: bob.cookie, body: { transcript: TRANSCRIPT, instructionsId: set.id } });
    expect(res.status).toBe(404);
    expect(groq.calls).toHaveLength(0);

    expect((await call(remove, 'DELETE', `/api/instructions/${set.id}`, { cookie: alice.cookie, params: { id: set.id } })).status).toBe(200);
  });

  it('applies the default set to new analyses and records it', async () => {
    const { cookie } = await newUser();
    await createSet(cookie);
    groq.enqueue({ kind: 'json', content: ANALYSIS });
    const res = await call(analyze, 'POST', '/api/ai/analyze', { cookie, body: { transcript: TRANSCRIPT } });
    expect(res.status).toBe(201);
    const { generation } = await res.json();

    const prompt = groq.calls[0]!.body.messages.at(-1).content as string;
    expect(prompt).toContain(`<analysis_instructions>\n${SET.content}\n</analysis_instructions>`);
    expect(groq.calls[0]!.body.messages[0].content).toContain('<analysis_instructions>');
    // The schema sent to Groq has no "default" keywords, which strict mode rejects.
    expect(JSON.stringify(groq.calls[0]!.body.response_format)).not.toContain('"default"');

    expect(generation.output.instructionsName).toBe(SET.name);
    expect(generation.output.techniques[0].kind).toBe('trick');
    expect(generation.output.customFocus).toHaveLength(1);
  });

  it('can analyse with no instructions even when a default exists', async () => {
    const { cookie } = await newUser();
    await createSet(cookie);
    groq.enqueue({ kind: 'json', content: ANALYSIS });
    const res = await call(analyze, 'POST', '/api/ai/analyze', { cookie, body: { transcript: TRANSCRIPT, instructionsId: null } });
    expect(res.status).toBe(201);
    expect(groq.calls[0]!.body.messages.at(-1).content).not.toContain('<analysis_instructions>');
    expect((await res.json()).generation.output.instructionsName).toBeNull();
  });
});

describe('importing instructions from files', () => {
  it('reads plain text and markdown', async () => {
    const { cookie } = await newUser();
    const res = await upload(cookie, 'brief.md', '﻿# My brief\r\n\r\n\r\n\r\nLook for open loops.  \n', 'text/markdown');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fileName: 'brief.md', text: '# My brief\n\nLook for open loops.', truncated: false });
  });

  it('reads PDFs', async () => {
    const { cookie } = await newUser();
    const res = await upload(cookie, 'guide.pdf', tinyPdf('Score the hook out of ten'), 'application/pdf');
    expect(res.status).toBe(200);
    expect((await res.json()).text).toContain('Score the hook out of ten');
  });

  it('strips RTF formatting', async () => {
    const { cookie } = await newUser();
    const res = await upload(cookie, 'notes.rtf', '{\\rtf1\\ansi{\\fonttbl\\f0\\fswiss Helvetica;}\\f0\\pard Focus on {\\b pacing}.\\par Rate the CTA.}');
    expect(res.status).toBe(200);
    const { text } = await res.json();
    expect(text).toContain('Focus on pacing.');
    expect(text).toContain('Rate the CTA.');
  });

  it('turns away binary and broken files with a clear message', async () => {
    const { cookie } = await newUser();
    const binary = await upload(cookie, 'photo.png', new Uint8Array([137, 80, 78, 71, 0, 0, 0, 13]));
    expect(binary.status).toBe(422);
    expect((await binary.json()).error.code).toBe('file_unreadable');
    const broken = await upload(cookie, 'broken.docx', 'this is not really a word document');
    expect(broken.status).toBe(422);
  });

  it('requires a signed-in user and a file', async () => {
    expect((await upload('', 'a.txt', 'hello there')).status).toBe(401);
    const { cookie } = await newUser();
    const res = await importFile(new Request(`${ORIGIN}/api/instructions/import`, { method: 'POST', headers: { cookie, origin: ORIGIN }, body: new FormData() }));
    expect(res.status).toBe(400);
  });
});
