import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db/client'
import { lireEtatMiseEnService } from '@/lib/admin/readiness'

/**
 * L'état de mise en service, et le défaut qu'il rend visible.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi cet écran existe
 * ---------------------------------------------------------------------------
 * Une boutique dont `settingsProfile` vaut encore `development` refuse TOUT
 * import en production, par un 503 dont le message ne paraît que dans une
 * réponse HTTP. Le site s'affiche, le catalogue se parcourt, la régie annonce
 * « Rien en attente » — et rien n'entre.
 *
 * Le refus était correct ; sa discrétion ne l'était pas.
 */

const CLE_PROFIL = 'settingsProfile'

let profilInitial: unknown

beforeEach(async () => {
  const ligne = await prisma.setting.findUnique({
    where: { key: CLE_PROFIL },
    select: { value: true },
  })
  if (profilInitial === undefined) profilInitial = ligne?.value ?? null
})

afterAll(async () => {
  // Remis EXACTEMENT comme il était : les autres fichiers de cette suite
  // tournent contre la même base, et une boutique laissée en `production`
  // ferait calculer des prix sur des chiffres de démonstration.
  if (profilInitial !== null && profilInitial !== undefined) {
    await prisma.setting.update({
      where: { key: CLE_PROFIL },
      data: { value: profilInitial as never },
    })
  }
  await prisma.$disconnect()
})

async function poserProfil(valeur: 'development' | 'production') {
  await prisma.setting.upsert({
    where: { key: CLE_PROFIL },
    update: { value: valeur },
    create: { key: CLE_PROFIL, value: valeur },
  })
}

function point(
  etat: Awaited<ReturnType<typeof lireEtatMiseEnService>>,
  cle: string,
) {
  const trouve = etat.points.find((p) => p.cle === cle)
  expect(trouve, `point « ${cle} » absent de l’état`).toBeDefined()
  return trouve!
}

describe('le profil de démonstration', () => {
  it('bloque, et le dit par un point NON prêt', async () => {
    await poserProfil('development')

    const etat = await lireEtatMiseEnService()

    expect(point(etat, 'pricing').pret).toBe(false)
    expect(point(etat, 'pricing').bloquant).toBe(true)
    expect(etat.bloque).toBe(true)
    expect(etat.pret).toBe(false)
  })

  it('cesse de bloquer une fois les vrais chiffres enregistrés', async () => {
    /*
      C'est le geste de sortie, et il doit être atteignable : l'enregistrement
      du formulaire de réglages fait passer le profil à `production`. Un
      réglage obligatoire qu'aucun écran ne peut poser serait un cul-de-sac —
      le dépôt en a déjà connu un.
    */
    await poserProfil('production')

    expect(point(await lireEtatMiseEnService(), 'pricing').pret).toBe(true)
  })
})

describe('le paiement', () => {
  it('nomme les variables manquantes, et JAMAIS leurs valeurs', async () => {
    /*
      Le détail part sur un écran, donc dans une capture d'écran. Ce dépôt a
      déjà publié un mot de passe avec son code ; le garde-fou est de ne
      laisser passer que des noms.
    */
    const sauvegarde = process.env.STRIPE_SECRET_KEY
    process.env.STRIPE_SECRET_KEY = 'sk_live_une_vraie_cle'

    try {
      const paiement = point(await lireEtatMiseEnService(), 'payment')

      expect(paiement.pret).toBe(false)
      expect(paiement.detail).toBeDefined()
      expect(paiement.detail).not.toContain('sk_live')
      // Les deux autres variables, nommées pour qu'on sache laquelle poser.
      expect(paiement.detail).toContain('STRIPE_WEBHOOK_SECRET')
      expect(paiement.detail).toContain('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY')
    } finally {
      if (sauvegarde === undefined) delete process.env.STRIPE_SECRET_KEY
      else process.env.STRIPE_SECRET_KEY = sauvegarde
    }
  })
})

describe('ce qui empêche de vendre, et ce qui ampute seulement', () => {
  it('distingue les deux, sans les confondre', async () => {
    const etat = await lireEtatMiseEnService()

    // Le médiateur est obligatoire en droit français, mais il ne bloque aucun
    // mécanisme : la boutique encaisserait sans lui. Le dire autrement serait
    // mentir sur la nature du point.
    expect(point(etat, 'mediator').bloquant).toBe(false)
    expect(point(etat, 'storage').bloquant).toBe(false)

    // Le paiement, les prix et les conditions, eux, arrêtent une vente.
    for (const cle of ['pricing', 'payment', 'legal', 'terms']) {
      expect(point(etat, cle).bloquant, cle).toBe(true)
    }
  })

  it('« bloque » ne retient QUE les points bloquants', async () => {
    // Sans cette distinction, une boutique parfaitement capable de vendre
    // afficherait « ne peut pas encore vendre » parce qu'il lui manque un
    // hébergeur de photos. L'alerte deviendrait du bruit, et le vrai blocage
    // passerait avec elle.
    await poserProfil('production')
    const etat = await lireEtatMiseEnService()

    const bloquantsNonPrets = etat.points.filter((p) => p.bloquant && !p.pret)
    expect(etat.bloque).toBe(bloquantsNonPrets.length > 0)
  })
})

describe('chaque point est RÉELLEMENT affichable', () => {
  it('a son libellé dans les messages', async () => {
    /*
      Le point le plus important de ce fichier.

      La clé du point et le chemin du message sont assemblés dans le gabarit
      (`readiness.points.${cle}`), et rien ne vérifiait la correspondance. Une
      clé ajoutée ici sans son libellé fait rendre à next-intl le CHEMIN de la
      clé — on lirait « readiness.points.storage » en toutes lettres.

      Et ce serait précisément sur l'écran qu'on ouvre PARCE QUE quelque chose
      ne va pas.

      Seul le français est vérifié ici : `tests/domain/messages.test.ts` tient
      déjà l'égalité des clés entre les huit langues, et refaire ce travail
      dirait deux fois la même chose.
    */
    const messages = JSON.parse(
      readFileSync(join(process.cwd(), 'messages', 'fr.json'), 'utf8'),
    ) as { admin: { readiness: { points: Record<string, string> } } }

    const libelles = messages.admin.readiness.points
    const etat = await lireEtatMiseEnService()

    for (const p of etat.points) {
      expect(libelles[p.cle], `libellé manquant pour « ${p.cle} »`).toBeTypeOf(
        'string',
      )
    }

    // Et l'inverse : un libellé sans point est un texte mort que personne ne
    // verra jamais, et qu'on traduirait pourtant huit fois à chaque relecture.
    const clesConnues = new Set(etat.points.map((p) => p.cle))
    for (const cle of Object.keys(libelles)) {
      expect(clesConnues.has(cle), `libellé « ${cle} » sans point`).toBe(true)
    }
  })
})
