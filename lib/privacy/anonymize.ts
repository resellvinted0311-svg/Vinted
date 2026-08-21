import 'server-only'

import { prisma } from '@/lib/db/client'
import type { Prisma } from '@prisma/client'

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
    await tx.order.updateMany({
      where: { userId },
      data: { email: tombstoneEmail(userId), customerNote: null },
    })

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
