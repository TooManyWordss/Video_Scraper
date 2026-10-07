'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { compact } from '@/lib/format';
import type { Analysis, Hook, LongBreakdown, Report, Technique } from '@/lib/types';
import { HOOK_PATTERN_LABELS } from '@/shared/catalog';
import { AnalysisChat } from './AnalysisChat';
import { CopyButton } from './ui';
import { BreakdownTabs } from './BreakdownTabs';
import { HookCallout } from './HookCallout';
import { Icon } from './icons';
import { LongBreakdownView } from './LongBreakdownView';

const scriptLink = (params: Record<string, string>) => `/app/scripts?${new URLSearchParams(params)}`;

export function HooksList({ hooks, topic }: { hooks: Hook[]; topic: string }) {
  return (
    <ol className="panel panel-flush hook-list">
      {hooks.map((hook, i) => (
        <li key={i} className="hook-item">
          <p className="hook-text">{hook.text}</p>
          <div className="hook-meta">
            <span className="tag">{HOOK_PATTERN_LABELS[hook.pattern] ?? hook.pattern}</span>
            <span className="muted small">{hook.why}</span>
          </div>
          <div className="row">
            <CopyButton text={hook.text} />
            <Link className="btn btn-sm" href={scriptLink({ hook: hook.text, idea: topic })}>
              Write a script with this hook
            </Link>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** sessionStorage key used to carry a long transcript from Analyze to Scripts. */
export const REMIX_KEY = 'remix-transcript';

const VIEWS = [
  { key: 'short', label: 'Short breakdown', hint: 'Tactics, tricks and techniques' },
  { key: 'long', label: 'Long breakdown', hint: 'The full script, line by line' },
  { key: 'chat', label: 'Chat', hint: 'Ask follow-up questions' },
] as const;
type ViewKey = (typeof VIEWS)[number]['key'];

/**
 * A saved analysis in three views: the short breakdown, the long
 * sentence-by-sentence breakdown, and a chat about it. Long and Chat need the
 * saved analysis id; without one only the short breakdown is shown.
 */
export function AnalysisView(props: { analysis: Analysis; transcript?: string; title?: string; hideMultiple?: boolean; generationId?: string }) {
  const { analysis, generationId } = props;
  const views = generationId ? VIEWS : VIEWS.slice(0, 1);
  const [view, setView] = useState<ViewKey>('short');
  /** Chat stays mounted once opened, so a half-typed question survives switching views. */
  const [opened, setOpened] = useState<Set<ViewKey>>(() => new Set(['short']));
  const [longBreakdown, setLongBreakdown] = useState<LongBreakdown | undefined>(analysis.longBreakdown);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();

  function select(next: ViewKey) {
    setView(next);
    setOpened((s) => new Set(s).add(next));
  }
  function onKeyDown(event: KeyboardEvent) {
    const at = views.findIndex((v) => v.key === view);
    let next = at;
    if (event.key === 'ArrowRight') next = (at + 1) % views.length;
    else if (event.key === 'ArrowLeft') next = (at - 1 + views.length) % views.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = views.length - 1;
    else return;
    event.preventDefault();
    select(views[next]!.key);
    buttons.current[next]?.focus();
  }

  return (
    <div className="stack">
      {views.length > 1 && (
        <div className="view-switch" role="tablist" aria-label="Breakdown views" onKeyDown={onKeyDown}>
          {views.map((v, i) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              id={`${id}-tab-${v.key}`}
              aria-controls={`${id}-panel-${v.key}`}
              aria-selected={view === v.key}
              tabIndex={view === v.key ? 0 : -1}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              onClick={() => select(v.key)}
            >
              <strong>{v.label}</strong>
              <span>{v.hint}</span>
            </button>
          ))}
        </div>
      )}
      {analysis.instructionsName && (
        <p className="muted small instructions-applied">
          <Icon.instructions /> Following your instructions: <strong>{analysis.instructionsName}</strong>
        </p>
      )}
      <div role={views.length > 1 ? 'tabpanel' : undefined} id={`${id}-panel-short`} aria-labelledby={`${id}-tab-short`} hidden={view !== 'short'}>
        <ShortBreakdown {...props} />
      </div>
      {generationId && opened.has('long') && (
        <div role="tabpanel" id={`${id}-panel-long`} aria-labelledby={`${id}-tab-long`} hidden={view !== 'long'}>
          <LongBreakdownView analysisId={generationId} breakdown={longBreakdown} onBuilt={setLongBreakdown} />
        </div>
      )}
      {generationId && opened.has('chat') && (
        <div role="tabpanel" id={`${id}-panel-chat`} aria-labelledby={`${id}-tab-chat`} hidden={view !== 'chat'}>
          <AnalysisChat analysisId={generationId} />
        </div>
      )}
    </div>
  );
}

const KIND_LABEL: Record<Technique['kind'], string> = { tactic: 'Tactics', trick: 'Tricks', technique: 'Techniques' };
const KIND_HINT: Record<Technique['kind'], string> = {
  tactic: 'The strategic choices: what the video sets out to do to the viewer.',
  trick: 'Small attention devices that keep people watching.',
  technique: 'Craft in the wording itself.',
};

/** The tactics, tricks and techniques, grouped by kind. Older analyses only have a plain list of tactics. */
function TechniquesSection({ analysis }: { analysis: Analysis }) {
  const techniques = analysis.techniques ?? [];
  if (techniques.length === 0) {
    if (!analysis.storytellingTactics?.length) return null;
    return (
      <section>
        <h2>Storytelling tactics</h2>
        <ul className="bullets">
          {analysis.storytellingTactics.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section>
      <h2>Tactics, tricks and techniques</h2>
      <div className="technique-groups">
        {(['tactic', 'trick', 'technique'] as const).map((kind) => {
          const group = techniques.filter((t) => t.kind === kind);
          if (group.length === 0) return null;
          return (
            <div key={kind} className="technique-group">
              <h3>
                {KIND_LABEL[kind]} <span className="muted small">{KIND_HINT[kind]}</span>
              </h3>
              <ul>
                {group.map((t, i) => (
                  <li key={i} className="technique">
                    <strong>{t.name}</strong>
                    {t.quote && <q>{t.quote}</q>}
                    <p className="muted small">{t.effect}</p>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ShortBreakdown({ analysis, transcript, title, hideMultiple }: { analysis: Analysis; transcript?: string; title?: string; hideMultiple?: boolean }) {
  const router = useRouter();

  /** Carries the transcript to another tool; returns the query flag to add when it worked. */
  function carry(): Record<string, string> {
    if (!transcript) return {};
    try {
      sessionStorage.setItem(REMIX_KEY, transcript);
      return { remix: '1' };
    } catch {
      return {};
    }
  }

  function remix(idea: { title: string; angle: string }) {
    let carried = false;
    if (transcript) {
      try {
        sessionStorage.setItem(REMIX_KEY, transcript);
        carried = true;
      } catch {
        /* storage unavailable: the script is written without the reference */
      }
    }
    router.push(scriptLink({ idea: `${idea.title}. ${idea.angle}`, ...(carried ? { remix: '1' } : {}) }));
  }

  return (
    <div className="panel analysis bg-surface text-text border-border">
      <BreakdownTabs
        onScript={() => router.push(scriptLink({ idea: title ?? analysis.summary, ...carry() }))}
        onHooks={() => router.push(`/app/hooks?${new URLSearchParams({ topic: title ?? analysis.summary, ...carry() })}`)}
      />
      <section className="analysis-overview">
        <p className="eyebrow text-muted">At a glance</p>
        {analysis.outlierMultiple !== null && !hideMultiple && (
          <p className="multiple">
            <b>{analysis.outlierMultiple}x</b>
            <span className="muted">this channel&apos;s median views</span>
          </p>
        )}
        <p className="analysis-summary">{analysis.summary}</p>
        <div className="row">
          <span className="tag">{analysis.format}</span>
          {analysis.topics.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </div>
      </section>

      <HookCallout hook={analysis.hook} />

      <TechniquesSection analysis={analysis} />

      {analysis.customFocus && analysis.customFocus.length > 0 && (
        <section>
          <h2>What your instructions asked for</h2>
          <ol className="beats">
            {analysis.customFocus.map((f, i) => (
              <li key={i}>
                <div>
                  <strong>{f.point}</strong>
                  <p>{f.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {analysis.structure.length > 0 && (
        <section>
          <h2>How it is built</h2>
          <ol className="beats">
            {analysis.structure.map((s, i) => (
              <li key={i}>
                <div>
                  <strong>{s.section}</strong>
                  <p>{s.summary}</p>
                  <p className="muted small">{s.purpose}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {analysis.takeaways.length > 0 && (
        <section>
          <h2>What to take from it</h2>
          <ul className="bullets">
            {analysis.takeaways.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      )}

      {analysis.remixIdeas.length > 0 && (
        <section>
          <h2>Remix it</h2>
          <p className="muted small">Each idea keeps this video&apos;s structure and changes the subject.</p>
          <div>
            {analysis.remixIdeas.map((idea, i) => (
              <div key={i} className="remix">
                <strong>{idea.title}</strong>
                <p>{idea.angle}</p>
                <div>
                  <button type="button" className="btn btn-sm" onClick={() => remix(idea)}>
                    Write this script
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="muted small">Based on the transcript only. Visuals, editing and audio are not analysed.</p>
    </div>
  );
}

export function ReportView({ report }: { report: Report }) {
  const f = report.facts;
  return (
    <div className="stack-lg">
      <div className="tiles">
        <div className="tile">
          <b>{f.subscribers === null ? 'Hidden' : compact(f.subscribers)}</b>
          <span>Subscribers</span>
        </div>
        <div className="tile">
          <b>{f.uploadsInLast30Days}</b>
          <span>Uploads in the last 30 days</span>
        </div>
        <div className="tile">
          <b>{f.typicalShortViews === null ? 'None' : compact(f.typicalShortViews)}</b>
          <span>Typical views on a Short</span>
        </div>
        <div className="tile">
          <b>{f.videosConsidered}</b>
          <span>Videos this report looked at</span>
        </div>
      </div>
      <div className="panel analysis">
        <section>
          <p>{report.summary}</p>
        </section>
        <section>
          <h2>What is working</h2>
          <ol className="beats">
            {report.whatIsWorking.map((w, i) => (
              <li key={i}>
                <div>
                  <strong>{w.pattern}</strong>
                  <p className="muted">{w.evidence}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        {report.whatIsNot.length > 0 && (
          <section>
            <h2>What is not</h2>
            <ul className="bullets">
              {report.whatIsNot.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </section>
        )}
        {report.topics.length > 0 && (
          <section>
            <h2>Topics</h2>
            <div>
              {report.topics.map((t, i) => (
                <div key={i} className="remix">
                  <strong>{t.topic}</strong>
                  <p className="muted">{t.note}</p>
                </div>
              ))}
            </div>
          </section>
        )}
        {report.titlePatterns.length > 0 && (
          <section>
            <h2>Title patterns</h2>
            <ul className="bullets">
              {report.titlePatterns.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h2>{report.isOwn ? 'What to do next' : 'What to try on your channel'}</h2>
          <ul className="bullets">
            {report.recommendations.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
        <p className="muted small">Written from titles, lengths and view counts at the time of the report, plus the hooks from your own breakdowns of this channel.</p>
      </div>
    </div>
  );
}
