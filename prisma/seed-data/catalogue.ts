import type { Locale } from '@/lib/i18n/routing'

/** Traduction d'un libellé dans les 8 langues servies. */
export type L8 = Record<Locale, string>

export interface CategorySeed {
  slug: string
  parentSlug?: string
  position: number
  /** Grille de poids par défaut du brief, en grammes. */
  defaultWeightGrams?: number
  measurementKeys?: string[]
  names: L8
  /** Nom au singulier, utilisé pour composer les titres d'articles. */
  singular?: L8
}

export const CATEGORIES: CategorySeed[] = [
  {
    slug: 'hauts',
    position: 1,
    names: {
      fr: 'Hauts', en: 'Tops', es: 'Partes de arriba', it: 'Parte superiore',
      nl: 'Bovenkleding', de: 'Oberteile', pt: 'Parte de cima', pl: 'Góra',
    },
  },
  {
    slug: 't-shirts',
    parentSlug: 'hauts',
    position: 1,
    defaultWeightGrams: 200,
    measurementKeys: ['shoulders', 'chest', 'length', 'sleeve'],
    names: {
      fr: 'T-shirts et débardeurs', en: 'T-shirts and vests', es: 'Camisetas y tirantes',
      it: 'T-shirt e canotte', nl: 'T-shirts en hemden', de: 'T-Shirts und Tops',
      pt: 'T-shirts e caveiras', pl: 'T-shirty i topy',
    },
    singular: {
      fr: 'T-shirt', en: 'T-shirt', es: 'Camiseta', it: 'T-shirt',
      nl: 'T-shirt', de: 'T-Shirt', pt: 'T-shirt', pl: 'T-shirt',
    },
  },
  {
    slug: 'chemises',
    parentSlug: 'hauts',
    position: 2,
    defaultWeightGrams: 250,
    measurementKeys: ['shoulders', 'chest', 'length', 'sleeve'],
    names: {
      fr: 'Chemises et blouses', en: 'Shirts and blouses', es: 'Camisas y blusas',
      it: 'Camicie e camicette', nl: 'Overhemden en blouses', de: 'Hemden und Blusen',
      pt: 'Camisas e blusas', pl: 'Koszule i bluzki',
    },
    singular: {
      fr: 'Chemise', en: 'Shirt', es: 'Camisa', it: 'Camicia',
      nl: 'Overhemd', de: 'Hemd', pt: 'Camisa', pl: 'Koszula',
    },
  },
  {
    slug: 'pulls-sweats',
    parentSlug: 'hauts',
    position: 3,
    defaultWeightGrams: 500,
    measurementKeys: ['shoulders', 'chest', 'length', 'sleeve'],
    names: {
      fr: 'Pulls et sweats', en: 'Jumpers and sweatshirts', es: 'Jerséis y sudaderas',
      it: 'Maglioni e felpe', nl: 'Truien en sweaters', de: 'Pullover und Sweatshirts',
      pt: 'Camisolas e sweatshirts', pl: 'Swetry i bluzy',
    },
    singular: {
      fr: 'Pull', en: 'Jumper', es: 'Jersey', it: 'Maglione',
      nl: 'Trui', de: 'Pullover', pt: 'Camisola', pl: 'Sweter',
    },
  },
  {
    slug: 'bas',
    position: 2,
    names: {
      fr: 'Bas', en: 'Bottoms', es: 'Partes de abajo', it: 'Parte inferiore',
      nl: 'Onderkleding', de: 'Unterteile', pt: 'Parte de baixo', pl: 'Dół',
    },
  },
  {
    slug: 'jeans-pantalons',
    parentSlug: 'bas',
    position: 1,
    defaultWeightGrams: 700,
    measurementKeys: ['waist', 'hips', 'inseam', 'thigh', 'legOpening', 'length'],
    names: {
      fr: 'Jeans et pantalons', en: 'Jeans and trousers', es: 'Vaqueros y pantalones',
      it: 'Jeans e pantaloni', nl: 'Jeans en broeken', de: 'Jeans und Hosen',
      pt: 'Jeans e calças', pl: 'Dżinsy i spodnie',
    },
    singular: {
      fr: 'Jean', en: 'Jeans', es: 'Vaquero', it: 'Jeans',
      nl: 'Jeans', de: 'Jeans', pt: 'Jeans', pl: 'Dżinsy',
    },
  },
  {
    slug: 'robes',
    position: 3,
    defaultWeightGrams: 400,
    measurementKeys: ['shoulders', 'chest', 'waist', 'hips', 'length'],
    names: {
      fr: 'Robes', en: 'Dresses', es: 'Vestidos', it: 'Abiti',
      nl: 'Jurken', de: 'Kleider', pt: 'Vestidos', pl: 'Sukienki',
    },
    singular: {
      fr: 'Robe', en: 'Dress', es: 'Vestido', it: 'Abito',
      nl: 'Jurk', de: 'Kleid', pt: 'Vestido', pl: 'Sukienka',
    },
  },
  {
    slug: 'vestes-manteaux',
    position: 4,
    names: {
      fr: 'Vestes et manteaux', en: 'Jackets and coats', es: 'Chaquetas y abrigos',
      it: 'Giacche e cappotti', nl: 'Jassen en mantels', de: 'Jacken und Mäntel',
      pt: 'Casacos e sobretudos', pl: 'Kurtki i płaszcze',
    },
  },
  {
    slug: 'vestes-legeres',
    parentSlug: 'vestes-manteaux',
    position: 1,
    defaultWeightGrams: 800,
    measurementKeys: ['shoulders', 'chest', 'length', 'sleeve'],
    names: {
      fr: 'Vestes légères', en: 'Light jackets', es: 'Chaquetas ligeras',
      it: 'Giacche leggere', nl: 'Lichte jassen', de: 'Leichte Jacken',
      pt: 'Casacos leves', pl: 'Lekkie kurtki',
    },
    singular: {
      fr: 'Veste', en: 'Jacket', es: 'Chaqueta', it: 'Giacca',
      nl: 'Jas', de: 'Jacke', pt: 'Casaco', pl: 'Kurtka',
    },
  },
  {
    slug: 'manteaux',
    parentSlug: 'vestes-manteaux',
    position: 2,
    defaultWeightGrams: 1500,
    measurementKeys: ['shoulders', 'chest', 'length', 'sleeve'],
    names: {
      fr: 'Manteaux et doudounes', en: 'Coats and puffers', es: 'Abrigos y plumíferos',
      it: 'Cappotti e piumini', nl: 'Mantels en donsjassen', de: 'Mäntel und Daunenjacken',
      pt: 'Sobretudos e casacos acolchoados', pl: 'Płaszcze i kurtki puchowe',
    },
    singular: {
      fr: 'Manteau', en: 'Coat', es: 'Abrigo', it: 'Cappotto',
      nl: 'Mantel', de: 'Mantel', pt: 'Sobretudo', pl: 'Płaszcz',
    },
  },
  {
    slug: 'chaussures',
    position: 5,
    defaultWeightGrams: 900,
    measurementKeys: ['footLength'],
    names: {
      fr: 'Chaussures', en: 'Shoes', es: 'Zapatos', it: 'Scarpe',
      nl: 'Schoenen', de: 'Schuhe', pt: 'Sapatos', pl: 'Buty',
    },
    singular: {
      fr: 'Chaussures', en: 'Shoes', es: 'Zapatos', it: 'Scarpe',
      nl: 'Schoenen', de: 'Schuhe', pt: 'Sapatos', pl: 'Buty',
    },
  },
  {
    slug: 'accessoires',
    position: 6,
    defaultWeightGrams: 200,
    measurementKeys: ['length'],
    names: {
      fr: 'Accessoires', en: 'Accessories', es: 'Accesorios', it: 'Accessori',
      nl: 'Accessoires', de: 'Accessoires', pt: 'Acessórios', pl: 'Akcesoria',
    },
    singular: {
      fr: 'Ceinture', en: 'Belt', es: 'Cinturón', it: 'Cintura',
      nl: 'Riem', de: 'Gürtel', pt: 'Cinto', pl: 'Pasek',
    },
  },
  {
    slug: 'sacs',
    position: 7,
    defaultWeightGrams: 700,
    measurementKeys: ['length', 'chest'],
    names: {
      fr: 'Sacs', en: 'Bags', es: 'Bolsos', it: 'Borse',
      nl: 'Tassen', de: 'Taschen', pt: 'Malas', pl: 'Torby',
    },
    singular: {
      fr: 'Sac', en: 'Bag', es: 'Bolso', it: 'Borsa',
      nl: 'Tas', de: 'Tasche', pt: 'Mala', pl: 'Torba',
    },
  },
  // -------------------------------------------------------------------------
  // Familles ajoutées pour l'application de gestion.
  //
  // Sept familles de son stock ne trouvaient aucune feuille : jupes, shorts,
  // bermudas, maillots de bain, pyjamas, sous-vêtements et combinaisons. Les
  // ranger de force ailleurs — une jupe dans « robes », un short dans
  // « jeans et pantalons » — aurait faussé le filtrage et trompé la cliente.
  // -------------------------------------------------------------------------
  {
    slug: 'jupes',
    parentSlug: 'bas',
    position: 2,
    defaultWeightGrams: 300,
    measurementKeys: ['waist', 'hips', 'length'],
    names: {
      fr: 'Jupes', en: 'Skirts', es: 'Faldas', it: 'Gonne',
      nl: 'Rokken', de: 'Röcke', pt: 'Saias', pl: 'Spódnice',
    },
    singular: {
      fr: 'Jupe', en: 'Skirt', es: 'Falda', it: 'Gonna',
      nl: 'Rok', de: 'Rock', pt: 'Saia', pl: 'Spódnica',
    },
  },
  {
    slug: 'shorts',
    parentSlug: 'bas',
    position: 3,
    defaultWeightGrams: 250,
    measurementKeys: ['waist', 'hips', 'inseam', 'thigh', 'legOpening', 'length'],
    names: {
      fr: 'Shorts et bermudas', en: 'Shorts', es: 'Pantalones cortos',
      it: 'Shorts e bermuda', nl: "Shorts en bermuda's",
      de: 'Shorts und Bermudas', pt: 'Calções', pl: 'Szorty i bermudy',
    },
    singular: {
      fr: 'Short', en: 'Shorts', es: 'Pantalón corto', it: 'Short',
      nl: 'Short', de: 'Shorts', pt: 'Calções', pl: 'Szorty',
    },
  },
  {
    slug: 'maillots-de-bain',
    position: 9,
    defaultWeightGrams: 150,
    measurementKeys: ['chest', 'waist'],
    names: {
      fr: 'Maillots de bain', en: 'Swimwear', es: 'Bañadores',
      it: 'Costumi da bagno', nl: 'Badkleding', de: 'Bademode',
      pt: 'Fatos de banho', pl: 'Stroje kąpielowe',
    },
    singular: {
      fr: 'Maillot de bain', en: 'Swimsuit', es: 'Bañador',
      it: 'Costume da bagno', nl: 'Badpak', de: 'Badeanzug',
      pt: 'Fato de banho', pl: 'Strój kąpielowy',
    },
  },
  {
    slug: 'lingerie-nuit',
    position: 10,
    defaultWeightGrams: 120,
    measurementKeys: ['chest', 'waist'],
    names: {
      fr: 'Lingerie et nuit', en: 'Lingerie and nightwear',
      es: 'Lencería y pijamas', it: 'Intimo e pigiami',
      nl: 'Lingerie en nachtkleding', de: 'Wäsche und Nachtwäsche',
      pt: 'Lingerie e pijamas', pl: 'Bielizna i piżamy',
    },
    singular: {
      fr: 'Lingerie', en: 'Lingerie', es: 'Lencería', it: 'Intimo',
      nl: 'Lingerie', de: 'Wäsche', pt: 'Lingerie', pl: 'Bielizna',
    },
  },
  {
    slug: 'combinaisons',
    position: 11,
    defaultWeightGrams: 500,
    measurementKeys: ['shoulders', 'chest', 'waist', 'hips', 'inseam', 'legOpening', 'length'],
    names: {
      fr: 'Combinaisons', en: 'Jumpsuits', es: 'Monos', it: 'Tute',
      nl: 'Jumpsuits', de: 'Overalls', pt: 'Macacões', pl: 'Kombinezony',
    },
    singular: {
      fr: 'Combinaison', en: 'Jumpsuit', es: 'Mono', it: 'Tuta',
      nl: 'Jumpsuit', de: 'Overall', pt: 'Macacão', pl: 'Kombinezon',
    },
  },
]

export interface BrandSeed {
  slug: string
  name: string
  isLuxury?: boolean
}

export const BRANDS: BrandSeed[] = [
  { slug: 'levis', name: "Levi's" },
  { slug: 'ralph-lauren', name: 'Ralph Lauren' },
  { slug: 'adidas', name: 'Adidas' },
  { slug: 'uniqlo', name: 'Uniqlo' },
  { slug: 'burberry', name: 'Burberry', isLuxury: true },
]

/** Matières, traduites — elles composent la description factuelle. */
export const MATERIALS: Record<string, L8> = {
  coton: {
    fr: 'coton', en: 'cotton', es: 'algodón', it: 'cotone',
    nl: 'katoen', de: 'Baumwolle', pt: 'algodão', pl: 'bawełna',
  },
  laine: {
    fr: 'laine', en: 'wool', es: 'lana', it: 'lana',
    nl: 'wol', de: 'Wolle', pt: 'lã', pl: 'wełna',
  },
  lin: {
    fr: 'lin', en: 'linen', es: 'lino', it: 'lino',
    nl: 'linnen', de: 'Leinen', pt: 'linho', pl: 'len',
  },
  denim: {
    fr: 'denim', en: 'denim', es: 'denim', it: 'denim',
    nl: 'denim', de: 'Denim', pt: 'ganga', pl: 'denim',
  },
  cuir: {
    fr: 'cuir', en: 'leather', es: 'cuero', it: 'pelle',
    nl: 'leer', de: 'Leder', pt: 'couro', pl: 'skóra',
  },
  velours: {
    fr: 'velours côtelé', en: 'corduroy', es: 'pana', it: 'velluto a coste',
    nl: 'corduroy', de: 'Cord', pt: 'bombazina', pl: 'sztruks',
  },
}

/** Coupes. */
export const FITS: Record<string, L8> = {
  droite: {
    fr: 'coupe droite', en: 'straight fit', es: 'corte recto', it: 'taglio dritto',
    nl: 'rechte pasvorm', de: 'gerader Schnitt', pt: 'corte direito', pl: 'prosty krój',
  },
  ajustee: {
    fr: 'coupe ajustée', en: 'slim fit', es: 'corte ajustado', it: 'taglio aderente',
    nl: 'slanke pasvorm', de: 'schmaler Schnitt', pt: 'corte justo', pl: 'dopasowany krój',
  },
  ample: {
    fr: 'coupe ample', en: 'relaxed fit', es: 'corte holgado', it: 'taglio ampio',
    nl: 'ruime pasvorm', de: 'weiter Schnitt', pt: 'corte largo', pl: 'luźny krój',
  },
  oversize: {
    fr: 'coupe oversize', en: 'oversized fit', es: 'corte oversize', it: 'taglio oversize',
    nl: 'oversized pasvorm', de: 'Oversize-Schnitt', pt: 'corte oversize', pl: 'krój oversize',
  },
}

/** Couleurs. */
export const COLORS: Record<string, L8> = {
  ecru: {
    fr: 'écru', en: 'ecru', es: 'crudo', it: 'ecru',
    nl: 'ecru', de: 'Ecru', pt: 'cru', pl: 'ecru',
  },
  marine: {
    fr: 'bleu marine', en: 'navy', es: 'azul marino', it: 'blu navy',
    nl: 'marineblauw', de: 'Marineblau', pt: 'azul-marinho', pl: 'granatowy',
  },
  kaki: {
    fr: 'kaki', en: 'khaki', es: 'caqui', it: 'cachi',
    nl: 'kaki', de: 'Khaki', pt: 'caqui', pl: 'khaki',
  },
  noir: {
    fr: 'noir', en: 'black', es: 'negro', it: 'nero',
    nl: 'zwart', de: 'Schwarz', pt: 'preto', pl: 'czarny',
  },
  bordeaux: {
    fr: 'bordeaux', en: 'burgundy', es: 'burdeos', it: 'bordeaux',
    nl: 'bordeaux', de: 'Bordeaux', pt: 'bordô', pl: 'bordowy',
  },
  gris: {
    fr: 'gris chiné', en: 'heather grey', es: 'gris jaspeado', it: 'grigio melange',
    nl: 'gemêleerd grijs', de: 'Graumeliert', pt: 'cinzento mesclado', pl: 'szary melanż',
  },
  camel: {
    fr: 'camel', en: 'camel', es: 'camel', it: 'cammello',
    nl: 'camel', de: 'Camel', pt: 'camelo', pl: 'wielbłądzi',
  },
}

/**
 * États — description factuelle du niveau, pas seulement son nom.
 * Le brief exige d'expliquer ce que recouvre chaque niveau.
 */
export const CONDITION_TEXT: Record<string, L8> = {
  NEW_WITH_TAGS: {
    fr: 'Neuf avec étiquette, jamais porté.',
    en: 'New with tags, never worn.',
    es: 'Nuevo con etiqueta, nunca usado.',
    it: 'Nuovo con cartellino, mai indossato.',
    nl: 'Nieuw met label, nooit gedragen.',
    de: 'Neu mit Etikett, nie getragen.',
    pt: 'Novo com etiqueta, nunca usado.',
    pl: 'Nowy z metką, nigdy nienoszony.',
  },
  NEW_WITHOUT_TAGS: {
    fr: 'Neuf sans étiquette, jamais porté.',
    en: 'New without tags, never worn.',
    es: 'Nuevo sin etiqueta, nunca usado.',
    it: 'Nuovo senza cartellino, mai indossato.',
    nl: 'Nieuw zonder label, nooit gedragen.',
    de: 'Neu ohne Etikett, nie getragen.',
    pt: 'Novo sem etiqueta, nunca usado.',
    pl: 'Nowy bez metki, nigdy nienoszony.',
  },
  VERY_GOOD: {
    fr: 'Très bon état : porté quelques fois, aucune trace d’usure visible.',
    en: 'Very good condition: worn a few times, no visible signs of wear.',
    es: 'Muy buen estado: usado pocas veces, sin señales visibles de desgaste.',
    it: 'Ottime condizioni: indossato poche volte, nessun segno di usura visibile.',
    nl: 'Zeer goede staat: enkele keren gedragen, geen zichtbare slijtage.',
    de: 'Sehr guter Zustand: wenige Male getragen, keine sichtbaren Gebrauchsspuren.',
    pt: 'Muito bom estado: usado poucas vezes, sem sinais visíveis de desgaste.',
    pl: 'Bardzo dobry stan: noszony kilka razy, bez widocznych śladów użytkowania.',
  },
  GOOD: {
    fr: 'Bon état : porté régulièrement, légères traces d’usage sans défaut notable.',
    en: 'Good condition: worn regularly, light signs of use with no notable flaw.',
    es: 'Buen estado: usado con regularidad, ligeras marcas de uso sin defectos notables.',
    it: 'Buone condizioni: indossato regolarmente, lievi segni d’uso senza difetti rilevanti.',
    nl: 'Goede staat: regelmatig gedragen, lichte gebruikssporen zonder noemenswaardig gebrek.',
    de: 'Guter Zustand: regelmäßig getragen, leichte Gebrauchsspuren ohne nennenswerten Mangel.',
    pt: 'Bom estado: usado com regularidade, ligeiros sinais de uso sem defeito assinalável.',
    pl: 'Dobry stan: noszony regularnie, lekkie ślady użytkowania bez istotnych wad.',
  },
  FAIR: {
    fr: 'État correct : usure visible, décrite ci-dessous.',
    en: 'Fair condition: visible wear, described below.',
    es: 'Estado aceptable: desgaste visible, descrito a continuación.',
    it: 'Condizioni discrete: usura visibile, descritta di seguito.',
    nl: 'Redelijke staat: zichtbare slijtage, hieronder beschreven.',
    de: 'Ordentlicher Zustand: sichtbare Abnutzung, unten beschrieben.',
    pt: 'Estado razoável: desgaste visível, descrito abaixo.',
    pl: 'Stan dostateczny: widoczne zużycie, opisane poniżej.',
  },
}

/** Défauts éventuels — un article de seconde main honnête les mentionne. */
export const DEFECTS: Record<string, L8> = {
  pilling: {
    fr: 'Léger boulochage sous les bras.',
    en: 'Slight pilling under the arms.',
    es: 'Ligera formación de bolitas bajo las mangas.',
    it: 'Lieve pilling sotto le braccia.',
    nl: 'Lichte pilling onder de armen.',
    de: 'Leichtes Pilling unter den Armen.',
    pt: 'Ligeiro borboto sob os braços.',
    pl: 'Lekkie mechacenie pod pachami.',
  },
  hem: {
    fr: 'Ourlet légèrement défait à l’arrière.',
    en: 'Hem slightly undone at the back.',
    es: 'Dobladillo ligeramente descosido en la parte trasera.',
    it: 'Orlo leggermente scucito sul retro.',
    nl: 'Zoom achteraan iets losgekomen.',
    de: 'Saum hinten leicht gelöst.',
    pt: 'Bainha ligeiramente descosida atrás.',
    pl: 'Lekko rozprute obszycie z tyłu.',
  },
  fade: {
    fr: 'Couleur légèrement passée au niveau des épaules.',
    en: 'Colour slightly faded at the shoulders.',
    es: 'Color ligeramente desvaído en los hombros.',
    it: 'Colore leggermente sbiadito sulle spalle.',
    nl: 'Kleur licht vervaagd op de schouders.',
    de: 'Farbe an den Schultern leicht ausgeblichen.',
    pt: 'Cor ligeiramente desbotada nos ombros.',
    pl: 'Kolor lekko wyblakły na ramionach.',
  },
  button: {
    fr: 'Un bouton de rechange fourni, cousu à l’intérieur.',
    en: 'A spare button is supplied, stitched inside.',
    es: 'Se incluye un botón de repuesto, cosido en el interior.',
    it: 'Fornito un bottone di ricambio, cucito all’interno.',
    nl: 'Er is een reserveknoop meegeleverd, binnenin vastgenaaid.',
    de: 'Ein Ersatzknopf ist innen eingenäht.',
    pt: 'Inclui um botão sobresselente, cosido no interior.',
    pl: 'Dołączony zapasowy guzik, przyszyty wewnątrz.',
  },
}

/**
 * Gabarit de description — factuel, sans superlatif ni projection.
 *
 * Assemble : « {Matière}, {coupe}. {État} {Défaut} {Mesures} »
 * Aucune phrase du type « parfait pour vos soirées d'été » : le brief
 * l'interdit explicitement, et la même règle s'applique au prompt IA.
 */
export const DESCRIPTION_TEMPLATE: Record<Locale, (parts: {
  material: string
  fit: string
  color: string
  condition: string
  defect: string | null
}) => string> = {
  fr: (p) => `${cap(p.material)}, ${p.fit}. Coloris ${p.color}. ${p.condition}${p.defect ? ` ${p.defect}` : ''} Les mesures exactes figurent dans le tableau ci-dessous.`,
  en: (p) => `${cap(p.material)}, ${p.fit}. Colour: ${p.color}. ${p.condition}${p.defect ? ` ${p.defect}` : ''} Exact measurements are listed in the table below.`,
  es: (p) => `${cap(p.material)}, ${p.fit}. Color: ${p.color}. ${p.condition}${p.defect ? ` ${p.defect}` : ''} Las medidas exactas figuran en la tabla siguiente.`,
  it: (p) => `${cap(p.material)}, ${p.fit}. Colore: ${p.color}. ${p.condition}${p.defect ? ` ${p.defect}` : ''} Le misure esatte sono indicate nella tabella qui sotto.`,
  nl: (p) => `${cap(p.material)}, ${p.fit}. Kleur: ${p.color}. ${p.condition}${p.defect ? ` ${p.defect}` : ''} De exacte maten staan in de tabel hieronder.`,
  de: (p) => `${cap(p.material)}, ${p.fit}. Farbe: ${p.color}. ${p.condition}${p.defect ? ` ${p.defect}` : ''} Die genauen Maße stehen in der Tabelle unten.`,
  pt: (p) => `${cap(p.material)}, ${p.fit}. Cor: ${p.color}. ${p.condition}${p.defect ? ` ${p.defect}` : ''} As medidas exatas constam da tabela abaixo.`,
  pl: (p) => `${cap(p.material)}, ${p.fit}. Kolor: ${p.color}. ${p.condition}${p.defect ? ` ${p.defect}` : ''} Dokładne wymiary podano w tabeli poniżej.`,
}

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
