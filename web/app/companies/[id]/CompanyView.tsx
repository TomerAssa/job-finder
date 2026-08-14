'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CandidateItem, CompanyConnection, CompanyDetail } from '@/lib/data/companies';
import type { RoleItem } from '@/lib/data/jobs';
import type { PersonListItem } from '@/lib/data/people';
import { decideCandidate, promoteConnections, setRoleNote, setRoleStatus } from '@/lib/actions';
import {
  V, card, chip, circleBadge, ErrorNote, ghostBtn, initials, inp, label, PageHead,
  primaryBtn, roleStatusMeta, roleStatusOrder, senChip, StatusChip,
} from '../../_components/ui';

export function CompanyView({
  company, roles, people, candidates, connections, introductions,
}: {
  company: CompanyDetail;
  roles: RoleItem[];
  people: PersonListItem[];
  candidates: CandidateItem[];
  connections: CompanyConnection[];
  introductions: { id: number; from: string; note: string }[];
}) {
  const [, start] = useTransition();
  const meta = [company.sector, company.stage, company.employees, company.funding]
    .filter((x) => x && x !== '—')
    .join(' · ');

  return (
    <>
      <Link href="/jobs" style={{ ...label, color: V('cyan'), textDecoration: 'none' }}>← Jobs &amp; Companies</Link>

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 12, marginBottom: 20 }}>
        <div style={{ width: 52, height: 52, borderRadius: 12, background: V('violet'), color: '#fff', display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontWeight: 600, flexShrink: 0 }}>
          {initials(company.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: 28 }} dir="auto">{company.name}</div>
          <div style={{ color: V('muted'), fontSize: 12.5 }} dir="auto">{meta || 'No company details recorded'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {company.careersUrl && <a href={company.careersUrl} target="_blank" rel="noreferrer" style={{ ...chip(V('cyan')), textDecoration: 'none' }}>careers ↗</a>}
          {company.linkedinUrl && <a href={company.linkedinUrl} target="_blank" rel="noreferrer" style={{ ...chip(company.linkedinVerified ? V('ok') : V('faint')), textDecoration: 'none' }}>
            linkedin {company.linkedinVerified ? '✓' : ''} ↗
          </a>}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 20 }}>
        {/* ── Roles ── */}
        <section style={{ ...card, padding: '16px 18px' }}>
          <div style={label}>Open roles &amp; my status</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            {roles.map((r) => (
              <div key={r.id} style={{ border: `1px solid ${V('lineSoft')}`, borderRadius: 9, padding: '10px 12px' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span dir="auto" style={{ flex: 1, fontWeight: 500, minWidth: 180 }}>{r.title}</span>
                  <span style={senChip}>{r.seniority}</span>
                  {r.url && <a href={r.url} target="_blank" rel="noreferrer" style={{ color: V('cyan') }}>job ↗</a>}
                  <select
                    defaultValue={r.status}
                    onChange={(e) => start(() => { setRoleStatus(r.id, e.target.value); })}
                    style={{ ...inp(), padding: '4px 8px', fontSize: 12, color: roleStatusMeta[r.status]?.color }}
                  >
                    {roleStatusOrder.map((s) => <option key={s} value={s} style={{ color: '#000' }}>{roleStatusMeta[s].label}</option>)}
                  </select>
                </div>
                <textarea
                  defaultValue={r.note}
                  onBlur={(e) => { if (e.target.value !== r.note) start(() => { setRoleNote(r.id, e.target.value); }); }}
                  placeholder="My status for this role…"
                  dir="auto"
                  style={{ ...inp(), width: '100%', marginTop: 8, minHeight: 42, resize: 'vertical', fontSize: 12.5 }}
                />
              </div>
            ))}
            {roles.length === 0 && <span style={{ color: V('faint') }}>No open roles tracked here.</span>}
          </div>
        </section>

        {/* ── People you already know ── */}
        <section style={{ ...card, padding: '16px 18px' }}>
          <div style={label}>People you know here</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {people.map((p) => (
              <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderBottom: `1px solid ${V('lineSoft')}`, paddingBottom: 8 }}>
                <Link href={`/people/${p.id}`} dir="auto" style={{ fontWeight: 600, color: V('text'), textDecoration: 'none' }}>{p.name}</Link>
                <span style={circleBadge}>circle {p.circle ?? '—'}</span>
                <span style={{ color: V('muted'), fontSize: 12.5 }} dir="auto">{p.role}</span>
                <span style={{ marginLeft: 'auto' }}><StatusChip st={p.status} /></span>
              </div>
            ))}
            {people.length === 0 && <span style={{ color: V('faint') }}>Nobody yet.</span>}
          </div>

          {introductions.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={label}>Who got you in here</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {introductions.map((i) => <span key={i.id} style={chip(V('cyan'))} dir="auto">{i.from}</span>)}
              </div>
            </div>
          )}
        </section>

        {/* ── LinkedIn connections at this company ── */}
        {connections.length > 0 && (
          <section style={{ ...card, padding: '16px 18px', borderColor: V('cyan') }}>
            <div style={{ ...label, color: V('cyan') }}>
              {connections.length} of your LinkedIn connections work here
            </div>
            <p style={{ color: V('muted'), fontSize: 12.5, margin: '6px 0 12px' }}>
              They are in your connections export but not in your people list yet.
            </p>
            <ConnectionPicker connections={connections} />
          </section>
        )}

        {/* ── Scan for PMs and HR ── */}
        <PeopleScan companyId={company.id} companyName={company.name} candidates={candidates} />
      </div>
    </>
  );
}

function ConnectionPicker({ connections }: { connections: CompanyConnection[] }) {
  const [selected, setSelected] = useState<number[]>([]);
  const [, start] = useTransition();
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {connections.map((c) => (
          <label key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            <span style={{ fontWeight: 600 }} dir="auto">{c.name}</span>
            <span style={{ color: V('muted'), fontSize: 12.5 }} dir="auto">{c.position}</span>
            {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer" style={{ color: V('cyan'), marginLeft: 'auto' }}>in ↗</a>}
          </label>
        ))}
      </div>
      <button
        style={{ ...primaryBtn(selected.length === 0), marginTop: 12 }}
        disabled={selected.length === 0}
        onClick={() => start(() => { promoteConnections(selected); setSelected([]); })}
      >
        Add {selected.length || ''} to my people
      </button>
    </>
  );
}

/**
 * Find product and HR people at this company.
 *
 * Results are candidates, not contacts: they are search-result guesses, so they
 * land in a review list and only become people when kept. Errors are shown —
 * the previous version swallowed every failure and rendered "no profiles found".
 */
function PeopleScan({ companyId, companyName, candidates }: { companyId: number; companyName: string; candidates: CandidateItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);
  const [, start] = useTransition();

  const scan = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/people-scan`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Scan failed (HTTP ${res.status})`);
      setRan(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ ...card, padding: '16px 18px' }}>
      <div style={label}>Find product &amp; HR people at {companyName}</div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <button onClick={scan} disabled={busy} style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>
          {busy ? '⟳ searching…' : candidates.length ? '⟳ Search again' : '⟳ Search LinkedIn'}
        </button>
        <span style={{ color: V('faint'), fontSize: 12.5 }}>
          Costs one search credit per query. Results are guesses you confirm below.
        </span>
      </div>

      {error && <div style={{ marginTop: 12 }}><ErrorNote>{error}</ErrorNote></div>}

      {candidates.length > 0 && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ ...label, color: V('amber') }}>{candidates.length} to review</div>
          {candidates.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderBottom: `1px solid ${V('lineSoft')}`, paddingBottom: 8 }}>
              <span style={{ fontWeight: 600 }} dir="auto">{c.name}</span>
              <span style={{ color: V('muted'), fontSize: 12.5 }} dir="auto">{c.role}</span>
              {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer" style={{ color: V('cyan') }}>in ↗</a>}
              <span style={{ ...chip(c.confidence >= 0.7 ? V('ok') : V('faint')), fontSize: 10.5 }}>
                {c.confidence >= 0.7 ? 'likely' : 'unverified'}
              </span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button onClick={() => start(() => { decideCandidate(c.id, 'kept'); })} style={{ ...primaryBtn(), fontSize: 11, padding: '4px 10px' }}>Keep</button>
                <button onClick={() => start(() => { decideCandidate(c.id, 'rejected'); })} style={{ ...ghostBtn, fontSize: 11, padding: '4px 10px' }}>Reject</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {ran && candidates.length === 0 && !error && (
        <p style={{ color: V('faint'), fontSize: 13, marginTop: 12 }}>
          The search ran and returned no public profiles for {companyName}. That is a real
          result, not an error — LinkedIn de-indexes many profiles.
        </p>
      )}
    </section>
  );
}
