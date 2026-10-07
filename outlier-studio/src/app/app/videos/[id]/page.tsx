'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AnalysisView } from '@/components/GenerationViews';
import { InstructionsPicker } from '@/components/InstructionsPicker';
import { VideoHeader } from '@/components/VideoHeader';
import { MetricsRow } from '@/components/MetricsRow';
import { ErrorNotice, Field, Skeleton, useReveal } from '@/components/ui';
import { ViewsChart } from '@/components/ViewsChart';
import { api, type ApiError } from '@/lib/api';
import { ago, day, num, when } from '@/lib/format';
import type { Generation, VideoDetail } from '@/lib/types';
import { PLATFORM_NAME } from '@/shared/video-url';

type AnalysisGeneration = Extract<Generation, { kind: 'analysis' }>;

/** Failures of the automatic transcript, where pasting one in is the way forward. */
const PASTE_INSTEAD = new Set(['audio_unavailable', 'audio_too_large', 'transcripts_not_configured', 'transcript_unavailable', 'transcript_quota', 'transcript_plan_limit', 'transcript_timeout', 'transcripts_unavailable', 'video_not_accessible']);

function VideoScreen() {
  const { id } = useParams<{ id: string }>();
  const autoStart = useSearchParams().get('analyze') === '1';
  const [data, setData] = useState<VideoDetail | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisGeneration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<ApiError | null>(null);
  const [resultRef, reveal] = useReveal<HTMLElement>();
  const started = useRef(false);
  /** The instructions the next analysis follows; undefined until chosen, so the server applies the default. */
  const instructionsId = useRef<string | null | undefined>(undefined);

  const load = useCallback(
    () =>
      api<VideoDetail>(`/api/videos/${id}`).then((d) => {
        setData(d);
        setAnalysis((current) => current ?? d.latestAnalysis);
        return d;
      }),
    [id],
  );

  const analyze = useCallback(
    async (transcript?: string) => {
      setBusy(true);
      setError(null);
      reveal();
      try {
        const choice = instructionsId.current === undefined ? {} : { instructionsId: instructionsId.current };
        const { generation } = await api<{ generation: AnalysisGeneration }>('/api/ai/analyze', { body: { videoId: id, ...choice, ...(transcript ? { transcript } : {}) } });
        setAnalysis(generation);
        setPasteOpen(false);
        void load().catch(() => undefined);
      } catch (err) {
        const e = err as ApiError;
        setError(e);
        if (PASTE_INSTEAD.has(e.code)) setPasteOpen(true);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, load],
  );

  useEffect(() => {
    load()
      .then((d) => {
        // Arriving from "Analyze a link": start straight away, once, unless it has been done before.
        if (autoStart && !d.latestAnalysis && !started.current) {
          started.current = true;
          void analyze();
        }
      })
      .catch(setLoadError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function updateNumbers() {
    setUpdating(true);
    setUpdateError(null);
    try {
      await api(`/api/videos/${id}/refresh`, { method: 'POST' });
      await load();
    } catch (err) {
      setUpdateError(err as ApiError);
    } finally {
      setUpdating(false);
    }
  }

  if (loadError) {
    return (
      <div className="stack" style={{ maxWidth: 640 }}>
        {loadError.status === 404 ? (
          <div className="empty">
            <h2>This video is not in your list</h2>
            <p className="muted">Its channel may have been removed from your watchlist.</p>
          </div>
        ) : (
          <ErrorNotice error={loadError} />
        )}
        <div>
          <Link className="btn" href="/app/feed">
            Back to Videos
          </Link>
        </div>
      </div>
    );
  }
  if (!data) return <Skeleton lines={8} />;

  const { video, history, analyses } = data;
  const platform = PLATFORM_NAME[video.platform];
  const earlier = analyses.filter((a) => a.id !== analysis?.id);
  const submitPasted = (e: FormEvent) => {
    e.preventDefault();
    void analyze(pasted);
  };

  return (
    <div className="video-detail stack-lg">
      <VideoHeader video={video}>
        {!video.monitored && (
          <button type="button" className="btn btn-sm" onClick={updateNumbers} disabled={updating}>
            {updating ? 'Updating numbers' : 'Update numbers'}
          </button>
        )}
      </VideoHeader>
      <ErrorNotice error={updateError} />
      <MetricsRow video={video} />

      <section className="stack" ref={resultRef} style={{ scrollMarginTop: 72 }} aria-busy={busy}>
        <div className="section-heading"><h2>Breakdown</h2><span className="eyebrow text-muted">From insight to your next idea</span></div>
        {busy ? (
          <div className="panel stack">
            <p role="status">
              <span className="tally" style={{ display: 'inline-block', marginRight: 8 }} aria-hidden="true" />
              {video.hasTranscript || pasted ? 'Breaking the video down.' : 'Getting the transcript, then breaking the video down.'} This takes about 20 seconds.
            </p>
            <Skeleton lines={6} />
          </div>
        ) : analysis ? (
          <>
            <AnalysisView key={analysis.id} generationId={analysis.id} analysis={analysis.output} transcript={analysis.input.transcript} title={video.title} hideMultiple />
            <div className="row">
              <button type="button" className="btn btn-sm" onClick={() => analyze()}>
                Break it down again
              </button>
              <InstructionsPicker onChange={(next) => (instructionsId.current = next)} />
              <span className="muted small">{video.hasTranscript ? 'The transcript is already saved, so no new one is fetched.' : ''}</span>
            </div>
          </>
        ) : (
          <div className="panel stack">
            <p>Get this video&apos;s hook, the tactics, tricks and techniques it uses, its structure beat by beat, and ideas for your own version.</p>
            <InstructionsPicker onChange={(next) => (instructionsId.current = next)} />
            {!data.transcriptsConfigured && !video.hasTranscript && (
              <p className="notice">
                Automatic transcripts are not set up on this server (it needs an <code>APIFY_TOKEN</code>). You can still paste a transcript below.
              </p>
            )}
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => analyze()}>
                Analyze this video
              </button>
              <span className="muted small">Fetches the transcript for you.</span>
            </div>
          </div>
        )}
        <ErrorNotice error={error} />

        {!busy && (
          <details className="more" open={pasteOpen} onToggle={(e) => setPasteOpen(e.currentTarget.open)}>
            <summary>Paste a transcript instead</summary>
            <form className="panel stack" onSubmit={submitPasted} noValidate>
              <p className="muted small">
                For videos with no transcript available. On {platform}, open the video, find its transcript or captions, and copy the text across. Timestamps are fine to include.
              </p>
              <Field label="Transcript" error={error?.fields.transcript}>
                {(p) => <textarea {...p} className="textarea textarea-tall" value={pasted} onChange={(e) => setPasted(e.target.value)} maxLength={20000} />}
              </Field>
              <div>
                <button className="btn" disabled={pasted.trim().length < 40}>
                  Analyze with this transcript
                </button>
              </div>
            </form>
          </details>
        )}
      </section>

      {video.transcript && (
        <section className="stack">
          <details className="more">
            <summary>Transcript</summary>
            <p className="panel" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {video.transcript}
            </p>
          </details>
        </section>
      )}

      <section className="stack">
        <h2>Views at each check</h2>
        {history.filter((h) => h.viewCount !== null).length < 2 ? (
          <div className="ghost-chart panel" aria-label="Chart awaiting more data"><svg viewBox="0 0 600 150" preserveAspectRatio="none" aria-hidden="true"><path d="M0 130 C80 122 90 100 160 106 S250 70 330 82 S450 42 600 28" /><line x1="0" y1="145" x2="600" y2="145" /></svg><div><strong>First data point at next check</strong><span className="muted">Checked once so far, {ago(video.lastCheckedAt)}. {video.monitored ? 'We’ll start the trend line automatically.' : 'Use Update numbers later to start the chart.'}</span></div></div>
        ) : (
          <div className="panel">
            <ViewsChart history={history} />
            <details className="more" style={{ marginTop: 8 }}>
              <summary>Show every check as a table</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Checked</th>
                      <th className="num">Views</th>
                      <th className="num">Likes</th>
                      <th className="num">Comments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...history].reverse().map((h) => (
                      <tr key={h.takenAt}>
                        <td>{when(h.takenAt)}</td>
                        <td className="num">{h.viewCount === null ? 'Hidden' : num(h.viewCount)}</td>
                        <td className="num">{h.likeCount === null ? 'Hidden' : num(h.likeCount)}</td>
                        <td className="num">{h.commentCount === null ? 'Off' : num(h.commentCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
      </section>

      {earlier.length > 0 && (
        <section className="stack">
          <h2>Earlier breakdowns of this video</h2>
          <div className="panel panel-flush rows">
            {earlier.map((a) => (
              <Link key={a.id} href={`/app/library/${a.id}`}>
                <span className="title">{a.title}</span>
                <span className="small muted">{day(a.createdAt)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function VideoPage() {
  return (
    <Suspense>
      <VideoScreen />
    </Suspense>
  );
}
