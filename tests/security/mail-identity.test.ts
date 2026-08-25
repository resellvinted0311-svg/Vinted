import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mailboxIdentity } from '@/lib/security/mail-identity'

/**
 * Le contournement des compteurs par adresse, par sous-adressage.
 *
 * ---------------------------------------------------------------------------
 * Ce que ces compteurs protègent, et ce qui les rendait inopérants
 * ---------------------------------------------------------------------------
 * Trois chemins du projet bornent les envois par ADRESSE, avec la même
 * justification : ne pas laisser noyer la boîte d'une personne ciblée sous des
 * messages légitimement signés par notre domaine. Le dommage n'est pas pour
 * elle seule — plaintes pour spam chez le prestataire, mise en quarantaine de
 * l'adresse d'envoi, et plus aucun e-mail transactionnel délivré à personne.
 *
 * Ils calculaient tous leur clé sur l'adresse TELLE QUE SAISIE. Or
 * `victime+1@gmail.com` et `victime+2@gmail.com` arrivent dans la MÊME boîte et
 * produisaient deux seaux distincts : le plafond de cinq envois par heure
 * devenait cinq par variante, c'est-à-dire aucun plafond.
 */

describe('sous-adressage', () => {
  it('ramène toutes les étiquettes à la même boîte', () => {
    const attendu = 'victime@exemple.fr'
    for (const variante of [
      'victime@exemple.fr',
      'victime+1@exemple.fr',
      'victime+facture@exemple.fr',
      'victime+++@exemple.fr',
      'VICTIME+Boutique@Exemple.FR',
      '  victime+x@exemple.fr  ',
    ]) {
      expect(mailboxIdentity(variante), variante).toBe(attendu)
    }
  })

  it('ne touche pas au domaine', () => {
    // Le `+` n'a de sens que dans la partie locale. Couper au premier `+`
    // rencontré, domaine compris, fabriquerait des identités qui se
    // chevauchent entre fournisseurs.
    expect(mailboxIdentity('a@sous+domaine.fr')).toBe('a@sous+domaine.fr')
  })

  it('laisse une partie locale qui COMMENCE par un plus', () => {
    // La couper donnerait une chaîne vide, donc un seau unique partagé par
    // toutes les adresses du domaine — un plafond commun à des inconnus.
    expect(mailboxIdentity('+curieux@exemple.fr')).toBe('+curieux@exemple.fr')
  })
})

describe('points de la partie locale', () => {
  it('les ignore chez Google, qui les ignore aussi', () => {
    expect(mailboxIdentity('jean.dupont@gmail.com')).toBe('jeandupont@gmail.com')
    expect(mailboxIdentity('j.e.a.n+x@googlemail.com')).toBe('jean@googlemail.com')
  })

  it('les CONSERVE partout ailleurs', () => {
    // Chez la plupart des fournisseurs, `jean.dupont@` et `jeandupont@` sont
    // deux boîtes distinctes, appartenant à deux personnes distinctes. Les
    // confondre leur ferait partager un plafond.
    expect(mailboxIdentity('jean.dupont@exemple.fr')).toBe('jean.dupont@exemple.fr')
    expect(mailboxIdentity('jean.dupont@outlook.com')).toBe('jean.dupont@outlook.com')
  })
})

describe('entrées dégénérées', () => {
  it('ne lève jamais, et ne fabrique pas d’identité vide', () => {
    // La validation appartient à Zod, en amont. Ce module ne doit pas tomber
    // sur ce qui lui arrive quand même — ni renvoyer une clé que plusieurs
    // personnes partageraient.
    for (const entree of ['', 'sans-arobase', '@exemple.fr', 'a@', '  ']) {
      expect(() => mailboxIdentity(entree), entree).not.toThrow()
      expect(mailboxIdentity(entree)).toBe(entree.trim().toLowerCase())
    }
  })

  it('coupe sur le DERNIER arobase', () => {
    // Une partie locale entre guillemets peut en contenir un. Couper sur le
    // premier découperait au mauvais endroit et rendrait un domaine faux.
    expect(mailboxIdentity('"a@b"@exemple.fr')).toBe('"a@b"@exemple.fr')
  })
})

/**
 * ---------------------------------------------------------------------------
 * Tous les compteurs « par adresse » ne sont PAS de la même nature
 * ---------------------------------------------------------------------------
 * La distinction a été soulevée par le test ci-dessous, qui les confondait au
 * départ. Elle compte :
 *
 *  - un compteur d'ENVOIS borne les messages expédiés vers une BOÎTE. Deux
 *    étiquettes de la même boîte doivent partager le seau, sinon le plafond ne
 *    borne rien. Canonicalisation obligatoire ;
 *
 *  - un compteur d'ESSAIS borne les tentatives contre un COMPTE. Or les comptes
 *    sont identifiés par l'adresse EXACTE : `victime@` et `victime+1@` peuvent
 *    être deux comptes réels, appartenant à deux personnes. Les faire partager
 *    un seau permettrait de verrouiller l'un en martelant l'autre — le remède
 *    fabriquerait l'attaque.
 *
 *    Et il n'y a rien à contourner de ce côté : marteler `victime+1@` quand on
 *    vise `victime@`, c'est marteler un autre compte, avec un autre mot de
 *    passe.
 */
const COMPTEURS_D_ENVOI = ['offer-email', 'magic-email', 'password-reset-email']
const COMPTEURS_D_ESSAI = ['signin-email']

describe('les compteurs d’ENVOI canonicalisent', () => {
  const chemins = [
    join('lib', 'shop', 'offer-actions.ts'),
    join('lib', 'auth', 'actions.ts'),
    join('lib', 'auth', 'password-reset-actions.ts'),
    join('app', 'api', 'auth', '[...nextauth]', 'route.ts'),
  ]

  const appelsPar = (): { chemin: string; appel: string; usage: string }[] => {
    const out: { chemin: string; appel: string; usage: string }[] = []
    for (const chemin of chemins) {
      const source = readFileSync(join(process.cwd(), chemin), 'utf8')
      for (const appel of source.match(/pseudonymize\(\{[\s\S]*?\}\)/g) ?? []) {
        const usage = appel.match(/purpose:\s*'rate-limit:([^']+)'/)?.[1]
        if (usage) out.push({ chemin, appel, usage })
      }
    }
    return out
  }

  it('aucun compteur d’envoi ne pseudonymise une adresse brute', () => {
    // Canonicaliser deux chemins sur trois laisse le troisième comme
    // contournement — c'est l'état dans lequel le projet se trouvait, ces
    // compteurs ayant été écrits à des moments différents.
    const fautifs = appelsPar()
      .filter(({ usage }) => COMPTEURS_D_ENVOI.includes(usage))
      .filter(({ appel }) => !appel.includes('mailboxIdentity'))
      .map(({ chemin, usage }) => `${chemin} → ${usage}`)

    expect(
      fautifs,
      'ces compteurs d’envoi ne canonicalisent pas : le sous-adressage les contourne',
    ).toEqual([])
  })

  it('les compteurs d’ESSAI, eux, gardent l’adresse exacte', () => {
    // L'inverse du test précédent, et il compte autant : canonicaliser ici
    // ferait partager un seau à deux comptes distincts, donc permettrait de
    // verrouiller l'un en martelant l'autre.
    const fautifs = appelsPar()
      .filter(({ usage }) => COMPTEURS_D_ESSAI.includes(usage))
      .filter(({ appel }) => appel.includes('mailboxIdentity'))
      .map(({ chemin, usage }) => `${chemin} → ${usage}`)

    expect(
      fautifs,
      'un compteur d’essais contre un COMPTE ne doit pas fusionner deux comptes',
    ).toEqual([])
  })

  it('les trois compteurs d’envoi existent bien', () => {
    // Sans ce garde-fou, un `purpose` renommé rendrait les deux tests
    // ci-dessus verts pour la pire des raisons : ils ne trouvent plus rien.
    const usages = new Set(appelsPar().map(({ usage }) => usage))
    for (const attendu of COMPTEURS_D_ENVOI) {
      expect(usages.has(attendu), attendu).toBe(true)
    }
  })

})
