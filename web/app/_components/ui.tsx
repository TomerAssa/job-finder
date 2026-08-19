'use client';
/**
 * Design tokens and the primitives every screen shares.
 *
 * Lifted out of the old single-file console unchanged — the token values match
 * the design handoff exactly, and the style-factory approach (functions
 * returning CSSProperties instead of class names) is deliberate: the app has no
 * Tailwind and no component library, and the handoff is specified in raw tokens.
 */
import type { CSSProperties, ReactNode } from 'react';

export const THEMES: Record<string, Record<string, string>> = {
  light: { bg: '#eef3fa', bg2: '#e3ecf8', panel: '#ffffff', panel2: '#f4f8fe', line: '#d6e1f1', lineSoft: '#e7eef8', text: '#17233c', muted: '#56658a', faint: '#93a1bd', amber: '#c98a1e', amberDim: '#e6d6b0', cyan: '#2f6bed', cyanDim: '#b8cdf5', violet: '#5b62d6', ok: '#2e9e6b', red: '#d9534f' },
  dark: { bg: '#0b1220', bg2: '#101a30', panel: '#14203a', panel2: '#1b2949', line: '#28385f', lineSoft: '#1b2846', text: '#dbe6f8', muted: '#8b9cc0', faint: '#5a6b8e', amber: '#e7b24b', amberDim: '#6b5a2c', cyan: '#5aa0ff', cyanDim: '#2f5aa0', violet: '#8f92f0', ok: '#5cc487', red: '#ea6a63' },
};

/** Read a theme token. Tokens are injected as CSS custom properties by AppShell. */
export const V = (k: string) => `var(--${k})`;

// ─── Enums shared across screens ────────────────────────────────────────────

export const personStatusOrder = ['new', 'to_reach', 'talked', 'following_up', 'done', 'dead_end'];
export const statusMeta: Record<string, { label: string; color: string }> = {
  new: { label: 'New lead', color: V('violet') },
  to_reach: { label: "Haven't talked", color: V('amber') },
  talked: { label: 'Talked', color: V('cyan') },
  following_up: { label: 'Following up', color: V('amber') },
  done: { label: 'Done', color: V('ok') },
  dead_end: { label: 'Dead end', color: V('faint') },
};

export const giveMeta: Record<string, { label: string; color: string }> = {
  intro: { label: 'Intro', color: V('cyan') },
  lead: { label: 'Lead', color: V('amber') },
  advice: { label: 'Advice', color: V('violet') },
  referral: { label: 'Referral', color: V('ok') },
};

export const roleStatusOrder = ['rejected', 'relevant', 'applied', 'in_process', 'via_people'];
export const roleStatusMeta: Record<string, { label: string; color: string }> = {
  rejected: { label: 'Not relevant / Rejected', color: V('red') },
  relevant: { label: 'Relevant — not applied', color: V('cyan') },
  applied: { label: 'Applied (CV sent)', color: V('amber') },
  in_process: { label: 'In process', color: V('violet') },
  via_people: { label: 'Applied via people', color: V('ok') },
};

export const outreachOrder = ['none', 'cold', 'request', 'wrote', 'submitted', 'connected', 'not_relevant'];
export const outreachMeta: Record<string, { label: string; color: string }> = {
  none: { label: 'Set status', color: V('faint') },
  cold: { label: 'Cold approach', color: V('violet') },
  request: { label: 'Connection request sent', color: V('cyan') },
  wrote: { label: 'Wrote to them', color: V('amber') },
  submitted: { label: 'Submitted CV', color: V('ok') },
  connected: { label: 'Connected me onward', color: V('cyan') },
  not_relevant: { label: 'Not relevant', color: V('red') },
};

export const channelOrder = ['linkedin', 'phone', 'whatsapp', 'email', 'in_person', 'other'];
export const channelMeta: Record<string, { label: string; color: string }> = {
  linkedin: { label: 'LinkedIn', color: V('cyan') },
  phone: { label: 'Phone', color: V('amber') },
  whatsapp: { label: 'WhatsApp', color: V('ok') },
  email: { label: 'Email', color: V('violet') },
  in_person: { label: 'In person', color: V('amber') },
  other: { label: 'Other', color: V('faint') },
};

// ─── Text helpers ───────────────────────────────────────────────────────────

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const initials = (n: string) =>
  (n || '').split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

/** Relative day count, for "last spoke 12 days ago". */
export function daysAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ─── Style factories ────────────────────────────────────────────────────────

export const pill = (active: boolean, color?: string): CSSProperties => ({
  font: 'inherit', fontSize: 12, padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
  fontFamily: 'var(--mono)', letterSpacing: '.02em', transition: '.12s',
  ...(active
    ? { background: color ?? V('cyan'), color: '#fff', border: '1px solid transparent', fontWeight: 600 }
    : { background: 'transparent', color: V('muted'), border: `1px solid ${V('line')}` }),
});

export const seg = (active: boolean): CSSProperties => ({
  font: 'inherit', fontSize: 13, padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
  border: 'none', transition: '.12s',
  ...(active ? { background: V('cyan'), color: '#fff', fontWeight: 600 } : { background: 'transparent', color: V('muted') }),
});

export const chip = (color: string): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 11,
  padding: '3px 10px', borderRadius: 999, color, border: '1px solid currentColor', whiteSpace: 'nowrap',
});

export const inp = (): CSSProperties => ({
  background: V('bg2'), color: V('text'), border: `1px solid ${V('line')}`, borderRadius: 8,
  padding: '8px 10px', font: 'inherit', fontSize: 13,
});

export const td = (): CSSProperties => ({
  padding: '11px 10px', borderBottom: `1px solid ${V('lineSoft')}`, verticalAlign: 'middle',
});

export const circleBadge: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 10.5, color: V('amber'), border: `1px solid ${V('amberDim')}`,
  borderRadius: 6, padding: '1px 7px', whiteSpace: 'nowrap',
};

export const senChip: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 10.5, color: V('cyan'), border: `1px solid ${V('cyanDim')}`,
  borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap',
};

export const label: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: V('faint'),
};

export const card: CSSProperties = {
  background: V('panel'), border: `1px solid ${V('line')}`, borderRadius: 11,
};

export const primaryBtn = (disabled = false): CSSProperties => ({
  font: 'inherit', fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 8,
  cursor: disabled ? 'default' : 'pointer', background: V('cyan'), color: '#fff', border: 'none',
  opacity: disabled ? 0.5 : 1,
});

export const ghostBtn: CSSProperties = {
  font: 'inherit', fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
  background: 'transparent', color: V('muted'), border: `1px solid ${V('line')}`,
};

// ─── Primitives ─────────────────────────────────────────────────────────────

export function PageHead({ title, sub, right }: { title: string; sub: string; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--display)', fontWeight: 400, fontSize: 30, letterSpacing: '-.02em', margin: 0 }}>{title}</h1>
        <p style={{ color: V('muted'), margin: '6px 0 0' }}>{sub}</p>
      </div>
      {right}
    </div>
  );
}

export function Segmented({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'inline-flex', gap: 2, background: V('panel2'), border: `1px solid ${V('line')}`, borderRadius: 8, padding: 2 }}>
      {options.map(([v, l]) => <button key={v} style={seg(value === v)} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export function StatusChip({ st }: { st: string }) {
  const m = statusMeta[st] ?? { label: st, color: V('muted') };
  return (
    <span style={chip(m.color)}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor' }} />
      {m.label}
    </span>
  );
}

export function FilterGroup({ title, value, onChange, options, colorFor }: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  colorFor?: (v: string) => string | undefined;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={label}>{title}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} style={pill(value === v, colorFor?.(v))}>{l}</button>)}
      </div>
    </div>
  );
}

export function Field({ l, children }: { l: string; children: ReactNode }) {
  return <div style={{ display: 'grid', gap: 6 }}><span style={label}>{l}</span>{children}</div>;
}

export function Backdrop({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,25,45,.42)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div style={{ color: V('faint'), padding: 12 }}>{children}</div>;
}

/**
 * Failure surface. The old console swallowed every error and rendered "nothing
 * found", which is why a broken scraper looked like an empty company for months.
 */
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div style={{ ...card, borderColor: V('red'), padding: '10px 14px', color: V('red'), fontSize: 13, display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>ERROR</span>
      <span style={{ color: V('text') }}>{children}</span>
    </div>
  );
}
