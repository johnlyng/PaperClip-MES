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
  testMatch: ["<rootDir>/src/__tests__/integration/**/*.test.ts"],
  passWithNoTests: true,
  testTimeout: 60000,
  clearMocks: true,
  restoreMocks: true,
};

export default config;
