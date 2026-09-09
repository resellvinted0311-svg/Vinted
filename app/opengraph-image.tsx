import { ImageResponse } from 'next/og'
import { SITE } from '@/lib/config/site'

/**
 * Le visuel de partage par défaut du site.
 *
 * ---------------------------------------------------------------------------
 * Ce qui se passait sans lui
 * ---------------------------------------------------------------------------
 * Seule la fiche article déclarait une image Open Graph — la photo de la
 * pièce. Toutes les autres pages n'en déclaraient aucune : l'accueil, le
 * catalogue, les deux univers, les rayons, les marques.
 *
 * Un lien vers l'accueil collé dans une conversation, un message ou un réseau
 * s'affichait donc en carte SANS VIGNETTE — une bande de texte gris, entre
 * deux liens qui, eux, avaient leur image. C'est la forme la plus visible du
 * partage, et c'est la première page qu'on partage.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi la baseline n'est pas traduite
 * ---------------------------------------------------------------------------
 * Ce fichier est à la racine d'`app/`, hors du segment de langue : il couvre
 * donc les huit langues d'un seul visuel. Le descendre dans `[locale]` le
 * traduirait, au prix de huit images générées et d'une signature (`params`)
 * dont la forme change d'une version de Next à l'autre.
 *
 * Le compromis est tenable parce que ce qui est écrit dessus n'est pas du
 * contenu : c'est le NOM de la boutique et sa baseline, c'est-à-dire sa
 * marque. Une marque ne se traduit pas. Le titre et la description de la
 * carte, eux, restent traduits — ils viennent des métadonnées de la page.
 */
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = SITE.name

/*
  Les couleurs sont recopiées des jetons de `globals.css` (--ink, --sand,
  --ink-inverse, --mark). Cette image est composée hors du navigateur, par un
  moteur de rendu qui ne lit aucune feuille de style : une variable CSS y
  vaudrait la chaîne littérale « var(--ink) », et le fond serait noir.
*/
const ENCRE = '#10233a'
const SABLE = '#cfdaea'
const PAPIER = '#ffffff'

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        background: ENCRE,
        color: PAPIER,
        // Le filet, à l'intérieur : la même grammaire que les fiches du site.
        padding: 48,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          border: `2px solid ${SABLE}`,
          borderRadius: 16,
          gap: 24,
        }}
      >
        <div
          style={{
            fontSize: 92,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            textAlign: 'center',
            padding: '0 64px',
          }}
        >
          {SITE.name}
        </div>
        <div
          style={{
            fontSize: 34,
            color: SABLE,
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            textAlign: 'center',
            padding: '0 64px',
          }}
        >
          {SITE.tagline}
        </div>
      </div>
    </div>,
    size,
  )
}
