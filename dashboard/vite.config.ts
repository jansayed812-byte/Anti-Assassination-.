import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // The package's `exports` map hides the prebuilt script MapLibre loads for Arabic-script (Dari/Pashto) shaping.
      { find: /^rtl-text-plugin(\?.*)?$/, replacement: `${fileURLToPath(new URL('./node_modules/@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js', import.meta.url))}$1` },
    ],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:8000', ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom', 'zustand'],
        },
      },
    },
  },
});
