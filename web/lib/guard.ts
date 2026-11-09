import 'server-only';

/**
 * Refuse requests that did not come from this app's own pages.
 *
 * Any website open in the same browser can POST to this server, and the routes
 * that guard with this write secrets or files — a real way for a page you are
 * merely visiting to plant an API key or a CSV. Checking the Origin closes it,
 * since browsers set it on every non-GET request and will not let a page forge
 * it.
 *
 * A missing Origin used to pass, on the reasoning that it meant curl and so the
 * user acting deliberately. That reasoning depended on the server being
 * reachable only from this machine. It is now also served over a Tailscale
 * tailnet (see scripts/phone.sh), where "no Origin header" is simply the
 * cheapest way to skip the check — and the route behind it rewrites `.env`.
 *
 * Both callers are POST handlers and every browser sends Origin on a POST, so
 * requiring it costs the app nothing. It does mean a hand-rolled `curl` is now
 * refused: that is what the CLI is for.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  // Behind `tailscale serve` the original host arrives forwarded, and it is the
  // one the browser's Origin will match.
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
