import { defineConfig } from 'vitest/config';

// Unit tests only. They must NOT import 'vscode' (that module exists only in the
// extension host). Pure logic lives in modules that have no vscode dependency.
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
  },
});
