import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { locales } from '@/lib/i18n/routing'

/**
 * Les huit fichiers de messages portent EXACTEMENT les mêmes clés.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ce fichier empêche
 * ---------------------------------------------------------------------------
 * Une clé absente d'une langue ne casse rien de visible ici : next-intl rend
 * le CHEMIN de la clé à la place du texte. La page s'affiche, la mise en page
 * tient, et l'on peut lire « legal.terms.warrantyBody » en toutes lettres au
 * milieu de conditions générales — mais seulement en polonais, seulement sur
 * cette section, c'est-à-dire jamais sur l'écran de celui qui a fait la
 * modification.
 *
 * Le cas est arrivé assez près : trois pages légales viennent d'être écrites
 * en français puis traduites en sept langues, soit plus de quatre cents
 * chaînes. Une seule oubliée aurait suffi.
 *
 * ---------------------------------------------------------------------------
 * Les VARIABLES aussi, et c'est la moitié la plus perfide
 * ---------------------------------------------------------------------------
 * `{reservation}` dans une phrase française et `{reservierung}` dans sa
 * traduction produisent une erreur d'exécution chez next-intl, pas un texte
 * approximatif : le rendu de la page échoue. Un traducteur qui « traduit »
 * consciencieusement le nom d'une variable casse donc la page, dans sa langue
 * seulement.
 *
 * On compare donc les deux : le jeu de clés, et le jeu de variables de chaque
 * chaîne.
 */

const RACINE = join(process.cwd(), 'messages')

type Arbre = { [cle: string]: string | Arbre }

function lire(locale: string): Arbre {
  return JSON.parse(
    readFileSync(join(RACINE, `${locale}.json`), 'utf8'),
  ) as Arbre
}

/** Toutes les clés terminales, en chemin pointé, triées. */
function chemins(arbre: Arbre, prefixe = ''): string[] {
  return Object.entries(arbre)
    .flatMap(([cle, valeur]) => {
      const chemin = prefixe === '' ? cle : `${prefixe}.${cle}`
      return typeof valeur === 'string' ? [chemin] : chemins(valeur, chemin)
    })
    .sort()
}

/**
 * Les noms de variables ICU d'une chaîne, triés et dédoublonnés.
 *
 * La lecture suit la PROFONDEUR d'accolades, et ce n'est pas du zèle : une
 * expression au pluriel contient des accolades qui ne sont pas des variables.
 * Dans `{count, plural, one {la pièce} other {les pièces}}`, seul `count` en
 * est une — `la` et `les` sont du texte. Une première version relevait les
 * trois, et déclarait les sept traductions fautives alors qu'elles étaient
 * justes. Un test qui crie au loup se fait désactiver.
 */
function variables(texte: string): string[] {
  const trouvees: string[] = []
  let profondeur = 0

  for (let i = 0; i < texte.length; i += 1) {
    const caractere = texte[i]

    if (caractere === '}') {
      profondeur = Math.max(0, profondeur - 1)
      continue
    }
    if (caractere !== '{') continue

    if (profondeur === 0) {
      // Le nom d'argument va de l'accolade jusqu'à la virgule ou la fermeture.
      const reste = texte.slice(i + 1)
      const nom = /^\s*([a-zA-Z0-9_]+)\s*[,}]/.exec(reste)
      if (nom?.[1]) trouvees.push(nom[1])
    }
    profondeur += 1
  }

  return [...new Set(trouvees)].sort()
}

function valeur(arbre: Arbre, chemin: string): string | null {
  let courant: string | Arbre | undefined = arbre
  for (const segment of chemin.split('.')) {
    if (typeof courant !== 'object' || courant === null) return null
    courant = courant[segment]
  }
  return typeof courant === 'string' ? courant : null
}

const REFERENCE = 'fr'
const autres = locales.filter((locale) => locale !== REFERENCE)

describe('les messages traduits', () => {
  const source = lire(REFERENCE)
  const cheminsSource = chemins(source)

  it('le français sert de référence et n’est pas vide', () => {
    expect(cheminsSource.length).toBeGreaterThan(100)
  })

  it.each(autres)('« %s » porte les mêmes clés que le français', (locale) => {
    const cible = chemins(lire(locale))

    const manquantes = cheminsSource.filter((c) => !cible.includes(c))
    const enTrop = cible.filter((c) => !cheminsSource.includes(c))

    expect(
      manquantes,
      `${locale} : ${manquantes.length} clé(s) absente(s) — la page afficherait leur chemin`,
    ).toEqual([])
    expect(
      enTrop,
      `${locale} : ${enTrop.length} clé(s) que le français n’a pas — texte mort, ou clé mal renommée`,
    ).toEqual([])
  })

  it.each(autres)(
    '« %s » conserve les variables de chaque phrase',
    (locale) => {
      const cible = lire(locale)

      for (const chemin of cheminsSource) {
        const texteSource = valeur(source, chemin)
        const texteCible = valeur(cible, chemin)
        if (texteSource === null || texteCible === null) continue

        expect(
          variables(texteCible),
          `${locale} → ${chemin} : variables « ${variables(texteCible).join(', ')} » ` +
            `au lieu de « ${variables(texteSource).join(', ')} »`,
        ).toEqual(variables(texteSource))
      }
    },
  )
})
