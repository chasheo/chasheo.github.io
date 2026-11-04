import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:18790', changeOrigin: true },
      '/stream': { target: 'http://127.0.0.1:18790', changeOrigin: true, ws: true },
    },
  },
});
