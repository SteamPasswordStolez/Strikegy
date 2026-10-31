// Bilbao: across the tank square (4, -2), a sprint and a slide past the wreck (film.mjs).
export default {
  query: 'map=bilbao&bots=12v12&at=-25,-2,90',
  setup(d) {
    d.deploy();
    d.warm(2);
  },
  shots: {
    S37: {
      setup(d) {
        // From -15, -2 the street runs clear 56 m east into the square.
        d.put(-15, 3, -2, 90, 0);
        d.warm(0.2);
      },
      frame(d, i) {
        d.input.moveY = 1;
        d.input.sprint = i < 30;
        if (i === 30) d.input.crouchToggle = true;
        d.input.yaw += Math.sin(i * 0.25) * 0.003;
        if (i === 18) d.blast('mortar', d.at(-2, 10), 'red');
      },
    },
  },
};
