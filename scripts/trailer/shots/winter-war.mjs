// The winter-war Short's game shots on Ardennes, third person and first person (film.mjs; functions run in the page).
// Red plays the invaders. The road through the forest (z 22, west of the creek) and the clearing beside it
// round (-105, 32); the village from high over the road for the end.
export default {
  query: 'map=ardennes&bots=24v24&at=-40,60,90',
  out: 'assets-src/shorts/winter/footage',
  setup(d) {
    d.deploy();
    d.particles(6000, 2000);
    d.warm(2);
    // Called at the end of each shot's casting: whoever isn't in it stands far off, and the air is clean
    // (the bots' own fight threw smoke across the clearing and walked into frame).
    d.quiet = () => {
      const far = d.at(232, 100);
      for (const b of d.g.bots?.bots ?? []) if (!b.puppet) d.pose(b, { pos: far, yaw: 0, god: true });
      const fx = d.g.effects;
      for (const key of ['soft', 'glow']) {
        const old = fx[key];
        const scene = old.mesh.parent;
        old.mesh.removeFromParent();
        fx[key] = new old.constructor(scene, old.capacity, key === 'glow');
      }
    };
  },
  shots: {
    // Three tanks come down the forest road toward a low camera.
    W01: {
      frames: 90,
      setup(d) {
        const h = {};
        for (let x = -160; x < -50; x++) h[x] = d.ground(x, 22);
        const xs = [-92, -112, -132];
        const t = xs.map((x) => d.vehicle('tank', d.v(x, h[x], 22), -Math.PI / 2, 'red'));
        d.quiet();
        const y = h[-60];
        d.s = { h, xs, t };
        d.cam((_, cam) => d.place(cam, d.v(-60, y + 1.1, 22.8), d.v(-110, y + 2, 22), 28));
      },
      frame(d) {
        const s = d.s;
        s.t.forEach((veh, k) => {
          s.xs[k] += 0.22;
          d.drive(veh, d.v(s.xs[k], s.h[Math.floor(s.xs[k])], 22), -Math.PI / 2, 0, 0, d.v(6.6, 0, 0));
        });
      },
    },
    // Three propeller planes over the clearing, the camera following the leader.
    W02: {
      frames: 100,
      setup(d) {
        const a = [
          [-30, 72, 30],
          [-52, 78, 44],
          [-54, 66, 16],
        ];
        const p = a.map(([x, y, z]) => d.vehicle('cvfighter', d.v(x, y, z), Math.PI / 2, 'red'));
        d.quiet();
        const y = d.ground(-112, 32);
        d.s = { a, p };
        d.cam((_, cam, dd) => {
          const [x, h, z] = dd.s.a[0];
          dd.place(cam, d.v(-112, y + 1.4, 32), d.v(x, h, z), 58);
        });
      },
      frame(d) {
        d.s.p.forEach((veh, k) => {
          const c = d.s.a[k];
          c[0] -= 1.8;
          d.drive(veh, d.v(c[0], c[1], c[2]), Math.PI / 2, 0, 0, d.v(-54, 0, 0));
        });
      },
    },
    // A firefight across the clearing from behind the defenders.
    W03: {
      frames: 90,
      setup(d) {
        const W = -Math.PI / 2;
        const E = Math.PI / 2;
        d.battle({
          friends: [[-117.5, 29.5, W, true], [-114, 35, W, true], [-112, 26, W, true], [-113, 40, W, false]],
          foes: [[-90, 24, E, false], [-87, 31, E, true], [-92, 37, E, false], [-85, 42, E, false], [-88, 18, E, true]],
        });
        d.quiet();
        const y = d.ground(-121, 31);
        d.cam((t, cam) => d.place(cam, d.v(-121 + t * 0.25, y + 1.05, 31), d.v(-90, y + 1.2, 31), 44));
      },
      frame(d, i) {
        d.battleTick(i);
        if (i === 40 && d.bt.foes[0]) d.down(d.bt.foes[0], d.v(-117, 1, 29));
        if (i === 66 && d.bt.foes[2]) d.down(d.bt.foes[2], d.v(-116, 1, 32));
      },
    },
    // Attackers running at the camera on a long lens, two go down close.
    W04: {
      frames: 80,
      setup(d) {
        const red = d.team('red').slice(0, 5);
        const start = [[-84, 30], [-80, 36], [-88, 40], [-78, 25], [-83, 45]];
        d.s = { red, p: start.map((a) => [...a]) };
        red.forEach((b, k) => d.pose(b, { pos: d.at(start[k][0], start[k][1]), yaw: Math.PI / 2 - 0.1, god: true }));
        d.quiet();
        const y = d.ground(-112, 33);
        d.cam((_, cam) => d.place(cam, d.v(-112, y + 0.8, 33), d.v(-90, y + 1.3, 33), 24));
      },
      frame(d, i) {
        const s = d.s;
        s.red.forEach((b, k) => {
          if (!b.alive || !b.puppet) return;
          s.p[k][0] -= 0.17;
          d.pose(b, { pos: d.at(s.p[k][0], s.p[k][1]), yaw: Math.PI / 2 - 0.1, god: true });
        });
        if (i === 34) d.down(s.red[0], d.v(-112, 1, 33));
        if (i === 56) d.down(s.red[1], d.v(-112, 1, 33));
      },
    },
    // First person: sprinting across the clearing.
    W05: {
      frames: 90,
      setup(d) {
        d.quiet();
        d.g.weapons.setLoadout(['ar2'], true);
        d.put(-128, d.ground(-128, 30) + 1, 30, 90);
      },
      frame(d) {
        d.input.sprint = true;
        d.input.moveY = 1;
      },
    },
    // First person: down the sights, two attackers fall.
    W06: {
      frames: 90,
      setup(d) {
        d.g.weapons.setLoadout(['ar2'], true);
        d.ammo(25);
        const red = d.team('red').slice(5, 8);
        const p = [[-104, 28], [-101, 35], [-108, 41]];
        red.forEach((b, k) => d.pose(b, { pos: d.at(p[k][0], p[k][1]), yaw: Math.PI / 2, crouch: k === 1 }));
        d.quiet();
        d.put(-122, d.ground(-122, 32) + 1, 32, 90);
        d.s = { red };
        d.face(red[0].feet.clone().setY(red[0].feet.y + 1.2));
      },
      frame(d, i) {
        const s = d.s;
        const t = s.red.find((b) => b.alive);
        if (t) d.lookAt(t.feet.clone().setY(t.feet.y + 1.2), 0.05);
        d.input.ads = i >= 4;
        d.input.fire = (i >= 16 && i < 34) || (i >= 50 && i < 70);
        if (i === 30 && s.red[0].alive) d.down(s.red[0], d.g.player.feet);
        if (i === 64 && s.red[1].alive) d.down(s.red[1], d.g.player.feet);
      },
    },
    // A tank on the forest road blows up.
    W07: {
      frames: 90,
      setup(d) {
        const at = d.at(-77, 22);
        const tank = d.vehicle('tank', at, -Math.PI / 2, 'red');
        tank.health = 1e9;
        d.quiet();
        const y = d.ground(-62, 22);
        d.s = { tank, at };
        d.cam((t, cam) => d.place(cam, d.v(-62 + t * 0.4, y + 1.2, 23), d.v(-77, at.y + 2.6, 22), 40));
      },
      frame(d, i) {
        const s = d.s;
        if (i === 24) {
          s.tank.health = 500;
          d.blast('rocket', s.at.clone().setY(s.at.y + 1));
          d.wreck(s.tank);
        }
        if (i >= 24) d.inferno(s.at, i - 24, 0.32);
      },
    },
    // A heavy machine gun firing across the clearing.
    W08: {
      frames: 80,
      setup(d) {
        const at = d.at(-112, 30);
        const gun = d.vehicle('hmg', at, -Math.PI / 2, 'blue');
        const mate = d.team('blue')[0];
        d.pose(mate, { pos: d.at(-113.2, 30), yaw: -Math.PI / 2, crouch: true, god: true });
        d.quiet();
        d.s = { gun, y: at.y };
        d.cam((_, cam) => d.place(cam, d.v(-115, at.y + 0.9, 27.4), d.v(-98, at.y + 1, 31), 42));
      },
      frame(d, i) {
        const s = d.s;
        d.mountFire(s.gun, 0, d.v(-70, s.y + 1.2, 30 + Math.sin(i * 0.12) * 16), 'blue');
      },
    },
    // A wave of attackers on foot, long lens, shells landing among them.
    W09: {
      frames: 90,
      setup(d) {
        const red = d.team('red').slice(8, 22);
        const p = red.map((_, k) => [-88 - (k % 3) * 4 + (k % 2) * 2, 12 + k * 3]);
        red.forEach((b, k) => d.pose(b, { pos: d.at(p[k][0], p[k][1]), yaw: Math.PI / 2, god: true }));
        d.quiet();
        const y = d.ground(-118, 32);
        d.s = { red, p };
        d.cam((_, cam) => d.place(cam, d.v(-118, y + 0.6, 32), d.v(-90, y + 1.3, 32), 34));
      },
      frame(d, i) {
        const s = d.s;
        s.red.forEach((b, k) => {
          s.p[k][0] -= 0.15;
          d.pose(b, { pos: d.at(s.p[k][0], s.p[k][1]), yaw: Math.PI / 2, god: true });
          if ((i + k * 7) % 21 < 3) d.fire(b, d.v(-126, 4, 30 + k), 0.08);
        });
        if (i === 18) d.blast('mortar', d.at(-84, 22), 'blue');
        if (i === 44) d.blast('artillery', d.at(-90, 42), 'blue');
        if (i === 70) d.blast('mortar', d.at(-96, 28), 'blue');
      },
    },
    // Shells walking across the clearing.
    W10: {
      frames: 90,
      setup(d) {
        d.quiet();
        const y = d.ground(-130, 31);
        let seed = 23;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
        const hits = [];
        for (let f = 4; f < 88; f += 7) hits.push([f, -108 + rnd() * 40, 12 + rnd() * 40, rnd() < 0.5 ? 'artillery' : 'howitzer']);
        d.s = { hits };
        d.cam((t, cam) => d.place(cam, d.v(-130, y + 2, 31), d.v(-85, y + 3, 31), 44, Math.sin(t * 31) * 0.006));
      },
      frame(d, i) {
        for (const [f, x, z, kind] of d.s.hits) if (f === i) d.blast(kind, d.at(x, z), 'red');
      },
    },
    // The village burning, from high over the road: under the game's name at the end.
    W11: {
      frames: 125,
      setup(d) {
        const plumes = [
          [120, -40, 1.1],
          [90, -66, 1.3],
          [60, -30, 1],
          [34, -70, 1.2],
          [150, 40, 1.2],
          [70, 40, 1.4],
        ].map(([x, z, k]) => [d.at(x, z), k]);
        for (let f = 0; f < 240; f++) {
          for (const [p, k] of plumes) d.plume(p, f, k);
          d.warm(1 / 30);
        }
        const y = d.ground(180, -30);
        d.s = { plumes, f: 240 };
        d.cam((t, cam, dd) => dd.place(cam, d.v(180 - t * 3, y + 30 + t * 0.6, -30 + t * 2), d.v(70, 6, -20), 52));
      },
      frame(d, i) {
        const s = d.s;
        for (const [p, k] of s.plumes) d.plume(p, s.f + i, k);
        if (i === 20) d.blast('artillery', d.at(40, -40), 'red');
        if (i === 62) d.blast('howitzer', d.at(92, 12), 'red');
        if (i === 96) d.blast('artillery', d.at(120, -10), 'red');
      },
    },
    // The defenders walking away down the forest road, a little slowed, a wreck burning behind the camera's shoulder.
    W12: {
      frames: 90,
      sim: 1 / 45,
      setup(d) {
        const blue = d.team('blue').slice(1, 8);
        const p = blue.map((_, k) => [-72 - (k % 3) * 4 - k * 0.8, 22 + (k % 2 ? 2.2 : -2)]);
        blue.forEach((b, k) => d.pose(b, { pos: d.at(p[k][0], p[k][1]), yaw: Math.PI / 2, god: true }));
        d.quiet();
        const smoke = d.at(-96, 32);
        for (let f = 0; f < 120; f++) {
          d.plume(smoke, f, 0.6);
          d.warm(1 / 30);
        }
        blue.forEach((b, k) => d.pose(b, { pos: d.at(p[k][0], p[k][1]), yaw: Math.PI / 2, god: true }));
        const y = d.ground(-60, 22);
        d.s = { blue, p, smoke, f: 120 };
        d.cam((_, cam) => d.place(cam, d.v(-60, y + 1.3, 22.4), d.v(-100, y + 1.2, 22), 36));
      },
      frame(d, i) {
        const s = d.s;
        d.plume(s.smoke, s.f + i, 0.6);
        s.blue.forEach((b, k) => {
          s.p[k][0] -= 0.06;
          d.pose(b, { pos: d.at(s.p[k][0], s.p[k][1]), yaw: Math.PI / 2, god: true });
        });
      },
    },
  },
};
