import { describe, it, expect, vi, afterEach } from 'vitest'
import { publicJson } from '@/lib/security/public-json'

/**
 * Le filet de sécurité doit être tendu sous le trapèze, pas rangé au vestiaire.
 *
 * `findPrivateFieldLeaks` existait déjà, mais seuls les tests l'appelaient.
 * Ces cas vérifient qu'il s'applique désormais au chemin réel des réponses.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

describe('publicJson', () => {
  it('laisse passer une charge utile propre', async () => {
    const response = publicJson({ suggestions: [{ label: 'Levi’s' }] })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      suggestions: [{ label: 'Levi’s' }],
    })
  })

  it('refuse plutôt que d’émettre un coût d’achat', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = publicJson({ article: { id: 'a1', costCents: 1200 } })

    expect(response.status).toBe(500)
    const body = await response.text()
    // Ni la valeur, ni le nom du champ ne repartent vers le client.
    expect(body).not.toContain('1200')
    expect(body).not.toContain('costCents')
    // Mais le serveur, lui, le dit clairement.
    expect(error).toHaveBeenCalledWith(expect.stringContaining('costCents'))
  })

  it('repère une fuite imbriquée dans un tableau', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = publicJson({
      items: [{ id: 'a' }, { id: 'b', internalNotes: 'tache au col' }],
    })

    expect(response.status).toBe(500)
  })

  it('repère le détenteur d’une réservation', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // Savoir que deux pièces sont réservées par la même personne revient à
    // suivre un panier en cours de constitution depuis l'extérieur.
    const response = publicJson({ id: 'a1', reservedById: 'usr_42' })

    expect(response.status).toBe(500)
  })

  it('repère un secret de session', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = publicJson({ user: { id: 'u1', passwordHash: '$argon2id$…' } })

    expect(response.status).toBe(500)
  })

  it('laisse passer la date de fin de réservation', async () => {
    // Ce qu'une visiteuse doit voir d'une réservation : qu'elle existe et
    // jusqu'à quand. C'est ce qui rend l'affichage honnête.
    const response = publicJson({
      id: 'a1',
      status: 'RESERVED',
      reservedUntil: '2026-08-21T12:15:00.000Z',
    })

    expect(response.status).toBe(200)
  })

  it('conserve les en-têtes fournis', () => {
    const response = publicJson(
      { signedIn: false },
      { headers: { 'Cache-Control': 'no-store' } },
    )

    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
