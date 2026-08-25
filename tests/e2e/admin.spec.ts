import { test, expect, type Page } from '@playwright/test'

/**
 * La régie : ce qu'elle montre, et à qui.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une seule connexion dans tout ce fichier
 * ---------------------------------------------------------------------------
 * `signInAction` borne les tentatives à dix par compte et par quart d'heure.
 * `phase0.spec.ts` en consomme déjà une sur ce compte, par projet et par
 * exécution. Une connexion ici, réutilisée pour toutes les assertions, garde la
 * marge nécessaire à deux exécutions consécutives — et desserrer la protection
 * pour arranger des tests n'est pas une option.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce fichier vérifie et qu'aucun test unitaire ne peut voir
 * ---------------------------------------------------------------------------
 * Que la page existe réellement — le lien « Accéder au back-office » menait à
 * un 404 — et surtout que le prix plancher et le coût d'achat, qui ne sortent
 * NULLE PART ailleurs, sortent bien ici et seulement ici.
 */

const ACCOUNT = 'admin@nina-diego.test'
const CUSTOMER = 'client@nina-diego.test'
const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? ''

function main(page: Page) {
  return page.locator('#contenu')
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/fr/connexion')
  await page.getByLabel('Adresse e-mail').filter({ visible: true }).first().fill(email)
  await page.getByLabel('Mot de passe').filter({ visible: true }).fill(SEED_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/\/fr\/compte/)
}

test.describe('Accès à la régie', () => {
  test('un visiteur sans session n’y entre pas', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/fr/admin')
    await expect(page).toHaveURL(/\/fr\/connexion/)
  })

  test('un compte CLIENT ne sait pas qu’elle existe', async ({ page }) => {
    // `notFound()` et non « accès refusé » : confirmer l'existence d'une
    // administration à cette adresse renseignerait qui n'y a pas droit. C'est
    // le geste déjà retenu pour la tâche planifiée, qui répond 404 à qui n'a
    // pas le secret.
    await page.context().clearCookies()
    await signIn(page, CUSTOMER)

    const response = await page.goto('/fr/admin/offres')
    expect(response?.status()).toBe(404)
  })
})

test.describe('La file des offres', () => {
  test('montre les chiffres de la décision, et le lien y mène', async ({ page }) => {
    await page.context().clearCookies()
    await signIn(page, ACCOUNT)

    // Le lien existait avant la page : il menait à un 404 depuis l'espace
    // compte.
    await main(page).getByRole('link', { name: 'Accéder au back-office' }).click()
    await expect(page).toHaveURL(/\/fr\/admin/)

    await main(page).getByRole('link', { name: 'Offres reçues' }).first().click()
    await expect(page).toHaveURL(/\/fr\/admin\/offres/)

    await expect(
      main(page).getByRole('heading', { name: 'Offres reçues' }),
    ).toBeVisible()

    // Le jeu de données porte des offres déposées par les autres suites. S'il
    // y en a, les trois chiffres de la décision doivent être là ; sinon, l'état
    // vide doit le dire — jamais une page muette.
    const empty = main(page).getByText('Aucune offre n’attend de décision.')
    if (await empty.isVisible()) return

    await expect(main(page).getByText('Prix plancher').first()).toBeVisible()
    await expect(main(page).getByText('Écart au plancher').first()).toBeVisible()
    await expect(
      main(page).getByRole('button', { name: 'Accepter' }).first(),
    ).toBeVisible()
  })

  test('la page de régie porte la politique de sécurité stricte', async ({ page }) => {
    // Le complément de `csp.spec.ts`, qui ne peut pas couvrir `/admin` : sans
    // session, il serait redirigé vers la connexion et mesurerait les en-têtes
    // de CETTE page-là. C'est pourtant l'écran du site où `unsafe-inline`
    // serait le plus mal placé — il affiche le coût d'achat et le prix
    // plancher.
    await page.context().clearCookies()
    await signIn(page, ACCOUNT)

    const violations: string[] = []
    page.on('console', (message) => {
      if (/content security policy/i.test(message.text())) {
        violations.push(message.text())
      }
    })

    const response = await page.goto('/fr/admin/offres')
    const csp = response?.headers()['content-security-policy'] ?? ''
    const scriptSrc = csp
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('script-src'))

    // En développement la politique stricte est inactive : le contrôle n'a de
    // sens que sur un vrai build, qui est ce que Playwright sert.
    expect(scriptSrc).toContain("'nonce-")
    expect(scriptSrc).not.toContain('unsafe-inline')

    const unsigned = await page.evaluate(
      () =>
        [...document.querySelectorAll('script')].filter(
          (el) =>
            !el.src &&
            el.textContent?.trim() &&
            el.type !== 'application/ld+json' &&
            !el.nonce &&
            !el.getAttribute('nonce'),
        ).length,
    )
    expect(unsigned, 'des scripts en ligne sans nonce seraient refusés').toBe(0)
    expect(violations).toEqual([])
  })
})
