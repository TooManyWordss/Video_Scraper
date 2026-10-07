'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ApiError } from '@/lib/api';

export function Field({
  label,
  optional,
  hint,
  error,
  children,
}: {
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} {optional && <span className="optional">(optional)</span>}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

/** Shows what went wrong and, where it helps, what to do next. */
export function ErrorNotice({ error }: { error: ApiError | null }) {
  const ref = useRef<HTMLDivElement>(null);
  // On a phone the notice can be off screen when it appears; "nearest" only scrolls if it is.
  useEffect(() => {
    if (error) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);
  if (!error) return null;
  const next: Record<string, ReactNode> = {
    rate_limited: 'Wait a minute, then try again.',
    ai_rate_limited: error.retryAfterSeconds ? `Try again in about ${Math.ceil(error.retryAfterSeconds)} seconds.` : 'Try again in a moment.',
    ai_model_unavailable: 'Nothing was charged.',
    ai_not_configured: 'The server needs a valid Groq API key. Nothing was charged.',
    invalid_input: 'Check the highlighted fields.',
    transcripts_not_configured: 'Nothing was charged.',
    transcript_unavailable: 'Paste the transcript in the Transcript tab instead. Nothing was charged.',
    transcript_quota: 'Nothing was charged.',
    transcript_timeout: 'Nothing was charged.',
    video_data_quota: 'Videos already in your feed are unaffected.',
    video_not_accessible: 'Open “Paste a transcript instead” below if you can access the captions yourself.',
    scraper_configuration: 'The server connector needs updating before this link can be retried.',
  };
  return (
    <div className="notice notice-error" role="alert" ref={ref}>
      <strong>{error.message}</strong> {next[error.code]}
    </div>
  );
}

export function CopyButton({ text, label = 'Copy', className = 'btn btn-sm' }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={className}
      data-copy-state={state}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState('copied');
        } catch {
          setState('failed');
        }
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setState('idle'), 1800);
      }}
    >
      <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}</span>
    </button>
  );
}

/**
 * On narrow screens the result sits below the form. Call the returned function
 * when a request starts to bring the result area into view.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const reveal = () => {
    if (!window.matchMedia('(max-width: 1080px)').matches) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }));
  };
  return [ref, reveal] as const;
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

const SECTION: Record<string, string> = {
  Videos: 'Research', Discover: 'Research', 'Hook library': 'Research', Watchlist: 'Setup',
  Hooks: 'Create', Scripts: 'Create', 'Analyze a link': 'Create', Library: 'Create',
  Usage: 'Setup', Settings: 'Setup', 'Analysis instructions': 'Setup',
};

export function PageHead({ title, eyebrow, action, children }: { title: string; eyebrow?: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-copy">
        <span className="page-eyebrow">{eyebrow ?? SECTION[title] ?? 'Workspace'}</span>
        <h1>{title}</h1>
        {children && <p className="muted">{children}</p>}
      </div>
      {action && <div className="page-head-action">{action}</div>}
    </header>
  );
}

/** A long, optional paste area tucked behind a disclosure so forms stay short. */
export function ReferenceTranscript({ value, onChange, error, summary }: { value: string; onChange: (v: string) => void; error?: string; summary: string }) {
  return (
    <details className="more" open={value.length > 0 || Boolean(error)}>
      <summary>{summary}</summary>
      <Field label="Transcript of the video" optional hint="Its structure and rhythm are reused. Its words and claims are not." error={error}>
        {(p) => <textarea {...p} className="textarea" value={value} onChange={(e) => onChange(e.target.value)} maxLength={20000} />}
      </Field>
    </details>
  );
}
