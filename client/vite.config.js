import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// The engines (rebalance, dividends, tax-loss, CSV import) live in server/src and are plain
// JavaScript with no Node-only code, so the browser can run them too. That's what powers demo mode.
const shared = fileURLToPath(new URL('../server/src', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@shared': shared },
    // server/src/import uses papaparse; resolve it from the client's own node_modules.
    dedupe: ['papaparse'],
  },
  server: {
    port: 5173,
    // In development the API runs on :3001. Proxying keeps everything on one origin,
    // so the login cookie works without any CORS setup.
    proxy: { '/api': 'http://localhost:3001' },
    fs: { allow: ['..'] },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
});
