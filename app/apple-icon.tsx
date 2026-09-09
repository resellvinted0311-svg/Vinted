import { ImageResponse } from 'next/og'
import { SITE } from '@/lib/config/site'

/**
 * L'icône d'écran d'accueil sur iOS.
 *
 * `app/icon.svg` suffit aux navigateurs de bureau et à Android. Safari sur
 * iPhone, lui, ignore le SVG pour « Ajouter à l'écran d'accueil » : sans
 * `apple-icon`, il fabrique la tuile à partir d'une CAPTURE de la page, prise
 * au moment de l'ajout — donc généralement du haut d'une page à moitié
 * chargée. La boutique se retrouve, sur l'écran d'accueil de la personne qui a
 * pris la peine de l'y mettre, représentée par un bout de bandeau flou.
 *
 * Le format doit être matriciel, d'où la génération d'image plutôt qu'un
 * second fichier SVG. Le dessin est le même que l'icône : les mêmes couleurs,
 * le même monogramme, le même filet.
 */
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'
export const alt = SITE.name

const ENCRE = '#10233a'
const SABLE = '#cfdaea'
const PAPIER = '#ffffff'

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: ENCRE,
        color: PAPIER,
        padding: 14,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `2px solid ${SABLE}`,
          borderRadius: 18,
          fontSize: 112,
          fontWeight: 700,
          // Le glyphe est décalé d'un cheveu : l'esperluette de la plupart
          // des fontes n'est pas centrée sur sa chasse, et centrée « à la
          // règle » elle paraît poussée vers la droite.
          paddingRight: 4,
          paddingBottom: 8,
        }}
      >
        &amp;
      </div>
    </div>,
    size,
  )
}
