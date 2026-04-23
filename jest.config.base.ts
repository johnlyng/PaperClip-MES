/**
 * jest.config.base.ts — Shared Jest configuration for all packages and apps.
 *
 * Each package extends this base and may override settings (e.g. testEnvironment
 * for apps/web which needs 'jsdom').
 *
 * ESM note: all MES packages use "type": "module". Jest requires:
 *   - node --experimental-vm-modules ./node_modules/.bin/jest
 *   - ts-jest preset with useESM: true
 *   - moduleNameMapper to strip .js extensions from relative imports
 */
import type { Config } from "jest";

const baseConfig: Config = {
  preset: "ts-jest/presets/default/esm",
  extensionsToTreatAsEsm: [".ts"],
  testEnvironment: "node",
  moduleNameMapper: {
    // Strip .js extension from relative imports so ts-jest can resolve .ts sources
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          // Allow ESM interop in test transforms
          esModuleInterop: true,
        },
      },
    ],
  },
  coverageProvider: "v8",
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/__tests__/**",
    "!src/**/*.d.ts",
    "!src/index.ts",
  ],
  testMatch: [
    "**/__tests__/**/*.test.ts",
    "**/__tests__/**/*.spec.ts",
  ],
  clearMocks: true,
  restoreMocks: true,
};

export default baseConfig;
