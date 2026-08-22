'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

/**
 * Impression de la facture.
 *
 * Un bouton, pas un lien de téléchargement : la facture est une page, mise en
 * forme pour le papier par une feuille de style d'impression. Générer un PDF
 * côté serveur ajouterait une dépendance et un fichier à stocker, pour un
 * document que le navigateur sait déjà rendre — et que la personne peut
 * enregistrer en PDF depuis la même boîte de dialogue.
 *
 * `data-print-hide` : le bouton ne s'imprime pas lui-même.
 */
export function PrintButton() {
  const t = useTranslations('invoice')

  return (
    <Button
      variant="outline"
      size="sm"
      data-print-hide
      onClick={() => window.print()}
    >
      {t('print')}
    </Button>
  )
}
