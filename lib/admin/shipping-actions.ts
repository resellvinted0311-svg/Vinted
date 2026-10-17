'use server'

import { prisma } from '@/lib/db/client'
import { requireAdmin } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { recordAudit } from '@/lib/audit/trail'
import { parseAmountToCents } from '@/lib/domain/money'
import {
  ecrireGrilles,
  grillesSchema,
  type GrillesInput,
} from '@/lib/admin/shipping-rates'

/**
 * Les tarifs de port, modifiables depuis le back-office.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * `'use server'` ne rend pas un fichier privé : il rend PUBLIC tout ce qu'il
 * exporte. Ce module n'exporte donc qu'UNE action, et elle commence par
 * `requireAdmin()`.
 *
 * Le middleware protège `/admin`, mais une Server Action n'est pas une page :
 * elle est appelée par un POST vers l'URL de la page qui l'a rendue, et rien
 * n'oblige un appelant à passer par cette page. L'enjeu est direct — sans ce
 * contrôle, n'importe qui poserait tous les coûts de port à zéro et se ferait
 * livrer gratuitement, ou les poserait à mille euros et rendrait la boutique
 * inutilisable.
 *
 * ---------------------------------------------------------------------------
 * Les montants se saisissent en EUROS
 * ---------------------------------------------------------------------------
 * Et non en centimes comme sur l'écran des réglages. Ce n'est pas une
 * incohérence : une grille tarifaire de transporteur s'énonce en euros — « 4,20 €
 * jusqu'à 500 g » — et obliger à la convertir à la main avant de la recopier
 * est le meilleur moyen de glisser un facteur cent sur une ligne.
 *
 * `parseAmountToCents` accepte la virgule comme le point, et REFUSE tout le
 * reste. Il ne devine pas : « 4,2O » avec un O majuscule est rejeté plutôt que
 * lu comme 4,20.
 */

export type AdminShippingState =
  | { status: 'idle' }
  | { status: 'error'; messageKey: string; id?: string }
  | { status: 'done'; changed: number }

const ERROR = (messageKey: string, id?: string): AdminShippingState => ({
  status: 'error',
  messageKey,
  ...(id === undefined ? {} : { id }),
})

/** Préfixes des champs du formulaire. Lus, jamais parcourus. */
const CHAMP_PRIX = 'prix:'
const CHAMP_ACTIF = 'actif:'
const CHAMP_SEUIL = 'seuil:'

export async function updateShippingRatesAction(
  _previous: AdminShippingState,
  formData: FormData,
): Promise<AdminShippingState> {
  // EN PREMIER, avant toute lecture de l'entrée.
  const admin = await requireAdmin()

  // Compteur sur l'identité prouvée. Il ne protège pas d'un administrateur
  // malveillant — rien ne le peut à ce niveau de droits — mais du script qui
  // boucle : chaque enregistrement ouvre une transaction, et la production
  // n'accorde qu'une connexion par instance.
  const allowed = await checkRateLimit({
    key: `shipping-update:${admin.id}`,
    limit: 60,
    windowSeconds: 3600,
    sensitive: true,
  })
  if (!allowed) return ERROR('rateLimited')

  /*
    On part des lignes RÉELLEMENT en base, jamais de ce que le formulaire a
    envoyé.

    Parcourir `formData` laisserait un appelant inventer un identifiant, ou en
    envoyer mille. Ici, la liste fermée est la base elle-même : on lit les
    identifiants existants, puis on va chercher la valeur de chacun dans le
    formulaire. Ce qui n'y est pas est une requête malformée ; ce qui y est en
    trop n'est jamais regardé.
  */
  const [tarifsEnBase, zonesEnBase] = await Promise.all([
    prisma.shippingRate.findMany({ select: { id: true } }),
    prisma.shippingZone.findMany({ select: { id: true } }),
  ])

  const brut: GrillesInput = { tarifs: [], zones: [] }

  for (const { id } of tarifsEnBase) {
    const prix = formData.get(`${CHAMP_PRIX}${id}`)
    if (typeof prix !== 'string') return ERROR('invalidRequest', id)

    const cents = parseAmountToCents(prix)
    if (Number.isNaN(cents)) return ERROR('invalidValue', id)

    // Une case décochée n'est pas envoyée : c'est le seul champ dont l'absence
    // est une valeur, et elle vaut « désactivé ».
    const actif = formData.get(`${CHAMP_ACTIF}${id}`) !== null

    brut.tarifs.push({ id, priceCents: cents, active: actif })
  }

  for (const { id } of zonesEnBase) {
    const seuil = formData.get(`${CHAMP_SEUIL}${id}`)
    if (typeof seuil !== 'string') return ERROR('invalidRequest', id)

    // Vide = « le port n'est jamais offert sur cette zone ». C'est une valeur
    // légitime — l'outre-mer est dans ce cas — et non un champ oublié.
    const valeur = seuil.trim()
    if (valeur === '') {
      brut.zones.push({ id, freeShippingThresholdCents: null })
      continue
    }

    const cents = parseAmountToCents(valeur)
    if (Number.isNaN(cents)) return ERROR('invalidValue', id)

    brut.zones.push({ id, freeShippingThresholdCents: cents })
  }

  // Le schéma REVALIDE ce qu'on vient de composer : bornes, entiers, tailles de
  // tableau. `parseAmountToCents` convertit une forme, il ne connaît aucune
  // borne — un « 9999 » saisi en euros en sort proprement à 999 900 centimes.
  const parsed = grillesSchema.safeParse(brut)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    // Le chemin d'un refus Zod est `['tarifs', 3, 'priceCents']` : on remonte
    // l'identifiant de la ligne fautive, pour que l'écran puisse la désigner.
    const indice = issue?.path[1]
    const groupe = issue?.path[0]
    const ligne =
      typeof indice === 'number' && (groupe === 'tarifs' || groupe === 'zones')
        ? brut[groupe][indice]?.id
        : undefined
    return ERROR('invalidValue', ligne)
  }

  let modifies: { tarifs: string[]; zones: string[] }

  try {
    modifies = await prisma.$transaction(async (tx) => {
      const resultat = await ecrireGrilles(tx, parsed.data)

      /*
        Une entrée par ligne modifiée, et rien pour celles qu'on a réenvoyées
        inchangées.

        Aucune VALEUR n'est consignée — ni avant, ni après. Le nom de la ligne,
        l'auteur et l'instant suffisent à reconstituer « ce tarif a changé ce
        jour-là » ; recopier les montants dupliquerait dans une table conservée
        dix ans précisément ce qu'on vient de sortir du dépôt. C'est la règle
        déjà tenue par l'écran des réglages.
      */
      for (const id of resultat.tarifs) {
        await recordAudit(tx, {
          action: 'shipping_rate.updated',
          entity: 'ShippingRate',
          entityId: id,
          actorId: admin.id,
        })
      }
      for (const id of resultat.zones) {
        await recordAudit(tx, {
          action: 'shipping_zone.updated',
          entity: 'ShippingZone',
          entityId: id,
          actorId: admin.id,
        })
      }

      return resultat
    })
  } catch (error) {
    // Laissé remonter : une écriture refusée par la base n'est pas un cas
    // prévu ici, et l'avaler afficherait « enregistré » sur un formulaire qui
    // n'a rien écrit.
    throw error
  }

  /*
    AUCUNE invalidation de cache, et c'est délibéré.

    Le devis de port est calculé à la demande dans le tunnel de commande, qui
    est `force-dynamic` : il relit la grille à chaque appel. La page publique
    qui affiche les délais et le seuil de gratuité (`/pages/livraison`) lit, elle
    aussi, en base au rendu — mais elle est servie statiquement.

    Elle n'est pas purgée ici parce que `invaliderReglages` ne la couvre pas et
    qu'inventer un chemin de purge au jugé est la faute qui a fait purger les
    171 pages prérendues pour rien. Le seuil de gratuité affiché peut donc
    traîner jusqu'au prochain déploiement — c'est un écart d'affichage, pas un
    écart de facturation : le montant réellement prélevé vient du devis, qui est
    juste à la seconde.

    À reprendre le jour où l'invalidation couvrira cette page.
  */

  return {
    status: 'done',
    changed: modifies.tarifs.length + modifies.zones.length,
  }
}
