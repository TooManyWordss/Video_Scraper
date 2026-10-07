import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/client';
import { analysisMessages, type AnalysisMessage } from '../../db/schema';
import { getAnalysis } from '../../generations';
import type { AppliedInstructions } from '../../instructions';
import { PERSONA_RULE, personaBlock } from '../../profile';
import { openTextStream } from '../service';
import { attachGeneration } from '../usage';
import { DATA_RULE, INSTRUCTIONS_RULE, instructionsBlock, quote } from './shared';

/** Follow-up questions about one saved analysis, answered from its transcript and findings. */

export const ChatInput = z.object({ message: z.string().trim().min(1, 'Write a message.').max(2000) });
export type ChatInput = z.infer<typeof ChatInput>;

/** Earlier turns sent with each question; older ones stay saved but are not resent. */
const HISTORY_TURNS = 20;
const MAX_TRANSCRIPT_CHARS = 12_000;

const SYSTEM = `You are the analyst who broke down a short-form video for a creator. They are now asking follow-up questions, asking you to clarify or correct the analysis, or asking how to apply it.

Answer from the transcript and the analysis below. You only have the spoken words: if a question depends on visuals, editing or audio, say you cannot tell from the transcript. When you quote the video, quote it exactly. If the creator points out a mistake in the analysis and they are right, say so plainly and give the corrected version.
Keep answers short and direct: a few sentences, or a short list when listing things. No headings unless asked.
${PERSONA_RULE}
${DATA_RULE}
${INSTRUCTIONS_RULE}`;

export async function listMessages(userId: string, analysisId: string): Promise<AnalysisMessage[]> {
  await getAnalysis(userId, analysisId);
  const db = await getDb();
  return db
    .select()
    .from(analysisMessages)
    .where(and(eq(analysisMessages.generationId, analysisId), eq(analysisMessages.userId, userId)))
    .orderBy(asc(analysisMessages.createdAt));
}

export async function clearMessages(userId: string, analysisId: string): Promise<void> {
  await getAnalysis(userId, analysisId);
  const db = await getDb();
  await db.delete(analysisMessages).where(and(eq(analysisMessages.generationId, analysisId), eq(analysisMessages.userId, userId)));
}

/** The analysis as the model sees it: everything except the bulky long breakdown. */
function analysisContext(output: Record<string, unknown>): string {
  const { longBreakdown: _skip, ...rest } = output;
  return JSON.stringify(rest);
}

export async function openChatStream(userId: string, analysisId: string, input: ChatInput, signal?: AbortSignal) {
  const analysis = await getAnalysis(userId, analysisId);
  const history = await listMessages(userId, analysisId);
  const saved = analysis.input as { transcript?: string; title?: string; instructions?: AppliedInstructions | null };

  const context = [
    saved.title ? quote('title', saved.title) : '',
    quote('transcript', (saved.transcript ?? '').slice(0, MAX_TRANSCRIPT_CHARS)),
    quote('analysis', analysisContext(analysis.output as Record<string, unknown>)),
    instructionsBlock(saved.instructions),
    await personaBlock(userId),
  ]
    .filter(Boolean)
    .join('\n\n');

  return openTextStream({
    userId,
    feature: 'chat',
    tier: 'quality',
    system: `${SYSTEM}\n\n${context}`,
    history: history.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content })),
    prompt: input.message,
    temperature: 0.5,
    maxOutputTokens: 2048,
    signal,
  });
}

/** Saves the question and its answer together once the answer has finished. */
export async function saveExchange(userId: string, analysisId: string, question: string, answer: string, requestId: string) {
  const db = await getDb();
  const now = Date.now();
  const rows = await db
    .insert(analysisMessages)
    .values([
      { generationId: analysisId, userId, role: 'user', content: question, createdAt: new Date(now) },
      // A millisecond later, so the pair always sorts question first.
      { generationId: analysisId, userId, role: 'assistant', content: answer, createdAt: new Date(now + 1) },
    ])
    .returning();
  await attachGeneration(requestId, analysisId);
  return rows;
}
