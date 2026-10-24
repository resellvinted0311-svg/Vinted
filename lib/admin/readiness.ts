import 'server-only'

import { findMissingSettings, getSetting } from '@/lib/config/settings'
import { areTermsPublished } from '@/lib/config/pages'
import { missingLegalKeys, missingMediatorKeys } from '@/lib/config/site'
import { missingStripeKeys } from '@/lib/payments/stripe'
import { isEmailConfigured, usesTestSender } from '@/lib/providers/email/send'
import { isStorageConfigured } from '@/lib/providers/storage'

/**
 * Ce qui empêche encore la boutique de vendre, dit à l'endroit où on le lit.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ce fichier corrige, et il n'est pas théorique
 * ---------------------------------------------------------------------------
 * Chaque garde-fou de ce dépôt est correct pris isolément : les prix refusent
 * de se calculer sur les chiffres du jeu de démonstration, le paiement
 * s'éteint sans ses clés, les pages légales ne s'écrivent pas sans vendeur
 * identifié. Tous refusent proprement.
 *
 * Mais aucun ne le disait à QUI PEUT LE CORRIGER.
 *
 * Le cas réel : `settingsProfile` vaut encore `development` en production. Tout
 * import de pièce depuis l'application de gestion est alors refusé par un 503,
 * dont le message ne paraît que dans la réponse HTTP — c'est-à-dire nulle part
 * pour qui regarde la boutique. Le site s'affiche, le catalogue se parcourt,
 * la régie annonce « Rien en attente ». Et rien n'entre.
 *
 * Il faut deviner d'ouvrir l'écran des réglages pour voir la bannière qui
 * l'explique. Une vérification qui n'est lisible que par celui qui la cherchait
 * déjà ne sert à rien.
 *
 * ---------------------------------------------------------------------------
 * Ce fichier n'invente RIEN
 * ---------------------------------------------------------------------------
 * Chaque point interroge le mécanisme qui décide réellement — `missingStripeKeys`
 * pour le paiement, `areTermsPublished` pour les conditions, `getSetting` pour
 * le profil. Aucune règle n'est recopiée ici : une copie finirait par annoncer
 * « prêt » sur une boutique qui refuse, ou l'inverse.
 *
 * C'est aussi pourquoi il ne compte pas de pourcentage d'avancement et
 * n'affiche aucune échéance : un chiffre de progression inventé est exactement
 * ce que le cahier des charges interdit.
 */

/**
 * Un point de mise en service.
 *
 * La clé sert à retrouver le libellé traduit. Le texte ne vit pas ici : ce
 * module dit CE QUI EST, pas comment on l'écrit.
 */
export interface PointMiseEnService {
  cle: string
  /** Vrai quand ce point n'empêche plus rien. */
  pret: boolean
  /**
   * Bloquant : tant qu'il n'est pas prêt, aucune vente ne peut aboutir — ou
   * aucune pièce ne peut entrer. Non bloquant : la boutique fonctionne, mais
   * amputée de quelque chose.
   */
  bloquant: boolean
  /**
   * Précision factuelle, quand il y en a une à donner : les noms des variables
   * manquantes, les clés de réglage absentes. Jamais une phrase — elle serait
   * en français sur une régie qui parle huit langues.
   */
  detail?: string
}

export interface EtatMiseEnService {
  points: PointMiseEnService[]
  /** Y a-t-il au moins un point bloquant ? */
  bloque: boolean
  /** Tout est-il prêt ? Alors l'écran n'affiche rien. */
  pret: boolean
}

/**
 * Dresse l'état de mise en service.
 *
 * Deux lectures en base seulement, lancées de front : le reste est de la
 * configuration d'environnement, lue en mémoire. La production n'accorde qu'une
 * connexion par instance, et cet écran est le premier de la régie — l'enchaîner
 * en série doublerait l'attente sur chaque visite.
 */
export async function lireEtatMiseEnService(): Promise<EtatMiseEnService> {
  const [profil, reglagesAbsents] = await Promise.all([
    getSetting('settingsProfile'),
    findMissingSettings(),
  ])

  const clesStripeAbsentes = missingStripeKeys()
  const identiteAbsente = missingLegalKeys()
  const mediateurAbsent = missingMediatorKeys()

  const points: PointMiseEnService[] = [
    /*
      LE point qui a motivé cet écran, et il vient en premier.

      Le profil de démonstration fait refuser tout calcul de prix en
      production — donc tout import. Et c'est le seul de la liste dont la
      conséquence est invisible depuis la boutique : les autres se voient
      (pas de bouton de paiement, pas de photos, pas de conditions).
    */
    {
      cle: 'pricing',
      pret: profil === 'production',
      bloquant: true,
    },
    {
      cle: 'settings',
      pret: reglagesAbsents.length === 0,
      bloquant: true,
      ...(reglagesAbsents.length > 0
        ? { detail: reglagesAbsents.join(', ') }
        : {}),
    },
    {
      cle: 'payment',
      pret: clesStripeAbsentes.length === 0,
      bloquant: true,
      // Les NOMS des variables, jamais leurs valeurs. Cet écran est derrière
      // une authentification, mais une capture d'écran ne l'est pas.
      ...(clesStripeAbsentes.length > 0
        ? { detail: clesStripeAbsentes.join(', ') }
        : {}),
    },
    {
      /*
        L'identité légale ne bloque aucun MÉCANISME — et c'est précisément ce
        qui la rend dangereuse à classer.

        Vérifié dans `lib/shop/checkout.ts` : sans elle, la commande est créée
        normalement. Ce qui change, c'est que `cgvVersion` et `cgvAcceptedAt`
        ne sont PAS écrits — on vend sans conserver la preuve que les
        conditions ont été acceptées, et les mentions légales du site restent
        incomplètes.

        Marqué bloquant parce que la question posée par cet écran est « peut-on
        vendre », pas « le code tourne-t-il ». Vendre à un consommateur
        français sans vendeur identifié n'est pas une vente, c'est un litige
        en préparation.
      */
      cle: 'legal',
      pret: identiteAbsente.length === 0,
      bloquant: true,
      // Neuf variables désormais, pour une société : sans leurs noms, on
      // chercherait laquelle manque en relisant la documentation.
      ...(identiteAbsente.length > 0
        ? { detail: identiteAbsente.join(', ') }
        : {}),
    },
    {
      cle: 'terms',
      pret: areTermsPublished(),
      bloquant: true,
    },
    {
      // Obligatoire pour un commerce en ligne B2C français (article L612-1 du
      // code de la consommation), mais il ne bloque aucun mécanisme : la
      // boutique encaisserait sans lui. On le dit sans mentir sur sa nature.
      cle: 'mediator',
      pret: mediateurAbsent.length === 0,
      bloquant: false,
      ...(mediateurAbsent.length > 0
        ? { detail: mediateurAbsent.join(', ') }
        : {}),
    },
    {
      // Non bloquant au sens strict — une commande s'enregistre sans e-mail —
      // mais personne n'est prévenu de rien : ni l'acheteuse de son paiement,
      // ni la boutique de ce qu'elle doit emballer.
      cle: 'email',
      pret: isEmailConfigured(),
      bloquant: false,
    },
    {
      // Les deux variables posées ne suffisent pas : avec l'adresse d'essai de
      // Resend ou celle de `.env.example`, aucune acheteuse n'est jamais
      // jointe, et le point précédent se croirait réglé.
      cle: 'emailSender',
      pret: !usesTestSender(),
      bloquant: false,
    },
    {
      cle: 'storage',
      pret: isStorageConfigured(),
      bloquant: false,
    },
  ]

  return {
    points,
    bloque: points.some((point) => point.bloquant && !point.pret),
    pret: points.every((point) => point.pret),
  }
}
