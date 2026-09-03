import { test, expect, type Page } from '@playwright/test'
import { PIECE_NEGOCIABLE, PIECE_VENDUE } from './pieces-demo'

/**
 * Phase 3 : proposer un prix, depuis la fiche article.
 *
 * Ce qui se vérifie ici et nulle part ailleurs : que le formulaire existe
 * réellement sur une pièce négociable, qu'il DIT avant l'envoi qu'une offre ne
 * met rien de côté, et qu'aucun montant de référence ne traverse le navigateur.
 */

/**
 * Une pièce du jeu de données dont les offres sont ouvertes.
 *
 * Le semis pose `offersOpenAt` à la publication plus sept jours ; les pièces
 * de la première vague sont publiées assez anciennement pour que la fenêtre
 * soit ouverte. Son adresse vit dans `pieces-demo.ts` et ses propriétés sont
 * vérifiées par `tests/integration/pieces-demo.test.ts` — un semis qui bouge
 * y échoue en une seconde, au lieu de faire tomber ce fichier en huit minutes
 * de délais d'attente.
 */
const SLUG = PIECE_NEGOCIABLE

/** Une pièce déjà partie : sa page reste consultable, elle ne se négocie plus. */
const SOLD_SLUG = PIECE_VENDUE

/** Le contenu de la page, sans le flux RSC que Next inscrit dans un script. */
function main(page: Page) {
  return page.locator('#contenu')
}

function offerForm(page: Page) {
  return main(page).locator('form').filter({ has: page.locator('[name="amountEuros"]') })
}

/** On repart d'une session neuve : les offres se comptent par personne. */
async function freshVisitor(page: Page): Promise<void> {
  await page.context().clearCookies()
}

test.describe('Le formulaire d’offre', () => {
  test('apparaît sur une pièce négociable', async ({ page }) => {
    await freshVisitor(page)
    await page.goto(`/fr/a/${SLUG}`)

    await expect(
      main(page).getByRole('heading', { name: 'Faire une offre' }),
    ).toBeVisible()
    await expect(offerForm(page).getByLabel('Votre proposition')).toBeVisible()
  })

  test('DIT, avant l’envoi, qu’une offre ne met rien de côté', async ({
    page,
  }) => {
    await freshVisitor(page)
    await page.goto(`/fr/a/${SLUG}`)

    // Sur un stock où chaque pièce existe en un seul exemplaire, c'est
    // l'information qui décide. Elle doit être lisible AVANT de proposer, pas
    // découverte après coup.
    await expect(
      main(page).getByText(/ne met pas la pièce de côté/),
    ).toBeVisible()
  })

  test('ne transporte AUCUN montant de référence', async ({ page }) => {
    await freshVisitor(page)
    await page.goto(`/fr/a/${SLUG}`)

    const names = await offerForm(page)
      .locator('input, select, textarea')
      .evaluateAll((nodes) =>
        nodes
          .map((node) => (node as HTMLInputElement).name)
          .filter((name) => name.length > 0)
          // React 19 pose sa propre tuyauterie d'action serveur — `$ACTION_*`,
          // qui porte la référence de la fonction et sa clé, jamais de donnée
          // métier. On regarde ce que NOUS envoyons.
          .filter((name) => !name.startsWith('$ACTION')),
      )

    // Un prix affiché, un plancher ou un minimum qui traverserait le
    // navigateur serait réécrit, et servirait à déclencher une acceptation
    // automatique en annonçant un prix plus bas qu'il ne l'est.
    expect(names.sort()).toEqual(['amountEuros', 'articleId', 'email'])
  })

  test('demande une adresse sans compte', async ({ page }) => {
    await freshVisitor(page)
    await page.goto(`/fr/a/${SLUG}`)

    // Sans elle, la réponse du vendeur n'atteindrait personne, et l'offre
    // serait une proposition que son auteur ne pourrait jamais retrouver.
    await expect(offerForm(page).getByLabel('Adresse e-mail')).toBeVisible()
  })

  test('enregistre une proposition et annonce l’échéance', async ({ page }) => {
    await freshVisitor(page)
    await page.goto(`/fr/a/${SLUG}`)

    // 30,00 € sur une pièce affichée 39,21 €, plancher à 24,40 € : sous le
    // prix demandé, et au-dessus du refus automatique. La proposition doit
    // donc ATTENDRE une réponse — ni acceptée, ni refusée sur-le-champ. Ces
    // trois montants sont vérifiés ensemble par le test d'intégration des
    // pièces de démonstration.
    await offerForm(page).getByLabel('Votre proposition').fill('30,00')
    await offerForm(page)
      .getByLabel('Adresse e-mail')
      .fill(`offre-${Date.now()}@exemple.test`)
    await offerForm(page).getByRole('button', { name: 'Envoyer' }).click()

    // `\s` et non une espace : `formatPrice` sépare le nombre du symbole par
    // une espace fine insécable (U+202F), comme le veut la typographie
    // française. Une espace ordinaire dans le motif ne correspondrait à rien.
    await expect(
      main(page).getByText(/Proposition de 30,00\s€\senvoyée/),
    ).toBeVisible()

    // Et le rappel reste affiché : c'est pendant l'attente qu'il compte le
    // plus, puisque la pièce peut partir entre-temps.
    await expect(
      main(page).getByText(/ne met pas la pièce de côté/),
    ).toBeVisible()
  })

  test('refuse un montant qui n’en est pas un', async ({ page }) => {
    await freshVisitor(page)
    await page.goto(`/fr/a/${SLUG}`)

    // `inputMode="decimal"` et non `type="number"` : le navigateur laisse
    // passer, et c'est le serveur qui tranche. Lire « 32 » dans « 32,5,0 »
    // ferait proposer un prix que personne n'a saisi.
    await offerForm(page).getByLabel('Votre proposition').fill('12,5,0')
    await offerForm(page)
      .getByLabel('Adresse e-mail')
      .fill(`offre-${Date.now()}@exemple.test`)
    await offerForm(page).getByRole('button', { name: 'Envoyer' }).click()

    await expect(main(page).getByText(/montant en euros/)).toBeVisible()
  })

  test('n’apparaît pas sur une pièce vendue', async ({ page }) => {
    await freshVisitor(page)
    await page.goto(`/fr/a/${SOLD_SLUG}`)

    // La page reste consultable — renvoyer 404 sur une pièce vendue détruirait
    // le référencement acquis — mais elle ne propose pas de négocier. Le
    // serveur refuserait de toute façon ; afficher un formulaire qui ne peut
    // qu'échouer fait perdre du temps et donne l'impression d'un site cassé.
    await expect(main(page).getByText('Vendu').first()).toBeVisible()
    await expect(offerForm(page)).toHaveCount(0)
  })
})

/**
 * Le registre des offres, dans l'espace compte.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une seule connexion dans tout ce fichier
 * ---------------------------------------------------------------------------
 * `signInAction` borne les tentatives à dix par compte et par quart d'heure.
 * Deux projets Playwright rejouent la suite entière, et `rgpd.spec.ts` consomme
 * déjà quatre tentatives sur ce compte : une seule ici garde une marge
 * confortable, et desserrer la protection pour arranger des tests n'est pas une
 * option.
 */
const ACCOUNT = 'client2@nina-diego.test'
const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? ''

test.describe('Le registre des offres', () => {
  test('n’est pas servi sans session', async ({ page }) => {
    await freshVisitor(page)
    await page.goto('/fr/compte/offres')

    // La page n'a AUCUN paramètre : ni numéro à saisir, ni identifiant dans
    // l'URL. Toute sa sûreté tient dans la portée de la requête et dans cette
    // redirection.
    await expect(page).toHaveURL(/\/fr\/connexion/)
  })

  test('est atteignable depuis l’espace compte, et dit ce qu’une offre n’est pas', async ({
    page,
  }) => {
    await freshVisitor(page)
    await page.goto('/fr/connexion')
    await page
      .getByLabel('Adresse e-mail')
      .filter({ visible: true })
      .first()
      .fill(ACCOUNT)
    await page
      .getByLabel('Mot de passe')
      .filter({ visible: true })
      .fill(SEED_PASSWORD)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page).toHaveURL(/\/fr\/compte/)

    // Le lien existait avant la page : il menait à un 404 depuis l'espace
    // compte.
    await page.getByRole('link', { name: 'Mes offres' }).click()
    await expect(page).toHaveURL(/\/fr\/compte\/offres/)

    await expect(
      main(page).getByRole('heading', { name: 'Mes offres' }),
    ).toBeVisible()

    // La règle qui explique tout le reste de la page, y compris pourquoi une
    // offre acceptée peut finir « sans objet ».
    await expect(
      main(page).getByText(/ne met pas la pièce de côté/),
    ).toBeVisible()
  })
})
