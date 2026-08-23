import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import type { OfferStanding } from '@/lib/domain/offers'

/**
 * Où en est une négociation.
 *
 * Une clé par état, sans regroupement. « Refusée » et « restée sans réponse »
 * appellent deux gestes différents — on peut reproposer après une carence, on
 * ne peut plus rien faire d'une offre échue sur une pièce vendue — et les
 * fondre en un « terminée » commun priverait la personne de cette différence.
 *
 * Les tons restent sobres : un état de négociation informe. Seul « payable »
 * porte une couleur d'attention, parce qu'il est le seul à venir avec une
 * échéance et un geste à faire.
 */
const tones = {
  awaiting: 'neutral',
  countered: 'stamp',
  payable: 'success',
  lapsed: 'neutral',
  rejected: 'neutral',
  expired: 'neutral',
  void: 'neutral',
  used: 'neutral',
} as const satisfies Record<OfferStanding, string>

export function OfferStandingBadge({ standing }: { standing: OfferStanding }) {
  const t = useTranslations('offers.standing')
  return <Badge tone={tones[standing]}>{t(standing)}</Badge>
}
