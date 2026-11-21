import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the browser talks to Vite, which forwards API calls (same paths as nginx in Docker).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/whatsapp': { target: 'http://localhost:4001', rewrite: (path) => path.replace(/^\/whatsapp/, '') },
    },
  },
});
