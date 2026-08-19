'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PersonListItem } from '@/lib/data/people';
import type { IntroductionEdge, InteractionRow } from '@/lib/repo';
import {
  addIntroductionToCompany, addIntroductionToNewPerson, addIntroductionToPerson,
  deleteInteraction, deletePerson, logInteraction, mergePeople, removeIntroduction, setPersonCanGive,
  setPersonNotes, setPersonStatus, setPersonSummary,
} from '@/lib/actions';
import {
  V, card, channelMeta, channelOrder, chip, circleBadge, daysAgo, Field, ghostBtn,
  giveMeta, inp, label, personStatusOrder, pill, primaryBtn, statusMeta, StatusChip,
} from '../../_components/ui';

export function PersonProfile({
  person,
  introductions,
  interactions,
  similar,
  connectorNames,
  companies,
  allPeople,
}: {
  person: PersonListItem;
  introductions: { inbound: IntroductionEdge[]; outbound: IntroductionEdge[] };
  interactions: InteractionRow[];
  similar: { id: number; name: string }[];
  connectorNames: string[];
  companies: { id: number; name: string }[];
  allPeople: MergeCandidate[];
}) {
  const [, start] = useTransition();
  const p = person;

  return (
    <>
      <Link href="/people" style={{ ...label, color: V('cyan'), textDecoration: 'none' }}>← People</Link>

      <header style={{ ...card, marginTop: 12, padding: '18px 22px', background: `linear-gradient(180deg, ${V('panel2')}, ${V('panel')})` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: 'var(--display)', fontSize: 28 }} dir="auto">{p.name}</div>
            <div style={{ color: V('muted'), marginTop: 2 }} dir="auto">
              {[p.role, p.companyName].filter(Boolean).join(' · ') || 'No role or company recorded'}
            </div>
          </div>
          <StatusChip st={p.status} />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
          <span style={circleBadge}>{p.circle != null ? `circle ${p.circle}` : 'circle —'}</span>
          {p.linkedin && <a href={p.linkedin} target="_blank" rel="noreferrer" style={{ ...chip(V('cyan')), textDecoration: 'none' }}>in ↗</a>}
          {p.phone && <span style={chip(V('faint'))} dir="auto">{p.phone}</span>}
          {p.companyId && <Link href={`/companies/${p.companyId}`} style={{ ...chip(V('violet')), textDecoration: 'none' }}>{p.companyName} ↗</Link>}
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          {Object.keys(giveMeta).map((g) => {
            const on = p.give.includes(g);
            return (
              <button
                key={g}
                onClick={() => start(() => { setPersonCanGive(p.id, on ? p.give.filter((x) => x !== g) : [...p.give, g]); })}
                style={pill(on, giveMeta[g].color)}
              >
                {giveMeta[g].label}
              </button>
            );
          })}
        </div>
      </header>

      {similar.length > 0 && (
        <div style={{ ...card, borderColor: V('amber'), padding: '10px 14px', marginTop: 12, fontSize: 13 }}>
          <span style={{ ...label, color: V('amber') }}>possible duplicate</span>{' '}
          Also in your list under this name:{' '}
          {similar.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ', '}
              <Link href={`/people/${s.id}`} style={{ color: V('cyan') }} dir="auto">{s.name}</Link>
            </span>
          ))}
          . <Link href="/manage" style={{ color: V('muted') }}>Merge them →</Link>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,340px)', gap: 16, alignItems: 'start', marginTop: 16 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <TalkLog personId={p.id} interactions={interactions} />
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <IntroductionPanel
            personId={p.id}
            personName={p.name}
            introductions={introductions}
            connectorNames={connectorNames}
            companies={companies}
          />

          <section style={{ ...card, padding: '14px 16px' }}>
            <div style={label}>Where this stands</div>
            <textarea
              key={`summary-${p.id}`}
              defaultValue={p.summary}
              onBlur={(e) => { if (e.target.value !== p.summary) start(() => { setPersonSummary(p.id, e.target.value); }); }}
              placeholder="One line you can scan later — what came of this, what is outstanding…"
              dir="auto"
              style={{ ...inp(), width: '100%', marginTop: 8, minHeight: 60, resize: 'vertical' }}
            />

            <div style={{ ...label, marginTop: 14 }}>Notes</div>
            <textarea
              key={`notes-${p.id}`}
              defaultValue={p.notes ?? ''}
              onBlur={(e) => { if (e.target.value !== (p.notes ?? '')) start(() => { setPersonNotes(p.id, e.target.value); }); }}
              placeholder="Anything else worth remembering…"
              dir="auto"
              style={{ ...inp(), width: '100%', marginTop: 8, minHeight: 60, resize: 'vertical', color: V('muted') }}
            />

            <div style={{ ...label, marginTop: 14 }}>Move to</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {personStatusOrder.map((s) => (
                <button key={s} onClick={() => start(() => { setPersonStatus(p.id, s); })} style={pill(p.status === s, statusMeta[s].color)}>
                  {statusMeta[s].label}
                </button>
              ))}
            </div>
          </section>

          <MergePerson personId={p.id} name={p.name} candidates={allPeople} />

          <DeletePerson
            personId={p.id}
            name={p.name}
            interactions={interactions.length}
            edges={introductions.inbound.length + introductions.outbound.length}
          />
        </div>
      </div>
    </>
  );
}

export interface MergeCandidate {
  id: number;
  name: string;
  company: string;
  role: string;
  interactions: number;
}

/**
 * Fold another record into this one.
 *
 * The same person arrives as several rows when each source knew them
 * differently — a first name here, a full name there, a phone on one and a
 * LinkedIn URL on another. Automatic dedupe deliberately will not join those,
 * because two people who share a name are not the same person; this is where you
 * say that they are.
 *
 * Merging keeps THIS record and takes whatever the other one had that is
 * missing here. Conversations and introductions move across rather than being
 * lost, which is what makes this the right choice over deleting.
 */
function MergePerson({ personId, name, candidates }: { personId: number; name: string; candidates: MergeCandidate[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<MergeCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = q.trim()
    ? candidates.filter((c) => `${c.name} ${c.company}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8)
    : [];

  const merge = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    const res = await mergePeople(personId, [picked.id]);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      router.refresh();
      return;
    }
    setOpen(false);
    setPicked(null);
    setQ('');
    router.refresh();
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ font: 'inherit', fontSize: 12, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', background: 'transparent', color: V('muted'), border: `1px solid ${V('line')}`, justifySelf: 'start' }}
      >
        Merge another record into this one
      </button>
    );
  }

  return (
    <section style={{ ...card, borderColor: V('cyan'), padding: '14px 16px', overflowWrap: 'anywhere' }}>
      <div style={{ ...label, color: V('cyan') }}>Merge into {name}</div>
      {error && (
        <div style={{ border: `1px solid ${V('red')}`, borderRadius: 8, padding: '9px 12px', marginTop: 10, fontSize: 12.5 }}>
          <span style={{ ...label, color: V('red') }}>could not merge</span> {error}
        </div>
      )}

      {picked ? (
        <>
          <p style={{ color: V('muted'), fontSize: 12.5, lineHeight: 1.6, margin: '8px 0 0' }}>
            <b style={{ color: V('text') }} dir="auto">{picked.name}</b>
            {picked.company ? ` (${picked.company})` : ''} will be folded into{' '}
            <b style={{ color: V('text') }} dir="auto">{name}</b>. Anything missing here is
            filled in from there
            {picked.interactions > 0
              ? `, and their ${picked.interactions} logged ${picked.interactions === 1 ? 'conversation' : 'conversations'} move across`
              : ''}
            . The other record is then removed.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={primaryBtn(busy)} disabled={busy} onClick={merge}>
              {busy ? 'merging…' : 'Merge'}
            </button>
            <button style={ghostBtn} onClick={() => setPicked(null)}>Pick someone else</button>
          </div>
        </>
      ) : (
        <>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the person to merge in…"
            dir="auto"
            style={{ ...inp(), width: '100%', marginTop: 10 }}
          />
          <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
            {matches.map((c) => (
              <button
                key={c.id}
                onClick={() => setPicked(c)}
                style={{ font: 'inherit', textAlign: 'left', display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', padding: '7px 10px', borderRadius: 8, cursor: 'pointer', background: V('bg2'), border: `1px solid ${V('line')}`, color: V('text'), overflowWrap: 'anywhere' }}
              >
                <span style={{ fontWeight: 600, fontSize: 13 }} dir="auto">{c.name}</span>
                <span style={{ color: V('faint'), fontSize: 12 }} dir="auto">
                  {[c.role, c.company].filter(Boolean).join(' · ') || 'no company'}
                </span>
                {c.interactions > 0 && (
                  <span style={{ marginLeft: 'auto', ...label }}>{c.interactions} talks</span>
                )}
              </button>
            ))}
            {q.trim() && matches.length === 0 && (
              <span style={{ color: V('faint'), fontSize: 12.5 }}>Nobody matches.</span>
            )}
          </div>
          <button style={{ ...ghostBtn, marginTop: 10 }} onClick={() => { setOpen(false); setQ(''); }}>Cancel</button>
        </>
      )}
    </section>
  );
}

/**
 * Remove someone from the list.
 *
 * Name-only fragments accumulate from imports — the same person mentioned as
 * "Derman", "דרמן" and "יואב דרמן" in different free-text fields becomes three
 * rows that no automatic dedupe will merge, because the names genuinely differ.
 *
 * The confirmation names what goes with them rather than asking a generic
 * "are you sure?": a stray fragment and someone you have spoken to three times
 * both look like one row in a list, and only one of them is safe to delete.
 */
function DeletePerson({ personId, name, interactions, edges }: {
  personId: number; name: string; interactions: number; edges: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const losses = [
    interactions > 0 ? `${interactions} logged ${interactions === 1 ? 'conversation' : 'conversations'}` : null,
    edges > 0 ? `${edges} ${edges === 1 ? 'introduction' : 'introductions'}` : null,
  ].filter(Boolean) as string[];

  const remove = async () => {
    setBusy(true);
    await deletePerson(personId);
    router.push('/people');
  };

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        style={{ font: 'inherit', fontSize: 12, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', background: 'transparent', color: V('faint'), border: `1px solid ${V('line')}`, justifySelf: 'start' }}
      >
        Delete this person
      </button>
    );
  }

  return (
    <section style={{ ...card, borderColor: V('red'), padding: '14px 16px' }}>
      <div style={{ ...label, color: V('red') }}>Delete {name}?</div>
      <p style={{ color: V('muted'), fontSize: 12.5, lineHeight: 1.6, margin: '8px 0 0' }}>
        {losses.length
          ? `This also deletes their ${losses.join(' and ')}. That cannot be undone.`
          : 'They have no conversations or introductions recorded, so nothing else is lost.'}
        {losses.length > 0 && (
          <> If this is a duplicate of someone real, <Link href="/manage" style={{ color: V('cyan') }}>merge them instead</Link> to keep the history.</>
        )}
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={remove}
          disabled={busy}
          style={{ font: 'inherit', fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', background: V('red'), color: '#fff', border: 'none', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'deleting…' : 'Delete'}
        </button>
        <button style={ghostBtn} onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    </section>
  );
}

// ─── Introductions ──────────────────────────────────────────────────────────

function IntroductionPanel({
  personId, personName, introductions, connectorNames, companies,
}: {
  personId: number;
  personName: string;
  introductions: { inbound: IntroductionEdge[]; outbound: IntroductionEdge[] };
  connectorNames: string[];
  companies: { id: number; name: string }[];
}) {
  const [, start] = useTransition();
  const [addingInbound, setAddingInbound] = useState(false);
  const [addingOutbound, setAddingOutbound] = useState<'person' | 'company' | null>(null);

  const [inboundName, setInboundName] = useState('');
  const [inboundIsSource, setInboundIsSource] = useState(false);
  const [outName, setOutName] = useState('');
  const [outCompanyName, setOutCompanyName] = useState('');

  return (
    <section style={{ ...card, padding: '14px 16px' }}>
      <datalist id="connector-names">{connectorNames.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="company-names">{companies.map((c) => <option key={c.id} value={c.name} />)}</datalist>

      <div style={label}>Who led me to them</div>
      <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        {introductions.inbound.length === 0 && (
          <span style={{ color: V('faint'), fontSize: 12.5 }}>Nobody — you reached them directly.</span>
        )}
        {introductions.inbound.map((e) => (
          <EdgeRow
            key={e.id}
            label={e.personName ?? e.sourceLabel ?? '—'}
            href={e.personId ? `/people/${e.personId}` : undefined}
            kind={e.personId ? 'person' : 'source'}
            onRemove={() => start(() => { removeIntroduction(e.id, personId); })}
          />
        ))}
      </div>

      {addingInbound ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          <input
            list="connector-names"
            value={inboundName}
            onChange={(e) => setInboundName(e.target.value)}
            placeholder="Who introduced you?"
            dir="auto"
            style={inp()}
          />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: V('muted'), cursor: 'pointer' }}>
            <input type="checkbox" checked={inboundIsSource} onChange={(e) => setInboundIsSource(e.target.checked)} />
            this is a community or group, not a person
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              style={primaryBtn(!inboundName.trim())}
              disabled={!inboundName.trim()}
              onClick={() => start(() => {
                addIntroductionToPerson(personId, inboundName, inboundIsSource);
                setInboundName(''); setAddingInbound(false);
              })}
            >
              Save
            </button>
            <button style={ghostBtn} onClick={() => setAddingInbound(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button style={{ ...ghostBtn, marginTop: 10, fontSize: 12 }} onClick={() => setAddingInbound(true)}>+ Who introduced you?</button>
      )}

      <div style={{ ...label, marginTop: 20 }}>Who they led me to</div>
      <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        {introductions.outbound.length === 0 && (
          <span style={{ color: V('faint'), fontSize: 12.5 }}>Nothing yet.</span>
        )}
        {introductions.outbound.map((e) => (
          <EdgeRow
            key={e.id}
            label={e.personName ?? e.companyName ?? '—'}
            href={e.personId ? `/people/${e.personId}` : e.companyId ? `/companies/${e.companyId}` : undefined}
            kind={e.personId ? 'person' : 'company'}
            onRemove={() => start(() => { removeIntroduction(e.id, personId); })}
          />
        ))}
      </div>

      {addingOutbound === 'person' ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          <input value={outName} onChange={(e) => setOutName(e.target.value)} placeholder="Who did they introduce you to?" dir="auto" style={inp()} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              style={primaryBtn(!outName.trim())}
              disabled={!outName.trim()}
              onClick={() => start(() => {
                addIntroductionToNewPerson(personId, { full_name: outName });
                setOutName(''); setAddingOutbound(null);
              })}
            >
              Save
            </button>
            <button style={ghostBtn} onClick={() => setAddingOutbound(null)}>Cancel</button>
          </div>
        </div>
      ) : addingOutbound === 'company' ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          <input list="company-names" value={outCompanyName} onChange={(e) => setOutCompanyName(e.target.value)} placeholder="Which company did they get you into?" dir="auto" style={inp()} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              style={primaryBtn(!outCompanyName.trim())}
              disabled={!outCompanyName.trim()}
              onClick={() => start(() => {
                addIntroductionToCompany(personId, outCompanyName);
                setOutCompanyName(''); setAddingOutbound(null);
              })}
            >
              Save
            </button>
            <button style={ghostBtn} onClick={() => setAddingOutbound(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <button style={{ ...ghostBtn, fontSize: 12 }} onClick={() => setAddingOutbound('person')}>+ A person</button>
          <button style={{ ...ghostBtn, fontSize: 12 }} onClick={() => setAddingOutbound('company')}>+ A company</button>
        </div>
      )}

      <p style={{ ...label, marginTop: 16, lineHeight: 1.7, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
        Chains build from these: if {personName} led you onward, that person&apos;s own page is where their next hop goes.
      </p>
    </section>
  );
}

function EdgeRow({ label: text, href, kind, onRemove }: { label: string; href?: string; kind: 'person' | 'company' | 'source'; onRemove: () => void }) {
  const color = kind === 'company' ? V('violet') : kind === 'source' ? V('faint') : V('cyan');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: V('bg2'), borderRadius: 8, padding: '7px 10px' }}>
      <span style={{ width: 6, height: 6, borderRadius: kind === 'company' ? 2 : 999, background: color, flexShrink: 0 }} />
      {href ? (
        <Link href={href} style={{ color: V('text'), fontSize: 13, textDecoration: 'none' }} dir="auto">{text}</Link>
      ) : (
        <span style={{ fontSize: 13 }} dir="auto">{text}</span>
      )}
      <button
        onClick={onRemove}
        title="Remove this introduction"
        style={{ marginLeft: 'auto', font: 'inherit', fontSize: 11, background: 'transparent', border: 'none', color: V('faint'), cursor: 'pointer' }}
      >
        ✕
      </button>
    </div>
  );
}

// ─── The talk log ───────────────────────────────────────────────────────────

function TalkLog({ personId, interactions }: { personId: number; interactions: InteractionRow[] }) {
  const [, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState('linkedin');
  const [whatISaid, setWhatISaid] = useState('');
  const [outcome, setOutcome] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [nextStepDue, setNextStepDue] = useState('');

  const reset = () => {
    setWhatISaid(''); setOutcome(''); setNextStep(''); setNextStepDue(''); setOpen(false);
  };

  return (
    <section style={{ ...card, padding: '14px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={label}>Conversations</div>
        <span style={{ ...label, color: V('faint') }}>{interactions.length}</span>
        {!open && (
          <button style={{ ...primaryBtn(), marginLeft: 'auto', fontSize: 12, padding: '6px 12px' }} onClick={() => setOpen(true)}>
            + Log a conversation
          </button>
        )}
      </div>

      {open && (
        <div style={{ display: 'grid', gap: 10, marginTop: 14, padding: 14, background: V('bg2'), borderRadius: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {channelOrder.map((c) => (
              <button key={c} onClick={() => setChannel(c)} style={pill(channel === c, channelMeta[c].color)}>
                {channelMeta[c].label}
              </button>
            ))}
          </div>
          <Field l="What I told them">
            <textarea value={whatISaid} onChange={(e) => setWhatISaid(e.target.value)} dir="auto" placeholder="What you asked for, what you pitched…" style={{ ...inp(), minHeight: 56, resize: 'vertical' }} />
          </Field>
          <Field l="What came of it">
            <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} dir="auto" placeholder="Their answer, what they offered…" style={{ ...inp(), minHeight: 56, resize: 'vertical' }} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10 }}>
            <Field l="Next step">
              <input value={nextStep} onChange={(e) => setNextStep(e.target.value)} dir="auto" placeholder="Follow up, send CV…" style={inp()} />
            </Field>
            <Field l="Due">
              <input type="date" value={nextStepDue} onChange={(e) => setNextStepDue(e.target.value)} style={inp()} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              style={primaryBtn(!whatISaid.trim() && !outcome.trim())}
              disabled={!whatISaid.trim() && !outcome.trim()}
              onClick={() => start(() => {
                logInteraction({ personId, channel, whatISaid, outcome, nextStep, nextStepDue });
                reset();
              })}
            >
              Save
            </button>
            <button style={ghostBtn} onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        {interactions.length === 0 && !open && (
          <span style={{ color: V('faint'), fontSize: 13 }}>No conversations logged yet.</span>
        )}
        {interactions.map((it) => (
          <article key={it.id} style={{ borderLeft: `2px solid ${channelMeta[it.channel]?.color ?? V('line')}`, paddingLeft: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ ...label, color: channelMeta[it.channel]?.color }}>{channelMeta[it.channel]?.label ?? it.channel}</span>
              <span style={{ ...label, color: V('faint') }}>{daysAgo(it.occurred_at)}</span>
              <button
                onClick={() => start(() => { deleteInteraction(it.id, personId); })}
                style={{ marginLeft: 'auto', font: 'inherit', fontSize: 11, background: 'transparent', border: 'none', color: V('faint'), cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            {it.what_i_said && <div style={{ fontSize: 13, marginTop: 4 }} dir="auto"><span style={{ color: V('faint') }}>I said: </span>{it.what_i_said}</div>}
            {it.outcome && <div style={{ fontSize: 13, marginTop: 2 }} dir="auto"><span style={{ color: V('faint') }}>Outcome: </span>{it.outcome}</div>}
            {it.next_step && (
              <div style={{ ...chip(V('amber')), marginTop: 6, fontSize: 10.5 }} dir="auto">
                next: {it.next_step}{it.next_step_due ? ` · ${it.next_step_due}` : ''}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
