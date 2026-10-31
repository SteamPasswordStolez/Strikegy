// Films the trailer's staged / CINE shots straight out of the game (docs/design/trailer-production.md §6):
// a dev server's game page in headless Edge on the real GPU (never SwiftShader), the director
// (director.js) stepping every frame by hand, each frame taken off the WebGL canvas (no HUD or menu
// can reach it) into assets-src/trailer/footage/<id>/, then encoded to footage/<id>.mp4 and entered
// in edit.json (in-point 0).
//
//   node scripts/trailer/film.mjs <group> [shot ids...] [--url http://localhost:5173] [--keep]
//                                 [--software [--size 960x540]]
//
// --software (cloud sessions only, never on the owner's PC): playwright's own Chromium on SwiftShader, for
// checking a shot's script where there is no GPU; slow (seconds a frame). The real take is filmed on the GPU.
//
// A group is scripts/trailer/shots/<group>.mjs: { query, warm?, shots: { S15: { frames, sim?, setup, frame } } }.
// `query` is the match (map, bots, at, side, mode); setup(d) and frame(d, i) run in the page with the
// director `d` (they are sent as source text: they may not use anything from the module around them).
// Frames are the shot's length from shots.json plus `pad` (default 6) so a cut never runs short.
//
// On the owner's PC (owner, 2026-10-11): one browser at a time (the shared lock below), the GPU only,
// and the browser's whole process tree is killed at the end, whatever happens.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = path.join(ROOT, 'assets-src', 'trailer');
const FOOTAGE = path.join(T, 'footage');
const FPS = 30;
const EDGE = process.env.EDGE_EXE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const LOCK = path.join(process.env.TEMP ?? process.env.TMP ?? '.', 'strikegy-browser.lock');

const args = process.argv.slice(2);
const opt = (k, def) => (args.includes(k) ? args[args.indexOf(k) + 1] : def);
const BASE = opt('--url', 'http://localhost:5173');
const keepFrames = args.includes('--keep');
const software = args.includes('--software');
const [VW, VH] = opt('--size', '1920x1080').split('x').map(Number);
/** FILM_DEBUG=1: say each step as it starts (to find where a run stops). */
const debug = (...a) => process.env.FILM_DEBUG && console.log('[debug]', ...a);
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--url' && args[i - 1] !== '--size');
const [groupName, ...only] = positional;
if (!groupName) {
  console.log('usage: node scripts/trailer/film.mjs <group> [shot ids...]');
  process.exit(1);
}
const group = (await import(pathToFileURL(path.join(ROOT, 'scripts/trailer/shots', `${groupName}.mjs`)).href)).default;
const shotTimes = Object.fromEntries(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/trailer/data/shots.json'), 'utf8')).map((s) => [s.id, s]),
);
const ids = Object.keys(group.shots).filter((id) => !only.length || only.includes(id));

/** A function's source as an expression (method shorthand `setup(d) {}` becomes a function expression). */
function src(fn) {
  if (!fn) return null;
  const t = fn.toString();
  if (/^(async\s+)?(function\b|\(|[A-Za-z_$][\w$]*\s*=>)/.test(t)) return t;
  return t.startsWith('async ') ? 'async function ' + t.slice(6) : 'function ' + t;
}

/** Frames a shot needs: its length on the 30 fps grid plus padding. */
function framesFor(id, spec) {
  if (spec.frames) return spec.frames;
  const s = shotTimes[id.split('_')[0]];
  if (!s) throw new Error(`${id}: not in shots.json and no frames given`);
  return Math.round(s.end * FPS) - Math.round(s.start * FPS) + (spec.pad ?? 6);
}

// One browser at a time on this PC (the same lock the bench scripts take).
function lock() {
  for (let i = 0; ; i++) {
    try {
      const fd = fs.openSync(LOCK, 'wx');
      fs.writeSync(fd, `trailer film ${new Date().toISOString()}`);
      fs.closeSync(fd);
      return;
    } catch {
      try {
        if (Date.now() - fs.statSync(LOCK).mtimeMs > 20 * 60 * 1000) fs.unlinkSync(LOCK);
      } catch {
        /* gone already */
      }
      if (i > 900) throw new Error('browser lock held for 30 min: ' + fs.readFileSync(LOCK, 'utf8'));
      execSync(process.platform === 'win32' ? 'ping -n 3 127.0.0.1 >nul' : 'sleep 2');
    }
  }
}
const unlock = () => {
  try {
    fs.unlinkSync(LOCK);
  } catch {
    /* not held */
  }
};

/** Empties and removes a flat folder (not fs.rmSync: it crashes Node under this repo's Korean path). */
function rmFlat(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
  fs.rmdirSync(dir);
}

lock();
let browser = null;
let pid = 0;
/** Whatever ends this process (even a crash outside the try below): the browser's tree goes, the lock is freed. */
function cleanUp() {
  if (pid && process.platform === 'win32') {
    try {
      execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
    pid = 0;
  }
  unlock();
}
process.on('exit', cleanUp);
process.on('uncaughtException', (e) => {
  console.log('crashed:', e.message);
  cleanUp();
  process.exit(1);
});
try {
  browser = await chromium.launch({
    ...(software ? {} : { executablePath: EDGE }),
    headless: true,
    args: software
      ? [
          '--use-angle=swiftshader',
          '--enable-unsafe-swiftshader',
          '--ignore-gpu-blocklist',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--mute-audio',
        ]
      : [
          '--ignore-gpu-blocklist',
          '--use-angle=d3d11',
          '--force_high_performance_gpu',
          '--enable-gpu-rasterization',
          '--disable-gpu-sandbox',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--mute-audio',
          '--autoplay-policy=no-user-gesture-required',
        ],
  });
  pid = browser.process?.()?.pid ?? 0;
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    const k = 'strikegy.settings.v1';
    let s = {};
    try {
      s = JSON.parse(localStorage.getItem(k) ?? '{}');
    } catch {
      /* fresh */
    }
    Object.assign(s, { quality: 'high', renderScale: 1, masterVolume: 0, musicVolume: 0, showFps: false, progressNotices: 'off' });
    localStorage.setItem(k, JSON.stringify(s));
    localStorage.setItem('strikegy.tutorial.v1', JSON.stringify({ basics: true, match: true }));
  });
  // FILM_GLCHECK=1, from the first draw of the page on (loading included): after each draw call the GL
  // error is read; on an error, every sampler of the current program is listed with what its texture
  // unit holds (a shadow sampler on a texture without compare mode, or the other way round).
  if (process.env.FILM_GLCHECK)
    await ctx.addInitScript(() => {
      const hits = (window.__glDrawHits = {});
      const P = WebGL2RenderingContext.prototype;
      for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        const orig = P[fn];
        P[fn] = function (...a) {
          orig.apply(this, a);
          check(this, fn);
        };
      }
      function check(gl, fn) {
        {
          const e = gl.getError();
          if (e === gl.NO_ERROR) return;
          const prog = gl.getParameter(gl.CURRENT_PROGRAM);
          const active = gl.getParameter(gl.ACTIVE_TEXTURE);
          const bad = [];
          const n = prog ? gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) : 0;
          for (let i = 0; i < n; i++) {
            const u = gl.getActiveUniform(prog, i);
            const shadow = u.type === gl.SAMPLER_2D_SHADOW;
            if (u.type !== gl.SAMPLER_2D && !shadow) continue;
            const loc = gl.getUniformLocation(prog, u.name);
            for (let k = 0; k < u.size; k++) {
              const l = u.size > 1 ? gl.getUniformLocation(prog, u.name.replace('[0]', `[${k}]`)) : loc;
              const unit = gl.getUniform(prog, l);
              gl.activeTexture(gl.TEXTURE0 + unit);
              const tex = gl.getParameter(gl.TEXTURE_BINDING_2D);
              const cmp = tex ? gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE) !== gl.NONE : false;
              if (shadow !== cmp) bad.push(`${u.name.replace('[0]', `[${k}]`)}:${shadow ? 'shadow' : '2d'}@${unit} tex=${tex ? (cmp ? 'cmp' : 'plain') : 'none'}`);
            }
          }
          gl.activeTexture(active);
          const key = `${fn} ${e} ${bad.join(' ') || '(no sampler mismatch found)'}`;
          hits[key] = (hits[key] ?? 0) + 1;
        };
      }
    });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  // WebGL's own warnings (GL_INVALID_..., "too many errors") are counted and the first kept: a
  // "texture format / sampler type" flood was seen once on Coral Reach (2026-10-31) and not again.
  const glWarn = { count: 0, first: '' };
  page.on('console', (m) => {
    const text = m.text();
    if (/GL_INVALID|too many errors/.test(text)) {
      glWarn.count++;
      glWarn.first ||= text.slice(0, 200);
      return;
    }
    if (m.type() === 'error') console.log('console:', text.slice(0, 300));
  });
  process.on('exit', () => {
    if (glWarn.count) console.log(`WebGL warnings: ${glWarn.count} (first: ${glWarn.first})`);
  });

  const sep = group.query.includes('?') ? '&' : '?';
  const url = `${BASE}/${sep}${group.query}&nohud=1`;
  console.log(`${groupName}: ${url}`);
  const loadStart = Date.now();
  await page.goto(url);
  // Big maps can take minutes (a navmesh built in the page when the baked one is stale).
  await page.waitForFunction(() => window.__strikegy?.running, null, { timeout: 600_000, polling: 500 });
  console.log(`loaded in ${((Date.now() - loadStart) / 1000).toFixed(0)} s`);
  const gpu = await page.evaluate(() => {
    const gl = window.__strikegy.renderer.canvas.getContext('webgl2');
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log(`GPU: ${gpu}`);
  if (!software && /swiftshader|llvmpipe|software/i.test(gpu)) throw new Error('software rendering: refusing to film on the CPU');
  if (software)
    await page.evaluate(() => {
      window.__filmSoftware = true;
    });
  await page.addScriptTag({ path: path.join(ROOT, 'scripts/trailer/director.js') });
  // start() returns the director (and the whole game behind it): nothing comes back to Node.
  await page.evaluate(() => {
    window.__director.start();
  });
  // FILM_GLCHECK=1: every draw checked with gl.getError(); the failing materials / objects are listed at the end.
  if (process.env.FILM_GLCHECK) {
    await page.evaluate(() => {
      const R = window.__strikegy.renderer.gl;
      const gl = R.getContext();
      const hits = (window.__glHits = {});
      const orig = R.renderBufferDirect.bind(R);
      R.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
        orig(camera, scene, geometry, material, object, group);
        const e = gl.getError();
        if (e === gl.NO_ERROR) return;
        const names = [];
        for (let o = object; o && names.length < 4; o = o.parent) names.push(o.name || o.type);
        // The textures the drawn material and the object's own material carry (type / format / compare).
        const tex = (m) =>
          Object.entries(m ?? {})
            .filter(([, t]) => t && t.isTexture)
            .map(([k, t]) => `${k}=${t.constructor.name}/t${t.type}/f${t.format}${t.compareFunction ? '/cmp' : ''}`)
            .join(',');
        const own = Array.isArray(object.material) ? object.material[0] : object.material;
        const key = `${material.type}:${material.name || ''} [${tex(material)}] own=${own?.type}[${tex(own)}] skinned=${!!object.isSkinnedMesh} ${names.join(' < ')} (${e})`;
        hits[key] = (hits[key] ?? 0) + 1;
      };
    });
  }
  debug('group setup');
  if (group.setup) await page.evaluate(`(${src(group.setup)})(window.__director)`);
  if (group.warm) await page.evaluate((s) => window.__director.warm(s), group.warm);

  const edit = fs.existsSync(path.join(T, 'edit.json')) ? JSON.parse(fs.readFileSync(path.join(T, 'edit.json'), 'utf8')) : {};
  for (const id of ids) {
    const spec = group.shots[id];
    const n = framesFor(id, spec);
    const dir = path.join(FOOTAGE, id);
    rmFlat(dir);
    fs.mkdirSync(dir, { recursive: true });
    const t0 = Date.now();
    debug(id, 'setup');
    try {
      await page.evaluate(
        ([setup, frame, sim]) => {
          const d = window.__director;
          d.t = 0;
          d.frame = 0;
          // The last shot's held keys are let go.
          Object.assign(d.input, { moveX: 0, moveY: 0, fire: false, ads: false, sprint: false, interact: false, holdBreath: false });
          d.reset();
          d.shot = { frame: frame ? (0, eval)(`(${frame})`) : null, sim };
          if (setup) (0, eval)(`(${setup})`)(d);
          // Poses and seats take hold on the next step: one unrecorded frame first.
          d.step(sim);
          d.t = 0;
          d.frame = 0;
        },
        [src(spec.setup), src(spec.frame), spec.sim ?? 1 / 30],
      );
      debug(id, 'frames');
      for (let i = 0; i < n; i++) {
        if (i % 20 === 0) debug(id, 'frame', i);
        const url64 = await page.evaluate((k) => {
          const d = window.__director;
          const sim = typeof d.shot.sim === 'function' ? d.shot.sim(k) : d.shot.sim;
          d.shot.frame?.(d, k);
          d.step(sim);
          return d.grab(0.94);
        }, i);
        fs.writeFileSync(path.join(dir, `${String(i).padStart(5, '0')}.jpg`), Buffer.from(url64.split(',')[1], 'base64'));
      }
    } catch (e) {
      // One shot's script going wrong doesn't stop the others.
      console.log(`${id}: FAILED: ${e.message.split('\n')[0]}`);
      rmFlat(dir);
      continue;
    }
    const file = path.join(FOOTAGE, `${id}.mp4`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(dir, '%05d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', file]);
    if (!keepFrames) rmFlat(dir);
    // A shot id like S20_slow fills S20; several footage ids may serve one shot (the edit picks one).
    const target = spec.for ?? id;
    edit[target] = { ...(edit[target] ?? {}), file: `footage/${id}.mp4`, in: spec.in ?? 0, ...(spec.speed ? { speed: spec.speed } : {}) };
    console.log(`${id}: ${n} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  fs.writeFileSync(path.join(T, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
  if (process.env.FILM_GLCHECK) console.log('GL errors by draw:', JSON.stringify(await page.evaluate(() => window.__glHits), null, 1));
  if (process.env.FILM_GLCHECK) console.log('GL errors at the WebGL level:', JSON.stringify(await page.evaluate(() => window.__glDrawHits), null, 1));
} finally {
  await browser?.close().catch(() => {});
  if (pid && process.platform === 'win32') {
    try {
      execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  }
  unlock();
}
