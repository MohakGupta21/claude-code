import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3000';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': SERVER_URL,
      '/ws': { target: SERVER_URL.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/globalSetup.ts'],
  },
});
