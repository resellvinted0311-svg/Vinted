import 'server-only'

import { prisma } from '@/lib/db/client'
import { Prisma } from '@prisma/client'

/**
 * Effacement d'un compte — article 17 du RGPD.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi « anonymiser » et non « supprimer »
 * ---------------------------------------------------------------------------
 * Un DELETE sur la ligne User paraît être la réponse évidente à un droit à
 * l'effacement. C'est en réalité l'inverse de ce qu'il faut faire dès qu'une
 * commande existe, et pour deux raisons opposées :
 *
 *  - il détruit trop : une facture est une pièce comptable, conservée dix ans
 *    (article L123-22 du code de commerce). L'article 17.3.b du RGPD écarte
 *    explicitement l'effacement quand une obligation légale impose la
 *    conservation. Supprimer, c'est troquer une infraction pour une autre ;
 *  - il n'efface pas assez : la commande garde son instantané d'adresse et son
 *    adresse e-mail. Supprimer la ligne User laisserait ces données-là en
 *    place, avec `userId` à NULL — le compte disparaît, la personne reste
 *    identifiable. Le pire des deux mondes.
 *
 * On vide donc l'identité et on garde la pièce comptable. Ce qui subsiste est
 * exactement ce que la loi exige : nom et adresse de facturation, montants,
 * dates. Rien de plus.
 *
 * ---------------------------------------------------------------------------
 * Suppression réelle quand elle est possible
 * ---------------------------------------------------------------------------
 * Sans aucune commande, aucune obligation comptable ne s'oppose à
 * l'effacement : la ligne part pour de bon, avec tout ce qui en dépend. C'est
 * le cas le plus fréquent d'un compte créé puis abandonné, et il ne mérite pas
 * un demi-effacement.
 */

/**
 * Domaine réservé par la RFC 2606 : aucune adresse en `.invalid` ne peut
 * exister ni être routée. Le jeton reste unique — la colonne l'exige — sans
 * ressembler à l'adresse de qui que ce soit.
 */
function tombstoneEmail(userId: string): string {
  return `anonyme-${userId}@anonymise.invalid`
}

/**
 * Retire le téléphone d'une adresse figée, sans toucher au reste.
 *
 * Les adresses des commandes sont des colonnes `Json` : on ne peut pas les
 * mettre à jour par champ en SQL sans réécrire l'objet. On le relit donc, on
 * en retire une clé, et on le réécrit — en préservant tout ce qu'on ne
 * reconnaît pas, parce que la forme de cet objet a pu changer depuis.
 */
function stripPhone(value: Prisma.JsonValue): Prisma.InputJsonValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, Prisma.JsonValue>
  if (!('phone' in record)) return null

  const { phone: _phone, ...rest } = record
  return rest as Prisma.InputJsonValue
}

/**
 * Retire le téléphone des adresses figées d'un lot de commandes.
 *
 * Ligne par ligne, et c'est inévitable : chaque adresse est un objet distinct.
 * Le nombre de commandes d'une seule personne se compte en dizaines au plus.
 */
async function stripPhonesFromOrders(
  tx: Prisma.TransactionClient,
  where: Prisma.OrderWhereInput,
): Promise<void> {
  const orders = await tx.order.findMany({
    where,
    select: { id: true, shippingAddress: true, billingAddress: true },
  })

  for (const order of orders) {
    const shipping = stripPhone(order.shippingAddress)
    const billing = stripPhone(order.billingAddress)
    if (!shipping && !billing) continue

    await tx.order.update({
      where: { id: order.id },
      data: {
        ...(shipping ? { shippingAddress: shipping } : {}),
        ...(billing ? { billingAddress: billing } : {}),
      },
    })
  }
}

/**
 * Tables liées sans cascade déclarée, à effacer à la main.
 *
 * `UserToken` n'a pas de relation Prisma vers User — seulement une colonne
 * `userId`. Aucune cascade ne l'emportera donc : oublier cette ligne
 * laisserait des jetons de réinitialisation vivants sur un compte effacé.
 */
async function deleteUnlinkedRows(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.userToken.deleteMany({ where: { userId } })
}

/**
 * Vide un compte de ses données personnelles, en conservant la ligne.
 *
 * Idempotent : rejouer l'opération sur un compte déjà anonymisé ne change
 * rien et ne lève pas. Une purge qui échoue à mi-chemin peut donc être
 * relancée telle quelle.
 */
export async function anonymizeUser(
  userId: string,
  now = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, anonymizedAt: true },
    })

    if (!user || user.anonymizedAt) return

    // Tout ce qui n'a d'utilité que pour la personne elle-même s'en va : elle
    // ne reviendra pas le consulter.
    await tx.session.deleteMany({ where: { userId } })
    await tx.account.deleteMany({ where: { userId } })
    await tx.address.deleteMany({ where: { userId } })
    await tx.favorite.deleteMany({ where: { userId } })
    await tx.sizeAlert.deleteMany({ where: { userId } })
    await tx.cart.deleteMany({ where: { userId } })
    await tx.pushSubscription.deleteMany({ where: { userId } })
    await deleteUnlinkedRows(tx, userId)

    // L'adresse e-mail portée par la commande n'est PAS une mention
    // obligatoire de la facture (article 242 nonies A de l'annexe II du CGI) :
    // elle s'efface. Le nom et l'adresse de facturation, eux, le sont, et
    // restent. C'est là que passe la frontière de l'article 17.3.b.
    //
    // Le NUMÉRO DE TÉLÉPHONE ne figure dans aucune de ces mentions. Il est
    // demandé pour la livraison, il ne sert plus une fois la pièce remise, et
    // il est retiré des deux adresses figées — voir `stripPhone` plus bas.
    await tx.order.updateMany({
      where: { userId },
      data: {
        email: tombstoneEmail(userId),
        customerNote: null,
        // Le propriétaire du verrou de stock porte le JETON DE SESSION
        // boutique. Il n'a plus aucune utilité une fois la vente conclue — le
        // verrou est libéré depuis longtemps — et il reste un identifiant
        // indirect de la personne.
        //
        // Surtout : `ownerScope`, dans lib/db/queries/orders.ts, ouvre une
        // commande à qui présente ce jeton. Le laisser en place après un
        // effacement laisserait un navigateur encore porteur du cookie rouvrir
        // la commande et lire l'adresse de facturation conservée. On ferme la
        // porte en même temps qu'on vide l'identité.
        lockOwnerId: null,
        // Le point relais choisi n'est pas une mention obligatoire de facture.
        // La purge des tunnels abandonnés l'effaçait déjà ; l'effacement d'un
        // compte le laissait. Cette asymétrie n'avait aucune raison d'être :
        // c'est la même donnée, avec la même absence de justification.
        servicePointId: null,
        servicePointData: Prisma.DbNull,
      },
    })

    await stripPhonesFromOrders(tx, { userId })

    await tx.user.update({
      where: { id: userId },
      data: {
        email: tombstoneEmail(userId),
        passwordHash: null,
        firstName: null,
        lastName: null,
        name: null,
        image: null,
        emailVerified: null,
        marketingConsent: false,
        marketingConsentAt: null,
        lastSeenAt: null,
        anonymizedAt: now,
      },
    })
  })
}

export type AccountErasure =
  /** Aucune commande : la ligne a été réellement supprimée. */
  | { outcome: 'deleted' }
  /** Des commandes existent : identité vidée, pièces comptables conservées. */
  | { outcome: 'anonymized'; retainedOrders: number }

/**
 * Efface le compte d'une personne à sa demande.
 *
 * Renvoie ce qui a réellement eu lieu, pour pouvoir le lui dire. Annoncer
 * « votre compte a été supprimé » alors que des factures subsistent serait
 * faux, et c'est précisément le genre d'imprécision qui fait perdre la
 * confiance qu'on cherchait à gagner.
 */
export async function eraseAccount(userId: string): Promise<AccountErasure> {
  const retainedOrders = await prisma.order.count({ where: { userId } })

  if (retainedOrders === 0) {
    // Les cascades du schéma emportent sessions, adresses, favoris, paniers,
    // alertes et abonnements ; les jetons, eux, n'ont pas de relation.
    await prisma.$transaction(async (tx) => {
      await deleteUnlinkedRows(tx, userId)
      await tx.user.delete({ where: { id: userId } })
    })

    return { outcome: 'deleted' }
  }

  await anonymizeUser(userId)
  return { outcome: 'anonymized', retainedOrders }
}

/**
 * Vide un tunnel de commande ABANDONNÉ de ses coordonnées.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une commande jamais payée n'est pas une facture
 * ---------------------------------------------------------------------------
 * Aucun paiement n'a eu lieu, aucune facture n'a été émise, aucun exercice
 * comptable ne la porte. L'obligation de dix ans de l'article L123-22 ne la
 * couvre pas, et l'article 17.3.b du RGPD — qui écarte l'effacement quand une
 * loi impose la conservation — ne s'applique donc pas non plus.
 *
 * Il ne reste alors rien pour justifier de garder un nom, une rue, un code
 * postal, une ville, un téléphone et une adresse e-mail. C'est l'article 5.1.e :
 * une durée n'excédant pas ce qui est nécessaire.
 *
 * ---------------------------------------------------------------------------
 * On vide, on ne supprime pas
 * ---------------------------------------------------------------------------
 * Trois raisons, dans cet ordre :
 *
 *  1. un paiement a PU aboutir sans que le webhook nous parvienne. Supprimer
 *     la ligne détruirait la seule trace de la tentative, au moment précis où
 *     elle servirait à retrouver un débit orphelin. On garde donc les
 *     montants, les dates et les identifiants Stripe ;
 *  2. la suite des numéros de commande reste continue et vérifiable ;
 *  3. ce qui subsiste ne désigne plus personne : ni nom, ni adresse, ni
 *     e-mail, ni note, ni jeton de session.
 *
 * ---------------------------------------------------------------------------
 * Une commande PAYÉE n'est jamais touchée
 * ---------------------------------------------------------------------------
 * Le prédicat porte sur `paidAt` et `invoiceNumber`, pas sur le statut.
 * `CANCELLED` recouvre deux réalités opposées — un tunnel abandonné et une
 * vente annulée après encaissement — et seule la date de paiement les
 * distingue de façon sûre.
 */
export async function anonymizeAbandonedOrders(
  cutoff: Date,
  /**
   * Borne par passage. La purge tourne sur une fonction serverless au temps
   * d'exécution borné : traiter des milliers de lignes d'un coup échouerait en
   * entier, et n'en anonymiserait aucune. Le reste passe au tour suivant.
   */
  limit = 200,
): Promise<number> {
  const abandoned = await prisma.order.findMany({
    where: {
      createdAt: { lt: cutoff },
      // Jamais payée, sous les deux angles. Les deux, parce qu'une commande
      // facturée sans `paidAt` serait une anomalie qu'il vaut mieux épargner
      // que détruire.
      paidAt: null,
      invoiceNumber: null,
      // Déjà vidée : rien à refaire. C'est ce qui rend la purge idempotente.
      email: { not: { startsWith: ABANDONED_EMAIL_PREFIX } },
    },
    select: { id: true },
    take: limit,
  })

  if (abandoned.length === 0) return 0

  const ids = abandoned.map((order) => order.id)

  await prisma.$transaction(async (tx) => {
    for (const id of ids) {
      await tx.order.update({
        where: { id },
        data: {
          email: `${ABANDONED_EMAIL_PREFIX}${id}@anonymise.invalid`,
          customerNote: null,
          // Le jeton de session ouvre la commande via `ownerScope` : il part
          // avec le reste.
          lockOwnerId: null,
          shippingAddress: {},
          billingAddress: {},
          servicePointId: null,
          servicePointData: Prisma.DbNull,
        },
      })
    }
  })

  return ids.length
}

/**
 * Préfixe des adresses de commandes abandonnées.
 *
 * Sert de marqueur : une commande déjà vidée ne l'est pas deux fois. Le
 * domaine `.invalid` est réservé par la RFC 2606 et ne peut être routé.
 */
const ABANDONED_EMAIL_PREFIX = 'abandon-'

/**
 * Vide une commande PAYÉE dont l'obligation comptable est éteinte.
 *
 * ---------------------------------------------------------------------------
 * Dix ans annoncés, dix ans jamais appliqués
 * ---------------------------------------------------------------------------
 * Le registre déclarait publiquement une conservation de dix ans pour les
 * pièces comptables, et rien ne l'appliquait : aucune ligne de code ne touchait
 * jamais une commande payée. Une durée annoncée sans mécanisme est une
 * déclaration fausse — c'est le reproche que ce module adresse lui-même aux
 * politiques de confidentialité rédigées à la main.
 *
 * Passé l'obligation de l'article L123-22, plus rien ne fonde de garder
 * l'identité de l'acheteuse : l'article 17.3.b cesse de s'appliquer avec elle,
 * et l'article 5.1.e reprend la main.
 *
 * ---------------------------------------------------------------------------
 * On vide, on ne supprime pas — ici encore
 * ---------------------------------------------------------------------------
 * La ligne comptable elle-même, montants et dates, n'a rien de personnel une
 * fois l'identité retirée, et la suite des numéros de facture reste continue et
 * vérifiable. Supprimer ferait perdre la seconde propriété sans rien gagner sur
 * la première.
 *
 * ---------------------------------------------------------------------------
 * Ce code ne s'exécutera pas avant dix ans
 * ---------------------------------------------------------------------------
 * Ce n'est pas une raison de l'écrire approximativement, c'en est une de
 * l'écrire maintenant : dans dix ans, personne ne se souviendra qu'il manque.
 * Le test se place à la date voulue plutôt que d'attendre.
 */
export async function anonymizeExpiredOrders(
  cutoff: Date,
  limit = 200,
): Promise<number> {
  const expired = await prisma.order.findMany({
    where: {
      // La date de PAIEMENT, pas celle de création : c'est elle qui rattache
      // la pièce à un exercice comptable, et donc elle qui fait courir les dix
      // ans.
      paidAt: { not: null, lt: cutoff },
      email: { not: { startsWith: EXPIRED_EMAIL_PREFIX } },
    },
    select: { id: true },
    take: limit,
  })

  if (expired.length === 0) return 0

  await prisma.$transaction(async (tx) => {
    for (const order of expired) {
      await tx.order.update({
        where: { id: order.id },
        data: {
          email: `${EXPIRED_EMAIL_PREFIX}${order.id}@anonymise.invalid`,
          customerNote: null,
          lockOwnerId: null,
          shippingAddress: {},
          billingAddress: {},
          servicePointId: null,
          servicePointData: Prisma.DbNull,
        },
      })
    }
  })

  return expired.length
}

/** Marque des commandes dont la conservation comptable est éteinte. */
const EXPIRED_EMAIL_PREFIX = 'echu-'
