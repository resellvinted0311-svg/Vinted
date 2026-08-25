import { test, expect } from '@playwright/test'

/**
 * Droits des personnes, par l'interface réelle.
 *
 * L'effacement n'est PAS testé ici : il détruirait le compte de démonstration
 * dont dépendent les autres fichiers. Il est couvert contre une vraie base par
 * tests/integration/privacy.test.ts, qui vérifie ce qui reste après coup —
 * la seule question qui compte.
 */

const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? ''

/**
 * Ce fichier a SON compte, et ne partage pas celui de `phase0`.
 *
 * `signInAction` borne les tentatives à dix par compte et par quart d'heure —
 * une protection contre le bourrage d'identifiants qu'on ne desserre pas pour
 * arranger des tests. Or les deux fichiers se connectent chacun plusieurs fois,
 * dans chacun des deux navigateurs : réunis sur un seul compte, ils
 * consommaient exactement le seau, et les derniers tombaient sur « Trop de
 * tentatives » dès la PREMIÈRE exécution complète.
 */
const ACCOUNT = 'client2@nina-diego.test'

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/fr/connexion')
  await page.getByLabel('Adresse e-mail').filter({ visible: true }).first().fill(ACCOUNT)
  await page.getByLabel('Mot de passe').filter({ visible: true }).fill(SEED_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/\/fr\/compte/)
}

test.describe('Information des personnes', () => {
  test('la page de confidentialité dit ce qui est conservé, et combien de temps', async ({
    page,
  }) => {
    await page.goto('/fr/pages/confidentialite')

    // Elle est rendue depuis le registre : ces valeurs ne sont pas saisies
    // dans la page, elles viennent de lib/config/privacy.ts.
    await expect(page.getByRole('heading', { name: 'Vos droits' })).toBeVisible()
    // « payées » : le registre distingue depuis une commande payée — conservée
    // dix ans au titre de l'obligation comptable — d'un tunnel abandonné, qui
    // n'est qu'un contrat non conclu et part au bout de trente jours. Le
    // libellé a suivi cette scission, et ce test avec lui.
    await expect(
      page.getByText('Vos commandes payées et vos factures'),
    ).toBeVisible()
    await expect(page.getByText('Obligation légale')).toBeVisible()
    // `.first()` et non le libellé seul : plusieurs traitements affichent
    // désormais dix ans — la commande payée, et l'expédition qui la suit. Une
    // correspondance unique était une hypothèse sur le CONTENU du registre,
    // pas sur ce que la page doit faire ; elle a cassé à la première entrée
    // ajoutée, sans qu'aucune régression n'ait eu lieu.
    await expect(page.getByText('10 ans').first()).toBeVisible()

    // La nouvelle entrée : l'expédition était écrite en base sans figurer nulle
    // part dans la déclaration publique.
    await expect(page.getByText('L’expédition de vos colis')).toBeVisible()

    // Et surtout : ce n'est plus le texte d'attente de la phase 7.
    await expect(page.getByText('Contenu rédigé en Phase 7')).toHaveCount(0)
  })

  test('l’inscription informe au moment où elle demande l’adresse', async ({
    page,
  }) => {
    await page.goto('/fr/inscription')

    // L'article 13 porte sur le moment de la collecte, pas sur l'existence
    // d'une page quelque part.
    await expect(
      page.getByText('Votre adresse e-mail sert à gérer votre compte'),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Ce que nous conservons' }),
    ).toBeVisible()
  })
})

test.describe('Exercice des droits', () => {
  test('l’espace « Mes données » est réservé aux personnes connectées', async ({
    page,
  }) => {
    await page.goto('/fr/compte/donnees')
    await expect(page).toHaveURL(/\/fr\/connexion/)
  })

  test('la copie des données n’est pas servie sans session', async ({
    request,
  }) => {
    const response = await request.get('/api/compte/donnees')

    // 404 et non 401 : cette adresse n'a pas à confirmer son existence.
    expect(response.status()).toBe(404)
  })

  test('une personne connectée obtient une copie de ses données', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto('/fr/compte/donnees')

    const download = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Télécharger mes données' }).click()
    const file = await download

    expect(file.suggestedFilename()).toMatch(
      /^donnees-personnelles-\d{4}-\d{2}-\d{2}\.json$/,
    )

    const stream = await file.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    const body = Buffer.concat(chunks).toString('utf8')

    const parsed = JSON.parse(body) as { account: { email: string } }
    expect(parsed.account.email).toBe(ACCOUNT)

    // Ni l'empreinte du mot de passe, ni les coûts d'achat.
    expect(body).not.toContain('passwordHash')
    expect(body).not.toContain('argon2')
    expect(body).not.toContain('costCents')
  })

  test('le consentement se retire au même endroit qu’il se donne', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto('/fr/compte/donnees')

    // Article 7.3 : aussi simple à retirer qu'à donner. Une case, pas un
    // e-mail à envoyer.
    await expect(
      page.getByRole('heading', { name: 'Nouveautés par e-mail' }),
    ).toBeVisible()
    await expect(page.locator('input[name="marketingConsent"]')).toBeVisible()

    await expect(
      page.getByRole('heading', { name: 'Effacer mon compte' }),
    ).toBeVisible()
    // Le bouton reste inerte tant que la confirmation n'est pas recopiée.
    await expect(
      page.getByRole('button', { name: 'Effacer mon compte' }),
    ).toBeDisabled()
  })
})
