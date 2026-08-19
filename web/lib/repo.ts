import 'server-only';
import { db } from './db';
import { createRepo, type Repo } from '../../src/db/repo.js';

/**
 * The people repository, bound to the web app's database handle.
 *
 * Same implementation the CLI uses — identity resolution, the introduction graph
 * and circle computation live in one place so the two cannot drift.
 */
let _repo: Repo | null = null;

export function repo(): Repo {
  if (!_repo) _repo = createRepo(db());
  return _repo;
}

export type { PersonRow, IntroductionEdge, InteractionRow } from '../../src/db/repo.js';
