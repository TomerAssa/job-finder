/**
 * CLI-side binding of the people repository to the singleton database handle.
 *
 * The logic lives in `repo.ts`, which takes a handle so the web app can share it.
 * This module exists so CLI code can keep calling plain functions.
 */
import { db } from './client.js';
import { createRepo, type Repo } from './repo.js';

const repos = new WeakMap<object, Repo>();

/** The repository for the current handle, memoized so the company cache survives. */
export function repo(): Repo {
  const handle = db();
  let r = repos.get(handle);
  if (!r) {
    r = createRepo(handle);
    repos.set(handle, r);
  }
  return r;
}

export type {
  PersonRow,
  PersonInput,
  PersonStatus,
  PersonOrigin,
  Channel,
  IntroductionInput,
  IntroductionEdge,
  InteractionInput,
  InteractionRow,
  Repo,
} from './repo.js';

export const getPerson: Repo['getPerson'] = (...a) => repo().getPerson(...a);
export const resolvePerson: Repo['resolvePerson'] = (...a) => repo().resolvePerson(...a);
export const findPersonByName: Repo['findPersonByName'] = (...a) => repo().findPersonByName(...a);
export const similarPeople: Repo['similarPeople'] = (...a) => repo().similarPeople(...a);
export const upsertPerson: Repo['upsertPerson'] = (...a) => repo().upsertPerson(...a);
export const updatePerson: Repo['updatePerson'] = (...a) => repo().updatePerson(...a);
export const deletePerson: Repo['deletePerson'] = (...a) => repo().deletePerson(...a);
export const addIntroduction: Repo['addIntroduction'] = (...a) => repo().addIntroduction(...a);
export const removeIntroduction: Repo['removeIntroduction'] = (...a) => repo().removeIntroduction(...a);
export const introductionsFor: Repo['introductionsFor'] = (...a) => repo().introductionsFor(...a);
export const introductionSources: Repo['introductionSources'] = (...a) => repo().introductionSources(...a);
export const logInteraction: Repo['logInteraction'] = (...a) => repo().logInteraction(...a);
export const interactionsFor: Repo['interactionsFor'] = (...a) => repo().interactionsFor(...a);
export const promoteConnection: Repo['promoteConnection'] = (...a) => repo().promoteConnection(...a);
export const mergePeople: Repo['mergePeople'] = (...a) => repo().mergePeople(...a);
export const recomputeCircles = () => repo().recomputeCircles();

/**
 * Connections at companies that have open positions — the crossing that makes
 * the pool worth keeping. Excludes anyone already promoted.
 */
export function connectionsAtHiringCompanies(): Array<{
  id: number;
  full_name: string;
  company: string | null;
  position: string | null;
  linkedin_url: string | null;
  company_id: number;
  open_positions: number;
}> {
  return db()
    .prepare(
      `SELECT k.id, k.full_name, k.company, k.position, k.linkedin_url,
              c.id AS company_id, COUNT(p.id) AS open_positions
         FROM connections k
         JOIN companies c ON c.name_norm = k.company_norm
         JOIN positions p ON p.company_id = c.id
        WHERE k.person_id IS NULL AND k.company_norm IS NOT NULL AND k.company_norm != ''
        GROUP BY k.id, c.id
        ORDER BY open_positions DESC, k.full_name COLLATE NOCASE`,
    )
    .all() as never;
}
