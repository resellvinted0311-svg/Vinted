import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { PROCESSING_REGISTER } from '@/lib/config/privacy'

/**
 * Aucun modèle porteur de données personnelles ne s'écrit sans être déclaré.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ce fichier attrape, et qu'aucun autre ne voit
 * ---------------------------------------------------------------------------
 * `docs/rgpd.md` liste des modèles « déclarés, jamais écrits » : `Conversation`,
 * `Message`, `ReturnRequest`, `Review`, `SizeAlert`, `PushSubscription`. Le
 * document dit, à juste titre, qu'il faudra trancher leur régime AVANT de les
 * brancher.
 *
 * Une phrase dans un document ne protège rien. Le jour où quelqu'un — dans six
 * mois, peut-être moi — écrira la première ligne de la messagerie, il ajoutera
 * un `prisma.message.create()` et passera à la suite. Le registre restera muet,
 * l'export de l'article 15 ne renverra pas les messages, la purge n'en effacera
 * aucun, et rien nulle part ne le signalera. C'est exactement ce qui était
 * arrivé aux traces de paiement et à la piste d'audit.
 *
 * Ce test transforme la phrase en contrainte : brancher l'un de ces modèles
 * FAIT ÉCHOUER la suite tant que son entrée n'est pas au registre.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ne PAS déclarer d'avance ces traitements
 * ---------------------------------------------------------------------------
 * Ce serait la solution facile, et elle serait fausse. Le registre est lu par
 * la page publique de confidentialité : y annoncer un traitement d'avis clients
 * alors qu'aucun avis ne peut être déposé ferait mentir la déclaration dans
 * l'autre sens. C'est le raisonnement déjà tenu par `activeProcessors()`, qui
 * déduit les sous-traitants de l'environnement plutôt que de les énumérer —
 * précisément pour ne jamais annoncer un tiers qu'on n'utilise pas.
 *
 * On déclare donc au moment où l'on branche, et ce test surveille ce moment.
 */

/**
 * Modèles porteurs de données personnelles, et où ils sont couverts.
 *
 * Écrit à la main, exprès : décider qu'une colonne est une donnée personnelle
 * est un jugement, pas une propriété qu'on déduit d'un schéma. `Article`,
 * `Category` ou `ShippingRate` n'y figurent pas — ils décrivent des vêtements
 * et des tarifs, pas des gens.
 */
type Entree =
  | {
      statut: 'declare'
      sousLaCle: string
      /**
       * D'où vient l'écriture.
       *
       * `directe` — notre code appelle `prisma.<modele>.create` ; c'est le cas
       * qu'on sait détecter, et le seul qu'on vérifie.
       *
       * `imbriquee` — la ligne naît d'un `create` imbriqué dans celui d'un
       * parent. Aucune expression régulière raisonnable ne l'attrape, et en
       * écrire une fragile qui échouerait au premier remaniement serait pire
       * que de nommer le cas ici.
       *
       * `adaptateur` — c'est une bibliothèque qui écrit, pas nous. La table
       * existe pour elle. On ne peut donc rien constater dans nos sources, et
       * l'absence d'écriture n'y est pas un signal.
       */
      ecriture: 'directe' | 'imbriquee' | 'adaptateur'
      /** Obligatoire dès que l'écriture n'est pas directe : où elle a lieu. */
      ou?: string
    }
  | { statut: 'pas-encore-ecrit'; aTrancher: string }

const MODELES_PERSONNELS: Record<string, Entree> = {
  // --- Déclarés au registre, et écrits -------------------------------------
  User: { statut: 'declare', sousLaCle: 'account', ecriture: 'directe' },
  Session: { statut: 'declare', sousLaCle: 'account', ecriture: 'directe' },
  Order: { statut: 'declare', sousLaCle: 'orders', ecriture: 'directe' },
  Shipment: { statut: 'declare', sousLaCle: 'shipments', ecriture: 'directe' },
  Offer: { statut: 'declare', sousLaCle: 'offers', ecriture: 'directe' },
  Cart: { statut: 'declare', sousLaCle: 'cart', ecriture: 'directe' },
  CartItem: { statut: 'declare', sousLaCle: 'cart', ecriture: 'directe' },
  Favorite: { statut: 'declare', sousLaCle: 'favorites', ecriture: 'directe' },
  GuestFavorite: {
    statut: 'declare',
    sousLaCle: 'favorites-guest',
    ecriture: 'directe',
  },
  WebhookEvent: {
    statut: 'declare',
    sousLaCle: 'payment-events',
    ecriture: 'directe',
  },
  Job: { statut: 'declare', sousLaCle: 'payment-events', ecriture: 'directe' },
  AuditLog: {
    statut: 'declare',
    sousLaCle: 'audit-trail',
    ecriture: 'directe',
  },
  UserToken: { statut: 'declare', sousLaCle: 'account', ecriture: 'directe' },

  OrderItem: {
    statut: 'declare',
    sousLaCle: 'orders',
    ecriture: 'imbriquee',
    ou: 'lib/shop/checkout.ts, dans le `order.create` du tunnel',
  },
  Account: {
    statut: 'declare',
    sousLaCle: 'account',
    ecriture: 'adaptateur',
    ou: '@auth/prisma-adapter — la table existe pour lui',
  },
  VerificationToken: {
    statut: 'declare',
    sousLaCle: 'account',
    ecriture: 'adaptateur',
    ou: '@auth/prisma-adapter, pour le lien magique',
  },

  // --- Déclarés au schéma, écrits par RIEN ---------------------------------
  //
  // Chacun porte, ou portera, une donnée personnelle. Aucun n'a de régime
  // arrêté. Le jour où l'un est écrit, ce test tombe.
  /**
   * Trouvé par CE test, et c'était un vrai écart.
   *
   * `Address` figurait au registre sous « orders », était lue par l'export et
   * effacée avec le compte — et n'a JAMAIS été écrite. Il n'existe pas de
   * carnet d'adresses : le tunnel fige l'adresse en JSON sur la commande, et
   * c'est cette copie-là qui porte les données.
   *
   * Le registre annonçait donc une table qui ne contient rien. Ce n'est pas une
   * faille, c'est une déclaration inexacte — dans le sens que ce projet
   * reproche aux politiques rédigées à la main : annoncer un traitement qui
   * n'a pas lieu.
   */
  Address: {
    statut: 'pas-encore-ecrit',
    aTrancher:
      'le carnet d’adresses n’existe pas. Le jour où il existera, ses lignes ' +
      'entreront dans l’entrée « orders » du registre — l’export et ' +
      'l’effacement, eux, la couvrent déjà',
  },
  Conversation: {
    statut: 'pas-encore-ecrit',
    aTrancher:
      'guestEmail et le fil de discussion : durée de conservation, sort des ' +
      'pièces jointes, et ce qu’il advient des messages à l’effacement du compte',
  },
  Message: {
    statut: 'pas-encore-ecrit',
    aTrancher: 'texte libre écrit par une personne, et pièces jointes',
  },
  ReturnRequest: {
    statut: 'pas-encore-ecrit',
    aTrancher:
      'texte libre. Suit-il la durée comptable de la commande, ou une durée ' +
      'propre au litige ?',
  },
  Review: {
    statut: 'pas-encore-ecrit',
    aTrancher:
      'un avis publié survit-il à l’effacement du compte, sous pseudonyme ? ' +
      'Aujourd’hui l’effacement l’emporte',
  },
  SizeAlert: {
    statut: 'pas-encore-ecrit',
    aTrancher:
      'critères de recherche et prix maximum. Effacée avec le compte ; reste ' +
      'à inscrire au registre le jour où elle notifie',
  },
  PushSubscription: {
    statut: 'pas-encore-ecrit',
    aTrancher:
      'l’endpoint identifie un navigateur, et `userId` est FACULTATIF — un ' +
      'abonnement sans compte ne serait purgé par rien. Le consentement aux ' +
      'notifications devra être horodaté',
  },
  NewsletterSubscriber: {
    statut: 'pas-encore-ecrit',
    aTrancher:
      'double opt-in (décision commerciale), preuve du consentement, et le ' +
      'jeton de désinscription obligatoire de l’article L34-5 du CPCE',
  },
  ShipmentEvent: {
    statut: 'pas-encore-ecrit',
    aTrancher:
      'le `raw` d’un transporteur contient nom et adresse : à caviarder à ' +
      'l’écriture, comme les événements de paiement',
  },
}

/** Les modèles réellement présents dans le schéma. */
function modelesDuSchema(): string[] {
  const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')
  return [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]!)
}

function fichiersSource(): string[] {
  const out: string[] = []
  const skip = new Set(['node_modules', '.next', '.git', 'dist', 'coverage'])

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (/\.tsx?$/.test(entry)) out.push(full)
    }
  }

  for (const dir of ['lib', 'app', 'components']) walk(join(process.cwd(), dir))
  return out
}

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** Un accesseur Prisma s'écrit en casse chameau : `PushSubscription` → `pushSubscription`. */
function accesseur(modele: string): string {
  return modele.charAt(0).toLowerCase() + modele.slice(1)
}

/**
 * Le modèle est-il ÉCRIT quelque part ?
 *
 * On cherche les écritures seulement — `create`, `createMany`, `upsert`,
 * `update`, `updateMany`. Une LECTURE ne crée aucune donnée : l'export de
 * l'article 15 lit `review` sans que cela fasse de la boutique un traitement
 * d'avis clients. Et `delete` non plus : c'est même l'inverse.
 */
function estEcrit(modele: string, sources: { file: string; code: string }[]): string[] {
  const nom = accesseur(modele)
  const motif = new RegExp(
    `\\b(?:prisma|tx|client|db)\\s*\\.\\s*${nom}\\s*\\.\\s*(?:create|createMany|upsert|update|updateMany)\\b`,
  )

  return sources.filter(({ code }) => motif.test(code)).map(({ file }) => file)
}

describe('couverture des données personnelles', () => {
  const sources = fichiersSource().map((file) => ({
    file: file.replace(`${process.cwd()}/`, ''),
    code: sansCommentaires(readFileSync(file, 'utf8')),
  }))

  it('la carte des modèles personnels ne dérive pas du schéma', () => {
    // Un modèle renommé ou supprimé laisserait une entrée fantôme, qui
    // couvrirait un modèle qui n'existe plus tout en laissant le vrai à
    // découvert.
    const duSchema = new Set(modelesDuSchema())
    const inconnus = Object.keys(MODELES_PERSONNELS).filter((m) => !duSchema.has(m))

    expect(
      inconnus,
      'ces modèles sont listés ici mais absents du schéma Prisma',
    ).toEqual([])
  })

  it('chaque modèle déclaré personnel pointe vers une entrée réelle du registre', () => {
    const cles = new Set(PROCESSING_REGISTER.map((p) => p.key))
    const orphelins: string[] = []

    for (const [modele, entree] of Object.entries(MODELES_PERSONNELS)) {
      if (entree.statut !== 'declare') continue
      if (!cles.has(entree.sousLaCle)) {
        orphelins.push(`${modele} → « ${entree.sousLaCle} »`)
      }
    }

    expect(
      orphelins,
      'ces modèles renvoient à une clé de registre qui n’existe pas',
    ).toEqual([])
  })

  it('AUCUN modèle « pas encore écrit » n’est écrit', () => {
    // ------------------------------------------------------------------
    // C'est LE test de ce fichier
    // ------------------------------------------------------------------
    // Le jour où quelqu'un branche la messagerie, les retours, les avis ou les
    // notifications, cette assertion tombe — avec, dans le message, la question
    // exacte qu'il faut trancher avant de continuer. C'est la seule façon de
    // faire tenir une promesse écrite dans un document que personne ne relit au
    // bon moment.
    const surprises: string[] = []

    for (const [modele, entree] of Object.entries(MODELES_PERSONNELS)) {
      if (entree.statut !== 'pas-encore-ecrit') continue

      const ecritures = estEcrit(modele, sources)
      if (ecritures.length > 0) {
        surprises.push(
          `${modele} est désormais écrit (${ecritures.join(', ')}).\n` +
            `    À TRANCHER AVANT D'ALLER PLUS LOIN : ${entree.aTrancher}.\n` +
            `    Puis : entrée au registre (lib/config/privacy.ts), export de ` +
            `l'article 15 (lib/privacy/export.ts), effacement ` +
            `(lib/privacy/anonymize.ts), purge (lib/privacy/retention.ts).`,
        )
      }
    }

    expect(surprises.join('\n\n')).toBe('')
  })

  it('les modèles déclarés écrits le sont vraiment', () => {
    // Le garde-fou inverse, et il compte autant : une entrée « déclaré » sur un
    // modèle que plus rien n'écrit fait dire au registre qu'un traitement a
    // lieu alors qu'il a cessé. Le registre mentirait dans l'autre sens — le
    // reproche que ce projet adresse aux politiques rédigées à la main.
    const fantomes: string[] = []

    for (const [modele, entree] of Object.entries(MODELES_PERSONNELS)) {
      if (entree.statut !== 'declare') continue
      // Seules les écritures DIRECTES se constatent depuis nos sources. Les
      // deux autres cas portent leur explication dans la carte : ne rien
      // trouver n'y est pas un signal.
      if (entree.ecriture !== 'directe') continue
      if (estEcrit(modele, sources).length === 0) {
        fantomes.push(modele)
      }
    }

    expect(
      fantomes,
      'ces modèles sont déclarés au registre mais plus rien ne les écrit',
    ).toEqual([])
  })

  it('une écriture non directe dit toujours où elle a lieu', () => {
    // Sans cela, « imbriquee » ou « adaptateur » deviendrait l'échappatoire
    // commode qui dispense de toute vérification : il suffirait de l'écrire.
    const muets: string[] = []

    for (const [modele, entree] of Object.entries(MODELES_PERSONNELS)) {
      if (entree.statut !== 'declare') continue
      if (entree.ecriture === 'directe') continue
      if (!entree.ou || entree.ou.length < 15) muets.push(modele)
    }

    expect(muets).toEqual([])
  })

  it('surveille bien quelque chose', () => {
    // Sans ce garde-fou, une carte vide ou une détection cassée rendrait tout
    // ce qui précède vert pour la pire des raisons.
    const aSurveiller = Object.values(MODELES_PERSONNELS).filter(
      (e) => e.statut === 'pas-encore-ecrit',
    )
    expect(aSurveiller.length).toBeGreaterThan(4)
    expect(sources.length).toBeGreaterThan(50)

    // Et la détection d'écriture fonctionne : `Order` est massivement écrit.
    expect(estEcrit('Order', sources).length).toBeGreaterThan(0)
  })
})
