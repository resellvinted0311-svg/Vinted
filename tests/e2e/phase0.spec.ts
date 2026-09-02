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

    // Et elle reste utilisable, pas seulement présente. Ciblé DANS la barre :
    // « catalogue » figure aussi dans l'appel de bas de page, et une assertion
    // qui l'attraperait passerait même si la barre était vide.
    await expect(
      barre.getByRole('link', { name: 'Tout le catalogue' }),
    ).toBeVisible()
  })

  test('ne porte ni prénom, ni régie, ni déconnexion, ni langue', async ({
    page,
  }) => {
    /*
      Ces quatre-là sont descendus ailleurs — le prénom, l'accès à la régie et
      la déconnexion dans l'espace compte, la langue dans le colophon — parce
      qu'une barre de navigation porte des chemins, pas des commandes ni un
      état.

      Le test vérifie la barre CONNECTÉE, en compte administrateur : c'est le
      seul cas où les quatre existaient à la fois, donc le seul où la
      régression se verrait.
    */
    await page.goto('/fr/connexion')
    await page
      .getByLabel('Adresse e-mail')
      .filter({ visible: true })
      .first()
      .fill('admin@nina-diego.test')
    await page.getByLabel('Mot de passe').filter({ visible: true }).fill(SEED_PASSWORD)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page).toHaveURL(/\/fr\/compte/)

    await page.goto('/fr')
    const barre = page.locator('header .nav-float')

    // On attend que la barre reflète la session avant de conclure à une
    // absence : sans cette attente, le test passerait aussi sur une barre pas
    // encore renseignée, c'est-à-dire sur rien.
    await expect(barre.getByRole('link', { name: 'Mon compte' })).toBeVisible({
      timeout: 15_000,
    })

    await expect(barre.getByRole('button', { name: 'Se déconnecter' })).toHaveCount(0)
    await expect(barre.getByRole('link', { name: 'Admin' })).toHaveCount(0)
    await expect(barre.getByLabel('Langue')).toHaveCount(0)
    // « Nina » est le prénom du compte administrateur du jeu d'essai. Il
    // apparaît aussi dans la signature de la boutique, d'où la recherche
    // limitée au groupe de droite plutôt qu'à la barre entière.
    await expect(
      barre.locator('.nav-bar__tools').getByText('Nina'),
    ).toHaveCount(0)
  })
})

test.describe('La vitrine tient dans un écran', () => {
  // Un portable courant. La barre flottante recouvre le haut de la fenêtre :
  // c'est ce qui reste EN DESSOUS qui décide de ce qu'on voit d'un coup d'œil.
  test.use({ viewport: { width: 1280, height: 800 } })

  test('la pièce du moment et l’arrivage se lisent sans défiler', async ({
    page,
  }) => {
    /**
     * Ce que ce test protège.
     *
     * Les deux premières sections avaient grandi jusqu'à dépasser la fenêtre :
     * il fallait faire défiler pour découvrir qu'une pièce avait un prix. Rien
     * ne cassait pour autant, et la régression est facile à réintroduire — il
     * suffit d'agrandir une échelle typographique ou une fiche du rail de deux
     * ou trois rem, chacune étant un réglage qui paraît anodin pris isolément.
     *
     * On mesure donc la hauteur réelle rendue, pas les valeurs qui la
     * produisent : c'est la seule façon d'attraper la somme.
     */
    await page.goto('/fr')
    await page.waitForLoadState('load')

    /*
      Attendre les FONTES, et pas seulement le chargement.

      Sans cette attente, le test mesurait une page composée dans la fonte de
      repli. Le nom de la pièce y est plus large, il passait sur deux lignes,
      et la section gagnait soixante-dix pixels qui n'existent pas une fois la
      grotesque arrivée. Le test échouait alors une fois sur dix — uniquement
      dans la passe complète, quand la machine est chargée et que la fonte
      traîne. C'est le pire des cas : un échec qui ne se reproduit pas quand on
      relance le test seul, et qu'on finit par mettre sur le compte du hasard.
    */
    await page.evaluate(() => document.fonts.ready)

    const mesures = await page.evaluate(() => {
      const barre = document
        .querySelector('header .nav-float')!
        .getBoundingClientRect()

      // La barre flotte au-dessus du contenu : sa hauteur, plus son
      // décollement du bord, est autant de fenêtre en moins.
      const dispo = window.innerHeight - (barre.height + 16)

      return Array.from(document.querySelectorAll('main section'))
        .slice(0, 2)
        .map((section) => ({
          titre: (section.querySelector('h1, h2')?.textContent ?? '?')
            .trim()
            .slice(0, 30),
          hauteur: Math.round(section.getBoundingClientRect().height),
          dispo: Math.round(dispo),
        }))
    })

    expect(mesures).toHaveLength(2)

    // Garde-fou sur la sélection elle-même : si l'ordre des sections change,
    // le test doit le dire plutôt que de mesurer autre chose en silence.
    expect(
      mesures[1]!.titre,
      'la deuxième section de l’accueil n’est plus l’arrivage',
    ).toContain('vient d')

    for (const mesure of mesures) {
      expect(
        mesure.hauteur,
        `« ${mesure.titre} » occupe ${mesure.hauteur} px pour ${mesure.dispo} px de fenêtre sous la barre : il faut défiler pour la voir en entier`,
      ).toBeLessThanOrEqual(mesure.dispo)
    }
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
      La barre doit refléter la session, alors même que l'accueil est servi
      depuis le cache statique.

      C'est précisément pour cela que l'entrée n'apparaît pas dans le HTML :
      elle attend l'hydratation, puis la réponse de `/api/session`. Deux allers
      supplémentaires, dont un aller-retour réseau — le délai par défaut de
      cinq secondes suffit sur une machine au repos, pas sur une machine qui
      exécute cent tests en parallèle. Le test tombait alors sur une barre
      simplement pas encore à jour, ce qui n'apprenait rien.

      Ce qui bascule n'est plus un bouton de déconnexion mais le libellé de
      l'entrée de compte : « Se connecter » devient « Mon compte ».
    */
    await page.goto('/fr')
    const barre = page.locator('header .nav-float')
    await expect(barre.getByRole('link', { name: 'Mon compte' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      barre.getByRole('link', { name: 'Se connecter' }),
    ).toHaveCount(0)
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

    /*
      La déconnexion vit maintenant DANS l'espace compte, en bas, et non plus
      dans la barre de navigation. Elle y est servie par le rendu de la page :
      pas d'attente d'hydratation, le bouton est dans le HTML.

      C'est un vrai formulaire posté vers une action serveur. Le rendu qui suit
      ne trouve plus de session et redirige vers la connexion — la
      déconnexion se PROUVE donc par cette redirection, sans qu'on ait à
      guetter un état côté client.
    */
    const signOut = page.getByRole('button', { name: 'Se déconnecter' })
    await expect(signOut).toBeVisible()
    await signOut.click()

    await expect(page).toHaveURL(/\/fr\/connexion/, { timeout: 15_000 })

    // Et le cookie est bien mort côté serveur, pas seulement oublié par la
    // page : on redemande une page protégée.
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
