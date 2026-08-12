import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { rendererBundleBudgetPlugin } from './scripts/renderer-bundle-budget';

const FLUENT_VENDOR_SEGMENTS = [
  '/node_modules/@fluentui/',
  '/node_modules/@griffel/',
  '/node_modules/@floating-ui/',
  '/node_modules/tabster/',
  '/node_modules/keyborg/',
] as const;

export function rendererManualChunk(moduleId: string): string | undefined {
  const normalizedId = moduleId.replaceAll('\\', '/');
  return FLUENT_VENDOR_SEGMENTS.some((segment) => normalizedId.includes(segment))
    ? 'fluent-ui'
    : undefined;
}

export default defineConfig({
  base: './',
  plugins: [react(), rendererBundleBudgetPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks: rendererManualChunk,
      },
    },
  },
});
