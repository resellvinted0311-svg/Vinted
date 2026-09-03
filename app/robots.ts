import type { MetadataRoute } from 'next'
import { SITE } from '@/lib/config/site'

/**
 * `robots.txt`.
 *
 * ---------------------------------------------------------------------------
 * Ce fichier interdit TRÈS peu de choses, et c'est le point important
 * ---------------------------------------------------------------------------
 * Le réflexe est d'y interdire le panier, le tunnel, l'espace personnel et la
 * connexion. Ce serait une erreur, et une erreur classique.
 *
 * Ces pages portent déjà `robots: { index: false }` dans leurs métadonnées.
 * Or cette consigne est DANS la page : un robot doit la charger pour la lire.
 * L'interdire ici l'empêche justement de la charger — il ne verra donc jamais
 * le `noindex`, et pourra référencer l'adresse sur la seule foi d'un lien
 * entrant. C'est le cas que les outils pour webmestres signalent sous
 * « indexée malgré le blocage par robots.txt » : la page apparaît dans les
 * résultats, sans titre et sans description, et il n'y a plus de moyen simple
 * de l'en faire sortir — puisque la consigne qui l'aurait fait est devenue
 * illisible.
 *
 * Les deux consignes ne se cumulent pas : elles s'annulent. On garde donc
 * celle qui fonctionne — le `noindex` de chaque page — et on laisse les robots
 * la lire.
 *
 * ---------------------------------------------------------------------------
 * Ce qui est interdit, alors
 * ---------------------------------------------------------------------------
 * Les deux familles d'adresses qui ne sont pas des pages, ne portent donc
 * aucune métadonnée, et n'ont rien à faire dans un index :
 *
 *  - `/api/` : des gestionnaires qui répondent du JSON. Deux d'entre eux
 *    coûtent une requête en base à chaque appel, et sont bornés en débit ;
 *  - `/placeholder/` : le générateur d'images d'attente, qui produit un visuel
 *    différent par dimension demandée. Un robot qui l'explore fabrique une
 *    infinité d'adresses distinctes, toutes valides et toutes sans intérêt.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/placeholder/'],
      },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
    // Le domaine canonique, pour les moteurs qui lisent cette directive. Il
    // vient de la même source que les URL canoniques et le hreflang : une
    // troisième écriture du domaine serait une troisième occasion de diverger.
    host: SITE.url,
  }
}
