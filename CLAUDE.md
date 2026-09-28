# Strikegy — notes for Claude

Browser FPS, a from-scratch rewrite of the older "Strikegy p1" (reference only; it lives outside this repo on the owner's PC and is not available in cloud sessions). Stack: Vite + TypeScript (strict) + Three.js + Rapier (`@dimforge/rapier3d-compat`) + recast-navigation. See README.md for commands, controls and layout.

The owner writes in Korean; reply in Korean.

## Rules (from the owner)

- **Branch `v2` only.** Commit and push finished work to `v2` without asking (`git push origin v2`).
- **Never push to or modify `main`.** strikegy.org serves the old p1 game from main; changing that needs the owner's explicit OK.
- **v2 is deployed from a second repo**, `SteamPasswordStolez/strikegy-v2` (GitHub Pages, https://steampasswordstolez.github.io/strikegy-v2/). Its `main` mirrors this repo's `v2`: after pushing `v2` here, also push it there (`git push https://github.com/SteamPasswordStolez/strikegy-v2 v2:main`; add the repo to a cloud session first). The workflow drops `CNAME` on that repo so it never claims strikegy.org.
- **Downloads need approval first.** Before fetching any asset/texture/model/sound, show the owner the list with sources, licenses and sizes, and wait for a yes. Prefer CC0 (Poly Haven etc.). Record new assets in `assets.manifest.json` / `sounds.manifest.json`.
- Don't port p1 code wholesale; port numbers and concepts.
- The campaign story and the class redesign (M4-C) are co-designed with the owner — ask before building content for them.

## Working style the owner expects

- Models are built **procedurally in code** (guns in `src/weapons/gunKit.ts` / `gunModels.ts`, map objects in `src/world/modelKits.ts`, buildings in `src/world/buildings.ts`), not downloaded, unless the owner approves a download.
- Measure before and after performance work and report the numbers.
- Finish a chunk, verify it (tests + running the game), commit, push to `v2`, then report to the owner in Korean: what changed, how it was checked, anything not verified, and questions still open.

## Local vs cloud sessions

The owner works both on their Windows PC and in cloud sessions (claude.ai/code) on this repo.

- **Sync first.** Start every session with `git pull origin v2`. Never work on `v2` from two sessions at the same time; finish and push in one before continuing in the other.
- **Not available in the cloud:** `assets-src/` (raw asset downloads, git-ignored), the p1 folder, 7-Zip/ffmpeg for `npm run sounds`. The optimized assets in `public/` are in the repo and are all the game needs.
- **Visual / feel checks are weaker in the cloud:** a headless browser may have no or slow WebGL. Code, tests, builds, map generation and CPU benchmarks are fine there; say clearly in the report when something visual (looks, frame rate, controls feel) could not be checked, and leave it for the owner to try locally.
- The cloud session runs `npm ci` on start (`.claude/settings.json` SessionStart hook).
- Memory from the owner's local sessions does not carry over; this file is the shared source of rules and state. **Keep it up to date:** when the owner gives a new standing rule or decision, or a roadmap item is finished, update this file in the same push.

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
- `src/world/` — map JSON loader (`buildBlockout`), terrain + irregular boundary + river carving, generated buildings, backdrop scenery, `forest.ts` (in-map trees: trunk colliders, chunks switch 3D trees / impostors by distance), `river.ts` (water ribbon with shelf ice).
- `scripts/maps/*.mjs` — generated maps (`npm run maps` → `public/maps/*.json`).
- `src/audio/` — `AudioSystem` (samples + procedural fallbacks, world voice limits: 40 voices, HRTF for the nearest 10 within 30 m; keep these), `Ambience` / `ambienceDirector` (wind bed, birds, far-off fighting; levels from the visual profile or `world.ambience` in the map JSON). Samples come from `sounds.manifest.json` via `npm run sounds` (`-- --only id,...` builds just those; needs ffmpeg and 7z/unzip).
- Physics layers in `src/physics/PhysicsWorld.ts` (WORLD, PLAYER, HITBOX, DEBRIS, BOT, BOUNDS).

## Roadmap (state as of 2026-09-27)

Milestones: M0 setup → M1 core → M2 combat → M3 bots → M4 modes/meta → M5 mobile → M6 campaign → M7 content.

M4 is split: **M4-A** Zone mode (done: rules, map 1 "Iron Gate", squads, BF-style deploy screen), **M4-B** scoreboard + minimap (done), **M4-C** classes + economy (designed with owner 2026-09-28, not built: see `docs/design/m4c-classes-economy.md` — [확정] items are owner decisions, [제안] numbers still need the owner's OK, [질문] items are open), **M4-D** lobby + settings.

Zone decisions: death-only tickets; respawn at base / owned zones (zone under attack → spawn a bit away) / next to a squadmate (not while the mate is dead or in combat; squad wipe = +5 s respawn).

Done since: bot overhaul (personalities, peeking / suppression, squad flanking and guard posts, grenades and smoke, window posts; then being suppressed by near misses and blasts, targeting whoever shoots them, kill intel to nearby mates, local odds (hold when outnumbered, press when ahead), concealment by tree crowns (foliage grid), wading slowdown and routing via bridges (`crossings` on rivers); blinded bots spray or stumble back, bots fire into smoke where someone vanished, and throw flashbangs themselves while turning away), procedural models for map stand-ins and closed-block facades, first-person hands with fingers, smooth walking on roads, big-fight CPU optimizations.

Next (owner approved, in this order):

1. Map 2 "Ardennes forest" (`?map=ardennes`, `scripts/maps/ardennes.mjs`), winter. First pass done (2026-09-27): layout designed by Claude (owner's choice), blue west / red east of a N–S river that is knee deep and wadeable (owner's choice: "shallow ford + bridges"), stone bridge (C), sawmill footbridge (A), rail bridge (G); 7 zones (A sawmill, B farm, C stone bridge, D village crossroads, E chapel hill, F bunker ridge, G rail halt), ~200,000 m²; ~2,000 in-map trees; Poly Haven `snow_02` ground (approved, downloaded); `winter` visual profile; new kits logPile / hayBale / bunker / fence. Second pass done (2026-09-28): models for the chapel steeple, saw shed, stone arch bridge (C, deck raised to 0.95 m on ramped approaches) and truss rail bridge (G); `barn` and `chapel` building styles; snow on all roofs in winter maps (visual layer); falling snow (`src/render/snowfall.ts`, shader-driven); tracks fade into the snow at their sides (alpha hash). Loading: navmesh cached in IndexedDB by a hash of its input (`src/ai/navCache.ts`; ~5 s → ~0.1 s on repeat loads), terrain sampling ~10x faster (typed-array outline, river distance grid); the dev console logs a load breakdown. Owner has not played it yet.
2. M4-B done: minimap (`src/ui/Minimap.ts`: round, heading-up, zones, teammates, enemies spotted by bots or firing nearby) and scoreboard (2026-09-28: `src/modes/scoreTracker.ts` stats from events — kill 100, headshot +25, capture 150 / neutralize 75 for everyone of that side standing in the zone; `src/ui/Scoreboard.ts`; hold Z (owner: not Tab, the browser uses it), touch: tap the zone bar; shown under the result at match end; `combat:kill` now carries `attackerId` / `victimId`). Next: M4-D lobby/settings (owner picked it), M4-C classes/economy (design doc done, build after M4-D).
3. Later: BF-style resupply stations at zones.

Weapon handling (2026-09-28, owner's playtesters asked): the support hand is its own group in `ViewModel` and follows keyframed tracks (`src/weapons/viewAnims.ts`, keys relative to per-gun anchors: magazine / charging handle or slide / loading port): magazine reloads grab the mag, take it off screen, seat a new one and work the handle; shotguns and bolt rifles load a visible shell per insert. Inspect on `~` (touch: tap the ammo counter; 3.2 s, turns the gun both ways with a mag check, cancelled by anything else). Melee on `V` (touch: button left of crouch), a random motion each swing, never the same twice (long guns: buttstroke / muzzle thrust / overhead chop / butt jab; pistols: whip / backhand / grip punch): 0.6 s swing, lands at 0.23 s, 2 m, 55 body / 70 head, cancels a reload. Bots don't melee yet. The scanned pistol's magazine is now seated in the grip (the source file has it lying behind the gun). Gun models (2026-09-28, second pass): `buildGun(def, { detail })` — `full` for the viewmodel (~4.5–5.5k tris: pins, controls, open dust cover, seams, grip texture, top round in the mag, folded backup irons, sling loops...), `low` for bots (fine parts go to `DISCARD`; ~2–3k tris, about what they were). Per-weapon accessories in `LOOKS` (foregrip vertical/angled, weapon light, muzzle flash/brake/suppressor, bipod; sg2 is the tactical shotgun with heat shield, ghost ring and side saddle). A left fill light in the viewmodel scene keeps the gun's visible (left) side readable.

Mobile (M5) first pass done (2026-09-27): touch layout sized by screen height (fire / left fire / ADS / jump / crouch / reload / grenade: tap throw, long-press switch type / weapon swap / pause), stick follows the thumb and shows sprint, touch HUD rearranged (ammo top right, kill feed under the zone bar, squad list hidden), rotate-to-landscape screen, fullscreen + orientation lock, vibration on damage, deploy screen fits short screens, light aim assist on touch (`src/input/aimAssist.ts`), low preset: half-resolution terrain mesh, 3D trees only within 55 m, fewer edge trees, no HRTF. Not yet tested on a real phone; load time on phones (world ~4 s + navmesh ~5 s on desktop for Ardennes) still to look at.

Sound (2026-09-27): ambience and procedural handling sounds (reload per class, bolt/pump, dry fire, landing by surface/speed, grenade pin) are done, and the approved CC0 recordings are in: magazine out/in, rifle charging handle, pistol slide, shotgun pump, bolt open/close (OpenGameArt airsoft reload + "equipment clicks III"), two denoised forest bird calls, and grass / snow / metal footsteps (Kenney). New `ImpactSurface` values `grass` and `snow` exist but no map uses them yet; map 2's snow ground should. Sample total is ~2.2 MB; keep it ≲2.3 MB. The bolt cuts and the birds (noisy source) still need an ear check by the owner.
