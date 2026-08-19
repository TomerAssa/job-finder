/**
 * Confirm which LinkedIn company page belongs to a company before trusting
 * anything scraped in its name.
 *
 * `site:linkedin.com/in "Dream"` matches everything and nothing. Short or
 * generic company names both over-match (people at unrelated companies whose
 * profile happens to contain the word) and under-match. The fix is to establish
 * the company's identity first: find its LinkedIn page, and check that the
 * website that page advertises is the website we already have on file.
 *
 * When that check passes, results from the company's own page can be trusted.
 * When it does not, the search still runs — but its hits are marked unverified
 * so the review queue shows them for what they are: guesses.
 */
import { db, now } from '../../db/client.js';
import { fetchPage } from '../../brightdata/unlocker.js';
import { serpSearch } from '../../brightdata/serp.js';
import { registrableDomain, sameDomain } from '../../util/domain.js';
import { normalizeCompany } from '../../util/normalize.js';

export interface VerificationResult {
  verified: boolean;
  linkedinUrl: string | null;
  /** Why it did or did not verify, shown to the user rather than swallowed. */
  reason: string;
}

const COMPANY_PATH = /linkedin\.com\/company\/([^/?#]+)/i;

export function normalizeCompanyPageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = COMPANY_PATH.exec(raw);
  if (!m) return null;
  return `https://www.linkedin.com/company/${m[1].toLowerCase().replace(/\/+$/, '')}`;
}

/** Every external link on the page, so we can look for the company's own site. */
function outboundDomains(html: string): string[] {
  const out = new Set<string>();
  const re = /href="(https?:\/\/[^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const d = registrableDomain(m[1]);
    if (d && !d.endsWith('linkedin.com') && !d.endsWith('licdn.com')) out.add(d);
  }
  return [...out];
}

/**
 * Resolve and verify a company's LinkedIn page. Caches the outcome on the
 * company row so a scan does not pay for this twice.
 */
export async function verifyCompanyLinkedin(companyId: number): Promise<VerificationResult> {
  const handle = db();
  const company = handle
    .prepare('SELECT id, name, website_url, linkedin_url, linkedin_verified FROM companies WHERE id = ?')
    .get(companyId) as
    | { id: number; name: string; website_url: string | null; linkedin_url: string | null; linkedin_verified: number }
    | undefined;
  if (!company) throw new Error(`No company with id ${companyId}`);

  if (company.linkedin_verified && company.linkedin_url) {
    return { verified: true, linkedinUrl: company.linkedin_url, reason: 'Already verified' };
  }
  if (!company.website_url) {
    return {
      verified: false,
      linkedinUrl: company.linkedin_url,
      reason: `No website on file for ${company.name}, so there is nothing to check a LinkedIn page against`,
    };
  }

  const results = await serpSearch(`site:linkedin.com/company "${company.name}"`, 5);
  const candidates = results
    .map((r) => normalizeCompanyPageUrl(r.url))
    .filter((u): u is string => u !== null);

  if (!candidates.length) {
    return {
      verified: false,
      linkedinUrl: null,
      reason: `Could not find a LinkedIn company page for ${company.name}`,
    };
  }

  const wantedDomain = registrableDomain(company.website_url);
  const nameNorm = normalizeCompany(company.name);

  for (const url of candidates.slice(0, 3)) {
    let html: string;
    try {
      html = await fetchPage(url);
    } catch {
      continue; // try the next candidate rather than failing the whole scan
    }

    const domains = outboundDomains(html);
    if (domains.some((d) => sameDomain(d, company.website_url))) {
      handle
        .prepare('UPDATE companies SET linkedin_url = ?, linkedin_verified = 1 WHERE id = ?')
        .run(url, companyId);
      return {
        verified: true,
        linkedinUrl: url,
        reason: `LinkedIn page links to ${wantedDomain}, which matches the website on file`,
      };
    }

    // The slug matching the company name is weak evidence — good enough to
    // remember the URL, not good enough to call it verified.
    const slug = normalizeCompany(url.split('/company/')[1] ?? '');
    if (slug && nameNorm && slug === nameNorm) {
      handle.prepare('UPDATE companies SET linkedin_url = ? WHERE id = ?').run(url, companyId);
    }
  }

  return {
    verified: false,
    linkedinUrl: normalizeCompanyPageUrl(candidates[0]),
    reason:
      `Found a LinkedIn page for ${company.name} but it does not link to ${wantedDomain}. ` +
      `Results will be marked unverified in case it is a different company with the same name.`,
  };
}
