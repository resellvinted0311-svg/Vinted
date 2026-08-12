/**
 * Remplace `server-only` sous Vitest.
 *
 * Ce paquet lève volontairement à l'import hors du bundler Next. Les tests
 * d'intégration exercent pourtant du code serveur : l'alias le neutralise
 * sans retirer la protection en production.
 */
export {}
