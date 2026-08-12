import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Résolution native des chemins de tsconfig ("@/..."), sans plugin.
    tsconfigPaths: true,
    alias: {
      // `server-only` lève à l'import hors du bundler Next. Les tests
      // d'intégration exercent du code serveur : on le neutralise ici, la
      // protection reste entière dans le build applicatif.
      'server-only': fileURLToPath(
        new URL('./tests/stubs/server-only.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Les tests Playwright ont leur propre lanceur.
    exclude: ['tests/e2e/**', 'tests/bench/**', 'node_modules/**'],
    globals: false,
    // Les tests d'intégration partagent une base : pas d'exécution
    // concurrente de fichiers, sinon les jeux de données se marchent dessus.
    fileParallelism: false,
    setupFiles: ['tests/setup-env.ts'],
  },
})
