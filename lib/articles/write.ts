import 'server-only'

import { Prisma } from '@prisma/client'
import type { ArticleCondition } from '@prisma/client'

import { routing } from '@/lib/i18n/routing'
import { slugify } from '@/lib/sync/identifiers'
import { composeDescription } from '@/lib/sync/description'
import {
  MEASUREMENT_KEYS,
  type MeasurementKey,
  type ArticleColor,
  type ArticleMaterial,
  type ArticleFit,
} from '@/lib/domain/vocabulary'

/**
 * L'écriture d'une pièce, indépendante de qui l'écrit.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ces fonctions ont déménagé
 * ---------------------------------------------------------------------------
 * Elles vivaient, privées, dans `lib/sync/articles.ts`. Tant que l'API de
 * synchronisation était le seul chemin d'écriture, leur place y était bonne.
 *
 * Depuis qu'un écran d'administration écrit lui aussi des pièces, les recopier
 * aurait produit deux versions de la même règle — et la divergence ne se
 * verrait nulle part : une pièce importée et une pièce saisie à la main
 * n'auraient pas les mêmes traductions, ou pas le même traitement des mesures
 * absentes. On les déplace donc, plutôt que de les dupliquer, et la
 * synchronisation les importe.
 *
 * Leur signature est devenue NEUTRE : elles ne connaissent plus
 * `SyncArticleInput`, seulement le contenu d'une pièce. C'est ce qui empêche
 * qu'un besoin propre à l'un des deux chemins se glisse dans la règle commune.
 */

/** Le contenu d'une pièce, quelle que soit sa source. */
export interface ArticleContentInput {
  title: string
  /** Absente, un relevé factuel est composé dans chaque langue. */
  description?: string | undefined
  sizeLabel: string
  condition: ArticleCondition
  color?: ArticleColor | null | undefined
  material?: ArticleMaterial | null | undefined
  fit?: ArticleFit | null | undefined
  measurements?: Partial<Record<MeasurementKey, number>> | undefined
}

/** La catégorie, avec ses libellés déjà traduits. */
export interface CategoryForWrite {
  slug: string
  nameByLocale: Map<string, string>
}

/**
 * Retrouve ou crée la marque.
 *
 * La comparaison est insensible à la casse : « ralph lauren » et « Ralph
 * Lauren » sont la même maison, et deux fiches marque pour un même nom
 * couperaient le catalogue en deux.
 */
export async function resolveBrandId(
  tx: Prisma.TransactionClient,
  brandName: string | undefined,
): Promise<string | null> {
  if (!brandName) return null

  const found = await tx.brand.findFirst({
    where: { name: { equals: brandName, mode: 'insensitive' } },
    select: { id: true },
  })
  if (found) return found.id

  const slug = slugify(brandName)
  if (!slug) return null

  try {
    const created = await tx.brand.create({
      data: { slug, name: brandName },
      select: { id: true },
    })
    return created.id
  } catch (error) {
    // Deux écritures concurrentes peuvent créer la même marque : la seconde
    // rattrape la violation d'unicité et relit, plutôt que de faire échouer une
    // pièce pour une raison qui n'a rien à voir avec elle.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await tx.brand.findUnique({
        where: { slug },
        select: { id: true },
      })
      return existing?.id ?? null
    }
    throw error
  }
}

/**
 * Le nom CANONIQUE d'une marque, tel qu'il sera affiché.
 *
 * Lu avant la transaction, pour composer les descriptions avec la bonne forme.
 * Sans lui, une boutiquière qui tape « ralph lauren » obtiendrait huit relevés
 * portant « ralph lauren » sous un bloc marque affichant « Ralph Lauren » — et
 * le vecteur de recherche indexerait la forme fautive.
 */
export async function canonicalBrandName(
  reader: Prisma.TransactionClient,
  brandName: string | undefined,
): Promise<string | null> {
  if (!brandName) return null

  const found = await reader.brand.findFirst({
    where: { name: { equals: brandName, mode: 'insensitive' } },
    select: { name: true },
  })

  // Marque réellement nouvelle : la chaîne saisie EST la forme canonique.
  return found?.name ?? brandName
}

/**
 * Écrit les huit traductions.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi HUIT lignes et non une
 * ---------------------------------------------------------------------------
 * Le listing du catalogue joint `ArticleTranslation` en INNER JOIN sur la
 * locale demandée. Une pièce qui n'aurait qu'une ligne `fr` serait invisible
 * dans les sept autres catalogues — pas mal traduite : ABSENTE.
 *
 * Les sept autres portent donc le texte source, et `isFallback` le dit à la
 * fiche, qui l'affiche. Le jour où la traduction automatique sera branchée,
 * elle écrasera ces lignes et baissera le drapeau.
 *
 * ---------------------------------------------------------------------------
 * La description est composée dans CHAQUE langue — ou reprise dans les huit
 * ---------------------------------------------------------------------------
 * Sans texte rédigé, le relevé est assemblé à partir de libellés déjà traduits
 * huit fois : une cliente néerlandaise lit un titre français et un relevé
 * néerlandais, et le vecteur de recherche néerlandais contient de vrais mots
 * néerlandais.
 *
 * Avec un texte rédigé, il part dans les huit lignes, tel quel. On ne panache
 * PAS — rédigé en français, composé dans les sept autres — parce que le drapeau
 * « description composée automatiquement » vit sur l'article et non sur la
 * ligne de traduction : le panachage ferait afficher « pas encore traduite »
 * au-dessus d'un texte néerlandais réellement néerlandais, en taisant qu'une
 * machine l'a composé. Une fausse mention use la confiance dans toutes les
 * autres.
 */
export async function writeTranslations(
  tx: Prisma.TransactionClient,
  articleId: string,
  input: ArticleContentInput,
  category: CategoryForWrite,
  brandName: string | null,
): Promise<void> {
  const measurements = measurementList(input.measurements)

  for (const locale of routing.locales) {
    const description =
      input.description ??
      (await composeDescription(
        {
          categoryName:
            category.nameByLocale.get(locale) ??
            category.nameByLocale.get(routing.defaultLocale) ??
            category.slug,
          brandName,
          sizeLabel: input.sizeLabel,
          condition: input.condition,
          color: input.color ?? null,
          material: input.material ?? null,
          fit: input.fit ?? null,
          measurements,
        },
        locale,
      ))

    const isSourceLocale = locale === routing.defaultLocale

    const data = {
      title: input.title,
      description,
      // Rien n'a été traduit par machine : c'est du texte d'origine, ou un
      // relevé assemblé à partir de libellés traduits à la main. Annoncer une
      // traduction automatique serait faux.
      isMachineTranslated: false,
      isFallback: !isSourceLocale,
    }

    await tx.articleTranslation.upsert({
      where: { articleId_locale: { articleId, locale } },
      create: { articleId, locale, ...data },
      update: data,
    })
  }
}

/**
 * Les mesures reçues, dans l'ordre CANONIQUE.
 *
 * L'ordre des clés d'un objet JSON est celui de son émetteur. Sans ce
 * réordonnancement, deux pièces identiques afficheraient leurs mesures dans
 * deux ordres différents selon la façon dont l'émetteur a sérialisé — et le
 * relevé composé lirait « longueur, poitrine » sur l'une, « poitrine,
 * longueur » sur l'autre.
 */
export function measurementList(
  provided: Partial<Record<MeasurementKey, number>> | undefined,
): { key: MeasurementKey; valueCm: number }[] {
  const values = provided ?? {}

  return MEASUREMENT_KEYS.flatMap((key) => {
    const valueCm = values[key]
    return typeof valueCm === 'number' ? [{ key, valueCm }] : []
  })
}

/**
 * Remplace les mesures par celles reçues.
 *
 * Les clés absentes sont SUPPRIMÉES, elles ne sont pas laissées en place : une
 * mesure corrigée doit pouvoir être retirée, et une fiche qui garde une valeur
 * que plus personne ne reconnaît ment sur la pièce.
 *
 * Cette sémantique n'est juste que pour une écriture COMPLÈTE — un import, ou
 * un formulaire qui affiche toutes les mesures. Appelée depuis un formulaire
 * partiel, elle effacerait ce que l'écran n'a pas montré.
 */
export async function writeMeasurements(
  tx: Prisma.TransactionClient,
  articleId: string,
  provided: Partial<Record<MeasurementKey, number>> | undefined,
): Promise<void> {
  const wanted = measurementList(provided)
  const keys = wanted.map((m) => m.key)

  await tx.articleMeasurement.deleteMany({
    where: { articleId, key: { notIn: keys } },
  })

  for (const measurement of wanted) {
    await tx.articleMeasurement.upsert({
      where: { articleId_key: { articleId, key: measurement.key } },
      create: { articleId, key: measurement.key, valueCm: measurement.valueCm },
      update: { valueCm: measurement.valueCm },
    })
  }
}
