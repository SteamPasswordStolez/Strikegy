// Persia: through the breach in the fort's west wall (36, 6), first person (film.mjs).
export default {
  query: 'map=persia&bots=4v4&at=20,6,90',
  setup(d) {
    d.deploy();
    d.warm(2);
  },
  shots: {
    S35: {
      setup(d) {
        d.put(26, 6, 6, 90, 0);
        const red = d.team('red').slice(0, 3);
        d.s = { red };
        red.forEach((b, k) => d.pose(b, { pos: d.at(44 + k * 2, 3 + k * 3), yaw: Math.PI / 2 + 0.2, crouch: k === 2 }));
      },
      frame(d, i) {
        const r = d.s.red;
        d.input.moveY = i < 34 ? 1 : 0.3;
        d.input.sprint = i < 16;
        const t = r[Math.min(r.length - 1, Math.floor(i / 22))];
        if (i > 14) d.lookAt(t.feet.clone().setY(t.feet.y + (t.crouching ? 0.9 : 1.3)), 0.12);
        d.input.fire = i > 20;
        if (i === 30) d.down(r[0], d.g.player.feet);
        if (i === 52) d.down(r[1], d.g.player.feet);
      },
    },
  },
};
