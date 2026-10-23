# Nubbi landing page

Plain HTML/CSS/JS. There is no build step. Open `index.html` or serve the folder:
`python3 -m http.server 8765` → http://127.0.0.1:8765/

Live at https://mustafakijai.github.io/nubbi/. It is deployed by `.github/workflows/pages.yml` on every push to `main` that changes `site/`.
The download links in `window.NUBBI_CONFIG` at the top of `index.html` point at the GitHub release assets. Update them, and `SIZE_*` and `VERSION`, for each new version.

Files:
- `index.html`, `styles.css`, `app.js`, `favicon.svg`
- `assets/video/` holds the demo: 1080p for desktop and 720x1280 vertical for phones. Each has a poster.
- `assets/shots/` holds real app screenshots (webp).
- `assets/og.png` is the 1200x630 share card. `assets/apple-touch-icon.png` and `assets/favicon-32.png` are the icons.
