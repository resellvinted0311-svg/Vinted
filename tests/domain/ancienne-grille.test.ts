import { describe, it, expect } from 'vitest'
import { ANCIENNE_GRILLE_FICTIVE, RATES } from '../../prisma/seed-data/shipping'

/**
 * La reconnaissance de l'ancienne grille fictive.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce fichier, alors que la réconciliation tourne dans le seed
 * ---------------------------------------------------------------------------
 * Le seed exécute son `main()` au chargement : il ne s'importe pas dans un
 * test. Ce qui se teste ici, c'est le CONTRAT qu'il applique — et c'est là que
 * se logerait l'erreur la plus coûteuse.
 *
 * Une ligne de l'ancienne grille qui ne trouverait pas sa place serait soit
 * supprimée à tort (un vrai palier disparaît de la boutique), soit laissée à
 * son prix fictif (un port trop bas, facturé). Les deux sont silencieux.
 *
 * La simulation complète — base semée par la version en production, saisie
 * dans la régie, nouveau seed en mode production, comparaison ligne à ligne —
 * a été faite à la main avant la livraison ; elle est décrite dans le message
 * du commit qui introduit cette table.
 */

const cle = (r: {
  zoneCode: string
  carrierCode: string
  serviceCode: string
  maxWeightGrams: number
}) => `${r.zoneCode}|${r.carrierCode}|${r.serviceCode}|${r.maxWeightGrams}`

const vraiesCles = new Set(RATES.map(cle))

describe('l’ancienne grille fictive', () => {
  it('reprend exactement les 32 lignes que posait la version précédente', () => {
    // Huit groupes de quatre paliers : 500 g, 1, 2 et 5 kg. Une ligne en moins
    // et elle ne serait jamais reconnue — donc jamais corrigée en production.
    expect(ANCIENNE_GRILLE_FICTIVE).toHaveLength(32)
    expect(new Set(ANCIENNE_GRILLE_FICTIVE.map(cle)).size).toBe(32)
  })

  it('ne retire QUE les six paliers absents de la vraie grille', () => {
    /*
      Les seules lignes supprimées sont celles qui n'ont pas de vrai prix :
      Mondial Relay 2 kg et 5 kg en France — la vraie grille passe à 3 et 4 kg
      — et Mondial Relay vers l'UE, dont aucune grille fiable n'a été relevée.

      Si cette liste grandissait par erreur, un palier réel disparaîtrait de la
      boutique au déploiement suivant.
    */
    const retirees = ANCIENNE_GRILLE_FICTIVE.filter(
      (ligne) => !vraiesCles.has(cle(ligne)),
    )
      .map(cle)
      .sort()

    expect(retirees).toEqual(
      [
        'EU1|mondial_relay|MR_RELAY|1000',
        'EU1|mondial_relay|MR_RELAY|2000',
        'EU1|mondial_relay|MR_RELAY|500',
        'EU1|mondial_relay|MR_RELAY|5000',
        'FR|mondial_relay|MR_RELAY|2000',
        'FR|mondial_relay|MR_RELAY|5000',
      ].sort(),
    )
  })

  it('ne confond jamais un prix fictif avec un vrai prix', () => {
    /*
      La réconciliation reconnaît une ligne « jamais touchée » à son prix
      EXACTEMENT fictif. Si un vrai tarif coïncidait avec l'ancien sur le même
      palier, la règle resterait juste — elle teste d'abord le vrai prix — mais
      on veut le savoir : c'est le seul cas où les deux grilles disent la même
      chose et où l'on ne peut plus distinguer qui a posé la valeur.
    */
    const vraiPrix = new Map(RATES.map((r) => [cle(r), r.priceCents]))
    const coincidences = ANCIENNE_GRILLE_FICTIVE.filter(
      (ligne) => vraiPrix.get(cle(ligne)) === ligne.priceCents,
    )

    expect(coincidences).toEqual([])
  })
})
