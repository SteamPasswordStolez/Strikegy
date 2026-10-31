// Lyon: close air support low over the lavender, then its rockets on the church hill (3, -34) (film.mjs).
export default {
  query: 'map=lyon&bots=12v12&at=60,-34,270',
  setup(d) {
    d.deploy();
    d.warm(3);
  },
  shots: {
    // Air answers: the jet comes in low over the fields toward the camera and roars over.
    S10: {
      setup(d) {
        const gy = d.ground(70, -60);
        const jet = d.vehicle('cas', d.v(260, gy + 24, -60), Math.PI / 2, 'blue');
        d.s = { jet, x: 260, gy };
        d.cam((t, cam, dd) => {
          const j = dd.s.jet.model.root.position;
          dd.place(cam, d.v(70, gy + 1.6, -52), d.v(j.x, j.y, j.z), 52, 0);
        });
      },
      frame(d) {
        const s = d.s;
        s.x -= 4.4;
        d.drive(s.jet, d.v(s.x, s.gy + 24 - (s.x < 120 ? (120 - s.x) * 0.04 : 0), -60), Math.PI / 2, 0, 0.12, d.v(-132, 0, 0));
      },
    },
    // Rockets on the church hill from a diving jet (behind it, then the hits).
    S36: {
      setup(d) {
        const hill = d.at(3, -34);
        const jet = d.vehicle('cas', d.v(200, hill.y + 90, -34), Math.PI / 2, 'blue');
        d.s = { jet, hill, x: 200 };
        d.cam((t, cam, dd) => {
          const j = dd.s.jet.model.root.position;
          dd.place(cam, d.v(j.x + 26, j.y + 7, j.z + 9), d.v(hill.x, hill.y + 4, hill.z), 50, -0.05);
        });
      },
      frame(d, i) {
        const s = d.s;
        s.x -= 3.6;
        const y = s.hill.y + 90 - (200 - s.x) * 0.32;
        d.drive(s.jet, d.v(s.x, y, -34), Math.PI / 2, -0.3, 0, d.v(-108, -35, 0));
        if (i >= 8 && i % 3 === 0) d.mountFire(s.jet, 0, d.v(s.hill.x + (i % 7) - 3, s.hill.y, s.hill.z + (i % 5) - 2), 'blue', true);
      },
    },
  },
};
