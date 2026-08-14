'use client';
/**
 * The persistent chrome: sidebar navigation and the theme.
 *
 * Navigation used to be `useState` inside one giant component, so the URL never
 * reflected where you were. It is real routing now — `usePathname` drives the
 * active state and every screen is linkable.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { THEMES, V, label } from './ui';

export interface NavCounts {
  people: number;
  jobs: number;
  companies: number;
}

const THEME_KEY = 'job-console-theme';

export function AppShell({ counts, children }: { counts: NavCounts; children: ReactNode }) {
  const pathname = usePathname();
  // Theme was previously lost on every reload. Restore it after mount so the
  // server and client render the same markup.
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    window.localStorage.setItem(THEME_KEY, next);
  };

  const items = [
    { href: '/people', label: 'People', dot: V('cyan'), n: counts.people },
    { href: '/jobs', label: 'Jobs & Companies', dot: V('amber'), n: counts.jobs },
    { href: '/search', label: 'Search', dot: V('violet'), n: null },
    { href: '/manage', label: 'Manage & dedupe', dot: V('ok'), n: counts.people },
  ];

  const themeVars = Object.fromEntries(
    Object.entries(THEMES[theme]).map(([k, v]) => [`--${k}`, v]),
  ) as CSSProperties;

  return (
    <div style={{ ...themeVars, display: 'grid', gridTemplateColumns: '238px 1fr', minHeight: '100vh', background: V('bg'), color: V('text'), fontFamily: 'var(--body)', fontSize: 14, lineHeight: 1.5 } as CSSProperties}>
      <aside style={{ borderRight: `1px solid ${V('line')}`, background: `linear-gradient(180deg, ${V('panel')}, ${V('bg2')})`, padding: '22px 16px', position: 'sticky', top: 0, height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Link href="/people" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: 22, letterSpacing: '-.01em' }}>
            Job<span style={{ color: V('cyan') }}>·</span>Console
          </div>
          <div style={{ ...label, marginTop: 4, letterSpacing: '.18em' }}>Outreach Intel</div>
        </Link>

        <nav style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {items.map((it) => {
            const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
            return (
              <Link key={it.href} href={it.href} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, textDecoration: 'none', color: active ? V('text') : V('muted'), background: active ? V('panel2') : 'transparent', border: `1px solid ${active ? V('line') : 'transparent'}` }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: it.dot }} />
                <span style={{ flex: 1, fontWeight: 500 }}>{it.label}</span>
                {it.n != null && (
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: active ? V('cyan') : V('faint') }}>{it.n}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button onClick={toggleTheme} style={{ font: 'inherit', fontSize: 12.5, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', background: V('panel2'), color: V('muted'), border: `1px solid ${V('line')}`, textAlign: 'left' }}>
            {theme === 'dark' ? '☾ Dark' : '☀ Light'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 999, background: V('panel2'), border: `1px solid ${V('line')}`, display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: V('amber') }}>YOU</div>
            <div style={{ fontSize: 12.5 }}>
              <div style={{ fontWeight: 600 }}>You</div>
              <div style={{ color: V('faint'), fontSize: 11 }}>{counts.companies} companies tracked</div>
            </div>
          </div>
        </div>
      </aside>

      <main style={{ height: '100vh', overflow: 'auto', padding: '30px 36px 72px', maxWidth: 1340 }}>
        {children}
      </main>
    </div>
  );
}
