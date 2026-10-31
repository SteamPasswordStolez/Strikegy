// The launch trailer's director (docs/design/trailer-production.md §6): film.mjs loads this into a dev
// build's game page (window.__strikegy) and runs a shot script against `window.__director`.
//
// It takes the game off the clock (no requestAnimationFrame: every frame is stepped by hand at the
// film's 30 fps, so a slow shot only needs smaller sim steps), keeps filming mode on (no interface
// drawn in the world; the HUD is DOM and never reaches the canvas anyway), and gives the script:
//   cam(fn)        a scripted camera: fn(t, cam, d) places it each frame (null: the player's own eye)
//   input          the player's controls for first-person shots (the keyboard / mouse are cut off)
//   lookAt(p)      turn the player toward a point over the next frames (on the input)
//   pose(bot, ..)  a bot frozen where the script puts it (its own AI off), fire(bot, at) shoots for real
//   blast(..)      an explosion anywhere; vehicle(..) a vehicle; grab() the frame as a JPEG data URL
// Nothing here is part of the game build.
(() => {
  const g = window.__strikegy;
  if (!g) throw new Error('no game on window.__strikegy (dev build, a match loaded?)');
  const cam0 = g.renderer.camera;
  const V = cam0.position.constructor;
  const v = (x = 0, y = 0, z = 0) => new V(x, y, z);
  const DEG = Math.PI / 180;

  const input = {
    moveX: 0,
    moveY: 0,
    fire: false,
    ads: false,
    sprint: false,
    crouch: false,
    jump: false,
    reload: false,
    interact: false,
    throwGrenade: false,
    melee: false,
    gadget: false,
    buildMode: false,
    crouchToggle: false,
    holdBreath: false,
    slot: -1,
    yaw: 0,
    pitch: 0,
  };
  let lastFire = false;
  let lastInteract = false;
  /** Replaces the keyboard / mouse / touch: the script's controls only. */
  const source = {
    apply(s) {
      s.moveX = input.moveX;
      s.moveY = input.moveY;
      s.lookYaw += input.yaw;
      s.lookPitch += input.pitch;
      input.yaw = 0;
      input.pitch = 0;
      s.fire = input.fire;
      s.firePressed = input.fire && !lastFire;
      lastFire = input.fire;
      s.ads = input.ads;
      s.sprint = input.sprint;
      s.crouch = input.crouch;
      s.jump = input.jump;
      s.reload = input.reload;
      s.interact = input.interact;
      s.interactPressed = input.interact && !lastInteract;
      lastInteract = input.interact;
      if (input.throwGrenade) s.throwGrenade = true;
      if (input.melee) s.melee = true;
      if (input.gadget) s.gadget = true;
      if (input.buildMode) s.buildMode = true;
      if (input.crouchToggle) s.crouchToggle = true;
      if (input.slot >= 0) s.weaponSlot = input.slot;
      s.holdBreath = input.holdBreath;
      // Pulses: one frame each.
      input.reload = false;
      input.jump = false;
      input.throwGrenade = false;
      input.melee = false;
      input.gadget = false;
      input.buildMode = false;
      input.crouchToggle = false;
      input.slot = -1;
    },
    dispose() {},
  };

  const posed = new Map();
  const d = {
    g,
    V,
    v,
    DEG,
    input,
    /** Seconds of film shot so far (the camera's clock; the sim's may run slower). */
    t: 0,
    frame: 0,
    now: performance.now(),
    camFn: null,

    /** Off the clock, filming mode, full resolution; the script's controls instead of the player's. */
    start() {
      cancelAnimationFrame(g.rafId);
      window.requestAnimationFrame = () => 0;
      g.renderer.setRenderScale(1);
      g.setFilming(true);
      g.audio.setVolume?.(0);
      g.sources.length = 0;
      g.sources.push(source);
      // Untouchable while d.god: stray rounds from the bots' fight would put the private down (the camera on its back).
      const damage = g.me.damage.bind(g.me);
      g.me.damage = (...x) => (d.god ? false : damage(...x));
      g.lastTime = d.now;
      return d;
    },

    /** The player can't be hurt (staged shots: stray rounds from the bots' fight). */
    god: true,

    /** Before every shot: back on one's feet, standing, gun out, no build mode, every bot free again. */
    reset() {
      if (g.me.downed) g.me.revive('', 100);
      if (g.ride) g.leaveVehicle();
      for (const veh of d.spawned.splice(0)) g.vehicles.remove(veh);
      if (g.buildMode) g.buildMode = false;
      if (g.gadgetOut) input.gadget = true;
      if (g.player.crouchToggled) input.crouchToggle = true;
      for (const b of [...posed.keys()]) d.release(b);
      // Smoke from the last shot stops coming (what is in the air fades by itself).
      g.effects.emitters.length = 0;
      g.effects.smokes.length = 0;
      d.cam(null);
      d.step();
    },

    /** One film frame: the sim moves `sim` seconds (less than 1/30 = slow motion). */
    step(sim = 1 / 30) {
      d.now += sim * 1000;
      g.showcaseAt = -1e9;
      if (d.god && g.me?.health) g.me.health.value = Math.max(g.me.health.value, 100);
      // No flashbang white-out in a shot.
      if (d.god) g.flashLeft = 0;
      for (const [b, p] of posed) d.holdPose(b, p, sim);
      g.frame(d.now);
      d.t += 1 / 30;
      d.frame++;
    },

    /** Runs the sim for `seconds` without filming (warm-up: bots get into the fight, dust settles). */
    warm(seconds, sim = 1 / 30) {
      const n = Math.round(seconds / sim);
      for (let i = 0; i < n; i++) {
        d.now += sim * 1000;
        g.showcaseAt = -1e9;
        for (const [b, p] of posed) d.holdPose(b, p, sim);
        g.frame(d.now);
      }
    },

    /** The frame as drawn, a JPEG data URL (taken in the same task as the draw). */
    grab(quality = 0.93) {
      return g.renderer.canvas.toDataURL('image/jpeg', quality);
    },

    /** A scripted camera (fn(t, cam, d) each frame), or null for the player's eye with the gun. */
    cam(fn) {
      d.camFn = fn;
      if (!fn) {
        g.showcaseCam = null;
        g.renderer.fpScene.visible = true;
        return;
      }
      g.renderer.fpScene.visible = false;
      g.showcaseCam = {
        update: (dt, cam) => {
          d.camFn(d.t, cam, d);
          cam.updateProjectionMatrix();
          cam.updateMatrixWorld();
        },
      };
    },

    /** Camera at `pos` looking at `look`, field of view `fov` (degrees). */
    place(cam, pos, look, fov = 50, roll = 0) {
      cam.position.copy(pos);
      cam.up.set(Math.sin(roll), Math.cos(roll), 0);
      cam.lookAt(look);
      cam.up.set(0, 1, 0);
      cam.fov = fov;
    },

    /** Ground height at x, z (the top of whatever is solid there), or `fallback`. */
    ground(x, z, from = 600, fallback = 0) {
      const hit = g.physics.raycast(v(x, from, z), v(0, -1, 0), from + 300, 1);
      return hit ? hit.point.y : fallback;
    },

    /** Deploys the player (at ?at= when the URL has it; `key` like 'base', 'zone:B', 'tank:tank'). */
    deploy(key = 'base') {
      if (g.deployScreen?.visible) g.deployScreen.hide();
      g.spawnKey = key;
      g.deploy();
    },

    /** Moves the player onto the floor under (x, y, z) facing `bearing`, looking `pitch` degrees up. */
    put(x, y, z, bearing, pitch = 0) {
      const hit = g.physics.raycast(v(x, y + 1.5, z), v(0, -1, 0), 200, 1);
      g.player.teleport(v(x, hit ? hit.point.y + 0.05 : y, z), -bearing * DEG);
      g.player.pitch = pitch * DEG;
    },

    /** Turns the player's view straight onto `p` (no easing). */
    face(p) {
      const pl = g.player;
      const eye = pl.feet.clone().setY(pl.feet.y + pl.eyeHeight);
      pl.yaw = Math.atan2(-(p.x - eye.x), -(p.z - eye.z));
      pl.pitch = Math.atan2(p.y - eye.y, Math.hypot(p.x - eye.x, p.z - eye.z));
    },
    /** A point on the floor under (x, y, z) (y: where to look down from; the ground without it). */
    at(x, z, y) {
      return v(x, y === undefined ? d.ground(x, z) : d.ground(x, z, y + 1.5, y), z);
    },
    /** The nearest unbuilt fortification spot of a kind (or any) to `p`. */
    spot(p, kind) {
      const list = (g.fort?.slots ?? []).filter((s) => !s.built && (!kind || s.kind === kind));
      list.sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
      return list[0] ?? null;
    },

    /** Player yaw for a compass bearing in degrees (clockwise from north, -z). */
    yawOf(bearing) {
      return -bearing * DEG;
    },

    /** Turns the player's view toward `p` by up to `rate` rad a frame (eases in, ~0 once on it). */
    lookAt(p, rate = 0.08) {
      const pl = g.player;
      const eye = pl.feet.clone().setY(pl.feet.y + pl.eyeHeight);
      const dx = p.x - eye.x;
      const dz = p.z - eye.z;
      const wantYaw = Math.atan2(-dx, -dz);
      const wantPitch = Math.atan2(p.y - eye.y, Math.hypot(dx, dz));
      let dy = wantYaw - pl.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const dp = wantPitch - pl.pitch;
      input.yaw += Math.max(-rate, Math.min(rate, dy * 0.35));
      input.pitch += Math.max(-rate, Math.min(rate, dp * 0.35));
    },

    /** Every bot on a side, dead ones too (posing one brings it back). */
    team(side) {
      return (g.bots?.bots ?? []).filter((b) => b.team === side && !b.riding);
    },
    /** Build mode without its blueprints: the sandbags rise out of nothing (the ghost is interface). */
    noBlueprints() {
      const fort = g.fort;
      if (!fort || fort.__noGhosts) return;
      const render = fort.render.bind(fort);
      fort.render = (...a) => {
        render(...a);
        for (const s of fort.slots) {
          s.ghost.visible = false;
          s.outline.visible = false;
        }
      };
      fort.__noGhosts = true;
    },

    /** Bots on a side, alive, on foot. */
    bots(team) {
      return (g.bots?.bots ?? []).filter((b) => b.alive && !b.riding && (!team || b.team === team));
    },

    /** Holds a bot where the script says (its AI off): {pos, yaw, aimYaw?, aimPitch?, crouch?, god?}. */
    pose(bot, p) {
      // Killed in the fight between shots: back on its feet where the shot wants it.
      if (!bot.alive && p.pos) bot.spawn(p.pos.clone(), p.yaw ?? 0, bot.def);
      bot.puppet = true;
      posed.set(bot, { ...posed.get(bot), ...p });
    },
    /** Puts a bot down (hit in the chest from `from`): the fall plays, its pose is let go. */
    down(bot, from) {
      d.release(bot);
      bot.applyDamage(1000, 'body', { pos: from ?? bot.feet.clone(), name: '', team: bot.team === 'blue' ? 'red' : 'blue', weapon: 'AKM', id: -901 });
    },
    /** Hands a posed bot back to its AI. */
    release(bot) {
      bot.puppet = false;
      posed.delete(bot);
    },
    holdPose(b, p, dt) {
      if (!b.alive) return posed.delete(b);
      if (p.god) b.health.value = Math.max(b.health.value, 100);
      const aimYaw = p.aimYaw ?? p.yaw;
      b.puppetTo(p.pos, p.yaw, aimYaw, p.aimPitch ?? 0, !!p.crouch, dt);
    },
    /** Points a posed bot at `at` (yaw and aim). */
    aim(bot, at) {
      const p = posed.get(bot) ?? { pos: bot.feet.clone() };
      const eye = p.pos.clone().setY(p.pos.y + (p.crouch ? 1.1 : 1.6));
      const yaw = Math.atan2(-(at.x - eye.x), -(at.z - eye.z));
      const pitch = Math.atan2(at.y - eye.y, Math.hypot(at.x - eye.x, at.z - eye.z));
      d.pose(bot, { ...p, yaw, aimYaw: yaw, aimPitch: pitch });
    },
    /** One round from `bot` toward `at` (tracer, sound, hits for real). */
    fire(bot, at, spread = 0.01) {
      const eye = bot.eyePos(v());
      const dir = at.clone().sub(eye).normalize();
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      g.bots.fire(bot, dir.normalize());
    },

    /** An explosion at `p` ('frag', 'rocket', 'mortar', 'artillery', 'shell', 'howitzer', 'naval', ...). */
    blast(kind, p, team = 'red') {
      g.blast(kind, p, { id: -900, name: '', team, squad: null }, kind);
    },

    /** A vehicle of `kind` at `pos` facing `yaw`, for `team`. */
    vehicle(kind, pos, yaw, team = 'blue') {
      const veh = g.vehicles.spawn(kind, pos, yaw, team);
      d.spawned.push(veh);
      return veh;
    },
    /** Vehicles the shots put down (gone again before the next shot). */
    spawned: [],
    /** Moves a vehicle by script (kinematic from then on): to `pos`, heading `yaw`, pitched / banked. */
    drive(veh, pos, yaw, pitch = 0, roll = 0, vel = null) {
      veh.setRemote(true);
      const q = cam0.quaternion.clone();
      const e = q.clone().setFromAxisAngle(v(0, 1, 0), yaw);
      const p = q.clone().setFromAxisAngle(v(1, 0, 0), pitch);
      const r = q.clone().setFromAxisAngle(v(0, 0, 1), roll);
      e.multiply(p).multiply(r);
      veh.place(pos, e, vel ?? v());
    },
    /** A vehicle's seat gun fires at `at` (the gun turned there first, as far as it reaches). */
    mountFire(veh, seat, at, team = 'blue', alt = false) {
      const mz = veh.muzzleOf(seat, v());
      veh.aimMount(seat, Math.atan2(-(at.x - mz.x), -(at.z - mz.z)), Math.atan2(at.y - mz.y, Math.hypot(at.x - mz.x, at.z - mz.z)));
      g.fireMount(veh, seat, { id: -902, name: '', team, squad: null }, at, alt);
    },
    /** Wrecks a vehicle outright (a kill the script decides on). */
    wreck(veh) {
      veh.applyDamage(1e6, 'body', undefined, 'at');
    },
    /** The player into a vehicle seat. */
    seat(veh, seat = 0) {
      g.enterSeat(veh, seat);
    },
    /** Rounds in the player's magazine. */
    ammo(n) {
      g.weapons.state.ammo = n;
    },
    /** A smoke cloud at `p` for `seconds`, `radius` m. */
    smoke(p, seconds = 20, radius = 6) {
      g.effects.smoke(p, seconds, radius);
    },
    /** The vehicles on the map (optionally of one kind), nearest to `p` first. */
    vehicles(kind, p) {
      const list = (g.vehicles?.vehicles ?? []).filter((x) => !x.wrecked && (!kind || x.kind === kind));
      if (p) list.sort((a, b) => a.model.root.position.distanceTo(p) - b.model.root.position.distanceTo(p));
      return list;
    },

    /** Linear / smooth interpolation helpers for camera paths. */
    lerp: (a, b, k) => a + (b - a) * k,
    smooth: (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k)),
    mix(a, b, k) {
      return v(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    },
  };
  window.__director = d;
})();
