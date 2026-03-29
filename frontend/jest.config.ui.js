/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'jest-environment-jsdom',
  testTimeout: 45000,
  setupFilesAfterEnv: [
    '<rootDir>/jest.setup.js',
    '<rootDir>/test/setup/jest.setup.ts',
    '<rootDir>/test/setup/jest.setup.ui.ts',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // CSS imports (e.g., react-grid-layout/css/styles.css) are no-ops in JSDOM
    '\\.css$': '<rootDir>/test/setup/style-mock.js',
    // DuckDB WASM + apache-arrow use TextDecoder/Buffer APIs unavailable in JSDOM.
    // Table.tsx (used in QuestionVisualization) pulls this in via FileHeader.
    '@duckdb/duckdb-wasm': '<rootDir>/test/setup/style-mock.js',
    // ECharts sub-path imports (echarts/core, echarts/charts, echarts/renderers, …)
    // are ESM-only and cannot be parsed by Jest's CJS transformer.
    // The main 'echarts' module is mocked with a richer stub in jest.setup.ui.ts;
    // everything under echarts/* gets the empty stub here.
    '^echarts/.+': '<rootDir>/test/setup/style-mock.js',
  },
  // Custom resolver: retries .cjs → .js fallback for @zag-js packages
  // whose dist/index.js requires sibling .cjs files that weren't shipped.
  resolver: '<rootDir>/test/setup/jest-cjs-resolver.js',
  testMatch: [
    '**/__tests__/**/*.ui.test.tsx',
    '**/__tests__/**/*.ui.test.ts',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(next-auth|@auth)/)',
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react-jsx',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    }],
  },
};

module.exports = config;
