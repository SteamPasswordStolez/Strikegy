# The main menu's film (`public/menu/scene.mp4`)

Since 2026-10-27 the main menu loops a 56 s film of the dusk battle diorama
(`src/menu/MenuScene.ts`) instead of running that scene live (owner: it never
showed on phones and was heavy enough to stutter on computers). The film plays
on phones too (muted, inline), unless the browser asks to save data; the
setting 화면 → 메뉴 배경 전투 turns it off. `scene.jpg` is its first frame, shown
while it loads. (Before that, 2026-10-12 to 10-24: `battle.mp4`, a cut of bot
matches recorded from the game; the live scene replaced it, and this film
replaces the live scene.)

To make it again (after changing the scene):

1. `npm run dev`, a small local receiver that writes each POSTed frame to a
   numbered JPEG (it must accept `text/plain` bodies holding a `data:` URL, so
   the page's request needs no CORS preflight), the browser viewport at
   1280x720.
2. In the page: `const { MenuScene } = await import('/src/menu/MenuScene.ts')`,
   `MenuScene.create(host, 'high')` in a fixed 1280x720 host, stop its loop
   (`cancelAnimationFrame(s.raf)`, `window.requestAnimationFrame = () => 0`),
   `s.renderer.setRenderScale(1)`, warm up 8 s of `s.step(1 / 30)`, then per
   frame `s.step(1 / 30); s.render();` and `canvas.toDataURL('image/jpeg',
   0.95)` right after, in the same task (`toBlob` is throttled in a hidden
   pane: ~1.2 s a frame against ~0.05 s). Record one loop (56 s) plus 1.5 s:
   1,725 frames, about 90 s on this PC's GPU.
3. Encode with the last 1.5 s faded into the first so the loop has no seam:
   ```
   ffmpeg -framerate 30 -start_number 45 -i f/%05d.jpg -framerate 30 -start_number 0 -i f/%05d.jpg -filter_complex "[0:v]trim=end_frame=1680,setpts=PTS-STARTPTS[a];[1:v]trim=end_frame=45,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=1.5:offset=54.5,format=yuv420p[v]" -map "[v]" -c:v libx264 -preset slow -crf 33 -tune film -g 60 -movflags +faststart -an scene.mp4
   ```
   (4.9 MB; crf 27 was 11 MB, 31 was 6.5 MB, and it sits under the menu's dark shade.)
   Poster: `ffmpeg -i scene.mp4 -frames:v 1 -vf scale=960:-2 -q:v 6 scene.jpg`.

The scene has no pointer lean in the film (it followed the mouse live).
