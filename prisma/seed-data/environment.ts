/**
 * Sommes-nous sur un déploiement de PRODUCTION ?
 *
 * ---------------------------------------------------------------------------
 * Pourquoi cette question vit dans un fichier à elle
 * ---------------------------------------------------------------------------
 * Le seed pose deux sortes de choses, et elles n'ont pas le même droit
 * d'exister en production :
 *
 *  - la STRUCTURE — réglages, zones et tarifs d'expédition, catégories,
 *    marques, compteurs de numérotation. Sans elle la boutique ne fonctionne
 *    pas du tout : aucune zone signifie aucun pays desservi, donc une liste
 *    vide au tunnel de commande et personne qui puisse commander ;
 *  - la DÉMONSTRATION — cinquante pièces inventées et trois comptes de test.
 *    Utile pour développer, désastreux en production : un catalogue de
 *    vêtements qui n'existent pas, en vente, avec des photos qui ne sont pas
 *    les vôtres.
 *
 * La règle était déjà tenue pour les comptes (`seedUsers` refuse de les créer
 * en production) et pas pour les pièces. L'asymétrie n'avait pas de raison
 * d'être : c'est le même jeu de démonstration, et le même tort.
 *
 * Extraite ici plutôt que recopiée dans les deux fonctions : une copie finirait
 * par diverger, et la moitié qui se tromperait serait justement celle qu'on ne
 * regarde jamais — personne ne relit un seed après sa mise en service.
 *
 * ---------------------------------------------------------------------------
 * `VERCEL_ENV` d'abord, et SEULE quand elle est là
 * ---------------------------------------------------------------------------
 * C'est le point sur lequel la version précédente de ce garde se trompait, et
 * le test l'a attrapé : sur Vercel, `NODE_ENV` vaut `production` pendant le
 * build de TOUS les environnements, prévisualisation comprise. Un garde qui
 * accepte l'une OU l'autre considère donc une branche de test comme la
 * production.
 *
 * La conséquence n'était pas théorique : `seedUsers` portait déjà cette forme,
 * et c'est pourquoi aucune prévisualisation n'a jamais eu ses comptes de
 * démonstration — on ne pouvait s'y connecter à rien. Avec les pièces en plus,
 * chaque branche déployée serait arrivée vide, et l'on aurait cessé de s'en
 * servir.
 *
 * La règle juste est donc une PRÉCÉDENCE, pas un « ou » :
 *
 *  - `VERCEL_ENV` présente : elle seule décide. `production` est la production,
 *    `preview` et `development` ne le sont pas.
 *  - `VERCEL_ENV` absente — on n'est pas sur l'hébergeur : `NODE_ENV` sert de
 *    filet. Il attrape le cas qui fait le plus de dégâts, celui d'un seed lancé
 *    depuis un poste contre la base de production en croyant être sur sa base
 *    locale.
 */
export function estProduction(): boolean {
  const surVercel = process.env.VERCEL_ENV
  if (surVercel) return surVercel === 'production'

  return process.env.NODE_ENV === 'production'
}
