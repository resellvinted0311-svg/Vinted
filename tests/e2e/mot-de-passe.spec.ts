import { test, expect, type Page } from '@playwright/test'

/**
 * « Mot de passe oublié », par l'interface réelle.
 *
 * ---------------------------------------------------------------------------
 * Ce que seul un navigateur peut vérifier
 * ---------------------------------------------------------------------------
 * Que le chemin EXISTE et qu'on y arrive — le libellé « Mot de passe oublié »
 * vivait dans les huit fichiers de traduction depuis la Phase 0, sans qu'aucun
 * lien ne l'utilise, parce que la page n'existait pas.
 *
 * Et surtout que la réponse est LA MÊME pour une adresse qui a un compte et
 * pour une adresse qui n'en a pas. C'est une propriété du rendu, pas du
 * domaine : le serveur peut parfaitement renvoyer deux états identiques et
 * l'interface les distinguer par une nuance. Ici on compare ce que la personne
 * voit.
 *
 * ---------------------------------------------------------------------------
 * Aucune connexion dans ce fichier
 * ---------------------------------------------------------------------------
 * Rien de ce qui est vérifié ici n'en demande, et `signInAction` borne les
 * tentatives par compte et par quart d'heure — une protection qu'on ne
 * desserre pas pour arranger des tests, et dont on ne consomme pas le budget
 * sans raison.
 */

const AVEC_COMPTE = 'client@nina-diego.test'
const SANS_COMPTE = 'personne-qui-n-existe-pas@nina-diego.test'

function main(page: Page) {
  return page.locator('#contenu')
}

/** Demande un lien et renvoie le texte de la zone de contenu après réponse. */
async function demander(page: Page, email: string): Promise<string> {
  await page.goto('/fr/connexion/mot-de-passe')
  await main(page).getByLabel('Adresse e-mail').fill(email)
  await main(page).getByRole('button', { name: 'Recevoir le lien' }).click()

  const confirmation = main(page).getByText(/un lien vient d’être envoyé/)
  await expect(confirmation).toBeVisible()

  return (await main(page).innerText()).trim()
}

test.describe('Le chemin existe', () => {
  test('la connexion y mène', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/fr/connexion')

    await main(page).getByRole('link', { name: 'Mot de passe oublié' }).click()

    await expect(page).toHaveURL(/\/fr\/connexion\/mot-de-passe$/)
    await expect(
      main(page).getByRole('heading', { name: 'Mot de passe oublié' }),
    ).toBeVisible()
  })

  test('la page n’est ni indexée ni suivie', async ({ page }) => {
    // `follow: false` compte autant qu'`index: false` sur le second écran :
    // l'URL y PORTE le jeton, et une page suivie enverrait un robot dessus.
    await page.goto('/fr/connexion/mot-de-passe')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    )

    await page.goto('/fr/connexion/mot-de-passe/jeton-invente-pour-le-test')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /nofollow/,
    )
  })
})

test.describe('L’existence d’un compte ne se déduit pas', () => {
  test('la réponse est identique, mot pour mot', async ({ page }) => {
    await page.context().clearCookies()

    const avec = await demander(page, AVEC_COMPTE)

    await page.context().clearCookies()
    const sans = await demander(page, SANS_COMPTE)

    // Mot pour mot : une nuance de formulation suffirait à faire de ce
    // formulaire un oracle d'adresses inscrites — exactement ce que la
    // connexion et le lien magique ferment déjà.
    expect(sans).toBe(avec)
  })
})

test.describe('Un lien invalide', () => {
  test('le dit sans apprendre s’il a un jour existé', async ({ page }) => {
    await page.goto('/fr/connexion/mot-de-passe/jeton-invente-pour-le-test')

    await expect(main(page).getByText(/n’est plus valide/)).toBeVisible()

    // Aucun formulaire : proposer un champ de mot de passe sur un lien mort
    // ferait taper un mot de passe pour rien, et pire, ferait croire que le
    // lien a marché.
    await expect(main(page).getByLabel('Nouveau mot de passe')).toHaveCount(0)

    await expect(
      main(page).getByRole('link', { name: 'Demander un nouveau lien' }),
    ).toBeVisible()
  })

  test('la page porte la politique de sécurité stricte', async ({ page }) => {
    // C'est l'écran où l'on tape un mot de passe neuf, sur une URL qui porte
    // un jeton d'accès au compte. `unsafe-inline` y serait très mal placé.
    const response = await page.goto(
      '/fr/connexion/mot-de-passe/jeton-invente-pour-le-test',
    )
    const csp = response?.headers()['content-security-policy'] ?? ''
    const scriptSrc = csp
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('script-src'))

    expect(scriptSrc).toContain("'nonce-")
    expect(scriptSrc).not.toContain('unsafe-inline')
  })
})
