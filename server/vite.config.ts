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
  // The site's files are served by GitHub Pages, not the game server.
  publicDir: false,
  build: {
    ssr: true,
    target: 'node22',
    outDir: here('../dist-server'),
    emptyOutDir: true,
    rollupOptions: {
      input: { main: here('./main.ts'), bench: here('./bench.ts') },
      output: { entryFileNames: '[name].js' },
    },
  },
});
