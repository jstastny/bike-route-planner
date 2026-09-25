import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, stand in for the Vercel function at api/overpass.ts by forwarding
    // to Overpass with an identifying User-Agent (browser UAs get HTTP 406).
    proxy: {
      '/api/overpass': {
        target: 'https://overpass-api.de',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/overpass/, '/api/interpreter'),
        headers: {
          'User-Agent': 'bike-route-planner/1.0 (+https://github.com/jstastny/bike-route-planner)',
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
