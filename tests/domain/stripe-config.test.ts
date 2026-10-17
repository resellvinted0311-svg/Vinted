import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { isStripeConfigured, missingStripeKeys } from '@/lib/payments/stripe'

/**
 * Le garde du paiement, et les configurations PARTIELLES qu'il doit refuser.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ce fichier tient fermé
 * ---------------------------------------------------------------------------
 * Le garde ne regardait qu'une variable sur trois. On pose rarement trois
 * variables d'un coup — on en pose une, on déploie, on vérifie — et chacun des
 * états intermédiaires passait le garde en laissant la boutique faire comme si
 * elle pouvait encaisser.
 *
 * Les deux états intermédiaires ont des conséquences différentes, et les deux
 * sont vérifiés ici nommément :
 *
 *  - clé secrète seule : une commande créée et du stock verrouillé une
 *    demi-heure pour une vente qui ne peut pas aboutir ;
 *  - secret de rappel manquant : une carte débitée en face d'une commande qui
 *    reste « en attente de paiement », pour toujours.
 *
 * Le second est le pire défaut que ce dépôt puisse produire : il prend de
 * l'argent sans rien livrer, et rien ne casse visiblement.
 */

const SECRETE = 'STRIPE_SECRET_KEY'
const PUBLIQUE = 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'
const RAPPEL = 'STRIPE_WEBHOOK_SECRET'

const TOUTES = [SECRETE, PUBLIQUE, RAPPEL] as const

const sauvegarde = new Map<string, string | undefined>(
  TOUTES.map((nom) => [nom, process.env[nom]]),
)

/** Pose exactement les variables nommées, et vide les autres. */
function configurer(...posees: readonly string[]): void {
  for (const nom of TOUTES) {
    if (posees.includes(nom)) process.env[nom] = `valeur-${nom}`
    else delete process.env[nom]
  }
}

beforeEach(() => configurer())

afterAll(() => {
  for (const [nom, valeur] of sauvegarde) {
    if (valeur === undefined) delete process.env[nom]
    else process.env[nom] = valeur
  }
})

describe('ce qui compte comme « paiement configuré »', () => {
  it('refuse un déploiement sans aucune variable', () => {
    // L'état par défaut d'une boutique qui n'a pas encore ouvert. Ce n'est pas
    // une panne, et tout le reste du site doit fonctionner ainsi.
    expect(isStripeConfigured()).toBe(false)
    expect(missingStripeKeys()).toEqual([SECRETE, PUBLIQUE, RAPPEL])
  })

  it('accepte le déploiement, et seulement lui, quand les trois sont là', () => {
    configurer(SECRETE, PUBLIQUE, RAPPEL)

    expect(isStripeConfigured()).toBe(true)
    expect(missingStripeKeys()).toEqual([])
  })
})

describe('les configurations partielles, une par une', () => {
  it('refuse la clé secrète SEULE — c’est la régression corrigée', () => {
    /*
      L'état exact du défaut : le bouton « Commander » restait actif, l'action
      serveur créait la commande, le verrou de stock partait pour trente
      minutes, et c'est seulement ensuite que le cadre de paiement affichait
      une panne de configuration.

      Une pièce quittait la boutique pour une vente impossible, et il fallait
      attendre l'expiration du verrou pour qu'elle revienne.
    */
    configurer(SECRETE)

    expect(isStripeConfigured()).toBe(false)
    expect(missingStripeKeys()).toEqual([PUBLIQUE, RAPPEL])
  })

  it('refuse l’absence du SECRET DE RAPPEL, carte débitée sans commande payée', () => {
    /*
      Le cas le plus grave, et le plus silencieux. Les deux clés présentes
      suffisent à ouvrir la session ET à afficher le cadre : la carte est
      réellement débitée. Stripe appelle ensuite la route de rappel, qui n'a
      pas de secret pour vérifier la signature et refuse l'événement.

      La commande ne devient jamais payée. L'argent, lui, est parti.
    */
    configurer(SECRETE, PUBLIQUE)

    expect(isStripeConfigured()).toBe(false)
    expect(missingStripeKeys()).toEqual([RAPPEL])
  })

  it('refuse l’absence de la clé PUBLIQUE, cadre de saisie impossible', () => {
    configurer(SECRETE, RAPPEL)

    expect(isStripeConfigured()).toBe(false)
    expect(missingStripeKeys()).toEqual([PUBLIQUE])
  })
})

describe('ce qui ne compte pas comme une valeur', () => {
  it('traite une variable vide ou blanche comme absente', () => {
    /*
      Une variable posée à la main dans une interface web finit vide ou avec
      un espace. Une chaîne vide est déjà fausse en JavaScript, mais `" "` ne
      l'est pas : sans découpe, le garde l'accepterait et l'on retomberait
      exactement dans le défaut qu'on vient de fermer.
    */
    configurer(SECRETE, PUBLIQUE, RAPPEL)
    process.env[RAPPEL] = '   '

    expect(isStripeConfigured()).toBe(false)
    expect(missingStripeKeys()).toEqual([RAPPEL])
  })

  it('ne rend que des NOMS de variables, jamais leurs valeurs', () => {
    // Ce retour part dans un journal. Une clé secrète journalisée est une clé
    // publiée — c'est la faute que ce dépôt a déjà commise une fois.
    configurer()
    process.env[SECRETE] = 'sk_live_une_vraie_cle'

    const manquantes = missingStripeKeys()

    expect(manquantes.join(' ')).not.toContain('sk_live')
    for (const nom of manquantes) {
      expect(nom).toMatch(/^[A-Z_]+$/)
    }
  })
})
