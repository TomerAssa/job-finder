import { startLog, finishLog } from '../../db/checkLog.js';
import { runDirectMatch } from './directMatch.js';
import { runSecondDegree } from './secondDegree.js';

export interface ConnectOpts {
  secondDegree?: boolean;
  limit?: number;
}

/** Run the hot-approach agent: reliable direct match, optional 2nd-degree pass. */
export async function runHotApproach(opts: ConnectOpts = {}): Promise<void> {
  const logId = startLog('connect', null);
  const { intros, shortlisted } = runDirectMatch();
  finishLog(logId, 'ok', { intros, shortlisted });
  console.log(
    `🤝 Direct warm intros: ${intros} connection→company matches; ` +
      `${shortlisted} positions shortlisted.`,
  );

  if (opts.secondDegree) {
    await runSecondDegree(opts.limit ?? 10);
  }
}
