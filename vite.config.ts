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
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    // Cleaning is done by scripts/clean.mjs (see comment there).
    emptyOutDir: false,
    chunkSizeWarningLimit: 2500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
