import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { prisma } from '@/lib/db/client'
import { __resetRateLimitForTests } from '@/lib/security/rate-limit'
import { deciderAppEvent, appEventSchema } from '@/lib/sync/app-event'
import { POST } from '@/app/api/sync/app-event/route'

/**
 * Une pièce ajoutée dans l'application paraît tout de suite en boutique.
 *
 * ---------------------------------------------------------------------------
 * Ce qui se joue ici
 * ---------------------------------------------------------------------------
 * Cette adresse est PUBLIQUE et écrit dans le catalogue sur la foi d'un appel
 * HTTP venu d'une console tierce. Trois choses doivent donc être vraies, et
 * aucune n'est visible depuis `syncArticle` :
 *
 *  - sans clé valide, rien ne s'écrit ;
 *  - une ligne d'un AUTRE espace de travail n'entre jamais, quel que soit le
 *    réglage du webhook — la base de l'application est multi-locataire ;
 *  - une suppression archive au lieu d'effacer, parce qu'une fiche peut être
 *    citée par une facture.
 */

const KEY = 'CLEF-EVENEMENT-Kt7p2WxQ9mZa'
const WORKSPACE = 'espace-de-test'
const PREFIX = 'app-event-'

function ligne(index: number, patch: Record<string, unknown> = {}) {
  return {
    id: `${PREFIX}${index}`,
    workspace_id: WORKSPACE,
    article: `Chemise en lin ${index}`,
    marque: 'Uniqlo',
    taille: 'M',
    etat: 'Très bon état',
    couleur: 'Bleu ciel',
    description: null,
    prix_achat: '1.50',
    prix_annonce: '14.90',
    prix_vendu: null,
    en_vente: 'Oui',
    ...patch,
  }
}

function post(
  corps: unknown,
  { key = KEY }: { key?: string | null } = {},
): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (key !== null) headers.set('authorization', `Bearer ${key}`)

  return POST(
    new NextRequest('https://boutique.test/api/sync/app-event', {
      method: 'POST',
      headers,
      body: JSON.stringify(corps),
    }),
  )
}

async function nettoyer(): Promise<void> {
  await prisma.article.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  })
}

beforeEach(async () => {
  await nettoyer()
  __resetRateLimitForTests()
  vi.stubEnv('SYNC_API_KEY', KEY)
  vi.stubEnv('APP_WORKSPACE_ID', WORKSPACE)
})

afterAll(async () => {
  await nettoyer()
  vi.unstubAllEnvs()
  await prisma.$disconnect()
})

describe('la porte d’entrée', () => {
  it('refuse sans clé, et n’écrit rien', async () => {
    const reponse = await post(
      { type: 'INSERT', table: 'articles', record: ligne(1) },
      { key: null },
    )

    expect(reponse.status).toBe(401)
    expect(
      await prisma.article.count({ where: { externalId: `${PREFIX}1` } }),
    ).toBe(0)
  })

  it('refuse une clé fausse', async () => {
    const reponse = await post(
      { type: 'INSERT', table: 'articles', record: ligne(2) },
      { key: 'pas-la-bonne-clef-du-tout-xxxxx' },
    )

    expect(reponse.status).toBe(401)
  })

  it('refuse une charge qui n’a pas la forme attendue', async () => {
    const reponse = await post({ type: 'BOUM', table: 'articles' })
    expect(reponse.status).toBe(400)
  })

  it('REFUSE tant que l’espace de travail n’est pas configuré', async () => {
    /**
     * Une variable oubliée ne doit pas se traduire par « publie ce qui vient ».
     * Sur une base multi-locataire, accepter tout par défaut publierait le stock
     * d'autres personnes dans une boutique publique.
     */
    vi.stubEnv('APP_WORKSPACE_ID', '')

    const reponse = await post({
      type: 'INSERT',
      table: 'articles',
      record: ligne(3),
    })

    expect(reponse.status).toBe(503)
    expect(
      await prisma.article.count({ where: { externalId: `${PREFIX}3` } }),
    ).toBe(0)
  })
})

describe('l’événement', () => {
  it('crée la pièce, tout de suite', async () => {
    const reponse = await post({
      type: 'INSERT',
      table: 'articles',
      record: ligne(10),
    })

    expect(reponse.status).toBe(200)
    expect(await reponse.json()).toMatchObject({ ok: true, action: 'created' })

    const enBase = await prisma.article.findUniqueOrThrow({
      where: { externalId: `${PREFIX}10` },
      select: { status: true, priceCents: true },
    })
    expect(enBase.status).toBe('AVAILABLE')
    expect(enBase.priceCents).toBe(1490)
  })

  it('applique une modification', async () => {
    await post({ type: 'INSERT', table: 'articles', record: ligne(11) })

    const reponse = await post({
      type: 'UPDATE',
      table: 'articles',
      record: ligne(11, { prix_annonce: '22.00' }),
      old_record: ligne(11),
    })

    expect(await reponse.json()).toMatchObject({ action: 'updated' })

    const enBase = await prisma.article.findUniqueOrThrow({
      where: { externalId: `${PREFIX}11` },
      select: { priceCents: true },
    })
    expect(enBase.priceCents).toBe(2200)
  })

  it('ARCHIVE une suppression, au lieu d’effacer', async () => {
    /**
     * Le prix et le libellé d'une pièce figurent peut-être déjà, figés, sur une
     * facture qu'une cliente détient. Effacer la fiche ferait diverger les deux,
     * et un litige se jugerait sur une pièce introuvable.
     */
    await post({ type: 'INSERT', table: 'articles', record: ligne(12) })

    const reponse = await post({
      type: 'DELETE',
      table: 'articles',
      old_record: ligne(12),
    })

    expect(reponse.status).toBe(200)

    const enBase = await prisma.article.findUniqueOrThrow({
      where: { externalId: `${PREFIX}12` },
      select: { status: true },
    })
    expect(enBase.status).toBe('ARCHIVED')
  })

  it('n’échoue PAS sur une pièce que l’application n’a pas remplie', async () => {
    // Un libellé dont on ne peut pas déduire le vêtement n'est pas une panne :
    // renvoyer une erreur ferait réessayer le webhook indéfiniment.
    const reponse = await post({
      type: 'INSERT',
      table: 'articles',
      record: ligne(13, { article: 'Lot vintage' }),
    })

    expect(reponse.status).toBe(200)
    expect(await reponse.json()).toMatchObject({
      skipped: 'categorie-indeduisible',
    })
  })
})

describe('le filtre d’espace de travail', () => {
  it('IGNORE une ligne d’un autre espace, et ne l’écrit pas', async () => {
    /**
     * La protection PRINCIPALE de cette route.
     *
     * La base de l'application contient l'inventaire de dizaines d'espaces de
     * travail, dont la plupart appartiennent à d'autres personnes. Un webhook
     * posé sur la table entière — le réglage par défaut — enverrait ici toutes
     * leurs lignes.
     *
     * On ne peut pas s'en remettre au réglage du webhook : il vit dans une
     * console tierce, se modifie sans que ce dépôt le sache, et personne ne
     * relit un filtre posé une fois.
     */
    const reponse = await post({
      type: 'INSERT',
      table: 'articles',
      record: ligne(20, { workspace_id: 'espace-de-quelqu-un-d-autre' }),
    })

    // 200 : l'émetteur n'a rien fait de mal, et une erreur ferait réessayer une
    // ligne qu'on ignore par construction.
    expect(reponse.status).toBe(200)
    expect(await reponse.json()).toMatchObject({ ignored: 'autre-espace' })

    expect(
      await prisma.article.count({ where: { externalId: `${PREFIX}20` } }),
    ).toBe(0)
  })

  it('ignore une autre table', async () => {
    const reponse = await post({
      type: 'INSERT',
      table: 'ventes',
      record: ligne(21),
    })

    expect(await reponse.json()).toMatchObject({ ignored: 'autre-table' })
  })
})

describe('la décision, isolée', () => {
  const lire = (corps: unknown) => appEventSchema.parse(corps)

  it('archive sur DELETE, en lisant l’ANCIENNE ligne', () => {
    // Sur une suppression, `record` est nul : lire uniquement `record` ferait
    // ignorer toutes les suppressions, sans que rien ne le signale.
    const decision = deciderAppEvent(
      lire({ type: 'DELETE', table: 'articles', old_record: ligne(30) }),
      WORKSPACE,
    )

    expect(decision).toMatchObject({ action: 'archive' })
  })

  it('ignore un événement sans aucune ligne', () => {
    expect(
      deciderAppEvent(lire({ type: 'UPDATE', table: 'articles' }), WORKSPACE),
    ).toEqual({ action: 'ignore', motif: 'sans-ligne' })
  })

  it('ignore une ligne SANS espace de travail', () => {
    // Absent n'est pas « le mien » : une colonne nulle ne doit pas ouvrir la
    // porte.
    expect(
      deciderAppEvent(
        lire({
          type: 'INSERT',
          table: 'articles',
          record: ligne(31, { workspace_id: null }),
        }),
        WORKSPACE,
      ),
    ).toEqual({ action: 'ignore', motif: 'autre-espace' })
  })
})
