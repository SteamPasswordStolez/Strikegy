// Iron Gate shots before S55 (docs/design/trailer.md §4; film.mjs runs them). Every function runs in the
// game page with the director `d` (director.js) and may use nothing from this module. Places:
// apartment north room (-1, 9.6, 21-25), town hall north wall z -20.5 with doors at x ±1.5 (floor
// 2.0 outside), tower east windows x 36.2 (floor 9.1), B square (0, 3.1, 0), its west street x -36..-24.
export default {
  query: 'map=iron_gate&bots=12v12&at=-30,0,90',
  setup(d) {
    d.deploy();
    d.warm(3);
    // One blue soldier plays the sergeant in every shot, two more his squad.
    const blue = d.bots('blue');
    d.cast = { sarge: blue[0], mate1: blue[1], mate2: blue[2] };
  },
  shots: {
    // The apartment, third floor: the sergeant at the window, looking out, turns to the private.
    S1: {
      setup(d) {
        d.cam(null);
        d.put(-1.1, 9.7, 25.2, 0, -3);
        const c = d.cast;
        d.s = { sp: d.at(-1.1, 21.2, 11) };
        d.pose(c.sarge, { pos: d.s.sp, yaw: 0, god: true });
        d.pose(c.mate1, { pos: d.at(-4.2, 22.4, 11), yaw: 0.6, crouch: true, god: true });
      },
      frame(d, i) {
        const k = d.smooth((i - 52) / 28);
        d.pose(d.cast.sarge, { yaw: k * Math.PI * 0.96, aimYaw: k * Math.PI * 0.96, aimPitch: -0.1 * k });
        d.input.moveY = i < 60 ? 0.12 : 0;
        d.input.pitch += -0.0004;
      },
    },
    // Sub boom 1: a flash and a fireball through the window, out toward the hospital.
    S2: {
      setup(d) {
        d.cam(null);
        d.put(-1.1, 9.7, 24.2, 2, 2);
        d.pose(d.cast.sarge, { pos: d.at(-1.6, 21.3, 11), yaw: 0.2, god: true });
        d.blast('howitzer', d.at(4, -24));
        d.blast('artillery', d.at(-2, -20));
      },
    },
    // Sub boom 2: nearer, the room shakes, the view drops to the gun.
    S3: {
      setup(d) {
        d.cam(null);
        d.put(-1.1, 9.7, 24.2, 2, 0);
        d.pose(d.cast.sarge, { pos: d.at(-1.6, 21.3, 11), yaw: 0.2, crouch: true, god: true });
        d.blast('howitzer', d.at(1, 4));
      },
      frame(d) {
        d.input.pitch += -0.012;
      },
    },
    // At the town hall: the magazine runs dry, an empty reload (the magazine drops, the bolt catch).
    S4: {
      setup(d) {
        d.cam(null);
        d.put(-3.4, 3, -17.6, 40, -4);
        d.pose(d.cast.sarge, { pos: d.at(-1.6, -19.4), yaw: 0, crouch: true, god: true });
        d.ammo(0);
      },
      frame(d, i) {
        if (i === 6) d.input.reload = true;
        d.input.yaw += i < 50 ? 0.001 : 0;
      },
    },
    // 3-2-1: the sergeant at the door looks back at the private, then turns to the door.
    S5: {
      setup(d) {
        d.cam(null);
        d.put(-3.6, 3, -17.2, 32, -10);
        d.input.crouchToggle = true;
        d.pose(d.cast.sarge, { pos: d.at(-1.7, -19.6), yaw: 0, crouch: true, god: true });
        d.pose(d.cast.mate1, { pos: d.at(-0.2, -18.9), yaw: 0.3, crouch: true, god: true });
      },
      frame(d, i) {
        const back = i < 52 ? d.smooth(i / 10) : 1 - d.smooth((i - 52) / 12);
        d.pose(d.cast.sarge, { yaw: back * 2.5, aimYaw: back * 2.5 });
      },
    },
    // Through the door: two enemies inside, both go down.
    S6: {
      setup(d) {
        d.cam(null);
        d.put(-1.5, 3, -18.4, 0, 0);
        const red = d.team('red');
        d.s = { e1: red[0], e2: red[1] };
        d.pose(d.s.e1, { pos: d.at(-4.5, -29, 4), yaw: Math.PI * 0.85 });
        d.pose(d.s.e2, { pos: d.at(2.5, -33, 4), yaw: Math.PI * 1.1, crouch: true });
        d.pose(d.cast.sarge, { pos: d.at(0.4, -18.6), yaw: 0, god: true });
      },
      frame(d, i) {
        const { e1, e2 } = d.s;
        d.input.moveY = i < 26 ? 1 : 0.15;
        const t1 = e1.feet.clone().setY(e1.feet.y + 1.3);
        const t2 = e2.feet.clone().setY(e2.feet.y + 0.9);
        if (i >= 10 && i < 40) d.lookAt(t1, 0.12);
        if (i >= 40) d.lookAt(t2, 0.14);
        d.input.fire = (i >= 18 && i < 30) || (i >= 52 && i < 62);
        if (i === 27) d.down(e1, d.g.player.feet);
        if (i === 60) d.down(e2, d.g.player.feet);
        if (i === 30) d.pose(d.cast.sarge, { pos: d.at(-0.6, -23, 4), yaw: 0.3 });
      },
    },
    // The sergeant on the radio, crouched by the tower window.
    S14: {
      setup(d) {
        d.cam(null);
        d.input.crouchToggle = true;
        d.put(33.2, 9.1, 12.6, 120, -12);
        d.pose(d.cast.sarge, { pos: d.at(35.4, 10.2, 10), yaw: Math.PI * 0.25, aimPitch: -0.5, crouch: true, god: true });
        d.step();
        d.face(d.at(35.4, 10.2, 10).setY(9.07 + 0.9));
      },
      frame(d) {
        d.input.yaw += 0.0015;
      },
    },
    // The tower's east window: looking out over the town toward C as the fire mission goes in.
    S15: {
      setup(d) {
        d.cam(null);
        d.put(35.5, 9.1, 11.75, 92, -6);
      },
      frame(d, i) {
        d.input.yaw += 0.0012;
        d.input.pitch += i < 10 ? -0.002 : 0;
      },
    },
    // The heaviest hit: shells walk in toward the window, each nearer than the last.
    S16: {
      setup(d) {
        d.cam(null);
        d.put(35.5, 9.1, 11.75, 94, -8);
        d.s = {
          hits: [
            [0, 74, 2, 'howitzer'],
            [0, 78, 14, 'artillery'],
            [14, 68, 18, 'artillery'],
            [26, 63, 6, 'howitzer'],
            [40, 58, 15, 'artillery'],
            [55, 53, 9, 'howitzer'],
            [70, 49, 16, 'artillery'],
            [84, 46, 6, 'howitzer'],
            [98, 43, 12, 'howitzer'],
          ],
        };
      },
      frame(d, i) {
        for (const [f, x, z, k] of d.s.hits) if (f === i) d.blast(k, d.at(x, z));
        d.input.yaw += -0.0008;
      },
    },
    // Build mode on the square: sandbags go up (time runs fast so they rise within the shot).
    S17: {
      setup(d) {
        d.cam(null);
        const slot = d.spot(d.v(8, 3, 4), 'sandbag') ?? d.spot(d.v(8, 3, 4));
        d.s = { slot };
        d.put(slot.stand.x, slot.stand.y + 1, slot.stand.z, 0, 0);
        d.face(slot.pos.clone().setY(slot.pos.y + 0.3));
        d.noBlueprints();
        d.input.buildMode = true;
        d.warm(0.6);
      },
      sim: 0.2,
      frame(d) {
        d.input.fire = true;
        d.face(d.s.slot.pos.clone().setY(d.s.slot.pos.y + 0.3));
      },
    },
    // Slow motion: the sergeant beside the private is hit and falls; the private runs to him.
    S20: {
      setup(d) {
        d.cam(null);
        d.put(-24, 3, -1.5, 90, -2);
        d.s = { sp: d.at(-20.5, 1.2) };
        d.pose(d.cast.sarge, { pos: d.s.sp, yaw: -Math.PI / 2 });
        d.pose(d.cast.mate1, { pos: d.at(-22, 4), yaw: -Math.PI / 2, crouch: true, god: true });
      },
      sim: 1 / 60,
      frame(d, i) {
        const sp = d.s.sp;
        if (i < 14) d.pose(d.cast.sarge, { pos: d.at(-20.5 + i * 0.07, 1.2), yaw: -Math.PI / 2 });
        if (i === 14) d.down(d.cast.sarge, d.v(10, 4, 3));
        if (i >= 18) {
          d.input.moveY = i < 50 ? 1 : 0;
          d.input.sprint = i < 50;
          d.lookAt(sp.clone().setY(sp.y + 0.2), 0.06);
        }
        if (i > 50) d.input.interact = true;
      },
    },
    // A panzerfaust into an APC coming up the street.
    S21: {
      setup(d) {
        d.cam(null);
        d.put(-30, 3, 1, 88, 0);
        // The street's height first: a ray from above would land on the APC's own roof once it is there.
        const y = d.ground(-12, 2.5);
        const apc = d.vehicle('apc', d.v(-12, y, 2.5), Math.PI / 2, 'red');
        apc.health = 60;
        d.s = { apc, x: -12, y };
        d.input.gadget = true;
        d.warm(0.9);
      },
      frame(d, i) {
        const s = d.s;
        if (!s.apc.wrecked) {
          s.x -= 0.12;
          d.drive(s.apc, d.v(s.x, s.y, 2.5), Math.PI / 2);
        }
        d.face(d.v(s.x, s.y + 1.4, 2.5));
        d.input.fire = i >= 10 && i < 14;
        // The rocket's flight is ~0.3 s: the hull goes up then whatever the round did.
        if (i === 20 && !s.apc.wrecked) {
          s.apc.health = 1;
          d.blast('rocket', d.v(s.x + 1.5, s.y + 1.2, 2.5), 'blue');
        }
      },
    },
    // The fill: every hit a different gun, firing (switched between frames off camera).
    S22: {
      setup(d) {
        d.cam(null);
        d.put(-26, 3, 0, 90, 0);
        d.s = { cuts: [0, 9, 17, 24, 35, 46, 57, 68, 77], guns: ['sr1', 'lmg1', 'sg1', 'ar2', 'pistol1', 'frag', 'smg1', 'dmr1', 'ar1'] };
        const red = d.team('red');
        d.s.targets = red.slice(0, 4);
        red.slice(0, 4).forEach((b, k) => d.pose(b, { pos: d.at(-2 + k * 3, -6 + k * 4), yaw: Math.PI / 2 }));
      },
      frame(d, i) {
        const s = d.s;
        const c = s.cuts.indexOf(i);
        if (c >= 0) {
          const gun = s.guns[c];
          if (gun === 'frag') d.input.throwGrenade = true;
          else {
            d.g.weapons.setLoadout([gun], true);
            d.warm(0.8);
          }
          d.put(-26 + c * 0.4, 3, (c % 3) - 1, 80 + (c % 4) * 6, (c % 2) * 2);
        }
        d.input.fire = s.guns[s.cuts.filter((x) => x <= i).length - 1] !== 'frag';
        d.input.ads = i >= 46;
      },
    },
    // In the smoke: the sergeant, back on his feet, hands the radio over (face to face, close).
    S23: {
      setup(d) {
        d.cam(null);
        d.put(-22, 3, 2.5, 120, -8);
        d.input.crouchToggle = true;
        const sarge = d.cast.sarge;
        if (!sarge.alive) sarge.spawn(d.at(-20.8, 1.6), -Math.PI / 2, sarge.def);
        d.pose(sarge, { pos: d.at(-20.6, 1.4), yaw: Math.PI * 0.35, aimPitch: -0.3, crouch: true, god: true });
        d.smoke(d.at(-17, 0), 6, 7);
        d.smoke(d.at(-14, 4), 6, 6);
        d.warm(2);
        d.face(d.at(-20.6, 1.4).setY(d.ground(-20.6, 1.4) + 0.9));
      },
      frame(d, i) {
        d.input.pitch += i < 40 ? -0.002 : 0.001;
      },
    },
    // A shell right beside the private.
    S41: {
      setup(d) {
        d.cam(null);
        d.put(-30, 3, 0.5, 88, 2);
        d.blast('howitzer', d.at(-24, -3.5));
      },
    },
    // "…Now.": up from cover and into the street, the squad behind.
    S43: {
      setup(d) {
        d.cam(null);
        d.warm(5);
        d.put(-34, 3, 0, 90, 4);
        d.input.crouchToggle = true;
        d.warm(0.4);
        d.s = { x: -35.5 };
      },
      frame(d, i) {
        if (i === 2) d.input.crouchToggle = true;
        d.input.moveY = i >= 3 ? 1 : 0;
        d.input.sprint = i >= 3;
        d.input.yaw += Math.sin(i * 0.2) * 0.002;
        const s = d.s;
        s.x += i >= 6 ? 0.18 : 0;
        d.pose(d.cast.mate1, { pos: d.at(s.x - 3, -1.8), yaw: -Math.PI / 2, god: true });
        d.pose(d.cast.mate2, { pos: d.at(s.x - 5.5, 1.6), yaw: -Math.PI / 2, god: true });
      },
    },
    // Over the rubble, a look back: the squad is coming.
    S44: {
      setup(d) {
        d.cam(null);
        d.put(-22, 3, 0, 90, 0);
        d.s = { x: -29 };
      },
      frame(d, i) {
        if (i === 4) d.input.jump = true;
        d.input.moveY = i < 16 ? 1 : 0;
        if (i > 14) d.input.yaw += i < 30 ? 0.19 : 0;
        const s = d.s;
        s.x += 0.17;
        d.pose(d.cast.mate1, { pos: d.at(s.x, -1.5), yaw: -Math.PI / 2, god: true });
        d.pose(d.cast.mate2, { pos: d.at(s.x - 2.5, 1.8), yaw: -Math.PI / 2, god: true });
        d.pose(d.cast.sarge, { pos: d.at(s.x - 4.5, -0.4), yaw: -Math.PI / 2, god: true });
      },
    },
    // Round the corner: an enemy right there.
    S45: {
      setup(d) {
        d.cam(null);
        d.put(-12, 3, 9, 90, 0);
        const e = d.team('red')[2];
        d.s = { e };
        d.pose(e, { pos: d.at(-4.5, 11.5), yaw: Math.PI / 2 + 0.3 });
      },
      frame(d, i) {
        const e = d.s.e;
        d.input.moveY = i < 12 ? 0.8 : 0;
        d.lookAt(e.feet.clone().setY(e.feet.y + 1.3), 0.15);
        d.input.fire = i >= 14 && i < 26;
        if (i === 24) d.down(e, d.g.player.feet);
      },
    },
    // On the square's steps: shoot, reload, butt-stroke, throw (one cut per kick).
    S49: {
      setup(d) {
        d.cam(null);
        d.put(-9, 3, -4, 70, 0);
        const red = d.team('red');
        d.s = { e: red.slice(-4) };
        d.s.e.forEach((b, k) => d.pose(b, { pos: d.at(-3 + k * 2.5, -5 + k * 3), yaw: Math.PI / 2 }));
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
        const t = e[Math.min(e.length - 1, Math.floor(i / 20))];
        d.lookAt(t.feet.clone().setY(t.feet.y + 1.2), 0.08);
      },
    },
    // The flag goes up on the square: a low camera under the pole as the zone falls to us.
    S50: {
      setup(d) {
        d.warm(4);
        const z = d.g.zoneMode.zones.find((x) => x.id === 'B');
        z.owner = null;
        z.control = 0.2;
        const m = d.g.zoneVisuals.markers.find((x) => x.zone.id === 'B');
        const base = m.flag.userData.base;
        const eye = d.ground(4.6, 5.4) + 1.1;
        d.s = { z, base };
        d.put(-8, 4, 6, 90, 0);
        d.cam((t, cam) => {
          const k = t / 1.4;
          d.place(cam, d.v(4.6 - k * 0.8, eye + k * 0.3, 5.4 - k * 0.6), d.v(0, base + 3.6 + k * 0.9, 0), 46, -0.06);
        });
      },
      frame(d, i) {
        const z = d.s.z;
        z.control = Math.min(1, 0.2 + i * 0.024);
        if (z.control >= 1) z.owner = 'blue';
      },
    },
    // They fall back; one last round; a squad mate throws his rifle up.
    S51: {
      setup(d) {
        d.cam(null);
        d.put(-6, 4, 3, 95, 2);
        const red = d.team('red').slice(0, 3);
        d.s = { red, xs: [14, 17, 20] };
        d.pose(d.cast.mate1, { pos: d.at(-3.5, 6.5), yaw: -Math.PI / 2, god: true });
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
      },
    },
    // The squad comes together in the middle of the square (off the fountain).
    S52: {
      setup(d) {
        d.cam(null);
        d.put(-11, 4, 2, 85, -4);
        const c = d.cast;
        d.pose(c.sarge, { pos: d.at(-6.5, 1.5), yaw: 2.2, god: true });
        d.pose(c.mate1, { pos: d.at(-5.2, 4), yaw: 2.6, god: true });
        d.pose(c.mate2, { pos: d.at(-5.6, -1), yaw: 1.9, god: true });
      },
    },
    // Slow motion on the tower roof (y 15, x 26-36): the sergeant and the private at the west edge, the
    // square below; the camera behind them pushes in (third person: the private is a posed soldier too).
    S53: {
      setup(d) {
        const c = d.cast;
        d.put(34, 20, 10, 270, 0);
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
        // The sergeant turns his head toward the private near the end.
        const k = d.smooth((i - 50) / 30);
        d.pose(d.cast.sarge, { yaw: Math.PI / 2 + 0.08 - 0.9 * k, aimYaw: Math.PI / 2 + 0.08 - 0.9 * k });
      },
    },
  },
};
