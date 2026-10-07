'use client';

import { useState } from 'react';
import { api, type ApiError } from '@/lib/api';
import { day } from '@/lib/format';
import type { Generation, LongBreakdown } from '@/lib/types';
import { CopyButton, ErrorNotice, Skeleton } from './ui';

type AnalysisGeneration = Extract<Generation, { kind: 'analysis' }>;

/** The whole breakdown as plain text, for pasting into notes. */
function asText(b: LongBreakdown): string {
  return b.lines
    .map((l, i) => [`${i + 1}. "${l.text}"`, [l.role, l.technique].filter(Boolean).join(' · '), l.explanation].filter(Boolean).join('\n   '))
    .join('\n\n');
}

/**
 * The complete script, then every sentence of it with the beat it serves, the
 * device it uses and why it is there. Built on request, since it takes a
 * minute and several AI calls on a long video.
 */
export function LongBreakdownView({ analysisId, breakdown, onBuilt }: { analysisId: string; breakdown?: LongBreakdown; onBuilt: (b: LongBreakdown) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function build() {
    setBusy(true);
    setError(null);
    try {
      const { generation } = await api<{ generation: AnalysisGeneration }>(`/api/analyses/${analysisId}/breakdown`, { method: 'POST' });
      if (generation.output.longBreakdown) onBuilt(generation.output.longBreakdown);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <div className="panel stack" aria-busy="true">
        <p role="status">
          <span className="tally" style={{ display: 'inline-block', marginRight: 8 }} aria-hidden="true" />
          Going through the script sentence by sentence. Long videos can take a minute.
        </p>
        <Skeleton lines={8} />
      </div>
    );
  }

  if (!breakdown) {
    return (
      <div className="panel stack">
        <h2>Long breakdown</h2>
        <p className="muted">
          See the complete script, then every sentence of it explained: which beat it belongs to, which technique it uses and why it is worded that way. It follows the same instructions as this analysis.
        </p>
        <ErrorNotice error={error} />
        <div>
          <button type="button" className="btn btn-primary" onClick={build}>
            Build the long breakdown
          </button>
        </div>
      </div>
    );
  }

  const script = breakdown.lines.map((l) => l.text).join(' ');
  return (
    <div className="panel analysis long-breakdown">
      <section>
        <div className="section-heading">
          <h2>Complete script</h2>
          <CopyButton text={script} label="Copy script" />
        </div>
        <p className="script-full">{script}</p>
        {breakdown.truncated && <p className="muted small">This video is very long, so only its first {breakdown.lines.length} lines are included.</p>}
      </section>

      <section>
        <div className="section-heading">
          <h2>Sentence by sentence</h2>
          <CopyButton text={asText(breakdown)} label="Copy breakdown" />
        </div>
        <ol className="line-list">
          {breakdown.lines.map((line, i) => (
            <li key={i}>
              <span className="line-number" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <p className="line-text">{line.text}</p>
                {(line.role || line.technique) && (
                  <div className="row line-tags">
                    {line.role && <span className="tag">{line.role}</span>}
                    {line.technique && <span className="tag tag-quiet">{line.technique}</span>}
                  </div>
                )}
                {line.explanation && <p className="muted small">{line.explanation}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <ErrorNotice error={error} />
      <div className="row">
        <button type="button" className="btn btn-sm" onClick={build}>
          Rebuild
        </button>
        <span className="muted small">Built {day(breakdown.createdAt)}. Rebuilding follows the same instructions as the analysis.</span>
      </div>
    </div>
  );
}
