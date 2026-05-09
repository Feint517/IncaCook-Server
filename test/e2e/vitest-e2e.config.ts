import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/e2e/**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '../../src'),
      '@common': resolve(__dirname, '../../src/common'),
      '@config': resolve(__dirname, '../../src/config'),
      '@infrastructure': resolve(__dirname, '../../src/infrastructure'),
      '@modules': resolve(__dirname, '../../src/modules'),
      '@jobs': resolve(__dirname, '../../src/jobs'),
    },
  },
});
