// Screenshots of the game's models where they stand, with the game's own lighting
// (dev server running; WebGL through swiftshader, so colours and light differ a
// little from a real GPU). For before / after looks at models.
//   node scripts/bench/shots.mjs <map> <outDir> [vehicles|kits|buildings|street|lab]
// kits / buildings: the first of each kit kind / building style in the map;
// street: eye-level views round each zone; vehicles: every vehicle in a row
// (VX / VZ: offset from the blue spawn to an open strip, e.g. lyon VX=-93 VZ=44);
// lab: close-ups on `kitlab` (run scripts/bench/kitlab.mjs first; KITS=a,b picks).
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const map = process.argv[2] ?? 'iron_gate';
const out = process.argv[3] ?? 'shots';
const only = process.argv[4] ?? '';
mkdirSync(out, { recursive: true });
const json = JSON.parse(readFileSync(`public/maps/${map}.json`, 'utf8'));

// Targets: the first of each kit kind, the first (biggest-ish) building of each style.
const kits = new Map();
for (const o of json.objects) if (o.model && !kits.has(o.model)) kits.set(o.model, o);
const styles = new Map();
for (const b of json.buildings ?? []) {
  const s = b.style ?? 'house';
  const prev = styles.get(s);
  if (!prev || (s !== 'house' && b.size[0] * b.size[1] > prev.size[0] * prev.size[1])) styles.set(s, b);
}
const shots = [];
if (!only || only === 'kits')
  for (const [k, o] of kits) {
    const r = Math.max(o.size[0], o.size[2], o.size[1]);
    shots.push({ name: `kit-${k}`, x: o.pos[0], z: o.pos[2], cy: o.size[1] / 2, dist: Math.max(5, r * 1.5), up: Math.max(1.6, o.size[1] * 0.6) });
  }
if (!only || only === 'buildings')
  for (const [s, b] of styles) {
    const r = Math.max(b.size[0], b.size[1]);
    const h = (b.floors ?? 1) * 3.2;
    shots.push({ name: `bld-${s}`, x: b.pos[0], z: b.pos[1], cy: h / 2, dist: Math.max(12, r * 1.3), up: Math.max(2, h * 0.5) });
  }

if (only === 'lab') {
  const lay = JSON.parse(readFileSync('public/maps/kitlab.layout.json', 'utf8'));
  const pick = process.env.KITS ? process.env.KITS.split(',') : null;
  for (const l of lay) {
    if (pick && !pick.includes(l.k)) continue;
    const [w, h, d] = l.size;
    const r = Math.max(w, d);
    shots.push({ name: `lab-${l.k}-a`, x: l.x, z: l.z, cy: h * 0.45, dist: r * 0.9 + 3, up: Math.max(1.7, h * 0.65), a0: 2.0, fixed: true, fov: 50, hideTrees: true });
    shots.push({ name: `lab-${l.k}-b`, x: l.x, z: l.z, cy: h * 0.4, dist: r * 0.6 + 2.2, up: Math.max(1.5, h * 0.5), a0: -0.9, fixed: true, fov: 50, hideTrees: true });
  }
}
if (!only || only === 'street')
  for (const zn of json.zones) {
    for (const a of [0.3, 2.4, 4.5]) {
      shots.push({ name: `street-${zn.id}-${a}`, x: zn.pos[0] + Math.cos(a) * 30, z: zn.pos[2] + Math.sin(a) * 30, cy: 1.6, dist: 30, up: 0, a0: a + Math.PI, eye: true, fov: 70 });
    }
  }
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/?map=${map}&bots=1v1&quality=high`);
  if (process.env.VX) await page.evaluate(([x, z]) => { window.__vx = x; window.__vz = z; }, [Number(process.env.VX), Number(process.env.VZ)]);
await page.waitForFunction(() => window.__strikegy && window.__strikegy.renderer, null, { timeout: 300000 });
await page.evaluate(async () => {
  const g = window.__strikegy;
  cancelAnimationFrame(g.rafId);
  window.requestAnimationFrame = () => 0;
  g.resume?.();
  if (g.deployScreen) g.deploy();
  const r = g.renderer;
  r.fpScene.visible = false;
  window.__draw = r.render.bind(r);
  r.render = () => false;
  window.__now = performance.now();
  g.lastTime = window.__now;
  for (let i = 0; i < 120; i++) g.frame((window.__now += 1000 / 60));
  // Hide every DOM layer but the canvas.
  const canvas = r.gl.domElement;
  const style = document.createElement('style');
  style.textContent = 'body > *:not(:has(canvas)):not(canvas){display:none!important} body *:not(canvas):not(:has(canvas)){visibility:hidden!important}';
  document.head.appendChild(style);
  canvas.style.visibility = 'visible';
  for (const c of document.querySelectorAll('canvas')) if (c !== canvas) c.style.display = 'none';
  // Bots off stage.
  for (const b of g.bots?.bots ?? []) { b.feet?.set?.(9999, -50, 9999); }
});

async function shoot(name, s) {
  const ok = await page.evaluate(async (s) => {
    const g = window.__strikegy;
    const ph = g.physics;
    const down = { x: 0, y: -1, z: 0 };
    const groundAt = (x, z) => {
      const gc = ph.ground?.collider;
      const h = ph.raycast({ x, y: 400, z }, down, 800, 1, undefined, undefined, gc ? (c) => c.handle === gc.handle : undefined);
      return h ? h.point.y : 0;
    };
    const ty = (s.ty ?? groundAt(s.x, s.z)) + s.cy;
    // Try angles: the first with a clear line of sight to the target wins.
    let best = null;
    for (let i = 0; i < 16; i++) {
      const a = (s.a0 ?? 0.6) + (i * Math.PI * 2) / 16;
      const cx = s.x + Math.cos(a) * s.dist;
      const cz = s.z + Math.sin(a) * s.dist;
      const cy = s.eye ? groundAt(cx, cz) + 1.7 : Math.max(groundAt(cx, cz) + 1.7, ty - s.cy + s.up);
      if (s.eye || s.fixed) { best = { cx, cy, cz }; break; }
      const dx = s.x - cx, dy = ty - cy, dz = s.z - cz;
      const d = Math.hypot(dx, dy, dz);
      const hit = ph.raycast({ x: cx, y: cy, z: cz }, { x: dx / d, y: dy / d, z: dz / d }, d, 1);
      const clear = !hit || hit.distance > d - s.dist * 0.45;
      if (clear) { best = { cx, cy, cz }; break; }
      if (!best) best = { cx, cy, cz, blocked: true };
    }
    // Stand the player there so shadows, forest chunks and interiors follow.
    const p = g.me.player;
    p.teleport({ x: best.cx, y: best.cy - 1.6, z: best.cz }, 0);
    for (let i = 0; i < 20; i++) g.frame((window.__now += 1000 / 60));
    const cam = g.renderer.camera;
    cam.position.set(best.cx, best.cy, best.cz);
    if (!window.__fov0) window.__fov0 = cam.fov;
    cam.fov = s.fov ?? 55;
    cam.updateProjectionMatrix();
    cam.lookAt(s.x, ty, s.z);
    cam.updateMatrixWorld();
    if (s.hideTrees) g.renderer.scene.traverse((o) => { if (o.name === 'forest' || o.name === 'trees' || o.name === 'tree-impostors') o.visible = false; });
    window.__draw();
    return { ok: !best.blocked, url: g.renderer.gl.domElement.toDataURL('image/jpeg', 0.9) };
  }, s);
  writeFileSync(`${out}/${name}.jpg`, Buffer.from(ok.url.split(',')[1], 'base64'));
  return ok.ok;
}

if (!only || only === 'vehicles') {
  // Every vehicle model in a row by the blue spawn.
  const spawn = json.spawns.find((sp) => sp.team === 'blue');
  const placed = await page.evaluate(async ({ sx, sz }) => {
    const g = window.__strikegy;
    const { buildVehicleModel } = await import('/src/vehicles/vehicleModels.ts');
    const kinds = ['jeep', 'apc', 'tank', 'spg', 'td', 'rocket', 'bike', 'fighter', 'cas'];
    const ph = g.physics;
    const out = [];
    let i = 0;
    for (const k of kinds) {
      const x = sx + (window.__vx ?? 12) + i * 15, z = sz + (window.__vz ?? 25);
      const h = ph.raycast({ x, y: 400, z }, { x: 0, y: -1, z: 0 }, 800, 1);
      const y = h ? h.point.y : 0;
      if (k === 'fighter' || k === 'cas') {
        const m = buildVehicleModel(k, 'blue');
        m.root.position.set(x, y + 4, z);
        m.root.rotation.y = 0.5;
        g.renderer.scene.add(m.root);
      } else {
        const pos = g.me.player.feet.clone().set(x, y + 1.5, z);
        g.vehicles.spawn(k, pos, 0.5, 'blue');
      }
      out.push({ k, x, y, z });
      i++;
    }
    for (let f = 0; f < 120; f++) g.frame((window.__now += 1000 / 60));
    return out;
  }, { sx: spawn.pos[0], sz: spawn.pos[2] });
  for (const v of placed) {
    const big = ['fighter', 'cas', 'tank', 'spg', 'td', 'rocket', 'apc'].includes(v.k);
    const air = v.k === 'fighter' || v.k === 'cas';
    await shoot(`veh-${v.k}`, { x: v.x, z: v.z, ty: v.y, cy: air ? 4 : big ? 1.4 : 0.9, dist: air ? 14 : big ? 10 : 6, up: air ? 5 : big ? 3 : 2, a0: 2.2, hideTrees: true });
  }
}
for (const s of shots) {
  const ok = await shoot(s.name, s);
  console.log(s.name, ok ? '' : '(view blocked)');
}
console.log('errors:', errors.slice(0, 5));
await browser.close();
