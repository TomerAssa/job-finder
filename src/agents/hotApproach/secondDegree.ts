import { serpSearch } from '../../brightdata/serp.js';
import { db } from '../../db/client.js';

/**
 * BEST-EFFORT 2nd-degree discovery. LinkedIn does NOT expose your connections'
 * connections, so a true "who of my connections knows someone there" is not
 * obtainable. As an approximation we surface public employees of companies where
 * you have open positions, via SERP, so you can eyeball overlaps yourself. We do
 * NOT write these as warm_intros — they are informational only and unverified.
 *
 * Uses only public search results, rate-limited. Respect LinkedIn's ToS.
 */
export async function runSecondDegree(limit = 10): Promise<void> {
  console.log(
    '\n⚠️  2nd-degree is approximate: LinkedIn does not expose connections-of-connections.\n' +
      '   Listing public employees at shortlisted companies for manual review only.\n',
  );

  const companies = db()
    .prepare(
      `SELECT DISTINCT c.id, c.name FROM companies c
       JOIN positions p ON p.company_id = c.id AND p.is_shortlisted = 1
       ORDER BY c.name LIMIT ?`,
    )
    .all(limit) as Array<{ id: number; name: string }>;

  if (companies.length === 0) {
    console.log('   No shortlisted companies yet. Run `connect` (direct match) first.');
    return;
  }

  for (const c of companies) {
    let names: string[] = [];
    try {
      const results = await serpSearch(`site:linkedin.com/in "${c.name}"`, 10);
      names = results
        .map((r) => r.title.split(/[-|–]/)[0].trim())
        .filter((n) => n && n.length < 60);
    } catch {
      /* ignore */
    }
    console.log(`   ${c.name}: ${names.slice(0, 8).join(', ') || '(no public profiles found)'}`);
  }
  console.log('');
}
