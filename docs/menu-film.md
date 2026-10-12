# The main menu's film (`public/menu/battle.mp4`)

Since 2026-10-12 the main menu plays a short looping film of real bot battles
instead of running a live bot match behind it (owner: the live one was heavy,
slow to load and stuttered). How it was made, to make it again:

1. `npm run dev`, then open `/?showcase=<map>` (dev builds only): a bot match
   on that map with the showcase camera, full screen; `window.__showcase` is
   the `Game`.
2. Record frame by frame, not in real time (a hidden pane doesn't animate, and
   fixed 30 fps steps never drop frames): stop its loop
   (`cancelAnimationFrame(g.rafId); window.requestAnimationFrame = () => 0`),
   warm it up ~45 s of sim time with `g.renderer.render` stubbed out (the
   sides meet), then per frame `g.frame(now += 1000 / 30)` and read the canvas
   right after (`canvas.toDataURL('image/jpeg', 0.92)`, same task, before the
   drawing buffer is cleared); POST each frame to a small local receiver that
   writes numbered JPEGs. Render scale 1 at a 1280x720 viewport.
3. The camera for the film was replaced in the page (`g.showcaseCam.update`):
   over-the-shoulder trails of a soldier who is fighting in the open (4 s,
   3.8 m behind, 1.5 m aside, 2 m up, pulled in front of walls), and slow
   passes 32 m over the busiest zone. The stock showcase camera's orbit is
   too high for a film.
4. Cut and encode (2026-10-12 cut: Iron Gate pass, Bilbao base with tanks,
   Lyon pass, Bilbao street fight, Ardennes pass, Lyon street, Persia pass,
   Bilbao smoke; ~37 s):
   `ffmpeg -framerate 30 -i cut/%05d.jpg -vf scale=960:540 -c:v libx264 -preset medium -crf 31 -pix_fmt yuv420p -movflags +faststart -an battle.mp4` (3.6 MB; it sits under the menu's dark shade)

Rendering on this PC's GPU for a few minutes runs it hot: record only what is
needed, one map at a time, and close the pane afterwards.
