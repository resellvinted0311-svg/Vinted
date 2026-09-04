import { describe, it, expect, beforeEach, afterAll } from 'vitest'

import { prisma } from '@/lib/db/client'
import {
  loadSyncContext,
  syncArticle,
  type SyncContext,
} from '@/lib/sync/articles'
import { qualifyArticles, MAX_QUALIFY_BATCH } from '@/lib/articles/audiences'
import {
  listUnqualifiedArticles,
  countUnqualified,
  listCategoriesWithUnqualified,
} from '@/lib/db/queries/admin-audiences'

/**
 * Ranger les pièces en univers, contre une vraie base.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce fichier protège, et pourquoi il fallait l'écrire
 * ---------------------------------------------------------------------------
 * La vitrine demandée — deux cartes Femme et Homme, puis une grille de
 * sous-catégories par univers — ne s'affiche PAS tant qu'aucune pièce ne porte
 * `audience`. Le code était complet et l'écran restait identique à l'ancien,
 * ce qui a été constaté en production.
 *
 * Deux choses doivent donc tenir dans le temps, et aucune n'est évidente à la
 * relecture :
 *
 *  1. une pièce IMPORTÉE peut être qualifiée depuis la régie. C'est
 *     l'exception au principe « on ne touche pas aux pièces du partenaire »,
 *     et elle n'est sûre que parce que `audience` est hors du contrat de
 *     synchronisation ;
 *  2. la synchronisation suivante ne l'efface pas. Le jour où quelqu'un
 *     ajoutera `audience` à `attributeFields`, tout le travail de
 *     qualification sera perdu au passage suivant — sans erreur, sans trace,
 *     et les deux vitrines se videront d'un coup.
 *
 * Le second point est la vraie raison d'être de ce fichier. C'est un défaut
 * qu'aucun test de fonction isolée ne peut voir.
 */

const PREFIX = 'univers-test-'
const BRAND = 'Marque Essai Univers'
const ACTOR_EMAIL = 'univers-test@boutique.test'

/**
 * L'actrice est une VRAIE ligne `User`, pas un identifiant inventé.
 *
 * `AuditLog.actorId` porte une clé étrangère : une piste d'audit qui
 * désignerait un compte inexistant ne prouverait rien. La contrainte a d'abord
 * fait tomber ce fichier, et c'est le bon comportement — mieux vaut un test
 * qui échoue qu'une trace qui ment.
 */
let ACTOR = ''

const BASE = {
  externalId: `${PREFIX}1`,
  title: 'Chemise en coton rayée',
  categorySlug: 'chemises',
  condition: 'VERY_GOOD',
  sizeLabel: 'L',
  priceCents: 3800,
  costCents: 900,
  weightGrams: 320,
  // Aucune image annoncée : la pièce est publiée tout de suite, donc elle
  // entre dans les grilles — et c'est là que la qualification compte.
  images: [],
} as const

let context: SyncContext

async function cleanup(): Promise<void> {
  const articles = await prisma.article.findMany({
    where: { externalId: { startsWith: PREFIX } },
    select: { id: true },
  })
  const ids = articles.map((article) => article.id)

  if (ids.length > 0) {
    await prisma.article.deleteMany({ where: { id: { in: ids } } })
  }

  // L'audit part avec le compte : `onDelete: SetNull` le laisserait sinon
  // derrière, orphelin, et le fichier suivant compterait nos entrées.
  const actrice = await prisma.user.findUnique({
    where: { email: ACTOR_EMAIL },
    select: { id: true },
  })
  if (actrice) {
    await prisma.auditLog.deleteMany({ where: { actorId: actrice.id } })
    await prisma.user.delete({ where: { id: actrice.id } })
  }

  await prisma.brand.deleteMany({ where: { name: BRAND } })
}

beforeEach(async () => {
  await cleanup()

  const actrice = await prisma.user.create({
    data: { email: ACTOR_EMAIL, role: 'ADMIN' },
    select: { id: true },
  })
  ACTOR = actrice.id

  context = await loadSyncContext()
})

afterAll(cleanup)

/** Importe une pièce et renvoie son identifiant interne. */
async function importer(
  patch: Record<string, unknown> = {},
): Promise<{ id: string; externalId: string }> {
  const externalId = (patch.externalId as string | undefined) ?? BASE.externalId
  await syncArticle({ ...BASE, ...patch, externalId }, 0, context, {
    dryRun: false,
  })

  const article = await prisma.article.findUniqueOrThrow({
    where: { externalId },
    select: { id: true },
  })
  return { id: article.id, externalId }
}

async function universDe(id: string): Promise<string | null> {
  const row = await prisma.article.findUniqueOrThrow({
    where: { id },
    select: { audience: true },
  })
  return row.audience
}

// ---------------------------------------------------------------------------
// Le point le plus important : la synchronisation n'efface pas le rangement
// ---------------------------------------------------------------------------

describe('face à la synchronisation', () => {
  it('garde l’univers d’une pièce IMPORTÉE après un nouvel import qui change le prix', async () => {
    const { id } = await importer()
    expect(await universDe(id)).toBeNull()

    const pose = await qualifyArticles([id], 'femme', ACTOR)
    expect(pose).toEqual({ ok: true, updated: 1 })

    // Un vrai second passage, avec une donnée modifiée : c'est ce qui change
    // l'empreinte et déclenche la réécriture de TOUS les champs du contrat.
    const relance = await syncArticle(
      { ...BASE, priceCents: 3400 },
      0,
      await loadSyncContext(),
      { dryRun: false },
    )
    expect(relance.action).toBe('updated')

    const apres = await prisma.article.findUniqueOrThrow({
      where: { id },
      select: { audience: true, priceCents: true },
    })

    // Le prix a bien été réécrit — la synchronisation a donc réellement
    // travaillé sur cette ligne, et le test ne passe pas « par chance ».
    expect(apres.priceCents).toBe(3400)
    // Et l'univers a survécu.
    expect(apres.audience).toBe('femme')
  })

  it('garde l’univers même quand l’import ne change rien', async () => {
    // Le chemin « inchangé » sort tôt sur l'empreinte. Il ne doit pas non plus
    // remettre la colonne à zéro au passage.
    const { id } = await importer()
    await qualifyArticles([id], 'mixte', ACTOR)

    await syncArticle(BASE, 0, await loadSyncContext(), { dryRun: false })

    expect(await universDe(id)).toBe('mixte')
  })
})

// ---------------------------------------------------------------------------
// Le garde : remplir, jamais réécrire
// ---------------------------------------------------------------------------

describe('la pose d’un univers', () => {
  it('ne réécrit PAS une pièce déjà rangée', async () => {
    /**
     * Le défaut visé est l'onglet resté ouvert : la liste de travail est un
     * instantané, et un envoi depuis un onglet périmé reposterait les mêmes
     * identifiants avec l'univers d'avant. Sans ce garde, il effacerait le
     * travail fait entre-temps, sans erreur ni trace à l'écran.
     */
    const { id } = await importer()

    expect(await qualifyArticles([id], 'femme', ACTOR)).toEqual({
      ok: true,
      updated: 1,
    })

    const second = await qualifyArticles([id], 'homme', ACTOR)
    expect(second).toEqual({ ok: true, updated: 0 })
    expect(await universDe(id)).toBe('femme')
  })

  it('compte les pièces RÉELLEMENT écrites, pas celles demandées', async () => {
    const dejaRangee = await importer({ externalId: `${PREFIX}a` })
    const aRanger = await importer({ externalId: `${PREFIX}b` })

    await qualifyArticles([dejaRangee.id], 'homme', ACTOR)

    // Le compte rendu de l'écran est bâti sur ce nombre : annoncer « 2 pièces
    // rangées » quand la base en a modifié une seule apprendrait à ne plus
    // croire les comptes rendus.
    const lot = await qualifyArticles([dejaRangee.id, aRanger.id], 'femme', ACTOR)
    expect(lot).toEqual({ ok: true, updated: 1 })
  })

  it('ne compte qu’une fois un identifiant envoyé deux fois', async () => {
    const { id } = await importer()
    expect(await qualifyArticles([id, id, id], 'femme', ACTOR)).toEqual({
      ok: true,
      updated: 1,
    })
  })

  it('refuse un lot vide et un lot au-delà du plafond', async () => {
    expect(await qualifyArticles([], 'femme', ACTOR)).toEqual({
      ok: false,
      reason: 'empty',
    })

    // Le plafond borne la transaction. Sans lui, un seul envoi peut la tenir
    // ouverte sur cent mille lignes et immobiliser la connexion que la
    // production accorde à l'instance.
    const trop = Array.from(
      { length: MAX_QUALIFY_BATCH + 1 },
      (_, index) => `id-${index}`,
    )
    expect(await qualifyArticles(trop, 'femme', ACTOR)).toEqual({
      ok: false,
      reason: 'tooMany',
    })
  })
})

// ---------------------------------------------------------------------------
// La piste d'audit
// ---------------------------------------------------------------------------

describe('la piste d’audit', () => {
  it('consigne une entrée par LOT, avec l’univers et le nombre', async () => {
    const { id } = await importer()
    await qualifyArticles([id], 'femme', ACTOR)

    const entries = await prisma.auditLog.findMany({
      where: { actorId: ACTOR, action: 'articles.qualified' },
      select: { entity: true, entityId: true, after: true },
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]?.entity).toBe('Article')
    expect(entries[0]?.entityId).toBe('batch')
    expect(entries[0]?.after).toEqual({ audience: 'femme', count: 1 })
  })

  it('ne consigne RIEN quand rien n’a bougé', async () => {
    // Un double-clic poste deux fois le même lot. Une piste qui consigne les
    // non-événements devient illisible, et c'est le cas le plus fréquent.
    const { id } = await importer()
    await qualifyArticles([id], 'femme', ACTOR)
    await qualifyArticles([id], 'femme', ACTOR)

    const entries = await prisma.auditLog.count({
      where: { actorId: ACTOR, action: 'articles.qualified' },
    })
    expect(entries).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// La liste de travail
// ---------------------------------------------------------------------------

describe('la liste de travail', () => {
  it('propose les pièces IMPORTÉES — c’est toute sa raison d’être', async () => {
    /**
     * `listOwnArticles` les écarte volontairement (`externalId IS NULL`), et
     * le stock réel vient presque entièrement de l'application de gestion.
     * Reprendre cette exception ici rendrait l'écran vide et inutile.
     */
    const { id } = await importer()

    const lignes = await listUnqualifiedArticles({ locale: 'fr' })
    const ligne = lignes.find((row) => row.id === id)

    expect(ligne, 'la pièce importée doit être proposée').toBeDefined()
    expect(ligne?.imported).toBe(true)
  })

  it('retire une pièce de la liste dès qu’elle est rangée', async () => {
    const { id } = await importer()

    const avant = await countUnqualified()
    await qualifyArticles([id], 'homme', ACTOR)
    const apres = await countUnqualified()

    expect(apres).toBe(avant - 1)
    expect(
      (await listUnqualifiedArticles({ locale: 'fr' })).some(
        (row) => row.id === id,
      ),
    ).toBe(false)
  })

  it('n’affiche pas les brouillons par défaut, et les affiche sur demande', async () => {
    /**
     * Qualifier un brouillon ne change rien à ce que le public voit : les
     * facettes ne comptent que les pièces en grille. Les mêler à la liste
     * noierait celles qui, elles, feraient apparaître les cartes.
     */
    const { id } = await importer()
    await prisma.article.update({
      where: { id },
      data: { status: 'DRAFT', publishedAt: null },
    })

    const enGrille = await listUnqualifiedArticles({ locale: 'fr' })
    expect(enGrille.some((row) => row.id === id)).toBe(false)

    const tout = await listUnqualifiedArticles({
      locale: 'fr',
      inclureHorsGrille: true,
    })
    expect(tout.some((row) => row.id === id)).toBe(true)
  })

  it('compte le reste à faire par catégorie, et tait les catégories finies', async () => {
    const { id } = await importer()

    const categorie = await prisma.article.findUniqueOrThrow({
      where: { id },
      select: { categoryId: true },
    })

    const avant = await listCategoriesWithUnqualified('fr')
    const ligneAvant = avant.find((row) => row.id === categorie.categoryId)
    expect(ligneAvant?.count).toBeGreaterThanOrEqual(1)

    await qualifyArticles([id], 'femme', ACTOR)

    const apres = await listCategoriesWithUnqualified('fr')
    const ligneApres = apres.find((row) => row.id === categorie.categoryId)
    // Soit elle a baissé d'une pièce, soit la catégorie a disparu de la liste
    // parce qu'elle est terminée — les deux sont corrects.
    expect(ligneApres?.count ?? 0).toBe((ligneAvant?.count ?? 0) - 1)
  })

  it('filtre sur une catégorie sans lever quand elle n’existe pas', async () => {
    // Le paramètre vient de l'adresse : n'importe qui peut y écrire n'importe
    // quoi. Une valeur inconnue doit rendre une liste vide, pas une erreur.
    const lignes = await listUnqualifiedArticles({
      locale: 'fr',
      categoryId: 'categorie-qui-n-existe-pas',
    })
    expect(lignes).toEqual([])
  })
})
