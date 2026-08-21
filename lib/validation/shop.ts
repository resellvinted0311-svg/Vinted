import { z } from 'zod'

/**
 * Validation des entrées de la boutique.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un schéma plutôt qu'un `if`
 * ---------------------------------------------------------------------------
 * Le brief est explicite : « validation Zod sur toute entrée, y compris les
 * Server Actions ». Les favoris validaient à la main (`length > 40`), le
 * panier ne validait rien du tout — alors que les paramètres d'URL du
 * catalogue, eux, sont bornés à 20 valeurs, avec la raison écrite à côté.
 *
 * La même donnée y était donc contrôlée trois fois différemment. Un schéma
 * partagé règle la question une bonne fois, et se relit.
 *
 * Ces fonctions ne sont pas encore toutes atteignables — la phase 2 consiste
 * précisément à les brancher. C'est le moment de poser les bornes, pas après.
 */

/**
 * Identifiant d'article.
 *
 * Un `cuid()` fait 25 caractères et n'utilise que des minuscules et des
 * chiffres. On accepte un peu plus large pour ne pas se retrouver coincé si le
 * générateur change, mais on ferme la porte aux chaînes arbitraires : cette
 * valeur part dans une clause `IN` et dans une clé composite indexée.
 */
export const articleIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/)

/**
 * Plafond de lignes traitées en une seule demande.
 *
 * `removeBlockedLines` acceptait un tableau non borné venu du réseau : chaque
 * entrée devient un paramètre d'une clause `IN`, et rien n'empêchait d'en
 * envoyer cent mille. La même borne que celle des filtres d'URL, pour la même
 * raison.
 */
export const MAX_LINES_PER_REQUEST = 20

export const articleIdListSchema = z
  .array(articleIdSchema)
  .max(MAX_LINES_PER_REQUEST)

/**
 * Nombre maximal de lignes dans un panier.
 *
 * Le stock est unitaire : chaque ligne est une pièce distincte. Trente est
 * très au-delà d'un panier réel de seconde main, et très en deçà de ce qu'il
 * faudrait pour faire souffrir la base ou le devis de port.
 */
export const MAX_CART_LINES = 30
