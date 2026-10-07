import 'server-only';
import type { StreamResult, TextStream } from './ai/service';
import { AppError } from './errors';

/**
 * Relays an AI text stream as server-sent events:
 *   start {requestId} -> delta {text} ... -> done {...finish()} | error {code, message}
 * `finish` runs once the text is complete (to save it) and its result is sent
 * with the done event. `abort` is aborted when the client goes away.
 */
export function sseResponse(stream: TextStream, abort: AbortController, finish: (result: StreamResult) => Promise<Record<string, unknown>>, label: string): Response {
  const encoder = new TextEncoder();
  let open = true;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (open) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        send('start', { requestId: stream.requestId });
        let step = await stream.deltas.next();
        while (!step.done) {
          send('delta', { text: step.value });
          step = await stream.deltas.next();
        }
        send('done', { ...(await finish(step.value)), usage: step.value.usage, truncated: step.value.truncated, requestId: stream.requestId });
      } catch (err) {
        if (err instanceof AppError) {
          send('error', { code: err.code, message: err.message });
        } else {
          console.error(`[${label} stream]`, err);
          send('error', { code: 'internal_error', message: 'Something went wrong on our side.' });
        }
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed by a client disconnect */
        }
      }
    },
    cancel() {
      open = false;
      abort.abort();
    },
  });

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
