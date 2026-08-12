import { handlers } from '@/lib/auth'

export const { GET, POST } = handlers

// Prisma et argon2 ne s'exécutent pas sur l'Edge.
export const runtime = 'nodejs'
