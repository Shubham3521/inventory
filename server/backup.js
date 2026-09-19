// Writes a consistent copy of the database to data/backups and keeps the newest BACKUP_KEEP (default 30).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { db } from './db.js';

const dir = path.join(DATA_DIR, 'backups');
fs.mkdirSync(dir, { recursive: true });

const file = path.join(dir, `inventory-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
await db.backup(file);

const keep = Number(process.env.BACKUP_KEEP || 30);
const backups = fs.readdirSync(dir).filter(f => /^inventory-.*\.db$/.test(f)).sort();
for (const old of backups.slice(0, Math.max(0, backups.length - keep))) fs.unlinkSync(path.join(dir, old));

console.log(`Backup written: ${file}`);
