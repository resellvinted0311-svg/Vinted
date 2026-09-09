'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils/cn'
import { ArticleImage, type ArticleImageData } from './article-image'

/**
 * Galerie produit.
 *
 * Défilement horizontal natif (`scroll-snap`) : le geste de balayage marche
 * sur mobile sans bibliothèque ni gestionnaire de gestes, et la navigation
 * clavier reste celle du navigateur. Les vignettes en dessous servent de
 * points de repère et de contrôles.
 *
 * Le zoom est un simple agrandissement au clic, pas une loupe qui suit le
 * curseur : celle-ci est difficile à utiliser au doigt et inaccessible au
 * clavier.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi les noms accessibles décrivent une ACTION et non une image
 * ---------------------------------------------------------------------------
 * Les deux rangées sont faites de `<button>`, et un bouton s'annonce par son
 * nom suivi du mot « bouton ». Les vignettes portaient `aria-label={index+1}`
 * : au lecteur d'écran, cela donnait « 3, bouton » — un chiffre nu, sans verbe
 * ni objet. On entend qu'il y a quelque chose à activer, jamais ce que ça
 * fait. La grande image portait « Titre — 1/5 », qui décrit l'IMAGE alors que
 * le clic bascule le zoom : le nom promettait autre chose que la commande.
 *
 * Les noms disent donc maintenant l'action et son objet — « Voir la photo 3
 * sur 5 », « Agrandir la photo 1 sur 5 » — et le bouton de zoom change de nom
 * selon son état, parce que c'est un interrupteur : une fois agrandi, la même
 * touche réduit.
 */
export function ArticleGallery({
  images,
  soldLabel,
}: {
  images: ArticleImageData[]
  soldLabel: string | null
}) {
  const t = useTranslations('article.gallery')
  const [active, setActive] = useState(0)
  const [zoomed, setZoomed] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  const scrollTo = useCallback((index: number) => {
    const container = scroller.current
    const child = container?.children[index]
    if (child instanceof HTMLElement) {
      container?.scrollTo({ left: child.offsetLeft, behavior: 'smooth' })
    }
  }, [])

  // L'index actif suit le défilement réel, pour que les vignettes restent
  // synchronisées quand on balaye à la main.
  useEffect(() => {
    const container = scroller.current
    if (!container) return

    let frame = 0
    const onScroll = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const index = Math.round(container.scrollLeft / container.clientWidth)
        setActive(Math.min(Math.max(index, 0), images.length - 1))
      })
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [images.length])

  if (images.length === 0) {
    return (
      <div className="wash-accent aspect-[3/4] w-full rounded-card ruled" />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <div
          ref={scroller}
          className={cn(
            'flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden',
            'rounded-card ruled',
            // Barre de défilement masquée : les vignettes tiennent ce rôle.
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          )}
        >
          {images.map((image, index) => (
            <button
              key={image.url}
              type="button"
              onClick={() => setZoomed((value) => !value)}
              aria-label={t(zoomed ? 'zoomOut' : 'zoomIn', {
                index: index + 1,
                total: images.length,
              })}
              aria-pressed={zoomed}
              className={cn(
                'relative w-full shrink-0 snap-center bg-sand',
                zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in',
              )}
            >
              <div className={cn('aspect-[3/4] w-full overflow-hidden')}>
                <ArticleImage
                  image={image}
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  priority={index === 0}
                  className={cn(
                    'transition-transform duration-200 ease-out',
                    zoomed && 'scale-150',
                  )}
                />
              </div>
            </button>
          ))}
        </div>

        {soldLabel ? (
          <span className="label-reg absolute left-3 top-3 rounded-input border-[1.5px] border-mark bg-mark px-2 py-1 text-ink-inverse">
            {soldLabel}
          </span>
        ) : null}
      </div>

      {images.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto">
          {images.map((image, index) => (
            <button
              key={`thumb-${image.url}`}
              type="button"
              onClick={() => {
                setActive(index)
                scrollTo(index)
              }}
              aria-label={t('thumbnail', {
                index: index + 1,
                total: images.length,
              })}
              aria-current={index === active}
              className={cn(
                'h-20 w-16 shrink-0 overflow-hidden rounded-input border-[1.5px] bg-sand',
                // La vignette active est cernée d'encre ; les autres gardent un
                // filet sable, pour que la rangée reste une rangée.
                index === active ? 'border-rule' : 'border-sand-strong',
              )}
            >
              <ArticleImage image={image} sizes="64px" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
