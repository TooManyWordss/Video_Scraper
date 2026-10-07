import { ScriptInput, openScriptStream, saveScript } from '@/server/ai/features/script';
import { readJson, route } from '@/server/http';
import { sseResponse } from '@/server/sse';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Streams a script as server-sent events:
 *   start {requestId} -> delta {text} ... -> done {generation, usage, truncated} | error {code, message}
 * Failures before the first token (limits, Groq outage) are returned as a
 * normal JSON error with the right HTTP status instead.
 */
export const POST = route('user', async ({ req, user }) => {
  const input = await readJson(req, ScriptInput);
  const abort = new AbortController();
  req.signal.addEventListener('abort', () => abort.abort(), { once: true });

  const stream = await openScriptStream(user.id, input, abort.signal);
  return sseResponse(stream, abort, async ({ text }) => ({ generation: await saveScript(user.id, input, text, stream.requestId) }), 'script');
});
