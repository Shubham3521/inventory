# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Static HTML home inventory system. Each file (`box1.html` through `box5.html`) is a standalone page cataloging the contents of a physical storage box. No build tools, no JavaScript, no shared assets.

## Architecture

- **box1.html** is the main overview page (title "Home Inventory"). It includes aggregate summary cards (Total Boxes, Total Items, Broken Items, Working Items) that must be kept in sync when boxes are added/removed or item counts change.
- **box2.html through box5.html** are per-box detail pages (title "Inventory - Box N"). Each has its own summary cards showing that box's stats.
- Every file has fully self-contained inline CSS and HTML — there is no shared stylesheet. Boxes 2-5 share a consistent style (blue left-border on summary cards, `#0d6efd` theme). Box 1 uses a slightly different style (card with box-shadow, `#007bff` theme).

## Item Table Schema

Each box contains a table with columns: `#`, `Item`, `Category`, `Condition`, `Notes`.

Condition badges use these CSS classes:
- `.working` (green `#28a745`) — functional items
- `.broken` (red `#dc3545`) — non-functional items
- `.notworking` (orange `#fd7e14`) — not working but not physically broken
- `.spare` (yellow `#ffc107`, black text) — spare parts

## When Adding or Editing Items

- Update the summary card counts in the same file (Total Items, Working, Broken, etc.)
- If adding/removing a box or changing totals, update the aggregate counts in `box1.html`
- Keep row numbering sequential within each table
- Note: `box2.html` through `box5.html` are wrapped in markdown code fences (`` ```html ``) — preserve this if editing those files

## Viewing

Open any `.html` file directly in a browser. No server required.
