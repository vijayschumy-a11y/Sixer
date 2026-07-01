# 🏏 Sixer — Box & Ground Cricket Scorer

> *Every ground. Every ball. Every stat.*

A best-in-class, offline-first cricket scoring **PWA** built for **box cricket** and **ground/gully cricket**. No login, no mobile OTP — all data lives on the device. Admin adds players (with a photo taken right in the app), scores matches ball-by-ball, and tracks weekly sessions and full career stats.

## Highlights
- **Last Man Standing** — selectable per match. The last batter keeps batting alone after the 2nd-last wicket. Optional *"even runs only"* classic-gully variant.
- **Box-cricket rule presets** — re-bowl wides/no-balls, custom wide/no-ball run values, free hit after no-ball, single-batter mode.
- **Player profiles with photos** — capture from webcam (`getUserMedia`) or upload; compressed and stored locally. Role, batting/bowling hand.
- **Ball-by-ball live scoring** — runs, all extras (wide/no-ball/bye/leg-bye), every dismissal type, strike rotation, free hits, undo, manual swap, retire.
- **Full scorecards** — batting card with dismissal lines, fall of wickets, bowling figures, extras breakdown.
- **Worm & Manhattan charts** — per-match cumulative-runs worm (with target line) and runs-per-over bars, wickets marked.
- **Player of the Match** — auto-picked from a batting + bowling + fielding impact score, shown on the scorecard.
- **Share as image** — one-tap render of the scorecard to a 1080×1080 PNG for WhatsApp (uses the native share sheet, falls back to download).
- **Weekly sessions** — group games by week; **points table with Net Run Rate** + per-session leaderboards.
- **Stats & leaderboards** — batting / bowling / all-round; career averages, SR, economy, best figures, fielding.
- **Backup & restore** — one-tap JSON export/import.
- **Installable PWA** — works fully offline.

## Run it
It's plain static files — no build step.

```bash
# from this folder
python -m http.server 8099
# then open http://localhost:8099
```

Or just open `index.html` (service-worker/offline install needs http://, but the app runs from `file://` too).

## Tech
Vanilla JS, no dependencies. `localStorage` persistence.

| File | Purpose |
|------|---------|
| `js/store.js` | Data layer (players, sessions, matches, settings, backup) |
| `js/scoring.js` | Scoring engine / match state machine (incl. Last Man Standing) |
| `js/stats.js` | Career & leaderboard aggregation |
| `js/photo.js` | Player photo capture (camera + upload) |
| `js/ui.js` | UI helpers (toast, sheets, pickers) |
| `js/app.js` | Router + all screens |

To rename the app, change `appName` in `js/store.js` (the `blank()` settings).
