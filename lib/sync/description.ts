import { createTranslator } from 'next-intl'

import { loadMessages } from '@/lib/i18n/messages'
import { formatCm } from '@/lib/utils/format'
import type {
  ArticleColor,
  ArticleCondition,
  ArticleFit,
  ArticleMaterial,
  MeasurementKey,
} from '@/lib/domain/vocabulary'

/**
 * Description composée, faute d'en recevoir une.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi elle existe
 * ---------------------------------------------------------------------------
 * L'application de gestion peut envoyer une pièce sans description : rédiger
 * trois cents textes à la main avant un import est un mauvais échange, et le
 * contrat l'a acté (`docs/synchronisation.md`, §6, arbitrage 2.4).
 *
 * Sans texte, la fiche aurait un titre et rien d'autre — et le vecteur de
 * recherche plein texte n'indexerait que ce titre. Une pièce en velours
 * bordeaux serait introuvable en cherchant « velours ».
 *
 * ---------------------------------------------------------------------------
 * Ce qu'elle n'écrit JAMAIS
 * ---------------------------------------------------------------------------
 * Rien qui ne soit dans une colonne. Pas d'adjectif, pas de « pièce
 * intemporelle », pas de « coup de cœur », pas d'emoji. Chaque fragment est la
 * valeur d'un champ, précédée de son libellé traduit.
 *
 * La conséquence est voulue : ce texte a l'air d'un relevé, parce que c'en est
 * un. La fiche le DIT — `article.generatedDescription` s'affiche en dessous —
 * exactement comme elle annonce une traduction automatique. Faire passer un
 * relevé pour une rédaction serait un mensonge de plus, et il se verrait.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une composition par langue et non un texte français recopié
 * ---------------------------------------------------------------------------
 * Les fragments sont des libellés déjà traduits huit fois. Les assembler dans
 * la langue de la fiche ne coûte rien de plus qu'un `for` et donne une
 * description réellement néerlandaise — donc un vecteur de recherche
 * néerlandais utilisable.
 *
 * Le TITRE, lui, vient de l'application en français et ne se traduit pas : la
 * fiche reste marquée `isFallback` dans les sept autres langues. Ce module
 * améliore ce qui peut l'être, il ne prétend pas avoir traduit la fiche.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un point médian et non des phrases
 * ---------------------------------------------------------------------------
 * Assembler « Coton », « Coupe droite » et « Bleu marine » en une phrase
 * demande de savoir, par langue, ce qui se met en minuscule au milieu d'une
 * phrase. En allemand, les noms communs gardent leur majuscule ; les mettre en
 * bas de casse par une règle unique écrirait « baumwolle », qui est une faute.
 *
 * On juxtapose donc les libellés tels qu'ils sont écrits dans les catalogues
 * de messages. Aucune grammaire n'est inventée, et aucune n'est cassée.
 */

const SEPARATOR = ' · '

export interface ComposeDescriptionInput {
  /** Nom de la catégorie DANS LA LANGUE demandée, tiré de la base. */
  categoryName: string
  brandName: string | null
  sizeLabel: string
  condition: ArticleCondition
  color: ArticleColor | null
  material: ArticleMaterial | null
  fit: ArticleFit | null
  /** Dans l'ordre où elles doivent être lues. Vide si aucune. */
  measurements: readonly { key: MeasurementKey; valueCm: number }[]
}

/**
 * Compose le relevé, dans la langue demandée.
 *
 * Chaque ligne est omise quand elle n'a rien à dire : une fiche sans matière
 * n'affiche pas « Matière : — ». Une valeur absente ne devient jamais un tiret,
 * un « non renseigné » ou une supposition.
 */
export async function composeDescription(
  input: ComposeDescriptionInput,
  locale: string,
): Promise<string> {
  const messages = await loadMessages(locale)
  const t = createTranslator({ locale, messages })

  const lines: string[] = []

  // ---- Identité ----------------------------------------------------------
  lines.push(
    input.brandName
      ? [input.categoryName, input.brandName].join(SEPARATOR)
      : input.categoryName,
  )

  // ---- Taille ------------------------------------------------------------
  lines.push(`${t('article.size')} : ${input.sizeLabel}`)

  // ---- Matière, coupe, couleur -------------------------------------------
  const attributes = [
    input.material ? t(`catalogue.materials.${input.material}`) : null,
    input.fit ? t(`catalogue.fits.${input.fit}`) : null,
    input.color ? t(`catalogue.colors.${input.color}`) : null,
  ].filter((value): value is string => value !== null)

  if (attributes.length > 0) lines.push(attributes.join(SEPARATOR))

  // ---- État --------------------------------------------------------------
  //
  // Le libellé ET son explication. « État correct » ne veut rien dire seul ;
  // « usure visible, décrite dans la description » dit ce qu'on achète. C'est
  // la ligne qui évite les retours, donc celle qu'on n'abrège pas.
  const conditionLabel = t(`condition.${input.condition}.label`)
  const conditionHelp = t(`condition.${input.condition}.help`)
  lines.push(`${conditionLabel} — ${conditionHelp}`)

  // ---- Mesures -----------------------------------------------------------
  if (input.measurements.length > 0) {
    const parts = input.measurements.map(
      (m) => `${t(`measurement.keys.${m.key}`)} ${formatCm(m.valueCm, locale)}`,
    )
    lines.push(`${t('measurement.title')} : ${parts.join(SEPARATOR)}`)
  }

  return lines.join('\n')
}

// Le formatage des centimètres vient de `lib/utils/format.ts`, qui l'écrit
// déjà pour la fiche article. Une seconde implémentation ici aurait fini par
// diverger sur le séparateur décimal — « 54,5 cm » en français, « 54.5 cm » en
// anglais — et la même mesure se serait affichée de deux façons sur une même
// page.
