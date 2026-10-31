// After the lines are recorded (voices.mjs): moves start times a little so no line runs into the
// next one (owner, 2026-10-31: the dialogue is dense, no long pauses either), then sets each end to
// its recording's length (the subtitles follow). A line may start up to EARLY s sooner, into free
// room before it, and push the next one up to LATE s later; nothing may cover the heaviest hits or
// the silences (docs/design/trailer.md §2). Prints what moved and what still overlaps.
//
//   node scripts/trailer/retime.mjs [--write]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { duration } from './voices.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = path.join(ROOT, 'scripts/trailer/data/lines.json');
const lines = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const EARLY = 0.6;
const LATE = 0.5;
const GAP = 0.08;
/** Moments no line may cover: the heaviest hits and the silences. */
const KEEP_CLEAR = [[38.6, 38.6], [66.42, 66.42], [69.9, 70.05], [70.89, 70.89], [89.75, 91.0], [91.17, 91.17], [128.15, 128.15]];
const covers = (a, b) => KEEP_CLEAR.some(([x, y]) => a < y && b > x);
/** A line written to be spoken in the silence ("…Now."). */
const quiet = (l) => l.delivery.startsWith('정적');

const len = lines.map((l) => {
  const f = path.join(ROOT, 'assets-src/trailer/voice', `${l.id}.wav`);
  return fs.existsSync(f) ? duration(f) : l.end - l.start;
});
const start = lines.map((l) => l.start);
const moved = [];
for (let i = 0; i < lines.length; i++) {
  const prevEnd = i > 0 ? start[i - 1] + len[i - 1] : 0;
  const next = lines[i + 1];
  if (!next) break;
  let over = start[i] + len[i] + GAP - start[i + 1];
  if (over <= 0) continue;
  // Earlier, into the room before it.
  const back = Math.min(over, EARLY - (lines[i].start - start[i]), Math.max(0, start[i] - (prevEnd + GAP)));
  if (back > 0 && (quiet(lines[i]) || !covers(start[i] - back, start[i] - back + len[i]))) {
    start[i] -= back;
    over -= back;
  }
  // The next one later.
  if (over > 0) {
    const push = Math.min(over, LATE);
    if (!covers(start[i + 1] + push, start[i + 1] + push + len[i + 1])) start[i + 1] += push;
  }
}
const left = [];
lines.forEach((l, i) => {
  const s = Math.round(start[i] * 100) / 100;
  if (Math.abs(s - l.start) > 0.005) moved.push(`${l.id} ${l.start} -> ${s}`);
  l.start = s;
  l.end = Math.round((s + len[i]) * 100) / 100;
  const n = lines[i + 1];
  if (n && l.end > start[i + 1] + 0.005) left.push(`${l.id} (${l.speaker}) runs ${(l.end - start[i + 1]).toFixed(2)} s into ${n.id} (${n.speaker})`);
  if (covers(l.start, l.end) && !quiet(l)) left.push(`${l.id} covers a hit / silence`);
});
console.log(moved.length ? `moved:\n  ${moved.join('\n  ')}` : 'nothing moved');
console.log(left.length ? `still overlapping:\n  ${left.join('\n  ')}` : 'no overlaps left');
if (process.argv.includes('--write')) {
  fs.writeFileSync(FILE, JSON.stringify(lines, null, 2) + '\n');
  console.log('lines.json written');
}
