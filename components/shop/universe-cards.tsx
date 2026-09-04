import { getTranslations } from 'next-intl/server'
import type { FacetEntry } from '@/lib/db/queries/articles'
import { Reveal } from '@/components/motion/reveal'
import { PictureCard } from './picture-card'

/**
 * Les deux portes d'entrée de la vitrine : Femme, Homme.
 *
 * ---------------------------------------------------------------------------
 * Elles viennent juste sous le grand visuel, et avant l'arrivage
 * ---------------------------------------------------------------------------
 * C'est la première question que se pose quelqu'un qui arrive sur une boutique
 * de seconde main, avant même « qu'est-ce qui est nouveau » : est-ce que ce
 * magasin a quelque chose pour moi. Y répondre en deux cartes évite de faire
 * défiler un arrivage dont la moitié ne le concerne pas.
 *
 * ---------------------------------------------------------------------------
 * Le compte affiché est celui que la page D'ARRIVÉE montrera
 * ---------------------------------------------------------------------------
 * Donc « femme » PLUS « mixte », et non le seul effectif de la valeur. Une
 * carte qui annonce vingt-sept pièces et en montre vingt-huit se remarque, et
 * elle décrédibilise tous les autres nombres du site.
 *
 * Les effectifs viennent des facettes du catalogue : ce sont les mêmes que
 * ceux du panneau de filtres, ils ne peuvent donc pas diverger.
 *
 * ---------------------------------------------------------------------------
 * Une carte sans pièce n'est pas affichée
 * ---------------------------------------------------------------------------
 * Tant qu'aucune pièce n'est qualifiée « homme », la carte Homme mènerait à
 * une grille vide. La section n'apparaît qu'à partir de deux univers fournis :
 * une seule carte n'est pas un choix, et le catalogue reste accessible par la
 * barre de navigation.
 */
export async function UniverseCards({
  audiences,
  images,
}: {
  /** Les effectifs par valeur d'univers, tels que le catalogue les compte. */
  audiences: readonly FacetEntry[]
  images: { femme: string | null; homme: string | null }
}) {
  const t = await getTranslations('home')
  const tc = await getTranslations('catalogue')

  const compte = (valeur: string) =>
    audiences.find((entry) => entry.value === valeur)?.count ?? 0

  const mixte = compte('mixte')

  const univers = (['femme', 'homme'] as const).map((cle) => ({
    cle,
    total: compte(cle) + mixte,
    image: images[cle],
  }))

  if (univers.some((entree) => entree.total === 0)) return null

  return (
    <section className="mx-auto max-w-[80rem] px-4 py-10 sm:px-6 sm:py-14">
      <Reveal>
        {/*
          Le titre est là pour les lecteurs d'écran et pour la structure du
          document, pas pour l'œil : deux cartes portant « Femme » et « Homme »
          se comprennent sans qu'on les annonce. Un titre visible au-dessus
          répéterait ce que les cartes disent déjà, en poussant la vitrine d'un
          cran vers le bas.
        */}
        <h2 className="sr-only">{t('chooseUniverse')}</h2>

        <ul className="grid gap-4 sm:grid-cols-2 sm:gap-5">
          {univers.map((entree, index) => (
            <li key={entree.cle}>
              <PictureCard
                href={`/${entree.cle}`}
                title={tc(`audiences.${entree.cle}`)}
                detail={t('pieceCount', { count: entree.total })}
                image={
                  entree.image
                    ? // Dimensions de composition, pas de fichier : le cadre
                      // impose son format et la photo le remplit. Les donner
                      // réserve le ratio avant chargement.
                      { url: entree.image, width: 1200, height: 900 }
                    : null
                }
                ratio="aspect-[4/3] sm:aspect-[3/2]"
                // Sous le visuel d'arrivée, donc sous le pli : rien ici ne
                // dispute la priorité au LCP.
                priority={false}
                sizes={index === 0 ? '(min-width: 640px) 50vw, 100vw' : '(min-width: 640px) 50vw, 100vw'}
              />
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  )
}
