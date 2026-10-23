#!/bin/bash
# Xvfb end-to-end: a real XDND file drag from another app onto the notch.
# Usage: e2e/drag.sh [dropX dropY] [--no-dragwatch]   (defaults: drop 100 px under the notch, in the magnet band)
set -u; APPFLAGS=${APPFLAGS:-}
cd "$(dirname "$0")/.."
DX=${1:-720}; DY=${2:-200}; EXTRA=${3:-}
D=:9; export DISPLAY=$D
pgrep -f "Xvfb $D" >/dev/null || (Xvfb $D -screen 0 1440x900x24 >/dev/null 2>&1 &); sleep 1
H=$(mktemp -d /tmp/nubbi-e2e-XXXX); mkdir -p "$H/.claude"; LOG=$H/e2e.log
printf 'Quarterly note: the launch moved to 12 December.\n' > "$H/launch-note.txt"
ENVX=""; [ "$EXTRA" = "--no-dragwatch" ] && ENVX="NUBBI_NO_DRAGWATCH=1"
env $ENVX NUBBI_E2E=$LOG NUBBI_HOME=$H NUBBI_FAKE_NOTCH=1 ./node_modules/.bin/electron . --no-sandbox $APPFLAGS >"$H/app.out" 2>&1 &
APP=$!

SRC=$!
sleep 6
python3 e2e/xdnd_drag.py "$H/launch-note.txt" 350 700 $DX $DY 2>&1 | tee "$H/drag.out"
# move like a hand would: towards the notch in small steps
sleep 3
kill $APP 2>/dev/null; wait 2>/dev/null
echo "--- log ($LOG)"; cat $LOG
grep -q '"view":"ready".*launch-note.txt' $LOG && echo "RESULT: PASS — file dropped and read" || { echo "RESULT: FAIL"; grep -i -E "startDrag|error" $H/src.out $H/app.out | head; }
