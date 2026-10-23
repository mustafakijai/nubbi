# Nubbi by Nexora — your AI buddy lives in your notch (v3.0.2)

A tiny, free Mac app that lives in your notch. It approves Claude Code in one click and answers questions about any file you drop on it. Free AI is built in.

**Website:** https://mustafakijai.github.io/nubbi/ · **Download:** [Releases](https://github.com/mustafakijai/nubbi/releases/latest)

Nubbi by Nexora · © 2026 Nexora · MIT licensed (see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
Nubbi's mascot, icons, sounds and images are original. It isn't affiliated with Apple or Anthropic.

## Release files
| File | For |
|---|---|
| `Nubbi-3.0.2-mac-arm64.app.tar.xz` | Apple-silicon Macs (M1 and later) |
| `Nubbi-3.0.2-mac-x64.app.tar.xz` | Intel Macs |
| `install.sh` | Picks the right archive, retires earlier notch-app builds, installs, clears quarantine and migrates hooks |
| `SHA256SUMS` | Checksums |
| `screens/` (in the repo) | Screenshots of this build |

## Install (Terminal)
```bash
cd ~/Downloads                   # where you saved the .tar.xz, install.sh and SHA256SUMS
shasum -a 256 -c --ignore-missing SHA256SUMS   # optional
bash install.sh
```
### Manual install
```bash
tar -xJf Nubbi-3.0.2-mac-arm64.app.tar.xz        # or -x64 on Intel
mv Nubbi.app /Applications/
xattr -cr /Applications/Nubbi.app
/Applications/Nubbi.app/Contents/MacOS/Nubbi --install-hooks
open /Applications/Nubbi.app
```
If macOS still says the app "can't be opened", right-click the app → Open → Open.
You can also use System Settings → Privacy & Security → "Open Anyway".

### Easiest install (no Terminal)
Download the `.zip` for your Mac from [Releases](https://github.com/mustafakijai/nubbi/releases/latest):
- `Nubbi-3.0.2-mac-arm64.zip` for Apple Silicon
- `Nubbi-3.0.2-mac-x64.zip` for Intel

Then:
1. Double-click the zip.
2. Drag **Nubbi.app** into Applications.
3. The first time, right-click → Open → Open.
On macOS 15+, if there's no Open button, go to System Settings → Privacy & Security → **Open Anyway**.

### Upgrading from an earlier build
`--install-hooks` (and the first launch) does three things:
* backs up `~/.claude/settings.json` to `settings.json.nubbi-backup-<timestamp>`;
* removes only hook entries left by earlier notch builds (listed in `src/brand.json` → `legacy`);
* merges in Nubbi's hooks.

Your own hooks are never touched. If Nubbi isn't running, the hook exits within about a second.
Claude then asks in the terminal as usual.

## Drop a file
* Start dragging a file anywhere. As your pointer nears the notch, Nubbi drops open a big drop zone.
  Release anywhere on it.
* Other ways to add a file:
  * drop it on the **menu-bar Nubbi icon**;
  * press **⌃⌥O**;
  * click **Choose file…** in the panel.
* Works with PDFs, images, text and code files, and docx, pptx and xlsx files.

### Drag & drop troubleshooting
* Make sure only one notch app is running (quit any earlier notch build).
* The always-on drop strip is the notch itself and about 50 pt below it. Drops there work even if drag detection fails.
* Diagnostics: run `/Applications/Nubbi.app/Contents/MacOS/Nubbi --enable-logging`.
  Watch for `dragwatch` lines while you drag.

## AI providers (Settings → "AI for your files", or the pill in the ask box)
| Provider | Key | Notes |
|---|---|---|
| **Free** (default) | none | Pollinations.ai community service. This is a **free community service with no privacy guarantees** and a shared rate limit, so don't send sensitive files. It reads text, PDF text and documents. Images need a provider below. |
| Gemini | free key, no card: https://aistudio.google.com/apikey | Reads images and PDFs natively. Google may use free-tier prompts to improve its products. |
| Groq | free key: https://console.groq.com/keys | Very fast, but has small per-minute limits, so long files are trimmed. Images use a vision model. |
| OpenRouter | free key: https://openrouter.ai/keys | Only `:free` models are listed. Some upstream providers may log prompts. |
| Ollama | none (local) | Detected automatically at `localhost:11434`. Models are listed from `ollama list`. Fully private. |
| Claude | paid Anthropic key | Best quality, with native images and PDFs. |

Keys are stored encrypted with Electron safeStorage, which uses the macOS Keychain.
If a key is missing or wrong, or you hit a rate limit, the error message has a one-click link to get a free key.

## Claude Code
* Sessions appear as cards. Permission prompts show **Deny / Always / Allow** (keys N, A, Y), the same as v2.
* Hooks CLI: `--install-hooks`, `--uninstall-hooks`, `--hooks-status`.

## Shortcuts
* **⌃⌥Space**: open or close Nubbi.
* **⌃⌥O**: ask about a file.
* **⌘,**: Settings.

## For developers (box / Linux)
```bash
npm install
node --test test/                # unit tests
bash e2e/run-all.sh              # Xvfb + XDND drag-drop matrix (needs Xvfb, python3)
node e2e/live-free.js            # one real keyless answer
node build/brand-sync.js && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --x64 --arm64
```
The name, bundle id (`com.nexora.nubbi` since 3.0.2; it was `com.personal.nubbi` before) and paths all live in `src/brand.json`.
