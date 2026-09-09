import type { Metadata } from 'next'

/**
 * Les métadonnées d'une page qui ne doit PAS être indexée.
 *
 * ---------------------------------------------------------------------------
 * Le `noindex` était posé ; le canonique, lui, mentait
 * ---------------------------------------------------------------------------
 * Quatorze pages — panier, tunnel, confirmation, favoris, connexion,
 * inscription, mot de passe, espace compte, suivi de commande, facture —
 * écrivaient `robots: { index: false, follow: false }` et s'arrêtaient là.
 *
 * Or les métadonnées de Next se composent en CASCADE : ce qu'une page ne
 * déclare pas, elle l'hérite de la mise en page au-dessus. Et cette mise en
 * page déclare, pour l'accueil :
 *
 *     alternates: { canonical: `/${locale}`, languages: { …huit langues… } }
 *
 * Chacune de ces quatorze pages annonçait donc que sa version canonique EST
 * L'ACCUEIL, et publiait les huit `hreflang` de l'accueil. C'est-à-dire, mot
 * pour mot au moteur : « /fr/panier et /fr/ sont la même page, et voici ses
 * traductions ». Le `noindex` disait par ailleurs de ne pas l'indexer, les
 * deux consignes portant sur des choses différentes, aucune ne corrige
 * l'autre.
 *
 * Deux conséquences, dont la seconde est la vraie :
 *
 *  1. le rapport de couverture se remplit de « page en double, autre page
 *     canonique choisie », qui masque les vrais doublons ;
 *  2. surtout, huit `hreflang` de l'accueil sont déclarés depuis des pages qui
 *     ne sont pas l'accueil. Le regroupement de langues d'un moteur est
 *     réciproque : il exige que /es/ renvoie vers /fr/panier autant que
 *     l'inverse. Il ne le fait pas, donc le groupe est incohérent, et il est
 *     ignoré — pour l'ACCUEIL, la page la plus importante du site.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi `null` et non l'adresse de la page elle-même
 * ---------------------------------------------------------------------------
 * Un canonique correct serait défendable. Mais une page en `noindex` n'a
 * aucune raison de désigner une page de référence : elle n'entre pas dans
 * l'index, donc il n'y a rien à dédoublonner. `null` supprime la balise, ce
 * qui est la seule chose exacte à dire ici.
 *
 * `languages: {}` est explicite plutôt qu'omis : la composition de Next est
 * peu profonde — un objet `alternates` fourni remplace entièrement celui du
 * parent — mais écrire la table vide rend l'intention lisible sans avoir à se
 * rappeler cette règle.
 */
export const PAGE_PRIVEE = {
  robots: { index: false, follow: false },
  alternates: { canonical: null, languages: {} },
} as const satisfies Metadata

/**
 * Une description de page, ramenée à une longueur affichable.
 *
 * Les moteurs coupent l'extrait autour de cent soixante caractères, et une
 * coupe au milieu d'un mot se voit. On coupe donc au dernier espace, et on
 * pose une ellipse pour dire que la phrase continue.
 *
 * La limite n'est pas une promesse d'affichage : un moteur reste libre de
 * réécrire l'extrait à partir du contenu. C'est une borne de propreté, pas un
 * réglage.
 */
export function descriptionCourte(texte: string, maximum = 160): string {
  const propre = texte.replace(/\s+/g, ' ').trim()
  if (propre.length <= maximum) return propre

  const coupe = propre.slice(0, maximum - 1)
  const dernierEspace = coupe.lastIndexOf(' ')
  return `${(dernierEspace > 0 ? coupe.slice(0, dernierEspace) : coupe).trimEnd()}…`
}
