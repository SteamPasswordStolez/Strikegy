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
      d.bt = null;
      d.unmood();
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
      // On SwiftShader (film.mjs --software) nothing is drawn while warming: the draws only run at the next
      // grab, and a few hundred of them queued up ran the browser out of memory. Same filmed frames.
      const r = g.renderer;
      const own = Object.prototype.hasOwnProperty.call(r, 'render');
      const render = r.render;
      if (window.__filmSoftware) r.render = () => false;
      try {
        for (let i = 0; i < n; i++) {
          d.now += sim * 1000;
          g.showcaseAt = -1e9;
          for (const [b, p] of posed) d.holdPose(b, p, sim);
          g.frame(d.now);
        }
      } finally {
        if (own) r.render = render;
        else delete r.render;
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

    /** A fireball and smoke at `p` only (no damage, no sound): muzzle blasts of big guns. */
    flash(p) {
      g.effects.explosion(p);
    },
    /**
     * Bigger particle pools from now on (the game's 1,200 smoke / 600 glow wrap round and wipe a long plume
     * when a barrage lands on top of it). Same layers, more slots; the page keeps them until it reloads.
     */
    particles(soft = 5000, glow = 2000) {
      const fx = g.effects;
      for (const [key, cap] of [
        ['soft', soft],
        ['glow', glow],
      ]) {
        const old = fx[key];
        if (old.capacity >= cap) continue;
        const scene = old.mesh.parent;
        old.mesh.removeFromParent();
        fx[key] = new old.constructor(scene, cap, key === 'glow');
      }
    },
    /**
     * The trailer's biggest blast (S56), `i` frames after it went off (call it every frame): a white flash,
     * a fireball tumbling out and up, sparks arcing down, a dust ring running over the ground, then a column
     * of fire for a second and black smoke boiling up for four. `k` scales it (1: some 40 m high). No damage:
     * pair it with blast() for the sound, the scorch and the soldiers knocked over.
     */
    inferno(p, i, k = 1) {
      const fx = g.effects;
      const R = (a, b) => a + Math.random() * (b - a);
      const dir = () => {
        const u = R(-1, 1);
        const a = R(0, Math.PI * 2);
        const s = Math.sqrt(1 - u * u);
        return v(Math.cos(a) * s, u, Math.sin(a) * s);
      };
      const flat = () => dir().setY(0).normalize();
      const up = v(0, 1, 0);
      if (i === 0) {
        fx.flashLight(p.clone().setY(p.y + 4), 6000 * k, 0.9, 0xffa050, 120 * k);
        fx.glow.spawn({ pos: p.clone().setY(p.y + 3 * k), life: 0.3, size: 26 * k, endSize: 40 * k, color: 0xfff4dc });
        for (let n = 0; n < 70; n++)
          fx.glow.spawn({
            pos: p.clone().addScaledVector(dir(), R(0, 3) * k).setY(p.y + R(1, 5) * k),
            vel: dir().multiplyScalar(R(5, 16) * k).addScaledVector(up, R(4, 12) * k),
            life: R(0.7, 1.5),
            size: R(4, 7) * k,
            endSize: R(9, 15) * k,
            color: [0xffd890, 0xff8a3a, 0xff5a1e][n % 3],
            alpha: 0.9,
            drag: 2.2,
          });
        for (let n = 0; n < 90; n++)
          fx.glow.spawn({
            pos: p.clone().setY(p.y + 1.5),
            vel: flat().multiplyScalar(R(8, 26) * k).addScaledVector(up, R(10, 30) * k),
            life: R(1.2, 2.6),
            size: R(0.15, 0.35),
            endSize: 0.06,
            color: 0xffc070,
            gravity: 9.8,
            floorY: p.y,
          });
        for (let n = 0; n < 48; n++) {
          const a = (n / 48) * Math.PI * 2;
          fx.soft.spawn({
            pos: p.clone().setY(p.y + 0.8),
            vel: v(Math.cos(a), 0.05, Math.sin(a)).multiplyScalar(R(16, 28) * k),
            life: R(1.6, 2.8),
            size: R(2, 3) * k,
            endSize: R(7, 11) * k,
            color: 0x8a7964,
            alpha: 0.55,
            fadeIn: 0.05,
            drag: 1.8,
          });
        }
        for (let n = 0; n < 60; n++)
          fx.soft.spawn({
            pos: p.clone().setY(p.y + 1),
            vel: flat().multiplyScalar(R(4, 14) * k).addScaledVector(up, R(10, 24) * k),
            life: R(2, 3.2),
            size: R(0.15, 0.4),
            color: 0x221c15,
            gravity: 11,
            floorY: p.y,
          });
      }
      if (i < 30)
        for (let n = 0; n < 4; n++)
          fx.glow.spawn({
            pos: p.clone().add(v(R(-3, 3) * k, (R(2, 6) + i * 0.5) * k, R(-3, 3) * k)),
            vel: v(R(-2, 2), R(10, 18) * k * (1 - i / 40), R(-2, 2)),
            life: R(0.6, 1.1),
            size: R(4, 7) * k,
            endSize: R(8, 12) * k,
            color: n % 2 ? 0xff9a40 : 0xff6a20,
            alpha: 0.8 * (1 - i / 34),
            drag: 1.5,
          });
      if (i < 120 && i % 2 === 0)
        for (let n = 0; n < 5; n++)
          fx.soft.spawn({
            pos: p.clone().add(v(R(-4, 4) * k, R(3, 8) * k, R(-4, 4) * k)),
            vel: v(R(-2, 2) + 1.2, R(8, 15) * k * Math.max(0.35, 1 - i / 60), R(-2, 2) - 0.6),
            life: R(6, 9),
            size: R(5, 8) * k,
            endSize: R(16, 26) * k,
            color: n % 3 ? 0x2b2622 : 0x48403a,
            alpha: 0.85,
            fadeIn: 0.2,
            drag: 0.5,
            rotSpeed: R(-0.3, 0.3),
          });
    },
    /**
     * A burning building's or wreck's column of black smoke over fire at `p` (call it every frame; `k` scales
     * it, 1: some 50 m high, leaning downwind; ~400 smoke puffs alive each, so see particles()). Seen from far off, unlike smoke grenades' white puffs.
     */
    plume(p, i, k = 1) {
      const fx = g.effects;
      const R = (a, b) => a + Math.random() * (b - a);
      fx.soft.spawn({
        pos: p.clone().add(v(R(-1.5, 1.5) * k, R(1, 3) * k, R(-1.5, 1.5) * k)),
        vel: v(R(0.4, 1.2), R(5, 9) * k, R(-0.9, -0.1)),
        life: R(10, 14),
        size: R(3, 4.5) * k,
        endSize: R(14, 20) * k,
        color: i % 2 ? 0x2b2622 : 0x3e3631,
        alpha: 0.6,
        fadeIn: 0.5,
        drag: 0.08,
        rotSpeed: R(-0.2, 0.2),
      });
      if (i % 2 === 0)
        fx.glow.spawn({
          pos: p.clone().add(v(R(-1.5, 1.5) * k, R(0.5, 2) * k, R(-1.5, 1.5) * k)),
          vel: v(0, R(2, 4), 0),
          life: R(0.4, 0.7),
          size: R(2, 3.5) * k,
          endSize: R(1, 2) * k,
          color: 0xff7a2a,
          alpha: 0.7,
        });
    },
    /** A big gun's muzzle blast: fireballs along the line it fires, `len` m out. */
    muzzleBlast(veh, seat, at, len = 14) {
      const mz = veh.muzzleOf(seat, v());
      const dir = at.clone().sub(mz).normalize();
      for (const k of [2, len * 0.5, len]) d.flash(mz.clone().addScaledVector(dir, k));
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

    /**
     * The air of a shot: 'dust' = a grey-brown battle haze, a softer warm sun (on the overcast
     * profile, ?profile=overcast). Restored by reset().
     */
    mood(kind) {
      const r = g.renderer;
      let sun = null;
      let hemi = null;
      r.scene.traverse((o) => {
        if (o.isDirectionalLight && o.intensity > 0.5) sun = o;
        if (o.isHemisphereLight) hemi = o;
      });
      d.moodWas ??= { fog: r.scene.fog.color.getHex(), density: r.scene.fog.density, sun: sun?.intensity, sunColor: sun?.color.getHex(), hemi: hemi?.intensity, exposure: r.gl.toneMappingExposure, sunRef: sun, hemiRef: hemi, sunDir: g.atmosphere.sunDir.clone() };
      if (kind === 'dusk') {
        // A low warm sun from the south-southwest (long shadows across the square), warm haze.
        g.atmosphere.sunDir.set(-0.32, 0.27, 0.91).normalize();
        r.requestShadowUpdate();
        r.scene.fog.color.setHex(0xc4ab8e);
        r.scene.fog.density = 0.0035;
        if (sun) {
          sun.intensity = 3.2;
          sun.color.setHex(0xffc890);
        }
        if (hemi) hemi.intensity = 0.2;
        r.gl.toneMappingExposure = 0.58;
      }
      if (kind === 'dust') {
        r.scene.fog.color.setHex(0x8e8a82);
        r.scene.fog.density = 0.0062;
        if (sun) {
          sun.intensity = 1.9;
          sun.color.setHex(0xffe2c4);
        }
        if (hemi) hemi.intensity = 0.4;
        r.gl.toneMappingExposure = 0.52;
      }
    },
    unmood() {
      const w = d.moodWas;
      if (!w) return;
      const r = g.renderer;
      r.scene.fog.color.setHex(w.fog);
      r.scene.fog.density = w.density;
      if (w.sunRef) {
        w.sunRef.intensity = w.sun;
        w.sunRef.color.setHex(w.sunColor);
      }
      if (w.hemiRef) w.hemiRef.intensity = w.hemi;
      r.gl.toneMappingExposure = w.exposure;
      if (!g.atmosphere.sunDir.equals(w.sunDir)) {
        g.atmosphere.sunDir.copy(w.sunDir);
        r.requestShadowUpdate();
      }
      d.moodWas = null;
    },

    /**
     * A battle round the camera (set up once in a shot's setup, then battleTick(i) every frame):
     *   smoke: [[x, z, radius]] columns that last; wrecks: [[kind, x, z, yaw]] burning hulks;
     *   friends / foes: [[x, z, yaw, crouch]] posed soldiers (blue / red) trading fire;
     *   shells: { every: frames, near: [x, z], min, max } shells landing round `near`.
     * Everyone in it is untouchable (deaths in a shot are staged with down()).
     */
    battle(cfg) {
      const b = { cfg, friends: [], foes: [], seed: 7 };
      for (const [x, z, rad] of cfg.smoke ?? []) d.smoke(d.at(x, z), 90, rad ?? 8);
      for (const [kind, x, z, yaw] of cfg.wrecks ?? []) {
        const veh = d.vehicle(kind, d.at(x, z), yaw ?? 0, 'red');
        d.wreck(veh);
      }
      const take = (side, list, out) => {
        const pool = d.team(side).filter((x) => !posed.has(x) && !Object.values(d.cast ?? {}).includes(x));
        list.forEach(([x, z, yaw, crouch], k) => {
          const bot = pool[k];
          if (!bot) return;
          d.pose(bot, { pos: d.at(x, z), yaw: yaw ?? 0, crouch: !!crouch, god: true });
          out.push(bot);
        });
      };
      take('blue', cfg.friends ?? [], b.friends);
      take('red', cfg.foes ?? [], b.foes);
      d.bt = b;
    },
    battleTick(i) {
      const b = d.bt;
      if (!b) return;
      const rnd = (k) => {
        const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
        return x - Math.floor(x);
      };
      const aimAt = (shooter, list) => {
        const t = list[(i + shooter.id) % Math.max(1, list.length)];
        return t ? t.feet.clone().setY(t.feet.y + 1.2 + (rnd(shooter.id) - 0.5)) : null;
      };
      // Bursts: each shooter fires 3-4 frames in every 9-14, offset by its id.
      const burst = (bot) => (i + bot.id * 5) % (9 + (bot.id % 6)) < 3;
      for (const f of b.friends) {
        const at = aimAt(f, b.foes) ?? d.v(f.feet.x - Math.sin(f.yaw) * 60, f.feet.y + 1.5, f.feet.z - Math.cos(f.yaw) * 60);
        if (burst(f)) d.fire(f, at, 0.05);
      }
      for (const e of b.foes) {
        const at = aimAt(e, b.friends) ?? d.v(e.feet.x - Math.sin(e.yaw) * 60, e.feet.y + 1.5, e.feet.z - Math.cos(e.yaw) * 60);
        if (burst(e)) d.fire(e, at, 0.07);
      }
      const s = b.cfg.shells;
      if (s && i % s.every === Math.floor(s.every / 2)) {
        const a = rnd(3) * Math.PI * 2;
        const r = s.min + rnd(4) * (s.max - s.min);
        d.blast(rnd(5) < 0.5 ? 'mortar' : 'artillery', d.at(s.near[0] + Math.cos(a) * r, s.near[1] + Math.sin(a) * r), 'red');
      }
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
