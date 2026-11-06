import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  server: { proxy: { '/api': { target: 'http://127.0.0.1:3100', changeOrigin: false } } },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
