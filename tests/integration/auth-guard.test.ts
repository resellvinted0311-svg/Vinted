import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db/client'
import { signUpAction, signInAction } from '@/lib/auth/actions'

/**
 * Refus propre quand l'authentification n'est pas configurée.
 *
 * Ce test existe à cause d'un défaut réel, silencieux et coûteux : sans
 * `AUTH_SECRET`, l'inscription écrivait l'utilisateur en base, ouvrait une
 * session et posait le cookie — puis `getCurrentUser()` renvoyait `null`,
 * puisqu'il refuse de lire une session sans secret de signature.
 *
 * Résultat pour la personne : elle remplit le formulaire, se retrouve renvoyée
 * vers la connexion, réessaie, et s'entend répondre que l'adresse est déjà
 * prise — par un compte devenu inutilisable.
 *
 * Ce qui est vérifié ici, ce n'est donc pas le message d'erreur : c'est
 * qu'AUCUNE écriture n'a lieu.
 */

const EMAIL = 'garde-fou@nina-diego.test'

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

let savedSecret: string | undefined
let savedNextAuth: string | undefined

beforeEach(async () => {
  savedSecret = process.env.AUTH_SECRET
  savedNextAuth = process.env.NEXTAUTH_SECRET
  delete process.env.AUTH_SECRET
  delete process.env.NEXTAUTH_SECRET

  await prisma.user.deleteMany({ where: { email: EMAIL } })
})

afterEach(async () => {
  if (savedSecret === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = savedSecret

  if (savedNextAuth === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = savedNextAuth

  await prisma.user.deleteMany({ where: { email: EMAIL } })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('authentification non configurée', () => {
  it('l’inscription refuse et n’écrit aucun utilisateur', async () => {
    const result = await signUpAction(
      { status: 'idle' },
      form({
        email: EMAIL,
        password: 'MotDePasseAssezLong2026',
        locale: 'fr',
      }),
    )

    expect(result).toEqual({ status: 'error', messageKey: 'notConfigured' })

    // Le point central : l'adresse reste libre. Un compte à moitié créé la
    // condamnerait pour toujours.
    const user = await prisma.user.findUnique({ where: { email: EMAIL } })
    expect(user).toBeNull()
  })

  it('la connexion refuse sans ouvrir de session', async () => {
    const before = await prisma.session.count()

    const result = await signInAction(
      { status: 'idle' },
      form({ email: EMAIL, password: 'MotDePasseAssezLong2026' }),
    )

    expect(result).toEqual({ status: 'error', messageKey: 'notConfigured' })
    expect(await prisma.session.count()).toBe(before)
  })

  it('le refus précède la limitation de débit', async () => {
    // Dix tentatives ne doivent pas consommer le quota ni changer la réponse :
    // le refus est structurel, pas conjoncturel.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await signInAction(
        { status: 'idle' },
        form({ email: EMAIL, password: 'MotDePasseAssezLong2026' }),
      )
      expect(result).toEqual({ status: 'error', messageKey: 'notConfigured' })
    }
  })
})
