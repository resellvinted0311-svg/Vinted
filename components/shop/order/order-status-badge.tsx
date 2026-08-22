import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import type { OrderStatus } from '@prisma/client'

/**
 * L'état d'une commande, dit tel qu'il est en base.
 *
 * Une clé par membre de l'énumération, sans regroupement : « remboursée
 * partiellement » et « remboursée » appellent deux réactions différentes, et
 * les fondre en un « remboursée » commun ferait croire à un remboursement
 * complet qui n'a pas eu lieu.
 *
 * Les tons sont sobres. Un état de commande informe ; il ne félicite pas et
 * n'alarme pas.
 */
const tones = {
  PENDING_PAYMENT: 'neutral',
  PAID: 'success',
  PREPARING: 'neutral',
  SHIPPED: 'stamp',
  DELIVERED: 'success',
  CANCELLED: 'neutral',
  REFUNDED: 'warning',
  PARTIALLY_REFUNDED: 'warning',
} as const satisfies Record<OrderStatus, string>

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations('order.status')
  return <Badge tone={tones[status]}>{t(status)}</Badge>
}
