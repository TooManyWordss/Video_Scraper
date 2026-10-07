'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Picture } from '@/components/Picture';
import { PlatformBadge } from '@/components/PlatformBadge';
import { ErrorNotice, Field, PageHead, Skeleton } from '@/components/ui';
import { api, type ApiError } from '@/lib/api';
import { ago, compact, day, num, signed } from '@/lib/format';
import type { ChannelList, Generation, TrackedChannel } from '@/lib/types';
import { PLATFORM_NAME } from '@/shared/video-url';
import { parseChannelInput } from '@/shared/channel-url';
import { authorUrl } from '@/shared/youtube-url';

type Action = 'check' | 'remove' | 'report' | 'own';

function ChannelRow({ channel, onChanged }: { channel: TrackedChannel; onChanged: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);

  async function act(kind: Action) {
    if (menu.current) menu.current.open = false;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'check') await api(`/api/channels/${channel.id}/refresh`, { method: 'POST' });
      if (kind === 'remove') await api(`/api/channels/${channel.id}`, { method: 'DELETE' });
      if (kind === 'own') await api(`/api/channels/${channel.id}`, { method: 'PUT', body: { isOwn: !channel.isOwn } });
      if (kind === 'report') {
        const { generation } = await api<{ generation: Generation }>('/api/ai/report', { body: { channelId: channel.id } });
        router.push(`/app/library/${generation.id}`);
        return;
      }
      onChanged();
    } catch (err) {
      setError(err as ApiError);
      if (kind === 'check') onChanged();
          } finally {
      setBusy(null);
      setConfirming(false);
    }
  }

  // Growth needs two checks at least an hour apart to mean anything.
  const hasGrowth =
    channel.subscribersGained !== null && channel.growthSince && channel.lastCheckedAt && new Date(channel.lastCheckedAt).getTime() - new Date(channel.growthSince).getTime() >= 3_600_000;

  return (
    <li className="channel">
      <span className="channel-avatar" aria-hidden="true">
        <Picture className="avatar" src={channel.thumbnailUrl} name={channel.title} />
      </span>
      <div className="channel-name">
        <span className="channel-title-row">
          <a href={authorUrl(channel)} target="_blank" rel="noreferrer">
            {channel.title}
          </a>
          <PlatformBadge platform={channel.platform} />
        </span>
        <span className="muted small channel-status">
          <i data-live={busy === 'check'} />
          {channel.handle ?? PLATFORM_NAME[channel.platform]}
          {channel.monitored ? `, checked ${channel.lastCheckedAt ? ago(channel.lastCheckedAt) : 'never'}` : ', videos added by link'}
        </span>
      </div>
      {channel.monitored ? (
        <div className="channel-stats">
          <div className="stat">
            <b>{channel.subscriberCount === null ? 'Hidden' : compact(channel.subscriberCount)}</b>
            <span>{hasGrowth ? `subscribers, ${signed(channel.subscribersGained!)} since ${day(channel.growthSince!)}` : 'subscribers'}</span>
          </div>
          <div className="stat">
            <b>{num(channel.uploadsLast7Days)}</b>
            <span>uploads in 7 days</span>
          </div>
          <div className="stat">
            <b>{channel.medianShortViews === null ? 'No Shorts' : compact(channel.medianShortViews)}</b>
            <span>typical Short views</span>
          </div>
        </div>
      ) : (
        <p className="muted small channel-wide">
          Not monitored. Add more of this account&apos;s videos by link; with five, its videos are ranked against its normal.
        </p>
      )}
      <div className="channel-actions">
        {confirming ? (
          <>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => act('remove')} disabled={busy !== null}>
              {busy === 'remove' ? 'Removing' : 'Stop tracking'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setConfirming(false)} disabled={busy !== null}>
              Keep
            </button>
          </>
        ) : (
          <>
            <Link className="btn btn-sm btn-primary" href={`/app/feed?channel=${channel.id}&days=all`}>
              Videos
            </Link>
            {channel.monitored && (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => act('report')} disabled={busy !== null}>
                {busy === 'report' ? 'Writing report' : 'Report'}
              </button>
            )}
            <details
              className="menu"
              ref={menu}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) e.currentTarget.open = false;
              }}
            >
              <summary className="btn btn-sm btn-quiet" aria-label={`More actions for ${channel.title}`}>
                More
              </summary>
              <div className="menu-items">
                {channel.monitored && (
                  <button type="button" onClick={() => act('check')} disabled={busy !== null}>
                    {busy === 'check' ? 'Checking' : 'Check now'}
                  </button>
                )}
                {channel.monitored && (
                  <button type="button" onClick={() => act('own')} disabled={busy !== null}>
                    {channel.isOwn ? 'This is a competitor' : 'This is my channel'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (menu.current) menu.current.open = false;
                    setConfirming(true);
                  }}
                >
                  Remove
                </button>
              </div>
            </details>
          </>
        )}
      </div>
      {(error || channel.lastError) && (
        <p className="channel-note" role={error ? 'alert' : undefined}>
          <span className="tag tag-bad">{error ? 'Not done' : 'Last check failed'}</span> {error?.message ?? channel.lastError}
        </p>
      )}
    </li>
  );
}

function Group({ title, note, channels, onChanged }: { title: string; note?: string; channels: TrackedChannel[]; onChanged: () => void }) {
  if (channels.length === 0) return null;
  return (
    <section className="stack">
      <h2>{title}</h2>
      {note && <p className="muted small">{note}</p>}
      <ul className="panel panel-open">
        {channels.map((c) => (
          <ChannelRow key={c.id} channel={c} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  );
}

export default function WatchlistPage() {
  const [data, setData] = useState<ChannelList | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<ApiError | null>(null);
  const [linkError, setLinkError] = useState<string | undefined>();
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    api<ChannelList>('/api/channels')
      .then((d) => {
        setData(d);
        setLoadError(null);
      })
      .catch(setLoadError);
  }, []);
  useEffect(load, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setAddError(null);
    setNote('');
    const parsed = parseChannelInput(url);
    if (!parsed.ok) {
      setLinkError(/tiktok/i.test(url) ? 'TikTok accounts cannot be monitored. Add their videos one at a time on the Videos page.' : parsed.reason);
      return;
    }
    setLinkError(undefined);
    setAdding(true);
    try {
      const result = await api<{ alreadyTracked: boolean }>('/api/channels', { body: { url } });
      setNote(result.alreadyTracked ? 'That channel is already on your watchlist.' : 'Channel added. Its recent videos are in Videos.');
      setUrl('');
      load();
    } catch (err) {
      setAddError(err as ApiError);
    } finally {
      setAdding(false);
    }
  }

  const items = data?.items ?? [];
  const mine = items.filter((c) => c.isOwn);
  const competitors = items.filter((c) => c.monitored && !c.isOwn);
  const byLink = items.filter((c) => !c.monitored);
  const monitoredCount = mine.length + competitors.length;

  return (
    <div className="stack-lg" style={{ maxWidth: 1100 }}>
      <PageHead title="Watchlist">
        The YouTube and Instagram accounts you compete with. Each one is checked{data ? ` every ${data.intervalHours} hours` : ' on a schedule'} for new uploads, views and subscribers.
      </PageHead>
      {data && <div className="watchlist-capacity" aria-label={`${monitoredCount} of ${data.limit} channel slots used`}><div><span>Channel capacity</span><strong>{monitoredCount} of {data.limit}</strong></div><div className="meter"><span style={{ width: `${Math.min(100, monitoredCount / data.limit * 100)}%` }} /></div></div>}

      {data && !data.configured && (
        <div className="notice notice-error" role="alert">
          <strong>Tracking is not set up yet.</strong> The server needs a YouTube API key (<code>YOUTUBE_API_KEY</code>) or an Apify token (<code>APIFY_TOKEN</code>). Add them to the <code>.env</code> file and restart the app. The README has the steps.
        </div>
      )}

      <form className="panel stack" onSubmit={add} noValidate>
        <div className="add-row">
          <Field label="Channel or video link" hint="A YouTube channel, @handle or video, or an Instagram profile (instagram.com/name)." error={linkError}>
            {(p) => (
              <input
                {...p}
                className="input"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setLinkError(undefined);
                }}
                placeholder="https://www.youtube.com/@channel or instagram.com/name"
                maxLength={300}
              />
            )}
          </Field>
          <button className="btn btn-primary" disabled={adding || url.trim().length < 2}>
            {adding ? 'Adding channel' : 'Add channel'}
          </button>
        </div>
        <ErrorNotice error={addError} />
        <span role="status" className="muted small">
          {note}
        </span>
      </form>

      <ErrorNotice error={loadError} />
      {!data && !loadError && <Skeleton lines={4} />}
      {data && items.length === 0 && (
        <div className="empty">
          <h2>Your watchlist is empty</h2>
          <p className="muted">Paste a YouTube or Instagram link above. Views are available straight away; growth and momentum build up from the first check onward.</p>
        </div>
      )}

      <Group title="Your channels" note="Your own channels are left out of the competitor list on the Videos page." channels={mine} onChanged={load} />
      <Group title="Competitors" channels={competitors} onChanged={load} />
      <Group title="From pasted links" note="TikTok accounts whose videos you added one at a time, and single Instagram reels. These are not checked automatically." channels={byLink} onChanged={load} />

      {monitoredCount > 0 && (
        <p className="muted small">
          Checks run while the app is running. YouTube rounds subscriber counts, so small changes may not show. A video of 3 minutes or less is counted as a Short.
        </p>
      )}
    </div>
  );
}
