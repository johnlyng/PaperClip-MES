/** @type {import('jest').Config} */
const config = {
  displayName: "api:integration",
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts"],
  testEnvironment: "node",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
  },
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/integration/**/*.test.ts"],
  passWithNoTests: true,
  // 120s: testcontainers may need time to start the TimescaleDB image on cold pull
  testTimeout: 120000,
  clearMocks: true,
  restoreMocks: true,
};

export default config;
