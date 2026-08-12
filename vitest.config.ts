import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Résolution native des chemins de tsconfig ("@/..."), sans plugin.
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Les tests Playwright ont leur propre lanceur.
    exclude: ['tests/e2e/**', 'node_modules/**'],
    globals: false,
  },
})
