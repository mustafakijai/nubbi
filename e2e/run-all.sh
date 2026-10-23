#!/bin/bash
# Drag-and-drop matrix under Xvfb (px coords on a 1440x900 screen at 2x; idle strip ≈ 106 px tall, magnet band 280 px).
cd "$(dirname "$0")/.."; fail=0
check() { want=$1; shift; out=$(e2e/drag.sh "$@" 2>&1 | grep RESULT); echo "[$want] drag.sh $* -> $out"; [[ $out == *"$want"* ]] || fail=1; }
check PASS 720 200                    # 100 pt under the notch: only the OS-drag magnet can catch this
check FAIL 720 200 --no-dragwatch     # control: same drop without the watcher is lost (the v2 macOS bug)
check PASS 720 40  --no-dragwatch     # drop right on the notch: the always-hit-testable strip catches it
check PASS 560 60                     # off-centre, still in the band
exit $fail
