// Ardennes: the tank on the creek's stone bridge (-36.5, 22), firing east (film.mjs; functions run in the page).
export default {
  query: 'map=ardennes&bots=12v12&at=-60,22,90',
  setup(d) {
    d.deploy();
    d.warm(3);
  },
  shots: {
    // Armor answers: the main gun goes off on the bridge, seen from the deck ahead of it.
    S8: {
      setup(d) {
        const y = d.ground(-36.5, 22);
        const tank = d.vehicle('tank', d.v(-36.5, y, 22), -Math.PI / 2, 'blue');
        d.s = { tank, y };
        d.cam((t, cam) => d.place(cam, d.v(-28.5 + t * 0.6, y + 1.3, 20.6), d.v(-36.5, y + 1.9, 22.2), 42, 0.03));
      },
      frame(d, i) {
        const s = d.s;
        d.drive(s.tank, d.v(-36.5 + i * 0.02, s.y, 22), -Math.PI / 2);
        if (i === 4) d.mountFire(s.tank, 0, d.v(60, s.y + 4, 18), 'blue');
        if (i > 8) d.mountFire(s.tank, 1, d.v(60, s.y + 2, 26), 'blue');
      },
    },
    // Across the bridge, firing as it goes (a tracking shot alongside).
    S34: {
      setup(d) {
        const y = d.ground(-36.5, 22);
        const tank = d.vehicle('tank', d.v(-44, y, 22), -Math.PI / 2, 'blue');
        d.s = { tank, y, x: -44 };
        d.cam((t, cam) => d.place(cam, d.v(-47 + t * 3.4, y + 3.6, 29), d.v(-40 + t * 3.4, y + 1.6, 22), 46));
      },
      frame(d, i) {
        const s = d.s;
        s.x += 0.11;
        d.drive(s.tank, d.v(s.x, s.y, 22), -Math.PI / 2, 0, 0, d.v(3.3, 0, 0));
        if (i === 6) d.mountFire(s.tank, 0, d.v(80, s.y + 4, 14), 'blue');
        d.mountFire(s.tank, 1, d.v(80, s.y + 2, 30), 'blue');
        if (i === 20) d.blast('shell', d.at(30, 30), 'red');
      },
    },
  },
};
