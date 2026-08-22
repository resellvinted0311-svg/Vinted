import { test, expect, type Page } from '@playwright/test'

/**
 * Livrable de Phase 2 : du catalogue au bon de commande.
 *
 * Ces tests visent ce que le cahier des charges impose explicitement, et ce
 * qu'aucun test unitaire ne peut voir : ce qui est réellement écrit dans la
 * page servie au navigateur, et ce qui traverse réellement la frontière
 * serveur/client.
 *
 * ---------------------------------------------------------------------------
 * Le paiement n'est pas configuré dans cet environnement
 * ---------------------------------------------------------------------------
 * C'est délibéré : sans clé Stripe, aucun débit ne peut avoir lieu pendant les
 * tests. La boutique doit alors se dégrader HONNÊTEMENT — dire que le paiement
 * n'est pas disponible, plutôt que d'ouvrir un formulaire de carte mort. C'est
 * précisément ce que le dernier bloc vérifie.
 */

/** Une pièce du jeu de données, disponible et publiée. */
const SLUG = 'accessoires-levis-s-2'

/**
 * Le contenu RENDU, à l'exclusion de la charge utile RSC.
 *
 * Next dépose l'arbre serveur dans des balises `<script>`, et le texte y est
 * écrit en clair. Une recherche par texte sur la page entière trouve donc
 * chaque phrase DEUX fois : une dans le document, une dans les données. On
 * cherche dans la région principale, qui est ce que quelqu'un voit.
 */
function main(page: Page) {
  return page.locator('#contenu')
}

/** Le fond du panier appartient au cookie de session : on part toujours net. */
async function emptyBasket(page: Page): Promise<void> {
  await page.context().clearCookies()
}

async function addFirstAvailableToCart(page: Page): Promise<void> {
  await page.goto(`/fr/a/${SLUG}`)
  await page.getByRole('button', { name: 'Ajouter au panier' }).click()
  // Le message de confirmation prouve que l'action serveur a répondu, pas
  // seulement que le clic est parti.
  //
  // `.first()` : le composant de notification double son texte dans une
  // région `aria-live` pour les lecteurs d'écran. Deux nœuds portent donc la
  // même phrase, et c'est voulu.
  await expect(page.getByText('Ajoutée au panier').first()).toBeVisible()
}

test.describe('Du catalogue au panier', () => {
  test('une pièce ajoutée se retrouve au panier, avec sa référence', async ({
    page,
  }) => {
    await emptyBasket(page)
    await addFirstAvailableToCart(page)

    await page.goto('/fr/panier')

    await expect(page.getByRole('heading', { name: 'Panier' })).toBeVisible()
    // La référence d'inventaire est ce qui rattache la ligne à la pièce.
    await expect(main(page).getByText(/Réf\.\s*ART-/)).toBeVisible()
    await expect(main(page).getByText('1 pièce')).toBeVisible()
  })

  test('le panier n’annonce AUCUN montant de port', async ({ page }) => {
    // Le port dépend de la destination, que personne n'a encore donnée. Un
    // « à partir de » serait un chiffre qui change ensuite — ce qui fait
    // abandonner un panier, et relève de l'information trompeuse.
    await emptyBasket(page)
    await addFirstAvailableToCart(page)
    await page.goto('/fr/panier')

    await expect(
      main(page).getByText('Calculée à l’étape suivante'),
    ).toBeVisible()
    await expect(
      main(page).getByText('Connu une fois la livraison choisie'),
    ).toBeVisible()

    const body = (await main(page).textContent()) ?? ''
    expect(body).not.toMatch(/à partir de/i)
    expect(body).not.toMatch(/environ/i)
    expect(body).not.toMatch(/estimé/i)
  })

  test('retirer une pièce la retire, et le dit', async ({ page }) => {
    await emptyBasket(page)
    await addFirstAvailableToCart(page)
    await page.goto('/fr/panier')

    await page
      .getByRole('button', { name: /^Retirer .+ du panier$/ })
      .first()
      .click()

    await expect(main(page).getByText('Votre panier est vide.')).toBeVisible()
  })

  test('le compteur d’en-tête suit le panier', async ({ page }) => {
    await emptyBasket(page)

    await page.goto('/fr/catalogue')
    // Aucun compteur tant que le panier est vide : une pastille « 0 » qui
    // saute à « 1 » après coup est plus déroutante qu'une absence.
    await expect(page.locator('header').getByText('1', { exact: true })).toHaveCount(0)

    await addFirstAvailableToCart(page)
    await expect(
      page.locator('header').getByText('1', { exact: true }),
    ).toBeVisible()
  })
})

test.describe('Ce qui ne sort jamais dans la page', () => {
  test('aucun coût d’achat ni prix plancher dans le HTML du panier', async ({
    page,
  }) => {
    await emptyBasket(page)
    await addFirstAvailableToCart(page)
    await page.goto('/fr/panier')

    // On lit le HTML COMPLET, charge utile RSC comprise : un objet passé à un
    // composant client y voyage entier, y compris les propriétés que le
    // composant n'affiche pas.
    const html = await page.content()

    for (const forbidden of [
      'costCents',
      'floorPriceCents',
      'internalNotes',
      'reservedById',
      'costCentsSnapshot',
      'shippingCostCents',
      'carrierCostCents',
    ]) {
      expect(html, `champ privé « ${forbidden} » présent dans la page`).not.toContain(
        forbidden,
      )
    }
  })

  test('aucun coût interne dans ce que le tunnel envoie au navigateur', async ({
    page,
  }) => {
    // ATTENTION — le HTML ne suffit PAS ici, et l'avoir cru a produit un test
    // qui passait sur du code volontairement cassé.
    //
    // Le devis de port n'arrive pas dans la page : il est demandé par une
    // ACTION SERVEUR depuis le composant client, et revient dans le corps
    // d'une réponse POST. `page.content()` ne le voit jamais. On écoute donc
    // le réseau, et on inspecte ce qui traverse réellement.
    //
    // `carrierCostCents` est ce que le transporteur NOUS facture. Il est
    // reconstruit hors de la vue exprès, et c'est exactement le genre
    // d'omission qu'une refonte défait sans bruit.
    // On empile des PROMESSES, pas des chaînes : lire un corps est asynchrone,
    // et un écouteur `async` qui pousse son résultat plus tard laisse le
    // tableau vide au moment de l'assertion. Ce piège-là a déjà rendu ce test
    // vert sur du code volontairement cassé.
    const corps: Promise<string>[] = []
    page.on('response', (response) => {
      const url = response.url()
      if (!url.startsWith('http://localhost')) return
      corps.push(response.text().catch(() => ''))
    })

    await emptyBasket(page)
    await addFirstAvailableToCart(page)
    await page.goto('/fr/commande')

    await page.getByLabel('Pays').selectOption('FR')
    await page.getByLabel('Code postal').fill('59000')
    await expect(page.getByRole('radio')).not.toHaveCount(0, { timeout: 15_000 })
    await page.getByRole('radio').first().check()

    // Le HTML de la page compte aussi : un objet passé en propriété à un
    // composant client y voyage entier.
    const recueillis = await Promise.all(corps)
    const tout = [...recueillis, await page.content()].join('\n')
    expect(tout.length).toBeGreaterThan(1000)

    for (const forbidden of [
      'carrierCostCents',
      'costCents',
      'floorPriceCents',
      'costCentsSnapshot',
      'shippingCostCents',
      'internalNotes',
      'reservedById',
    ]) {
      expect(
        tout,
        `champ privé « ${forbidden} » envoyé au navigateur par le tunnel`,
      ).not.toContain(forbidden)
    }
  })

  test('le panier et la commande ne sont jamais indexables', async ({ page }) => {
    for (const path of ['/fr/panier', '/fr/commande', '/fr/commande/suivi']) {
      const response = await page.goto(path)
      const header = response?.headers()['x-robots-tag'] ?? ''
      expect(header, `en-tête manquant sur ${path}`).toContain('noindex')
    }
  })
})

test.describe('Le bon de commande', () => {
  test('un panier vide renvoie au panier EN L’EXPLIQUANT', async ({ page }) => {
    // Une redirection silencieuse est la même faute qu'un retrait silencieux.
    await emptyBasket(page)
    await page.goto('/fr/commande')

    await expect(page).toHaveURL(/\/fr\/panier\?renvoi=panier-vide/)
    await expect(
      main(page).getByText(/panier s’est vidé avant l’ouverture de la commande/),
    ).toBeVisible()
  })

  test('les modes de livraison n’apparaissent qu’une fois l’adresse donnée', async ({
    page,
  }) => {
    await emptyBasket(page)
    await addFirstAvailableToCart(page)
    await page.goto('/fr/commande')

    await expect(
      main(page).getByText(/Renseignez le pays et le code postal/),
    ).toBeVisible()

    await page.getByLabel('Pays').selectOption('FR')
    await page.getByLabel('Code postal').fill('59000')

    // Le devis part après une pause, puis vient de la base : on attend un
    // libellé de transporteur réel, pas un état de chargement.
    await expect(page.getByRole('radio')).not.toHaveCount(0, { timeout: 15_000 })

    // Le poids du colis est un fait mesuré, affiché parce qu'il explique le
    // prix sur une grille au palier.
    await expect(main(page).getByText(/Colis de .+, zone /)).toBeVisible()
  })

  test('le formulaire ne transporte AUCUN montant', async ({ page }) => {
    // Un champ caché portant le prix affiché suffirait à payer le port de son
    // choix depuis les outils de développement.
    await emptyBasket(page)
    await addFirstAvailableToCart(page)
    await page.goto('/fr/commande')

    await page.getByLabel('Pays').selectOption('FR')
    await page.getByLabel('Code postal').fill('59000')
    await expect(page.getByRole('radio')).not.toHaveCount(0, { timeout: 15_000 })
    await page.getByRole('radio').first().check()

    const names = await page
      .locator('form input, form select, form textarea')
      .evaluateAll((nodes) =>
        nodes
          .map((node) => (node as HTMLInputElement).name)
          .filter((name) => name.length > 0),
      )

    // Ce que le serveur lit, et rien de plus.
    for (const forbidden of [
      'shippingCents',
      'totalCents',
      'subtotalCents',
      'price',
      'amount',
      'articleId',
      'cartId',
    ]) {
      expect(names, `champ « ${forbidden} » transmis par le formulaire`).not.toContain(
        forbidden,
      )
    }

    // Et ce qu'il lit est bien là : des CODES, pas des prix.
    expect(names).toContain('carrierCode')
    expect(names).toContain('serviceCode')
  })

  test('sans paiement configuré, la boutique le dit au lieu d’ouvrir un formulaire mort', async ({
    page,
  }) => {
    await emptyBasket(page)
    await addFirstAvailableToCart(page)
    await page.goto('/fr/commande')

    await expect(
      main(page).getByText(/paiement n’est pas encore activé sur cette boutique/),
    ).toBeVisible()

    // Le bouton est éteint — mais la raison est visible juste au-dessus, dans
    // le même volet. Un bouton mort sans motif est une impasse.
    await expect(
      page.getByRole('button', { name: /^Commander/ }),
    ).toBeDisabled()
  })

  test('la mention de rétractation vient d’un réglage, pas du code', async ({
    page,
  }) => {
    await emptyBasket(page)
    await addFirstAvailableToCart(page)
    await page.goto('/fr/commande')

    // On vérifie qu'un délai EST affiché, sans figer sa valeur : c'est un
    // réglage en base, et l'écrire ici le recopierait en dur une seconde fois.
    await expect(
      main(page).getByText(/Vous disposez de \d+ jours après réception/),
    ).toBeVisible()
  })
})

test.describe('Le registre des commandes', () => {
  test('vide, il le dit — et prévient de ce qui le fait disparaître', async ({
    page,
  }) => {
    await emptyBasket(page)
    await page.goto('/fr/commande/suivi')

    await expect(
      main(page).getByText('Aucune commande pour l’instant.'),
    ).toBeVisible()
    // Sans compte, la liste tient au cookie : on le dit plutôt que de laisser
    // découvrir la disparition en changeant d'appareil.
    await expect(
      main(page).getByText(/cookie de session de ce navigateur/),
    ).toBeVisible()
  })

  test('un numéro de commande inconnu ne révèle pas s’il existe', async ({
    page,
  }) => {
    // Un numéro de commande est court et séquentiel : distinguer « inconnue »
    // de « pas à vous » dirait combien de commandes la boutique a reçues.
    await emptyBasket(page)
    await page.goto('/fr/commande/suivi/CMD-2026-000001')

    await expect(
      main(page).getByText('Nous ne retrouvons pas cette commande.'),
    ).toBeVisible()
  })
})
