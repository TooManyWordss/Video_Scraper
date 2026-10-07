'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CopyButton, ErrorNotice, PageHead, Skeleton } from '@/components/ui';
import { api, type ApiError } from '@/lib/api';
import { compact } from '@/lib/format';
import type { HookLibraryItem } from '@/lib/types';
import { PLATFORM_NAME } from '@/shared/video-url';
import { PlatformBadge } from '@/components/PlatformBadge';

export default function HookLibraryPage() {
  const [items, setItems] = useState<HookLibraryItem[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [query, setQuery] = useState('');
  const [pattern, setPattern] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  useEffect(() => {
    api<{ items: HookLibraryItem[] }>('/api/hook-library')
      .then((r) => setItems(r.items))
      .catch(setError);
  }, []);
  const patterns = useMemo(() => [...new Set((items ?? []).map((item) => item.hook.pattern).filter(Boolean))].slice(0, 8), [items]);
  const shown = useMemo(() => (items ?? []).filter((item) => (!pattern || item.hook.pattern === pattern) && (!query.trim() || `${item.hook.text} ${item.hook.whyItWorks} ${item.video?.title ?? item.title}`.toLowerCase().includes(query.trim().toLowerCase()))), [items, pattern, query]);

  return (
    <div className="hook-library-page">
      <PageHead title="Hook library" action={<Link className="btn btn-primary" href="/app/hooks">Write new hooks</Link>}>The opening line of every video you have broken down, with why it works.</PageHead>
      <div className="stack">
        <ErrorNotice error={error} />
        {!items && !error && <Skeleton lines={5} />}
        {items && items.length === 0 && (
          <div className="empty">
            <h2>No hooks yet</h2>
            <p className="muted">Each video you break down adds its hook here.</p>
            <div>
              <Link className="btn btn-primary" href="/app/feed">
                Pick a video to break down
              </Link>
            </div>
          </div>
        )}
        {items && items.length > 0 && <div className="library-tools"><label className="library-search"><span className="sr-only">Search hooks</span><input className="input" type="search" placeholder="Search hooks…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="chips" aria-label="Filter by pattern"><button type="button" className="chip" aria-pressed={!pattern} onClick={() => setPattern('')}>All patterns</button>{patterns.map((name) => <button type="button" className="chip" aria-pressed={pattern === name} key={name} onClick={() => setPattern(name)}>{name}</button>)}</div></div>}
        {items && items.length > 0 && (
          <ol className="hook-masonry">
            {shown.map((item) => (
              <li key={item.generationId} className="hook-card panel">
                <div className="hook-card-top"><span className="row">{item.video && <PlatformBadge platform={item.video.platform} iconOnly />}<span className="tag">{item.hook.pattern || 'Hook'}</span></span><button type="button" className="favorite-button" aria-label={`${favorites.has(item.generationId) ? 'Remove' : 'Add'} favorite`} aria-pressed={favorites.has(item.generationId)} onClick={() => setFavorites((current) => { const next = new Set(current); if (next.has(item.generationId)) next.delete(item.generationId); else next.add(item.generationId); return next; })}>♡</button></div>
                <blockquote className="hook-card-quote">“{item.hook.text}”</blockquote>
                <div className="hook-meta">
                  <span className="muted small">{item.hook.whyItWorks}</span>
                </div>
                <p className="small muted">
                  {item.video ? (
                    <>
                      From <Link href={`/app/videos/${item.video.id}`}>{item.video.title}</Link> by {item.video.channelTitle} on {PLATFORM_NAME[item.video.platform]}
                      {item.video.viewCount !== null && `, ${compact(item.video.viewCount)} views`}
                      {item.video.outlierMultiple !== null && `, ${item.video.outlierMultiple}x the channel's normal`}
                    </>
                  ) : (
                    <>From {item.title}</>
                  )}
                </p>
                <div className="row">
                  <CopyButton text={item.hook.text} className="btn btn-sm copy-pop" />
                  <Link className="btn btn-sm" href={`/app/hooks?${new URLSearchParams({ topic: item.video?.title ?? item.title })}`}>
                    Write hooks like this
                  </Link>
                  <Link className="btn btn-sm" href={`/app/library/${item.generationId}`}>
                    Open the breakdown
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        )}
        {items && items.length > 0 && shown.length === 0 && <div className="empty"><h2>No hooks match</h2><p className="muted">Try a different search or pattern.</p></div>}
      </div>
    </div>
  );
}
