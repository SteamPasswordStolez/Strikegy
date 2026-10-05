// CPU profile of the frame loop in a headless browser (dev server must be running).
// node scripts/bench/profile.mjs [url-query] [frames]
//   e.g. node scripts/bench/profile.mjs "map=ardennes&bots=150v150" 1200
// Drives g.frame() by hand at 60 Hz (no rAF, so no vsync), times the whole frame and
// the fixed sim step, and prints the top self-time functions from the V8 sampling profiler.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const query = process.argv[2] ?? 'map=ardennes&bots=150v150';
const frames = Number(process.argv[3] ?? 1200);
const warm = Number(process.argv[4] ?? 600);
const port = process.env.PORT ?? 5173;
const top = Number(process.env.TOP ?? 40);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.goto(`http://localhost:${port}/?${query}`);
await page.waitForFunction(() => window.__strikegy, null, { timeout: 180000 });

const setup = await page.evaluate(
  ({ warm }) => {
    const g = window.__strikegy;
    cancelAnimationFrame(g.rafId);
    window.requestAnimationFrame = () => 0;
    g.resume();
    if (g.deployScreen) g.deploy();
    // Warm-up frames are not drawn (a software GL makes drawn frames very slow).
    const r = g.renderer;
    const noDraw = () => {};
    // RENDER=1 keeps the draw (its CPU side: three.js, draw calls; the GPU work runs elsewhere).
    // Warm up without drawing (a software GL makes drawn frames slow); RENDER=1 draws the measured ones.
    window.__benchDraw = r.render.bind(r);
    r.render = noDraw;
    let now = performance.now();
    g.lastTime = now;
    for (let i = 0; i < warm; i++) g.frame((now += 1000 / 60));
    window.__benchNow = now;
    return { running: g.running, deployed: g.deployed };
  },
  { warm },
);

// PATCH: JS run in the page before measuring (experiments: `g` is the game).
if (process.env.PATCH)
  await page.evaluate((code) => new Function('g', code)(window.__strikegy), process.env.PATCH);

const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
const timing = await page.evaluate(
  ({ frames, render }) => {
    const g = window.__strikegy;
    let now = window.__benchNow;
    // Behaviour counters, to tell a speed-up from bots simply doing less.
    const bm = g.bots;
    const stats = { canSee: 0, targets: 0, alive: 0, kills: 0 };
    const canSee = bm.canSee.bind(bm);
    bm.canSee = (...a) => {
      stats.canSee++;
      return canSee(...a);
    };
    const killsAt = (bm.teams?.blue.kills ?? 0) + (bm.teams?.red.kills ?? 0);
    // Draw calls / triangles summed over every gl.render pass (info resets per pass).
    const gl = g.renderer.gl;
    const glRender = gl.render.bind(gl);
    const draw = { calls: 0, tris: 0, passes: 0 };
    gl.render = (...a) => {
      glRender(...a);
      draw.calls += gl.info.render.calls;
      draw.tris += gl.info.render.triangles;
      draw.passes++;
    };
    if (render) g.renderer.render = window.__benchDraw;
    const sim = g.simStep.bind(g);
    let simMs = 0;
    let steps = 0;
    g.simStep = (h) => {
      const t = performance.now();
      sim(h);
      simMs += performance.now() - t;
      steps++;
    };
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      g.frame((now += 1000 / 60));
      for (const b of bm.bots) {
        if (b.alive) stats.alive++;
        if (b.target) stats.targets++;
      }
    }
    const total = performance.now() - t0;
    bm.canSee = canSee;
    stats.kills = (bm.teams?.blue.kills ?? 0) + (bm.teams?.red.kills ?? 0) - killsAt;
    for (const k of ['canSee', 'targets', 'alive']) stats[k] = +(stats[k] / frames).toFixed(1);
    g.simStep = sim;
    const bots = g.bots?.bots ?? g.bots?.all ?? [];
    gl.render = glRender;
    return {
      draw: {
        callsPerFrame: Math.round(draw.calls / frames),
        trisPerFrame: Math.round(draw.tris / frames),
        passesPerFrame: +(draw.passes / frames).toFixed(1),
      },
      frameMs: +(total / frames).toFixed(3),
      simMsPerFrame: +(simMs / frames).toFixed(3),
      stepsPerFrame: steps / frames,
      bots: bots.length ?? 0,
      perFrame: stats,
    };
  },
  { frames, render: !!process.env.RENDER },
);
const { profile } = await cdp.send('Profiler.stop');

const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dts = profile.timeDeltas;
const counts = new Map();
for (let i = 0; i < profile.samples.length; i++)
  counts.set(profile.samples[i], (counts.get(profile.samples[i]) ?? 0) + (dts[i] ?? 0));
let totalUs = 0;
for (const [id, us] of counts) {
  const n = byId.get(id);
  const f = n.callFrame;
  const key = `${f.functionName || '(anon)'}  ${f.url
    .replace(/^.*\/src\//, 'src/')
    .replace(/\?.*$/, '')
    .replace(/^.*node_modules\/\.vite\/deps\//, 'deps/')}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + us);
  totalUs += us;
}
const cat = new Map();
for (const [k, us] of self) {
  const c = /wasm-function\[|wasm:\/\//.test(k)
    ? 'wasm (rapier/recast)'
    : /rapier3d/.test(k)
      ? 'rapier js glue'
      : /deps\/three|three\.module/.test(k)
        ? 'three.js'
        : /deps\//.test(k)
          ? 'other deps (recast js...)'
          : /src\/ai\//.test(k)
            ? 'src/ai'
            : /src\//.test(k)
              ? 'src/' + k.split('src/')[1].split('/')[0]
              : k.split('  ')[0];
  cat.set(c, (cat.get(c) ?? 0) + us);
}
// Per wasm module (rapier / recast / our core each show up under their own hash).
const mods = new Map();
for (const [k, us] of self) {
  const m = /wasm:\/\/wasm\/([0-9a-f]+)/.exec(k);
  if (m) mods.set(m[1], (mods.get(m[1]) ?? 0) + us);
}
console.log(
  'wasm modules:',
  [...mods.entries()].map(([h, us]) => `${h} ${(us / 1000 / frames).toFixed(3)}`).join(', '),
);
// Functions named in FOCUS (comma list), summed: the code a change replaced.
if (process.env.FOCUS) {
  const names = process.env.FOCUS.split(',');
  let us = 0;
  for (const [k, v] of self) if (names.includes(k.split('  ')[0]) && /src\//.test(k)) us += v;
  console.log(`focus ${(us / 1000 / frames).toFixed(3)} ms/f`);
}
// Inclusive time (the function and everything it calls), top INCL functions from src/.
if (process.env.INCL) {
  const kids = new Map(profile.nodes.map((n) => [n.id, n.children ?? []]));
  const selfUs = new Map();
  for (const [id, us] of counts) selfUs.set(id, us);
  const incl = new Map();
  const keyOf = (n) => {
    const f = n.callFrame;
    return `${f.functionName || '(anon)'}  ${f.url
      .replace(/^.*\/src\//, 'src/')
      .replace(/\?.*$/, '')
      .replace(/^.*node_modules\/\.vite\/deps\//, 'deps/')}:${f.lineNumber + 1}`;
  };
  // Walk from the root keeping the keys on the stack, so recursion counts once.
  const walk = (id, stack) => {
    const n = byId.get(id);
    const k = keyOf(n);
    const fresh = !stack.has(k);
    if (fresh) stack.add(k);
    let us = selfUs.get(id) ?? 0;
    for (const c of kids.get(id)) us += walk(c, stack);
    if (fresh) {
      stack.delete(k);
      incl.set(k, (incl.get(k) ?? 0) + us);
    }
    return us;
  };
  walk(profile.nodes[0].id, new Set());
  const re = new RegExp(process.env.INCL_MATCH ?? 'src/');
  console.log('inclusive:');
  for (const [k, us] of [...incl.entries()]
    .filter(([k]) => re.test(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, Number(process.env.INCL)))
    console.log(`${(us / 1000 / frames).toFixed(3).padStart(7)} ms/f  ${k}`);
}
console.log('by area:');
for (const [c, us] of [...cat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14))
  console.log(
    `${((100 * us) / totalUs).toFixed(1).padStart(5)}%  ${(us / 1000 / frames).toFixed(3)} ms/f  ${c}`,
  );
const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
console.log(JSON.stringify({ query, frames, setup, ...timing }));
console.log(`profile total ${(totalUs / 1000).toFixed(0)} ms`);
for (const [k, us] of rows)
  console.log(
    `${((100 * us) / totalUs).toFixed(1).padStart(5)}%  ${(us / 1000 / frames).toFixed(3)} ms/f  ${k}`,
  );
if (errors.length) console.log('page errors:', errors.slice(0, 5));
await browser.close();
