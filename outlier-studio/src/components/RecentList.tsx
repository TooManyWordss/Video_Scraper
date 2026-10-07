'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, type ApiError } from '@/lib/api';
import { day, KIND_LABEL } from '@/lib/format';
import type { GenerationSummary } from '@/lib/types';
import { PlatformBadge } from './PlatformBadge';
import { ErrorNotice, Skeleton } from './ui';

export function GenerationRows({ items }: { items: GenerationSummary[] }) {
  return (
    <div className="panel panel-flush rows">
      {items.map((g) => (
        <Link key={g.id} href={`/app/library/${g.id}`}>
          <span className="title">{g.title}</span>
          <span className="row small muted">
            {g.platform && <PlatformBadge platform={g.platform} />}
            <span className="tag">{KIND_LABEL[g.kind]}</span>
            {day(g.createdAt)}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function RecentList() {
  const [items, setItems] = useState<GenerationSummary[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => {
    api<{ items: GenerationSummary[] }>('/api/generations?limit=5')
      .then((r) => setItems(r.items))
      .catch(setError);
  }, []);

  if (error) return <ErrorNotice error={error} />;
  if (!items) return <Skeleton />;
  if (items.length === 0) return <p className="muted">Nothing saved yet. Everything you generate is kept in your Library.</p>;
  return <GenerationRows items={items} />;
}
