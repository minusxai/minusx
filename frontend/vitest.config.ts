import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import yaml from '@rollup/plugin-yaml';
import path from 'node:path';

const projectRoot = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  // @rollup/plugin-yaml lets Vitest resolve native `import x from './x.yaml'` (the
  // bundlers' yaml-loader doesn't run under Vitest). Default export = parsed doc.
  plugins: [react(), yaml()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@': projectRoot,
    },
  },
  test: {
    globals: true,
    testTimeout: 45000,
    hookTimeout: 45000,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            '**/__tests__/**/*.test.ts',
            '**/__tests__/**/*.test.tsx',
          ],
          exclude: [
            '**/node_modules/**',
            '**/__tests__/**/*.ui.test.{ts,tsx}',
            'orchestrator/**',
            'agents/**',
          ],
          setupFiles: ['./test/setup/vitest.setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['**/__tests__/**/*.ui.test.{ts,tsx}'],
          exclude: ['**/node_modules/**'],
          setupFiles: [
            './test/setup/vitest.setup.ts',
            './test/setup/vitest.setup.ui.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'orchestrator',
          environment: 'node',
          include: [
            'orchestrator/**/__tests__/**/*.test.ts',
            'agents/**/__tests__/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**'],
          setupFiles: ['./test/setup/vitest.setup.orchestrator.ts'],
        },
      },
    ],
  },
});
