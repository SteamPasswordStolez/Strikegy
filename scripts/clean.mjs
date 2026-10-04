// Removes dist/ (or the folder given, e.g. dist-server) before a build.
// Node 24's recursive fs.rmSync crashes natively on Windows paths containing
// non-ASCII characters (this repo lives under a Korean folder name), and Vite's
// emptyOutDir uses it. Deleting entry by entry with non-recursive calls works.
import fs from 'node:fs';
import path from 'node:path';

function remove(p) {
  const st = fs.lstatSync(p);
  if (st.isDirectory()) {
    for (const entry of fs.readdirSync(p)) remove(path.join(p, entry));
    fs.rmdirSync(p);
  } else {
    fs.unlinkSync(p);
  }
}

const dir = process.argv[2] ?? 'dist';
if (fs.existsSync(dir)) remove(dir);
