// Sets the login password. Changing it also signs out every existing session.
// Usage: npm run set-password            (prompts, input hidden)
//        npm run set-password -- <pass>  (non-interactive)
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { AUTH_FILE } from './config.js';

function promptHidden(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    spawnSync('stty', ['-echo'], { stdio: 'inherit' });
    const rl = readline.createInterface({ input: process.stdin });
    rl.once('line', line => {
      spawnSync('stty', ['echo'], { stdio: 'inherit' });
      process.stdout.write('\n');
      rl.close();
      resolve(line);
    });
  });
}

let password = process.argv[2];
let generated = false;

if (!password && process.stdin.isTTY) {
  password = await promptHidden('New password: ');
  const again = await promptHidden('Repeat password: ');
  if (password !== again) {
    console.error('Passwords do not match.');
    process.exit(1);
  }
} else if (!password) {
  password = crypto.randomBytes(12).toString('base64url');
  generated = true;
}

if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const auth = {
  passwordHash: await bcrypt.hash(password, 12),
  sessionSecret: crypto.randomBytes(32).toString('base64url'),
  updatedAt: new Date().toISOString(),
};
fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
fs.chmodSync(AUTH_FILE, 0o600);

console.log(generated ? `Generated password: ${password}` : 'Password updated.');
console.log('All existing sessions have been signed out.');
