/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  // Audio tests render real music; give them headroom on a busy machine.
  test: { testTimeout: 30000 },
});
