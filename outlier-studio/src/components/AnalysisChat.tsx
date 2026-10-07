'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, type ApiError } from '@/lib/api';
import { streamChat } from '@/lib/stream';
import type { ChatMessage } from '@/lib/types';
import { Icon } from './icons';
import { ErrorNotice, Skeleton } from './ui';

const MAX = 2000;

const SUGGESTIONS = [
  'Why does the hook work so well?',
  'Which technique should I copy first?',
  'What would make this video stronger?',
  'Rewrite the hook for my niche.',
];

/** A free-form conversation about one saved analysis. Messages are kept with the analysis. */
export function AnalysisChat({ analysisId }: { analysisId: string }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  /** The question being answered and the answer so far, while streaming. */
  const [pending, setPending] = useState<{ question: string; answer: string } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api<{ messages: ChatMessage[] }>(`/api/analyses/${analysisId}/chat`)
      .then((r) => setMessages(r.messages))
      .catch((err) => {
        setMessages([]);
        setError(err);
      });
    return () => abort.current?.abort();
  }, [analysisId]);

  // Keep the newest text in view as it streams in.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages?.length, pending?.answer]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    setError(null);
    setDraft('');
    setPending({ question, answer: '' });
    const controller = new AbortController();
    abort.current = controller;
    try {
      const done = await streamChat(analysisId, question, { onDelta: (piece) => setPending((p) => (p ? { ...p, answer: p.answer + piece } : p)) }, controller.signal);
      setMessages((m) => [...(m ?? []), ...done.messages]);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError(err as ApiError);
      // Nothing was saved, so give the question back to retry or edit.
      setDraft(question);
    } finally {
      setPending(null);
      abort.current = null;
      input.current?.focus();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter starts a new line.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  }

  async function clear() {
    try {
      await api(`/api/analyses/${analysisId}/chat`, { method: 'DELETE' });
      setMessages([]);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setConfirmClear(false);
    }
  }

  if (messages === null) return <div className="panel"><Skeleton lines={4} /></div>;

  const empty = messages.length === 0 && !pending;
  return (
    <div className="panel chat">
      <div className="chat-head">
        <div>
          <h2>Ask about this video</h2>
          <p className="muted small">Ask follow-up questions, have a point explained, or tell it what it got wrong. It answers from the transcript and this analysis.</p>
        </div>
        {messages.length > 0 &&
          !pending &&
          (confirmClear ? (
            <div className="row">
              <button type="button" className="btn btn-sm btn-danger" onClick={clear}>
                Clear chat
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setConfirmClear(false)}>
                Keep
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-sm" onClick={() => setConfirmClear(true)}>
              Clear
            </button>
          ))}
      </div>

      <div className="chat-log" aria-live="polite">
        {empty ? (
          <div className="chat-suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="starter" onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <div key={m.id} className="bubble" data-role={m.role}>
                {m.content}
              </div>
            ))}
            {pending && (
              <>
                <div className="bubble" data-role="user">
                  {pending.question}
                </div>
                <div className="bubble" data-role="assistant" aria-busy="true">
                  {pending.answer || <span className="typing" aria-label="Thinking"><i /><i /><i /></span>}
                </div>
              </>
            )}
          </>
        )}
        <div ref={end} />
      </div>

      <ErrorNotice error={error} />
      <form className="chat-input" onSubmit={onSubmit}>
        <label htmlFor={`chat-${analysisId}`} className="sr-only">
          Your message
        </label>
        <textarea
          id={`chat-${analysisId}`}
          ref={input}
          className="textarea"
          rows={2}
          value={draft}
          maxLength={MAX}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask anything about this video or its breakdown"
          disabled={pending !== null}
        />
        {pending ? (
          <button type="button" className="btn" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <button className="btn btn-primary" disabled={!draft.trim()} aria-label="Send">
            <Icon.send />
          </button>
        )}
      </form>
    </div>
  );
}
