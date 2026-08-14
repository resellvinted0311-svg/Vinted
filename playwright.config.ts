import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { defineConfig, devices } from '@playwright/test'

/**
 * Charger .env avant tout.
 *
 * Vitest le fait par son fichier de mise en place ; Playwright, non. Les tests
 * de connexion lisent le mot de passe des comptes de démonstration dans
 * l'environnement — il n'est plus écrit dans le dépôt — et échouaient donc
 * silencieusement sur une chaîne vide.
 */
loadEnv()

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

/**
 * Chromium préinstallé.
 *
 * Certains environnements d'exécution fournissent une révision de Chromium
 * différente de celle qu'attend la version de Playwright installée. Plutôt
 * que d'échouer sur « Executable doesn't exist », on retient le binaire
 * réellement présent. Sur un poste ordinaire, rien n'est détecté et
 * Playwright utilise son navigateur habituel.
 */
function detectChromium(): string | undefined {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH
  if (explicit && existsSync(explicit)) return explicit

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined

  const candidates = readdirSync(root)
    .filter((entry) => /^chromium-\d+$/.test(entry))
    // Révision la plus récente en premier.
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .map((entry) => join(root, entry, 'chrome-linux', 'chrome'))

  return candidates.find((path) => existsSync(path))
}

const executablePath = detectChromium()

export default defineConfig({
  testDir: './tests/e2e',
  // Le parcours d'achat teste la concurrence : aucune reprise silencieuse,
  // un échec doit rester un échec.
  retries: 0,
  fullyParallel: true,
  reporter: [['list']],

  use: {
    baseURL,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm start',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
})
