import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'test/',
        '**/*.module.ts',
        '**/*.dto.ts',
        '**/*.entity.ts',
        '**/main.ts',
        '**/worker.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@common': resolve(__dirname, './src/common'),
      '@config': resolve(__dirname, './src/config'),
      '@infrastructure': resolve(__dirname, './src/infrastructure'),
      '@modules': resolve(__dirname, './src/modules'),
      '@jobs': resolve(__dirname, './src/jobs'),
    },
  },
});
