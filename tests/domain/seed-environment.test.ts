import { describe, it, expect, afterEach } from 'vitest'
import { estProduction } from '../../prisma/seed-data/environment'

/**
 * Le garde qui empêche le jeu de démonstration d'atteindre la production.
 *
 * ---------------------------------------------------------------------------
 * Ce qu'il tient fermé
 * ---------------------------------------------------------------------------
 * Le seed posait cinquante vêtements inventés — titres, descriptions, prix,
 * photos — et rien ne les distinguait d'un vrai catalogue une fois en ligne.
 * Mettre en vente des vêtements qui n'existent pas n'est pas un défaut
 * d'affichage : c'est une offre commerciale mensongère, et les premières
 * commandes seraient à rembourser.
 *
 * Et le choix était impossible à éviter : le seed était tout-ou-rien. Sans
 * lui, aucune zone d'expédition n'existe — donc aucun pays au tunnel de
 * commande, donc personne qui puisse commander. Il fallait choisir entre une
 * boutique inutilisable et une boutique peuplée de faux.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce prédicat est testé alors qu'il tient en deux lignes
 * ---------------------------------------------------------------------------
 * Parce que personne ne relit un seed après sa mise en service, et parce qu'une
 * erreur ici ne se voit pas en développement — elle ne se voit QUE sur la
 * boutique en ligne, après coup.
 *
 * Et parce que le cas « prévisualisation » est le plus facile à casser en
 * resserrant le garde de bonne foi : une branche de test DOIT recevoir son
 * catalogue, sans quoi il n'y a rien à y regarder.
 */

const SAUVEGARDE = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  NODE_ENV: process.env.NODE_ENV,
}

/**
 * `NODE_ENV` est en lecture seule dans les types de Node : on écrit à travers
 * l'objet, ce qui fonctionne à l'exécution. C'est la seule façon d'exercer le
 * cas qui compte.
 */
function poser(cle: 'VERCEL_ENV' | 'NODE_ENV', valeur: string | undefined) {
  const env = process.env as Record<string, string | undefined>
  if (valeur === undefined) delete env[cle]
  else env[cle] = valeur
}

afterEach(() => {
  poser('VERCEL_ENV', SAUVEGARDE.VERCEL_ENV)
  poser('NODE_ENV', SAUVEGARDE.NODE_ENV)
})

describe('ce qui compte comme la production', () => {
  it('reconnaît le déploiement de production de l’hébergeur', () => {
    poser('VERCEL_ENV', 'production')
    poser('NODE_ENV', 'development')

    expect(estProduction()).toBe(true)
  })

  it('reconnaît aussi une exécution à la main en production', () => {
    /*
      Le filet, et il attrape le cas qui fait le plus de dégâts : un seed lancé
      depuis un poste contre la base de production, en croyant être sur sa base
      locale. `VERCEL_ENV` est alors absente — on n'est pas sur l'hébergeur —
      et seule `NODE_ENV` dit la vérité.
    */
    poser('VERCEL_ENV', undefined)
    poser('NODE_ENV', 'production')

    expect(estProduction()).toBe(true)
  })
})

describe('ce qui n’est PAS la production', () => {
  it('laisse une prévisualisation recevoir son catalogue', () => {
    /*
      Le cas le plus facile à casser en resserrant le garde de bonne foi.

      Une branche déployée en prévisualisation doit porter les cinquante pièces
      de démonstration : c'est tout ce qu'on y regarde. Un garde qui les
      refuserait là rendrait chaque prévisualisation vide, et on cesserait de
      s'en servir — ce qui coûte plus cher que le défaut qu'on croyait fermer.
    */
    poser('VERCEL_ENV', 'preview')
    poser('NODE_ENV', 'production')

    expect(estProduction()).toBe(false)
  })

  it('laisse un poste de développement recevoir son catalogue', () => {
    poser('VERCEL_ENV', undefined)
    poser('NODE_ENV', 'development')

    expect(estProduction()).toBe(false)
  })

  it('ne considère pas une variable ABSENTE comme la production', () => {
    // Le défaut symétrique, et il serait silencieux : un seed qui ne pose rien
    // sur une base neuve laisse une boutique sans zone d'expédition, donc sans
    // aucun pays desservi — et personne ne peut commander.
    poser('VERCEL_ENV', undefined)
    poser('NODE_ENV', undefined)

    expect(estProduction()).toBe(false)
  })
})
