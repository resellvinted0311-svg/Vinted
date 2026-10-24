import { test, expect } from '@playwright/test'

/**
 * « Renoncer au contrat ici », par l'interface réelle.
 *
 * Obligatoire depuis le 19 juin 2026 : la fonction doit être FACILEMENT
 * accessible — d'où le premier cas, qui part du pied de page d'une page
 * quelconque et non de l'adresse de la fonction.
 *
 * L'enregistrement, l'accusé et l'absence d'oracle sont couverts contre une
 * vraie base par `tests/integration/withdrawal.test.ts`. Ici, on vérifie ce que
 * la personne voit.
 */

test('le pied de chaque page mène à la rétractation en ligne', async ({
  page,
}) => {
  await page.goto('/fr/catalogue')

  await page
    .getByRole('contentinfo')
    .getByRole('link', { name: 'Renoncer au contrat ici' })
    .click()

  await expect(page).toHaveURL(/\/fr\/retractation$/)
  await expect(
    page.getByRole('heading', { name: 'Renoncer au contrat' }),
  ).toBeVisible()
  // Le bouton porte les mots du texte, pas « Envoyer ».
  await expect(
    page.getByRole('button', { name: 'Confirmer la rétractation' }),
  ).toBeVisible()
})

test('la réponse ne dit pas si la commande existe', async ({ page }) => {
  await page.goto('/fr/retractation?commande=cmd-2099-990999')

  // Le numéro arrive prérempli, normalisé ; l'adresse, jamais par l'URL.
  await expect(page.getByLabel('Numéro de commande')).toHaveValue(
    'CMD-2099-990999',
  )

  await page.getByLabel('Nom et prénom').fill('Camille Exemple')
  await page
    .getByLabel('Adresse e-mail utilisée pour la commande')
    .fill('personne@exemple.test')
  await page.getByRole('button', { name: 'Confirmer la rétractation' }).click()

  const confirmation = page.getByRole('status')
  await expect(confirmation).toContainText('Rétractation transmise')
  // Au conditionnel : la même phrase, que la commande existe ou non.
  await expect(confirmation).toContainText(
    'Si ces informations correspondent à une commande',
  )
  await expect(confirmation).toContainText('personne@exemple.test')
})
