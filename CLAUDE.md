# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Searchable home inventory web app with printable box labels. Tracks items across 7 physical storage boxes (numbered 1–5, 8–9). Hosted on GitHub Pages. No build tools, no frameworks.

## Architecture

- **index.html** — Main search app (dark mode). Search, filter by box/category, add/edit/delete items, sort, export CSV/JSON. Has an Info panel with all project details. Loads inventory from `data.json` on first visit, saves edits to localStorage.
- **data.json** — Single source of truth for all inventory data. Structure: `{boxes: {N: {description, items: [{item, category, condition, notes}]}}}`. Edit this file to permanently add/remove items.
- **print.html** — Printable labels for physical boxes, A-Z sorted, with QR codes linking to `index.html#box=N`. Uses `api.qrserver.com` for QR generation.
- **box1.html** — Overview page (title "Home Inventory") with aggregate summary cards.
- **box2.html through box9.html** — Per-box detail pages (title "Inventory - Box N"). Static HTML, self-contained CSS.
- **.nojekyll** — Prevents GitHub Pages Jekyll processing.

## Item Table Schema

Each box contains a table with columns: `#`, `Item`, `Category`, `Condition`, `Notes`.

Condition badges use these CSS classes:
- `.working` (green) — functional items
- `.broken` (red) — non-functional items
- `.notworking` (orange) — not working but not physically broken
- `.spare` (yellow, black text) — spare parts

## When Adding or Editing Items

1. Edit `data.json` — add/remove items in the appropriate box
2. Update `index.html` box select dropdown if adding a new box number
3. Add box data to `print.html` `BOX_DATA` object if adding a new box
4. Create a `boxN.html` file for any new box
5. Update the info panel in `index.html` if adding new pages
6. If users have cached localStorage data, they need to clear it to see data.json changes

## Hosting

- **Repo:** github.com/Shubham3521/inventory
- **Live:** shubham3521.github.io/inventory/index.html
- **Labels:** shubham3521.github.io/inventory/print.html

## Viewing

Open any `.html` file directly in a browser. No server required.
