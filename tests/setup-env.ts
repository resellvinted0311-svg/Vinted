import { config } from 'dotenv'

// Les tests d'intégration ont besoin de DATABASE_URL. On charge .env sans
// écraser ce qui est déjà défini dans l'environnement (utile en CI).
config({ path: '.env', override: false })
