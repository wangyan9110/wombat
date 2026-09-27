import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/report',
  base: './',
  build: {
    outDir: '../../dist/report',
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
