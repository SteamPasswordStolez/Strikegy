// Who makes the draw calls: renders a few frames of a running match and counts
// WebGL draw calls / triangles per pass and per object group (named ancestor),
// plus the main-thread time of Renderer.render (three.js + WebGL calls; the GPU
// work itself runs in the GPU process and is not in this number).
// node scripts/bench/draws.mjs "map=ardennes&bots=12v12" [warmFrames] [drawnFrames]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
const query = process.argv[2] ?? 'map=ardennes&bots=12v12';
const warm = Number(process.argv[3] ?? 900);
const drawn = Number(process.argv[4] ?? 40);
const [w, h] = (process.env.VIEW ?? '960x540').split('x').map(Number);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/?${query}`);
await page.waitForFunction(() => window.__strikegy, null, { timeout: 180000 });
const out = await page.evaluate(
  ({ warm, drawn, top, byRoot }) => {
    const g = window.__strikegy;
    cancelAnimationFrame(g.rafId);
    window.requestAnimationFrame = () => 0;
    g.resume();
    if (g.deployScreen) g.deploy();
    const r = g.renderer;
    const draw = r.render.bind(r);
    r.render = () => false;
    let now = performance.now();
    g.lastTime = now;
    for (let i = 0; i < warm; i++) g.frame((now += 1000 / 60));
    r.render = draw;
    // Attribute each draw call to the nearest named ancestor (or the object's type).
    const gl = r.gl;
    // Path of named ancestors (up to 3) + what the object itself is.
    const rootOf = (o) => {
      let p = o;
      while (p.parent && p.parent !== r.scene && p.parent !== r.fpScene) p = p.parent;
      return p;
    };
    const label = (o) => {
      if (byRoot) {
        const root = rootOf(o);
        const kids = [];
        root.traverse((c) => c.isMesh && kids.length < 1 && kids.push(c.geometry?.type));
        return `root ${root.name || root.type}#${root.id} (${root.children.length} children, e.g. ${kids[0]})`;
      }
      const names = [];
      for (let p = o.parent; p && names.length < 3; p = p.parent) if (p.name) names.unshift(p.name);
      const mat = Array.isArray(o.material) ? 'multi' : o.material?.name || o.material?.type;
      return `${names.join('/') || '-'} :: ${o.name || o.type}${o.isInstancedMesh ? '[inst]' : ''} (${mat})`;
    };
    let pass = 'shadow?';
    const groups = new Map();
    const orig = gl.renderBufferDirect.bind(gl);
    gl.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
      const shadowPass = camera !== r.camera && camera !== r.fpCamera;
      const key = `${shadowPass ? 'shadow' : pass} | ${label(object)}`;
      const e = groups.get(key) ?? { calls: 0, tris: 0 };
      e.calls++;
      const idx = geometry.index
        ? geometry.index.count
        : (geometry.attributes.position?.count ?? 0);
      const inst = object.isInstancedMesh ? object.count : 1;
      e.tris += Math.round(((group ? group.count : idx) / 3) * inst);
      groups.set(key, e);
      return orig(camera, scene, geometry, material, object, group);
    };
    const glRender = gl.render.bind(gl);
    let passIndex = 0;
    const passNames = ['world', 'scenery', 'viewmodel'];
    gl.render = (scene, cam) => {
      pass = scene === r.fpScene ? 'viewmodel' : passNames[passIndex++ % 2];
      glRender(scene, cam);
      if (scene === r.fpScene) passIndex = 0;
    };
    const t0 = performance.now();
    let renderMs = 0;
    for (let i = 0; i < drawn; i++) {
      const s = performance.now();
      g.frame((now += 1000 / 60));
      renderMs += 0; // frame() includes the sim; time the render alone below
      void s;
    }
    const total = performance.now() - t0;
    // Render alone, same state (no sim): main-thread cost of one frame's draw.
    const t1 = performance.now();
    for (let i = 0; i < drawn; i++) r.render();
    renderMs = (performance.now() - t1) / drawn;
    gl.render = glRender;
    gl.renderBufferDirect = orig;
    const rows = [...groups.entries()].map(([k, v]) => ({
      k,
      calls: +(v.calls / (drawn * 2)).toFixed(1),
      tris: Math.round(v.tris / (drawn * 2)),
    }));
    rows.sort((a, b) => b.calls - a.calls);
    const byPass = {};
    for (const { k, calls, tris } of rows) {
      const p = k.split(' | ')[0];
      byPass[p] ??= { calls: 0, tris: 0 };
      byPass[p].calls += calls;
      byPass[p].tris += tris;
    }
    return {
      frameMsWithDraw: +(total / drawn).toFixed(2),
      renderMs: +renderMs.toFixed(2),
      byPass,
      top: rows.slice(0, top),
      preset: r.preset,
    };
  },
  { warm, drawn, top: Number(process.env.TOP ?? 30), byRoot: !!process.env.BYROOT },
);
console.log(
  JSON.stringify({
    query,
    preset: out.preset,
    frameMsWithDraw: out.frameMsWithDraw,
    renderMsAlone: out.renderMs,
  }),
);
console.log('per frame by pass:', JSON.stringify(out.byPass));
for (const r of out.top)
  console.log(`${String(r.calls).padStart(7)} calls ${String(r.tris).padStart(9)} tris  ${r.k}`);
if (errors.length) console.log('page errors:', errors.slice(0, 5));
await browser.close();
