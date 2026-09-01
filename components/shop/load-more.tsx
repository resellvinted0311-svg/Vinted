'use client'

import { useCallback, useState, type ReactNode } from 'react'

import { Link } from '@/lib/i18n/navigation'
import {
  chargerLotSuivant,
  type LotSuivant,
} from '@/lib/shop/catalogue-actions'

/**
 * « Voir la suite » : les pièces s'AJOUTENT sous les précédentes.
 *
 * ---------------------------------------------------------------------------
 * Ce que le lien faisait, et pourquoi ça ne convenait pas
 * ---------------------------------------------------------------------------
 * Il menait à une page 2 : la grille était remplacée, et les trente premières
 * pièces disparaissaient. Pour comparer deux articles vus à quelques rangées
 * d'écart, il fallait revenir en arrière et faire défiler à nouveau — sur un
 * catalogue de friperie, où l'on choisit précisément en comparant, c'est le
 * geste central qu'on rendait pénible.
 *
 * ---------------------------------------------------------------------------
 * Le lien RESTE un lien
 * ---------------------------------------------------------------------------
 * Ce composant intercepte le clic ; il ne remplace pas le lien. Sans
 * JavaScript — ou si l'action échoue — l'ancre fait ce qu'elle a toujours
 * fait : elle mène au lot suivant. `rel="next"` reste posé, donc un moteur de
 * recherche continue de parcourir le catalogue entier.
 *
 * C'est la raison pour laquelle un refus de l'action ne montre AUCUN message
 * d'erreur : on cesse simplement d'intercepter, et le clic suivant navigue.
 * Une panne de confort ne mérite pas un écran d'excuse, elle mérite de
 * disparaître.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce composant vit DANS la grille
 * ---------------------------------------------------------------------------
 * Les fiches ajoutées doivent être les sœurs des premières, sinon elles
 * forment une seconde grille qui recommence ses colonnes — et la jointure se
 * voit dès que la dernière rangée est incomplète. Le bouton, lui, occupe une
 * rangée entière (`col-span-full`) sous les fiches.
 */
export function LoadMore({
  basePath,
  requete,
  locale,
  libelle,
  libelleEnCours,
}: {
  /** Chemin SANS préfixe de langue. Il vient du serveur, jamais du client. */
  basePath: string
  /** Chaîne de requête du lot suivant, telle que le serveur l'a composée. */
  requete: string
  locale: string
  libelle: string
  libelleEnCours: string
}) {
  const [lots, setLots] = useState<ReactNode[]>([])
  const [suivante, setSuivante] = useState<string | null>(requete)
  const [enCours, setEnCours] = useState(false)

  /**
   * Une fois passé à `true`, on n'intercepte plus rien.
   *
   * L'action a refusé — débit, panne, requête devenue invalide. Réessayer sans
   * fin sur un clic répété ne mènerait nulle part ; laisser le lien naviguer,
   * si.
   */
  const [degrade, setDegrade] = useState(false)

  const cliquer = useCallback(
    async (evenement: React.MouseEvent<HTMLAnchorElement>) => {
      // Ouvrir dans un nouvel onglet, ou avec un clic du milieu, doit rester
      // une NAVIGATION : intercepter ces gestes-là surprendrait.
      if (
        degrade ||
        evenement.defaultPrevented ||
        evenement.button !== 0 ||
        evenement.metaKey ||
        evenement.ctrlKey ||
        evenement.shiftKey ||
        evenement.altKey ||
        suivante === null
      ) {
        return
      }

      evenement.preventDefault()
      if (enCours) return
      setEnCours(true)

      let resultat: LotSuivant
      try {
        resultat = await chargerLotSuivant({ requete: suivante, locale })
      } catch {
        setDegrade(true)
        setEnCours(false)
        return
      }

      if (!resultat.ok) {
        setDegrade(true)
        setEnCours(false)
        return
      }

      setLots((precedents) => [...precedents, resultat.pieces])
      setSuivante(resultat.requeteSuivante)
      setEnCours(false)
    },
    [degrade, enCours, locale, suivante],
  )

  return (
    <>
      {lots}

      {suivante === null ? null : (
        <div className="col-span-full mt-10 flex justify-center">
          <Link
            href={`${basePath}?${suivante}`}
            rel="next"
            onClick={(evenement) => void cliquer(evenement)}
            aria-busy={enCours}
            className="lift label-reg inline-flex min-h-[44px] items-center rounded-input border-[1.5px] border-rule bg-surface px-6 text-ink"
          >
            {enCours ? libelleEnCours : libelle}
          </Link>
        </div>
      )}
    </>
  )
}
