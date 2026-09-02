import { test, expect } from '@playwright/test'

/**
 * Mot de passe des comptes de démonstration, lu dans l'environnement.
 *
 * Il n'est plus écrit dans le dépôt : celui qui y figurait a été inséré tel
 * quel dans la base de production par le script de build.
 */
const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? ''

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

    /**
     * Valeur épinglée volontairement : c'est le garde-fou qui signale qu'une
     * refonte a touché la palette.
     *
     * Il a fait son travail au passage à la teinte « Rose & Cuivre » : le crème
     * écru (#f3f0e7) a laissé la place à un crème rosé. La valeur est mise à
     * jour ici EN MÊME TEMPS que la feuille de style, jamais après coup — un
     * garde-fou qu'on desserre pour faire passer un test ne garde plus rien.
     *
     * Les rapports de contraste de la nouvelle palette, eux, sont vérifiés par
     * `tests/domain/palette.test.ts`, qui les recalcule depuis `globals.css`.
     */
    const paper = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--paper')
        .trim(),
    )
    expect(paper.toLowerCase()).toBe('#fbf3f0')

    // Le jeton doit aussi être réellement peint : déclaré sans être appliqué,
    // il passerait le contrôle ci-dessus tout en laissant la page blanche.
    const background = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    )
    expect(background).toBe('rgb(251, 243, 240)')
  })
})

test.describe('Barre de navigation', () => {
  test('flotte : elle reste à l’écran quand la page défile', async ({
    page,
  }) => {
    /**
     * C'est LA propriété demandée, et la seule que le rendu statique ne
     * montre pas : une barre posée en haut du document et une barre flottante
     * sont identiques tant qu'on n'a pas défilé. Le jour où quelqu'un retire
     * `sticky` d'une classe utilitaire, ou pose un `overflow: hidden` sur un
     * ancêtre — ce qui suffit à désactiver `position: sticky` sans qu'aucune
     * règle ne devienne invalide — la barre repart avec le contenu et rien ne
     * le signale.
     */
    await page.goto('/fr')

    const barre = page.locator('header .nav-float')
    await expect(barre).toBeVisible()

    await page.evaluate(() => {
      // Le défilement doux de la charte animerait le saut : on le neutralise
      // pour cette mesure, sinon on mesure une position intermédiaire.
      document.documentElement.style.scrollBehavior = 'auto'
      window.scrollTo(0, 4000)
    })
    await page.waitForFunction(() => window.scrollY > 600)

    const boite = await barre.boundingBox()
    expect(boite, 'la barre a disparu de la page').not.toBeNull()

    // Relatif à la fenêtre : une barre emportée par le défilement donne une
    // ordonnée franchement négative.
    expect(
      boite!.y,
      `la barre est remontée à ${boite!.y}px : elle a suivi le défilement`,
    ).toBeGreaterThanOrEqual(0)
    expect(boite!.y).toBeLessThan(48)

    // Et elle reste utilisable, pas seulement présente.
    await expect(
      page.getByRole('link', { name: 'Catalogue' }).first(),
    ).toBeVisible()
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
      .filter({ visible: true })
      .first()
      .fill('client@nina-diego.test')
    await page.getByLabel('Mot de passe').filter({ visible: true }).fill('mauvais-mot-de-passe')
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
      .filter({ visible: true })
      .first()
      .fill('client@nina-diego.test')
    await page.getByLabel('Mot de passe').filter({ visible: true }).fill(SEED_PASSWORD)
    await page.getByRole('button', { name: 'Se connecter' }).click()

    await expect(page).toHaveURL(/\/fr\/compte/)
    // Par rôle : `getByText` attraperait aussi l'annonceur de route de Next,
    // qui recopie le titre de la page dans une région live.
    await expect(
      page.getByRole('heading', { name: 'Bonjour Diego' }),
    ).toBeVisible()

    /*
      L'en-tête doit refléter la session, alors même que l'accueil est servi
      depuis le cache statique.

      C'est précisément pour cela que le bouton n'apparaît pas dans le HTML :
      il attend l'hydratation, puis la réponse de `/api/session`. Deux allers
      supplémentaires, dont un aller-retour réseau — le délai par défaut de
      cinq secondes suffit sur une machine au repos, pas sur une machine qui
      exécute cent tests en parallèle. Le test tombait alors sur un en-tête
      simplement pas encore à jour, ce qui n'apprenait rien.
    */
    await page.goto('/fr')
    await expect(
      page.getByRole('button', { name: 'Se déconnecter' }),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('un compte admin voit l’accès au back-office, pas un client', async ({
    page,
  }) => {
    await page.goto('/fr/connexion')
    await page.getByLabel('Adresse e-mail').filter({ visible: true }).first().fill('admin@nina-diego.test')
    await page.getByLabel('Mot de passe').filter({ visible: true }).fill(SEED_PASSWORD)
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
      .filter({ visible: true })
      .first()
      .fill('client@nina-diego.test')
    await page.getByLabel('Mot de passe').filter({ visible: true }).fill(SEED_PASSWORD)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page).toHaveURL(/\/fr\/compte/)

    // Même attente que ci-dessus : le bouton n'existe qu'une fois l'en-tête
    // renseigné par `/api/session`, et cet aller-retour peut prendre son temps
    // sur une machine chargée.
    const signOut = page.getByRole('button', { name: 'Se déconnecter' })
    await expect(signOut).toBeVisible({ timeout: 15_000 })
    await signOut.click()

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
