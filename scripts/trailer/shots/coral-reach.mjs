// Coral Reach: the fleets (film.mjs; functions run in the page). Blue (heading east, +x): carrier
// -2299,-350, battleship -1950,250 (main guns seats 2-4, secondaries 5-8), destroyer -1747,750, sub
// -1849,-900 (torpedoes seats 2-3). Red mirrored (+x, -z), ~4 km off. Nobody deploys: cameras only.
export default {
  query: 'map=coral_reach&bots=8v8',
  setup(d) {
    d.warm(4);
    const ship = (k, team) => d.g.vehicles.vehicles.find((v) => v.kind === k && v.home === team);
    d.fleet = { bb: ship('bb', 'blue'), cv: ship('cv', 'blue'), ss: ship('ss', 'blue'), rdd: ship('dd', 'red'), rbb: ship('bb', 'red') };
  },
  shots: {
    // Naval answers: the B turret fires close up, from the deck beside A.
    S12: {
      setup(d) {
        const bb = d.fleet.bb;
        d.s = { bb };
        d.cam((t, cam, dd) => {
          const b = dd.fleet.bb.model.root.position;
          dd.place(cam, d.v(b.x + 76 - t * 1.5, b.y + 10.5, b.z + 15), d.v(b.x + 66, b.y + 12, b.z - 4), 44, 0.04);
        });
      },
      frame(d, i) {
        const b = d.s.bb.model.root.position;
        // Straight along the ship's heading (+x), where the barrels already point.
        const at = d.v(b.x + 3000, 140, b.z);
        if (i === 3) {
          d.mountFire(d.s.bb, 3, at, 'blue');
          d.muzzleBlast(d.s.bb, 3, at, 22);
        }
        if (i === 18) {
          d.mountFire(d.s.bb, 2, at, 'blue');
          d.muzzleBlast(d.s.bb, 2, at, 22);
        }
      },
    },
    // The strongest hit of the song: the whole broadside at once, wide from the sea.
    S29: {
      setup(d) {
        d.cam((t, cam, dd) => {
          const b = dd.fleet.bb.model.root.position;
          dd.place(cam, d.v(b.x + 20 + t * 6, b.y + 6, b.z - 150), d.v(b.x + 4 + t * 6, b.y + 14, b.z), 46, 0);
        });
      },
      frame(d, i) {
        const bb = d.fleet.bb;
        const b = bb.model.root.position;
        const at = d.v(b.x + 3000, 140, b.z);
        if (i === 0)
          for (const seat of [2, 3, 4, 5, 6]) {
            d.mountFire(bb, seat, at, 'blue');
            d.muzzleBlast(bb, seat, at, seat < 5 ? 26 : 10);
          }
        if (i === 10)
          for (const seat of [5, 6]) {
            d.mountFire(bb, seat, at, 'blue');
            d.muzzleBlast(bb, seat, at, 10);
          }
      },
    },
    // The submarine at sea level: a torpedo leaves the bow tube, its wake running off.
    S30: {
      setup(d) {
        d.cam((t, cam, dd) => {
          const b = dd.fleet.ss.model.root.position;
          dd.place(cam, d.v(b.x + 34 + t * 2, 0.9, b.z + 9), d.v(b.x + 140, -0.5, b.z - 6), 50, 0.02);
        });
      },
      frame(d, i) {
        const ss = d.fleet.ss;
        const b = ss.model.root.position;
        if (i === 1) d.mountFire(ss, 2, d.v(b.x + 3000, -1, b.z + 120), 'blue');
      },
    },
    // The drop: the torpedo strikes, a water column against the enemy destroyer's side.
    S31: {
      setup(d) {
        d.cam((t, cam, dd) => {
          const r = dd.fleet.rdd.model.root.position;
          dd.place(cam, d.v(r.x - 95 + t * 4, 3.5, r.z + 70), d.v(r.x, 8, r.z), 42, 0);
        });
      },
      frame(d, i) {
        const r = d.fleet.rdd.model.root.position;
        if (i === 0) d.g.blast('torpedo', d.v(r.x - 6, 0, r.z + 5), { id: -903, name: '', team: 'blue', squad: null }, 'torpedo', true);
        if (i === 6) d.blast('naval', d.v(r.x + 4, 6, r.z), 'blue');
      },
    },
    // Planes launching: a fighter off the carrier's bow (from the deck, low by the island).
    S32: {
      setup(d) {
        const c = d.fleet.cv.model.root.position;
        const deck = d.ground(c.x + 60, c.z, 40);
        const plane = d.vehicle('cvfighter', d.v(c.x + 40, deck + 1.2, c.z), -Math.PI / 2, 'blue');
        d.s = { plane, x: c.x + 40, deck, c };
        d.cam((t, cam, dd) => dd.place(cam, d.v(c.x + 35 + t * 4, deck + 1.6, c.z + 13), d.v(dd.s.x + 4, dd.s.deck + 2, c.z), 50, 0));
      },
      frame(d, i) {
        const s = d.s;
        s.x += 1.2 + i * 0.07;
        const lift = Math.max(0, s.x - (s.c.x + 95)) * 0.18;
        d.drive(s.plane, d.v(s.x, s.deck + 1.2 + lift, s.c.z), -Math.PI / 2, lift > 0 ? 0.12 : 0, 0, d.v(40, lift > 0 ? 6 : 0, 0));
      },
    },
    // A dive bomber goes down on the enemy battleship (behind and above it, the ship growing).
    S33: {
      setup(d) {
        const r = d.fleet.rbb.model.root.position.clone();
        const plane = d.vehicle('cvdive', d.v(r.x - 520, 420, r.z), -Math.PI / 2, 'blue');
        d.s = { plane, r, k: 0 };
        d.cam((t, cam, dd) => {
          const p = dd.s.plane.model.root.position;
          dd.place(cam, d.v(p.x - 22, p.y + 9, p.z + 7), d.v(dd.s.r.x, dd.s.r.y + 6, dd.s.r.z), 48, -0.08);
        });
      },
      frame(d, i) {
        const s = d.s;
        s.k = Math.min(1, s.k + 1 / 75);
        const p = d.v(s.r.x - 520 + 440 * s.k, 420 - 330 * s.k, s.r.z);
        d.drive(s.plane, p, -Math.PI / 2, -0.62, 0, d.v(176, -132, 0));
        if (i === 52) d.blast('naval', d.v(s.r.x + 8, s.r.y + 9, s.r.z - 3), 'blue');
        if (i === 56) d.blast('naval', d.v(s.r.x - 14, s.r.y + 8, s.r.z + 2), 'blue');
      },
    },
  },
};
