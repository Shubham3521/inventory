import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
export const AUTH_FILE = path.join(DATA_DIR, 'auth.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
