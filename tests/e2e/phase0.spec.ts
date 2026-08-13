import { test, expect } from '@playwright/test'

/**
 * Livrable de Phase 0 : voir l'accueil stylé et se connecter.
 *
 * Ces tests passent par l'interface réelle — formulaire, Server Action,
 * cookie de session — et non par des appels d'API : c'est la seule façon de
 * vérifier que la connexion fonctionne vraiment de bout en bout.
 */

test.describe('Accueil', () => {
  test('affiche la signature et la baseline', async ({ page }) => {
    await page.goto('/fr')

    await expect(page.getByText('Nina & Diego').first()).toBeVisible()
    await expect(
      page.getByText('La seconde main à portée de main').first(),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Comment ça marche' }),
    ).toBeVisible()
  })

  test('la racine redirige vers une langue', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/(fr|en|es|it|nl|de|pt|pl)$/)
  })

  test('bascule de langue et la conserve', async ({ page }) => {
    await page.goto('/fr')

    await page.getByLabel('Langue').click()
    await page.getByRole('option', { name: 'Nederlands' }).click()

    await expect(page).toHaveURL(/\/nl/)
    await expect(
      page.getByText('Tweedehands binnen handbereik').first(),
    ).toBeVisible()
  })

  test('applique les jetons de couleur du thème', async ({ page }) => {
    await page.goto('/fr')

    // Valeur épinglée volontairement : c'est le garde-fou qui signale qu'une
    // refonte a touché la palette. Charte « Registre » — toile écrue chaude.
    const paper = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--paper')
        .trim(),
    )
    expect(paper.toLowerCase()).toBe('#f3f0e7')

    // Le jeton doit aussi être réellement peint : déclaré sans être appliqué,
    // il passerait le contrôle ci-dessus tout en laissant la page blanche.
    const background = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    )
    expect(background).toBe('rgb(243, 240, 231)')
  })
})

test.describe('Connexion', () => {
  test('une page protégée renvoie vers la connexion', async ({ page }) => {
    await page.goto('/fr/compte')
    await expect(page).toHaveURL(/\/fr\/connexion/)
  })

  test('refuse un mot de passe incorrect sans révéler si le compte existe', async ({
    page,
  }) => {
    await page.goto('/fr/connexion')

    await page
      .getByLabel('Adresse e-mail')
      .first()
      .fill('client@nina-diego.test')
    await page.getByLabel('Mot de passe').fill('mauvais-mot-de-passe')
    await page.getByRole('button', { name: 'Se connecter' }).click()

    await expect(
      page.getByText('Adresse e-mail ou mot de passe incorrect.'),
    ).toBeVisible()
    await expect(page).toHaveURL(/\/fr\/connexion/)
  })

  test('connecte un compte client et ouvre son espace', async ({ page }) => {
    await page.goto('/fr/connexion')

    await page
      .getByLabel('Adresse e-mail')
      .first()
      .fill('client@nina-diego.test')
    await page.getByLabel('Mot de passe').fill('ClientNinaDiego2026')
    await page.getByRole('button', { name: 'Se connecter' }).click()

    await expect(page).toHaveURL(/\/fr\/compte/)
    // Par rôle : `getByText` attraperait aussi l'annonceur de route de Next,
    // qui recopie le titre de la page dans une région live.
    await expect(
      page.getByRole('heading', { name: 'Bonjour Diego' }),
    ).toBeVisible()

    // L'en-tête doit refléter la session, alors même que l'accueil est servi
    // depuis le cache statique.
    await page.goto('/fr')
    await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
  })

  test('un compte admin voit l’accès au back-office, pas un client', async ({
    page,
  }) => {
    await page.goto('/fr/connexion')
    await page.getByLabel('Adresse e-mail').first().fill('admin@nina-diego.test')
    await page.getByLabel('Mot de passe').fill('AdminNinaDiego2026')
    await page.getByRole('button', { name: 'Se connecter' }).click()

    await expect(page).toHaveURL(/\/fr\/compte/)
    await expect(page.getByText('Administration')).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Accéder au back-office' }),
    ).toBeVisible()
  })

  test('la déconnexion referme la session', async ({ page }) => {
    await page.goto('/fr/connexion')
    await page
      .getByLabel('Adresse e-mail')
      .first()
      .fill('client@nina-diego.test')
    await page.getByLabel('Mot de passe').fill('ClientNinaDiego2026')
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page).toHaveURL(/\/fr\/compte/)

    await page.getByRole('button', { name: 'Se déconnecter' }).click()

    // On attend que l'en-tête ait basculé avant de naviguer : sans cela, le
    // test partirait pendant que l'action serveur est encore en vol et
    // enverrait l'ancien cookie.
    await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible()

    // Ce basculement ne suffit pas : l'en-tête se met à jour dès que l'état
    // local change, donc AVANT que le router.refresh() déclenché dans la
    // foulée soit terminé. Naviguer à cet instant fait annuler la nouvelle
    // navigation par Chromium (net::ERR_ABORTED) une fois sur trois environ.
    //
    // `networkidle` ne convient pas ici : le flux RSC de Next garde une
    // connexion ouverte, l'attente n'aboutit jamais. On reprend donc la
    // navigation ET son assertion — si la redirection ne se produit pas, le
    // test échoue toujours, ce qui est bien ce qu'il doit vérifier.
    await expect(async () => {
      await page.goto('/fr/compte')
      await expect(page).toHaveURL(/\/fr\/connexion/)
    }).toPass({ timeout: 15_000 })
  })
})

test.describe('Étanchéité des données privées', () => {
  test('aucun champ privé dans la réponse de session', async ({ request }) => {
    const response = await request.get('/api/session')
    const body = await response.text()

    for (const field of ['costCents', 'floorPriceCents', 'passwordHash', 'internalNotes']) {
      expect(body).not.toContain(field)
    }
  })

  test('le HTML public ne contient aucun coût d’achat', async ({ page }) => {
    await page.goto('/fr')
    const html = await page.content()

    expect(html).not.toContain('costCents')
    expect(html).not.toContain('floorPriceCents')
    expect(html).not.toContain('internalNotes')
  })
})
