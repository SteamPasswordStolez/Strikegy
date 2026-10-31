// Ashfall Isle: the landing, from a red soldier's eyes (film.mjs; functions run in the page). The pillbox
// line runs along z ~245 facing the sea (south, +z); A is at -330, 228 behind it; the transport and its
// landing craft wait at z ~577. The player is red.
export default {
  query: 'map=ashfall&bots=12v12&side=red&at=-320,300,0',
  setup(d) {
    d.deploy();
    d.warm(3);
    // A landing craft of our own, run in by script.
    const sea = d.g.sea;
    const water = (x, z) => (sea ? sea.heightAt(x, z, d.g.simTime) : 0);
    d.water = water;
  },
  shots: {
    // In the landing craft, running in: the squad crouched in the well, spray, the ramp ahead.
    S25: {
      setup(d) {
        const craft = d.vehicle('lcvp', d.v(-322, 0.2, 352), 0, 'red');
        d.s = { craft, z: 352 };
        d.seat(craft, 4);
        d.warm(0.2);
        d.face(d.v(-322, 1.5, 250));
        d.s.mates = d.team('red').slice(0, 4);
      },
      frame(d, i) {
        const s = d.s;
        s.z -= 0.42;
        const y = d.water(-322, s.z) + 0.75;
        d.drive(s.craft, d.v(-322, y, s.z), 0, Math.sin(i * 0.21) * 0.03, Math.sin(i * 0.13) * 0.04, d.v(0, 0, -12.6));
        s.mates.forEach((b, k) => d.pose(b, { pos: d.v(-323.2 + (k % 2) * 2.4, y + 0.5, s.z - 1.6 - Math.floor(k / 2) * 1.6), yaw: 0, crouch: true, god: true }));
        if (i === 40) d.g.blast('artillery', d.v(-312, 0, s.z - 22), { id: -904, name: '', team: 'blue', squad: null }, 'artillery', true);
        if (i === 96) d.g.blast('artillery', d.v(-334, 0, s.z - 12), { id: -904, name: '', team: 'blue', squad: null }, 'artillery', true);
      },
    },
    // The ramp drops: light and spray flood the frame.
    S26: {
      setup(d) {
        d.put(-322, 2, 296, 0, 2);
        d.g.blast('howitzer', d.v(-321, 0, 286), { id: -904, name: '', team: 'blue', squad: null }, 'howitzer', true);
      },
    },
    // Up the black sand: a sprint between water spouts, the squad alongside, the pillboxes firing.
    S27: {
      setup(d) {
        d.put(-322, 2, 292, 358, 4);
        const red = d.team('red').slice(0, 3);
        const blue = d.team('blue').slice(0, 2);
        d.s = { red, blue, z: 292 };
        blue.forEach((b, k) => d.pose(b, { pos: d.at(-318 + k * 4, 244), yaw: Math.PI, crouch: true, god: true }));
      },
      frame(d, i) {
        const s = d.s;
        d.input.moveY = 1;
        d.input.sprint = true;
        s.z -= 0.2;
        s.red.forEach((b, k) => d.pose(b, { pos: d.at(-326 + k * 5.5, s.z + 1.5 + k), yaw: 0, god: true }));
        if (i % 3 === 0) s.blue.forEach((b) => d.fire(b, d.v(-322 + Math.sin(i) * 6, 1.6, s.z + 3), 0.04));
        const wet = { id: -904, name: '', team: 'blue', squad: null };
        if (i === 8) d.g.blast('mortar', d.v(-331, 0, s.z + 9), wet, 'mortar', true);
        if (i === 30) d.blast('mortar', d.at(-314, s.z - 6), 'blue');
        if (i === 50) d.g.blast('mortar', d.v(-312, 0, s.z + 12), wet, 'mortar', true);
      },
    },
    // The pillbox's MG flashing out of its slit (from the sand in front of it, low).
    S28: {
      setup(d) {
        const gun = d.team('blue')[3];
        d.s = { gun };
        d.pose(gun, { pos: d.at(-318, 245, 3), yaw: Math.PI, crouch: false, god: true });
        const gy = d.ground(-307, 258);
        const py = d.ground(-318, 246);
        d.cam((t, cam) => d.place(cam, d.v(-307 - t * 1.2, gy + 1.2, 258), d.v(-318, py + 1.6, 245), 44, 0.03));
      },
      frame(d, i) {
        if (i % 2 === 0) d.fire(d.s.gun, d.v(-300 + Math.sin(i * 0.4) * 30, 0.8, 330), 0.03);
      },
    },
  },
};
