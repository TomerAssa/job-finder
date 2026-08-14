/**
 * What kinds of people to look for at a company.
 *
 * The finder used to hardcode two queries — product managers and recruiters —
 * because the tool only ever had one user looking for one kind of job. Presets
 * make that a choice without making the caller write search syntax.
 */

export interface RolePreset {
  key: string;
  label: string;
  /** Terms OR'd together inside the search query. */
  terms: string[];
  /** Short reason this group is worth talking to, shown in the UI. */
  why: string;
}

export const ROLE_PRESETS: RolePreset[] = [
  {
    key: 'product',
    label: 'Product',
    terms: ['product manager', 'product lead', 'head of product', 'vp product', 'cpo'],
    why: 'Peers who can tell you what the team is actually like',
  },
  {
    key: 'hr',
    label: 'HR / Talent',
    terms: ['recruiter', 'talent acquisition', 'human resources', 'people partner', 'head of talent'],
    why: 'The people who move an application forward',
  },
  {
    key: 'engineering',
    label: 'Engineering leadership',
    terms: ['vp engineering', 'head of engineering', 'engineering manager', 'cto', 'r&d manager'],
    why: 'Hiring managers for technical teams',
  },
  {
    key: 'founders',
    label: 'Founders & execs',
    terms: ['founder', 'co-founder', 'ceo', 'coo', 'general manager'],
    why: 'At a small company, the person who decides',
  },
];

export const DEFAULT_ROLE_KEYS = ['product', 'hr'];

export function presetsFor(keys: string[] | undefined): RolePreset[] {
  const wanted = keys?.length ? keys : DEFAULT_ROLE_KEYS;
  return ROLE_PRESETS.filter((p) => wanted.includes(p.key));
}

/** A custom list of titles, treated as one ad-hoc preset. */
export function customPreset(titles: string[]): RolePreset | null {
  const terms = titles.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!terms.length) return null;
  return { key: 'custom', label: 'Custom', terms, why: 'Titles you asked for' };
}

/**
 * Build the search query for one preset at one company.
 *
 * `location` is a hint, not a filter — LinkedIn profile pages mention a region
 * inconsistently, so requiring it loses more real people than it excludes wrong
 * ones. It stays optional for exactly that reason.
 */
export function buildQuery(companyName: string, preset: RolePreset, location?: string | null): string {
  const terms = preset.terms.map((t) => (t.includes(' ') ? `"${t}"` : t)).join(' OR ');
  const loc = location?.trim() ? ` (${location.trim()})` : '';
  return `site:linkedin.com/in "${companyName}" (${terms})${loc}`;
}
