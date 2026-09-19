import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { AUTH_FILE, ROOT } from './config.js';
import { db, now, itemRow } from './db.js';

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
// AUTH_DISABLED=1 turns the login off: anyone who can reach the site can view and edit.
const AUTH_DISABLED = process.env.AUTH_DISABLED === '1';
const PUBLIC_DIR = path.join(ROOT, 'public');
const COOKIE = 'inv_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const CONDITIONS = ['Working', 'Broken', 'Not Working', 'Spare'];
const ITEM_FIELDS = ['box_id', 'name', 'qty', 'category', 'condition', 'notes', 'tags'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = message => new HttpError(400, message);

// ---------- auth ----------

function readAuth() {
  try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch { return null; }
}

const sign = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

function makeToken(secret) {
  const payload = `${Date.now() + SESSION_MS}.${crypto.randomBytes(12).toString('base64url')}`;
  return `${payload}.${sign(secret, payload)}`;
}

function validToken(token, secret) {
  if (!token || !secret) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(secret, payload));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  return Number(payload.split('.')[0]) > Date.now();
}

function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function setSessionCookie(res, value, maxAgeMs) {
  const attrs = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (COOKIE_SECURE) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

const isAuthed = req => AUTH_DISABLED || validToken(getCookie(req, COOKIE), readAuth()?.sessionSecret);

// 10 login attempts per IP per 15 minutes
const attempts = new Map();
function tooManyAttempts(ip) {
  const t = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.reset < t) {
    attempts.set(ip, { count: 1, reset: t + 15 * 60 * 1000 });
    return false;
  }
  return ++entry.count > 10;
}

// ---------- data helpers ----------

const getBox = id => db.prepare('SELECT * FROM boxes WHERE id = ?').get(id);
const getItem = id => db.prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL').get(id);
const countItems = boxId => db.prepare('SELECT COUNT(*) AS c FROM items WHERE box_id = ? AND deleted_at IS NULL').get(boxId).c;
const touchBox = id => db.prepare('UPDATE boxes SET updated_at = ? WHERE id = ?').run(now(), id);
const label = it => (it.qty > 1 ? `${it.name} ×${it.qty}` : it.name);
const pick = (row, keys) => Object.fromEntries(keys.map(k => [k, row[k]]));

function logHistory(action, entity, entityId, before, after, summary) {
  db.prepare('INSERT INTO history (action, entity, entity_id, before, after, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .run(action, entity, entityId, before && JSON.stringify(before), after && JSON.stringify(after), summary);
}

function requireBox(id) {
  if (!getBox(id)) throw bad(`Box ${id} does not exist`);
}

function intParam(value) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new HttpError(404, 'Not found');
  return n;
}

// Validates an item payload. With partial=true only the fields present are checked.
function cleanItem(body, partial) {
  const out = {};
  const has = key => !partial || key in body;
  const str = (v, max) => String(v ?? '').trim().slice(0, max);

  if (has('name')) {
    out.name = str(body.name, 200);
    if (!out.name) throw bad('Item name is required');
  }
  if (has('box')) {
    out.box_id = Number(body.box);
    if (!Number.isInteger(out.box_id)) throw bad('Choose a box');
    requireBox(out.box_id);
  }
  if (has('qty')) {
    out.qty = Number(body.qty ?? 1);
    if (!Number.isInteger(out.qty) || out.qty < 1 || out.qty > 9999) throw bad('Quantity must be a whole number from 1 to 9999');
  }
  if (has('category')) out.category = str(body.category, 80);
  if (has('condition')) {
    out.condition = body.condition ?? 'Working';
    if (!CONDITIONS.includes(out.condition)) throw bad('Invalid condition');
  }
  if (has('notes')) out.notes = str(body.notes, 500);
  if (has('tags')) out.tags = str(body.tags, 500);
  return out;
}

function describeUpdate(before, after) {
  if (after.box_id !== before.box_id) return `Moved ${label(after)} from Box ${before.box_id} to Box ${after.box_id}`;
  const onlyQty = ['name', 'category', 'condition', 'notes', 'tags'].every(k => after[k] === before[k]);
  if (onlyQty && after.qty !== before.qty) return `${after.name}: quantity ${before.qty} → ${after.qty} (Box ${after.box_id})`;
  if (after.name !== before.name) return `Renamed ${before.name} to ${after.name} (Box ${after.box_id})`;
  if (after.condition !== before.condition) return `${after.name}: ${before.condition} → ${after.condition} (Box ${after.box_id})`;
  return `Edited ${label(after)} (Box ${after.box_id})`;
}

function exportData() {
  const out = { boxes: {} };
  for (const b of db.prepare('SELECT * FROM boxes ORDER BY id').all()) {
    out.boxes[b.id] = { description: b.description, items: [] };
  }
  for (const it of db.prepare('SELECT * FROM items WHERE deleted_at IS NULL ORDER BY box_id, id').all()) {
    out.boxes[it.box_id]?.items.push({
      item: label(it), category: it.category, condition: it.condition, notes: it.notes, tags: it.tags,
    });
  }
  return out;
}

// ---------- app ----------

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  next();
});
app.use(express.json({ limit: '200kb' }));

app.get('/healthz', (req, res) => res.type('text').send('ok'));

// Browsers fetch the app manifest and icon without cookies, so these stay public.
for (const file of ['manifest.webmanifest', 'icon.svg']) {
  app.get(`/${file}`, (req, res) => res.sendFile(path.join(PUBLIC_DIR, file)));
}
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'icon.svg')));

// Fonts, icons and scripts rarely change, so browsers may cache them for a week.
app.use('/vendor', express.static(path.join(PUBLIC_DIR, 'vendor'), {
  fallthrough: false,
  setHeaders: res => res.set('Cache-Control', 'public, max-age=604800'),
}));
app.use('/icons', express.static(path.join(PUBLIC_DIR, 'icons'), {
  fallthrough: false,
  setHeaders: res => res.set('Cache-Control', 'public, max-age=604800'),
}));

// Android app download (the signed APK is copied into public/download on deploy).
app.use('/download', express.static(path.join(PUBLIC_DIR, 'download'), {
  fallthrough: false,
  setHeaders: (res, file) => {
    if (file.endsWith('.apk')) res.set('Content-Type', 'application/vnd.android.package-archive');
    res.set('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
  },
}));

// Service worker (offline support) must be served from the site root.
app.get('/sw.js', (req, res) => res.type('application/javascript').sendFile(path.join(PUBLIC_DIR, 'sw.js')));

// Digital Asset Links: proves the Android app belongs to this site, so it opens without a browser bar.
app.get('/.well-known/assetlinks.json', (req, res) =>
  res.type('application/json').sendFile(path.join(PUBLIC_DIR, '.well-known', 'assetlinks.json'), { dotfiles: 'allow' }));

// State-changing API calls must carry this header, which a cross-site form cannot send.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'inventory') {
    return next(new HttpError(403, 'Missing request header'));
  }
  next();
});

app.post('/api/login', async (req, res) => {
  const auth = readAuth();
  if (!auth?.passwordHash) throw new HttpError(503, 'No password set yet. Run: npm run set-password');
  if (tooManyAttempts(req.ip)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  const ok = await bcrypt.compare(String(req.body?.password ?? ''), auth.passwordHash);
  if (!ok) throw new HttpError(401, 'Wrong password');
  attempts.delete(req.ip);
  setSessionCookie(res, makeToken(auth.sessionSecret), SESSION_MS);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  setSessionCookie(res, '', 0);
  res.json({ ok: true });
});

// Everything below requires a session. Pages get the login screen in place
// (same URL), so a scanned QR link like /#box=3 still works after logging in.
app.use((req, res, next) => {
  if (isAuthed(req)) return next();
  const isPage = req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html'));
  if (isPage && !req.path.startsWith('/api/')) return res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
  next(new HttpError(401, 'Not logged in'));
});

app.get('/api/data', (req, res) => {
  const boxes = db.prepare('SELECT * FROM boxes ORDER BY id').all().map(b => ({
    id: b.id,
    description: b.description,
    updatedAt: b.updated_at,
    labelPrintedAt: b.label_printed_at,
    labelOutdated: !b.label_printed_at || b.updated_at > b.label_printed_at,
  }));
  const items = db.prepare('SELECT * FROM items WHERE deleted_at IS NULL ORDER BY box_id, name COLLATE NOCASE').all().map(itemRow);
  res.json({ boxes, items, authRequired: !AUTH_DISABLED });
});

app.post('/api/items', (req, res) => {
  const data = cleanItem(req.body || {}, false);
  const row = db.transaction(() => {
    const t = now();
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO items (box_id, name, qty, category, condition, notes, tags, created_at, updated_at)
      VALUES (@box_id, @name, @qty, @category, @condition, @notes, @tags, @t, @t)`).run({ ...data, t });
    const created = getItem(lastInsertRowid);
    touchBox(created.box_id);
    logHistory('create', 'item', created.id, null, created, `Added ${label(created)} to Box ${created.box_id}`);
    return created;
  })();
  res.status(201).json(itemRow(row));
});

app.patch('/api/items/:id', (req, res) => {
  const id = intParam(req.params.id);
  const changes = cleanItem(req.body || {}, true);
  if (!Object.keys(changes).length) throw bad('Nothing to update');
  const row = db.transaction(() => {
    const before = getItem(id);
    if (!before) throw new HttpError(404, 'Item not found');
    // keys come from cleanItem's fixed whitelist, so they are safe to interpolate
    const sets = Object.keys(changes).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE items SET ${sets}, updated_at = @t WHERE id = @id`).run({ ...changes, t: now(), id });
    const after = getItem(id);
    touchBox(before.box_id);
    if (after.box_id !== before.box_id) touchBox(after.box_id);
    logHistory('update', 'item', id, before, after, describeUpdate(before, after));
    return after;
  })();
  res.json(itemRow(row));
});

app.delete('/api/items/:id', (req, res) => {
  const id = intParam(req.params.id);
  db.transaction(() => {
    const before = getItem(id);
    if (!before) throw new HttpError(404, 'Item not found');
    db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(now(), id);
    touchBox(before.box_id);
    logHistory('delete', 'item', id, before, null, `Deleted ${label(before)} from Box ${before.box_id}`);
  })();
  res.json({ ok: true });
});

app.post('/api/boxes', (req, res) => {
  const id = Number(req.body?.id);
  if (!Number.isInteger(id) || id < 1 || id > 999) throw bad('Box number must be between 1 and 999');
  const description = String(req.body?.description ?? '').trim().slice(0, 200);
  const row = db.transaction(() => {
    if (getBox(id)) throw bad(`Box ${id} already exists`);
    db.prepare('INSERT INTO boxes (id, description, updated_at) VALUES (?, ?, ?)').run(id, description, now());
    const created = getBox(id);
    logHistory('create', 'box', id, null, created, `Created Box ${id}`);
    return created;
  })();
  res.status(201).json(row);
});

app.patch('/api/boxes/:id', (req, res) => {
  const id = intParam(req.params.id);
  const description = String(req.body?.description ?? '').trim().slice(0, 200);
  const row = db.transaction(() => {
    const before = getBox(id);
    if (!before) throw new HttpError(404, 'Box not found');
    db.prepare('UPDATE boxes SET description = ?, updated_at = ? WHERE id = ?').run(description, now(), id);
    const after = getBox(id);
    logHistory('update', 'box', id, before, after, `Box ${id} description: "${before.description}" → "${description}"`);
    return after;
  })();
  res.json(row);
});

app.delete('/api/boxes/:id', (req, res) => {
  const id = intParam(req.params.id);
  db.transaction(() => {
    const before = getBox(id);
    if (!before) throw new HttpError(404, 'Box not found');
    if (countItems(id)) throw bad(`Box ${id} still has items. Move or delete them first.`);
    db.prepare('DELETE FROM boxes WHERE id = ?').run(id);
    logHistory('delete', 'box', id, before, null, `Deleted Box ${id}`);
  })();
  res.json({ ok: true });
});

// Reverts the most recent change that has not been undone yet.
app.post('/api/undo', (req, res) => {
  const summary = db.transaction(() => {
    const h = db.prepare('SELECT * FROM history WHERE undone = 0 ORDER BY id DESC LIMIT 1').get();
    if (!h) throw bad('Nothing to undo');
    const before = h.before && JSON.parse(h.before);
    const after = h.after && JSON.parse(h.after);
    const t = now();

    if (h.entity === 'item') {
      if (h.action === 'create') {
        db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(t, h.entity_id);
      } else if (h.action === 'delete') {
        requireBox(before.box_id);
        db.prepare('UPDATE items SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(t, h.entity_id);
      } else {
        requireBox(before.box_id);
        const sets = ITEM_FIELDS.map(k => `${k} = @${k}`).join(', ');
        db.prepare(`UPDATE items SET ${sets}, updated_at = @t WHERE id = @id`)
          .run({ ...pick(before, ITEM_FIELDS), t, id: h.entity_id });
      }
      for (const boxId of new Set([before?.box_id, after?.box_id].filter(Boolean))) touchBox(boxId);
    } else {
      if (h.action === 'create') {
        if (countItems(h.entity_id)) throw bad(`Can't undo: Box ${h.entity_id} now has items`);
        db.prepare('DELETE FROM boxes WHERE id = ?').run(h.entity_id);
      } else if (h.action === 'delete') {
        if (getBox(h.entity_id)) throw bad(`Can't undo: Box ${h.entity_id} exists again`);
        db.prepare('INSERT INTO boxes (id, description, label_printed_at, updated_at) VALUES (?, ?, ?, ?)')
          .run(before.id, before.description, before.label_printed_at, t);
      } else {
        db.prepare('UPDATE boxes SET description = ?, updated_at = ? WHERE id = ?').run(before.description, t, h.entity_id);
      }
    }

    db.prepare('UPDATE history SET undone = 1 WHERE id = ?').run(h.id);
    return h.summary;
  })();
  res.json({ undone: summary });
});

app.get('/api/history', (req, res) => {
  const rows = db.prepare('SELECT id, at, action, entity, summary, undone FROM history ORDER BY id DESC LIMIT 200').all();
  res.json(rows.map(r => ({ ...r, undone: !!r.undone })));
});

app.post('/api/labels/printed', (req, res) => {
  const ids = Array.isArray(req.body?.boxes) ? req.body.boxes.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) throw bad('No boxes given');
  const t = now();
  const stmt = db.prepare('UPDATE boxes SET label_printed_at = ? WHERE id = ?');
  db.transaction(() => ids.forEach(id => stmt.run(t, id)))();
  res.json({ ok: true, printedAt: t });
});

app.get('/api/export.json', (req, res) => {
  res.attachment('data.json');
  res.type('application/json').send(JSON.stringify(exportData(), null, 2));
});

app.get('/api/export.csv', (req, res) => {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = db.prepare('SELECT * FROM items WHERE deleted_at IS NULL ORDER BY box_id, name COLLATE NOCASE').all()
    .map(it => [it.box_id, it.name, it.qty, it.category, it.condition, it.notes].map(cell).join(','));
  res.attachment('inventory.csv');
  res.type('text/csv').send(['Box,Item,Qty,Category,Condition,Notes', ...rows].join('\n'));
});

app.get('/qr/:file', async (req, res) => {
  const match = /^(\d{1,3}|app)\.svg$/.exec(req.params.file);
  if (!match) throw new HttpError(404, 'Not found');
  const target = match[1] === 'app' ? `${BASE_URL}/app.html` : `${BASE_URL}/#box=${Number(match[1])}`;
  const svg = await QRCode.toString(target, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
});

app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));

app.use((req, res, next) => next(new HttpError(404, 'Not found')));

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  // HttpErrors carry messages meant for the user; hide details of unexpected failures
  const expected = err instanceof HttpError || status < 500;
  if (!expected) console.error(err);
  const message = expected ? err.message : 'Server error';
  if (req.path.startsWith('/api/') || req.path.startsWith('/qr/')) return res.status(status).json({ error: message });
  res.status(status).type('text').send(message);
});

app.listen(PORT, HOST, () => {
  console.log(`Inventory listening on http://${HOST}:${PORT} (public URL: ${BASE_URL}, login ${AUTH_DISABLED ? 'OFF' : 'on'})`);
});
