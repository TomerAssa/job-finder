/**
 * Company-name resolution, bound to the CLI's singleton handle.
 * The implementation lives in `repo.ts`; see `people.ts` for why.
 */
import { repo } from './people.js';
import type { Repo } from './repo.js';

export const matchCompany: Repo['matchCompany'] = (...a) => repo().matchCompany(...a);
export const ensureCompany: Repo['ensureCompany'] = (...a) => repo().ensureCompany(...a);
export const invalidateCompanyCache = () => repo().invalidateCompanyCache();
