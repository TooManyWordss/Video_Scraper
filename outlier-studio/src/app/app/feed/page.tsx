'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AddVideoForm } from '@/components/AddVideoForm';
import { Picture } from '@/components/Picture';
import { ErrorNotice, Skeleton } from '@/components/ui';
import { PageHead } from '@/components/ui';
import { SelectMenu } from '@/components/SelectMenu';
import { PlatformBadge } from '@/components/PlatformBadge';
import { api, type ApiError } from '@/lib/api';
import { ago, compact } from '@/lib/format';
import type { ChannelList, FeedVideo } from '@/lib/types';

type Page = { items: FeedVideo[]; nextOffset: number | null };

const SORTS = { outlier: 'Outlier score', views: 'Most views', engagement: 'Engagement', momentum: 'Growing fastest', recent: 'Newest' } as const;
const UNIT_DAYS = { days: 1, weeks: 7, months: 30 } as const;

type Filters = {
  channel: string;
  q: string;
  minOutlier: string;
  maxOutlier: string;
  minViews: string;
  maxViews: string;
  minEngagement: string;
  maxEngagement: string;
  within: string;
  unit: keyof typeof UNIT_DAYS;
  platform: '' | 'youtube' | 'tiktok' | 'instagram';
  type: 'all' | 'shorts' | 'long';
  analyzed: boolean;
  unanalyzed: boolean;
  sort: keyof typeof SORTS;
};

const DEFAULTS: Filters = {
  channel: '', q: '', minOutlier: '', maxOutlier: '', minViews: '', maxViews: '', minEngagement: '', maxEngagement: '',
  within: '', unit: 'months', platform: '', type: 'all', analyzed: true, unanalyzed: true, sort: 'outlier',
};
const SAVED_KEY = 'videos.savedFilter';

function loadSaved(): Filters | null {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Filters>) } : null;
  } catch {
    return null;
  }
}

function toQuery(f: Filters, offset: number): URLSearchParams {
  const q = new URLSearchParams({ type: f.type, sort: f.sort, offset: String(offset), days: 'all' });
  if (f.channel) {
    q.set('channelId', f.channel);
    q.set('scope', 'all');
  }
  const within = Number(f.within);
  if (f.within && within > 0) q.set('withinDays', String(Math.round(within * UNIT_DAYS[f.unit])));
  const nums: [keyof Filters, string][] = [
    ['minOutlier', 'minOutlier'], ['maxOutlier', 'maxOutlier'], ['minViews', 'minViews'], ['maxViews', 'maxViews'],
    ['minEngagement', 'minEngagement'], ['maxEngagement', 'maxEngagement'],
  ];
  for (const [key, param] of nums) {
    const v = String(f[key]).replace(/[,\s%x]/gi, '');
    if (v !== '' && Number.isFinite(Number(v))) q.set(param, v);
  }
  if (f.q.trim()) q.set('q', f.q.trim());
  if (f.platform) q.set('platform', f.platform);
  q.set('status', f.analyzed && f.unanalyzed ? 'all' : f.analyzed ? 'analyzed' : 'unanalyzed');
  return q;
}

function engagementRate(v: FeedVideo): number | null {
  if (!v.viewCount) return null;
  const rate = (((v.likeCount ?? 0) + (v.commentCount ?? 0)) / v.viewCount) * 100;
  return rate < 10 ? Math.round(rate * 10) / 10 : Math.round(rate);
}

const svg = { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const TrendIcon = () => (<svg {...svg}><path d="M2 11l4-4 3 3 5-6" /><path d="M10 4h4v4" /></svg>);
const EyeIcon = () => (<svg {...svg}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></svg>);
const SparkIcon = () => (<svg {...svg}><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.5 3.5l2 2M10.5 10.5l2 2M12.5 3.5l-2 2M5.5 10.5l-2 2" /></svg>);

const isPortraitVideo = (video: FeedVideo) => video.isShort || video.platform !== 'youtube';

function VideoCard({ video }: { video: FeedVideo }) {
  const eng = engagementRate(video);
  const portrait = isPortraitVideo(video);
  return (
    <Link className="vcard" href={`/app/videos/${video.id}`} data-short={portrait}>
      <span className="vcard-media">
        <Picture className="vthumb" src={video.thumbnailUrl} />
        <PlatformBadge platform={video.platform} iconOnly className="vcard-badge" />
        {video.analyzed && <span className="vcard-done">Analyzed</span>}
        {video.outlierMultiple !== null && <span className="vcard-outlier"><TrendIcon />{video.outlierMultiple}x</span>}
        <span className="vcard-quick">Break down <span aria-hidden="true">→</span></span>
      </span>
      <span className="vcard-title" title={video.title}>{video.title}</span>
      <span className="vcard-meta">
        <span>{video.channelHandle ?? video.channelTitle}</span>
        <span>{ago(video.publishedAt)}</span>
      </span>
      <span className="vcard-stats">
        {video.viewCount !== null && <span title="Views"><EyeIcon />{compact(video.viewCount)} views</span>}
        {eng !== null && <span title="Likes and comments per view"><SparkIcon />{eng}% engagement</span>}
      </span>
    </Link>
  );
}

function VideoGroup({ title, orientation, videos }: { title: string; orientation: 'horizontal' | 'vertical'; videos: FeedVideo[] }) {
  if (videos.length === 0) return null;
  return (
    <section className="video-orientation-group" aria-label={`${title} videos`}>
      <div className="video-orientation-head">
        <h2>{title}</h2>
        <span>{videos.length}</span>
      </div>
      <div className="vgrid" data-orientation={orientation}>
        {videos.map((video) => <VideoCard key={video.id} video={video} />)}
      </div>
    </section>
  );
}

function Range({ label, min, max, onMin, onMax, minHint, maxHint }: {
  label: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void; minHint: string; maxHint: string;
}) {
  return (
    <div className="filter">
      <span>{label}</span>
      <div className="range">
        <input className="input" inputMode="decimal" aria-label={`${label}, minimum`} placeholder={minHint} value={min} onChange={(e) => onMin(e.target.value)} />
        <span>–</span>
        <input className="input" inputMode="decimal" aria-label={`${label}, maximum`} placeholder={maxHint} value={max} onChange={(e) => onMax(e.target.value)} />
      </div>
    </div>
  );
}

function Feed() {
  const params = useSearchParams();
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [savedNote, setSavedNote] = useState('');

  // A link from Channels (?channel=…) wins over the saved filter.
  useEffect(() => {
    const channel = params.get('channel');
    if (channel) setFilters({ ...DEFAULTS, channel, within: params.get('days') === 'all' ? '' : DEFAULTS.within });
    else setFilters(loadSaved() ?? DEFAULTS);
    setReady(true);
  }, [params]);

  const [channels, setChannels] = useState<ChannelList | null>(null);
  const [videos, setVideos] = useState<FeedVideo[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const pagingRef = useRef(false);
  const feedVersionRef = useRef(0);

  useEffect(() => {
    api<ChannelList>('/api/channels').then(setChannels).catch(() => undefined);
  }, []);

  const noStatus = !filters.analyzed && !filters.unanalyzed;
  const query = toQuery(filters, 0).toString();

  const fetchPage = useCallback((offset: number) => {
    const q = new URLSearchParams(query);
    q.set('offset', String(offset));
    return api<Page>(`/api/videos?${q}`);
  }, [query]);

  useEffect(() => {
    if (!ready) return;
    const version = ++feedVersionRef.current;
    pagingRef.current = true;
    setLoadingMore(false);
    if (noStatus) {
      pagingRef.current = false;
      setVideos([]);
      setNext(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    // Typing in a range box should not send a request per keystroke.
    const timer = setTimeout(() => {
      fetchPage(0)
        .then((page) => {
          if (!live || version !== feedVersionRef.current) return;
          setVideos(page.items);
          setNext(page.nextOffset);
        })
        .catch((err) => live && setError(err))
        .finally(() => {
          if (!live || version !== feedVersionRef.current) return;
          pagingRef.current = false;
          setLoading(false);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [fetchPage, ready, noStatus]);

  const set = <K extends keyof Filters>(name: K, value: Filters[K]) => {
    setSavedNote('');
    setFilters((f) => ({ ...f, [name]: value }));
  };

  function save() {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(filters));
      setSavedNote('Saved');
    } catch {
      setSavedNote('Could not save in this browser');
    }
  }

  const more = useCallback(async () => {
    if (next === null || loading || pagingRef.current) return;
    const version = feedVersionRef.current;
    pagingRef.current = true;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchPage(next);
      if (version !== feedVersionRef.current) return;
      setVideos((current) => {
        const existing = new Set((current ?? []).map((video) => video.id));
        return [...(current ?? []), ...page.items.filter((video) => !existing.has(video.id))];
      });
      setNext(page.nextOffset);
    } catch (err) {
      if (version === feedVersionRef.current) setError(err as ApiError);
    } finally {
      if (version === feedVersionRef.current) {
        pagingRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [fetchPage, loading, next]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || next === null || !videos?.length || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void more();
    }, { rootMargin: '700px 0px', threshold: 0.01 });

    observer.observe(target);
    return () => observer.disconnect();
  }, [more, next, videos?.length]);

  const noChannels = channels !== null && channels.items.length === 0;

  const topOutlier = videos?.reduce<number | null>((best, video) => video.outlierMultiple === null ? best : Math.max(best ?? 0, video.outlierMultiple), null) ?? null;
  const horizontalVideos = videos?.filter((video) => !isPortraitVideo(video)) ?? [];
  const verticalVideos = videos?.filter(isPortraitVideo) ?? [];
  return (
    <div className="feed-page stack-lg">
      <PageHead title="Videos" action={<details className="menu"><summary className="btn btn-primary">Add video</summary><div className="menu-items add-video-popover"><AddVideoForm /></div></details>}>
        Track what is breaking out, then turn the strongest patterns into your next idea.
      </PageHead>
      <section className="feed-stats" aria-label="Video overview">
        <div><strong>{videos?.length ?? '—'}</strong><span>Videos in view</span></div>
        <div><strong>{channels?.items.length ?? '—'}</strong><span>Channels tracked</span></div>
        <div><strong>{topOutlier === null ? '—' : `${topOutlier}x`}</strong><span>Top outlier this period</span></div>
      </section>
      <section className="filter-toolbar" aria-label="Video filters">
        <SelectMenu label="Channel filter" value={filters.channel} onChange={(value) => set('channel', value)} options={[{ value: '', label: 'All channels' }, ...(channels?.items.map((channel) => ({ value: channel.id, label: `${channel.title}${channel.isOwn ? ' (yours)' : ''}` })) ?? [])]} />
        <SelectMenu label="Platform filter" value={filters.platform} onChange={(value) => set('platform', value as Filters['platform'])} options={[{ value: '', label: 'All platforms' }, { value: 'youtube', label: 'YouTube', icon: 'youtube' }, { value: 'instagram', label: 'Instagram', icon: 'instagram' }, { value: 'tiktok', label: 'TikTok', icon: 'tiktok' }]} />
        <SelectMenu label="Format filter" value={filters.type} onChange={(value) => set('type', value as Filters['type'])} options={[{ value: 'all', label: 'All formats' }, { value: 'shorts', label: 'Short-form' }, { value: 'long', label: 'Long-form' }]} />
        <SelectMenu label="Sort videos" value={filters.sort} onChange={(value) => set('sort', value as Filters['sort'])} options={Object.entries(SORTS).map(([value, label]) => ({ value, label }))} />
        <details className="more-filters">
          <summary className="filter-pill">More filters</summary>
          <div className="filter-drawer-panel">
            <div className="filter-drawer-head"><strong>More filters</strong><button type="button" className="link-btn" onClick={() => { setFilters(DEFAULTS); setSavedNote(''); }}>Clear all</button></div>
            <label className="filter"><span>Keywords</span><input className="input" type="search" placeholder="Search captions and titles" value={filters.q} onChange={(e) => set('q', e.target.value)} maxLength={100} /></label>
            <div className="advanced-ranges">
              <Range label="Outlier score" min={filters.minOutlier} max={filters.maxOutlier} onMin={(v) => set('minOutlier', v)} onMax={(v) => set('maxOutlier', v)} minHint="1x" maxHint="100x" />
              <Range label="Views" min={filters.minViews} max={filters.maxViews} onMin={(v) => set('minViews', v)} onMax={(v) => set('maxViews', v)} minHint="0" maxHint="10M" />
              <Range label="Engagement" min={filters.minEngagement} max={filters.maxEngagement} onMin={(v) => set('minEngagement', v)} onMax={(v) => set('maxEngagement', v)} minHint="0%" maxHint="100%" />
            </div>
            <div className="filter-row"><input className="input" inputMode="numeric" aria-label="Posted in last, amount" placeholder="Any period" value={filters.within} onChange={(e) => set('within', e.target.value.replace(/\D/g, ''))} /><SelectMenu label="Period unit" value={filters.unit} onChange={(value) => set('unit', value as Filters['unit'])} options={[{ value: 'days', label: 'Days' }, { value: 'weeks', label: 'Weeks' }, { value: 'months', label: 'Months' }]} /></div>
            <div className="toggles"><label className="toggle"><input type="checkbox" checked={filters.analyzed} onChange={(e) => set('analyzed', e.target.checked)} />Analyzed</label><label className="toggle"><input type="checkbox" checked={filters.unanalyzed} onChange={(e) => set('unanalyzed', e.target.checked)} />Unanalyzed</label></div>
            <button type="button" className="btn" onClick={save}>{savedNote || 'Save filter'}</button>
          </div>
        </details>
      </section>

      <section aria-label="Videos" aria-busy={loading || loadingMore}>

        <div className="stack">
          <ErrorNotice error={error} />
          {!videos && !error && <Skeleton lines={6} />}
          {videos && videos.length === 0 && !loading && (
            <div className="empty">
              {noChannels ? (
                <>
                  <h2>Add a channel to fill this page</h2>
                  <p className="muted">Track a YouTube channel or Instagram account and its new posts show up here, ranked by how far they beat that creator&apos;s normal.</p>
                  <div className="row">
                    <Link className="btn btn-primary" href="/app/discover">Find channels</Link>
                    <Link className="btn" href="/app/competitors">Paste a channel link</Link>
                  </div>
                </>
              ) : noStatus ? (
                <>
                  <h2>Pick a status</h2>
                  <p className="muted">Tick Analyzed, Unanalyzed, or both.</p>
                </>
              ) : (
                <>
                  <h2>No videos match these filters</h2>
                  <p className="muted">Widen a range or a time period, or press Clear.</p>
                </>
              )}
            </div>
          )}
          {videos && videos.length > 0 && (
            <div className="video-orientation-groups" style={{ opacity: loading ? 0.55 : 1 }}>
              <VideoGroup title="Long form" orientation="horizontal" videos={horizontalVideos} />
              <VideoGroup title="Short form" orientation="vertical" videos={verticalVideos} />
            </div>
          )}
          {videos && videos.length > 0 && (
            <div ref={loadMoreRef} className="feed-sentinel" aria-live="polite">
              {loadingMore ? (
                <><span className="feed-loader" aria-hidden="true" />Loading more videos...</>
              ) : next !== null ? (
                <button type="button" className="btn feed-more-fallback" onClick={() => void more()} disabled={loading}>
                  Load more videos
                </button>
              ) : (
                <span>You&apos;ve reached the end.</span>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default function FeedPage() {
  return (
    <Suspense>
      <Feed />
    </Suspense>
  );
}
