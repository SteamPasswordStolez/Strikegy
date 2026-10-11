// Frame cost at fixed views, for before / after comparisons of looks work
// (owner, 2026-10-11: anything that adds triangles gets measured in ms).
//   node scripts/bench/frame.mjs <map> [bots=1v1] [views=street] > out.json
// Dev server running. Math.random is seeded, so two runs of the same code see
// the same match. Per view (eye height 30 m from each zone looking at it, ANGLES=
// directions, default 2.4; VIEW=WxH, default 960x540; with
// VEH=1 also every vehicle kind in a row by the blue spawn, see shots.mjs VX/VZ):
//   draw   - Renderer.render + a 1-pixel read-back (median of 7): CPU submit plus the
//            rasterizing, which swiftshader does on the CPU, so triangle and
//            pixel load shows up here (a stand-in for GPU time; the real GPU
//            number is the owner's F3 panel)
//   calls / tris - per frame (all passes)
// and once per map `step` - Game.frame without the draw (median ms over 240 frames).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
const map = process.argv[2] ?? 'iron_gate';
const bots = process.argv[3] ?? '1v1';
const json = JSON.parse(readFileSync(`public/maps/${map}.json`, 'utf8'));
const [vw, vh] = (process.env.VIEW ?? '960x540').split('x').map(Number);

const views = [];
const angles = (process.env.ANGLES ?? '2.4').split(',').map(Number);
for (const zn of json.zones ?? []) for (const a of angles) views.push({ name: `${zn.id}-${a}`, x: zn.pos[0], z: zn.pos[2], a, dist: 30 });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
await page.addInitScript(() => {
  let a = 12345;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/?map=${map}&bots=${bots}&quality=${process.env.QUALITY ?? 'high'}&nocache`);
await page.waitForFunction(() => window.__strikegy && window.__strikegy.renderer, null, { timeout: 300000 });
const step = await page.evaluate(() => {
  const g = window.__strikegy;
  cancelAnimationFrame(g.rafId);
  window.requestAnimationFrame = () => 0;
  g.resume?.();
  if (g.deployScreen) g.deploy();
  const r = g.renderer;
  r.fpScene.visible = false;
  r.gl.info.autoReset = false;
  window.__draw = r.render.bind(r);
  r.render = () => false;
  window.__now = performance.now();
  g.lastTime = window.__now;
  for (let i = 0; i < 300; i++) g.frame((window.__now += 1000 / 60));
  const t = [];
  for (let i = 0; i < 240; i++) {
    const t0 = performance.now();
    g.frame((window.__now += 1000 / 60));
    t.push(performance.now() - t0);
  }
  t.sort((x, y) => x - y);
  return t[t.length >> 1];
});

if (process.env.VEH) {
  const spawn = json.spawns.find((s) => s.team === 'blue');
  const vx = Number(process.env.VX ?? 12);
  const vz = Number(process.env.VZ ?? 25);
  const placed = await page.evaluate(
    async ({ sx, sz, vx, vz }) => {
      const g = window.__strikegy;
      const { buildVehicleModel } = await import('/src/vehicles/vehicleModels.ts');
      const ph = g.physics;
      const gc = ph.ground?.collider;
      const out = [];
      ['jeep', 'apc', 'tank', 'spg', 'td', 'rocket', 'bike', 'fighter', 'cas'].forEach((k, i) => {
        const x = sx + vx + i * 15;
        const z = sz + vz;
        const h = ph.raycast({ x, y: 400, z }, { x: 0, y: -1, z: 0 }, 800, 1, undefined, undefined, gc ? (c) => c.handle === gc.handle : undefined);
        const y = h ? h.point.y : 0;
        if (k === 'fighter' || k === 'cas') {
          const m = buildVehicleModel(k, 'blue');
          m.root.position.set(x, y + 4, z);
          g.renderer.scene.add(m.root);
        } else g.vehicles.spawn(k, g.me.player.feet.clone().set(x, y + 1.5, z), 0.5, 'blue');
        out.push({ x, y, z });
      });
      for (let f = 0; f < 120; f++) g.frame((window.__now += 1000 / 60));
      return out;
    },
    { sx: spawn.pos[0], sz: spawn.pos[2], vx, vz },
  );
  const mid = placed[4];
  // Looking down the row from its near end, and from the side at 25 m.
  views.unshift({ name: 'vehicles-row', x: mid.x, z: mid.z, a: 3.0, dist: 75, look: [mid.x, mid.y + 1, mid.z] });
  views.unshift({ name: 'vehicles-side', x: mid.x, z: mid.z, a: -1.57, dist: 28, look: [mid.x, mid.y + 1, mid.z] });
}

const results = [];
for (const v of views) {
  const res = await page.evaluate((v) => {
    const g = window.__strikegy;
    const ph = g.physics;
    const gc = ph.ground?.collider;
    const groundAt = (x, z) => {
      const h = ph.raycast({ x, y: 400, z }, { x: 0, y: -1, z: 0 }, 800, 1, undefined, undefined, gc ? (c) => c.handle === gc.handle : undefined);
      return h ? h.point.y : 0;
    };
    const cx = v.x + Math.cos(v.a) * v.dist;
    const cz = v.z + Math.sin(v.a) * v.dist;
    const cy = groundAt(cx, cz) + 1.7;
    g.me.player.teleport({ x: cx, y: cy - 1.6, z: cz }, 0);
    for (let i = 0; i < 30; i++) g.frame((window.__now += 1000 / 60));
    const cam = g.renderer.camera;
    cam.position.set(cx, cy, cz);
    const [lx, ly, lz] = v.look ?? [v.x, groundAt(v.x, v.z) + 1.6, v.z];
    cam.lookAt(lx, ly, lz);
    cam.updateMatrixWorld();
    const r = g.renderer;
    const ctx = r.gl.getContext();
    const info = r.gl.info;
    // Reading a pixel back waits for the drawing to be done (finish() doesn't, through ANGLE).
    const px = new Uint8Array(4);
    const sync = () => ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
    for (let i = 0; i < 2; i++) window.__draw();
    sync();
    const t = [];
    let calls = 0;
    let tris = 0;
    for (let i = 0; i < 7; i++) {
      info.reset();
      const t0 = performance.now();
      window.__draw();
      sync();
      t.push(performance.now() - t0);
      calls = info.render.calls;
      tris = info.render.triangles;
    }
    t.sort((a, b) => a - b);
    return { draw: Math.round(t[3] * 10) / 10, calls, tris };
  }, v);
  results.push({ view: v.name, ...res });
}
const sum = results.reduce((s, r) => s + r.draw, 0);
console.log(JSON.stringify({ map, step: Math.round(step * 100) / 100, drawTotal: Math.round(sum * 10) / 10, views: results, errors: errors.slice(0, 3) }, null, 1));
await browser.close();
