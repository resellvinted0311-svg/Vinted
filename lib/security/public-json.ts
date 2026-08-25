import 'server-only'
import { logger } from '@/lib/observability/logger'

import { NextResponse } from 'next/server'
import { findPrivateFieldLeaks } from '@/lib/db/selectors'

/**
 * Réponse JSON publique, balayée avant d'être émise.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une seconde barrière
 * ---------------------------------------------------------------------------
 * La première barrière, ce sont les sélecteurs Prisma explicites : on énumère
 * les colonnes voulues, jamais l'inverse. Elle est solide, mais elle ne couvre
 * pas tout. Trois façons de la contourner sans le vouloir :
 *
 *  - une requête SQL brute, qui ne passe par aucun sélecteur ;
 *  - un `include` ajouté à la va-vite pour déboguer, puis oublié ;
 *  - une charge utile assemblée à la main, où l'on recopie un objet entier.
 *
 * `findPrivateFieldLeaks` existait déjà mais n'était appelé QUE par les tests.
 * Un filet de sécurité qui n'est pas tendu sous le trapèze ne rattrape rien :
 * il est désormais tendu ici, sur le chemin réel des réponses.
 *
 * ---------------------------------------------------------------------------
 * Que faire quand une fuite est détectée
 * ---------------------------------------------------------------------------
 * On refuse. Pas de nettoyage silencieux : un champ retiré à la volée
 * laisserait le défaut en place et le rendrait invisible, jusqu'au jour où le
 * balayage ne le reconnaîtrait plus. Une erreur 500 bruyante se corrige ; une
 * fuite discrète se découvre trop tard.
 *
 * Le message renvoyé au client ne nomme pas le champ fautif — inutile
 * d'indiquer à qui cherche ce qu'il a failli obtenir. Le nom part dans les
 * journaux serveur.
 */
export function publicJson(body: unknown, init?: ResponseInit): NextResponse {
  const leaks = findPrivateFieldLeaks(body)

  if (leaks.length > 0) {
    // Bruyant, et sans valeur : on journalise le CHEMIN du champ, jamais son
    // contenu — le contenu est précisément ce qui ne doit aller nulle part.
    logger.error('public_json.private_field_leak', { fields: leaks.join(',') })

    return NextResponse.json(
      { error: 'internal' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return NextResponse.json(body, init)
}
