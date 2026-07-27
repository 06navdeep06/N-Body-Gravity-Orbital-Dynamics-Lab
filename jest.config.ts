import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.test.json",
      },
    ],
  },
  moduleFileExtensions: ["ts", "tsx", "js", "json"],
  collectCoverageFrom: [
    "src/lib/physics/**/*.ts",
    "!src/lib/physics/**/*.worker.ts",
    "!src/lib/physics/gpu/**",
    "!src/lib/physics/analysis-protocol.ts",
    "!src/lib/physics/worker-protocol.ts",
  ],
  // NB: singular `coverageThreshold` — the plural spelling is silently
  // ignored by Jest, which would let coverage regress unnoticed.
  coverageThreshold: {
    // `global` is required by Jest's type; keep it permissive and let the
    // physics-specific gate below be the one that actually bites.
    global: { lines: 0, functions: 0, branches: 0, statements: 0 },
    "./src/lib/physics/": {
      lines: 80,
      functions: 75,
      branches: 70,
      statements: 80,
    },
  },
  coverageDirectory: "coverage",
  coverageReporters: ["text", "text-summary", "lcov"],
  testPathIgnorePatterns: ["/node_modules/", "/.next/"],
};

export default config;
