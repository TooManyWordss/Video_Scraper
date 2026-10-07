/**
 * A local stand-in for Groq's chat completions endpoint, used ONLY by the
 * test suite. It speaks the same wire format (JSON and SSE streaming with the
 * final x_groq.usage chunk) so the real groq-sdk client runs unmodified.
 * Application code never references this file.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Usage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };

export type Behavior =
  | { kind: 'json'; content: string; usage?: Usage | null }
  | { kind: 'stream'; pieces: string[]; usage?: Usage | null; errorAfter?: number; delayMs?: number }
  | { kind: 'error'; status: number; body: unknown; headers?: Record<string, string> }
  /** An /audio/transcriptions answer in verbose_json shape. */
  | { kind: 'transcription'; text: string; duration?: number; language?: string; segments?: { text: string; no_speech_prob?: number; avg_logprob?: number }[] };

/** For audio uploads, body holds the multipart form fields and the uploaded file's size. */
export type RecordedCall = { path: string; authorization: string | undefined; body: Record<string, any> };

/** Reads the text fields of a multipart body, enough to check what the app sent. */
function multipartFields(raw: Buffer, contentType: string): Record<string, any> {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const marker = `--${boundary?.[1] ?? boundary?.[2] ?? ''}`;
  const fields: Record<string, any> = {};
  for (const part of raw.toString('latin1').split(marker)) {
    const name = /name="([^"]+)"/.exec(part)?.[1];
    if (!name) continue;
    const value = part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
    if (/filename="/.test(part)) fields[`${name}Bytes`] = value.length;
    else fields[name] = value;
  }
  return fields;
}

export const USAGE: Usage = { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 };

export class FakeGroq {
  calls: RecordedCall[] = [];
  private queue: Behavior[] = [];
  /** When set, requests with nothing queued get this instead of an error (used by the browser check). */
  fallback?: (body: Record<string, any>) => Behavior;
  private server = http.createServer((req, res) => void this.handle(req, res));

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  stop(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
  reset(): void {
    this.calls = [];
    this.queue = [];
  }
  enqueue(...behaviors: Behavior[]): void {
    this.queue.push(...behaviors);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const contentType = req.headers['content-type'] ?? '';
    const body = contentType.startsWith('multipart/form-data') ? multipartFields(raw, contentType) : JSON.parse(raw.toString() || '{}');
    this.calls.push({ path: req.url ?? '', authorization: req.headers.authorization, body });

    const next = this.queue.shift() ?? this.fallback?.(body);
    if (req.url === '/openai/v1/audio/transcriptions' && next?.kind === 'transcription') {
      res.writeHead(200, { 'content-type': 'application/json', 'x-groq-id': 'req_test_audio' });
      res.end(JSON.stringify({ task: 'transcribe', text: next.text, language: next.language ?? 'English', duration: next.duration ?? 30, segments: next.segments ?? [{ text: next.text, no_speech_prob: 0.01, avg_logprob: -0.2 }] }));
      return;
    }
    if (req.url !== '/openai/v1/chat/completions' || !next || next.kind === 'transcription') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'fake-groq: unexpected call', type: 'test' } }));
      return;
    }

    if (next.kind === 'error') {
      res.writeHead(next.status, { 'content-type': 'application/json', ...next.headers });
      res.end(JSON.stringify(next.body));
      return;
    }

    const base = { id: 'chatcmpl-test', created: 1, model: body.model };
    if (next.kind === 'json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ...base,
          object: 'chat.completion',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: next.content } }],
          usage: next.usage === null ? undefined : (next.usage ?? USAGE),
          x_groq: { id: 'req_test_json' },
        }),
      );
      return;
    }

    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const write = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const chunk = (delta: object, extra: object = {}) => ({
      ...base,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta, finish_reason: null }],
      ...extra,
    });
    write(chunk({ role: 'assistant', content: '' }, { x_groq: { id: 'req_test_stream' } }));
    for (const [i, piece] of next.pieces.entries()) {
      if (next.errorAfter === i) {
        write({ ...chunk({}), x_groq: { id: 'req_test_stream', error: 'over_capacity' } });
        res.end();
        return;
      }
      if (next.delayMs) await new Promise((r) => setTimeout(r, next.delayMs));
      if (res.destroyed) return;
      write(chunk({ content: piece }));
    }
    write({
      ...base,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      x_groq: { id: 'req_test_stream', ...(next.usage === null ? {} : { usage: next.usage ?? USAGE }) },
    });
    res.write('data: [DONE]\n\n');
    res.end();
  }
}
