import Image from 'next/image'
import { cn } from '@/lib/utils/cn'

export interface ArticleImageData {
  url: string
  width: number
  height: number
  alt: string | null
  blurhash: string | null
}

/**
 * Image produit.
 *
 * Les visuels réels sont servis par Cloudinary et passent par next/image
 * (AVIF/WebP, `sizes` correct). Les visuels de test sont des SVG servis en
 * local : next/image les refuse sans `dangerouslyAllowSVG`, un assouplissement
 * qu'il serait absurde d'accepter globalement pour du jeu de données. On les
 * rend donc directement, avec les mêmes dimensions explicites.
 *
 * Dans les deux cas, le ratio est réservé avant chargement : c'est ce qui
 * tient la cible CLS < 0,1.
 */
export function ArticleImage({
  image,
  sizes,
  priority = false,
  className,
}: {
  image: ArticleImageData
  sizes: string
  priority?: boolean
  className?: string
}) {
  const isRemote = image.url.startsWith('http')
  const alt = image.alt ?? ''

  if (!isRemote) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image.url}
        alt={alt}
        width={image.width}
        height={image.height}
        loading={priority ? 'eager' : 'lazy'}
        decoding={priority ? 'sync' : 'async'}
        className={cn('h-full w-full object-cover', className)}
      />
    )
  }

  return (
    <Image
      src={image.url}
      alt={alt}
      width={image.width}
      height={image.height}
      sizes={sizes}
      priority={priority}
      placeholder={image.blurhash ? 'blur' : 'empty'}
      blurDataURL={image.blurhash ?? undefined}
      className={cn('h-full w-full object-cover', className)}
    />
  )
}
