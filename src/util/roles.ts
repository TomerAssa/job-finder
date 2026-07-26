/**
 * Is this job title a Product Manager role? The user only wants product management
 * positions (any flavor — AI PM, technical PM, senior/lead/head/VP/CPO, product owner) —
 * and explicitly nothing else. We deliberately EXCLUDE adjacent-but-different roles:
 * product marketing, product design, product analyst, project/program manager.
 */
export function isProductManager(title: string | null | undefined): boolean {
  if (!title) return false;
  const t = ` ${title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

  // Adjacent roles that contain "product" but are NOT product management.
  if (/ product (marketing|design|designer|analyst|support|specialist|operations|ops) /.test(t)) return false;
  if (/ (project|program) manager /.test(t)) return false;

  // Core product-management signals.
  if (/ product (manager|owner|management|lead|lead(er)?) /.test(t)) return true;
  if (/ (head|vp|vice president|director|chief|group|principal|lead|senior|staff) (of )?product /.test(t)) return true;
  if (/ chief product officer | cpo /.test(t)) return true;
  return false;
}
