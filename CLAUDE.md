# Strikegy — notes for Claude

Browser FPS, a from-scratch rewrite of the older "Strikegy p1" (reference only; it lives outside this repo on the owner's PC and is not available in cloud sessions). Stack: Vite + TypeScript (strict) + Three.js + Rapier (`@dimforge/rapier3d-compat`) + recast-navigation. See README.md for commands, controls and layout.

The owner writes in Korean; reply in Korean.

## Rules (from the owner)

- **Branch `v2` only.** Commit and push finished work to `v2` without asking (`git push origin v2`).
- **Never push to or modify `main`.** strikegy.org serves the old p1 game from main; changing that needs the owner's explicit OK.
- **Downloads need approval first.** Before fetching any asset/texture/model/sound, show the owner the list with sources, licenses and sizes, and wait for a yes. Prefer CC0 (Poly Haven etc.). Record new assets in `assets.manifest.json` / `sounds.manifest.json`.
- Don't port p1 code wholesale; port numbers and concepts.
- The campaign story and the class redesign (M4-C) are co-designed with the owner — ask before building content for them.

## Checks before pushing

```bash
npm run lint && npm test && npx tsc --noEmit
```

Run the game (`npm run dev`, then e.g. `?map=iron_gate&bots=12v12`) and check the console has no errors. In dev builds the game is on `window.__strikegy`.

Performance work: measure first. A reliable CPU benchmark in a hidden/automated browser is to stop the rAF loop and drive `g.frame(now)` manually (`cancelAnimationFrame(g.rafId); window.requestAnimationFrame = () => 0;` then call `g.frame(now += 16.67)` in a loop, wrapping methods with `performance.now()` timers). GPU timing in an automated browser is vsync-bound and unreliable; the F3 perf panel (GPU timer queries) is the in-game tool.

## Where things are

- `src/core/Game.ts` — wiring, frame loop, deploy/respawn flow.
- `src/ai/` — `Bot` (perception, movement on the navmesh, aim), `BotManager` (services, squads, objectives), `brain.ts` (utility action choice), `NavWorld` (Detour queries).
- `src/modes/` — Zone rules/mode/visuals, squads.
- `src/world/` — map JSON loader (`buildBlockout`), terrain + irregular boundary, generated buildings, backdrop scenery.
- `scripts/maps/*.mjs` — generated maps (`npm run maps` → `public/maps/*.json`).
- Physics layers in `src/physics/PhysicsWorld.ts` (WORLD, PLAYER, HITBOX, DEBRIS, BOT, BOUNDS).

## Roadmap (state as of 2026-09-27)

Milestones: M0 setup → M1 core → M2 combat → M3 bots → M4 modes/meta → M5 mobile → M6 campaign → M7 content.

M4 is split: **M4-A** Zone mode (done: rules, map 1 "Iron Gate", squads, BF-style deploy screen), **M4-B** scoreboard + minimap (reuse `src/ui/mapPainter.ts`), **M4-C** classes + economy (redesign with owner), **M4-D** lobby + settings.

Zone decisions: death-only tickets; respawn at base / owned zones (zone under attack → spawn a bit away) / next to a squadmate (not while the mate is dead or in combat; squad wipe = +5 s respawn).

In progress / next (owner approved, in this order):

1. Bot overhaul: (1) personalities + no single-file lines, (2) combat (peeking, strafing, crouch, suppressive fire, fall back to reload), (3) squad tactics (roles, flanking, holding angles, smarter following), (4) grenades/smoke, (5) building use (window/second-floor spots, clearing).
2. Replace remaining placeholder (unmodeled) objects with models.
3. Map 2 "Ardennes forest" in winter: 7 zones (A sawmill, B farm, C stone bridge, D village crossroads, E chapel hill, F bunker ridge, G rail halt), river N–S, ~200,000 m², irregular outline. Snow texture download (Poly Haven `snow_02`) still awaiting the owner's answer — ask, or use procedural snow.
4. Later: BF-style resupply stations at zones.
