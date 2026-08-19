import 'server-only';

/**
 * Refuse requests that did not come from this app's own pages.
 *
 * The server listens on localhost with no authentication, which is fine for
 * reading — but any website open in the same browser can POST to localhost too.
 * For the routes that write secrets or files, that is a real way for a page you
 * are merely visiting to plant an API key or a CSV. Checking the Origin closes
 * it, since browsers set it on cross-site requests and will not let a page forge
 * it. Requests with no Origin at all are same-origin form posts or curl, which
 * are the user acting deliberately.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
