// Iron Gate under an overcast, dusty sky (?profile=overcast + d.mood('dusk')): act 1 (S1-S6) and all of
// act 6 (S41-S53), the trailer's bookends round square B (0, 3.1, 0; fountain in the middle). Owner,
// 2026-10-31: the first version was "too crude" and the B assault "far too empty, and it's the
// highlight", so every shot here stands in a battle (d.battle: smoke, burning wrecks, both sides
// firing, shells) and the private carries the Mk 18 (the scoped M4A1 read clunky up close).
// Act 1: the squad waits behind the sandbags at the square's east edge (stand 9.5, -1.9 facing
// east), then goes in at the town hall door (north wall z -20.5, doors x ±1.5). Act 6: the charge
// from the west street (x -36..-24) across the square, the tank, the jets, the flag.
export default {
  query: 'map=iron_gate&bots=12v12&at=-30,0,90',
  setup(d) {
    d.deploy();
    d.warm(3);
    const blue = d.bots('blue');
    d.cast = { sarge: blue[0], mate1: blue[1], mate2: blue[2] };
    // The east front of act 1 (seen from the sandbags) and the square of act 6.
    d.front = {
      smoke: [
        [52, -14, 10],
        [64, 10, 12],
        [44, 24, 9],
        [80, -4, 12],
        [36, -26, 8],
      ],
      wrecks: [
        ['jeep', 30, -6, 0.7],
        ['apc', 40, 9, 2.0],
      ],
      foes: [
        [46, -7, Math.PI / 2, 1],
        [50, 6, Math.PI / 2, 1],
        [40, 15, Math.PI / 2, 0],
        [56, -2, Math.PI / 2, 1],
      ],
      shells: { every: 26, near: [48, 2], min: 4, max: 22 },
    };
    d.square = {
      smoke: [
        [22, -16, 9],
        [30, 12, 10],
        [14, 26, 8],
        [44, -2, 10],
        [-4, -30, 8],
        [6, 32, 8],
        [34, -24, 9],
      ],
      wrecks: [
        ['jeep', 12, -10, 0.6],
        ['apc', 20, 11, 2.1],
        ['jeep', -7, 15, 1.2],
      ],
      friends: [
        [-20, -5, -Math.PI / 2, 1],
        [-18, 6, -Math.PI / 2, 1],
        [-14, -8, -Math.PI / 2, 0],
        [-26, 5, -Math.PI / 2, 1],
      ],
      foes: [
        [14, -4, Math.PI / 2, 1],
        [18, 5, Math.PI / 2, 1],
        [10, 12, Math.PI / 2, 0],
        [22, -9, Math.PI / 2, 1],
        [26, 2, Math.PI / 2, 0],
      ],
      shells: { every: 20, near: [8, 0], min: 10, max: 30 },
    };
  },
  shots: {
    // The sergeant and the private crouched behind the sandbags, the burning town beyond; he turns to
    // the kid (third person, low behind them, a slow push).
    S1: {
      setup(d) {
        d.mood('dusk');
        d.g.weapons.setLoadout(['ar4'], true);
        const c = d.cast;
        // The sandbags at 10.6, -2.1 (facing east) go up first.
        const bags = d.g.fort.slots.find((x) => x.kind === 'sandbag' && Math.hypot(x.pos.x - 10.6, x.pos.z + 2.1) < 1);
        if (bags && !bags.built) d.g.fort.complete(bags);
        const st = d.at(9.5, -1.9);
        d.pose(c.sarge, { pos: st, yaw: -Math.PI / 2, aimPitch: 0.05, crouch: true, god: true });
        d.pose(c.mate1, { pos: d.at(9.5, -0.5), yaw: -Math.PI / 2 + 0.1, aimPitch: -0.1, crouch: true, god: true });
        d.pose(c.mate2, { pos: d.at(8.9, -4.4), yaw: -Math.PI / 2 - 0.2, aimPitch: 0.02, crouch: true, god: true });
        d.battle({ ...d.front, friends: [[9.8, 2.6, -Math.PI / 2, 1]] });
        d.put(-2, 4, 2, 90, 0);
        d.warm(3);
        const y = st.y;
        d.cam((t, cam) => {
          const k = t / 4.6;
          d.place(cam, d.v(5.6 + k * 0.9, y + 1.25, -0.4 - k * 0.1), d.v(30, y + 1.1, -2.6), 44, 0.02);
        });
      },
      frame(d, i) {
        const k = d.smooth((i - 62) / 22);
        d.pose(d.cast.sarge, { yaw: -Math.PI / 2 + k * 2.2, aimYaw: -Math.PI / 2 + k * 2.2, aimPitch: 0.05 - 0.2 * k });
        d.battleTick(i);
      },
    },
    // Sub boom 1: from the private's place, over the sandbags, the far side goes up.
    S2: {
      setup(d) {
        d.mood('dusk');
        d.g.weapons.setLoadout(['ar4'], true);
        const bags = d.g.fort.slots.find((x) => x.kind === 'sandbag' && Math.hypot(x.pos.x - 10.6, x.pos.z + 2.1) < 1);
        if (bags && !bags.built) d.g.fort.complete(bags);
        d.pose(d.cast.sarge, { pos: d.at(9.4, -3.8), yaw: -Math.PI / 2, crouch: true, god: true });
        d.battle({ ...d.front, shells: null });
        d.put(8.4, 4, -0.4, 92, 3);
        d.input.crouchToggle = true;
        d.warm(1);
        d.blast('howitzer', d.at(38, -4));
        d.blast('artillery', d.at(44, 4));
      },
      frame(d, i) {
        d.battleTick(i);
      },
    },
    // Sub boom 2: one lands just past the sandbags; the private ducks.
    S3: {
      setup(d) {
        d.mood('dusk');
        d.g.weapons.setLoadout(['ar4'], true);
        const bags = d.g.fort.slots.find((x) => x.kind === 'sandbag' && Math.hypot(x.pos.x - 10.6, x.pos.z + 2.1) < 1);
        if (bags && !bags.built) d.g.fort.complete(bags);
        d.pose(d.cast.sarge, { pos: d.at(9.4, -3.8), yaw: -Math.PI / 2, crouch: true, god: true });
        d.battle({ ...d.front, shells: null });
        d.put(8.4, 4, -0.4, 95, 4);
        d.input.crouchToggle = true;
        d.warm(1);
        d.blast('howitzer', d.at(19, 1.5));
      },
      frame(d, i) {
        d.input.pitch += i < 14 ? -0.022 : 0.004;
        d.battleTick(i);
      },
    },
    // At the town hall: dry, an empty reload, the squad stacked at the door, smoke drifting by.
    S4: {
      setup(d) {
        d.mood('dusk');
        d.g.weapons.setLoadout(['ar4'], true);
        d.pose(d.cast.sarge, { pos: d.at(-1.6, -19.5), yaw: 0, crouch: true, god: true });
        d.pose(d.cast.mate1, { pos: d.at(0.6, -19.3), yaw: 0.3, crouch: true, god: true });
        d.smoke(d.at(-6, -14), 30, 5);
        d.smoke(d.at(8, -12), 30, 6);
        d.battle({ smoke: [[-10, -40, 9], [20, -40, 10]], shells: { every: 30, near: [0, -50], min: 6, max: 20 } });
        d.put(-3.4, 3, -17.4, 32, -6);
        d.ammo(0);
        d.warm(1.5);
      },
      frame(d, i) {
        if (i === 4) d.input.reload = true;
        d.input.yaw += i < 40 ? 0.0012 : -0.0006;
        d.battleTick(i);
      },
    },
    // 3-2-1: the sergeant at the door looks back at the private, then turns in.
    S5: {
      setup(d) {
        d.mood('dusk');
        d.g.weapons.setLoadout(['ar4'], true);
        d.pose(d.cast.sarge, { pos: d.at(-1.7, -19.6), yaw: 0, crouch: true, god: true });
        d.pose(d.cast.mate1, { pos: d.at(0.3, -19.0), yaw: 0.3, crouch: true, god: true });
        d.pose(d.cast.mate2, { pos: d.at(-4.4, -18.1), yaw: -0.4, crouch: true, god: true });
        d.smoke(d.at(-7, -13), 30, 5);
        d.battle({ smoke: [[-10, -40, 9], [20, -40, 10]], shells: { every: 34, near: [0, -50], min: 6, max: 20 } });
        d.put(-3.3, 3, -17.0, 28, -10);
        d.input.crouchToggle = true;
        d.warm(1.5);
      },
      frame(d, i) {
        const back = i < 52 ? d.smooth(i / 10) : 1 - d.smooth((i - 52) / 12);
        d.pose(d.cast.sarge, { yaw: back * 2.5, aimYaw: back * 2.5 });
        d.battleTick(i);
      },
    },
    // Through the door: three enemies inside firing back, the private and the sergeant put them down.
    S6: {
      setup(d) {
        d.mood('dusk');
        d.g.weapons.setLoadout(['ar4'], true);
        const red = d.team('red');
        d.s = { e1: red[0], e2: red[1], e3: red[2] };
        d.pose(d.s.e1, { pos: d.at(-3.6, -25.5, 4), yaw: Math.PI * 0.9 });
        d.pose(d.s.e2, { pos: d.at(1.8, -27.5, 4), yaw: Math.PI * 1.08, crouch: true });
        d.pose(d.s.e3, { pos: d.at(-0.5, -31, 4), yaw: Math.PI });
        d.pose(d.cast.sarge, { pos: d.at(0.4, -18.6), yaw: 0, god: true });
        // Inside the hall the low sun leaves it near black: more exposure for this one.
        d.g.renderer.gl.toneMappingExposure = 0.9;
        d.put(-1.5, 3, -18.2, 0, 0);
        d.warm(0.2);
      },
      frame(d, i) {
        const { e1, e2, e3 } = d.s;
        d.input.moveY = i < 22 ? 1 : 0.2;
        const t1 = e1.feet.clone().setY(e1.feet.y + 1.3);
        const t2 = e2.feet.clone().setY(e2.feet.y + 0.9);
        if (i >= 8 && i < 34) d.lookAt(t1, 0.14);
        if (i >= 34) d.lookAt(t2, 0.16);
        d.input.fire = (i >= 14 && i < 26) || (i >= 42 && i < 54);
        if (i % 4 === 0 && e2.alive) d.fire(e2, d.g.player.feet.clone().setY(d.g.player.feet.y + 1.4), 0.08);
        if (i % 5 === 0 && e3.alive) d.fire(e3, d.g.player.feet.clone().setY(d.g.player.feet.y + 1.4), 0.1);
        if (i === 22) d.down(e1, d.g.player.feet);
        if (i === 50) d.down(e2, d.g.player.feet);
        if (i === 30) d.pose(d.cast.sarge, { pos: d.at(1.8, -23.5, 4), yaw: -0.2 });
        if (i > 30 && i % 3 === 0 && e3.alive) d.fire(d.cast.sarge, e3.feet.clone().setY(e3.feet.y + 1.3), 0.03);
        if (i === 60) d.down(e3, d.cast.sarge.feet);
      },
    },
    // A shell right beside the private, the square burning beyond.
    S41: {
      setup(d) {
        d.mood('dusk');
        d.g.weapons.setLoadout(['ar4'], true);
        d.battle({ ...d.square, shells: null });
        d.put(-30, 3, 0.5, 88, 2);
        d.warm(2);
        d.blast('howitzer', d.at(-24.5, -3.2));
      },
      frame(d, i) {
        d.battleTick(i);
      },
    },
    // "…Now.": up from cover and into the square, the squad running beside, the fight ahead.
    S43: {
      setup(d) {
        d.mood('dusk');
        d.g.weapons.setLoadout(['ar4'], true);
        d.battle(d.square);
        d.put(-34, 3, 0, 90, 4);
        d.input.crouchToggle = true;
        d.warm(2);
        d.s = { x: -35 };
      },
      frame(d, i) {
        if (i === 2) d.input.crouchToggle = true;
        d.input.moveY = i >= 3 ? 1 : 0;
        d.input.sprint = i >= 3;
        d.input.yaw += Math.sin(i * 0.2) * 0.002;
        const s = d.s;
        s.x += i >= 5 ? 0.19 : 0;
        d.pose(d.cast.mate1, { pos: d.at(s.x + 1.5, -2.6), yaw: -Math.PI / 2, god: true });
        d.pose(d.cast.mate2, { pos: d.at(s.x - 1, 2.8), yaw: -Math.PI / 2, god: true });
        d.pose(d.cast.sarge, { pos: d.at(s.x - 4, -0.8), yaw: -Math.PI / 2, god: true });
        if (i % 7 === 0) d.fire(d.cast.mate1, d.v(16, 4.5, -4), 0.04);
        d.battleTick(i);
      },
    },
    // Over the rubble, a look back: the squad is coming through the smoke.
    S44: {
      setup(d) {
        d.mood('dusk');
        d.g.weapons.setLoadout(['ar4'], true);
        d.battle(d.square);
        d.put(-22, 3, 0, 90, 0);
        d.warm(2);
        d.s = { x: -30 };
      },
      frame(d, i) {
        if (i === 4) d.input.jump = true;
        d.input.moveY = i < 14 ? 1 : 0;
        if (i > 14) d.input.yaw += i < 30 ? 0.19 : 0;
        const s = d.s;
        s.x += 0.17;
        d.pose(d.cast.mate1, { pos: d.at(s.x, -1.6), yaw: -Math.PI / 2, god: true });
        d.pose(d.cast.mate2, { pos: d.at(s.x - 2.4, 1.8), yaw: -Math.PI / 2, god: true });
        d.pose(d.cast.sarge, { pos: d.at(s.x - 4.6, -0.3), yaw: -Math.PI / 2, god: true });
        d.battleTick(i);
      },
    },
    // Round the corner: an enemy right there, more behind.
    S45: {
      setup(d) {
        d.mood('dusk');
        d.g.weapons.setLoadout(['ar4'], true);
        const red = d.team('red');
        d.s = { e: red[2], f: red[3] };
        d.pose(red[2], { pos: d.at(-5.5, 11.2), yaw: Math.PI / 2 + 0.3 });
        d.pose(red[3], { pos: d.at(1.5, 13.5), yaw: Math.PI / 2 + 0.2, crouch: true });
        d.battle(d.square);
        d.put(-13, 3, 9, 90, 0);
        d.warm(2);
      },
      frame(d, i) {
        const { e, f } = d.s;
        d.input.moveY = i < 10 ? 0.8 : 0;
        const t = e.alive ? e : f;
        d.lookAt(t.feet.clone().setY(t.feet.y + (t.crouching ? 0.9 : 1.3)), 0.16);
        d.input.fire = (i >= 12 && i < 22) || (i >= 34 && i < 44);
        if (e.alive && i % 3 === 0) d.fire(e, d.g.player.feet.clone().setY(d.g.player.feet.y + 1.5), 0.08);
        if (f.alive && i % 4 === 1) d.fire(f, d.g.player.feet.clone().setY(d.g.player.feet.y + 1.5), 0.1);
        if (i === 20) d.down(e, d.g.player.feet);
        if (i === 42) d.down(f, d.g.player.feet);
        d.battleTick(i);
      },
    },
    // A friendly tank rolls into the street beside the squad (third person, low at the kerb).
    S46: {
      setup(d) {
        d.mood('dusk');
        d.battle(d.square);
        const y = d.ground(-34, 0);
        const tank = d.vehicle('tank', d.v(-34, y, -0.5), -Math.PI / 2, 'blue');
        d.s = { tank, x: -34, y };
        const c = d.cast;
        d.pose(c.sarge, { pos: d.at(-24, 3.4), yaw: -Math.PI / 2, crouch: true, god: true });
        d.pose(c.mate1, { pos: d.at(-26.5, 3.6), yaw: -Math.PI / 2, crouch: true, god: true });
        d.put(-40, 3, -6, 90, 0);
        d.warm(2);
        d.cam((t, cam) => d.place(cam, d.v(-19 - t * 0.5, y + 0.7, 5.2), d.v(-30 + t * 3, y + 1.6, -0.4), 44));
      },
      frame(d, i) {
        const s = d.s;
        s.x += 0.16;
        d.drive(s.tank, d.v(s.x, s.y, -0.5), -Math.PI / 2, 0, 0, d.v(4.8, 0, 0));
        if (i % 6 === 0) d.fire(d.cast.sarge, d.v(16, 4.5, 2), 0.04);
        d.battleTick(i);
      },
    },
    // "MG nest, dead ahead!": its gunners hosing the street; the tank beside the private fires, the nest goes up.
    S47: {
      setup(d) {
        d.mood('dusk');
        d.g.weapons.setLoadout(['ar4'], true);
        const nest = d.g.fort.slots.find((s) => s.kind === 'nest' && Math.hypot(s.pos.x - 16.1, s.pos.z + 6.2) < 1);
        if (nest && !nest.built) d.g.fort.complete(nest);
        const red = d.team('red');
        d.s = { gunners: [red[4], red[5]], nest: d.v(16.1, 3.1, -6.2) };
        d.pose(red[4], { pos: d.at(15.2, -6.8), yaw: Math.PI / 2, crouch: true });
        d.pose(red[5], { pos: d.at(15.4, -5.2), yaw: Math.PI / 2 });
        d.battle(d.square);
        const y = d.ground(-24.5, -3);
        d.s.tank = d.vehicle('tank', d.v(-25, y, -3.2), -Math.PI / 2, 'blue');
        d.pose(d.cast.mate1, { pos: d.at(-20, 2.8), yaw: -Math.PI / 2, crouch: true, god: true });
        d.put(-21.5, 3, 1.6, 98, 1);
        d.warm(1.5);
      },
      frame(d, i) {
        const s = d.s;
        if (i < 34) d.lookAt(s.nest.clone().setY(s.nest.y + 1), 0.08);
        for (const [k, gun] of s.gunners.entries()) if (gun.alive && (i + k) % 2 === 0) d.fire(gun, d.v(-21 + Math.sin(i * 0.3) * 4, 4.4, 1.5 + Math.cos(i * 0.4) * 3), 0.05);
        if (i === 30) {
          d.mountFire(s.tank, 0, s.nest.clone().setY(s.nest.y + 0.8), 'blue');
          d.muzzleBlast(s.tank, 0, s.nest, 6);
        }
        if (i === 34) {
          d.blast('shell', s.nest.clone().setY(s.nest.y + 0.5), 'blue');
          d.blast('artillery', s.nest.clone().setY(s.nest.y + 0.3), 'blue');
          s.gunners.forEach((b) => d.down(b, s.tank.model.root.position));
        }
        if (i % 6 === 2) d.fire(d.cast.mate1, s.nest.clone().setY(s.nest.y + 1.2), 0.04);
        d.battleTick(i);
      },
    },
    // Looking up: two of our fighters low over the rooftops, their rockets landing beyond.
    S48: {
      setup(d) {
        d.mood('dusk');
        d.g.weapons.setLoadout(['ar4'], true);
        d.battle({ ...d.square, shells: null });
        d.put(-6, 4, 6, 90, 40);
        d.warm(1);
        const a = d.vehicle('cas', d.v(-160, 44, -4), -Math.PI / 2, 'blue');
        const b = d.vehicle('fighter', d.v(-180, 50, 10), -Math.PI / 2, 'blue');
        d.s = { a, b, x: -160 };
      },
      frame(d, i) {
        const s = d.s;
        s.x += 6.2;
        d.drive(s.a, d.v(s.x, 44, -4), -Math.PI / 2, 0, 0.15, d.v(186, 0, 0));
        d.drive(s.b, d.v(s.x - 20, 50, 10), -Math.PI / 2, 0, 0.1, d.v(186, 0, 0));
        d.face(d.v(s.x - 10, 40 - Math.max(0, i - 18) * 1.4, 2));
        if (i === 20 || i === 24 || i === 28) d.blast('rocket', d.at(30 + (i - 20) * 2, -4 + (i % 8)), 'blue');
        d.battleTick(i);
      },
    },
    // The square's steps, one cut per kick: shoot, reload, butt-stroke, throw, all in the thick of it.
    S49: {
      setup(d) {
        d.mood('dusk');
        d.g.weapons.setLoadout(['ar4'], true);
        const red = d.team('red');
        d.s = { e: red.slice(-4) };
        d.s.e.forEach((b, k) => d.pose(b, { pos: d.at(-3 + k * 2.5, -5 + k * 3), yaw: Math.PI / 2 }));
        d.battle({ ...d.square, foes: d.square.foes.slice(0, 3) });
        d.put(-9, 3, -4, 70, 0);
        d.warm(1.5);
      },
      frame(d, i) {
        const e = d.s.e;
        if (i === 0) d.input.fire = true;
        if (i === 10) d.down(e[0], d.g.player.feet);
        if (i === 22) {
          d.input.fire = false;
          d.ammo(0);
          d.input.reload = true;
        }
        if (i === 41) {
          d.put(-5, 3, -3, 80, 0);
          d.pose(e[1], { pos: d.at(-3.6, -2.5), yaw: Math.PI / 2 });
          d.input.melee = true;
        }
        if (i === 47) d.down(e[1], d.g.player.feet);
        if (i === 59) {
          d.put(-6, 3, 2, 60, 6);
          d.input.throwGrenade = true;
        }
        if (i === 92) d.blast('frag', d.at(4, -1), 'blue');
        for (const x of e) if (x.alive && (i + x.id) % 5 === 0) d.fire(x, d.g.player.feet.clone().setY(d.g.player.feet.y + 1.4), 0.1);
        const t = e[Math.min(e.length - 1, Math.floor(i / 20))];
        d.lookAt(t.feet.clone().setY(t.feet.y + 1.2), 0.08);
        d.battleTick(i);
      },
    },
    // The flag goes up: a low camera under the pole, the squad running past it through the smoke.
    S50: {
      setup(d) {
        d.mood('dusk');
        d.battle({ ...d.square, foes: [], shells: { every: 14, near: [30, 0], min: 4, max: 14 } });
        const z = d.g.zoneMode.zones.find((x) => x.id === 'B');
        z.owner = null;
        z.control = 0.2;
        const m = d.g.zoneVisuals.markers.find((x) => x.zone.id === 'B');
        const base = m.flag.userData.base;
        const eye = d.ground(4.6, 5.4) + 1.1;
        d.s = { z, base, xs: [-3, -5.5, -8] };
        d.put(-14, 4, 8, 90, 0);
        d.warm(2);
        d.cam((t, cam) => {
          const k = t / 1.4;
          d.place(cam, d.v(4.6 - k * 0.8, eye + k * 0.3, 5.4 - k * 0.6), d.v(0, base + 3.6 + k * 0.9, 0), 46, -0.06);
        });
      },
      frame(d, i) {
        const s = d.s;
        s.z.control = Math.min(1, 0.2 + i * 0.024);
        if (s.z.control >= 1) s.z.owner = 'blue';
        const c = [d.cast.sarge, d.cast.mate1, d.cast.mate2];
        c.forEach((b, k) => {
          s.xs[k] += 0.2;
          d.pose(b, { pos: d.at(s.xs[k], 2.6 + k * 1.1), yaw: -Math.PI / 2, god: true });
        });
        d.battleTick(i);
      },
    },
    // They fall back; one last round; a squad mate throws his rifle up.
    S51: {
      setup(d) {
        d.mood('dusk');
        d.g.weapons.setLoadout(['ar4'], true);
        const red = d.team('red').slice(0, 3);
        d.s = { red, xs: [14, 17, 20] };
        d.pose(d.cast.mate1, { pos: d.at(-3.5, 6.5), yaw: -Math.PI / 2, god: true });
        d.battle({ ...d.square, foes: [], shells: { every: 30, near: [40, 0], min: 4, max: 16 } });
        d.put(-6, 4, 3, 95, 2);
        d.warm(1.5);
      },
      frame(d, i) {
        const s = d.s;
        s.red.forEach((b, k) => {
          s.xs[k] += 0.16;
          d.pose(b, { pos: d.at(s.xs[k], -4 + k * 4), yaw: -Math.PI / 2 - 0.2 });
        });
        d.input.fire = i >= 30 && i < 34;
        if (i === 33) d.down(s.red[0], d.g.player.feet);
        if (i >= 60) d.pose(d.cast.mate1, { aimPitch: Math.min(1.3, (i - 60) * 0.06) });
        d.battleTick(i);
      },
    },
    // The squad comes together in the middle of the square, smoke still rising behind.
    S52: {
      setup(d) {
        d.mood('dusk');
        d.g.weapons.setLoadout(['ar4'], true);
        const c = d.cast;
        d.pose(c.sarge, { pos: d.at(-6.5, 1.5), yaw: 2.2, god: true });
        d.pose(c.mate1, { pos: d.at(-5.2, 4), yaw: 2.6, god: true });
        d.pose(c.mate2, { pos: d.at(-5.6, -1), yaw: 1.9, god: true });
        d.battle({ smoke: d.square.smoke, wrecks: d.square.wrecks });
        d.put(-11, 4, 2, 85, -4);
        d.warm(1.5);
      },
    },
    // Slow motion on the tower roof (y 15, x 26-36): the sergeant and the private at the west edge, the
    // smoking square below; the camera behind them pushes in.
    S53: {
      setup(d) {
        d.mood('dusk');
        const c = d.cast;
        // No wrecks: the one at 20, 11 burns right in the camera's line.
        d.battle({ smoke: d.square.smoke.filter(([x, z]) => Math.hypot(x - 31, z - 10) > 12) });
        d.put(34, 20, 10, 270, 0);
        d.warm(2);
        d.pose(c.sarge, { pos: d.at(27.2, 9.3, 20), yaw: Math.PI / 2 + 0.08, aimPitch: -0.2, god: true });
        d.pose(c.mate1, { pos: d.at(27.4, 10.9, 20), yaw: Math.PI / 2 - 0.05, aimPitch: -0.3, god: true });
        const y = d.ground(30, 10, 20);
        d.cam((t, cam) => {
          const k = t / 3.6;
          d.place(cam, d.v(31.6 - k * 1.2, y + 1.9 - k * 0.2, 10.6 - k * 0.2), d.v(8, y - 7, 9.6), 46);
        });
      },
      sim: 1 / 60,
      frame(d, i) {
        const k = d.smooth((i - 50) / 30);
        d.pose(d.cast.sarge, { yaw: Math.PI / 2 + 0.08 - 0.9 * k, aimYaw: Math.PI / 2 + 0.08 - 0.9 * k });
      },
    },
  },
};
