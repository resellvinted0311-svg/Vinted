'use server'

import type { ReactNode } from 'react'
import { z } from 'zod'

import {
  ArticleCard,
  GRID_IMAGE_SIZES,
} from '@/components/shop/article-card'
import { listArticles } from '@/lib/db/queries/articles'
import { filtersToSearchParams } from '@/lib/domain/catalogue'
import { routing } from '@/lib/i18n/routing'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { parseCatalogueSearchParams } from '@/lib/validation/catalogue'

/**
 * Le lot suivant du catalogue, rendu côté serveur.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * `'use server'` ne rend pas un fichier privé : il rend PUBLIC tout ce qu'il
 * exporte. Ce module n'exporte donc qu'UNE action.
 *
 * Elle ne demande aucune session, et c'est voulu : elle rend exactement ce que
 * rend déjà la page du catalogue, pour n'importe qui. Ce qu'elle ne doit pas
 * faire, c'est en rendre PLUS — d'où `listArticles`, qui passe par les mêmes
 * sélecteurs publics que la page et ne sait pas lire un prix de revient.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi elle renvoie des FICHES et non des données
 * ---------------------------------------------------------------------------
 * `ArticleCard` est un composant serveur : il traduit, formate les prix selon
 * la langue et compose l'adresse publique de la pièce. Renvoyer des données
 * brutes obligerait à en réécrire une version cliente, et deux vignettes pour
 * le même article finiraient par diverger — l'une afficherait une remise que
 * l'autre ignore.
 *
 * ---------------------------------------------------------------------------
 * L'entrée est une CHAÎNE de requête, pas un objet de filtres
 * ---------------------------------------------------------------------------
 * C'est exactement ce que porte déjà le lien « Voir la suite », et c'est ce que
 * `parseCatalogueSearchParams` sait valider — la même fonction que la page,
 * schéma Zod compris. Accepter un objet de filtres construit par le navigateur
 * demanderait un second schéma pour la même chose, et deux schémas d'une même
 * entrée finissent toujours par ne plus dire pareil.
 *
 * Aucun chemin n'est accepté en entrée : l'action ne renvoie qu'une chaîne de
 * requête, et c'est la page — donc le serveur — qui décide devant quel chemin
 * elle se place.
 */

const entreeSchema = z.object({
  /** La chaîne de requête du lien, sans le « ? ». */
  requete: z.string().max(2048),
  locale: z.enum(routing.locales),
})

export type LotSuivant =
  | {
      ok: true
      /** Les fiches, déjà rendues, à ajouter sous les précédentes. */
      pieces: ReactNode
      /**
       * La chaîne de requête du lot d'APRÈS, ou `null` s'il n'y a plus rien.
       *
       * Une chaîne, jamais une adresse complète : le chemin vient de la page.
       */
      requeteSuivante: string | null
    }
  | { ok: false }

export async function chargerLotSuivant(entree: unknown): Promise<LotSuivant> {
  const valide = entreeSchema.safeParse(entree)
  if (!valide.success) return { ok: false }

  /**
   * Débit : le même geste qu'un chargement de page, et le même traitement.
   *
   * `sensitive: false` — cette action ne fait que lire un catalogue public.
   * Fermer le bouton « Voir la suite » pendant une panne du compteur punirait
   * des clientes pour rien ; en cas de refus, le lien reprend la main et la
   * navigation classique fonctionne.
   */
  const allowed = await checkRateLimit({
    key: `catalogue-next:${await clientFingerprint()}`,
    limit: 60,
    windowSeconds: 60,
    sensitive: false,
  })
  if (!allowed) return { ok: false }

  const brut: Record<string, string | string[]> = {}
  for (const [cle, valeur] of new URLSearchParams(valide.data.requete)) {
    const deja = brut[cle]
    if (deja === undefined) brut[cle] = valeur
    else if (Array.isArray(deja)) deja.push(valeur)
    else brut[cle] = [deja, valeur]
  }

  // Ne lève jamais : une requête douteuse retombe sur le catalogue par défaut,
  // exactement comme une URL bricolée à la main dans la barre d'adresse.
  const { filters, sort, cursor } = parseCatalogueSearchParams(brut)

  const page = await listArticles({
    filters,
    sort,
    cursor,
    locale: valide.data.locale,
  })

  return {
    ok: true,
    pieces: page.items.map((article) => (
      <ArticleCard
        key={article.id}
        article={article}
        locale={valide.data.locale}
        sizes={GRID_IMAGE_SIZES}
        // Jamais prioritaire : ces fiches arrivent après un clic, donc bien
        // après le rendu initial. Les marquer prioritaires ferait concurrence
        // aux images déjà visibles.
        priority={false}
      />
    )),
    requeteSuivante: page.nextCursor
      ? filtersToSearchParams(filters, sort, page.nextCursor).toString()
      : null,
  }
}
