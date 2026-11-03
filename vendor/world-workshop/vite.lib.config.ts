import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Library build: dist/lib/world-workshop.js (ES module, three bundled in) for the homepage to import.
// Runtime assets are NOT inlined: pass mount(container, { assetBase }) pointing at the deployed dist/ folder.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/lib',
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'WorldWorkshop',
      formats: ['es'],
      fileName: () => 'world-workshop.js',
    },
  },
});
