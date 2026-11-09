#!/usr/bin/env bash
#
# Serve the console to your phone over Tailscale, for as long as this runs.
#
#   npm run phone
#
# The shape matters more than the commands. Next binds 0.0.0.0 by default, which
# would put this app — which has no authentication of any kind, and an endpoint
# that rewrites .env — on whatever Wi-Fi you happen to be on. So the server is
# pinned to loopback and Tailscale proxies to it:
#
#   phone --(WireGuard)--> tailscaled on this Mac --> 127.0.0.1:4311
#
# Nothing ever listens on a routable interface, and when this script exits both
# halves are torn down.
#
# Deliberately NOT `tailscale funnel`: that publishes to the public internet.
set -euo pipefail

PORT="${JOB_WEB_PORT:-4311}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$ROOT/web"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ── preflight ───────────────────────────────────────────────────────────────
command -v tailscale >/dev/null || die "tailscale not found. Install the app, then its CLI."
tailscale status >/dev/null 2>&1 || die "Tailscale is not connected. Open the app and sign in."

TSHOST="$(tailscale status --json | python3 -c \
  'import sys,json; print((json.load(sys.stdin).get("Self") or {}).get("DNSName","").rstrip("."))')"
[ -n "$TSHOST" ] || die "Could not read this machine's Tailscale name."

# The web app resolves its database relative to its own cwd when JOB_DB is unset,
# and src/config.ts resolves the same variable against a different base. An
# absolute path is the only spelling both agree on.
export JOB_DB="${JOB_DB:-$ROOT/data/output/job.db}"
case "$JOB_DB" in /*) ;; *) die "JOB_DB must be an absolute path, got: $JOB_DB" ;; esac
[ -f "$JOB_DB" ] || die "No database at $JOB_DB. Run the CLI once first."

# Whoever already holds the port wins, and it is worth saying who.
#
# This is not hypothetical: the first run of this script refused to start
# because a `next dev -p 4311` begun eight days earlier was still listening —
# on ALL interfaces, as `next dev` does — which meant the console was answering
# unauthenticated on the laptop's Wi-Fi address the whole time.
holder="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
if [ -n "$holder" ]; then
  cmd="$(ps -o command= -p "$holder" 2>/dev/null || echo '?')"
  warn "Port $PORT is already in use by PID $holder:"
  warn "    $cmd"
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | grep -qE "\*:$PORT|0\.0\.0\.0:$PORT"; then
    warn ""
    warn "  That process is listening on ALL interfaces, so the console is"
    warn "  reachable by anyone on your current network — with no authentication."
  fi
  die "Stop it first (kill $holder), or pick another port: JOB_WEB_PORT=4312 npm run phone"
fi

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^job-redis$'; then
  warn "⚠️  job-redis is not running — the credits panel will be empty."
  warn "   docker compose up -d redis"
fi

# Rebuild when the build is missing or older than the sources it came from.
if [ ! -d "$WEB/.next" ] || [ -n "$(find "$WEB/app" "$WEB/lib" "$ROOT/src" -newer "$WEB/.next" -name '*.ts*' -print -quit 2>/dev/null)" ]; then
  say "▸ Building (sources are newer than the last build)…"
  (cd "$WEB" && npm run build)
fi

# ── teardown, however we exit ───────────────────────────────────────────────
NEXT_PID=""
LISTEN_PID=""
cleanup() {
  printf '\n'
  say "▸ Tearing down…"
  tailscale serve reset >/dev/null 2>&1 || true

  # Kill the children too, not just the npm wrapper. `npm run` spawns
  # next-server as a grandchild whose argv is rewritten to "next-server
  # (v15.5.23)", so killing the wrapper alone leaves a listener behind that
  # neither `pkill -f "next start"` nor the next run's preflight can explain.
  if [ -n "$NEXT_PID" ]; then
    pkill -TERM -P "$NEXT_PID" 2>/dev/null || true
    kill -TERM "$NEXT_PID" 2>/dev/null || true
    [ -n "${LISTEN_PID:-}" ] && kill -TERM "$LISTEN_PID" 2>/dev/null || true
    for _ in $(seq 1 10); do
      lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1 || break
      sleep 0.5
    done
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
      pkill -KILL -P "$NEXT_PID" 2>/dev/null || true
      kill -KILL "$NEXT_PID" 2>/dev/null || true
      [ -n "${LISTEN_PID:-}" ] && kill -KILL "$LISTEN_PID" 2>/dev/null || true
    fi
    wait "$NEXT_PID" 2>/dev/null || true
  fi

  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
    warn "⚠️  Something is STILL listening on $PORT — check it by hand:"
    warn "    lsof -nP -iTCP:$PORT -sTCP:LISTEN"
  else
    say "▸ Done. Nothing is listening and no serve config remains."
  fi
}
trap cleanup EXIT INT TERM

# ── decide how to expose it, then start the server once ─────────────────────
#
#   serve (default) — app on loopback, tailscaled terminates TLS and proxies to
#                     it. Nothing listens on a routable interface, and you get a
#                     real certificate. Needs Tailscale Serve enabled for the
#                     tailnet (one click in the admin console).
#
#   direct          — app bound to this machine's Tailscale address. Still only
#                     reachable over WireGuard and still encrypted by it, but the
#                     listener sits on the tailnet interface and there is no
#                     certificate, so no padlock.
#
# Both are tailnet-only. Neither is `tailscale funnel`, which would be public.
#
# The mode is chosen before anything starts: an earlier version booted on
# loopback and then restarted for the direct bind, and the restart was flaky
# enough to produce a server that answered every route with a 500.
MODE="${JOB_WEB_BIND:-serve}"

# `next build` currently serves /people (and so /, which redirects there) as a
# silent 500, while `next dev` serves it fine — a defect in the production
# bundle that predates this script. Dev is therefore the default until that is
# fixed; JOB_WEB_MODE=prod opts into the faster path.
BUILD="${JOB_WEB_MODE:-dev}"

case "$MODE" in
  serve)  BIND=127.0.0.1 ;;
  direct) BIND="$(tailscale ip -4 2>/dev/null | head -1)"
          [ -n "$BIND" ] || die "Could not read this machine's Tailscale IPv4 address." ;;
  *)      die "JOB_WEB_BIND must be 'serve' or 'direct', got: $MODE" ;;
esac

case "$BUILD" in
  dev)  SCRIPT=dev:tailnet ;;
  prod) SCRIPT=start:tailnet
        if [ ! -d "$WEB/.next" ] || [ -n "$(find "$WEB/app" "$WEB/lib" "$ROOT/src" -newer "$WEB/.next" -name '*.ts*' -print -quit 2>/dev/null)" ]; then
          say "▸ Building…"
          (cd "$WEB" && npm run build)
        fi ;;
  *)    die "JOB_WEB_MODE must be 'dev' or 'prod', got: $BUILD" ;;
esac

say "▸ Starting the console ($BUILD) on $BIND:${PORT}…"
# JOB_WEB_PORT is read by the npm script too, not just by the checks here —
# without passing it the script would police one port while the server bound
# another, which is exactly how the first test run looked like a success.
(cd "$WEB" && JOB_WEB_PORT="$PORT" JOB_WEB_BIND_HOST="$BIND" exec npm run "$SCRIPT" -- -H "$BIND") &
NEXT_PID=$!

for _ in $(seq 1 90); do
  if curl -fsS -o /dev/null "http://$BIND:$PORT/jobs" 2>/dev/null; then break; fi
  kill -0 "$NEXT_PID" 2>/dev/null || die "The server exited before it came up."
  sleep 1
done
# /jobs, not /: `/` redirects to /people, which the production bundle answers
# with a 500, so health-checking the root would call a broken server healthy.
curl -fsS -o /dev/null "http://$BIND:$PORT/jobs" 2>/dev/null \
  || die "The server did not answer on http://$BIND:$PORT/jobs within 90s."

# `npm run` leaves a grandchild whose argv is rewritten to "next-server (v15.5.23)",
# so it is findable by neither the wrapper PID nor a pkill pattern. Whoever holds
# the port is the thing that has to die, so record it by port.
LISTEN_PID="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"

# Prove the promise this script makes, rather than assuming it.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | grep -qE "\*:$PORT|0\.0\.0\.0:$PORT"; then
  die "Refusing to continue: something is listening on ALL interfaces on $PORT, not just $BIND."
fi
say "  ✓ confirmed bound to $BIND only"

# ── expose it to the tailnet, and only the tailnet ──────────────────────────
URL_PATH="/jobs"   # `/` redirects to /people; see the note on the health check.

if [ "$MODE" = "direct" ]; then
  say "▸ Reachable over WireGuard only — no certificate, so no padlock."
  say "▸ Open this on your phone:"
  printf '\n    \033[1;36mhttp://%s:%s%s\033[0m\n\n' "$TSHOST" "$PORT" "$URL_PATH"
  say "   (Tailscale must be connected on the phone. Ctrl-C here to stop.)"
  wait "$NEXT_PID"
  exit 0
fi

say "▸ Serving to your tailnet over HTTPS…"
SERVE_LOG="$(mktemp -t jobphone)"
tailscale serve "http://127.0.0.1:$PORT" >"$SERVE_LOG" 2>&1 &
SERVE_PID=$!

# `tailscale serve` prints its refusal and then keeps running, so waiting on it
# would hang forever looking like success. Watch for either outcome instead.
ok=0
for _ in $(seq 1 20); do
  if grep -qi "not enabled\|not available\|Error" "$SERVE_LOG" 2>/dev/null; then break; fi
  if tailscale serve status 2>/dev/null | grep -q "$PORT"; then ok=1; break; fi
  kill -0 "$SERVE_PID" 2>/dev/null || break
  sleep 0.5
done

if [ "$ok" != "1" ]; then
  kill "$SERVE_PID" 2>/dev/null || true
  warn ""
  warn "Tailscale Serve is not enabled for this tailnet, so HTTPS is unavailable:"
  sed 's/^/    /' "$SERVE_LOG" >&2 || true
  rm -f "$SERVE_LOG"
  warn ""
  warn "  Enable it with the link above (one click), then re-run this."
  warn "  Or go without a certificate — still WireGuard-encrypted, tailnet-only:"
  warn ""
  warn "      JOB_WEB_BIND=direct npm run phone"
  warn ""
  exit 1
fi
rm -f "$SERVE_LOG"

say "▸ Open this on your phone:"
printf '\n    \033[1;36mhttps://%s%s\033[0m\n\n' "$TSHOST" "$URL_PATH"
say "   (Tailscale must be connected on the phone. Ctrl-C here to stop.)"
wait "$SERVE_PID"
