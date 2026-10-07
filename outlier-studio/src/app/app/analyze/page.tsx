'use client';

import { useState, type FormEvent } from 'react';
import { AddVideoForm } from '@/components/AddVideoForm';
import { AnalysisView } from '@/components/GenerationViews';
import { InstructionsPicker } from '@/components/InstructionsPicker';
import { PlatformSelect } from '@/components/PlatformSelect';
import { ErrorNotice, Field, PageHead, useReveal, Skeleton } from '@/components/ui';
import { api, compact, type ApiError } from '@/lib/api';
import type { Generation } from '@/lib/types';

type AnalysisGeneration = Extract<Generation, { kind: 'analysis' }>;

const wholeNumber = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(/[,\s]/g, '')));

export default function AnalyzePage() {
  const [mode, setMode] = useState<'link' | 'transcript'>('link');
  const [form, setForm] = useState({ transcript: '', title: '', platform: '', sourceUrl: '', views: '', channelMedianViews: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<AnalysisGeneration | null>(null);
  const [instructionsId, setInstructionsId] = useState<string | null | undefined>(undefined);
  const [resultRef, reveal] = useReveal<HTMLElement>();
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    reveal();
    try {
      const { views, channelMedianViews, ...text } = form;
      const { generation } = await api<{ generation: AnalysisGeneration }>('/api/ai/analyze', {
        body: { ...compact({ ...text, views: wholeNumber(views), channelMedianViews: wholeNumber(channelMedianViews) }), ...(instructionsId === undefined ? {} : { instructionsId }) },
      });
      setResult(generation);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const fields = error?.fields ?? {};
  return (
    <>
      <PageHead title="Analyze a link">Turn a strong video into a reusable hook, structure, and set of ideas.</PageHead>
      <div className="analyze-mode" role="tablist" aria-label="Analysis source"><button type="button" role="tab" aria-selected={mode === 'link'} onClick={() => setMode('link')}>Link</button><button type="button" role="tab" aria-selected={mode === 'transcript'} onClick={() => setMode('transcript')}>Transcript</button></div>
      <div className="analyze-stage">
        {mode === 'link' ? <section className="analyze-hero panel" role="tabpanel"><div><span className="page-eyebrow">FASTEST PATH</span><h2>What made this video work?</h2><p className="muted">Paste the link. We’ll fetch the transcript, save the video, and reveal the structure.</p></div><AddVideoForm analyze label="Video link" button="Analyze video" /></section> : <div className="tool" role="tabpanel">
        <form className="panel stack" onSubmit={submit} noValidate>
          <Field label="Transcript" hint="The spoken words of the video, at least a few sentences." error={fields.transcript}>
            {(p) => <textarea {...p} className="textarea textarea-tall" value={form.transcript} onChange={(e) => set('transcript')(e.target.value)} required maxLength={20000} />}
          </Field>
          <Field label="Title" optional error={fields.title}>
            {(p) => <input {...p} className="input" value={form.title} onChange={(e) => set('title')(e.target.value)} maxLength={200} />}
          </Field>
          <details className="more">
            <summary>Add performance numbers and source</summary>
            <div className="stack">
              <div className="grid-2">
                <Field label="Views" optional hint="For this video." error={fields.views}>
                  {(p) => <input {...p} className="input" inputMode="numeric" value={form.views} onChange={(e) => set('views')(e.target.value)} />}
                </Field>
                <Field label="Usual views" optional hint="The channel's median per video." error={fields.channelMedianViews}>
                  {(p) => <input {...p} className="input" inputMode="numeric" value={form.channelMedianViews} onChange={(e) => set('channelMedianViews')(e.target.value)} />}
                </Field>
              </div>
              <PlatformSelect value={form.platform} onChange={set('platform')} />
              <Field label="Source link" optional error={fields.sourceUrl}>
                {(p) => <input {...p} className="input" type="url" value={form.sourceUrl} onChange={(e) => set('sourceUrl')(e.target.value)} placeholder="https://" />}
              </Field>
            </div>
          </details>
          <InstructionsPicker onChange={setInstructionsId} />
          <ErrorNotice error={error} />
          <button className="btn btn-primary" disabled={busy || form.transcript.trim().length < 40}>
            {busy ? 'Analyzing video' : 'Analyze video'}
          </button>
        </form>

        <section ref={resultRef} data-active={busy || result !== null} aria-live="polite" aria-busy={busy}>
          {busy ? (
            <div className="panel">
              <Skeleton lines={8} />
            </div>
          ) : result ? (
            <div className="stack">
              <p className="muted small">Saved to your Library.</p>
              <AnalysisView key={result.id} generationId={result.id} analysis={result.output} transcript={result.input.transcript} title={result.title} />
            </div>
          ) : (
            <div className="empty">
              <h2>The breakdown will appear here</h2>
              <p className="muted">It reads the transcript only, so it covers what was said and how it was structured, not the visuals or editing.</p>
            </div>
          )}
        </section>
      </div>}
      </div>
    </>
  );
}
