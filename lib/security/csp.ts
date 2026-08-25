/**
 * Politique de sécurité de contenu — deux niveaux, et la raison de ce partage.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi deux politiques et non une seule, stricte
 * ---------------------------------------------------------------------------
 * `unsafe-inline` sur `script-src` annule l'essentiel de la valeur d'une CSP :
 * elle n'arrête plus aucun script en ligne, y compris injecté. La façon de s'en
 * passer est le NONCE — une valeur imprévisible, tirée à chaque requête, que
 * seuls nos propres scripts portent.
 *
 * Mais un nonce ne peut pas atteindre une page PRÉRENDUE : son HTML est figé à
 * la construction, et le nonce, lui, change à chaque requête. Les deux sont
 * incompatibles par construction.
 *
 * Mesuré sur ce projet plutôt que supposé :
 *
 *   /fr        (prérendue)  39 scripts en ligne,  0 portant un nonce
 *   /fr/panier (dynamique)  21 scripts en ligne, 21 portant un nonce
 *
 * Les 39 scripts de la page d'accueil sont la charge d'hydratation de Next
 * (`self.__next_f.push(...)`) — c'est leur seule et unique raison d'exiger
 * `unsafe-inline`. Sur une page prérendue, une politique stricte ne rendrait
 * pas la page plus sûre : elle la rendrait blanche.
 *
 * Le choix aurait donc pu être « tout dynamique, CSP stricte partout ». Il
 * coûterait le prérendu de 171 pages sur un catalogue — c'est-à-dire la
 * vitesse et le référencement — pour une défense en second rideau.
 *
 * ---------------------------------------------------------------------------
 * Où la politique stricte s'applique, et pourquoi c'est le bon partage
 * ---------------------------------------------------------------------------
 * Aux pages rendues à la requête, qui sont exactement celles qui manipulent de
 * l'argent, une session et des données personnelles : panier, tunnel de
 * commande, factures, espace compte, connexion, inscription, favoris. Ce sont
 * celles où une injection coûterait le plus, et elles ne perdent rien puisque
 * rien n'y était prérendu.
 *
 * Le catalogue public garde la politique permissive. Ce qu'il faut en dire
 * honnêtement : il n'est pas sans risque — il porte le formulaire d'offre et
 * l'ajout au panier, donc des actions serveur. Sa protection reste
 * l'échappement de React et le fait qu'aucun contenu n'y est rendu en HTML brut
 * (seul le JSON-LD l'est, et il passe par `serializeJsonLd`). Le second rideau
 * y manque toujours ; il ne pourra s'y poser que le jour où Next saura porter
 * un nonce dans une page prérendue.
 */

/** Origines tierces réellement utilisées, énumérées plutôt que devinées. */
const STRIPE_SCRIPTS = 'https://js.stripe.com'
const STRIPE_FRAMES = 'https://js.stripe.com https://hooks.stripe.com'
const STRIPE_API = 'https://api.stripe.com'
const IMAGE_HOSTS = 'https://res.cloudinary.com'

/**
 * Chemins servis à la requête, donc capables de porter un nonce.
 *
 * Cette liste DOIT correspondre aux pages qui déclarent `force-dynamic`.
 * Appliquer la politique stricte à une page prérendue la rendrait blanche —
 * aucun de ses scripts ne s'exécuterait. C'est un mode de panne total et
 * silencieux à la lecture du code, donc un test l'exerce contre le serveur
 * réel : `tests/e2e/csp.spec.ts` charge chacune de ces pages, vérifie que ses
 * scripts en ligne portent bien tous le nonce, et vérifie l'inverse sur une
 * page prérendue.
 *
 * Le préfixe de langue est laissé libre : `/fr/panier`, `/nl/panier`.
 */
export const STRICT_CSP_PATH =
  /^\/[a-z]{2}\/(panier|commande|compte|connexion|inscription|favoris)(\/|$)/

/**
 * La politique, avec ou sans nonce.
 *
 * `nonce` fourni → politique stricte, SANS `unsafe-inline`. Les deux ne se
 * cumulent pas : dès qu'un nonce est présent, les navigateurs ignorent
 * `unsafe-inline`. L'écrire quand même ne servirait qu'à faire croire à un
 * repli qui n'existe pas.
 *
 * `strict-dynamic` n'est volontairement PAS utilisé : il ferait ignorer la
 * liste d'origines, et le script de Stripe — inséré par `loadStripe`, donc
 * externe — dépendrait alors de la propagation de confiance depuis un script
 * noncé. Le comportement de Stripe.js sur ce point ne peut pas être vérifié
 * ici sans clé réelle. On garde donc l'énumération d'origines, qui protège
 * autant contre l'injection en ligne et se vérifie, elle.
 */
export function buildCsp({
  nonce,
  isDev,
}: {
  nonce?: string
  isDev: boolean
}): string {
  const scriptSrc = isDev
    ? // `unsafe-eval` uniquement en développement : react-refresh en a besoin.
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
    : nonce
      ? `script-src 'self' 'nonce-${nonce}' ${STRIPE_SCRIPTS}`
      : `script-src 'self' 'unsafe-inline' ${STRIPE_SCRIPTS}`

  return [
    "default-src 'self'",
    scriptSrc,
    // `style-src` garde `unsafe-inline` : Next injecte ses styles critiques en
    // ligne, et un style ne s'exécute pas. Le risque résiduel — exfiltration
    // par sélecteur d'attribut — suppose déjà une injection HTML, que
    // `script-src` traite en amont.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${IMAGE_HOSTS}`,
    "font-src 'self' data:",
    // Aucun script tiers avant consentement : la liste reste minimale et
    // explicite. `*.supabase.co` a été retiré — aucun code navigateur ne
    // l'utilise, et le joker ouvrait un canal d'exfiltration vers un service
    // que chacun ouvre en deux minutes.
    isDev
      ? "connect-src 'self' ws: wss:"
      : `connect-src 'self' ${STRIPE_API}`,
    `frame-src 'self' ${STRIPE_FRAMES}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}
