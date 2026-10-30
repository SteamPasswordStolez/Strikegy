import fs from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Dev-only: POST an image body to /__snapshot and it is written to .snapshots/.
 * Lets tooling capture the WebGL canvas (canvas.toBlob right after a render)
 * without relying on OS-level screenshots.
 */
function devSnapshot(): Plugin {
  return {
    name: 'strikegy-dev-snapshot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__snapshot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          if (!fs.existsSync('.snapshots')) fs.mkdirSync('.snapshots');
          const file = `.snapshots/${Date.now()}.jpg`;
          fs.writeFileSync(file, Buffer.concat(chunks));
          res.end(file);
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [devSnapshot()],
  // STRIKEGY_NO_HMR=1 npm run dev: no live reload, so pages kept open for measuring are not reloaded
  // while files change (several sessions editing one working tree); a manual reload picks up the edits.
  server: process.env.STRIKEGY_NO_HMR ? { hmr: false } : undefined,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    // Cleaning is done by scripts/clean.mjs (see comment there).
    emptyOutDir: false,
    chunkSizeWarningLimit: 2500,
    // The game, and the staff's page at /admin/ (strikegy.xyz/admin).
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin/index.html', import.meta.url)),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Navmesh, terrain and gun-building tests take seconds each; the default 5 s is too tight when they run in parallel.
    testTimeout: 30000,
    environment: 'node',
  },
});
