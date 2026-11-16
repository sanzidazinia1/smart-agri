// ESLint (code checker) settings for the project.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Folders and files the checker skips
  globalIgnores([
    // Next.js build output
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Python AI service, local data and npm cache
    "services/**",
    ".data/**",
    ".npm-cache/**",
  ]),
  // simulator.js is plain Node (CommonJS), so require() is fine there
  { files: ["simulator.js"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  // Tests may use `any` for simple Prisma mocks
  { files: ["**/*.test.ts"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
]);

export default eslintConfig;
