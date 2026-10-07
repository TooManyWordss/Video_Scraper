'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Picture } from '@/components/Picture';
import { PlatformBadge } from '@/components/PlatformBadge';
import { ErrorNotice, PageHead, Skeleton } from '@/components/ui';
import { api, type ApiError } from '@/lib/api';
import { compact } from '@/lib/format';
import type { ChannelList } from '@/lib/types';
import { TIERS, TIER_LABEL, type TierKey } from '@/shared/tiers';
import { youtubeChannelUrl } from '@/shared/youtube-url';
import { parseChannelInput } from '@/shared/channel-url';
import { parseVideoLink } from '@/shared/video-url';

type Result = {
  platform: 'youtube' | 'instagram';
  externalId: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
  tier: TierKey;
};

const FILTERS: ('all' | TierKey)[] = ['all', ...TIERS.map((t) => t.key), 'unknown'];

export default function DiscoverPage() {
  const router = useRouter();
  const [platform, setPlatform] = useState<'youtube' | 'instagram'>('youtube');
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState<'all' | TierKey>('all');
  const [results, setResults] = useState<Result[] | null>(null);
  const [searched, setSearched] = useState('');
  const [tracked, setTracked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [direct, setDirect] = useState<{ kind: 'video' | 'channel'; platform: 'youtube' | 'instagram' | 'tiktok'; url: string; label: string } | null>(null);
  const visibleResults = results?.filter((item) => tier === 'all' || item.tier === tier) ?? null;

  useEffect(() => {
    api<ChannelList>('/api/channels')
      .then((list) => setTracked(new Set(list.items.map((c) => `${c.platform}:${c.externalId}`))))
      .catch(() => undefined);
  }, []);

  async function search(e: FormEvent) {
    e.preventDefault();
    const video = parseVideoLink(query);
    if (video.ok) {
      setDirect({ kind: 'video', platform: video.platform, url: video.url, label: query.trim() });
      setResults(null);
      setError(null);
      return;
    }
    const channel = parseChannelInput(query);
    if (channel.ok) {
      setDirect({ kind: 'channel', platform: channel.channel.platform, url: query.trim(), label: query.trim() });
      setResults(null);
      setError(null);
      return;
    }
    setDirect(null);
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: query, platform });
      const data = await api<{ items: Result[]; query: string }>(`/api/discover?${params}`);
      setResults(data.items);
      setSearched(data.query);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }

  async function addDirect() {
    if (!direct) return;
    setBusy(direct.url);
    setError(null);
    try {
      if (direct.kind === 'video') {
        const { videoId } = await api<{ videoId: string }>('/api/videos', { body: { url: direct.url } });
        router.push(`/app/videos/${videoId}`);
      } else {
        await api('/api/channels', { body: { url: direct.url } });
        const parsed = parseChannelInput(direct.url);
        if (parsed.ok) {
          const id = parsed.channel.platform === 'instagram' ? parsed.channel.username : direct.url;
          setTracked((prev) => new Set(prev).add(`${parsed.channel.platform}:${id}`));
        }
        setDirect(null);
        router.push('/app/competitors');
      }
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(null);
    }
  }

  async function track(channel: Result) {
    setBusy(channel.externalId);
    setError(null);
    try {
      const url = channel.platform === 'instagram'
        ? `https://www.instagram.com/${channel.externalId}/`
        : youtubeChannelUrl(channel.externalId);
      await api('/api/channels', { body: { url } });
      setTracked((prev) => new Set(prev).add(`${channel.platform}:${channel.externalId}`));
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack-lg" style={{ maxWidth: 1100 }}>
      <PageHead title="Discover">Search a niche on YouTube or Instagram and sort accounts by size. Add the ones worth watching to your watchlist.</PageHead>

      <div className="tabs" role="group" aria-label="Discovery platform">
        {(['youtube', 'instagram'] as const).map((value) => (
          <button key={value} type="button" aria-pressed={platform === value} onClick={() => { setPlatform(value); setResults(null); setDirect(null); setError(null); }}>
            {value === 'youtube' ? 'YouTube' : 'Instagram'}
          </button>
        ))}
      </div>

      <form onSubmit={search} className="discover-search" role="search" style={{ display: 'flex', gap: 8 }}>
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={platform === 'instagram' ? 'Search a niche or paste an Instagram link' : 'Search a niche or paste a video or channel link'}
          aria-label={`${platform === 'instagram' ? 'Instagram' : 'YouTube'} niche to search`}
          maxLength={100}
        />
        <button className="btn btn-primary" disabled={loading || query.trim().length < 2}>
          {loading ? 'Searching' : 'Search'}
        </button>
      </form>

      {!direct && <div className="chips" role="group" aria-label="Filter by follower tier">
        {FILTERS.map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={tier === f} onClick={() => setTier(f)}>
            {f === 'all' ? 'All sizes' : TIER_LABEL[f]}
          </button>
        ))}
      </div>}

      <ErrorNotice error={error} />

      {direct && <div className="panel stack">
        <span className="channel-title-row">
          <PlatformBadge platform={direct.platform} />
          <strong>{direct.kind === 'video' ? 'Video' : 'Account'}</strong>
        </span>
        <span className="muted small" style={{ overflowWrap: 'anywhere' }}>{direct.label}</span>
        <div><button type="button" className="btn btn-primary" disabled={busy !== null} onClick={addDirect}>{busy ? 'Adding' : direct.kind === 'video' ? 'Add video' : 'Add to watchlist'}</button></div>
      </div>}

      {loading && <Skeleton lines={5} />}

      {!loading && visibleResults && visibleResults.length === 0 && (
        <p className="muted">No {platform === 'instagram' ? 'Instagram accounts' : 'YouTube channels'} matched &ldquo;{searched}&rdquo;{tier !== 'all' ? ` in ${TIER_LABEL[tier]} size` : ''}. Try a broader niche or another size.</p>
      )}

      {!loading && visibleResults && visibleResults.length > 0 && (
        <ul className="panel panel-open">
          {visibleResults.map((c) => (
            <li key={`${c.platform}:${c.externalId}`} className="channel">
              <Picture className="avatar" src={c.thumbnailUrl} name={c.title} />
              <div className="channel-name">
                <span className="channel-title-row">
                  <span>{c.title}</span>
                  <PlatformBadge platform={c.platform} />
                </span>
                <span className="muted small">
                  {c.handle ?? (c.platform === 'instagram' ? 'Instagram' : 'YouTube')} · {TIER_LABEL[c.tier]} · {c.videoCount ?? 0} {c.platform === 'instagram' ? 'posts' : 'videos'}
                </span>
              </div>
              <div className="stat">
                <b>{c.subscriberCount === null ? 'Hidden' : compact(c.subscriberCount)}</b>
                <span>{c.platform === 'instagram' ? 'followers' : 'subscribers'}</span>
              </div>
              {tracked.has(`${c.platform}:${c.externalId}`) ? (
                <span className="muted small">On your watchlist</span>
              ) : (
                <button type="button" className="btn btn-sm" onClick={() => track(c)} disabled={busy !== null}>
                  {busy === c.externalId ? 'Adding' : 'Add to watchlist'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
