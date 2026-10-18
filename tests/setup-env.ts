import { config } from 'dotenv'

// Les tests d'intégration ont besoin de DATABASE_URL. On charge .env sans
// écraser ce qui est déjà défini dans l'environnement (utile en CI).
config({ path: '.env', override: false })

// La négociation est ÉTEINTE par défaut en production — `isNegotiationEnabled`.
// Mais toute sa mécanique reste en place, et les fichiers qui l'exercent
// (dépôt d'offre, contre-proposition, registre, prix négocié) doivent continuer
// de la tester : c'est ce qui permet de la rallumer sans surprise.
//
// On l'allume donc ici, pour toute la suite. Le comportement ÉTEINT a ses
// propres tests, qui retirent explicitement la variable — voir
// `tests/integration/negotiation-switch.test.ts`.
process.env.OFFERS_ENABLED ??= '1'
