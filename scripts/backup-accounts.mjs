// The accounts database's daily backup (progression plan 4-3), run by cron on the
// server laptop from the checkout (docs/server-setup.md):
//   node scripts/backup-accounts.mjs [db] [dir]
// SQLite's online backup (consistent while the server writes), gzipped, with
// the two keys the accounts can't live without (Better Auth's secret and the
// account key that hashes the providers' numbers); copies older than 7 days go.
import Database from 'better-sqlite3';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const db = process.argv[2] ?? process.env.STRIKEGY_ACCOUNTS_DB ?? '.strikegy-accounts.db';
const dir = process.argv[3] ?? '.strikegy-backups';
const KEEP_DAYS = 7;

if (!existsSync(db)) {
  console.log(`backup: no ${db} yet`);
  process.exit(0);
}
mkdirSync(dir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().slice(0, 10);
const tmp = join(dir, `accounts-${stamp}.db`);
const src = new Database(db, { readonly: true, fileMustExist: true });
await src.backup(tmp);
src.close();
const out = `${tmp}.gz`;
writeFileSync(out, gzipSync(readFileSync(tmp)), { mode: 0o600 });
unlinkSync(tmp);
for (const key of ['.strikegy-auth-secret', '.strikegy-account-key']) {
  if (!existsSync(key)) continue;
  const to = join(dir, key.slice(1));
  copyFileSync(key, to);
  chmodSync(to, 0o600);
}
// Older copies go (a deleted account is gone from the backups after a week; privacy page).
const cutoff = Date.now() - KEEP_DAYS * 86400_000;
for (const f of readdirSync(dir)) {
  if (!/^accounts-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(f)) continue;
  const p = join(dir, f);
  if (statSync(p).mtimeMs < cutoff) rmSync(p);
}
console.log(`backup: ${out} (${Math.round(statSync(out).size / 1024)} KB)`);
