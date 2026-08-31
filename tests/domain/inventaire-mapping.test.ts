import { describe, it, expect } from 'vitest'

import {
  traduire,
  versCategorie,
  versCentimes,
  versCouleur,
  versEtat,
  CATEGORIES_DEDUITES,
  INTERVALLE_ENTRE_LOTS_MS,
  TAILLE_LOT_DEFAUT,
  MAX_TITLE,
  conseilPourRefus,
  conseilPourStatut,
  motsDeTete,
  TAILLE_UNIQUE,
  type PieceTraduite,
  lireReponse,
  lireReponseBrute,
  type LigneInventaire,
} from '@/scripts/inventaire-mapping'
import {
  syncArticleSchema,
  MAX_BATCH_SIZE,
  SYNC_RATE_LIMIT,
  SYNC_RATE_WINDOW_SECONDS,
} from '@/lib/validation/sync'
import { CATEGORIES } from '@/prisma/seed-data/catalogue'

/**
 * La traduction de l'inventaire vers le contrat.
 *
 * ---------------------------------------------------------------------------
 * Ce qui est réellement en jeu
 * ---------------------------------------------------------------------------
 * Ce code déduit une catégorie d'un libellé de texte libre. C'est une heuristique
 * — la seule pièce du chemin qui peut se tromper sans que rien n'échoue — et
 * l'erreur est CHÈRE : la catégorie décide du poids par défaut, donc du palier
 * transporteur, donc du port réellement payé sur chaque colis.
 *
 * Deux tests portent tout le reste : les slugs déduits existent vraiment dans le
 * catalogue et portent un poids ; et ce que la traduction produit est accepté
 * par `syncArticleSchema`, la même validation que la route publique.
 */

/** Une ligne d'inventaire plausible, dans la forme que rend PostgREST. */
const LIGNE: LigneInventaire = {
  id: '039ebb5e-6c77-4792-8375-926e8a1b055f',
  article: 'Chemise en lin Uniqlo bleu ciel taille M',
  marque: 'Uniqlo',
  taille: 'M',
  etat: 'Très bon état',
  couleur: 'Bleu ciel',
  description: null,
  prix_achat: '1.50',
  prix_annonce: '14.90',
  prix_vendu: null,
  en_vente: 'Oui',
}

const ligne = (patch: Partial<LigneInventaire> = {}): LigneInventaire => ({
  ...LIGNE,
  ...patch,
})

// ---------------------------------------------------------------------------
// Les slugs déduits existent, et sont utilisables
// ---------------------------------------------------------------------------

describe('les catégories déduites', () => {
  const parentes = new Set(
    CATEGORIES.map((c) => c.parentSlug).filter(
      (slug): slug is string => slug !== undefined,
    ),
  )
  const feuilles = new Map(
    CATEGORIES.filter((c) => !parentes.has(c.slug)).map((c) => [
      c.slug,
      c.defaultWeightGrams,
    ]),
  )

  it('désignent toutes une FEUILLE réelle du catalogue', () => {
    // Une faute de frappe dans un slug — « pull-sweats » — ne se verrait nulle
    // part ailleurs : le script enverrait, la boutique refuserait
    // `unknown-category`, et le rapport annoncerait des centaines de refus sans
    // dire lequel des quinze libellés est faux.
    for (const slug of CATEGORIES_DEDUITES) {
      expect(feuilles.has(slug), `« ${slug} » n’est pas une feuille du catalogue`).toBe(
        true,
      )
    }
  })

  it('portent toutes un poids par défaut', () => {
    // Le script n'envoie AUCUN poids : l'inventaire n'en a pas. Une feuille sans
    // `defaultWeightGrams` ferait donc refuser `missing-weight` chaque pièce qui
    // y tombe — silencieusement, et pour toute une famille de vêtements.
    for (const slug of CATEGORIES_DEDUITES) {
      expect(feuilles.get(slug), `« ${slug} » n’a pas de poids par défaut`).toEqual(
        expect.any(Number),
      )
    }
  })
})

// ---------------------------------------------------------------------------
// La déduction elle-même
// ---------------------------------------------------------------------------

describe('déduire la catégorie du libellé', () => {
  it('reconnaît les familles courantes, avec ou sans accents ni casse', () => {
    expect(versCategorie('T-shirt Le temps des Cerises noir')).toBe('t-shirts')
    expect(versCategorie('JEAN LEVI’S 501 brut')).toBe('jeans-pantalons')
    expect(versCategorie('Pull en laine mérinos')).toBe('pulls-sweats')
    expect(versCategorie('Robe longue fleurie')).toBe('robes')
    expect(versCategorie('Doudoune sans manches')).toBe('manteaux')
    expect(versCategorie('Écharpe en cachemire')).toBe('accessoires')
  })

  it('teste les motifs composés AVANT les simples', () => {
    // L'ordre de la table est la seule chose qui empêche ces erreurs. Rangée
    // autrement, une nuisette partirait au rayon chemises — au tarif d'un colis
    // de 250 g au lieu de 120 g, à chaque envoi.
    expect(versCategorie('Chemise de nuit en coton')).toBe('lingerie-nuit')
    expect(versCategorie('Chemise à carreaux')).toBe('chemises')

    expect(versCategorie('Short de bain à fleurs')).toBe('maillots-de-bain')
    expect(versCategorie('Short uni beige')).toBe('shorts')
  })

  it('ne laisse pas une MATIÈRE l’emporter sur le vêtement', () => {
    // « jean » est un tissu autant qu'un pantalon, et il apparaît dans le
    // libellé de la moitié de la friperie. Testé trop tôt, il rangeait « Short
    // en jean » dans les pantalons : 700 g de poids par défaut au lieu de 250 g,
    // soit un palier transporteur de trop sur chaque colis d'une famille
    // entière. C'est ce test qui l'a trouvé.
    expect(versCategorie('Short en jean')).toBe('shorts')
    expect(versCategorie('Jupe en jean')).toBe('jupes')
    expect(versCategorie('Veste en jean oversize')).toBe('vestes-legeres')
    expect(versCategorie('Chemise en jean délavée')).toBe('chemises')

    // Et le vêtement lui-même reste reconnu quand rien d'autre ne le dispute.
    expect(versCategorie('Jean Levi’s 501 brut')).toBe('jeans-pantalons')
  })

  it('ne laisse pas un nom de MAISON l’emporter sur le vêtement', () => {
    // Même piège, autre cause : « polo » désigne un vêtement, mais c'est aussi
    // la moitié d'un nom de marque très présent en seconde main.
    expect(versCategorie('Chemise Polo Ralph Lauren rayée')).toBe('chemises')
    expect(versCategorie('Sweat Polo Ralph Lauren')).toBe('pulls-sweats')
    expect(versCategorie('Polo piqué bleu marine')).toBe('t-shirts')
  })

  it('reconnaît les mots relevés sur l’inventaire réel', () => {
    /**
     * Ces deux-là manquaient, et ils pesaient à eux seuls la totalité des
     * exemples remontés par le rapport de refus.
     *
     * `pantacourt` ne contient pas `pantalon` : la recherche par sous-chaîne ne
     * pouvait pas l'attraper. Il est rangé avec les pantalons — c'est un
     * pantalon coupé — et non avec les shorts, parce que le poids par défaut
     * décide du palier transporteur.
     */
    expect(versCategorie('Pantacourt turquoise avec multiples poches taille XS')).toBe(
      'jeans-pantalons',
    )
    expect(versCategorie('Pantacourt Adidas gris anthracite taille S')).toBe(
      'jeans-pantalons',
    )

    expect(versCategorie('Top gris avec dentelles et imprimés fleurs taille S')).toBe(
      't-shirts',
    )
    expect(versCategorie('Top court fuschia avec strass taille XS')).toBe('t-shirts')
  })

  it('reconnaît les mots du second relevé', () => {
    // Deuxième passe sur l'inventaire réel : le décompte des premiers mots
    // non reconnus les a nommés, du plus fréquent au moins fréquent.
    expect(versCategorie('Capri blanc avec voile transparent en bas')).toBe(
      'jeans-pantalons',
    )
    expect(versCategorie('Maillot Nike x FC Barcelone rayé taille XS')).toBe('t-shirts')
    expect(versCategorie('Body Rougegorge noir en dentelles dos nu')).toBe(
      'lingerie-nuit',
    )
    expect(versCategorie('Corset')).toBe('lingerie-nuit')
    expect(versCategorie('Portefeuille en cuir marron')).toBe('accessoires')
    expect(versCategorie('Béret')).toBe('accessoires')
    expect(versCategorie('Jort Ober noir avec détail poche arrière taille S')).toBe(
      'shorts',
    )
  })

  it('ne laisse pas une COULEUR l’emporter sur le vêtement', () => {
    /**
     * « Bleu capri » est une teinte courante, et elle peut apparaître dans le
     * libellé de n'importe quel vêtement. Rangé parmi les motifs francs,
     * « capri » aurait envoyé un haut au rayon pantalons — donc au poids par
     * défaut d'un pantalon, et au palier transporteur qui va avec.
     */
    expect(versCategorie('Top bleu capri à bretelles')).toBe('t-shirts')
    expect(versCategorie('Robe bleu capri plissée')).toBe('robes')
    expect(versCategorie('Jupe bleu capri taille S')).toBe('jupes')

    // Et seul, il désigne bien le vêtement.
    expect(versCategorie('Capri blanc taille XS')).toBe('jeans-pantalons')
  })

  it('ne confond pas un maillot de bain avec un maillot de sport', () => {
    // `maillot de bain` est un motif composé, donc testé AVANT. Sans cet ordre,
    // chaque maillot de bain partirait au rayon t-shirts.
    expect(versCategorie('Maillot de bain une pièce noir')).toBe('maillots-de-bain')
    expect(versCategorie('Maillot Nike rayé')).toBe('t-shirts')
  })

  it('ne laisse pas « top » l’emporter sur le vêtement réel', () => {
    // « top » se trouve à l'intérieur de « Topshop », une maison courante en
    // seconde main. Testé parmi les motifs francs, il aurait rangé une jupe au
    // rayon t-shirts. Testé en dernier, le vêtement gagne toujours.
    expect(versCategorie('Jupe Topshop plissée noire')).toBe('jupes')
    expect(versCategorie('Robe Topshop fleurie')).toBe('robes')
    expect(versCategorie('Veste Topshop en jean')).toBe('vestes-legeres')
  })

  it('ne devine RIEN quand le libellé ne dit pas ce que c’est', () => {
    // Le refus est le comportement voulu : une catégorie fourre-tout emporterait
    // un poids par défaut faux, et le port avec.
    expect(versCategorie('Lot de 3 pièces vintage')).toBeNull()
    expect(versCategorie('Superbe trouvaille années 90')).toBeNull()
    expect(versCategorie('')).toBeNull()
    expect(versCategorie(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// États et couleurs
// ---------------------------------------------------------------------------

describe('l’état', () => {
  it('couvre les libellés réellement présents dans l’inventaire', () => {
    // Relevés en base avant d'écrire la table, pas imaginés. Les formes courtes
    // cohabitent avec les longues.
    expect(versEtat('Neuf avec étiquette')).toBe('NEW_WITH_TAGS')
    expect(versEtat('Neuf sans étiquette')).toBe('NEW_WITHOUT_TAGS')
    expect(versEtat('Très bon état')).toBe('VERY_GOOD')
    expect(versEtat('Très bon')).toBe('VERY_GOOD')
    expect(versEtat('Bon état')).toBe('GOOD')
    expect(versEtat('Bon')).toBe('GOOD')
    expect(versEtat('État correct')).toBe('FAIR')
    expect(versEtat('Correct')).toBe('FAIR')
    expect(versEtat('Mauvais état')).toBe('POOR')
  })

  it('refuse un libellé vide ou inconnu', () => {
    expect(versEtat('')).toBeNull()
    expect(versEtat('impeccable')).toBeNull()
    expect(versEtat(null)).toBeNull()
  })
})

describe('la couleur', () => {
  it('ne retient que ce qui tombe dans la palette de la boutique', () => {
    expect(versCouleur('Noir')).toBe('noir')
    expect(versCouleur('Bleu marine ')).toBe('marine')
    expect(versCouleur('Kaki')).toBe('kaki')
  })

  it('OMET plutôt que de rapprocher de force', () => {
    // « Bleu ciel » n'est pas « marine ». Le ranger là ferait apparaître la
    // pièce dans une facette où l'acheteuse ne la cherche pas — et le champ est
    // facultatif, donc l'omission ne coûte rien.
    expect(versCouleur('Bleu ciel')).toBeNull()
    expect(versCouleur('Rose Fuchsia')).toBeNull()
    expect(versCouleur('Noir, Blanc')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Montants
// ---------------------------------------------------------------------------

describe('les montants', () => {
  it('convertit les chaînes décimales de PostgREST en centimes entiers', () => {
    // 14.50 × 100 vaut 1449.9999999999998 en virgule flottante. Sans arrondi, la
    // boutique refuserait le montant — elle n'accepte que des entiers.
    expect(versCentimes('14.50')).toBe(1450)
    expect(versCentimes('1.15')).toBe(115)
    expect(versCentimes('0')).toBe(0)
    expect(versCentimes(14.9)).toBe(1490)
  })

  it('distingue l’absence du zéro', () => {
    // Un prix d'achat à 0 € est une donnée (une pièce reçue) ; un prix absent
    // est une saisie inachevée. Les confondre publierait une marge fausse.
    expect(versCentimes(null)).toBeNull()
    expect(versCentimes('')).toBeNull()
    expect(versCentimes('abc')).toBeNull()
    expect(versCentimes('0')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Le statut : ce qui sort du catalogue
// ---------------------------------------------------------------------------

describe('le statut envoyé', () => {
  it('publie une pièce en vente et non vendue', () => {
    const traduite = traduire(ligne())
    expect('refus' in traduite).toBe(false)
    if ('refus' in traduite) return
    expect(traduite.statut).toBe('AVAILABLE')
  })

  it('RETIRE une pièce vendue — et n’ose jamais dire VENDUE', () => {
    // `SOLD` s'écrit à l'encaissement : il numérote une facture et alimente le
    // registre comptable. Le déclarer depuis l'inventaire inscrirait une vente
    // que personne n'a payée dans la boutique. Une vente conclue ailleurs est un
    // RETRAIT de la vente, et rien d'autre.
    const traduite = traduire(ligne({ prix_vendu: '22.00' }))
    if ('refus' in traduite) throw new Error('aurait dû être traduite')

    expect(traduite.statut).toBe('ARCHIVED')
    expect(traduite.charge.status).toBe('ARCHIVED')
  })

  it('suit `prix_vendu` et non `date_vente`', () => {
    // C'est le critère de l'application elle-même. Les deux divergent sur les
    // lignes à demi remplies : une pièce datée mais sans montant est comptée
    // INVENDUE par l'application, et doit donc rester au catalogue.
    const traduite = traduire(ligne({ prix_vendu: null }))
    if ('refus' in traduite) throw new Error('aurait dû être traduite')
    expect(traduite.statut).toBe('AVAILABLE')
  })

  it('retire aussi ce qui n’est pas marqué en vente', () => {
    for (const marque of ['Non', '', null]) {
      const traduite = traduire(ligne({ en_vente: marque }))
      if ('refus' in traduite) throw new Error('aurait dû être traduite')
      expect(traduite.statut, `en_vente = ${String(marque)}`).toBe('ARCHIVED')
    }
  })
})

// ---------------------------------------------------------------------------
// Les refus
// ---------------------------------------------------------------------------

describe('les pièces écartées avant l’envoi', () => {
  it('nomme le champ qui manque, pour que le rapport soit lisible', () => {
    expect(traduire(ligne({ article: '   ' }))).toEqual({ refus: 'sans-titre' })
    expect(traduire(ligne({ article: 'Lot vintage' }))).toEqual({
      refus: 'categorie-indeduisible',
    })
    expect(traduire(ligne({ etat: '' }))).toEqual({ refus: 'sans-etat' })
    expect(traduire(ligne({ taille: '' }))).toEqual({ refus: 'sans-taille' })
    expect(traduire(ligne({ prix_annonce: null }))).toEqual({ refus: 'sans-prix' })
    expect(traduire(ligne({ prix_annonce: '0' }))).toEqual({ refus: 'sans-prix' })
    expect(traduire(ligne({ prix_achat: null }))).toEqual({ refus: 'sans-cout' })
  })

  it('n’écarte PAS un sac au motif qu’il n’a pas de taille', () => {
    /**
     * Un sac à main n'a pas de taille : ce n'est pas une donnée manquante,
     * c'est une propriété qu'il ne peut pas avoir. Les refuser écartait des
     * dizaines de pièces parfaitement vendables.
     *
     * « TU » ne devine rien — il énonce l'absence, et c'est la mention d'usage.
     * À distinguer d'un vêtement, où fabriquer une taille annoncerait un M sur
     * une pièce dont personne ne connaît la coupe.
     */
    const sac = traduire(
      ligne({ article: 'Sac baguette vintage Morgan avec sequins', taille: '' }),
    )
    expect(sac).not.toHaveProperty('refus')
    expect((sac as PieceTraduite).categorie).toBe('sacs')
    expect((sac as PieceTraduite).charge.sizeLabel).toBe(TAILLE_UNIQUE)

    const ceinture = traduire(ligne({ article: 'Ceinture Guess crème', taille: '' }))
    expect((ceinture as PieceTraduite).charge.sizeLabel).toBe(TAILLE_UNIQUE)

    // Et une taille RÉELLEMENT saisie n'est jamais remplacée.
    const sacDimensionne = traduire(
      ligne({ article: 'Sac à main Coach marron', taille: 'M' }),
    )
    expect((sacDimensionne as PieceTraduite).charge.sizeLabel).toBe('M')
  })

  it('écarte TOUJOURS un vêtement sans taille', () => {
    // Le point du test : « TU » est borné aux objets qui n'ont pas de taille.
    // Un jean en a une — elle est seulement mal saisie — et « TU » y serait un
    // mensonge que la cliente découvrirait à la réception.
    expect(traduire(ligne({ article: 'Jean Levi’s taille 10 ans', taille: '' }))).toEqual(
      { refus: 'sans-taille' },
    )
    expect(traduire(ligne({ article: 'Robe longue fleurie', taille: '' }))).toEqual({
      refus: 'sans-taille',
    })
  })
})

// ---------------------------------------------------------------------------
// Le diagnostic des libellés non reconnus
// ---------------------------------------------------------------------------

describe('les premiers mots des libellés non reconnus', () => {
  it('les classe par fréquence, pour dire quel mot ajouter d’abord', () => {
    // Huit exemples sur trois cents refus disent qu'il manque des mots, sans
    // dire lesquels. Ce décompte transforme un tas anonyme en liste de mots à
    // ajouter, du plus rentable au moins rentable.
    const tete = motsDeTete([
      'Top gris avec dentelles',
      'Top court fuschia',
      'Top kaki avec décolleté',
      'Pantacourt turquoise',
      'Pantacourt gris anthracite',
      'Bustier noir',
    ])

    expect(tete).toEqual([
      { mot: 'top', nombre: 3 },
      { mot: 'pantacourt', nombre: 2 },
      { mot: 'bustier', nombre: 1 },
    ])
  })

  it('ignore accents, casse et ponctuation de tête', () => {
    // Sans normalisation, « Écharpe » et « echarpe » compteraient pour deux
    // mots différents, et la liste dirait deux fois moins que la réalité.
    expect(motsDeTete(['Écharpe en soie', 'echarpe rouge', '· Écharpe verte'])).toEqual([
      { mot: 'echarpe', nombre: 3 },
    ])
  })

  it('rend une liste vide quand rien n’a été refusé', () => {
    expect(motsDeTete([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Le test qui porte tous les autres
// ---------------------------------------------------------------------------

describe('ce que la traduction produit', () => {
  it('est accepté par le contrat de la boutique, tel quel', () => {
    // `syncArticleSchema` est la MÊME validation que celle de la route publique,
    // et elle est `.strict()` : une clé en trop suffit à faire refuser la pièce.
    // Ce test est donc le seul qui vérifie l'accord des deux côtés sans réseau.
    const traduite = traduire(ligne({ description: 'Coupe droite, très peu portée.' }))
    if ('refus' in traduite) throw new Error('aurait dû être traduite')

    const valide = syncArticleSchema.safeParse(traduite.charge)
    expect(valide.success, JSON.stringify(valide.error?.issues)).toBe(true)

    if (!valide.success) return
    expect(valide.data.weightGrams).toBeUndefined()
    expect(valide.data.images).toEqual([])
    expect(valide.data.brandName).toBe('Uniqlo')
    // « Bleu ciel » n'est pas dans la palette : le champ est absent, pas faux.
    expect(valide.data.color).toBeUndefined()
  })

  it('reste accepté quand marque, description et couleur manquent', () => {
    const traduite = traduire(
      ligne({ marque: '', description: null, couleur: '' }),
    )
    if ('refus' in traduite) throw new Error('aurait dû être traduite')

    const valide = syncArticleSchema.safeParse(traduite.charge)
    expect(valide.success, JSON.stringify(valide.error?.issues)).toBe(true)
  })

  it('tronque un titre trop long plutôt que de faire refuser la pièce', () => {
    const long = `Manteau ${'très '.repeat(60)}chaud`
    expect(long.length).toBeGreaterThan(MAX_TITLE)

    const traduite = traduire(ligne({ article: long }))
    if ('refus' in traduite) throw new Error('aurait dû être traduite')

    expect(traduite.tronquee).toBe(true)
    expect(syncArticleSchema.safeParse(traduite.charge).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// La réponse de la boutique
// ---------------------------------------------------------------------------

/**
 * Un refus EN BLOC doit se voir.
 *
 * La route rend la même forme dans les deux cas — `{ ok, results }` — mais un
 * refus global rend `results: []` avec un motif à côté. Le script ne testait
 * que la PRÉSENCE de `results` ; or un tableau vide est `truthy`. Le refus
 * passait donc sans bruit : aucun tableau à afficher faute de lignes, et une
 * exécution qui se terminait sur « aucune écriture n'a eu lieu ».
 *
 * C'était vrai, et ça ne disait rien. C'est arrivé au premier essai réel.
 */
describe('lire la réponse de la boutique', () => {
  it('rend les résultats quand la boutique a traité le lot', () => {
    const lecture = lireReponse(207, {
      ok: false,
      results: [
        { externalId: 'a', action: 'created' },
        { externalId: 'b', action: 'rejected', reason: 'unknown-category' },
      ],
    })

    expect('resultats' in lecture).toBe(true)
    if (!('resultats' in lecture)) return
    expect(lecture.resultats).toHaveLength(2)
  })

  it('lit combien de pièces la boutique a REPORTÉES faute de temps', () => {
    /**
     * La boutique s'arrête d'elle-même avant d'être tuée par son hébergeur, et
     * dit combien de pièces du lot elle n'a pas regardées. Sans lire ce nombre,
     * le script croirait le lot terminé et laisserait ces pièces au bord de la
     * route, sans que rien ne le signale.
     */
    const lecture = lireReponse(206, {
      ok: true,
      results: [{ externalId: 'a', action: 'created' }],
      deferred: 12,
    })

    expect('resultats' in lecture).toBe(true)
    if (!('resultats' in lecture)) return
    expect(lecture.reportees).toBe(12)
  })

  it('lit ZÉRO report face à une boutique qui ne connaît pas ce champ', () => {
    // Une boutique pas encore redéployée ne renvoie pas `deferred`. Elle a
    // traité ce qu'elle a pu ; interpréter l'absence comme un report ferait
    // renvoyer indéfiniment des pièces déjà écrites.
    const lecture = lireReponse(200, {
      ok: true,
      results: [{ externalId: 'a', action: 'created' }],
    })

    expect('resultats' in lecture).toBe(true)
    if (!('resultats' in lecture)) return
    expect(lecture.reportees).toBe(0)
  })

  it('voit un refus EN BLOC derrière un tableau vide', () => {
    // Le cas exact : clé absente ou fausse. Sans cette lecture, l'utilisateur
    // ne pouvait pas savoir que la boutique avait refusé.
    const lecture = lireReponse(401, {
      ok: false,
      reason: 'unauthorized',
      detail: 'clé invalide',
      results: [],
    })

    expect('refusGlobal' in lecture).toBe(true)
    if (!('refusGlobal' in lecture)) return
    expect(lecture.refusGlobal).toEqual({
      status: 401,
      reason: 'unauthorized',
      detail: 'clé invalide',
    })
  })

  it('traite une réponse sans liste comme un refus, pas comme un vide', () => {
    // Une erreur serveur ne rend pas toujours la forme du contrat. La confondre
    // avec « rien à faire » ferait croire à un import réussi sans effet.
    const lecture = lireReponse(500, { error: 'boom' } as never)

    expect('refusGlobal' in lecture).toBe(true)
    if (!('refusGlobal' in lecture)) return
    expect(lecture.refusGlobal.status).toBe(500)
    expect(lecture.refusGlobal.reason).toBe('reponse-illisible')
  })

  it('donne un conseil qui désigne le bon endroit', () => {
    // Le message doit envoyer chercher là où est la cause. Un 401 renvoie à la
    // clé ET au redéploiement — une variable ajoutée ne s'applique qu'au
    // déploiement suivant, et c'est le piège le plus courant.
    expect(conseilPourStatut(401)).toMatch(/SYNC_API_KEY/)
    expect(conseilPourStatut(401)).toMatch(/redéploy/i)
    expect(conseilPourStatut(429)).toMatch(/minute/)
    expect(conseilPourStatut(500)).toMatch(/démonstration/)
  })
})

/**
 * Une réponse sans corps est un dépassement de temps, pas un mystère.
 *
 * Le script appelait `reponse.json()` directement. Sur un lot de cent pièces —
 * donc cent transactions — la fonction de la boutique était tuée avant d'avoir
 * répondu, et l'import s'arrêtait sur `SyntaxError: Unexpected end of JSON
 * input` suivi d'une pile d'appels internes à Node.
 *
 * Rien là-dedans ne disait quoi faire. Or il y avait quelque chose à faire :
 * réduire la taille des lots.
 */
describe('une réponse qui n’est pas du JSON', () => {
  it('devient un refus lisible plutôt qu’une SyntaxError', () => {
    const lecture = lireReponseBrute(504, '')

    expect('refusGlobal' in lecture).toBe(true)
    if (!('refusGlobal' in lecture)) return
    expect(lecture.refusGlobal.reason).toBe('reponse-vide')
  })

  it('garde un EXTRAIT d’une page d’erreur, jamais la page entière', () => {
    // Une page d'erreur d'hébergeur fait plusieurs kilo-octets : la recopier
    // noierait le rapport et cacherait ce qu'on cherche.
    const page = `<!doctype html><html>${'x'.repeat(5000)}</html>`
    const lecture = lireReponseBrute(502, page)

    if (!('refusGlobal' in lecture)) throw new Error('aurait dû être un refus')
    expect(lecture.refusGlobal.reason).toBe('reponse-non-json')
    expect(lecture.refusGlobal.detail.length).toBeLessThanOrEqual(200)
  })

  it('laisse passer une vraie réponse JSON', () => {
    const lecture = lireReponseBrute(
      200,
      JSON.stringify({ ok: true, results: [{ externalId: 'a', action: 'created' }] }),
    )

    expect('resultats' in lecture).toBe(true)
  })

  it('conseille de réduire les lots — c’est le seul geste utile ici', () => {
    // Le conseil doit désigner l'action, pas décrire le symptôme. Un « erreur
    // serveur » générique renverrait vers les réglages, qui n'y sont pour rien.
    const conseil = conseilPourRefus({ status: 504, reason: 'reponse-vide' })
    expect(conseil).toMatch(/taille-lot/)

    // Et il ne doit pas écraser les autres causes.
    expect(conseilPourRefus({ status: 401, reason: 'unauthorized' })).toMatch(
      /SYNC_API_KEY/,
    )
  })
})

/**
 * La cadence, dérivée du débit annoncé.
 *
 * Huit cents pièces par lots de vingt-cinq demandent trente-trois appels, pour
 * un plafond de trente par minute. Envoyés à la file, les trois derniers étaient
 * refusés — APRÈS que les trente premiers lots avaient été écrits. Un import à
 * moitié fait, et un message d'erreur qui parlait de débit.
 */
describe('la cadence entre deux lots', () => {
  it('tient sous le plafond annoncé par la boutique', () => {
    // Le calcul, refait à l'endroit : combien d'appels tiendraient dans la
    // fenêtre à cette cadence ? Il en faut MOINS que le plafond.
    const appelsParFenetre =
      (SYNC_RATE_WINDOW_SECONDS * 1000) / INTERVALLE_ENTRE_LOTS_MS

    expect(appelsParFenetre).toBeLessThan(SYNC_RATE_LIMIT)
  })

  it('est DÉRIVÉE du plafond, jamais recopiée', () => {
    // Une constante écrite à la main dériverait le jour où le plafond change,
    // et le script se remettrait à se faire refuser sans que rien ne le dise.
    const sansMarge = (SYNC_RATE_WINDOW_SECONDS * 1000) / SYNC_RATE_LIMIT
    expect(INTERVALLE_ENTRE_LOTS_MS).toBeGreaterThan(sansMarge)

    // La marge reste raisonnable : au-delà, un import de huit cents pièces
    // deviendrait pénible pour rien.
    expect(INTERVALLE_ENTRE_LOTS_MS).toBeLessThan(sansMarge * 1.5)
  })
})

/**
 * Le code de statut distingue deux pannes que le corps vide confond.
 *
 * Un 502 ou un 504 dit « interrompu en cours de route » : réduire les lots aide.
 * Un 500 dit « exception » : réduire les lots ne changera rien, et le conseil
 * envoie chercher au mauvais endroit — c'est exactement ce qui s'est produit au
 * premier import, sur la garde des réglages de démonstration.
 */
describe('le conseil derrière un corps vide', () => {
  it('parle de taille de lot sur une interruption', () => {
    expect(conseilPourRefus({ status: 504, reason: 'reponse-vide' })).toMatch(
      /taille-lot/,
    )
  })

  it('n’en parle PAS sur un 500, et renvoie aux journaux', () => {
    const conseil = conseilPourRefus({ status: 500, reason: 'reponse-vide' })
    expect(conseil).not.toMatch(/taille-lot/)
    expect(conseil).toMatch(/journaux/)
  })

  it('dit qu’un lot interrompu n’est ni perdu ni dupliqué', () => {
    /**
     * Sans cette phrase, relancer ressemble à un pari sur un catalogue en
     * double : on ne relance pas, et l'import reste en plan. Or chaque pièce a
     * sa propre transaction — celles traitées sont écrites — et une pièce se
     * retrouve par son `externalId`, donc la renvoyer la met à jour.
     */
    const conseil = conseilPourRefus({ status: 504, reason: 'reponse-non-json' })
    expect(conseil).toMatch(/taille-lot/)
    expect(conseil).toMatch(/dupliqué/)
    expect(conseil).toMatch(/à jour/)
  })

  it('n’envoie JAMAIS d’office le lot maximum du contrat', () => {
    /**
     * Le défaut valait `MAX_BATCH_SIZE`. Les deux nombres répondent à des
     * questions différentes : ce que la boutique accepte de recevoir, et ce qui
     * tient dans le temps imparti à une fonction. Confondus, le premier import
     * réel s'est arrêté sur un FUNCTION_INVOCATION_TIMEOUT.
     */
    expect(TAILLE_LOT_DEFAUT).toBeLessThan(MAX_BATCH_SIZE)
    expect(TAILLE_LOT_DEFAUT).toBeGreaterThan(0)
  })

  it('nomme les réglages quand la boutique le dit elle-même', () => {
    // Le motif d'avant, qui confondait les deux causes. Il subsiste pour une
    // boutique pas encore redéployée, et son conseil doit rester prudent.
    const conseil = conseilPourRefus({
      status: 503,
      reason: 'shop-not-configured',
    })
    expect(conseil).toMatch(/Réglages/)
    // Il ne tranche PAS : il dit que le détail tranche.
    expect(conseil).toMatch(/soit/)
  })

  it('distingue le mode démonstration d’une ligne absente', () => {
    /**
     * Les deux partageaient un motif, et le conseil disait « renseignez vos
     * vraies valeurs dans Réglages » à quelqu'un qui venait de les saisir — et
     * dont l'enregistrement avait justement été refusé pour cette raison. Le
     * conseil envoyait donc refaire ce qui ne pouvait pas marcher.
     *
     * Même défaut que « réduisez la taille des lots » sur un 500 : affirmer une
     * cause qu'on ne connaît pas coûte plus cher que de n'en affirmer aucune.
     */
    const demo = conseilPourRefus({ status: 503, reason: 'shop-in-demo-mode' })
    expect(demo).toMatch(/démonstration/)

    const absent = conseilPourRefus({ status: 503, reason: 'setting-missing' })
    expect(absent).toMatch(/n’existe pas en base/)

    // Le point du test : il n'envoie PAS ressaisir des valeurs. C'est le
    // conseil qu'on donnait, à quelqu'un dont la saisie venait justement d'être
    // refusée pour cette raison. Écarter le mode démonstration à voix haute est
    // en revanche utile — c'est ce qu'on soupçonnait à tort.
    expect(absent).not.toMatch(/Renseignez vos vraies valeurs/)
    expect(absent).toMatch(/Ce n’est pas le mode démonstration/)
  })
})
