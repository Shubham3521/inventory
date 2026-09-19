# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Home inventory with printable box labels, tracking items across numbered physical storage boxes (1–6, 8–12). The repo holds three parts that do not share code:

1. **Static site** (repo root) — the original version, hosted on GitHub Pages. No build tools, no frameworks. `data.json` is its source of truth.
2. **`server/`** — a self-hosted Node/Express + SQLite version with login, edit history and undo, and offline support. It is a separate app, not a backend for the static site. Its public URL is `inventory.refurbindia.com`.
3. **`android/`** — a Trusted Web Activity (Bubblewrap-generated) wrapper for the server app (package `com.refurbindia.inventory`).

`reorganization-plan.md` is a planning note for physically regrouping items into boxes, not code.

## Static site (repo root)

- **index.html** — Main search app. Loads `data.json` with `cache: 'no-store'`. Edits are saved to localStorage, but whenever `data.json`'s contents change the app reloads from it and discards local edits. Contains an Info panel describing the project.
- **data.json** — Structure: `{boxes: {N: {description, items: [{item, category, condition, notes}]}}}`. Quantities are written into the item name as a suffix, e.g. `"Mouse Pads ×3"`.
- **print.html** — Printable A-Z labels with QR codes linking to `index.html#box=N`, generated via `api.qrserver.com`. It has its own `BOX_DATA` object and does not read `data.json`.
- **box1.html** — Overview page with summary cards. **box2–6, 8, 9.html** — Static per-box detail pages with self-contained CSS.

Condition values and badge classes: `Working` → `.working` (green), `Broken` → `.broken` (red), `Not Working` → `.notworking` (orange), `Spare` → `.spare` (yellow, black text).

### When adding or editing items (static site)

1. Edit `data.json` in the appropriate box.
2. If adding a new box number, also update: the box `<select>` in `index.html`, `BOX_DATA` in `print.html`, a new `boxN.html`, and the Info panel in `index.html`.

To view, open any `.html` file directly in a browser. `.nojekyll` must stay so GitHub Pages serves the files as they are.

## Server app (`server/`)

Node ≥ 20, ES modules, deps: express 5, better-sqlite3, bcryptjs, qrcode. There is no test suite, linter, or build step.

```bash
cd server
npm install
npm run import            # load ../data.json into SQLite (refuses if DB is non-empty; add -- --force to wipe)
npm run set-password      # set login password (prompts; or: npm run set-password -- <pass>)
npm start                 # http://127.0.0.1:3001
npm run backup            # copy DB to data/backups, keep newest BACKUP_KEEP (default 30)
```

Env vars: `PORT` (3001), `HOST` (127.0.0.1), `BASE_URL` (used in QR code targets), `DATA_DIR` (default `server/data/`), `COOKIE_SECURE=1`, `AUTH_DISABLED=1`, `BACKUP_KEEP`.

Architecture:
- **server.js** — All routes. The JSON API is under `/api/*`. Non-GET API calls must send the header `X-Requested-With: inventory` (CSRF guard). Unauthenticated page requests get `login.html` served at the same URL, so QR links like `/#box=3` still work after login. `HttpError` messages are shown to users, and other errors are hidden behind "Server error". Responses carry a strict CSP (`connect-src 'self'`, no external scripts), so front-end assets must be vendored in `public/vendor/`.
- **db.js** — Schema (`boxes`, `items`, `history`). Items are soft-deleted (`deleted_at`). Every mutation runs in a transaction, calls `touchBox()`, and writes a `history` row with before/after JSON snapshots. `/api/undo` reverts the latest history row that has not been undone. New mutations must follow this same pattern for undo to keep working.
- Unlike the static site, quantity is a real `qty` column. `import-data.js` parses the `×N` suffix, and `/api/export.json` re-adds it, so the export stays compatible with the static site's `data.json` format.
- A box's label is flagged outdated when `updated_at > label_printed_at`. `POST /api/labels/printed` records a print. QR SVGs are generated locally at `/qr/<N>.svg`.
- **public/** — `index.html` (the whole single-page app, vanilla JS), `print.html`, `login.html`, `app.html` (Android download page), and `sw.js` (service worker: cache-first for `/vendor` and `/icons`, network-first for pages and `/api/data`). **Bump `VERSION` in `sw.js` when its SHELL file list changes.**
- Git-ignored: `data/` (DB and `auth.json` with the password hash and session secret), `node_modules/`, `public/download/` (the signed APK is copied there on deploy).

## Android wrapper (`android/`)

Generated from `twa-manifest.json` (host, colors, shortcuts `#add=1` / `#scan=1`, version code). Edit that manifest and regenerate with Bubblewrap rather than hand-editing the generated Gradle and resource files. The signing keystore lives outside the repo, and `*.keystore`, `*.apk` and `local.properties` are git-ignored. The app opens without a browser bar only if `server/public/.well-known/assetlinks.json` matches the signing key.

## Hosting

- **Static repo:** github.com/Shubham3521/inventory — live at shubham3521.github.io/inventory/index.html (labels: `/print.html`)
- **Server app:** https://inventory.refurbindia.com runs on an Ubuntu VPS at `103.35.165.167`, with nginx 1.24 in front of the Node app (which listens on 127.0.0.1:3001 by default). Log in with `ssh admin@103.35.165.167`. The app's directory and service name on the VPS are not recorded yet. Login is currently off on the live site (`AUTH_DISABLED=1`).
- **Never commit signing keys:** `*.keystore` and `*.jks` are git-ignored. The Android keystore lives outside the repo, at the path in `twa-manifest.json`.
- **Android APK:** served from `https://inventory.refurbindia.com/download/inventory.apk`. `app.html` is the download page.
- **Changing live data:** the live server's data lives only in its SQLite DB, so it doesn't pick up changes to `data.json`. Apply inventory edits to both places: edit the static files, and call the live API (`POST`/`PATCH /api/items`, `/api/boxes` with header `X-Requested-With: inventory`).
