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

/**
 * ---------------------------------------------------------------------------
 * Si la suite échoue au DEUXIÈME passage d'affilée
 * ---------------------------------------------------------------------------
 * Ce n'est probablement pas une régression : c'est la limitation de débit.
 *
 * `signInAction` borne les tentatives à dix par compte et par quart d'heure
 * (`signin:<empreinte>:<compte>`). Chaque fichier de test se connecte plusieurs
 * fois, dans chacun des deux navigateurs : le seau se vide vite.
 *
 * Deux mesures, et aucune ne touche à la limite elle-même :
 *
 *  - les tests de connexion utilisent `client@nina-diego.test`, ceux du RGPD
 *    `client2@nina-diego.test`. Réunis sur un seul compte, ils consommaient
 *    exactement les dix essais et les deux derniers tombaient dès la PREMIÈRE
 *    exécution complète ;
 *  - le compteur vit en mémoire tant qu'Upstash n'est pas configuré :
 *    redémarrer `pnpm start` le remet à zéro.
 *
 * Mesuré après ces deux mesures : deux exécutions complètes consécutives
 * passent en entier, la TROISIÈME vide le seau de `client@` et fait tomber les
 * tests de connexion. C'est le comportement attendu d'une protection contre le
 * bourrage d'identifiants, pas un défaut à corriger — il suffit de redémarrer
 * le serveur entre deux séries.
 *
 * On ne desserre PAS cette limite pour arranger les tests : dix essais par
 * quart d'heure sur un compte donné est exactement ce qu'il faut contre le
 * bourrage d'identifiants.
 *
 * ---------------------------------------------------------------------------
 * Si un test échoue sur « strict mode violation » et deux éléments identiques
 * ---------------------------------------------------------------------------
 * Observé sur machine saturée, jamais sur machine au repos : la page contient
 * alors DEUX exemplaires du même champ, l'un avec un identifiant `useId` au
 * format serveur (`_r_7_`), l'autre au format client (`_R_…`). C'est la
 * fenêtre d'hydratation, qui s'allonge quand les deux navigateurs se disputent
 * le processeur ; le HTML servi n'en contient bien qu'un, vérifié en
 * interrogeant la page directement.
 *
 * La parade est dans les tests, et elle consiste à viser ce qu'une personne
 * peut réellement manipuler : portée au bloc concerné, et `visible: true` pour
 * écarter la copie en cours de démontage.
 */
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

  /**
   * Chaque navigateur se présente comme un visiteur DIFFÉRENT.
   *
   * ---------------------------------------------------------------------------
   * Le défaut que cela corrige
   * ---------------------------------------------------------------------------
   * `clientFingerprint` dérive l'empreinte de limitation de débit de l'adresse
   * IP. En local, les deux navigateurs sortent tous les deux de 127.0.0.1 :
   * ils partagent donc TOUS les compteurs.
   *
   * Conséquence mesurée : `/api/session` est borné à 120 appels par minute et
   * par adresse — un plafond large, atteint en trafic normal seulement par un
   * robot. Or l'en-tête l'appelle à chaque chargement de page, et une exécution
   * complète en enchaîne plusieurs centaines en une minute, depuis une seule
   * adresse. Passé le plafond, la réponse est un 429 et l'en-tête reste
   * « déconnecté » : les tests de connexion échouaient sur un en-tête qui
   * n'avait rien de faux, seulement rien à afficher.
   *
   * On ne relève pas le plafond pour arranger les tests. On rend les deux
   * navigateurs distinguables, ce qu'ils sont d'ailleurs dans la réalité qu'ils
   * décrivent : deux personnes, deux connexions, deux adresses.
   *
   * Les adresses viennent de la plage de DOCUMENTATION 203.0.113.0/24
   * (RFC 5737) : elles ne peuvent appartenir à personne. En production, la
   * plateforme réécrit cet en-tête et ces valeurs n'ont aucun effet.
   */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.11' },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.22' },
      },
    },
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
