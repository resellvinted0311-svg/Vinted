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

      // next-auth importe `next/server` sans extension. Le bundler de Next
      // résout cette forme, le résolveur ESM de Node non : tout test qui
      // remonte jusqu'à next-auth échoue à l'import, avant même de démarrer.
      // On rétablit la correspondance ici plutôt que de renoncer à tester les
      // actions d'authentification.
      'next/server': 'next/server.js',
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
    server: {
      deps: {
        // Sans cela, next-auth est chargé par le résolveur ESM natif de Node,
        // qui ignore les alias ci-dessus — et échoue sur son `import` de
        // `next/server`. L'inclure force Vite à le transformer, alias compris.
        inline: [/next-auth/, /@auth\/core/],
      },
    },
  },
})
