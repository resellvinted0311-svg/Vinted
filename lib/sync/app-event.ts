import 'server-only'

import { z } from 'zod'

/**
 * L'événement qu'un webhook de base Supabase envoie sur la table des articles.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce module existe, et pourquoi il est PUR
 * ---------------------------------------------------------------------------
 * Il ne fait que lire et valider une charge utile venue de l'extérieur. Rien
 * n'y touche la base ni le réseau, donc tout s'y teste sans monter quoi que ce
 * soit — et c'est bien la partie qu'il faut éprouver : elle décide de ce qu'on
 * accepte d'écrire dans le catalogue public sur la foi d'un appel HTTP.
 *
 * ---------------------------------------------------------------------------
 * La forme, telle que Supabase l'envoie réellement
 * ---------------------------------------------------------------------------
 * `{ type, table, schema, record, old_record }`. `record` est nul sur un
 * DELETE, `old_record` sur un INSERT. On ne suppose rien de plus.
 */

/**
 * Les colonnes qu'on accepte de lire, et rien d'autre.
 *
 * `.passthrough()` serait plus simple et serait une faute : la charge arrive
 * d'un émetteur externe, et recopier aveuglément ses clés dans la traduction
 * ferait entrer dans la boutique des champs que personne n'a examinés. On
 * énumère, comme partout ailleurs dans ce contrat.
 *
 * Les types sont LARGES à dessein — `unknown` plutôt que `string` — parce que
 * PostgREST et pg_net ne sérialisent pas les nombres de la même façon : un
 * `numeric` arrive en chaîne ici, en nombre là. C'est `traduire` qui normalise,
 * et elle sait déjà le faire ; resserrer ici ferait refuser des lignes
 * parfaitement valides pour une question de format.
 */
const ligneSchema = z.object({
  id: z.string().min(1).max(64),
  workspace_id: z.string().min(1).max(128).nullish(),
  article: z.string().nullish(),
  marque: z.string().nullish(),
  taille: z.string().nullish(),
  etat: z.string().nullish(),
  couleur: z.string().nullish(),
  description: z.string().nullish(),
  prix_achat: z.union([z.string(), z.number()]).nullish(),
  prix_annonce: z.union([z.string(), z.number()]).nullish(),
  prix_vendu: z.union([z.string(), z.number()]).nullish(),
  en_vente: z.string().nullish(),
})

export const appEventSchema = z.object({
  type: z.enum(['INSERT', 'UPDATE', 'DELETE']),
  table: z.string().min(1).max(64),
  record: ligneSchema.nullish(),
  old_record: ligneSchema.nullish(),
})

export type AppEvent = z.infer<typeof appEventSchema>
export type AppRow = z.infer<typeof ligneSchema>

/** Ce que la route doit faire de l'événement, une fois lu. */
export type AppEventDecision =
  | { action: 'sync'; ligne: AppRow }
  /**
   * La pièce a disparu de l'application : on l'ARCHIVE, on ne la supprime pas.
   *
   * Supprimer effacerait une fiche que des commandes et des factures citent
   * peut-être déjà. Archiver la retire du catalogue et laisse son histoire
   * intacte — c'est exactement ce que fait déjà un retrait de la vente.
   */
  | { action: 'archive'; ligne: AppRow }
  | { action: 'ignore'; motif: IgnoreMotif }

export type IgnoreMotif =
  /** L'événement ne concerne pas la table des articles. */
  | 'autre-table'
  /** La ligne appartient à un autre espace de travail. */
  | 'autre-espace'
  /** Ni `record` ni `old_record` : rien à traiter. */
  | 'sans-ligne'

/**
 * Que faire de cet événement ?
 *
 * ---------------------------------------------------------------------------
 * Le filtre sur l'espace de travail est la protection PRINCIPALE
 * ---------------------------------------------------------------------------
 * La base de l'application est multi-locataire. Un webhook mal configuré —
 * posé sur la table entière, ce qui est le réglage par défaut — enverrait ici
 * les lignes de tous les espaces de travail, et la boutique publierait le stock
 * d'autres personnes.
 *
 * On ne peut pas s'en remettre au réglage du webhook : il vit dans une console
 * tierce, il se modifie sans que ce dépôt le sache, et personne ne relit un
 * filtre posé une fois. La vérification est donc ICI, sur la ligne reçue, et
 * une ligne d'un autre espace est ignorée sans être écrite.
 */
export function deciderAppEvent(
  evenement: AppEvent,
  workspaceId: string,
): AppEventDecision {
  if (evenement.table !== 'articles') {
    return { action: 'ignore', motif: 'autre-table' }
  }

  // Sur un DELETE, seule l'ancienne ligne est fournie.
  const ligne = evenement.record ?? evenement.old_record
  if (!ligne) return { action: 'ignore', motif: 'sans-ligne' }

  if (ligne.workspace_id !== workspaceId) {
    return { action: 'ignore', motif: 'autre-espace' }
  }

  if (evenement.type === 'DELETE') return { action: 'archive', ligne }

  return { action: 'sync', ligne }
}
