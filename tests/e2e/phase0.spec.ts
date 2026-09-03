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

/**
 * Luminance relative et rapport de contraste, tels que les définissent les WCAG.
 *
 * Recopiés ici plutôt qu'importés de `tests/domain/palette.test.ts` : ce
 * fichier-là calcule à partir des JETONS déclarés, celui-ci à partir des
 * couleurs RÉELLEMENT PEINTES. Les deux doivent pouvoir diverger — c'est
 * justement l'écart entre les deux qu'on cherche.
 */
function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((octet) => {
    const canal = octet / 255
    return canal <= 0.03928
      ? canal / 12.92
      : Math.pow((canal + 0.055) / 1.055, 2.4)
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contraste(a: number[], b: number[]): number {
  const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ]
  return (clair + 0.05) / (sombre + 0.05)
}

test.describe('Le fond de page reste lisible', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`les mentions secondaires tiennent le seuil AA en thème ${theme}`, async ({
      page,
    }) => {
      /**
       * Ce que ce test empêche, et il l'a déjà empêché une fois.
       *
       * Le fond du site est passé d'un crème uni à un dégradé teinté. Le
       * premier essai reprenait tel quel le lavis des cadres de fiche : mesure
       * faite, `--muted` y tombait à 4,30:1, sous le seuil AA de 4,5 imposé par
       * le cahier des charges. Rien ne l'aurait signalé — la page reste jolie,
       * le texte reste visible pour qui a une bonne vue, et le défaut ne se
       * découvre qu'à l'audit d'accessibilité.
       *
       * Le calcul par jetons ne pouvait pas l'attraper : le fond n'est pas une
       * couleur déclarée mais un `color-mix` résolu par le navigateur. On
       * mesure donc la couleur PEINTE, aux deux extrémités du dégradé, dans les
       * deux thèmes — le thème sombre mélange une teinte claire dans un fond
       * sombre, il ÉCLAIRCIT le papier, et c'est l'inverse du thème clair.
       */
      await page.emulateMedia({ colorScheme: theme })
      await page.goto('/fr')

      const mesures = await page.evaluate(() => {
        // Le canvas sert de convertisseur : `getComputedStyle` rend un
        // `oklab(...)` que rien ne sait lire en octets, alors qu'un pixel
        // peint est toujours en sRGB.
        const toile = document.createElement('canvas')
        toile.width = 1
        toile.height = 1
        const pinceau = toile.getContext('2d')
        if (!pinceau) throw new Error('canvas 2d indisponible')

        const sonde = document.createElement('div')
        document.body.appendChild(sonde)

        const peindre = (valeur: string): number[] => {
          sonde.style.backgroundColor = valeur
          pinceau.clearRect(0, 0, 1, 1)
          pinceau.fillStyle = getComputedStyle(sonde).backgroundColor
          pinceau.fillRect(0, 0, 1, 1)
          const octets = pinceau.getImageData(0, 0, 1, 1).data
          return [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0]
        }

        const resultat = {
          // Les deux extrémités de `--gradient-page`, telles qu'elles sont
          // déclarées dans globals.css.
          depart: peindre(
            'color-mix(in oklab, var(--stamp) 16%, var(--paper-raised))',
          ),
          arrivee: peindre(
            'color-mix(in oklab, var(--mark) 14%, var(--paper-raised))',
          ),
          muted: peindre('var(--muted)'),
          ink: peindre('var(--ink)'),
        }

        sonde.remove()
        return resultat
      })

      const AA = 4.5
      const paires: [string, number[], number[]][] = [
        ['les mentions secondaires au départ du fond', mesures.muted, mesures.depart],
        ['les mentions secondaires à son arrivée', mesures.muted, mesures.arrivee],
        ['le texte courant au départ du fond', mesures.ink, mesures.depart],
        ['le texte courant à son arrivée', mesures.ink, mesures.arrivee],
      ]

      for (const [role, devant, derriere] of paires) {
        const rapport = contraste(devant, derriere)
        expect(
          rapport,
          `${role} : ${rapport.toFixed(2)}:1, il en faut ${AA}`,
        ).toBeGreaterThanOrEqual(AA)
      }
    })
  }
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

test.describe('Le visuel d’arrivée', () => {
  for (const [nom, viewport, plafond] of [
    ['bureau', { width: 1280, height: 800 }, 0.8],
    ['téléphone', { width: 390, height: 844 }, 0.62],
  ] as const) {
    test(`occupe la bonne part de l’écran en ${nom}`, async ({ page }) => {
      /**
       * Ce que ce test tient, et pourquoi les deux bornes sont différentes.
       *
       * En BUREAU, le propriétaire a demandé les trois quarts de la hauteur
       * d’écran. La borne haute est à 80 % : elle laisse la marge d’un titre
       * qui passe sur trois lignes — ce qui arrive en allemand avant d’arriver
       * en français — tout en interdisant la dérive vers le plein écran. Un
       * bandeau qui remplit la fenêtre ne montre aucune pièce, et un visiteur
       * qui ne voit pas de produit s’en va.
       *
       * En TÉLÉPHONE, la borne descend à 62 % pour la même raison, en plus
       * pressant : c’est l’écran par lequel la boutique est réellement
       * découverte, depuis un lien social. La première rangée du catalogue doit
       * dépasser sous le pli.
       *
       * On mesure la hauteur RENDUE, jamais la valeur CSS : la borne vient
       * d’un `min-height`, donc le contenu peut la dépasser, et c’est
       * précisément le dépassement qu’on surveille.
       */
      await page.setViewportSize(viewport)
      await page.goto('/fr')
      await page.waitForLoadState('load')
      await page.evaluate(() => document.fonts.ready)

      const banniere = page.locator('main section').first()
      const boite = await banniere.boundingBox()
      expect(boite, 'le visuel d’arrivée est introuvable').not.toBeNull()

      const part = boite!.height / viewport.height
      expect(
        part,
        `le visuel occupe ${Math.round(part * 100)} % de la fenêtre, le plafond est ${Math.round(plafond * 100)} %`,
      ).toBeLessThanOrEqual(plafond)

      // Et il occupe vraiment la place demandée : un bandeau qui s’effondre à
      // deux cents pixels passerait la borne haute sans rien montrer.
      expect(
        part,
        `le visuel n’occupe que ${Math.round(part * 100)} % de la fenêtre`,
      ).toBeGreaterThan(0.45)
    })
  }

  test('porte un titre, une promesse et UN seul appel', async ({ page }) => {
    // Deux boutons concurrents dans un premier écran font arbitrer au lieu
    // d’avancer. La règle est facile à défaire — on ajoute « en savoir plus »
    // à côté — et rien ne la rappelle.
    await page.goto('/fr')

    const banniere = page.locator('main section').first()
    await expect(banniere.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(banniere.getByRole('link')).toHaveCount(1)
    await expect(
      banniere.getByRole('link', { name: 'Voir les pièces disponibles' }),
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
