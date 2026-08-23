import { describe, it, expect } from 'vitest'
import {
  findPrivateFieldLeaks,
  publicArticleCardSelect,
  publicArticleDetailSelect,
  PRIVATE_ARTICLE_FIELDS,
} from '@/lib/db/selectors'
import { offerRegisterSelect } from '@/lib/db/queries/offers'

/**
 * Test n° 8 du brief : aucune réponse publique ne contient costCents.
 *
 * Deux angles complémentaires :
 *  - les sélecteurs Prisma publics ne demandent pas les champs privés ;
 *  - le détecteur d'exécution repère une fuite même imbriquée.
 */

function selectedKeys(select: Record<string, unknown>): string[] {
  const keys: string[] = []

  const walk = (node: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(node)) {
      if (value === true) {
        keys.push(key)
      } else if (value && typeof value === 'object') {
        const nested = value as Record<string, unknown>
        if (nested.select && typeof nested.select === 'object') {
          walk(nested.select as Record<string, unknown>)
        }
      }
    }
  }

  walk(select)
  return keys
}

describe('sélecteurs publics', () => {
  it('la vignette catalogue ne demande aucun champ privé', () => {
    const keys = selectedKeys(publicArticleCardSelect)
    for (const field of PRIVATE_ARTICLE_FIELDS) {
      expect(keys).not.toContain(field)
    }
  })

  it('la fiche article ne demande aucun champ privé', () => {
    const keys = selectedKeys(publicArticleDetailSelect)
    for (const field of PRIVATE_ARTICLE_FIELDS) {
      expect(keys).not.toContain(field)
    }
  })

  it('la fiche article expose bien les mesures réelles', () => {
    const keys = selectedKeys(publicArticleDetailSelect)
    expect(keys).toContain('valueCm')
  })

  it('le registre des offres ne demande aucun champ privé', () => {
    // Une page de négociation est le pire endroit où laisser fuiter un prix
    // plancher : il dirait à l'acheteuse exactement jusqu'où descendre.
    const keys = selectedKeys(offerRegisterSelect)

    for (const field of PRIVATE_ARTICLE_FIELDS) {
      expect(keys).not.toContain(field)
    }

    // Propres à l'offre : une note interne sur une décision commerciale, et
    // les traces d'identité d'un dépôt sans compte.
    for (const field of [
      'acceptedBelowFloor',
      'guestEmail',
      'guestSessionToken',
      'minOfferCents',
    ]) {
      expect(keys, field).not.toContain(field)
    }
  })
})

describe('findPrivateFieldLeaks', () => {
  it('ne signale rien sur une charge utile propre', () => {
    expect(
      findPrivateFieldLeaks({
        id: 'a1',
        priceCents: 2500,
        images: [{ url: '/x.jpg' }],
      }),
    ).toEqual([])
  })

  it('repère un coût d’achat au premier niveau', () => {
    expect(findPrivateFieldLeaks({ id: 'a1', costCents: 500 })).toEqual([
      'costCents',
    ])
  })

  it('repère une fuite imbriquée dans un tableau', () => {
    const leaks = findPrivateFieldLeaks({
      items: [{ article: { internalNotes: 'acheté 3 €' } }],
    })
    expect(leaks).toContain('items[0].article.internalNotes')
  })

  it('repère une empreinte de mot de passe', () => {
    expect(findPrivateFieldLeaks({ user: { passwordHash: '$argon2id$...' } }))
      .toContain('user.passwordHash')
  })

  it('ne boucle pas sur une structure cyclique', () => {
    const node: Record<string, unknown> = { id: 'a1' }
    node.self = node
    expect(() => findPrivateFieldLeaks(node)).not.toThrow()
  })
})
