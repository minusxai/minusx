/**
 * Jest config — split into two projects:
 *
 *   main         — CJS mode (existing behaviour). 54+ test files use `jest.mock`
 *                  as a global, plus PGLite WASM + Next.js plumbing all assume CJS.
 *   orchestrator — ESM mode. Required so `run-agent.ts` can import the pure-ESM
 *                  `@mariozechner/pi-agent-core` package via a real `import` (Jest
 *                  with `--experimental-vm-modules` defers ESM loading to Node, which
 *                  refuses to `require()` ESM packages, so transforms can't help).
 */

const mainProject = {
  displayName: 'main',
  // Per-project cache dir prevents transform-cache contamination between the
  // CJS main project and the ESM orchestrator project.
  cacheDirectory: '<rootDir>/.jest-cache/main',
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 45000,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js', '<rootDir>/test/setup/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1'
  },
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/orchestrator/',
    '<rootDir>/agents/',
    '\\.ui\\.test\\.(ts|tsx)$',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(next-auth|@auth)/)'
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true
      }
    }]
  }
};

const orchestratorProject = {
  displayName: 'orchestrator',
  cacheDirectory: '<rootDir>/.jest-cache/orchestrator',
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 45000,
  testMatch: ['<rootDir>/orchestrator/**/__tests__/**/*.test.ts'],
  // Treat .ts as ESM so `import { agentLoop } from '@mariozechner/pi-agent-core'`
  // resolves natively under --experimental-vm-modules.
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    // Match the main project's `@/` alias so agents/ tools can import @/orchestrator/...
    '^@/(.*)$': '<rootDir>/$1',
    // ts-jest ESM convention: allow `import './foo.js'` to resolve to `./foo.ts`
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Stub `server-only` — it throws when imported outside a Next.js Server Component
    // context. agents/ tools transitively pull it in via @/lib/config; in node tests
    // we only care that the import resolves.
    '^server-only$': '<rootDir>/orchestrator/src/__tests__/stubs/server-only.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true
      }
    }]
  }
};

const config = {
  collectCoverageFrom: [
    'app/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    'orchestrator/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**'
  ],
  projects: [mainProject, orchestratorProject],
};

module.exports = config;
