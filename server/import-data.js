// Imports a data.json file (the format used by the static site) into the database.
// Usage: node import-data.js [path/to/data.json] [--force]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { db, now } from './db.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const file = path.resolve(args.find(a => !a.startsWith('--')) || path.join(ROOT, '..', 'data.json'));

const existing = db.prepare('SELECT COUNT(*) AS c FROM boxes').get().c;
if (existing && !force) {
  console.error(`Database already has ${existing} boxes. Re-run with --force to wipe it and import again.`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
// "Mouse Pads ×3" -> name "Mouse Pads", qty 3
const QTY_SUFFIX = /\s*×\s*(\d+)\s*$/;
const t = now();
let boxCount = 0;
let itemCount = 0;

db.transaction(() => {
  if (force) db.exec("DELETE FROM items; DELETE FROM boxes; DELETE FROM history; DELETE FROM sqlite_sequence WHERE name IN ('items', 'history');");
  const insertBox = db.prepare('INSERT INTO boxes (id, description, updated_at) VALUES (?, ?, ?)');
  const insertItem = db.prepare(`
    INSERT INTO items (box_id, name, qty, category, condition, notes, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  for (const [num, box] of Object.entries(data.boxes)) {
    insertBox.run(Number(num), box.description || '', t);
    boxCount++;
    for (const it of box.items) {
      const m = QTY_SUFFIX.exec(it.item);
      const name = (m ? it.item.slice(0, m.index) : it.item).trim();
      insertItem.run(Number(num), name, m ? Number(m[1]) : 1, it.category || '', it.condition || 'Working',
        it.notes || '', it.tags || '', t, t);
      itemCount++;
    }
  }
})();

console.log(`Imported ${boxCount} boxes and ${itemCount} items from ${file}`);
