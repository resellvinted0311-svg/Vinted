import 'server-only'

import { prisma } from '@/lib/db/client'
import { recordAudit } from '@/lib/audit/trail'
import { routing } from '@/lib/i18n/routing'
import type { ArticleAudience } from '@/lib/domain/vocabulary'

/**
 * Ranger des pièces dans un univers, par lot.
 *
 * ---------------------------------------------------------------------------
 * Ce module REMPLIT, il ne réécrit jamais
 * ---------------------------------------------------------------------------
 * La condition `audience: null` est dans le `where`, et elle n'est pas une
 * commodité : elle est la garantie. Sans elle, deux défauts banals deviennent
 * destructeurs.
 *
 * Le premier est l'onglet resté ouvert. La liste de travail est un instantané ;
 * qualifier trente pièces dans un second onglet ne la rafraîchit pas. Un envoi
 * depuis le premier onglet reposterait les mêmes identifiants avec l'univers
 * d'AVANT, et effacerait le travail qui vient d'être fait — sans erreur, sans
 * trace visible à l'écran.
 *
 * Le second est le double-clic sur un bouton d'envoi, qui poste deux fois le
 * même lot. Avec le garde, le second passage ne touche rien et le compte rendu
 * annonce honnêtement zéro pièce modifiée.
 *
 * Conséquence assumée : on ne CORRIGE pas un univers depuis cet écran. Une
 * pièce mal rangée se reprend sur sa fiche, où le choix est explicite et
 * unitaire. Un écran de masse qui sait aussi écraser est un écran dont un
 * geste distrait vide une vitrine.
 *
 * ---------------------------------------------------------------------------
 * Ce que la synchronisation en fait : rien
 * ---------------------------------------------------------------------------
 * `audience` n'est pas dans `attributeFields` de `lib/sync/articles.ts`, donc
 * un import ne la lit ni ne l'écrit. C'est ce qui autorise à qualifier une
 * pièce importée sans que le prochain passage n'annule le travail. Ce n'est pas
 * un effet de bord heureux : c'est la raison pour laquelle le champ a été
 * placé hors du contrat de synchronisation, et un test de sécurité le vérifie.
 */

/** Au-delà, ce n'est plus un lot mais un script — et la transaction souffre. */
export const MAX_QUALIFY_BATCH = 200

export type QualifyResult =
  | { ok: true; updated: number }
  | { ok: false; reason: 'tooMany' | 'empty' }

/**
 * Pose un univers sur les pièces demandées qui n'en ont pas.
 *
 * Renvoie le nombre RÉELLEMENT écrit, jamais le nombre demandé. L'écart n'est
 * pas une anomalie — c'est le garde ci-dessus qui a fait son travail — et
 * l'écran l'affiche tel quel : annoncer « 30 pièces rangées » quand la base en
 * a modifié 12 apprendrait à ne plus croire les comptes rendus.
 */
export async function qualifyArticles(
  articleIds: readonly string[],
  audience: ArticleAudience,
  actorId: string,
): Promise<QualifyResult> {
  // Un même identifiant envoyé deux fois ne doit pas gonfler le plafond.
  const ids = [...new Set(articleIds)]

  if (ids.length === 0) return { ok: false, reason: 'empty' }
  if (ids.length > MAX_QUALIFY_BATCH) return { ok: false, reason: 'tooMany' }

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.article.updateMany({
      where: { id: { in: ids }, audience: null },
      data: { audience },
    })

    // Rien n'a bougé : pas d'entrée d'audit. Une piste qui consigne les
    // non-événements devient illisible, et c'est exactement ce qui arrive avec
    // un double-clic ou un onglet périmé — les deux cas les plus fréquents.
    if (count > 0) {
      await recordAudit(tx, {
        action: 'articles.qualified',
        entity: 'Article',
        entityId: 'batch',
        actorId,
        after: { audience, count },
      })
    }

    return { ok: true, updated: count }
  })
}

/**
 * Les chemins que la qualification rend caducs en cache.
 *
 * Une pièce qui reçoit un univers entre dans une vitrine : l'accueil doit
 * recompter ses facettes, et les deux pages d'univers changent de contenu.
 *
 * Nommés un par un, jamais `revalidatePath('/', 'layout')` — purger la mise en
 * page racine effacerait les pages prérendues du site entier, pour un geste
 * qui n'en touche que trois. C'est la même règle que dans `article-actions.ts`.
 */
export function audiencePathsToRevalidate(): string[] {
  const paths: string[] = []
  for (const locale of routing.locales) {
    paths.push(`/${locale}`, `/${locale}/femme`, `/${locale}/homme`)
  }
  return paths
}
