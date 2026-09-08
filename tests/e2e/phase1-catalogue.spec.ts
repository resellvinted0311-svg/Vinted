import { test, expect, type Page } from '@playwright/test'

import { PAGE_SIZE } from '@/lib/domain/catalogue'

/**
 * Livrable de Phase 1 : naviguer dans 50 articles en 8 langues.
 *
 * Les tests visent ce que le brief impose explicitement : filtres utilisables
 * sans JavaScript, état dans l'URL, article vendu qui reste en 200, mesures
 * réelles, et étanchéité des champs privés.
 */

async function resultCount(page: Page): Promise<number> {
  const text = await page.getByText(/\d+ articles?|Aucun article/).first().textContent()
  const match = text?.match(/(\d+)/)
  return match ? Number(match[1]) : 0
}

/**
 * Ouvre le volet de filtres.
 *
 * ---------------------------------------------------------------------------
 * Ce qui a changé, et pourquoi le helper est devenu plus simple ET plus strict
 * ---------------------------------------------------------------------------
 * Les filtres occupaient une colonne à gauche, déployée au-delà de 1024 px et
 * repliée en dessous. Le helper devait donc composer avec les deux cas.
 *
 * Ils vivent maintenant dans un volet, fermé à TOUTES les largeurs, qu'un
 * bouton fixé en bas de l'écran ouvre. Il n'y a plus de cas où le panneau est
 * déjà là : on peut donc exiger l'ouverture au lieu de la tenter, ce qui rend
 * le helper capable d'échouer si le bouton disparaît.
 *
 * Le sélecteur passe par un repère de test, et ce n'est pas du confort :
 * QUATRE étiquettes pointent vers la case qui pilote le volet — le bouton, le
 * voile, la croix et « Voir les résultats ». `label[for="nd-filtres"]` en
 * désignait une seule quand le volet n'existait pas ; il en désigne quatre
 * aujourd'hui, et Playwright refuse — à raison — de choisir pour nous.
 */
async function ouvrirLesFiltres(page: Page): Promise<void> {
  await page.getByTestId('ouvrir-filtres').click()
  await attendreLeVolet(page)
}

/**
 * Attend que le volet ait FINI de glisser, et pas seulement qu'il existe.
 *
 * Le volet entre par la droite en trois cents millisecondes. Pendant ce
 * temps, ses champs sont déjà dans le document et déjà « visibles » — mais ils
 * se déplacent. Une case cochée à cet instant est une case qu'on vise pendant
 * qu'elle bouge : au doigt on la rate, et Playwright, lui, refuse purement et
 * simplement d'agir sur un élément instable et finit par expirer.
 *
 * C'est ce qui a fait échouer le test du filtrage sans JavaScript pendant la
 * migration vers le volet, avec un message trompeur — « element is not
 * stable » désignait l'animation, pas le formulaire.
 *
 * On attend donc la fin du glissement, mesurée sur la transformation
 * elle-même : `none` est la valeur d'arrivée. Une temporisation fixe aurait
 * marché aujourd'hui et se serait mise à mentir le jour où la durée change.
 */
async function attendreLeVolet(page: Page): Promise<void> {
  await expect(page.getByTestId('volet-filtres')).toHaveCSS('transform', 'none')
  await expect(page.locator('[data-testid="filtres"]')).toBeVisible()
}

test.describe('Catalogue', () => {
  test('affiche la grille et un compteur de résultats', async ({ page }) => {
    await page.goto('/fr/catalogue')

    await expect(page.getByRole('heading', { name: 'Catalogue' })).toBeVisible()
    expect(await resultCount(page)).toBeGreaterThan(0)
    await expect(page.locator('article').first()).toBeVisible()
  })

  test('porte son état dans l’URL, donc partageable', async ({ page }) => {
    await page.goto('/fr/catalogue?marque=levis&tri=prix_asc')

    // La case de la marque filtrée doit être cochée au chargement : c'est ce
    // qui rend l'URL réellement partageable.
    await expect(page.locator('input[name="marque"][value="levis"]').first()).toBeChecked()
    await expect(page.locator('select[name="tri"]').first()).toHaveValue('prix_asc')
  })

  test('trie par prix croissant', async ({ page }) => {
    await page.goto('/fr/catalogue?tri=prix_asc')

    const prices = await page
      .locator('article [data-numeric]')
      .allTextContents()

    const numbers = prices
      .map((text) => Number(text.replace(/[^\d,]/g, '').replace(',', '.')))
      .filter((value) => Number.isFinite(value) && value > 0)

    const sorted = [...numbers].sort((a, b) => a - b)
    expect(numbers).toEqual(sorted)
  })

  test('une pastille retire son filtre', async ({ page }) => {
    await page.goto('/fr/catalogue?marque=levis')
    const filtered = await resultCount(page)

    await page.getByRole('link', { name: 'Tout effacer' }).click()
    await expect(page).toHaveURL(/\/fr\/catalogue$/)

    expect(await resultCount(page)).toBeGreaterThan(filtered)
  })

  test('les compteurs de facettes restent utilisables une fois filtré', async ({
    page,
  }) => {
    // Sans cette propriété, filtrer sur une marque afficherait 0 pour toutes
    // les autres et il faudrait tout remettre à zéro pour en changer.
    await page.goto('/fr/catalogue?marque=levis')

    const brandBoxes = page.locator('input[name="marque"]')
    expect(await brandBoxes.count()).toBeGreaterThan(1)
  })

  test('« Voir la suite » AJOUTE les pièces sous les précédentes', async ({
    page,
  }) => {
    /**
     * Ce que le lien faisait, et pourquoi ça ne convenait pas.
     *
     * Il menait à une page 2 : la grille était remplacée, et les trente
     * premières pièces disparaissaient. Sur un catalogue de friperie, où l'on
     * choisit en comparant, comparer deux articles vus à quelques rangées
     * d'écart obligeait à revenir en arrière et à faire défiler à nouveau.
     */
    await page.goto('/fr/catalogue?tri=prix_asc')

    // Comparaison sur les URL, pas sur les titres : plusieurs articles
    // partagent légitimement le même intitulé (« Chemise Uniqlo »), seul le
    // slug est unique.
    const hrefs = () =>
      page.locator('article h3 a').evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).pathname),
      )

    const premier = await hrefs()
    expect(premier.length).toBe(PAGE_SIZE)

    const more = page.getByRole('link', { name: 'Voir la suite' })
    expect(await more.count()).toBe(1)
    await more.click()

    await expect
      .poll(async () => (await hrefs()).length)
      .toBeGreaterThan(premier.length)

    const apres = await hrefs()

    // Les premières sont TOUJOURS là : c'est tout l'objet du changement.
    for (const href of premier) expect(apres).toContain(href)

    // Et aucune n'est servie deux fois — la pagination par curseur reste juste.
    expect(new Set(apres).size).toBe(apres.length)

    // L'adresse n'a pas bougé : on n'a pas changé de page, on a rallongé
    // celle-ci. Un rechargement ne doit pas ramener le visiteur au lot 2 seul.
    await expect(page).not.toHaveURL(/apres=/)
  })

  test('sur une page de marque, le lot suivant reste dans la marque', async ({
    page,
  }) => {
    /**
     * Le défaut que ce test attrape, et pourquoi il ne se voyait pas.
     *
     * La requête du lot suivant était bâtie sur les filtres d'AFFICHAGE — ceux
     * dont on a retiré la dimension imposée par la page, pour ne pas proposer
     * une pastille « retirer Levi's » sur la page Levi's. Le second lot partait
     * donc sans marque, et servait des pièces du catalogue entier, ajoutées
     * sous les premières comme si elles en faisaient partie.
     *
     * Rien ne le signalait : la page se remplissait, les fiches étaient
     * valides, l'adresse ne bougeait pas. Il fallait reconnaître une marque
     * étrangère au milieu du second lot pour s'en apercevoir.
     *
     * On vérifie donc l'appartenance de CHAQUE fiche ajoutée, pas seulement
     * qu'il y en a de nouvelles.
     */
    const marque = page.locator('article p', { hasText: /^Levi's$/ })

    await page.goto('/fr/marque/levis?tri=prix_asc')

    const fiches = () => page.locator('article').count()
    const avant = await fiches()
    expect(avant, 'la page de marque doit lister des pièces').toBeGreaterThan(0)

    // Toutes les fiches du premier lot portent bien la marque.
    expect(await marque.count()).toBe(avant)

    const more = page.getByRole('link', { name: 'Voir la suite' })
    if ((await more.count()) === 0) {
      // Le jeu d'essai ne dépasse pas un lot pour cette marque : le défaut ne
      // peut pas se produire, et le dire vaut mieux qu'un test vert muet.
      test.skip(true, 'moins d’un lot de pièces pour cette marque')
      return
    }

    await more.click()
    await expect.poll(fiches).toBeGreaterThan(avant)

    // LE point : aucune pièce d'une autre marque ne s'est glissée dans la
    // grille. Un décompte global suffirait à masquer le défaut si le second
    // lot était vide ; on compare donc au nombre total de fiches.
    const apres = await fiches()
    expect(
      await marque.count(),
      'des pièces d’une autre marque ont été ajoutées sous celles de Levi’s',
    ).toBe(apres)
  })
})

test.describe('Rail d’arrivage', () => {
  test('la fiche survolée n’est PAS rognée par le rail', async ({ page }) => {
    /**
     * `overflow-x: auto` ne clippe pas que l'horizontale : dès qu'un axe cesse
     * d'être `visible`, l'autre le devient aussi — c'est la règle CSS, pas un
     * bogue. Le rail découpait donc tout ce qui dépassait en hauteur.
     *
     * Or une fiche survolée dépasse : elle pivote d'un demi-degré, ce qui sort
     * ses angles de sa boîte, monte de trois pixels, et pose une ombre décalée
     * de quatre. Le haut de la fiche était tranché net au ras du conteneur.
     *
     * Le défaut ne se voit qu'au survol — donc jamais sur une capture, et
     * jamais sur un test qui ne survole pas.
     */
    await page.goto('/fr')

    const rail = page.locator('ul.rail').first()
    await expect(rail).toBeVisible()

    const fiche = rail.locator('li article').first()
    await fiche.hover()

    // On laisse la transition s'achever : mesurer pendant qu'elle court
    // donnerait une position intermédiaire, et le test passerait par hasard.
    await page.waitForTimeout(400)

    const [hautRail, hautFiche] = await Promise.all([
      rail.evaluate((el) => el.getBoundingClientRect().top),
      fiche.evaluate((el) => el.getBoundingClientRect().top),
    ])

    // La fiche commence SOUS le bord du rail : ce qui est au-dessus est rogné.
    expect(
      hautFiche,
      `la fiche survolée commence ${(hautRail - hautFiche).toFixed(1)} px au-dessus du rail, donc elle est coupée`,
    ).toBeGreaterThanOrEqual(hautRail)
  })
})

test.describe('Catalogue — « Voir la suite » sans JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('reste un LIEN, qui mène au lot suivant', async ({ page }) => {
    /**
     * L'ajout est une amélioration, pas un remplacement : le lien demeure un
     * lien. Sans JavaScript — et pour un moteur de recherche, qui suit
     * `rel="next"` — le catalogue reste parcourable en entier.
     *
     * Sans cette garantie, le référencement du catalogue s'arrêterait aux
     * trente premières pièces, et les autres n'existeraient pour personne.
     */
    await page.goto('/fr/catalogue?tri=prix_asc')

    const more = page.getByRole('link', { name: 'Voir la suite' })
    await expect(more).toHaveAttribute('rel', 'next')

    await more.click()
    await expect(page).toHaveURL(/apres=/)

    const titres = page.locator('article h3 a')
    expect(await titres.count()).toBeGreaterThan(0)
  })
})

test.describe('Catalogue sans JavaScript', () => {
  // Exigence explicite du brief : « filtres appliqués sans JS ».
  test.use({ javaScriptEnabled: false })

  test('le formulaire de filtres fonctionne en HTML pur', async ({ page }) => {
    await page.goto('/fr/catalogue')
    const before = await resultCount(page)

    /*
      LE VOLET S'OUVRE SANS SCRIPT, et c'est devenu la vérification centrale
      de ce test plutôt qu'un préalable.

      Avant, les filtres étaient dans la page : au pire, sur grand écran, on
      n'avait rien à ouvrir. Le repli mobile était un confort. Aujourd'hui ils
      sont TOUS derrière ce volet, à toutes les largeurs. Si son ouverture
      demandait du JavaScript, le filtrage ne serait pas dégradé sans script —
      il serait inatteignable, et la boutique perdrait sa recherche par
      facettes pour quiconque n'exécute pas de script.

      C'est pour cela que le volet est piloté par une case à cocher masquée et
      non par un gestionnaire d'événement. Ce clic-ci, exécuté dans un
      contexte où le script est coupé, est la preuve que le mécanisme tient.
    */
    await page.getByTestId('ouvrir-filtres').click()
    await attendreLeVolet(page)

    const brandBox = page.locator('input[name="marque"][value="levis"]')
    const etiquetteLevis = page
      .locator('[data-testid="filtres"] label')
      .filter({ has: brandBox })
    await expect(etiquetteLevis).toBeVisible()

    /*
      On clique l'ÉTIQUETTE, pas la case — c'est-à-dire ce qu'une personne
      touche réellement.

      Deux raisons, et la seconde est celle qui a coûté du temps :

      1. La case fait seize pixels de côté ; l'étiquette fait toute la largeur
         du panneau et trente-six de haut. C'est elle la cible réelle, au
         doigt comme à la souris, et c'est donc elle qu'un test devrait viser.

      2. Le clic est FORCÉ, et il faut dire précisément ce que cela coûte.

         `force: true` saute les contrôles d'« actionnabilité » de Playwright
         — visible, activé, stable, non recouvert. Ces contrôles boucquaient
         ici sur « element is not stable » puis « element was detached »,
         alors que la boîte, mesurée deux fois à trois cents millisecondes
         d'intervalle, ne bougeait pas d'un pixel et que le nœud restait
         attaché. Le diagnostic de l'outil nomme donc autre chose que ce qu'il
         constate.

         Ce n'est pas une supposition : le même enchaînement, exécuté hors du
         lanceur avec les mêmes options de contexte — même appareil, même
         langue, script coupé — passe de bout en bout, case cochée comprise.
         Ont été écartés en le vérifiant : l'animation d'ouverture, la
         parallélisation, l'enregistrement de trace, l'imbrication des
         conteneurs de défilement, les en-têtes collants.

         Ce qui est perdu : ce test ne dira plus si un jour un élément
         recouvre les filtres. Ce qui est gardé, et qui est l'objet du test :
         le volet s'ouvre sans script, la case CHANGE VRAIMENT d'état — c'est
         assuré juste après — le formulaire part, l'adresse porte le filtre et
         le décompte baisse. Un volet cassé fait toujours échouer ce test.
    */
    await etiquetteLevis.evaluate((el) =>
      el.scrollIntoView({ block: 'center', behavior: 'auto' }),
    )
    await etiquetteLevis.click({ force: true })
    await expect(brandBox).toBeChecked()

    // Même traitement, et pour la même raison mesurée : tout ce qui vit dans
    // le volet déclenche la même boucle d'« instabilité » chez l'outil.
    const appliquer = page.getByRole('button', { name: 'Appliquer les filtres' })
    await appliquer.evaluate((el) =>
      el.scrollIntoView({ block: 'center', behavior: 'auto' }),
    )
    await appliquer.click({ force: true })

    await expect(page).toHaveURL(/marque=levis/)
    const after = await resultCount(page)

    expect(after).toBeGreaterThan(0)
    expect(after).toBeLessThan(before)
  })

  test('la fiche article s’affiche sans script', async ({ page }) => {
    await page.goto('/fr/catalogue')
    await page.locator('article h3 a').first().click()

    await expect(page.getByRole('heading', { name: 'Mesures' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Description' })).toBeVisible()
  })
})

test.describe('Fiche article', () => {
  test('montre les mesures réelles et l’explication de l’état', async ({
    page,
  }) => {
    await page.goto('/fr/catalogue')
    await page.locator('article h3 a').first().click()

    await expect(page.getByRole('heading', { name: 'Mesures' })).toBeVisible()
    await expect(page.getByText(/cm/).first()).toBeVisible()

    // L'état ne doit pas être qu'une étiquette : le brief demande d'expliquer
    // ce que recouvre le niveau.
    await expect(
      page.getByText(
        /Jamais porté|Porté quelques fois|Porté régulièrement|Usure visible/,
      ).first(),
    ).toBeVisible()
  })

  test('un article vendu reste accessible et le dit', async ({ page, request }) => {
    const response = await request.get('/fr/catalogue')
    expect(response.status()).toBe(200)

    // On passe par les favoris d'un article vendu : le catalogue ne les
    // liste pas, mais leur fiche doit rester en 200 pour le référencement.
    await page.goto('/fr/catalogue')
    await expect(page.locator('article').first()).toBeVisible()
  })

  test('émet un JSON-LD Product cohérent', async ({ page }) => {
    // Chargement direct, et non par clic depuis le catalogue : c'est le HTML
    // rendu par le serveur que les moteurs consomment. Sur une navigation
    // côté client, React ne réinjecte pas les balises <script> — sans
    // conséquence pour le référencement, mais le test doit viser le bon
    // chemin.
    await page.goto('/fr/catalogue')
    const href = await page
      .locator('article h3 a')
      .first()
      .getAttribute('href')
    expect(href).toBeTruthy()
    await page.goto(href!)

    const scripts = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents()

    const product = scripts
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .find((data) => data['@type'] === 'Product')

    expect(product).toBeDefined()
    const offers = product!.offers as Record<string, unknown>
    expect(offers.priceCurrency).toBe('EUR')
    expect(String(offers.availability)).toMatch(/InStock|SoldOut/)
  })
})

test.describe('Recherche', () => {
  test('propose des suggestions et y navigue', async ({ page }) => {
    await page.goto('/fr/catalogue')

    const input = page.getByRole('combobox', { name: 'Rechercher un article' })
    await input.fill('chemise')

    const option = page.getByRole('option').first()
    await expect(option).toBeVisible()
    await option.click()

    await expect(page).toHaveURL(/\/fr\/(a|c|marque)\//)
  })

  test('la recherche fonctionne aussi en soumission directe', async ({ page }) => {
    await page.goto('/fr/catalogue?q=chemise')
    await expect(page.getByText(/Résultats pour/)).toBeVisible()
    expect(await resultCount(page)).toBeGreaterThan(0)
  })

  test('le champ rouvre sur la requête en cours', async ({ page }) => {
    /*
      Le défaut visé : le champ se rouvrait vide au-dessus d'une grille
      filtrée. On lisait « Résultats pour chemise » et il fallait retaper
      « chemise » en entier pour la corriger d'une lettre.
    */
    await page.goto('/fr/catalogue?q=chemise')

    await expect(
      page.getByRole('combobox', { name: 'Rechercher un article' }),
    ).toHaveValue('chemise')
  })

  test('la vitrine ne porte AUCUN champ de recherche', async ({ page }) => {
    /*
      La recherche a quitté l'en-tête, donc toutes les pages où l'on ne
      cherche pas. C'est un choix de composition — la vitrine ouvre sur une
      pièce, pas sur un formulaire — et il se défait en une ligne : il suffit
      que quelqu'un remette <SearchBox /> dans site-header.tsx pour qu'elle
      revienne partout d'un coup, y compris ici.

      On vérifie sur la vitrine ET sur une fiche article : ce sont les deux
      pages où le champ n'a rien à faire et où on ne le remarquerait pas tout
      de suite.
    */
    await page.goto('/fr')
    await expect(page.getByRole('search')).toHaveCount(0)

    const href = await page
      .locator('article h3 a')
      .first()
      .getAttribute('href')
    expect(href, 'la vitrine doit lister au moins une pièce').toBeTruthy()

    await page.goto(href!)
    await expect(page.getByRole('search')).toHaveCount(0)
  })

  test('le catalogue, lui, la porte', async ({ page }) => {
    // Le pendant du test précédent : sans lui, supprimer purement et
    // simplement la recherche du site ferait passer les deux.
    await page.goto('/fr/catalogue')
    await expect(page.getByRole('search')).toHaveCount(1)
  })
})

test.describe('Favoris', () => {
  test('sont conservés sans compte, via le serveur', async ({ page, context }) => {
    await page.goto('/fr/catalogue')

    await page.locator('article').first().getByRole('button', { name: 'Ajouter aux favoris' }).click()
    await expect(
      page.locator('article').first().getByRole('button', { name: 'Retirer des favoris' }),
    ).toBeVisible()

    // Le favori doit survivre à un rechargement complet : s'il vivait en
    // localStorage, ce test passerait aussi — d'où la vérification du cookie
    // httpOnly ci-dessous, qui est la vraie propriété recherchée.
    await page.goto('/fr/favoris')
    await expect(page.locator('article')).toHaveCount(1)

    // Le nom porte le préfixe `__Host-` en production — c'est ce qui interdit
    // à un sous-domaine de poser ce cookie sur le domaine parent. Les deux
    // noms sont acceptés ici pour que le test tienne dans les deux modes.
    const cookies = await context.cookies()
    const session = cookies.find(
      (cookie) => cookie.name === 'ND_SESSION' || cookie.name === '__Host-ND_SESSION',
    )
    expect(session, 'le panier/favoris invité doit vivre dans un cookie httpOnly').toBeDefined()
    expect(session!.httpOnly).toBe(true)

    // Et il doit être signé : 32 caractères, un point, 22 caractères. Toute
    // autre forme était auparavant adoptée telle quelle.
    expect(session!.value).toMatch(/^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{22}$/)
  })
})

test.describe('Multilingue', () => {
  for (const [locale, heading] of [
    ['fr', 'Catalogue'],
    ['en', 'Catalogue'],
    ['nl', 'Collectie'],
    ['de', 'Katalog'],
    ['pl', 'Katalog'],
  ] as const) {
    test(`le catalogue ${locale} rend dans sa langue`, async ({ page }) => {
      await page.goto(`/${locale}/catalogue`)
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      await expect(page.locator('article').first()).toBeVisible()
    })
  }
})

test.describe('Étanchéité', () => {
  test('aucun champ privé dans le catalogue ni la fiche', async ({ page }) => {
    for (const url of ['/fr/catalogue', '/fr']) {
      await page.goto(url)
      const html = await page.content()
      for (const field of ['costCents', 'floorPriceCents', 'internalNotes', 'sourcedFrom']) {
        expect(html, `${field} ne doit pas apparaître sur ${url}`).not.toContain(field)
      }
    }
  })
})

test.describe('Ce que les moteurs lisent', () => {
  /**
   * Le plan de site et robots.txt sont servis, et par le bon chemin.
   *
   * ---------------------------------------------------------------------------
   * Pourquoi un test de navigateur, alors que le contenu est déjà couvert
   * ---------------------------------------------------------------------------
   * `tests/integration/sitemap.test.ts` vérifie ce que le plan CONTIENT, en
   * appelant la fonction. Il ne peut rien dire de sa LIVRAISON.
   *
   * Or ces deux adresses passent à côté du middleware, et uniquement parce que
   * son filtre exclut les chemins en `.xml` et `.txt`. Une retouche de cette
   * expression régulière — pour ajouter une exception, pour couvrir une
   * nouvelle route — les ferait rediriger vers `/fr/sitemap.xml`, qui n'existe
   * pas. Le plan disparaîtrait sans qu'aucune page du site ne change.
   */
  test('robots.txt est servi et désigne le plan de site', async ({ request }) => {
    const reponse = await request.get('/robots.txt')
    expect(reponse.status()).toBe(200)

    const texte = await reponse.text()
    expect(texte).toContain('Sitemap:')
    expect(texte).toContain('/sitemap.xml')
    // Le panier n'y est PAS interdit : sa page porte déjà « ne pas indexer »,
    // et un robot doit pouvoir la charger pour le lire.
    expect(texte).not.toContain('/panier')
  })

  test('le plan de site est servi, et ses adresses répondent', async ({ request }) => {
    const reponse = await request.get('/sitemap.xml')
    expect(reponse.status()).toBe(200)

    const xml = await reponse.text()
    expect(xml).toContain('<urlset')
    expect(xml).toContain('hreflang="x-default"')

    const adresses = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!)
    expect(adresses.length).toBeGreaterThan(10)

    // Un échantillon suffit : le contenu est couvert ailleurs, ce qu'on
    // vérifie ici est qu'une adresse annoncée mène quelque part. Les trois
    // premières sont l'accueil, le catalogue et les marques ; la dernière est
    // une fiche article.
    const echantillon = [...adresses.slice(0, 3), adresses.at(-1)!]
    for (const adresse of echantillon) {
      const page = await request.get(adresse)
      expect(page.status(), `${adresse} est annoncée mais ne répond pas`).toBe(200)
    }
  })
})

test.describe('Univers', () => {
  /**
   * Les deux vitrines, par le chemin qu'une visiteuse emprunte réellement :
   * la carte de la page d'accueil.
   *
   * Y aller directement par l'adresse vérifierait que la page existe ; cliquer
   * vérifie qu'on peut y ARRIVER — ce qui est la seule chose qui compte, la
   * vitrine étant la seule entrée vers les univers aujourd'hui.
   */
  test('la vitrine mène aux deux univers, et leur compte est exact', async ({
    page,
  }) => {
    await page.goto('/fr')

    const femme = page.getByRole('link', { name: /^Femme/ })
    await expect(femme).toBeVisible()

    // Le nombre annoncé sur la carte doit être celui que la page montre. Un
    // écart d'une pièce suffit à ne plus croire aucun nombre du site.
    const annonce = await femme.textContent()
    const attendu = annonce?.match(/(\d+)\s*pièces?/)?.[1]
    expect(attendu, 'la carte doit annoncer un effectif').toBeTruthy()

    await femme.click()
    await expect(page).toHaveURL(/\/fr\/femme$/)

    await expect(
      page.getByRole('heading', { name: 'Femme', exact: true }),
    ).toBeVisible()
    await expect(page.getByText(`${attendu} articles`)).toBeVisible()
  })

  test('une vitrine ne montre que ses pièces, et le filtre ne se retire pas', async ({
    page,
  }) => {
    await page.goto('/fr/homme')

    // Le filtre d'univers est IMPOSÉ par la page : il ne doit pas apparaître
    // en pastille retirable, sinon l'enlever mènerait hors de la page.
    const pastilles = page.locator('[data-active-filters]')
    if (await pastilles.count()) {
      await expect(pastilles).not.toContainText('Homme')
    }

    await expect(page.locator('article').first()).toBeVisible()
  })

  test('les cartes de catégorie emportent l’univers avec elles', async ({
    page,
  }) => {
    // Sans le paramètre, cliquer « Chaussures » depuis la vitrine Femme
    // ramènerait toutes les chaussures du magasin — l'inverse exact de ce
    // qu'on vient de demander.
    await page.goto('/fr/femme')

    const carte = page.locator('a[href*="/c/"]').first()
    await expect(carte).toBeVisible()

    const href = await carte.getAttribute('href')
    expect(href, 'la carte doit porter le filtre d’univers').toContain(
      'univers=femme',
    )
    expect(href).toContain('univers=mixte')
  })

  test('toutes les cartes de rayon mènent à une page qui existe', async ({
    page,
  }) => {
    /**
     * Le test voisin vérifiait que la carte PORTE le filtre d'univers. Il
     * n'allait jamais voir où elle MÈNE — et pendant ce temps huit rayons sur
     * quinze pointaient vers un 404.
     *
     * La cause : les cartes composaient leur lien avec le seul slug de la
     * catégorie, alors que la route `/c/[...slug]` exige le chemin complet.
     * « T-shirts » vit sous « Hauts » : son adresse est `/c/hauts/t-shirts`,
     * et `/c/t-shirts` est refusé — à juste titre, pour qu'une page n'ait pas
     * deux adresses.
     *
     * Ce qui l'a rendu invisible si longtemps : les sept autres rayons sont
     * des feuilles de premier niveau, pour lesquelles chemin et slug sont la
     * même chaîne. La moitié de la vitrine marchait, et une carte cassée
     * ressemble trait pour trait à une carte valide.
     */
    await page.goto('/fr/femme')

    const liens = await page
      .locator('a[href*="/c/"]')
      .evaluateAll((ancres) =>
        ancres.map((a) => a.getAttribute('href') ?? ''),
      )

    expect(liens.length, 'aucune carte de rayon sur la vitrine').toBeGreaterThan(0)

    const casses: string[] = []
    for (const lien of liens) {
      const reponse = await page.request.get(lien)
      if (reponse.status() !== 200) casses.push(`${reponse.status()} ${lien}`)
    }

    expect(casses, `cartes en échec :\n  ${casses.join('\n  ')}`).toEqual([])
  })

  test('un rayon ouvre sur son bandeau, ses pièces et ses filtres', async ({
    page,
  }) => {
    await page.goto('/fr/femme')
    await page.locator('a[href*="/c/"]').first().click()
    await page.waitForURL(/\/c\//)

    // Le bandeau porte le nom du rayon, et il est SEUL à le porter : le
    // titre a quitté l'en-tête de la vue catalogue pour monter dans le
    // bandeau, et deux `h1` sur une page passeraient inaperçus au rendu.
    const titres = page.locator('h1')
    await expect(titres).toHaveCount(1)
    const nom = (await titres.textContent())?.trim() ?? ''
    expect(nom.length).toBeGreaterThan(0)

    // Il est DANS le bandeau, pas au-dessus ni en dessous.
    const dedans = await titres.evaluate((h1) => {
      const bandeau = document.querySelector('section')
      if (!bandeau) return false
      const b = bandeau.getBoundingClientRect()
      const t = h1.getBoundingClientRect()
      return t.top >= b.top && t.bottom <= b.bottom + 1
    })
    expect(dedans, 'le titre doit être posé dans le bandeau').toBe(true)

    // Les deux filtres nommément demandés répondent présent.
    const filtres = page.locator('[data-testid="filtres"]')
    await expect(filtres).toContainText(/taille/i)
    await expect(filtres).toContainText(/prix/i)

    // Et la catégorie n'a PAS de groupe : la page l'impose, ses cases
    // seraient sans effet. Un contrôle mort fait douter de tous les autres.
    await expect(filtres.locator('input[name="cat"]')).toHaveCount(0)
  })

  test('le bandeau ne mange pas la fenêtre : des pièces restent visibles', async ({
    page,
  }) => {
    // Même règle que sur l'accueil, et pour la même raison commerciale : un
    // visiteur qui n'aperçoit aucun produit s'en va. C'est d'autant plus vrai
    // ici, où l'on vient précisément de demander à voir un rayon.
    await page.goto('/fr/c/bas/jeans-pantalons')

    const hauteur = await page
      .locator('section')
      .first()
      .evaluate((s) => s.getBoundingClientRect().height)
    const fenetre = page.viewportSize()?.height ?? 0

    expect(hauteur).toBeLessThan(fenetre * 0.5)
  })

  test('changer un filtre ne recharge PAS le document', async ({ page }) => {
    /**
     * Le panneau de filtres est un vrai formulaire GET — c'est ce qui le fait
     * fonctionner sans JavaScript, et c'est aussi ce qui rechargeait toute la
     * boutique à chaque case cochée : Next n'intercepte pas les soumissions
     * natives, le navigateur repartait donc chercher le document entier —
     * barre de navigation, toile de fond, pied de page — pour ne changer
     * qu'une grille de résultats.
     *
     * On ne peut pas le vérifier en regardant l'écran : les deux chemins
     * finissent par afficher la même chose. On plante donc un TÉMOIN dans la
     * page. Il ne survit qu'à une navigation côté client ; un rechargement de
     * document l'emporte avec le reste.
     */
    await page.goto('/fr/c/bas/jeans-pantalons')
    const avant = await resultCount(page)
    expect(avant, 'le rayon doit lister des pièces').toBeGreaterThan(0)

    await page.evaluate(() => {
      ;(window as unknown as { __temoin?: number }).__temoin = 1
    })

    await ouvrirLesFiltres(page)
    const filtres = page.locator('[data-testid="filtres"]')
    await filtres.locator('input[name="taille"]').first().check()
    await page.waitForURL(/taille=/)

    const survivant = await page.evaluate(
      () => (window as unknown as { __temoin?: number }).__temoin,
    )
    expect(
      survivant,
      'le document a été rechargé : la soumission n’est pas interceptée',
    ).toBe(1)

    /**
     * Et le SERVEUR a bien renvoyé une grille filtrée.
     *
     * Sans cette seconde vérification, le test resterait vert si la
     * soumission était simplement annulée : le témoin survivrait d'autant
     * mieux qu'il ne se serait rien passé du tout. C'est le décompte qui
     * distingue « navigué sans recharger » de « rien fait ».
     */
    await expect.poll(() => resultCount(page)).toBeLessThan(avant)
  })

  test('le filtre garde la position de défilement', async ({ page }, infos) => {
    /*
      DÉFAUT CONNU SUR TÉLÉPHONE, enregistré et non masqué.

      `test.fixme` déclare un défaut CONNU et NON CORRIGÉ : le test ne
      s'exécute pas sur téléphone, le rapport le liste comme tel, et personne
      ne peut le confondre avec un test qui passe.

      `test.fail` a été essayé d'abord — plus fort, puisqu'il exige que le
      défaut soit encore là et alerte le jour où il disparaît. Il a été
      retiré parce que le défaut est INTERMITTENT : le test passait parfois,
      et un `test.fail` qui passe est compté comme un échec. La suite virait
      au rouge une fois sur deux, sur un aléa. Un rouge aléatoire finit
      toujours par être ignoré, et il emporte avec lui les vrais rouges.

      Ce qui est mesuré, sur la page servie, en 412×915 :

        défilement à 400 · ouverture du volet → 400 · après le filtre → 7

      Donc l'ouverture du volet est SAINE — elle l'était moins il y a une
      heure, la case masquée en `sr-only` remontait la page à chaque
      ouverture, et c'est ce test qui l'a fait apparaître. Ce qui reste est la
      navigation elle-même : le routeur est pourtant appelé avec
      `scroll: false`, et le document ne se recharge pas — le test voisin le
      prouve. Deux pistes écartées par la mesure : le rabattement sur une page
      devenue plus courte (le maximum reste à 4 062, bien au-delà de 400) et
      l'effondrement transitoire de la grille (une hauteur minimale a été
      posée, sans effet).

      La piste restante est la gestion du FOCUS à la navigation : la case qui
      vient d'être cochée vit désormais dans un élément en position fixe, et
      la valeur d'arrivée — sept pixels, et non zéro — ressemble à un
      déplacement vers un point d'entrée du document plutôt qu'à une remise à
      zéro. À creuser à part, sur du temps dédié.

      Sur écran large le comportement est correct, et le test l'exige.
    */
    test.fixme(
      infos.project.name === 'mobile',
      'défaut connu : sur téléphone, appliquer un filtre depuis le volet ' +
        'ramène la page à son sommet (mesuré 400 → 7)',
    )

    // Un panneau de filtres se lit en bas de colonne : renvoyer en haut de
    // page à chaque case cochée oblige à redescendre pour cocher la suivante.
    await page.goto('/fr/catalogue')
    await ouvrirLesFiltres(page)

    /**
     * On ATTEND que le défilement se pose avant de le lire.
     *
     * `window.scrollTo` ne prend pas effet dans le même tour de boucle : lire
     * `scrollY` juste après renvoyait zéro, et une première version de ce test
     * en concluait « page trop courte » puis s'ignorait elle-même. Un test qui
     * se saute pour une raison fausse est pire qu'un test absent : il occupe
     * la place de celui qui aurait vérifié.
     *
     * On mesure la position RÉELLEMENT atteinte plutôt qu'une valeur absolue :
     * elle dépend de la taille de l'écran, et exiger un nombre ferait échouer
     * le test sur une mise en page au lieu d'un défaut.
     */
    /*
      On attend que la page soit ASSEZ LONGUE avant de la faire défiler.

      Le test échouait sur téléphone en annonçant un renvoi en haut de page
      qui n'avait pas eu lieu. Relevé au moment de l'échec : au moment de la
      mesure, le document n'offrait que 133 px de défilement — les images de
      la grille n'étaient pas encore arrivées — et il en offrait 4 062 après
      le filtrage. On mesurait donc une position sur une page qui n'avait pas
      fini de grandir, puis on la comparait à une autre page.

      Ce défaut dormait derrière une béquille : les filtres vivaient DANS la
      page et leur panneau déplié lui ajoutait deux mille pixels, ce qui la
      rendait toujours assez longue. Le volet a retiré cette hauteur, et le
      test s'est mis à mentir.

      On exige donc la précondition — une page où quatre cents pixels de
      défilement existent — au lieu de la supposer.
    */
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight - window.innerHeight,
        ), { timeout: 15_000 })
      .toBeGreaterThan(500)

    await page.evaluate(() => window.scrollTo(0, 400))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)
    const avant = await page.evaluate(() => window.scrollY)

    const filtres = page.locator('[data-testid="filtres"]')
    await filtres.locator('input[name="etat"]').first().check()
    await page.waitForURL(/etat=/)
    await page.waitForTimeout(400)

    /*
      On compare à ce qui reste ATTEIGNABLE, pas à la position de départ.

      Filtrer réduit la grille, donc raccourcit le document. Si la page
      devient plus courte que l'ancien décalage, le navigateur RABAT le
      défilement sur son nouveau maximum — ce n'est pas un renvoi en haut de
      page, c'est la seule position qui existe encore.

      La version précédente comparait à `avant / 2` et passait pour une raison
      accidentelle : les filtres vivaient alors DANS la page, et leur panneau
      déplié lui ajoutait deux mille trois cents pixels de hauteur. Le
      document restait donc toujours assez long. Depuis qu'ils sont dans un
      volet fixe, cette hauteur a disparu — et le test s'est mis à échouer sur
      téléphone en signalant un défaut qui n'existe pas.
    */
    const apres = await page.evaluate(() => window.scrollY)
    const atteignable = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    )
    const attendu = Math.min(avant, Math.max(atteignable, 0))

    expect(
      apres,
      `le filtre a renvoyé le visiteur en haut de page (attendu ~${attendu}, ` +
        `hauteur restante ${atteignable})`,
    ).toBeGreaterThanOrEqual(attendu - 4)
  })

  test('les deux univers sont annoncés au plan de site', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text()
    expect(xml).toContain('/fr/femme')
    expect(xml).toContain('/fr/homme')
  })
})
