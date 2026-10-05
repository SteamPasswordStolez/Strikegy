// Builds the Rust kernels (wasm/core) and copies the module to src/wasm/core.wasm.
// Needs Rust with the wasm32-unknown-unknown target:
//   rustup target add wasm32-unknown-unknown
// The built .wasm is committed, so the game builds without Rust installed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const crate = path.join(root, 'wasm/core');
execFileSync('cargo', ['build', '--release'], { cwd: crate, stdio: 'inherit' });
const built = path.join(crate, 'target/wasm32-unknown-unknown/release/strikegy_core.wasm');
const out = path.join(root, 'src/wasm/core.wasm');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(built, out);
console.log(`src/wasm/core.wasm  ${fs.statSync(out).size} bytes`);
