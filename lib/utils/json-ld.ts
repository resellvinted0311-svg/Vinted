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
