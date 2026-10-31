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
    // Behind the heavy MG on the square (the post at -16, 6 faces west, ±1 rad), sweeping down the street.
    S18: {
      setup(d) {
        const mg = d.vehicles('hmg', d.v(-16, 3, 6))[0];
        d.s = { mg };
        if (mg) d.seat(mg, 0);
        d.warm(0.3);
        d.face(d.v(-48, 3, 10));
      },
      frame(d, i) {
        d.input.fire = true;
        d.input.yaw += Math.sin(i * 0.15) * 0.004 - 0.002;
      },
    },
    // Tracers going up from the blue base's AA gun (third person, low beside the gun).
    S19: {
      setup(d) {
        const aa = d.vehicles('aagun', d.v(-119, 21, 21))[0];
        const p = aa.model.root.position.clone();
        d.s = { aa, p };
        d.seat(aa, 0);
        d.warm(0.3);
        d.cam((t, cam) => d.place(cam, d.v(p.x + 6 - t * 0.5, p.y + 1.5, p.z + 6), d.v(p.x - 9, p.y + 8 + t * 2, p.z - 11), 52, 0.04));
      },
      frame(d, i) {
        const p = d.s.p;
        d.face(d.v(p.x - 120 + i * 3, p.y + 120, p.z - 150));
        d.input.fire = true;
      },
    },
    // From the AA gun's seat: an enemy fighter crossing, hit, going down.
    S38: {
      setup(d) {
        const aa = d.vehicles('aagun', d.v(-119, 21, 21))[0];
        const p = aa.model.root.position.clone();
        d.seat(aa, 0);
        d.warm(0.3);
        const jet = d.vehicle('fighter', d.v(p.x + 260, p.y + 130, p.z - 260), Math.PI * 0.75, 'red');
        d.s = { aa, p, jet, x: p.x + 260, z: p.z - 260 };
      },
      frame(d, i) {
        const s = d.s;
        if (!s.jet.wrecked) {
          s.x -= 5.2;
          s.z += 3.4;
          d.drive(s.jet, d.v(s.x, s.p.y + 130, s.z), Math.atan2(5.2, -3.4), 0, -0.25, d.v(-156, 0, 102));
          d.face(d.v(s.x - 20, s.p.y + 130, s.z + 13));
        }
        d.input.fire = i > 6 && i < 52;
        if (i === 44) {
          d.blast('missile', s.jet.model.root.position.clone(), 'blue');
          d.wreck(s.jet);
        }
      },
    },
    // The canal bridge: a grenade over, then into them.
    S39: {
      setup(d) {
        d.put(31, 3, -5, 90, 2);
        const red = d.team('red').slice(4, 7);
        d.s = { red };
        red.forEach((b, k) => d.pose(b, { pos: d.at(46 + k * 2.5, -7 + k * 3), yaw: Math.PI / 2, crouch: k === 1 }));
      },
      frame(d, i) {
        const r = d.s.red;
        if (i === 1) d.input.throwGrenade = true;
        d.input.moveY = i > 8 && i < 26 ? 0.6 : 0;
        if (i >= 18) d.lookAt(r[0].feet.clone().setY(r[0].feet.y + 1.2), 0.1);
        d.input.fire = i >= 22;
        if (i === 24) d.down(r[0], d.g.player.feet);
      },
    },
    // A headshot down the sights.
    S40: {
      setup(d) {
        d.put(-22, 3, 1, 90, 0);
        const e = d.team('red')[8];
        d.s = { e };
        d.pose(e, { pos: d.at(-4, -1.5), yaw: -Math.PI / 2 + 0.3 });
        d.input.ads = true;
        d.warm(0.5);
      },
      frame(d, i) {
        const e = d.s.e;
        if (e.alive) d.face(e.feet.clone().setY(e.feet.y + 1.66));
        d.input.ads = true;
        d.input.fire = i === 10;
        if (i === 13 && e.alive) e.applyDamage(1000, 'head', { pos: d.g.player.feet.clone(), name: '', team: 'blue', weapon: 'M4A1', id: d.g.myId });
      },
    },
  },
};
