/*
  Pas de `server-only` ici, contrairement au reste de `lib/admin`.

  Ce module est appelé par `scripts/retirer-demonstration.ts`, qui tourne sous
  `tsx` et non dans Next : `server-only` y lève au chargement, et le script ne
  démarre pas du tout. C'est délibéré et non un oubli — la vérification se
  ferait au mauvais endroit.

  Ce qui protège réellement d'un import côté client reste en place : ce module
  ouvre la base, et un composant client qui l'importerait échouerait à la
  compilation sur `@/lib/db/client`.
*/
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { DEMO_SOURCING_PLACES } from '../../prisma/seed-data/fixtures'

/**
 * Retrouver — et retirer — les pièces du jeu de démonstration.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce chemin existe alors que le seed ne les pose plus en production
 * ---------------------------------------------------------------------------
 * Il ne les pose plus. Mais une base déployée AVANT cette correction les porte
 * encore, et elles sont en vente : cinquante vêtements qui n'existent pas,
 * dans un catalogue qu'on ne distingue pas du vrai. Il fallait un moyen de les
 * retirer sans supprimer une pièce réelle à côté.
 *
 * ---------------------------------------------------------------------------
 * DEUX conditions, et c'est tout l'enjeu
 * ---------------------------------------------------------------------------
 * Une pièce importée depuis l'application de gestion reçoit EXACTEMENT le même
 * format de numéro que le jeu de démonstration : `ART-000051` suit
 * `ART-000050`, sur le même compteur. Le numéro seul ne distingue donc rien —
 * il dit seulement « posée avant », ce qui est vrai du jeu de démonstration
 * sur une base semée, et faux partout ailleurs.
 *
 * On exige donc AUSSI le lieu d'approvisionnement, qui ne peut venir que du
 * fichier de démonstration : « vide-grenier de Trifouillis » n'est pas un
 * endroit. Une pièce réelle devrait porter les deux marques à la fois pour
 * être prise pour un faux, et le second critère est hors d'atteinte d'un
 * import.
 *
 * Le croisement est volontairement plus strict que nécessaire. Le coût des
 * deux erreurs n'est pas le même : laisser un faux en vente se répare en
 * relançant ce retrait ; supprimer une vraie pièce détruit une fiche, ses
 * traductions, ses mesures et ses photos, et rien ne les reconstitue.
 */

/**
 * Le dernier numéro que le jeu de démonstration occupe.
 *
 * C'est une propriété du SEED — il pose `ART-000001` à `ART-000050` — et non
 * une loi. Elle est donc surchargeable : les tests posent leurs propres pièces
 * sur une plage à eux, sans quoi ils entreraient en collision avec les
 * cinquante vraies-fausses pièces de la base de développement, et le test de
 * suppression viderait le catalogue sur lequel tournent les autres.
 */
export const PREMIER_NUMERO_DEMONSTRATION = 1
export const DERNIER_NUMERO_DEMONSTRATION = 50

/**
 * De quoi borner la reconnaissance. Les tests sont les seuls à s'en servir.
 *
 * Les DEUX bornes, et c'est une correction : avec un simple plafond, une plage
 * de test posée au-dessus de la plage réelle l'ENGLOBAIT. Le test de
 * suppression a donc effacé les cinquante pièces du catalogue de
 * développement — celles-là mêmes sur lesquelles tournent les autres fichiers
 * et toute la suite de bout en bout.
 *
 * Le défaut n'est apparu qu'en lançant le script pour de vrai : les tests,
 * eux, passaient. C'est la raison pour laquelle un script destructeur se
 * vérifie à la main en plus d'être testé.
 */
export interface BornesDemonstration {
  premierNumero?: number
  dernierNumero?: number
}

/** Une pièce candidate au retrait, telle qu'on la montre avant de décider. */
export interface PieceDemonstration {
  id: string
  sku: string
  titre: string
  /** Vrai quand une commande la référence : elle ne peut pas être supprimée. */
  commandee: boolean
}

/** Ce qu'un passage a trouvé, et ce qu'il peut faire. */
export interface InventaireDemonstration {
  retirables: PieceDemonstration[]
  /**
   * Pièces de démonstration qu'une commande référence.
   *
   * Elles ne sont PAS supprimables, et c'est la base qui l'impose —
   * `OrderItem.article` est en `onDelete: Restrict`. Ce n'est pas un obstacle à
   * contourner : une commande dont la pièce a disparu est une ligne comptable
   * qui ne désigne plus rien, et l'obligation de conservation porte sur dix
   * ans.
   *
   * Sur une vraie boutique le cas ne devrait pas se produire — personne n'a
   * acheté un vêtement inventé. S'il se produit, c'est précisément ce qu'on
   * veut voir plutôt que forcer.
   */
  bloquees: PieceDemonstration[]
}

/**
 * Dresse l'inventaire sans rien écrire.
 *
 * Séparé de la suppression pour que l'essai à blanc soit le MÊME code que le
 * passage réel. Un essai à blanc qui emprunte un autre chemin ne prouve rien
 * sur ce que fera le vrai.
 */
export async function inventorierDemonstration(
  bornes: BornesDemonstration = {},
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<InventaireDemonstration> {
  const premierNumero = bornes.premierNumero ?? PREMIER_NUMERO_DEMONSTRATION
  const dernierNumero = bornes.dernierNumero ?? DERNIER_NUMERO_DEMONSTRATION

  const candidates = await client.article.findMany({
    where: {
      // Le lieu d'approvisionnement du jeu de démonstration, et lui seul.
      sourcedFrom: { in: [...DEMO_SOURCING_PLACES] },
    },
    select: {
      id: true,
      sku: true,
      translations: {
        where: { locale: 'fr' },
        select: { title: true },
        take: 1,
      },
      _count: { select: { orderItems: true } },
    },
    orderBy: { sku: 'asc' },
  })

  const retirables: PieceDemonstration[] = []
  const bloquees: PieceDemonstration[] = []

  for (const candidate of candidates) {
    /*
      La seconde condition : le numéro doit tomber dans la plage du jeu de
      démonstration.

      Lu depuis la chaîne plutôt que comparé à une liste écrite ici : la liste
      divergerait le jour où le jeu changerait de taille, et c'est le genre de
      divergence qui ne se voit qu'au moment où l'on supprime.
    */
    const numero = Number(candidate.sku.replace(/\D/g, ''))
    if (
      !Number.isInteger(numero) ||
      numero < premierNumero ||
      numero > dernierNumero
    ) {
      continue
    }

    const piece: PieceDemonstration = {
      id: candidate.id,
      sku: candidate.sku,
      titre: candidate.translations[0]?.title ?? '(sans titre)',
      commandee: candidate._count.orderItems > 0,
    }

    if (piece.commandee) bloquees.push(piece)
    else retirables.push(piece)
  }

  return { retirables, bloquees }
}

/**
 * Supprime les pièces retirables de l'inventaire.
 *
 * Les traductions, mesures, photos et favoris partent avec elles : leurs
 * relations sont en `onDelete: Cascade`. Les offres aussi — une négociation sur
 * un vêtement qui n'existe pas n'a rien à conserver.
 *
 * Rend le nombre de pièces réellement supprimées.
 */
export async function retirerDemonstration(
  bornes: BornesDemonstration = {},
): Promise<number> {
  const { retirables } = await inventorierDemonstration(bornes)
  if (retirables.length === 0) return 0

  const resultat = await prisma.article.deleteMany({
    where: { id: { in: retirables.map((piece) => piece.id) } },
  })

  return resultat.count
}
