/**
 * Sérialisation sûre d'un bloc JSON-LD.
 *
 * ---------------------------------------------------------------------------
 * Le piège
 * ---------------------------------------------------------------------------
 * `JSON.stringify` échappe ce qu'exige le format JSON — guillemets, barres
 * obliques inverses, caractères de contrôle. Il n'échappe RIEN de HTML. Le
 * texte de fermeture d'une balise script traverse donc intact.
 *
 * Placé dans `dangerouslySetInnerHTML` d'une balise `<script>`, il ferme la
 * balise pour l'analyseur HTML — qui ne sait pas qu'il lit du JSON — et tout ce
 * qui suit devient du script exécutable, sur le domaine de la boutique, chez
 * chaque visiteur de la page. La page étant en cache, la charge est servie à
 * tout le monde.
 *
 * Les champs concernés viennent tous de la base : titre et description
 * traduits, nom de marque, taille, libellés du fil d'Ariane. Ils paraissent
 * maison, mais ne le sont pas — les traductions automatiques prévues sont
 * produites par un modèle à partir de textes fournisseurs, et les avis clients
 * alimenteront les mêmes composants.
 *
 * ---------------------------------------------------------------------------
 * La correction
 * ---------------------------------------------------------------------------
 * On échappe en séquences Unicode. `<` reste du JSON parfaitement valide :
 * les moteurs d'indexation le relisent sans perte, alors que l'analyseur HTML
 * n'y voit plus aucune balise.
 *
 * U+2028 et U+2029 sont traités au passage : légaux en JSON, ils sont des
 * terminateurs de ligne en JavaScript et cassent l'analyse.
 *
 * Ne pas compter sur la CSP : celle du projet autorise `'unsafe-inline'` pour
 * les scripts, ce qu'exigent les blocs JSON-LD eux-mêmes. Elle n'arrêterait
 * rien ici.
 */

/**
 * Caractères à neutraliser, désignés par leur POINT DE CODE.
 *
 * Volontairement pas des littéraux : U+2028 et U+2029 sont invisibles dans un
 * éditeur, et un copier-coller les perd sans que rien ne le signale — le code
 * continuerait de compiler en ayant cessé de protéger.
 *
 * 0x3c `<` · 0x3e `>` · 0x26 `&` · 0x2028 et 0x2029 séparateurs de ligne.
 */
const ESCAPED_CODE_POINTS = [0x3c, 0x3e, 0x26, 0x2028, 0x2029] as const

const HTML_SENSITIVE = new RegExp(
  `[${ESCAPED_CODE_POINTS.map((point) => `\\u{${point.toString(16)}}`).join('')}]`,
  'gu',
)

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(HTML_SENSITIVE, (char) => {
    const point = char.codePointAt(0)
    if (point === undefined) return char
    return `\\u${point.toString(16).padStart(4, '0')}`
  })
}

/**
 * Rend une adresse d'image absolue — si elle ne l'est pas déjà.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que cette fonction remplace
 * ---------------------------------------------------------------------------
 * La fiche article composait `` `${SITE.url}${image.url}` `` sans condition.
 * Or `ArticleImage.url` porte deux formes selon l'origine de la pièce : une
 * adresse RELATIVE pour les visuels nés ici (jeu de démonstration, SVG servis
 * en local), et le `secure_url` ABSOLU de Cloudinary pour tout ce qui vient de
 * la synchronisation — c'est-à-dire la totalité de la production.
 *
 * La concaténation produisait donc, en ligne :
 *   https://boutique.frhttps://res.cloudinary.com/…
 *
 * Une adresse d'image invalide dans un bloc Product invalide le RÉSULTAT
 * ENRICHI entier : la fiche perd sa vignette dans les résultats de recherche,
 * son prix et sa disponibilité. Et le défaut était structurellement invisible
 * en test, puisque le jeu de démonstration est le seul cas où la
 * concaténation donnait le bon résultat.
 *
 * `components/shop/article-image.tsx` et `lib/shop/checkout.ts` faisaient déjà
 * cette distinction, chacun dans son coin. C'est ici qu'elle est désormais
 * écrite une fois et vérifiée.
 *
 * Le préfixe n'est PAS appliqué à une adresse déjà absolue, quel que soit son
 * hôte : `next.config.ts` verrouille les hôtes autorisés au rendu, et
 * réécrire une adresse étrangère en la faisant passer pour la nôtre serait
 * plus grave que de la publier telle quelle.
 */
export function absoluteImageUrl(url: string, siteUrl: string): string {
  return /^https?:\/\//i.test(url) ? url : `${siteUrl}${url}`
}
