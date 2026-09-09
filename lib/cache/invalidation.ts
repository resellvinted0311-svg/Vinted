import 'server-only'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/db/client'
import { locales } from '@/lib/i18n/routing'
import { logger } from '@/lib/observability/logger'

/**
 * Purger du cache ce qu'une écriture vient de rendre faux.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce module existe
 * ---------------------------------------------------------------------------
 * Trois pages publiques sont réellement mises en cache, et elles affichent
 * toutes de l'état d'article. Jusqu'ici, elles n'étaient rafraîchies qu'à
 * l'échéance : une pièce vendue restait affichée disponible pendant une
 * minute, une pièce dont les visuels venaient d'arriver restait sans photo, et
 * une baisse de prix mettait autant de temps à se voir.
 *
 * Rien de tout cela ne permettait un achat fautif — le verrou de stock est
 * pris au paiement, pas à l'affichage — mais c'est de l'information fausse
 * servie depuis notre propre cache, et sur un stock à exemplaire unique elle
 * porte précisément sur ce qui décide : est-ce que cette pièce est encore là.
 *
 * L'invalidation à la demande était d'ailleurs prévue et écrite : la vitrine
 * porte depuis le début la note « en Phase 2, la régénération sera aussi
 * déclenchée à la demande au changement de statut d'un article ».
 *
 * ---------------------------------------------------------------------------
 * TROIS pages, et pas une de plus — c'est une MESURE, pas une supposition
 * ---------------------------------------------------------------------------
 * Relevé sur une construction de production, en lisant l'en-tête de réponse :
 *
 *   /{langue}                      x-nextjs-cache présent   s-maxage=60
 *   /{langue}/marques              x-nextjs-cache présent   s-maxage=300
 *   /{langue}/a/{slug}             x-nextjs-cache présent   s-maxage=60
 *   /sitemap.xml                   x-nextjs-cache présent   revalidate=3600
 *
 *   /{langue}/femme · /homme       Cache-Control: no-store
 *   /{langue}/catalogue            Cache-Control: no-store
 *   /{langue}/c/…  · /marque/…     Cache-Control: no-store
 *
 * Les cinq dernières lisent `searchParams` — filtres, tri, curseur — ce qui
 * les rend dynamiques : elles sont recalculées à chaque requête, donc les
 * invalider ne coûte rien et ne PROUVE rien. Une invalidation posée sur une
 * page jamais mise en cache est pire qu'inutile : elle se lit comme une
 * protection, et elle fait croire que le cas est traité.
 *
 * C'est exactement le piège dans lequel `audiencePathsToRevalidate()` est
 * tombé — il invalide `/femme` et `/homme`, qui ne sont pas en cache. On ne le
 * refait pas ici.
 *
 * ---------------------------------------------------------------------------
 * Trois règles qui ne se négocient pas
 * ---------------------------------------------------------------------------
 * 1. JAMAIS `revalidatePath('/', 'layout')`. Cela efface les pages prérendues
 *    du site entier ; sur un chemin atteignable depuis l'extérieur, c'est un
 *    levier de déni de service. `tests/security/cache-invalidation.test.ts`
 *    l'interdit et vérifie l'interdiction.
 *
 * 2. JAMAIS PENDANT UNE TRANSACTION. `revalidatePath` n'est pas annulé par un
 *    `ROLLBACK` : si la transaction échoue après coup, on a purgé une page
 *    pour la faire régénérer sur un état qui n'a jamais existé. Toutes les
 *    fonctions de ce module sont donc appelées APRÈS la validation, depuis le
 *    gestionnaire de route qui a lancé l'écriture.
 *
 * 3. UNIQUEMENT depuis une Server Action ou un Route Handler. Appelé pendant
 *    le rendu d'une page, `revalidatePath` lève. C'est la raison pour laquelle
 *    les fonctions d'écriture de `lib/` ne l'appellent pas elles-mêmes : elles
 *    RENVOIENT ce qu'elles ont touché, et l'appelant décide.
 */

/**
 * Purge UN chemin, sans jamais faire échouer ce qui l'a demandée.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ce `try` empêche, et il a été observé
 * ---------------------------------------------------------------------------
 * `revalidatePath` lit un contexte que Next attache à la requête en cours. Hors
 * de ce contexte, il ne renvoie pas d'erreur discrète : il LÈVE
 * — « Invariant: static generation store missing in revalidatePath ».
 *
 * La première version appelait la purge sans filet depuis le webhook de
 * paiement. Mesuré sur la suite d'intégration, qui invoque le gestionnaire de
 * route directement : la vente était écrite en base, puis la purge levait, et
 * le webhook répondait 500. Stripe voit un échec, rejoue l'événement, et la
 * boutique a encaissé une vente que son propre journal signale comme ratée.
 *
 * C'est le renversement à éviter : une commodité — servir une page fraîche une
 * minute plus tôt — devenait capable de faire échouer la vente elle-même.
 *
 * Le repli est celui d'avant ce module : la page se rafraîchit à son échéance.
 * On perd au pire soixante secondes, et on ne perd rien d'autre. C'est le même
 * raisonnement que `sensitive: false` sur les compteurs de débit — une panne du
 * mécanisme d'appoint ne doit pas devenir une panne du service.
 */
function purger(chemin: string): boolean {
  try {
    revalidatePath(chemin)
    return true
  } catch (error) {
    logger.warn('cache.purge_impossible', {
      chemin,
      errorMessage: error instanceof Error ? error.message : 'erreur inconnue',
    })
    return false
  }
}

/**
 * Combien de fiches on accepte d'invalider une par une en un seul appel.
 *
 * Chaque fiche coûte huit chemins — une par langue. Une passe de baisse
 * automatique n'est pas bornée en nombre de pièces ; sans plafond, un balayage
 * sur un stock de mille pièces demanderait huit mille invalidations dans une
 * seule fonction serverless.
 *
 * Au-delà, on invalide la vitrine et on S'ARRÊTE LÀ, en le journalisant. Les
 * fiches non traitées se rafraîchissent alors à leur échéance de soixante
 * secondes — c'est-à-dire exactement le comportement d'avant ce module, donc
 * un repli sûr et non une perte.
 *
 * Le plafond est haut par rapport au cas qui compte vraiment : une vente
 * touche une à trois pièces.
 */
export const MAX_FICHES_INVALIDEES = 100

/** Les pages en cache qui ne dépendent d'AUCUNE pièce en particulier. */
function cheminsVitrine(): string[] {
  const chemins: string[] = []
  for (const locale of locales) {
    // L'accueil : derniers arrivages, compteur du registre, facettes de taille
    // et de catégorie. Tout cela bouge à la première pièce publiée ou vendue.
    chemins.push(`/${locale}`)
    // L'index des marques porte un effectif par maison.
    chemins.push(`/${locale}/marques`)
  }
  /*
    Le plan de site, et ce n'est pas du zèle.

    Il est mis en cache une heure et il énumère les fiches. Sur un stock de
    pièces UNIQUES qui quittent le catalogue en quelques semaines, une heure
    de retard sur l'annonce d'une nouveauté est une heure prise sur la seule
    fenêtre où elle peut être découverte.

    Il n'a pas de préfixe de langue : une seule entrée porte ses huit
    traductions.
  */
  chemins.push('/sitemap.xml')
  return chemins
}

/** Les huit chemins d'une fiche, un par langue. */
function cheminsFiche(slug: string): string[] {
  return locales.map((locale) => `/${locale}/a/${slug}`)
}

/**
 * Invalide les pages qui ne dépendent d'aucune pièce précise.
 *
 * À utiliser quand une écriture change la vitrine sans qu'on sache — ou sans
 * qu'il soit utile de savoir — quelles fiches sont concernées.
 */
export function invaliderVitrine(): void {
  for (const chemin of cheminsVitrine()) purger(chemin)
}

/**
 * Invalide les fiches nommées, et la vitrine avec elles.
 *
 * La vitrine est purgée UNE fois, quel que soit le nombre de pièces : elle ne
 * dépend d'aucune en particulier, et la purger vingt fois n'a pas plus d'effet
 * que de la purger une.
 *
 * Renvoie le nombre de fiches réellement invalidées, pour que l'appelant
 * puisse le journaliser sans avoir à recompter.
 */
export function invaliderFiches(slugs: readonly string[]): number {
  const uniques = [...new Set(slugs.filter((slug) => slug.length > 0))]

  invaliderVitrine()

  if (uniques.length > MAX_FICHES_INVALIDEES) {
    /*
      Rien n'est tronqué en SILENCE.

      Une troncature muette se lit ensuite comme une couverture complète : on
      croit que toutes les fiches ont été rafraîchies, et on cherche le défaut
      ailleurs. Le journal dit combien de pièces attendent leur échéance.
    */
    logger.warn('cache.invalidation_plafonnee', {
      demandees: uniques.length,
      plafond: MAX_FICHES_INVALIDEES,
      traitees: 0,
    })
    return 0
  }

  for (const slug of uniques) {
    for (const chemin of cheminsFiche(slug)) purger(chemin)
  }

  return uniques.length
}

/**
 * Les réglages qui changent une page PUBLIQUE, et laquelle.
 *
 * ---------------------------------------------------------------------------
 * Deux familles, et la seconde est la plus grave
 * ---------------------------------------------------------------------------
 * Les trois visuels règlent l'accueil, qui est en cache soixante secondes : le
 * retard était réel mais borné.
 *
 * Les trois délais, eux, sont AFFICHÉS DANS LES CONDITIONS GÉNÉRALES DE VENTE,
 * qui les lisent en base au rendu. Or `app/[locale]/(shop)/pages/[slug]`
 * exporte `generateStaticParams` sans aucun `revalidate` : la page est
 * entièrement statique, donc figée jusqu'au prochain déploiement. Changer un
 * délai contractuel depuis la régie laissait le site publier l'ancien,
 * indéfiniment.
 *
 * La table est explicite plutôt que déduite : `EDITABLE_SETTINGS` en compte
 * une quinzaine, et la plupart — marge, frais de paiement, majoration de port
 * — ne s'affichent nulle part publiquement. Purger le site à chaque réglage
 * les traiterait tous pareil et ferait passer un ajustement de marge pour un
 * changement de vitrine.
 */
const PAGES_PAR_REGLAGE: Record<string, 'accueil' | 'cgv'> = {
  homeHeroImageUrl: 'accueil',
  universeImageFemmeUrl: 'accueil',
  universeImageHommeUrl: 'accueil',
  offerResponseHours: 'cgv',
  acceptedOfferValidityHours: 'cgv',
  reservationTtlMinutes: 'cgv',
  // `cgvVersion` n'y figure PAS : il est délibérément exclu d'`EDITABLE_SETTINGS`
  // — une version de CGV se change en publiant de nouvelles CGV, pas en
  // modifiant un champ. Il ne peut donc jamais arriver ici.
}

/**
 * Purge ce que la modification de ces réglages vient de rendre faux.
 *
 * Un réglage absent de la table ne purge rien, et c'est exact : il ne
 * s'affiche sur aucune page mise en cache.
 */
export function invaliderReglages(cles: readonly string[]): void {
  const touchees = new Set(
    cles.map((cle) => PAGES_PAR_REGLAGE[cle]).filter(Boolean),
  )

  if (touchees.has('accueil')) {
    for (const locale of locales) purger(`/${locale}`)
  }

  if (touchees.has('cgv')) {
    for (const locale of locales) purger(`/${locale}/pages/cgv`)
  }
}

/**
 * La même chose, à partir d'IDENTIFIANTS de pièces.
 *
 * Les écritures de stock — verrou, vente, libération — renvoient des
 * identifiants et non des slugs : leurs instructions SQL portent sur `id`, et
 * leur faire ramener le slug en plus obligerait à toucher six `RETURNING`
 * répartis dans trois fichiers, dont deux au cœur du verrou de caisse. Une
 * relecture d'index coûte moins qu'une modification à cet endroit-là.
 *
 * Un identifiant disparu entre l'écriture et ici — cas théorique, une
 * suppression concurrente — est simplement absent du résultat : on n'invalide
 * pas une fiche qui n'existe plus, et rien n'échoue.
 */
export async function invaliderPiecesParId(
  ids: readonly string[],
): Promise<number> {
  const uniques = [...new Set(ids)]
  if (uniques.length === 0) return 0

  // Au-delà du plafond, la relecture des slugs est inutile : aucune fiche ne
  // sera traitée. On évite un `IN` de plusieurs milliers d'entrées pour un
  // résultat qu'on jetterait — et on journalise depuis ici, faute de quoi le
  // plafonnement serait muet sur ce chemin.
  if (uniques.length > MAX_FICHES_INVALIDEES) {
    invaliderVitrine()
    logger.warn('cache.invalidation_plafonnee', {
      demandees: uniques.length,
      plafond: MAX_FICHES_INVALIDEES,
      traitees: 0,
    })
    return 0
  }

  const lignes = await prisma.article.findMany({
    where: { id: { in: uniques } },
    select: { slug: true },
  })

  return invaliderFiches(lignes.map((ligne) => ligne.slug))
}
