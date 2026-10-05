import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The game server's bundle for Node (`npm run server:build`, dist-server/):
 * the gateway and the match sim it shares with the browser, with the `@/`
 * imports resolved. Packages (three, Rapier, recast, ws) stay in node_modules.
 */
export default defineConfig({
  resolve: { alias: { '@': here('../src') } },
  plugins: [
    {
      // The wasm core (`src/wasm/core.ts` loads it from beside the code that
      // imports it); an SSR build leaves `new URL('./core.wasm', ...)` as is.
      name: 'strikegy-core-wasm',
      writeBundle() {
        for (const dir of ['../dist-server', '../dist-server/assets']) {
          mkdirSync(here(dir), { recursive: true });
          copyFileSync(here('../src/wasm/core.wasm'), here(`${dir}/core.wasm`));
        }
      },
    },
  ],
  // The site's files are served by GitHub Pages, not the game server.
  publicDir: false,
  build: {
    ssr: true,
    target: 'node22',
    outDir: here('../dist-server'),
    // Cleaned by scripts/clean.mjs (Vite's own emptying crashes on Windows paths with Korean folder names).
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: here('./main.ts'),
        roomWorker: here('./roomWorker.ts'),
        edge: here('./edge.ts'),
        bench: here('./bench.ts'),
        bakeNav: here('./bakeNav.ts'),
      },
      output: { entryFileNames: '[name].js' },
    },
  },
});
