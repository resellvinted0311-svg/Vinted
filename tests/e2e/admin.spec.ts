import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { test, expect, type Page } from '@playwright/test'

/**
 * La régie : ce qu'elle montre, et à qui.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi on compte les connexions dans ce fichier
 * ---------------------------------------------------------------------------
 * `signInAction` borne les tentatives à dix par quart d'heure, sur une clé qui
 * mêle le compte et l'empreinte d'appelant — les deux projets Playwright
 * portent des adresses distinctes, donc chacun a son propre compteur.
 * `phase0.spec.ts` en consomme déjà une sur le compte d'administration, par
 * projet et par exécution.
 *
 * Chaque test ouvre donc au plus UNE session, et chacun couvre tout ce que
 * cette session permet de vérifier : le refus opposé à un compte client est
 * mesuré sur les trois adresses d'administration d'un seul tenant, plutôt
 * qu'une connexion par adresse. Desserrer la protection pour arranger des
 * tests n'est pas une option.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce fichier vérifie et qu'aucun test unitaire ne peut voir
 * ---------------------------------------------------------------------------
 * Que la page existe réellement — le lien « Accéder au back-office » menait à
 * un 404 — et surtout que le prix plancher et le coût d'achat, qui ne sortent
 * NULLE PART ailleurs, sortent bien ici et seulement ici.
 */

/**
 * Le préfixe des pièces créées par ce fichier.
 *
 * Elles sont nettoyées avant chaque exécution : sans cela, chaque passage
 * laisserait une pièce de plus dans la base de développement, indéfiniment.
 * Elles naissent en brouillon, donc invisibles du public — mais un tas qui
 * grossit sans fin finit par fausser autre chose.
 */
const TEST_PIECE = 'Pièce de régie'

const ACCOUNT = 'admin@nina-diego.test'
const CUSTOMER = 'client@nina-diego.test'
const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? ''

function main(page: Page) {
  return page.locator('#contenu')
}

/**
 * Toutes les adresses d'administration, DÉRIVÉES du système de fichiers.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi la liste n'est pas écrite à la main
 * ---------------------------------------------------------------------------
 * Elle l'était, et le commentaire du test qui la consomme avertissait déjà :
 * « une page ajoutée sans garde serait invisible à un test qui n'en vérifie
 * qu'une ». C'est exactement ce qui est arrivé — l'écran des réglages a été
 * ajouté, la liste ne l'a pas suivi, et le test a continué de passer en
 * couvrant trois adresses sur quatre.
 *
 * Une liste tenue à la main ne protège que du défaut qu'on avait en tête en
 * l'écrivant. Celle-ci se met à jour toute seule : la prochaine page
 * d'administration sera vérifiée le jour où elle est créée, sans que personne
 * n'ait à y penser.
 */
function adminRoutes(locale = 'fr'): string[] {
  const root = join('app', '[locale]', 'admin')
  const routes: string[] = []

  const walk = (dir: string, segments: string[]): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)

      if (statSync(path).isDirectory()) {
        // Les groupes de routes `(nom)` ne produisent pas de segment d'URL ;
        // les segments dynamiques `[id]` demanderaient une valeur qu'on n'a pas
        // ici, et ils ont leurs propres tests.
        if (entry.startsWith('[')) continue
        walk(path, entry.startsWith('(') ? segments : [...segments, entry])
        continue
      }

      if (/^page\.tsx?$/.test(entry)) {
        routes.push(`/${locale}/admin${segments.map((s) => `/${s}`).join('')}`)
      }
    }
  }

  walk(root, [])
  return routes.sort()
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

    // Toute la surface d'administration, pas seulement la première page : une
    // page ajoutée sans garde serait invisible à un test qui n'en vérifie
    // qu'une. Une seule connexion les couvre toutes.
    const routes = adminRoutes()

    // Le balayage doit RAMENER quelque chose : un chemin de départ erroné
    // rendrait la liste vide, la boucle ne tournerait pas, et le test passerait
    // en ne vérifiant rien du tout.
    expect(routes.length).toBeGreaterThanOrEqual(4)

    for (const route of routes) {
      const response = await page.goto(route)
      expect(response?.status(), route).toBe(404)
    }
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

test.describe('Le catalogue depuis la régie', () => {
  test('crée une pièce, qui naît en brouillon et refuse d’être publiée sans photo', async ({
    page,
  }) => {
    await removeTestPieces()
    await page.context().clearCookies()
    await signIn(page, ACCOUNT)

    await page.goto('/fr/admin/pieces')
    await main(page).getByRole('link', { name: 'Nouvelle pièce' }).click()
    await expect(page).toHaveURL(/\/fr\/admin\/pieces\/nouvelle/)

    // Une catégorie de dernier niveau, prise dans la liste réellement servie :
    // la figer en dur ferait tomber le test au premier changement de taxonomie.
    const category = main(page).getByLabel('Catégorie')
    const firstOption = await category.locator('option:not([value=""])').first().getAttribute('value')
    await category.selectOption(firstOption ?? '')

    const marker = `Pièce de régie ${Date.now()}`
    await main(page).getByLabel('Titre').fill(marker)
    // Par son NOM et non par son libellé : en français, « Taille » désigne à
    // la fois la taille du vêtement et le tour de taille, qui est une mesure.
    // Deux champs portent donc la même étiquette, et c'est correct.
    await main(page).locator('[name="sizeLabel"]').fill('M')
    await main(page).getByLabel('Prix d’achat (€)').fill('12,00')
    await main(page).getByLabel('Prix de vente (€)').fill('89,00')
    await main(page).getByLabel('Poids (g)').fill('400')

    await main(page).getByRole('button', { name: 'Créer la pièce' }).click()

    // Si le serveur refuse, il le DIT dans une alerte. L'assertion est ici
    // plutôt qu'à la fin : un refus se lit, un « introuvable dans la liste »
    // trois étapes plus loin ne dit rien de la cause.
    // La création EMMÈNE sur la fiche : c'est là que se fait la suite du
    // travail. Attendre cette URL, plutôt que de naviguer soi-même, évite aussi
    // de lire la liste avant que l'action serveur ait rendu la main.
    await expect(page).toHaveURL(/\/fr\/admin\/pieces\/[a-z0-9]+$/)
    await expect(page.getByRole('heading', { name: marker })).toBeVisible()

    // Et elle figure bien à l'inventaire.
    await page.goto('/fr/admin/pieces')
    await expect(main(page).getByText(marker).first()).toBeVisible()
    await page.goBack()
    await expect(main(page).getByText('brouillon').first()).toBeVisible()

    // Et la mise en vente est refusée : une fiche sans visuel produirait une
    // vignette vide au catalogue, et le domaine le refuse.
    await expect(
      main(page).getByText('aucune photo', { exact: false }).first(),
    ).toBeVisible()
    await expect(
      main(page).getByRole('button', { name: 'Mettre en vente' }),
    ).toHaveCount(0)
  })

  test('n’expose ni coût d’achat ni notes internes sur la fiche PUBLIQUE', async ({
    page,
  }) => {
    // L'écran de régie porte délibérément le coût et le plancher — ce sont les
    // données de l'entreprise, rendues à l'entreprise. La garantie qui compte
    // est qu'ils n'apparaissent nulle part ailleurs, et c'est elle qu'on
    // vérifie ici, sur le HTML réellement servi au public.
    await page.context().clearCookies()

    const response = await page.goto('/fr/catalogue')
    expect(response?.status()).toBe(200)

    const html = await page.content()
    for (const field of ['costCents', 'floorPriceCents', 'internalNotes', 'sourcedFrom']) {
      expect(html, field).not.toContain(field)
    }
  })
})

test.describe('Les réglages métier', () => {
  test('s’atteignent depuis la navigation, et disent que la boutique tourne sur la démonstration', async ({
    page,
  }) => {
    await page.context().clearCookies()
    await signIn(page, ACCOUNT)

    await page.goto('/fr/admin')
    await main(page).getByRole('link', { name: 'Réglages' }).first().click()
    await expect(page).toHaveURL(/\/fr\/admin\/reglages/)

    // Les nombres qui décident des prix vivaient dans `prisma/seed.ts`, donc
    // dans un dépôt public. Cet écran est le seul chemin par lequel les vrais
    // entrent désormais — s'il ne s'affiche pas, ils n'entrent nulle part.
    await expect(
      main(page).getByRole('heading', { name: 'Réglages' }),
    ).toBeVisible()

    // Un champ de chaque groupe : leur absence dirait que la liste fermée n'a
    // pas été parcourue, ou qu'une traduction manque — auquel cas next-intl
    // afficherait la clé brute à la place du libellé.
    await expect(main(page).getByLabel('Marge minimale (centimes)')).toBeVisible()
    await expect(main(page).getByLabel('Majoration du port (%)')).toBeVisible()
    await expect(main(page).getByLabel('Barème de baisse automatique')).toBeVisible()
    await expect(main(page).getByLabel('Offre minimale (centimes)')).toBeVisible()

    // Et l'avertissement, qui n'a pas de raison de disparaître tant que
    // personne n'a enregistré de vraies valeurs. C'est lui qui explique
    // pourquoi la boutique refuserait de calculer un prix en production.
    await expect(
      main(page).getByText('valeurs du jeu de démonstration', { exact: false }),
    ).toBeVisible()
  })

  test('n’exposent AUCUN réglage juridique à la modification', async ({ page }) => {
    await page.context().clearCookies()
    await signIn(page, ACCOUNT)
    await page.goto('/fr/admin/reglages')

    // Le délai de rétractation, la prise en charge des retours et la version
    // des CGV engagent juridiquement la boutique. Ils se changent avec un
    // juriste ou en publiant de nouvelles CGV, pas dans un formulaire entre
    // deux commandes — et le formulaire ne doit pas même les proposer.
    const names = await page.evaluate(() =>
      [...document.querySelectorAll('#contenu [name]')].map((el) =>
        el.getAttribute('name'),
      ),
    )

    expect(names).not.toContain('withdrawalPeriodDays')
    expect(names).not.toContain('returnShippingPaidByCustomer')
    expect(names).not.toContain('refundOutboundShippingOnWithdrawal')
    expect(names).not.toContain('cgvVersion')

    // Le marqueur de profil non plus : il est une conséquence de
    // l'enregistrement, jamais une case à cocher.
    expect(names).not.toContain('settingsProfile')

    // Contrôle du contrôle : si le balayage ne trouvait aucun champ, les cinq
    // assertions ci-dessus passeraient sans rien vérifier.
    expect(names).toContain('minMarginCents')
  })
})

test.describe('La file des commandes à expédier', () => {
  test('existe, s’atteint depuis la navigation, et ne montre pas la marge', async ({
    page,
  }) => {
    await page.context().clearCookies()
    await signIn(page, ACCOUNT)

    await page.goto('/fr/admin')
    await main(page).getByRole('link', { name: 'Commandes à expédier' }).first().click()
    await expect(page).toHaveURL(/\/fr\/admin\/commandes/)

    await expect(
      main(page).getByRole('heading', { name: 'Commandes à expédier' }),
    ).toBeVisible()

    // ---------------------------------------------------------------------
    // Ce que ce test NE peut pas atteindre, et où c'est couvert
    // ---------------------------------------------------------------------
    // Le paiement n'est pas configuré dans cet environnement — `phase2-achat`
    // vérifie précisément que la boutique le DIT au lieu d'ouvrir un
    // formulaire mort. Aucune commande ne peut donc y être payée, et cette
    // file est vide par construction. Prétendre le contraire en écrivant une
    // commande directement en base contournerait la règle du dossier : ces
    // tests passent par l'interface, jamais par Prisma.
    //
    // Le rendu peuplé — ordre de la file, adresse en lignes postales, gestes
    // proposés selon l'état — est donc vérifié par
    // `tests/integration/order-fulfilment.test.ts`, qui exerce la requête
    // contre une vraie base. Ici on vérifie ce que seul un navigateur voit :
    // que la page existe, que la navigation y mène, et que l'état vide parle.
    //
    // Les deux assertions de fuite ci-dessous sont donc faibles TANT QUE la
    // file est vide. Elles restent parce qu'elles ne coûtent rien et qu'elles
    // mordent le jour où cette suite tourne contre une base qui, elle, a des
    // commandes payées.
    await expect(main(page).getByText('Prix plancher')).toHaveCount(0)
    await expect(main(page).getByText('Écart au plancher')).toHaveCount(0)

    const empty = main(page).getByText('Aucune commande n’attend d’être expédiée.')
    if (await empty.isVisible()) {
      // Jamais une page muette : l'état vide doit dire pourquoi il l'est.
      await expect(
        main(page).getByText('Les commandes payées apparaissent ici.'),
      ).toBeVisible()
      return
    }

    await expect(
      main(page).getByRole('button', { name: 'Marquer expédiée' }).first(),
    ).toBeVisible()
    await expect(main(page).getByText('Adresse d’expédition').first()).toBeVisible()

    // Le champ de suivi est FACULTATIF : le bouton ne l'attend pas. L'exiger
    // obligerait à inventer un numéro sur un envoi qui n'en a pas.
    await expect(main(page).getByLabel(/Numéro de suivi/).first()).toBeVisible()
  })
})

/**
 * Retire les pièces laissées par ce fichier.
 *
 * Prisma plutôt que l'interface : il n'existe pas de geste « supprimer une
 * pièce » en régie, et c'est délibéré — une pièce vendue porte une facture, et
 * on ne supprime pas ce qui a une valeur comptable. Le nettoyage d'un jeu
 * d'essai n'est pas une raison d'ouvrir cette porte dans le produit.
 */
async function removeTestPieces(): Promise<void> {
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  try {
    const rows = await prisma.articleTranslation.findMany({
      where: { title: { startsWith: TEST_PIECE } },
      select: { articleId: true },
    })
    const ids = [...new Set(rows.map((row) => row.articleId))]
    if (ids.length > 0) {
      await prisma.article.deleteMany({ where: { id: { in: ids } } })
    }
  } finally {
    await prisma.$disconnect()
  }
}
