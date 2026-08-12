'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
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
 */
export function ArticleGallery({
  images,
  title,
  soldLabel,
}: {
  images: ArticleImageData[]
  title: string
  soldLabel: string | null
}) {
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
    return <div className="aspect-[3/4] w-full bg-sand" />
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <div
          ref={scroller}
          className={cn(
            'flex snap-x snap-mandatory overflow-x-auto',
            // Barre de défilement masquée : les vignettes tiennent ce rôle.
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          )}
        >
          {images.map((image, index) => (
            <button
              key={image.url}
              type="button"
              onClick={() => setZoomed((value) => !value)}
              aria-label={`${title} — ${index + 1}/${images.length}`}
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
          <span className="absolute left-3 top-3 bg-ink px-2 py-1 text-xs text-ink-inverse">
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
              aria-label={`${index + 1}`}
              aria-current={index === active}
              className={cn(
                'h-20 w-16 shrink-0 overflow-hidden border bg-sand',
                index === active ? 'border-ink' : 'border-transparent',
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
