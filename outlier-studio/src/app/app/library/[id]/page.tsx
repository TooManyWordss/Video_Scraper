'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AnalysisView, HooksList, ReportView } from '@/components/GenerationViews';
import { ScriptStage } from '@/components/ScriptStage';
import { CopyButton, ErrorNotice, Skeleton } from '@/components/ui';
import { api, type ApiError } from '@/lib/api';
import { KIND_LABEL, when } from '@/lib/format';
import type { Generation } from '@/lib/types';

export default function LibraryItemPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<Generation | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api<{ generation: Generation }>(`/api/generations/${id}`)
      .then((r) => setItem(r.generation))
      .catch(setError);
  }, [id]);

  async function remove() {
    setDeleting(true);
    try {
      await api(`/api/generations/${id}`, { method: 'DELETE' });
      router.replace('/app/library');
    } catch (err) {
      setError(err as ApiError);
      setDeleting(false);
      setConfirming(false);
    }
  }

  if (error && !item) {
    return (
      <div className="stack" style={{ maxWidth: 640 }}>
        {error.status === 404 ? (
          <div className="empty">
            <h2>This item is not in your library</h2>
            <p className="muted">It may have been deleted.</p>
          </div>
        ) : (
          <ErrorNotice error={error} />
        )}
        <div>
          <Link className="btn" href="/app/library">
            Back to Library
          </Link>
        </div>
      </div>
    );
  }
  if (!item) return <Skeleton lines={6} />;

  return (
    <div className="stack-lg" style={{ maxWidth: 900 }}>
      <header className="stack">
        <Link href="/app/library" className="small">
          Back to Library
        </Link>
        <h1 style={{ overflowWrap: 'anywhere' }}>{item.title}</h1>
        <div className="row small muted">
          <span className="tag">{KIND_LABEL[item.kind]}</span>
          Saved {when(item.createdAt)}
        </div>
      </header>

      {item.kind === 'hooks' && <HooksList hooks={item.output.hooks} topic={item.input.topic} />}
      {item.kind === 'script' && <ScriptStage text={item.output.text} status="Script" actions={<CopyButton text={item.output.text} label="Copy script" />} />}
      {item.kind === 'analysis' && <AnalysisView generationId={item.id} analysis={item.output} transcript={item.input.transcript} title={item.title} />}
      {item.kind === 'report' && <ReportView report={item.output} />}

      <ErrorNotice error={error} />
      <div className="row">
        {confirming ? (
          <>
            <span>Delete this permanently?</span>
            <button type="button" className="btn btn-danger" onClick={remove} disabled={deleting}>
              {deleting ? 'Deleting' : 'Delete'}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={deleting}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
