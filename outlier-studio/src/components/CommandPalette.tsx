'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ChannelList, FeedVideo } from '@/lib/types';
import { Icon } from './icons';

const PAGES = [
  ['Videos', '/app/feed', 'Research'], ['Discover', '/app/discover', 'Research'], ['Hook library', '/app/hook-library', 'Research'],
  ['Scripts', '/app/scripts', 'Create'], ['Hook writer', '/app/hooks', 'Create'], ['Analyze a link', '/app/analyze', 'Create'],
  ['Library', '/app/library', 'Create'], ['Watchlist', '/app/competitors', 'Setup'], ['Analysis instructions', '/app/instructions', 'Setup'], ['Usage', '/app/usage', 'Setup'], ['Settings', '/app/settings', 'Setup'],
] as const;

type Item = { label: string; href: string; meta: string };

export function CommandPalette() {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<Item[]>([]);

  const open = () => {
    if (!dialog.current?.open) dialog.current?.showModal();
    requestAnimationFrame(() => input.current?.focus());
  };
  const close = () => { dialog.current?.close(); setQuery(''); };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); open(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    Promise.allSettled([api<ChannelList>('/api/channels'), api<{ items: FeedVideo[] }>('/api/videos?days=all&type=all&scope=all&limit=30')]).then(([channels, videos]) => {
      const items: Item[] = [];
      if (channels.status === 'fulfilled') items.push(...channels.value.items.map((channel) => ({ label: channel.title, href: `/app/feed?channel=${channel.id}&days=all`, meta: 'Channel' })));
      if (videos.status === 'fulfilled') items.push(...videos.value.items.map((video) => ({ label: video.title, href: `/app/videos/${video.id}`, meta: video.channelTitle })));
      setRemote(items);
    });
  }, []);

  const items = useMemo(() => {
    const all: Item[] = [...PAGES.map(([label, href, meta]) => ({ label, href, meta })), ...remote];
    const needle = query.trim().toLowerCase();
    return (needle ? all.filter((item) => `${item.label} ${item.meta}`.toLowerCase().includes(needle)) : all).slice(0, 12);
  }, [query, remote]);

  return (
    <>
      <button type="button" className="command-trigger" onClick={open} aria-label="Open command palette"><Icon.search /><span>Jump to…</span><kbd>⌘K</kbd></button>
      <dialog className="command-dialog" ref={dialog} aria-label="Command palette" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div className="command-panel">
          <label className="command-search"><Icon.search /><span className="sr-only">Search pages, channels, and videos</span><input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages, channels, and videos…" onKeyDown={(event) => { if (event.key === 'Escape') close(); }} /></label>
          <div className="command-results">
            {items.length ? items.map((item) => <Link key={`${item.href}-${item.label}`} href={item.href} onClick={close}><span>{item.label}</span><small>{item.meta}</small></Link>) : <p className="muted">No matches</p>}
          </div>
          <div className="command-foot"><span>Navigate with keyboard</span><button type="button" onClick={close}>Esc</button></div>
        </div>
      </dialog>
    </>
  );
}
