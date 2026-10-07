'use client';

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { ApiError, api, toApiError } from '@/lib/api';
import type { AnalysisInstructions } from '@/lib/types';
import { Icon } from './icons';
import { ErrorNotice, Field, Skeleton } from './ui';

const NAME_MAX = 80;
const MAX = 20_000;
const ACCEPT = '.pdf,.doc,.docx,.txt,.md,.markdown,.rtf,.csv,.json,.html,.htm,.xml,.yaml,.yml,text/*';

/** Ready-made starting points, so a first set is one click away. */
const STARTERS = [
  {
    name: 'Persuasion and psychology',
    content:
      'Focus on the psychology the video uses: curiosity gaps, social proof, authority, scarcity, loss aversion and identity. For each one, say exactly where it appears and how strongly it lands. Score the hook out of 10 and explain the score.',
  },
  {
    name: 'Educational creator',
    content:
      'I make educational videos. Pay close attention to how complex ideas are made simple: analogies, examples and the order of the steps. Point out where a viewer could get lost, and every moment the video wins attention back.',
  },
  {
    name: 'Ads and sales',
    content:
      'Analyse the video as a direct-response ad. Identify the problem, agitation and solution, the offer, the objections it handles, the proof it uses and the call to action. Suggest how the call to action could convert better.',
  },
];

type Draft = { name: string; content: string; isDefault: boolean };
const EMPTY: Draft = { name: '', content: '', isDefault: false };

/** Uploads one file and returns the text the server could read from it. */
async function importFile(file: File): Promise<{ fileName: string; text: string; truncated: boolean }> {
  const form = new FormData();
  form.append('file', file);
  let res: Response;
  try {
    res = await fetch('/api/instructions/import', { method: 'POST', body: form, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
  }
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

export function InstructionsManager() {
  const [items, setItems] = useState<AnalysisInstructions[] | null>(null);
  /** The set being edited, 'new' for an unsaved one, or null when nothing is open. */
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'deleting'>('idle');
  const [confirming, setConfirming] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [imported, setImported] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ items: AnalysisInstructions[] }>('/api/instructions')
      .then((r) => {
        setItems(r.items);
        const first = r.items.find((i) => i.isDefault) ?? r.items[0];
        if (first) open(first);
      })
      .catch(setError);
  }, []);

  function open(item: AnalysisInstructions | 'new', starter?: Omit<Draft, 'isDefault'>) {
    setSelected(item === 'new' ? 'new' : item.id);
    setDraft(item === 'new' ? { ...EMPTY, ...starter, isDefault: !items?.some((i) => i.isDefault) } : { name: item.name, content: item.content, isDefault: item.isDefault });
    setState('idle');
    setConfirming(false);
    setImported([]);
    setError(null);
  }

  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setState('idle');
  };

  async function addFiles(files: FileList | File[]) {
    setError(null);
    if (selected === null) open('new');
    for (const file of Array.from(files)) {
      setImporting(file.name);
      try {
        const r = await importFile(file);
        setDraft((d) => {
          const content = [d.content.trim(), r.text].filter(Boolean).join('\n\n').slice(0, MAX);
          // A new set with no name yet is named after its first file.
          const name = d.name || r.fileName.replace(/\.[^.]+$/, '').slice(0, NAME_MAX);
          return { ...d, content, name };
        });
        setImported((list) => [...list, r.truncated ? `${r.fileName} (cut to fit)` : r.fileName]);
      } catch (err) {
        setError(err as ApiError);
        break;
      } finally {
        setImporting(null);
      }
    }
    setState('idle');
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setState('saving');
    setError(null);
    try {
      const { instructions } =
        selected === 'new'
          ? await api<{ instructions: AnalysisInstructions }>('/api/instructions', { body: draft })
          : await api<{ instructions: AnalysisInstructions }>(`/api/instructions/${selected}`, { method: 'PUT', body: draft });
      // Only one set can be the default, so saving one as default clears the flag on the rest.
      setItems((list) => {
        const next = (list ?? []).map((i) => (instructions.isDefault ? { ...i, isDefault: false } : i));
        const at = next.findIndex((i) => i.id === instructions.id);
        if (at === -1) return [...next, instructions];
        next[at] = instructions;
        return next;
      });
      setSelected(instructions.id);
      setDraft({ name: instructions.name, content: instructions.content, isDefault: instructions.isDefault });
      setState('saved');
    } catch (err) {
      setError(err as ApiError);
      setState('idle');
    }
  }

  async function remove() {
    if (selected === null || selected === 'new') return;
    setState('deleting');
    try {
      await api(`/api/instructions/${selected}`, { method: 'DELETE' });
      const rest = (items ?? []).filter((i) => i.id !== selected);
      setItems(rest);
      if (rest[0]) open(rest[0]);
      else {
        setSelected(null);
        setDraft(EMPTY);
      }
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setState('idle');
      setConfirming(false);
    }
  }

  if (items === null) return error ? <ErrorNotice error={error} /> : <Skeleton lines={6} />;

  const fields = error?.fields ?? {};
  const current = items.find((i) => i.id === selected);

  return (
    <div className="instructions-layout">
      <aside className="panel panel-flush instructions-list" aria-label="Your instructions">
        <div className="instructions-list-head">
          <strong>Your sets</strong>
          <button type="button" className="btn btn-sm" onClick={() => open('new')}>
            New set
          </button>
        </div>
        {items.length === 0 && selected !== 'new' ? (
          <p className="muted small instructions-list-empty">None yet. Write your own, import a file, or start from an example.</p>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" aria-current={selected === item.id ? 'true' : undefined} onClick={() => open(item)}>
                  <span className="title">{item.name}</span>
                  {item.isDefault && <span className="tag">Default</span>}
                  <span className="muted small snippet">{item.content}</span>
                </button>
              </li>
            ))}
            {selected === 'new' && (
              <li>
                <button type="button" aria-current="true">
                  <span className="title">{draft.name || 'Untitled set'}</span>
                  <span className="muted small snippet">Not saved yet</span>
                </button>
              </li>
            )}
          </ul>
        )}
      </aside>

      <div
        className="instructions-editor"
        data-dragging={dragging || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={onDrop}
      >
        {selected === null ? (
          <div className="panel stack">
            <h2>Start a set of instructions</h2>
            <p className="muted">
              Instructions tell the analyst what you care about: what to look for, what to score, how to explain it. They are applied to every new breakdown, its long sentence-by-sentence version and its chat.
            </p>
            <div className="starter-grid">
              {STARTERS.map((s) => (
                <button key={s.name} type="button" className="starter" onClick={() => open('new', s)}>
                  <strong>{s.name}</strong>
                  <span className="muted small">{s.content}</span>
                </button>
              ))}
            </div>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => open('new')}>
                Write my own
              </button>
              <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
                <Icon.upload />
                Import a file
              </button>
            </div>
            <ErrorNotice error={error} />
          </div>
        ) : (
          <form className="panel stack" onSubmit={save} noValidate>
            <Field label="Name" error={fields.name}>
              {(p) => <input {...p} className="input" value={draft.name} onChange={(e) => edit({ name: e.target.value })} maxLength={NAME_MAX} placeholder="e.g. Fitness hooks, Sales videos" />}
            </Field>
            <Field
              label="Instructions"
              error={fields.content}
              hint={`Write what the analysis should focus on, in plain words. ${draft.content.length.toLocaleString()} of ${MAX.toLocaleString()} characters.`}
            >
              {(p) => (
                <textarea
                  {...p}
                  className="textarea textarea-tall"
                  value={draft.content}
                  onChange={(e) => edit({ content: e.target.value })}
                  maxLength={MAX}
                  placeholder="Look for how the video builds trust. Score the hook out of 10. Point out every pattern break, and tell me which tactics I could reuse for a cooking channel."
                />
              )}
            </Field>

            <div className="dropzone" role="group" aria-label="Import from a file">
              <Icon.upload />
              <div>
                <strong>{importing ? `Reading ${importing}` : 'Import from a file'}</strong>
                <span className="muted small">PDF, Word (.doc, .docx) or any text file, up to 10 MB. Drop files here or choose them. The text is added below what you have written.</span>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()} disabled={importing !== null}>
                Choose files
              </button>
            </div>
            {imported.length > 0 && (
              <p className="muted small" role="status">
                Imported {imported.join(', ')}. Review the text, then save.
              </p>
            )}

            <label className="check">
              <input type="checkbox" checked={draft.isDefault} onChange={(e) => edit({ isDefault: e.target.checked })} />
              <span>
                Use for every new analysis
                <span className="muted small"> You can still pick a different set, or none, on any video.</span>
              </span>
            </label>

            <ErrorNotice error={error} />
            <div className="row">
              <button className="btn btn-primary" disabled={state === 'saving' || importing !== null}>
                {state === 'saving' ? 'Saving' : selected === 'new' ? 'Save instructions' : 'Save changes'}
              </button>
              {current &&
                (confirming ? (
                  <>
                    <span>Delete this set?</span>
                    <button type="button" className="btn btn-danger" onClick={remove} disabled={state === 'deleting'}>
                      {state === 'deleting' ? 'Deleting' : 'Delete'}
                    </button>
                    <button type="button" className="btn" onClick={() => setConfirming(false)}>
                      Keep it
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
                    Delete
                  </button>
                ))}
              <span role="status" className="muted small">
                {state === 'saved' ? 'Saved. New analyses will follow it.' : ''}
              </span>
            </div>
          </form>
        )}
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
