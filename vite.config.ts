import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative paths, so the built site works wherever it is hosted: the root, or a sub-path like
  // https://<user>.github.io/<repo>/ on GitHub Pages.
  base: './',
  server: { port: 6785, strictPort: true },
  preview: { port: 6785, strictPort: true },
  // The zip library is loaded lazily (only on download). Without this, the dev server only discovers it on
  // the first click, re-bundles it mid-session and breaks that download until the page is reloaded.
  optimizeDeps: { include: ['jszip'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 60000 },
});
