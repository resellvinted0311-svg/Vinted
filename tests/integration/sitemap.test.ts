import { describe, it, expect, afterAll } from 'vitest'
import sitemap from '@/app/sitemap'
import robots from '@/app/robots'
import { prisma } from '@/lib/db/client'
import { SITE } from '@/lib/config/site'
import { locales, localeTags, defaultLocale } from '@/lib/i18n/routing'
import { PLACEHOLDER_PAGES } from '@/lib/config/pages'

/**
 * Le plan de site, contre la vraie base.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi il ne se teste pas autrement
 * ---------------------------------------------------------------------------
 * Tout ce qui peut mal tourner dans un plan de site vient de la BASE : une
 * pièce non publiée annoncée, une pièce vendue oubliée, une catégorie mère
 * absente parce qu'aucune pièce ne lui est directement rattachée. Aucune de
 * ces erreurs n'est visible sur des données inventées.
 *
 * Et aucune ne se voit à l'œil : un plan de site est un fichier que personne
 * n'ouvre, lu par des robots qui ne se plaignent pas. Une pièce manquante n'y
 * produit aucun symptôme — seulement du trafic qui n'arrive jamais.
 */

afterAll(async () => {
  await prisma.$disconnect()
})

const cheminsDe = (entrees: { url: string }[]): string[] =>
  entrees.map((entree) => entree.url.replace(`${SITE.url}/${defaultLocale}`, ''))

describe('le plan de site', () => {
  it('annonce l’accueil, le catalogue et les marques', async () => {
    const chemins = cheminsDe(await sitemap())

    expect(chemins).toContain('')
    expect(chemins).toContain('/catalogue')
    expect(chemins).toContain('/marques')
  })

  it('donne à CHAQUE entrée ses huit langues et un x-default', async () => {
    // C'est tout l'intérêt de la forme retenue : une entrée par ressource, qui
    // DIT que ces huit adresses sont la même page. Une entrée qui perdrait ses
    // alternatives redeviendrait huit pages concurrentes aux yeux d'un moteur.
    const entrees = await sitemap()
    expect(entrees.length).toBeGreaterThan(10)

    for (const entree of entrees) {
      const langues = entree.alternates?.languages ?? {}
      const clefs = Object.keys(langues)

      expect(clefs, entree.url).toHaveLength(locales.length + 1)
      expect(clefs, entree.url).toContain('x-default')
      for (const locale of locales) {
        expect(clefs, entree.url).toContain(localeTags[locale])
      }
    }
  })

  it('n’annonce AUCUNE page laissée en attente de rédaction', async () => {
    // Annoncer à un moteur une page qui affiche « contenu non rédigé » est une
    // invitation à la référencer telle quelle — et une page indexée vide se
    // désindexe beaucoup plus lentement qu'elle ne s'indexe.
    const chemins = cheminsDe(await sitemap())

    for (const slug of PLACEHOLDER_PAGES) {
      expect(chemins, `la page « ${slug} » n’est pas rédigée`).not.toContain(
        `/pages/${slug}`,
      )
    }
    // Et il en annonce d'autres : sans cela, l'assertion ci-dessus passerait
    // sur un plan de site qui aurait perdu toutes ses pages fixes.
    expect(chemins).toContain('/pages/mentions-legales')
  })

  it('n’annonce AUCUNE page marquée « ne pas indexer »', async () => {
    /**
     * Le garde-fou qui compte.
     *
     * Un plan de site est une liste de ce qu'on VEUT voir indexé. Y faire
     * figurer une page qui porte `robots: { index: false }` envoie deux
     * consignes contraires au même robot ; selon celui qui l'emporte, on
     * obtient soit une page de panier dans les résultats de recherche, soit un
     * avertissement permanent dans les outils pour webmestres.
     *
     * La liste est écrite ici en toutes lettres plutôt que dérivée du code :
     * une dérivation partagerait le défaut de ce qu'elle dérive.
     */
    const interdits = [
      '/panier',
      '/commande',
      '/commande/confirmation',
      '/commande/suivi',
      '/compte',
      '/compte/commandes',
      '/compte/offres',
      '/compte/donnees',
      '/favoris',
      '/connexion',
      '/inscription',
      '/admin',
    ]

    const chemins = cheminsDe(await sitemap())
    for (const interdit of interdits) {
      expect(chemins, `${interdit} ne doit pas être annoncé`).not.toContain(
        interdit,
      )
    }
  })

  it('annonce exactement les fiches consultables, vendues comprises', async () => {
    /**
     * Les pièces vendues Y SONT, par la même décision qui fait répondre 200 à
     * leur fiche : renvoyer 404 détruirait le référencement acquis, souvent le
     * seul trafic qu'une pièce unique aura jamais eu.
     *
     * Les brouillons et les mises en ligne programmées n'y sont pas : leur
     * fiche répond 404 aujourd'hui, et annoncer une adresse introuvable est la
     * seule chose qu'un plan de site ne doit jamais faire.
     */
    const chemins = cheminsDe(await sitemap())
    const fiches = chemins.filter((chemin) => chemin.startsWith('/a/'))

    const [vendue, brouillon, programmee] = await Promise.all([
      prisma.article.findFirst({
        where: { status: 'SOLD' },
        select: { slug: true },
      }),
      prisma.article.findFirst({
        where: { status: 'DRAFT' },
        select: { slug: true },
      }),
      prisma.article.findFirst({
        where: { status: 'SCHEDULED' },
        select: { slug: true },
      }),
    ])

    if (vendue) expect(fiches).toContain(`/a/${vendue.slug}`)
    if (brouillon) expect(fiches).not.toContain(`/a/${brouillon.slug}`)
    if (programmee) expect(fiches).not.toContain(`/a/${programmee.slug}`)

    // Le compte, pour que le test ne tienne pas qu'à trois exemples.
    const attendu = await prisma.article.count({
      where: {
        status: { in: ['AVAILABLE', 'RESERVED', 'SOLD'] },
        publishedAt: { not: null, lte: new Date() },
      },
    })
    expect(fiches).toHaveLength(attendu)
  })

  it('annonce une catégorie MÈRE, dont aucune pièce ne dépend directement', async () => {
    /**
     * Le cas qui se serait perdu en silence.
     *
     * Les pièces sont rangées dans des feuilles. Une catégorie mère n'a donc
     * souvent aucune pièce à son nom — mais sa page n'est pas vide pour
     * autant : le filtrage par catégorie descend tout le sous-arbre.
     *
     * Un plan de site bâti sur le seul compte direct l'aurait oubliée, et avec
     * elle la page d'entrée la plus large du catalogue.
     */
    const chemins = cheminsDe(await sitemap())

    const mere = await prisma.category.findFirst({
      where: {
        parentId: null,
        children: { some: { articles: { some: { status: 'AVAILABLE' } } } },
      },
      select: { slug: true },
    })

    expect(mere, 'le jeu de données ne contient aucune catégorie mère').not.toBeNull()
    expect(chemins).toContain(`/c/${mere!.slug}`)
  })

  it('n’annonce que des marques qui ont des pièces', async () => {
    const chemins = cheminsDe(await sitemap())
    const marques = chemins
      .filter((chemin) => chemin.startsWith('/marque/'))
      .map((chemin) => chemin.replace('/marque/', ''))

    for (const slug of marques) {
      const compte = await prisma.article.count({
        where: {
          brand: { slug },
          status: { in: ['AVAILABLE', 'RESERVED'] },
          publishedAt: { not: null, lte: new Date() },
        },
      })
      expect(compte, `la marque ${slug} n’a aucune pièce en ligne`).toBeGreaterThan(0)
    }
  })
})

describe('robots.txt', () => {
  it('désigne le plan de site', () => {
    expect(robots().sitemap).toBe(`${SITE.url}/sitemap.xml`)
  })

  it('n’interdit PAS les pages qui portent un « ne pas indexer »', () => {
    /**
     * L'erreur classique, écartée ici sciemment.
     *
     * Le `noindex` est DANS la page : un robot doit la charger pour le lire.
     * L'interdire en robots.txt l'empêche de la charger, donc de voir la
     * consigne — et l'adresse peut alors être référencée sur la seule foi d'un
     * lien entrant, sans titre, sans description, et sans moyen simple de l'en
     * faire sortir.
     *
     * Les deux consignes ne se cumulent pas, elles s'annulent. On garde celle
     * qui fonctionne.
     */
    const regles = robots().rules
    const interdits = (Array.isArray(regles) ? regles : [regles]).flatMap(
      (regle) => {
        const valeur = regle.disallow
        if (!valeur) return []
        return Array.isArray(valeur) ? valeur : [valeur]
      },
    )

    for (const chemin of interdits) {
      expect(chemin).toMatch(/^\/(api|placeholder)\//)
    }
    // Et il interdit bien quelque chose : une liste vide passerait l'assertion
    // ci-dessus sans rien garantir.
    expect(interdits).toContain('/api/')
  })
})
