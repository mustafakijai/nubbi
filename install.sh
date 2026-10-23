#!/bin/bash
# Nubbi by Nexora — installer for macOS (unsigned, ad-hoc signed build). https://github.com/mustafakijai/nubbi
# Usage:  cd into the folder with the .tar.xz files, then:  bash install.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="/Applications/Nubbi.app"
case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) echo "Unsupported CPU: $(uname -m)"; exit 1 ;;
esac
TARBALL="$(ls "$HERE"/Nubbi-*-mac-"$ARCH".app.tar.xz 2>/dev/null | sort | tail -1 || true)"
[ -n "$TARBALL" ] || { echo "Couldn't find Nubbi-*-mac-$ARCH.app.tar.xz next to install.sh"; exit 1; }
echo "→ Installing $(basename "$TARBALL") ($ARCH)"
SUDO=""; [ -w /Applications ] || SUDO="sudo"

# Retire earlier notch-app builds (names listed in src/brand.json "legacy") so two notch apps don't fight over the notch.
for OLD in "Coucou Notch" "Notchling"; do
  if pgrep -xq "$OLD"; then echo "→ Quitting an earlier notch build"; osascript -e "quit app \"$OLD\"" >/dev/null 2>&1 || true; sleep 1; pkill -x "$OLD" 2>/dev/null || true; fi
  if [ -d "/Applications/$OLD.app" ]; then echo "→ Removing an earlier notch build (replaced by Nubbi)"; $SUDO rm -rf "/Applications/$OLD.app"; fi
done
if pgrep -xq "Nubbi"; then
  echo "→ Quitting the running Nubbi"; osascript -e 'quit app "Nubbi"' >/dev/null 2>&1 || true; sleep 1; pkill -x "Nubbi" 2>/dev/null || true
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
tar -xJpf "$TARBALL" -C "$TMP"           # bsdtar keeps symlinks/permissions
[ -d "$APP" ] && $SUDO rm -rf "$APP"
$SUDO mv "$TMP/Nubbi.app" "$APP"
echo "→ Clearing quarantine (unsigned build)"
$SUDO xattr -cr "$APP"

echo "→ Installing Claude Code hooks (backs up ~/.claude/settings.json, merges, and migrates hooks from earlier builds)"
"$APP/Contents/MacOS/Nubbi" --install-hooks || echo "  (hooks step failed — use Settings… → Reinstall instead)"
[ -d "$HOME/.coucou-notch" ] && { echo "→ Removing an old hook folder from an earlier build"; rm -rf "$HOME/.coucou-notch"; }

# 3.0.2 moved the bundle id from com.personal.nubbi to com.nexora.nubbi. Settings, keys and hooks are unaffected (they are keyed by app name / ~/.nubbi);
# only tidy the old id's caches and saved window state.
for OLDID in com.personal.nubbi; do rm -rf "$HOME/Library/Caches/$OLDID" "$HOME/Library/Caches/$OLDID.ShipIt" "$HOME/Library/Saved Application State/$OLDID.savedState" 2>/dev/null || true; done

echo "→ Launching"
open "$APP"
cat <<'MSG'

✓ Done. Look up at your notch (or the top-centre of the screen) — Nubbi says hi.
  • Drop a file ON or JUST UNDER the notch — Nubbi grows a big drop zone as soon as you start dragging.
    Also: drop it on the menu-bar Nubbi icon, or press ⌃⌥O to pick a file.
  • Answers come from the free no-key service by default. For more privacy / better models open
    Settings… → "AI for your files" (Gemini, Groq, OpenRouter = free keys; Ollama = local; Claude = paid key).
  • ⌃⌥Space opens/closes Nubbi from anywhere.
  • Restart any running `claude` sessions so they pick up the new hooks.
  • If drops still miss on your Mac, see README → "Drag & drop troubleshooting".
  • Start at login: System Settings → General → Login Items → + → Nubbi.
  • Uninstall hooks:  "/Applications/Nubbi.app/Contents/MacOS/Nubbi" --uninstall-hooks
MSG
