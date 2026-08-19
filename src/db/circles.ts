/**
 * `people.circle` is derived, never hand-edited: it is the hop distance from you.
 *
 *   circle 1 — you reached them directly (or through a non-person source such as
 *              a community or a family member; those are edges with a NULL
 *              `from_person_id` and a `source_label`)
 *   circle N — the shortest chain of introductions to them is N-1 people long
 *
 * BFS over `introductions`, cheap at any plausible size of a personal network.
 * Takes a handle rather than calling `db()` so migrations can run it mid-transaction
 * without importing the client (and creating a cycle).
 */
import type Database from 'better-sqlite3';

export function recomputeCircles(handle: Database.Database): void {
  const exists = handle
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('people','introductions')`)
    .all();
  if (exists.length < 2) return; // pre-migration database

  const ids = (handle.prepare('SELECT id FROM people').all() as { id: number }[]).map((r) => r.id);
  if (!ids.length) return;

  // person -> people they introduced me to (person targets only; company edges
  // are endpoints, they never continue a chain)
  const outbound = new Map<number, number[]>();
  // person -> whether anyone introduced me to them
  const hasInbound = new Set<number>();

  const edges = handle
    .prepare(
      `SELECT from_person_id AS f, to_person_id AS t FROM introductions
       WHERE to_person_id IS NOT NULL`,
    )
    .all() as { f: number | null; t: number }[];

  for (const e of edges) {
    if (e.f == null) continue; // rooted edge: a source led me to them, still circle 1
    if (e.f === e.t) continue; // self-loop, ignore
    if (!outbound.has(e.f)) outbound.set(e.f, []);
    outbound.get(e.f)!.push(e.t);
    hasInbound.add(e.t);
  }

  const circle = new Map<number, number>();
  let frontier = ids.filter((id) => !hasInbound.has(id));
  for (const id of frontier) circle.set(id, 1);

  let depth = 1;
  while (frontier.length) {
    depth++;
    const next: number[] = [];
    for (const id of frontier) {
      for (const to of outbound.get(id) ?? []) {
        if (circle.has(to)) continue; // already reached by a shorter chain
        circle.set(to, depth);
        next.push(to);
      }
    }
    frontier = next;
  }

  // Anything still unset is in an introduction cycle with no root. Leave it NULL
  // rather than inventing a distance; the UI renders that as "—".
  const update = handle.prepare('UPDATE people SET circle = ? WHERE id = ?');
  const tx = handle.transaction(() => {
    for (const id of ids) update.run(circle.get(id) ?? null, id);
  });
  tx();
}
