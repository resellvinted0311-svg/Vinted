import 'server-only'

import type { Prisma } from '@prisma/client'

import { REDACTED, redactText } from '@/lib/observability/redact'

/**
 * La piste d'audit — le SEUL chemin autorisé vers `AuditLog`.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce module vient empêcher, avant que cela n'arrive
 * ---------------------------------------------------------------------------
 * `AuditLog.before` et `AuditLog.after` sont des colonnes `Json` libres. Rien,
 * dans le schéma, n'interdit d'y écrire une ligne `User` ou `Order` entière —
 * et c'est même le geste le plus naturel du monde le jour où l'on voudra
 * tracer une modification :
 *
 *     await tx.auditLog.create({ data: { ..., before: ancien, after: nouveau } })
 *
 * Ce jour-là, la table devient une copie intégrale de données personnelles :
 * nom, adresse, téléphone, e-mail — hors registre, hors export de l'article 15,
 * hors effacement, et à conservation illimitée. `docs/rgpd.md` l'inscrivait
 * déjà comme « table à surveiller ». Surveiller ne suffit pas : personne ne
 * relit une note de vigilance au moment d'ajouter une ligne de code.
 *
 * On rend donc la faute IMPOSSIBLE plutôt que déconseillée. Le type n'accepte
 * que des scalaires et des tableaux de scalaires ; un objet imbriqué ne compile
 * pas. Ce qui reste passe par le même filtre de forme que le journal. Et un
 * test de sécurité vérifie qu'aucun appelant ne contourne ce module.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une liste fermée d'actions
 * ---------------------------------------------------------------------------
 * Une chaîne libre produit `order.unfulfillable` d'un côté et
 * `order.unfulfillable_lines` de l'autre, puis une recherche qui ne trouve
 * qu'une moitié des cas. C'est le même raisonnement que pour les noms
 * d'événements du journal : ce qui se compte doit être stable.
 */

/** Les événements qu'on sait consigner. Ajouter ici avant d'écrire ailleurs. */
export type AuditAction =
  /**
   * Une commande payée dont une pièce est partie ailleurs entre-temps.
   *
   * L'argent est encaissé, la vente ne peut pas être honorée en entier : un
   * remboursement est dû, et c'est une décision humaine.
   */
  | 'order.unfulfillable_lines'

/** Ce qu'une charge utile d'audit a le droit de contenir. */
export type AuditValue = string | number | boolean | null
export type AuditPayload = Record<string, AuditValue | readonly AuditValue[]>

export interface AuditEntry {
  action: AuditAction
  /** Le modèle concerné, tel qu'il s'appelle dans le schéma. */
  entity: string
  entityId: string
  /**
   * Qui a agi, quand c'est une personne identifiée. Nul pour un geste du
   * système — un webhook, une tâche planifiée.
   *
   * `onDelete: SetNull` sur la relation : l'effacement d'un compte le vide sans
   * emporter la ligne, ce qui est le bon comportement pour une piste d'audit.
   */
  actorId?: string | null
  before?: AuditPayload
  after?: AuditPayload
}

/** Longueur au-delà de laquelle une valeur n'apprend plus rien. */
const MAX_LENGTH = 200

/** Nombre d'entrées au-delà duquel une charge utile n'est plus une note. */
const MAX_ITEMS = 100

function cleanScalar(value: AuditValue): AuditValue {
  if (typeof value !== 'string') return value
  const cleaned = redactText(value)
  return cleaned.length > MAX_LENGTH ? `${cleaned.slice(0, MAX_LENGTH)}…` : cleaned
}

/**
 * Nettoie une charge utile.
 *
 * Le filtre par la FORME s'applique, comme au journal : ce qui ressemble à une
 * adresse e-mail, à une clé de prestataire ou à un jeton part, quel que soit le
 * nom du champ qui le porte.
 *
 * Le filtre par le NOM, lui, n'est PAS repris ici, et c'est délibéré : une
 * piste d'audit est faite pour dire quel champ a changé, et un champ nommé
 * `email` a parfaitement sa place — c'est sa VALEUR qui n'en a pas. Le filtre
 * de forme s'en charge.
 */
function cleanPayload(payload: AuditPayload | undefined): Prisma.InputJsonValue | undefined {
  if (!payload) return undefined

  const output: Record<string, AuditValue | AuditValue[]> = {}

  for (const [key, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      output[key] = value.slice(0, MAX_ITEMS).map(cleanScalar)
      continue
    }
    output[key] = cleanScalar(value as AuditValue)
  }

  return output as Prisma.InputJsonValue
}

/**
 * Consigne un événement d'audit.
 *
 * Prend un client de TRANSACTION, jamais le client global : un événement
 * d'audit décrit quelque chose qui vient d'être écrit, et il doit vivre ou
 * mourir avec cette écriture. Consigné en dehors, il survivrait à une
 * transaction annulée et décrirait un fait qui n'a pas eu lieu.
 */
export async function recordAudit(
  tx: Prisma.TransactionClient,
  entry: AuditEntry,
): Promise<void> {
  const before = cleanPayload(entry.before)
  const after = cleanPayload(entry.after)

  await tx.auditLog.create({
    data: {
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      actorId: entry.actorId ?? null,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
    },
  })
}

/** Exporté pour le test qui vérifie le filtre sans passer par la base. */
export const __auditInternals = { cleanPayload, REDACTED }
