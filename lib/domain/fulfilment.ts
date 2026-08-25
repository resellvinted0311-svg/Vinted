import type { OrderStatus } from '@prisma/client'

/**
 * Le parcours d'une commande après le paiement — règles pures, sans base.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce module vient réparer
 * ---------------------------------------------------------------------------
 * `OrderStatus` déclare huit états depuis le premier jour. Trois n'étaient
 * jamais atteints : `PREPARING`, `SHIPPED`, `DELIVERED`. Aucun chemin de code
 * n'écrivait `shippedAt` ni `deliveredAt`.
 *
 * Conséquence pour l'acheteuse : sa commande restait « payée » indéfiniment.
 * Elle recevait le colis, et son espace commande affichait toujours le même
 * état, sans date d'expédition ni numéro de suivi. L'interface était prête —
 * la pastille d'état sait rendre les huit valeurs — c'est le mécanisme qui
 * manquait.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une machine à états et non un simple champ
 * ---------------------------------------------------------------------------
 * Un statut qu'on écrit librement finit par reculer : une commande livrée
 * repasse « en préparation » sur un double clic, une commande annulée
 * redevient expédiée. Les transitions sont donc énumérées, et tout ce qui n'y
 * figure pas est refusé — y compris revenir en arrière.
 *
 * Ce module ne fait AUCUNE écriture et ne connaît ni Prisma ni la requête :
 * il se teste sans base, ce qui est la seule façon d'exercer les seize
 * combinaisons interdites aussi sérieusement que les quatre autorisées.
 */

/** Les gestes que le vendeur peut poser sur une commande payée. */
export type FulfilmentAction = 'prepare' | 'ship' | 'deliver'

/**
 * Transitions autorisées, par geste.
 *
 * `PAID → SHIPPED` figure volontairement à côté de `PAID → PREPARING → SHIPPED` :
 * sur une boutique d'une seule personne, préparer et expédier sont souvent le
 * même geste, dans la même heure. Imposer l'étape intermédiaire ferait cliquer
 * deux fois pour décrire une seule action — et la première pastille n'aurait
 * jamais été vue par personne.
 *
 * `DELIVERED` reste un état terminal atteint à la main. Sans transporteur
 * branché, rien ne peut le constater : c'est le vendeur qui le sait, par le
 * suivi ou par un message. Le poser automatiquement après quelques jours
 * inventerait un fait.
 */
const ALLOWED: Record<FulfilmentAction, { from: readonly OrderStatus[]; to: OrderStatus }> = {
  prepare: { from: ['PAID'], to: 'PREPARING' },
  ship: { from: ['PAID', 'PREPARING'], to: 'SHIPPED' },
  deliver: { from: ['SHIPPED'], to: 'DELIVERED' },
}

export interface TransitionResult {
  ok: boolean
  /** L'état visé, quand le geste est permis. */
  to?: OrderStatus
}

/**
 * Ce geste est-il permis depuis cet état ?
 *
 * Refuse tout ce qui n'est pas énuméré : un retour en arrière, un saut
 * d'étape non prévu, un geste sur une commande annulée ou remboursée, et le
 * geste répété — expédier une commande déjà expédiée n'est pas une opération
 * neutre, elle enverrait un second e-mail d'expédition.
 */
export function planTransition(
  current: OrderStatus,
  action: FulfilmentAction,
): TransitionResult {
  const rule = ALLOWED[action]
  if (!rule.from.includes(current)) return { ok: false }
  return { ok: true, to: rule.to }
}

/** Les gestes possibles depuis un état, pour n'afficher que des boutons utiles. */
export function availableActions(current: OrderStatus): FulfilmentAction[] {
  return (Object.keys(ALLOWED) as FulfilmentAction[]).filter(
    (action) => ALLOWED[action].from.includes(current),
  )
}

/**
 * Une commande dans cet état attend-elle un geste du vendeur ?
 *
 * Sert à ordonner la file de la régie et à compter ce qui reste à faire. Une
 * commande expédiée n'attend plus rien de lui : c'est le transporteur, puis
 * l'acheteuse, qui font la suite.
 */
export function needsFulfilment(current: OrderStatus): boolean {
  return current === 'PAID' || current === 'PREPARING'
}

/**
 * Normalise un numéro de suivi saisi à la main.
 *
 * Les transporteurs l'impriment par groupes de quatre, et il est recopié tel
 * quel, espaces compris. Un suivi qui ne correspond à rien parce qu'il porte
 * deux espaces est un colis que l'acheteuse croit perdu.
 */
export function normalizeTrackingNumber(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase()
}
