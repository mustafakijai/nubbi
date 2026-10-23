#!/bin/sh
# nubbi-hook — relays Claude Code hook events to the Nubbi app.
# FAILS OPEN: if the app isn't running (or anything goes wrong) it prints nothing
# and exits 0, so Claude Code carries on with its normal terminal prompt.
EVENT="${1:-unknown}"
DIR="${NUBBI_HOOK_DIR:-$HOME/.nubbi}"
PORT=$(cat "$DIR/port" 2>/dev/null)
TOKEN=$(cat "$DIR/token" 2>/dev/null)
if [ -z "$PORT" ] || [ -z "$TOKEN" ] || ! command -v curl >/dev/null 2>&1; then
  cat >/dev/null 2>&1; exit 0
fi
MAX=4
[ "$EVENT" = "PermissionRequest" ] && MAX=115
curl -s --fail --noproxy '*' --connect-timeout 1 --max-time "$MAX" \
  -H "Content-Type: application/json" \
  -H "X-Nubbi-Token: $TOKEN" \
  -H "X-Nubbi-Term: ${TERM_PROGRAM:-}" \
  -H "X-Nubbi-Bundle: ${__CFBundleIdentifier:-}" \
  --data-binary @- "http://127.0.0.1:$PORT/hook/$EVENT" 2>/dev/null
exit 0
