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
 * Ces deux cartes s'affichent TOUJOURS — c'est la correction d'un vrai défaut
 * ---------------------------------------------------------------------------
 * Une première version se retirait entièrement tant qu'un des deux côtés
 * n'avait aucune pièce. L'intention était bonne — ne pas mener à une grille
 * vide — mais l'effet a été le pire possible : en production, où aucune pièce
 * n'était encore rangée, la section demandée n'apparaissait PAS DU TOUT. Rien
 * dans les journaux, rien dans les tests, une page simplement identique à
 * l'ancienne. Une mise en page qui dépend des données ne se voit jamais
 * pendant qu'on la construit.
 *
 * Ces cartes sont la STRUCTURE du magasin, pas un compte rendu de son stock.
 * Les deux portes existent parce que la boutique habille les femmes et les
 * hommes, pas parce qu'il y a quelque chose derrière aujourd'hui.
 *
 * ---------------------------------------------------------------------------
 * L'effectif n'est écrit que s'il y en a un
 * ---------------------------------------------------------------------------
 * « 0 pièce » sous une carte est pire que rien : cela transforme une porte en
 * constat d'échec. Quand le nombre existe, il est celui que la page D'ARRIVÉE
 * montrera — donc « femme » PLUS « mixte », et non le seul effectif de la
 * valeur. Une carte qui annonce vingt-sept pièces et en montre vingt-huit se
 * remarque, et elle décrédibilise tous les autres nombres du site.
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
          {univers.map((entree) => (
            <li key={entree.cle}>
              <PictureCard
                href={`/${entree.cle}`}
                title={tc(`audiences.${entree.cle}`)}
                detail={
                  entree.total > 0
                    ? t('pieceCount', { count: entree.total })
                    : null
                }
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
                sizes="(min-width: 640px) 50vw, 100vw"
              />
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  )
}
