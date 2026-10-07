import { z } from 'zod';
import { ChatInput, clearMessages, listMessages, openChatStream, saveExchange } from '@/server/ai/features/chat';
import { notFound } from '@/server/errors';
import { json, readJson, route } from '@/server/http';
import { sseResponse } from '@/server/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const id = (params: Record<string, string>) => {
  const parsed = z.string().uuid().safeParse(params.id);
  if (!parsed.success) throw notFound();
  return parsed.data;
};

export const GET = route('user', async ({ user, params }) => json({ messages: await listMessages(user.id, id(params)) }));

/**
 * Streams the answer as server-sent events, like the script writer:
 *   start -> delta {text} ... -> done {messages} | error {code, message}
 * The question and answer are saved together only when the answer completes.
 */
export const POST = route('user', async ({ req, user, params }) => {
  const analysisId = id(params);
  const input = await readJson(req, ChatInput);
  const abort = new AbortController();
  req.signal.addEventListener('abort', () => abort.abort(), { once: true });

  const stream = await openChatStream(user.id, analysisId, input, abort.signal);
  return sseResponse(stream, abort, async ({ text }) => ({ messages: await saveExchange(user.id, analysisId, input.message, text, stream.requestId) }), 'chat');
});

export const DELETE = route('user', async ({ user, params }) => {
  await clearMessages(user.id, id(params));
  return json({ ok: true });
});
