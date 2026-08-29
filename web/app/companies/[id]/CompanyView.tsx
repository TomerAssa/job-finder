'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CandidateItem, CompanyConnection, CompanyDetail, RolePath } from '@/lib/data/companies';
import type { RoleItem } from '@/lib/data/jobs';
import type { PersonListItem } from '@/lib/data/people';
import { addRolePath, decideCandidate, promoteConnections, removeRolePath, setRoleNote, setRoleStatus } from '@/lib/actions';
import {
  V, card, chip, circleBadge, ErrorNote, ghostBtn, initials, inp, label, pill,
  primaryBtn, roleStatusMeta, roleStatusOrder, senChip, StatusChip,
} from '../../_components/ui';

export function CompanyView({
  company, roles, people, candidates, connections, introductions, focusRoleId, paths, knownPeople, connectors,
}: {
  company: CompanyDetail;
  roles: RoleItem[];
  /** The role that was clicked to get here; shown on its own, others collapsed. */
  focusRoleId?: number | null;
  people: PersonListItem[];
  candidates: CandidateItem[];
  connections: CompanyConnection[];
  introductions: { id: number; from: string; note: string }[];
  paths: RolePath[];
  knownPeople: string[];
  connectors: string[];
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
        <Roles roles={roles} focusRoleId={focusRoleId ?? null} />

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

        <Paths
          company={company}
          roles={roles}
          paths={paths}
          knownPeople={knownPeople}
          connectors={connectors}
        />

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
        <PeopleScan companyId={company.id} companyName={company.name} candidates={candidates} linkedinVerified={company.linkedinVerified} />
      </div>
    </>
  );
}

/**
 * The role you came here for, on its own.
 *
 * Arriving from a search result and being handed every opening at the company
 * buries the one you clicked. That one is shown expanded; the rest stay behind a
 * disclosure, because they are context rather than the answer.
 */
function Roles({ roles, focusRoleId }: { roles: RoleItem[]; focusRoleId: number | null }) {
  const [showOthers, setShowOthers] = useState(false);
  const focus = focusRoleId != null ? roles.find((r) => r.id === focusRoleId) ?? null : null;
  const others = focus ? roles.filter((r) => r.id !== focus.id) : roles;

  return (
    <section style={{ ...card, padding: '16px 18px' }}>
      <div style={label}>{focus ? 'The role you opened' : 'Open roles & my status'}</div>

      {focus && (
        <div style={{ marginTop: 12 }}>
          <RoleCard role={focus} highlighted />
        </div>
      )}

      {!focus && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          {roles.map((r) => <RoleCard key={r.id} role={r} />)}
          {roles.length === 0 && <span style={{ color: V('faint') }}>No open roles tracked here.</span>}
        </div>
      )}

      {focus && others.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button
            onClick={() => setShowOthers((v) => !v)}
            style={{ ...ghostBtn, fontSize: 12.5, width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <span style={{ color: V('faint') }}>{showOthers ? '▾' : '▸'}</span>
            Other positions at {others.length === 1 ? 'this company' : `this company (${others.length})`}
          </button>
          {showOthers && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
              {others.map((r) => <RoleCard key={r.id} role={r} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RoleCard({ role: r, highlighted }: { role: RoleItem; highlighted?: boolean }) {
  const [, start] = useTransition();
  return (
    <div style={{ border: `1px solid ${highlighted ? V('cyan') : V('lineSoft')}`, borderRadius: 9, padding: '10px 12px', background: highlighted ? V('panel2') : 'transparent' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span dir="auto" style={{ flex: 1, fontWeight: highlighted ? 600 : 500, minWidth: 180 }}>{r.title}</span>
        <span style={senChip}>{r.seniority}</span>
        {(r.minYears != null || r.maxYears != null) && (
          <span style={label}>{r.minYears ?? '?'}–{r.maxYears ?? '?'} yrs</span>
        )}
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
  );
}

const PATH_STATUS = ['todo', 'contacted', 'replied', 'submitted', 'connected', 'not_relevant', 'closed'];

/**
 * Ways in, per role.
 *
 * A path has two halves and either can be missing: the connector opens the door,
 * the contact is the person inside. They are usually at different companies —
 * someone you know at one place forwarding you to someone at another is the
 * commonest way a job actually happens, and it is not expressible as "people who
 * work here".
 */
function Paths({ company, roles, paths, knownPeople, connectors }: {
  company: CompanyDetail;
  roles: RoleItem[];
  paths: RolePath[];
  knownPeople: string[];
  connectors: string[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [roleId, setRoleId] = useState<number | ''>(roles[0]?.id ?? '');
  const [connector, setConnector] = useState('');
  const [contact, setContact] = useState('');
  const [contactCompany, setContactCompany] = useState(company.name);
  const [contactLinkedin, setContactLinkedin] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();

  const reset = () => {
    setConnector(''); setContact(''); setContactCompany(company.name);
    setContactLinkedin(''); setNote(''); setAdding(false); setError(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await addRolePath({
      roleId: Number(roleId),
      companyId: company.id,
      connectorName: connector,
      contactName: contact,
      contactCompany,
      contactLinkedin,
      note,
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    reset();
    router.refresh();
  };

  return (
    <section style={{ ...card, padding: '16px 18px' }}>
      <datalist id="known-people">{knownPeople.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="known-connectors">{connectors.map((n) => <option key={n} value={n} />)}</datalist>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={label}>Ways in</div>
        {!adding && (
          <button style={{ ...primaryBtn(), marginLeft: 'auto', fontSize: 12, padding: '6px 12px' }} onClick={() => setAdding(true)}>
            + Add a way in
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {paths.length === 0 && !adding && (
          <span style={{ color: V('faint'), fontSize: 13 }}>
            Nobody recorded yet — a connector who can reach someone here, or a contact inside.
          </span>
        )}
        {paths.map((p) => (
          <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderBottom: `1px solid ${V('lineSoft')}`, paddingBottom: 8 }}>
            <span style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {p.connectorName ? (
                <Link href={`/people/${p.connectorId}`} style={{ color: V('cyan'), fontWeight: 600 }} dir="auto">{p.connectorName}</Link>
              ) : (
                <span style={{ color: V('faint') }}>cold</span>
              )}
              {p.connectorCompany && <span style={{ color: V('faint') }} dir="auto">({p.connectorCompany})</span>}
              <span style={{ color: V('faint') }}>→</span>
              {p.contactName ? (
                <Link href={`/people/${p.contactId}`} style={{ color: V('text'), fontWeight: 600 }} dir="auto">{p.contactName}</Link>
              ) : (
                <span style={{ color: V('faint') }}>nobody inside yet</span>
              )}
            </span>
            <span style={{ ...label, color: V('faint') }} dir="auto">{p.roleTitle}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ ...chip(p.status === 'connected' || p.status === 'submitted' ? V('ok') : V('faint')), fontSize: 10.5 }}>
                {p.status.replace('_', ' ')}
              </span>
              <button
                onClick={() => start(() => { removeRolePath(p.id, company.id); })}
                style={{ font: 'inherit', fontSize: 11, background: 'transparent', border: 'none', color: V('faint'), cursor: 'pointer' }}
              >
                ✕
              </button>
            </span>
            {p.note && <div style={{ width: '100%', color: V('faint'), fontSize: 12 }} dir="auto">{p.note}</div>}
          </div>
        ))}
      </div>

      {adding && (
        <div style={{ display: 'grid', gap: 10, marginTop: 14, padding: 14, background: V('bg2'), borderRadius: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <span style={label}>Who connects me</span>
              <input list="known-connectors" value={connector} onChange={(e) => setConnector(e.target.value)}
                placeholder="e.g. Tal — leave blank if cold" dir="auto" style={inp()} />
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <span style={label}>Who they reach here</span>
              <input list="known-people" value={contact} onChange={(e) => setContact(e.target.value)}
                placeholder="e.g. Shira" dir="auto" style={inp()} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <span style={label}>Where that person works</span>
              <input value={contactCompany} onChange={(e) => setContactCompany(e.target.value)} dir="auto" style={inp()} />
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <span style={label}>Their LinkedIn (optional)</span>
              <input value={contactLinkedin} onChange={(e) => setContactLinkedin(e.target.value)}
                placeholder="https://www.linkedin.com/in/…" style={inp()} />
            </div>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={label}>Which role</span>
            <select value={roleId} onChange={(e) => setRoleId(e.target.value === '' ? '' : Number(e.target.value))} style={inp()}>
              {roles.map((r) => <option key={r.id} value={r.id} style={{ color: '#000' }}>{r.title}</option>)}
              {roles.length === 0 && <option value="">no roles tracked here yet</option>}
            </select>
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened — e.g. sent my CV on 12/8" dir="auto" style={inp()} />

          <p style={{ color: V('faint'), fontSize: 11.5, lineHeight: 1.6, margin: 0 }}>
            Naming both records the introduction in your people graph too, so it shows on each
            of their profiles and can be reused for the next role here.
          </p>

          {error && <ErrorNote>{error}</ErrorNote>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={primaryBtn(busy || (!connector.trim() && !contact.trim()))}
              disabled={busy || (!connector.trim() && !contact.trim())} onClick={save}>
              {busy ? 'saving…' : 'Save'}
            </button>
            <button style={ghostBtn} onClick={reset}>Cancel</button>
          </div>
        </div>
      )}
    </section>
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
const ROLE_PRESETS = [
  { key: 'product', label: 'Product', why: 'Peers who can tell you what the team is actually like' },
  { key: 'hr', label: 'HR / Talent', why: 'The people who move an application forward' },
  { key: 'engineering', label: 'Engineering leadership', why: 'Hiring managers for technical teams' },
  { key: 'founders', label: 'Founders & execs', why: 'At a small company, the person who decides' },
];

function PeopleScan({
  companyId, companyName, candidates, linkedinVerified,
}: {
  companyId: number;
  companyName: string;
  candidates: CandidateItem[];
  linkedinVerified: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);
  const [roleKeys, setRoleKeys] = useState<string[]>(['product', 'hr']);
  const [customTitles, setCustomTitles] = useState('');
  const [location, setLocation] = useState('');
  const [verification, setVerification] = useState<{ verified: boolean; reason: string } | null>(null);
  const [partialFailures, setPartialFailures] = useState<string[]>([]);
  const [, start] = useTransition();

  const toggleRole = (key: string) =>
    setRoleKeys((r) => (r.includes(key) ? r.filter((x) => x !== key) : [...r, key]));

  const scan = async () => {
    setBusy(true);
    setError(null);
    setPartialFailures([]);
    try {
      const res = await fetch(`/api/companies/${companyId}/people-scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roleKeys,
          customTitles: customTitles.split(',').map((s) => s.trim()).filter(Boolean),
          location: location.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Scan failed (HTTP ${res.status})`);
      setRan(true);
      setVerification(body.verification ?? null);
      setPartialFailures(body.partialFailures ?? []);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const canScan = roleKeys.length > 0 || customTitles.trim().length > 0;

  return (
    <section style={{ ...card, padding: '16px 18px' }}>
      <div style={label}>Find people at {companyName}</div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
        {ROLE_PRESETS.map((p) => (
          <button key={p.key} onClick={() => toggleRole(p.key)} title={p.why} style={pill(roleKeys.includes(p.key))}>
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 10, marginTop: 12 }}>
        <input
          value={customTitles}
          onChange={(e) => setCustomTitles(e.target.value)}
          placeholder="Other titles, comma separated — e.g. solutions architect"
          dir="auto"
          style={inp()}
        />
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Region (optional)"
          dir="auto"
          style={inp()}
        />
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <button onClick={scan} disabled={busy || !canScan} style={{ ...ghostBtn, opacity: busy || !canScan ? 0.6 : 1 }}>
          {busy ? '⟳ searching…' : candidates.length ? '⟳ Search again' : '⟳ Search LinkedIn'}
        </button>
        <span style={{ color: V('faint'), fontSize: 12.5, flex: 1, minWidth: 260 }}>
          One credit per selected group, plus the company identity check.
          {linkedinVerified && ' This company is already verified.'}
        </span>
      </div>

      {verification && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5 }}>
          <span style={{ ...chip(verification.verified ? V('ok') : V('amber')), fontSize: 10.5 }}>
            {verification.verified ? 'identity verified' : 'unverified'}
          </span>
          <span style={{ color: V('muted') }}>{verification.reason}</span>
        </div>
      )}

      {partialFailures.length > 0 && (
        <div style={{ marginTop: 10, color: V('amber'), fontSize: 12.5 }}>
          {partialFailures.map((f) => <div key={f}>⚠ {f}</div>)}
        </div>
      )}

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
