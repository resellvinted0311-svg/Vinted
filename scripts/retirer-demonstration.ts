import { prisma } from '../lib/db/client'
import {
  inventorierDemonstration,
  retirerDemonstration,
} from '../lib/admin/demonstration'

/**
 * Retire les pièces du jeu de démonstration d'une base qui les porte encore.
 *
 * ---------------------------------------------------------------------------
 * À qui ce script s'adresse
 * ---------------------------------------------------------------------------
 * Le seed ne pose plus les cinquante pièces inventées en production. Mais une
 * base déployée AVANT cette correction les porte encore, et elles y sont EN
 * VENTE : des vêtements qui n'existent pas, au milieu d'un catalogue qu'on ne
 * distingue pas du vrai. Personne ne le remarquerait — sauf la personne qui en
 * commande un.
 *
 *   pnpm demo:retirer            # essai à blanc : ne supprime RIEN
 *   pnpm demo:retirer --vraiment # supprime
 *
 * ---------------------------------------------------------------------------
 * L'essai à blanc est le DÉFAUT, et ce n'est pas de la prudence décorative
 * ---------------------------------------------------------------------------
 * Une suppression de pièce emporte ses traductions, ses mesures, ses photos et
 * ses négociations. Rien ne les reconstitue. Un script destructeur qui
 * supprime au premier lancement est un script qu'on lance une fois de trop.
 *
 * On affiche donc la liste, nommée pièce par pièce, et on attend un second
 * lancement explicite. C'est la relecture humaine qui tient lieu de dernière
 * vérification — et elle attrape ce qu'aucun critère ne peut attraper : « non,
 * celle-là est à moi ».
 */

async function main(): Promise<void> {
  const vraiment = process.argv.includes('--vraiment')

  const { retirables, bloquees } = await inventorierDemonstration()

  if (retirables.length === 0 && bloquees.length === 0) {
    console.info(
      'Aucune pièce de démonstration dans cette base. Rien à faire.\n' +
        '(Reconnues à leur lieu d’approvisionnement fictif ET à leur numéro\n' +
        ' dans la plage du jeu de démonstration — les deux à la fois.)',
    )
    return
  }

  if (retirables.length > 0) {
    console.info(`${retirables.length} pièce(s) de démonstration à retirer :`)
    for (const piece of retirables) {
      console.info(`  ${piece.sku}  ${piece.titre}`)
    }
  }

  if (bloquees.length > 0) {
    /*
      Le cas qu'on veut VOIR plutôt que forcer.

      `OrderItem.article` est en `onDelete: Restrict` : la base refuse de
      supprimer une pièce qu'une commande référence. C'est juste — une ligne
      comptable qui ne désigne plus rien ne vaut rien, et l'obligation de
      conservation porte sur dix ans.

      Sur une vraie boutique, cela signifie que quelqu'un a commandé un
      vêtement inventé. Il y a alors un remboursement à faire, et c'est une
      décision humaine.
    */
    console.warn(
      `\n${bloquees.length} pièce(s) de démonstration ont été COMMANDÉES et ne ` +
        'peuvent pas être supprimées :',
    )
    for (const piece of bloquees) {
      console.warn(`  ${piece.sku}  ${piece.titre}`)
    }
    console.warn(
      'La base l’interdit, et elle a raison : une commande doit continuer de\n' +
        'désigner ce qui a été vendu. Si ces commandes sont réelles, un\n' +
        'remboursement est dû — c’est une décision humaine, pas une suppression.',
    )
  }

  if (!vraiment) {
    console.info(
      '\nEssai à blanc : RIEN n’a été supprimé.\n' +
        'Relisez la liste ci-dessus, puis relancez avec --vraiment.',
    )
    return
  }

  const supprimees = await retirerDemonstration()
  console.info(`\n${supprimees} pièce(s) supprimée(s).`)

  /*
    Le cache n'est PAS purgé ici, et il faut le dire plutôt que de le faire.

    `revalidatePath` lève hors d'un contexte de requête — c'est le défaut qui a
    transformé une vente réussie en 500 sur le webhook de paiement. Un script
    de maintenance n'en a aucun.

    L'accueil et les pages de marque sont en cache pour une minute à cinq
    minutes. Elles se rafraîchissent donc toutes seules ; en attendant, elles
    peuvent encore montrer une pièce supprimée, dont la fiche répondra 404.
  */
  if (supprimees > 0) {
    console.info(
      'Les pages en cache (accueil, marques) peuvent encore les montrer\n' +
        'quelques minutes, le temps de leur échéance. Leurs fiches, elles,\n' +
        'répondent déjà « introuvable ».',
    )
  }
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
