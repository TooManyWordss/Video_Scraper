'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { APP } from '@/config/app';
import { api } from '@/lib/api';
import type { SessionUser } from '@/lib/types';
import { Icon } from './icons';
import { LogoMark } from './LogoMark';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  {
    group: 'Research', items: [
      { href: '/app/feed', label: 'Videos', icon: Icon.feed },
      { href: '/app/discover', label: 'Discover', icon: Icon.search },
      { href: '/app/hook-library', label: 'Hook library', icon: Icon.hooks },
    ]
  },
  {
    group: 'Create', items: [
      { href: '/app/scripts', label: 'Scripts', icon: Icon.scripts },
      { href: '/app/hooks', label: 'Hook writer', icon: Icon.hooks },
      { href: '/app/analyze', label: 'Analyze a link', icon: Icon.analyze },
      { href: '/app/library', label: 'Library', icon: Icon.library },
    ]
  },
  {
    group: 'Setup', items: [
      { href: '/app/competitors', label: 'Channels', icon: Icon.competitors },
      { href: '/app/instructions', label: 'Instructions', icon: Icon.instructions },
      { href: '/app/usage', label: 'Usage', icon: Icon.usage },
      { href: '/app/settings', label: 'Settings', icon: Icon.settings },
    ]
  },
] as const;

export function Sidebar({ user, onNavigate }: { user: SessionUser; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const here = pathname.startsWith('/app/videos/') ? '/app/feed' : pathname;
  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    onNavigate?.();
    router.replace('/login');
    router.refresh();
  }
  return (
    <aside className="sidebar bg-sidebar text-sidebar-text">
      <Link href="/app" className="brand" onClick={onNavigate}><LogoMark />{APP.name}</Link>
      <nav aria-label="Main" className="nav">
        {NAV.map(({ group, items }) => (
          <div key={group} className="nav-section">
            <div className="nav-group text-sidebar-muted">{group}</div>
            {items.map(({ href, label, icon: NavIcon }) => (
              <Link key={href} href={href} aria-current={here === href || here.startsWith(`${href}/`) ? 'page' : undefined} onClick={onNavigate}><NavIcon />{label}</Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="who">
          <span className="profile-avatar" aria-hidden="true">{user.name.trim().slice(0, 1).toUpperCase()}</span>
          <div><strong>{user.name}</strong><span className="text-sidebar-muted">{user.email}</span></div>
        </div>
        <div className="profile-actions"><ThemeToggle /><button type="button" className="sidebar-signout" onClick={signOut}>Sign out <Icon.external /></button></div>
      </div>
    </aside>
  );
}
