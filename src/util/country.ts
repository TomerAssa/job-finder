const CANONICAL: Record<string, string> = {
  us: 'United States', usa: 'United States', 'u.s.': 'United States', 'u.s.a.': 'United States',
  'united states': 'United States', 'united states of america': 'United States', america: 'United States',
  uk: 'United Kingdom', 'u.k.': 'United Kingdom', 'united kingdom': 'United Kingdom',
  britain: 'United Kingdom', 'great britain': 'United Kingdom', england: 'United Kingdom',
  israel: 'Israel', isr: 'Israel', il: 'Israel',
  netherlands: 'Netherlands', holland: 'Netherlands', uae: 'United Arab Emirates',
};

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Normalize a (possibly multi-valued) country label to canonical names.
 * "usa" -> "United States", "france, uk" -> "France, United Kingdom",
 * "Israel, USA" -> "Israel, United States". Returns null for empty input.
 */
export function normalizeCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parts = raw
    .split(/\s*(?:,|\/|\band\b|;)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const seen: string[] = [];
  for (const p of parts) {
    const canon = CANONICAL[p.toLowerCase()] ?? titleCase(p.toLowerCase());
    if (canon && !seen.includes(canon)) seen.push(canon);
  }
  return seen.length ? seen.join(', ') : null;
}
