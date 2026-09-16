import PQueue from 'p-queue';
import { db, now } from '../../db/client.js';
import { config } from '../../config.js';
import { fetchPage } from '../../brightdata/unlocker.js';
import { isAuthError, isTransientError } from '../../brightdata/client.js';
import { htmlToText } from '../../util/html.js';

/**
 * Open the individual job postings that the careers-page scrape only listed.
 *
 * The careers sweep captures a title, a link and usually a location — that is
 * all a listing row carries. Enrichment then infers seniority, years and
 * country from that text, so for the roughly three quarters of postings whose
 * listing is a bare title, it has nothing to read and `min_years`/`max_years`
 * come back null. A years filter over those rows is decoration.
 *
 * This pass closes that gap by fetching the posting itself. It is deliberately
 * narrow: product roles only, only those still open, only those with no
 * description yet and an actual link to follow. Each fetch is a billable
 * request, so the selection is the cost control.
 */

export interface PostingNeedingDetail {
  id: number;
  title: string;
  url: string;
}

export interface DetailFetchResult {
  attempted: number;
  filled: number;
  failed: number;
  /** Set when an auth failure ended the pass early — every later call would fail identically. */
  abortedOn: string | null;
}

/** A page that yielded less than this is a cookie wall or a redirect stub, not a posting. */
const MIN_USEFUL_CHARS = 200;

/**
 * Postings worth spending a request on.
 *
 * `closed_at IS NULL` matters: a role that has already vanished from the
 * careers page will never be applied to, and paying to read it is pure waste.
 */
export function selectPostingsNeedingDetail(opts: { limit?: number; all?: boolean } = {}): PostingNeedingDetail[] {
  const clauses = [
    "COALESCE(description, '') = ''",
    "COALESCE(url, '') != ''",
    'closed_at IS NULL',
  ];
  if (!opts.all) clauses.push('is_product = 1');
  const limit = opts.limit ? `LIMIT ${Number(opts.limit)}` : '';
  return db()
    .prepare(
      `SELECT id, title, url FROM positions
        WHERE ${clauses.join(' AND ')}
        ORDER BY id ${limit}`,
    )
    .all() as PostingNeedingDetail[];
}

/**
 * Fetch and store the body text of postings that have none.
 *
 * `fetch` is injectable so the selection, storage and error handling can be
 * tested without spending a request.
 */
export async function fetchPostingDetails(
  opts: {
    limit?: number;
    all?: boolean;
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
    shouldStop?: () => boolean | Promise<boolean>;
    fetch?: (url: string) => Promise<string>;
  } = {},
): Promise<DetailFetchResult> {
  const jobs = selectPostingsNeedingDetail({ limit: opts.limit, all: opts.all });
  const result: DetailFetchResult = { attempted: 0, filled: 0, failed: 0, abortedOn: null };
  if (jobs.length === 0) return result;

  const fetchOne = opts.fetch ?? ((url: string) => fetchPage(url));
  const save = db().prepare('UPDATE positions SET description = ?, last_seen_at = ? WHERE id = ?');

  console.log(`📄 Reading ${jobs.length} job ${jobs.length === 1 ? 'posting' : 'postings'} for experience and location…`);

  const queue = new PQueue({ concurrency: opts.concurrency ?? config.searchConcurrency });
  let done = 0;
  let aborted = false;

  await queue.addAll(
    jobs.map((job) => async () => {
      // An expired token fails every remaining posting the same way, so the
      // pass stops rather than burning the queue marking them all failed.
      if (aborted) return;
      if (opts.shouldStop && (await opts.shouldStop())) {
        aborted = true;
        return;
      }

      result.attempted += 1;
      try {
        const text = htmlToText(await fetchOne(job.url));
        if (text.length >= MIN_USEFUL_CHARS) {
          save.run(text, now(), job.id);
          result.filled += 1;
        } else {
          // Not an error worth a stack trace, but not a success either: the
          // request was billed and the posting still has no description.
          result.failed += 1;
        }
      } catch (err) {
        if (isAuthError(err)) {
          // Only the flag, never queue.clear(): clearing drops tasks that
          // addAll is still awaiting, so the pass would hang instead of
          // ending. The guard at the top of each task drains the rest for
          // free — they return before spending a request.
          aborted = true;
          result.abortedOn = err instanceof Error ? err.message : String(err);
          return;
        }
        result.failed += 1;
        const why = err instanceof Error ? err.message : String(err);
        console.warn(`  ⚠️  ${job.title}: ${isTransientError(err) ? 'transient — ' : ''}${why.slice(0, 160)}`);
      } finally {
        done += 1;
        opts.onProgress?.(done, jobs.length);
      }
    }),
  );

  if (result.abortedOn) {
    console.error(`❌ Stopped reading postings — ${result.abortedOn}`);
  } else {
    console.log(`📄 Read ${result.filled}/${result.attempted} postings (${result.failed} without usable text).`);
  }
  return result;
}
