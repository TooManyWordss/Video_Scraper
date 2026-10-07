import 'server-only';
import { z } from 'zod';
import { attachGeneration } from '../usage';
import { AppError } from '../../errors';
import { extendGenerationOutput, getAnalysis } from '../../generations';
import type { AppliedInstructions } from '../../instructions';
import { generateJson } from '../service';
import { DATA_RULE, INSTRUCTIONS_RULE, instructionsBlock, quote } from './shared';

/**
 * The long breakdown: the whole script, sentence by sentence, each with the
 * beat it belongs to, the device it uses and why it is there. The sentences are
 * cut here rather than by the model, so the script shown is exactly what was said.
 */

/** Captions often lack punctuation; a "sentence" longer than this is cut into pieces of CHUNK_WORDS. */
const MAX_WORDS = 40;
const CHUNK_WORDS = 20;
const MAX_LINES = 400;
const BATCH = 30;
const PARALLEL = 3;

/** Splits a transcript into spoken sentences, dropping timestamps like [0:12] or 01:02:03. */
export function splitScript(transcript: string): string[] {
  const text = transcript
    .replace(/[[(]?\b\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\b[\])]?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g) ?? [];
  const lines: string[] = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const words = sentence.split(' ');
    if (words.length <= MAX_WORDS) {
      lines.push(sentence);
      continue;
    }
    for (let i = 0; i < words.length; i += CHUNK_WORDS) lines.push(words.slice(i, i + CHUNK_WORDS).join(' '));
  }
  return lines;
}

const Batch = z.object({
  lines: z.array(z.object({ n: z.number().int(), role: z.string(), technique: z.string(), explanation: z.string() })),
});

export type BreakdownLine = { text: string; role: string; technique: string; explanation: string };
export type LongBreakdown = { lines: BreakdownLine[]; createdAt: string; truncated: boolean };

const SYSTEM = `You explain short-form video scripts line by line for creators who want to learn the craft.
You are given numbered sentences from one video's transcript, plus an overview of the whole video. Annotate every sentence in <annotate>, and only those; <context> lines are there so you can see what comes before and after.

For each sentence give:
- n: its number, exactly as given.
- role: the beat it serves, in one to three words (for example: Hook, Setup, Stakes, Context, Proof, Example, Twist, Payoff, Call to action).
- technique: the persuasion or retention device the wording uses, in a few words, or an empty string when it is plain connective speech.
- explanation: one or two sentences on what the line does for the viewer and why it is phrased this way.

Work from the words only; you cannot see the visuals, editing or audio.
${DATA_RULE}
${INSTRUCTIONS_RULE}`;

type Overview = { summary?: string; structure?: { section: string; purpose: string }[]; techniques?: { name: string }[] };

function overviewText(o: Overview): string {
  return [
    o.summary ?? '',
    o.structure?.length ? `Sections: ${o.structure.map((s) => `${s.section} (${s.purpose})`).join('; ')}` : '',
    o.techniques?.length ? `Devices already named in the analysis: ${o.techniques.map((t) => t.name).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const numbered = (lines: string[], from: number) => lines.map((l, i) => `${from + i + 1}. ${l}`).join('\n');

/** Runs the tasks with at most `limit` in flight, keeping results in order. */
async function inBatches<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]!();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

export async function createLongBreakdown(userId: string, analysisId: string, signal?: AbortSignal) {
  const analysis = await getAnalysis(userId, analysisId);
  const input = analysis.input as { transcript?: string; title?: string; instructions?: AppliedInstructions | null };
  const split = splitScript(input.transcript ?? '');
  const all = split.slice(0, MAX_LINES);
  if (all.length < 2) throw new AppError(422, 'transcript_unavailable', 'This transcript is too short to break down sentence by sentence.');
  const overview = quote('overview', overviewText(analysis.output as Overview));
  const instructions = instructionsBlock(input.instructions);

  const tasks = [];
  for (let start = 0; start < all.length; start += BATCH) {
    const slice = all.slice(start, start + BATCH);
    const before = all.slice(Math.max(0, start - 2), start);
    const after = all.slice(start + BATCH, start + BATCH + 2);
    const prompt = [
      input.title ? quote('title', input.title) : '',
      overview,
      before.length ? quote('context', numbered(before, start - before.length)) : '',
      quote('annotate', numbered(slice, start)),
      after.length ? quote('context', numbered(after, start + BATCH)) : '',
      instructions,
    ]
      .filter(Boolean)
      .join('\n\n');
    tasks.push(() =>
      generateJson({ userId, feature: 'breakdown', tier: 'quality', system: SYSTEM, prompt, schemaName: 'line_breakdown', schema: Batch, temperature: 0.3, maxOutputTokens: 8192, signal }),
    );
  }
  const results = await inBatches(tasks, PARALLEL);

  const notes = new Map(results.flatMap((r) => r.data.lines.map((l) => [l.n, l] as const)));
  const lines: BreakdownLine[] = all.map((text, i) => {
    const note = notes.get(i + 1);
    return { text, role: note?.role ?? '', technique: note?.technique ?? '', explanation: note?.explanation ?? '' };
  });
  const longBreakdown: LongBreakdown = { lines, createdAt: new Date().toISOString(), truncated: split.length > MAX_LINES };

  for (const r of results) await attachGeneration(r.requestId, analysis.id);
  const generation = await extendGenerationOutput(userId, analysis.id, { longBreakdown });
  return { generation };
}
