import { defineConfig } from 'vite';

export default defineConfig({
  base: './',                       // відносні шляхи — обов'язково для Capacitor (file://)
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,           // атлас і звук лишаються окремими файлами
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: { pixi: ['pixi.js', 'pixi-filters'], audio: ['howler'] }
      }
    }
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 }
});
