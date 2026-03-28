import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 9528,
    proxy: {
      '/api': 'http://localhost:9527',
      '/ws': { target: 'ws://localhost:9527', ws: true },
    },
  },
  build: {
    outDir: '../../dist/web',
  },
});
