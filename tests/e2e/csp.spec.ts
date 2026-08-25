import { test, expect, type Page } from '@playwright/test'

/**
 * La politique de sécurité de contenu, vérifiée sur le serveur réel.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce fichier existe, et pourquoi il est en bout-en-bout
 * ---------------------------------------------------------------------------
 * La politique est à deux niveaux : stricte, à nonce, sur les pages rendues à
 * la requête ; permissive sur les pages prérendues, dont le HTML est figé au
 * build et ne peut donc pas porter un nonce qui change à chaque requête.
 *
 * Ce partage a un mode de panne total et silencieux à la lecture : appliquer
 * la politique stricte à une page PRÉRENDUE la rendrait blanche — aucun de ses
 * scripts en ligne ne portant de nonce, le navigateur les refuserait tous, et
 * la page s'afficherait sans jamais s'hydrater. Aucun typage, aucun test
 * unitaire ne peut attraper cela : il faut un vrai navigateur, un vrai serveur,
 * et regarder ce que le premier dit du second.
 *
 * C'est ce que fait ce fichier. Il tombera le jour où quelqu'un ajoutera un
 * chemin à `STRICT_CSP_PATH` sans que la page correspondante soit dynamique —
 * ou l'inverse, retirera `force-dynamic` d'une page déjà couverte.
 */

/** Pages rendues à la requête : elles DOIVENT porter la politique stricte. */
const DYNAMIC_PAGES = [
  '/fr/panier',
  '/fr/connexion',
  '/fr/inscription',
  '/fr/favoris',
  '/fr/commande',
]

/** Pages prérendues : elles NE PEUVENT PAS porter de nonce. */
const PRERENDERED_PAGES = ['/fr', '/fr/catalogue', '/fr/pages/cgv']

/** La directive `script-src` telle qu'elle est réellement servie. */
function scriptSrcOf(csp: string): string {
  const directive = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('script-src'))
  return directive ?? ''
}

/**
 * Les scripts en ligne EXÉCUTABLES de la page.
 *
 * Le JSON-LD est écarté : `type="application/ld+json"` est un bloc de données,
 * que le navigateur n'exécute pas et que `script-src` ne gouverne donc pas.
 */
async function inlineScripts(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('script')]
      .filter((el) => !el.src && el.textContent?.trim() && el.type !== 'application/ld+json')
      .map((el) => ({ hasNonce: Boolean(el.nonce || el.getAttribute('nonce')) })),
  )
}

test.describe('Politique stricte sur les pages dynamiques', () => {
  for (const path of DYNAMIC_PAGES) {
    test(`${path} n’autorise aucun script en ligne non signé`, async ({ page }) => {
      // Les violations de politique sont rapportées par le NAVIGATEUR. C'est
      // la vérification qui compte : la présence textuelle d'un nonce ne
      // prouve pas que le navigateur l'a accepté.
      const violations: string[] = []
      page.on('console', (message) => {
        if (/content security policy/i.test(message.text())) {
          violations.push(message.text())
        }
      })

      const response = await page.goto(path)
      const csp = response?.headers()['content-security-policy'] ?? ''
      const scriptSrc = scriptSrcOf(csp)

      // Un nonce et `unsafe-inline` ne se cumulent pas : dès qu'un nonce est
      // présent, les navigateurs ignorent `unsafe-inline`. Le laisser ne
      // ferait donc que faire croire à un repli qui n'existe pas.
      expect(scriptSrc, path).toContain("'nonce-")
      expect(scriptSrc, path).not.toContain('unsafe-inline')
      expect(scriptSrc, path).not.toContain('unsafe-eval')

      const scripts = await inlineScripts(page)
      expect(scripts.length, `${path} : aucun script en ligne à vérifier`).toBeGreaterThan(0)
      expect(
        scripts.filter((s) => !s.hasNonce),
        `${path} : des scripts en ligne sans nonce seraient refusés, la page ne s’hydraterait pas`,
      ).toEqual([])

      expect(violations, `${path} : le navigateur a refusé quelque chose`).toEqual([])
    })
  }

  test('la page reste vivante sous la politique stricte', async ({ page }) => {
    // Le contrôle qui compte vraiment : le JavaScript s'exécute-t-il ? Une
    // page peut s'afficher parfaitement et n'être qu'une image morte si tous
    // ses scripts ont été refusés.
    await page.goto('/fr/connexion')

    const form = page.locator('#contenu form').first()
    await expect(form.getByLabel('Adresse e-mail').first()).toBeVisible()

    // Une bascule pilotée par React : elle ne répond que si l'hydratation a eu
    // lieu, donc que si le nonce a été accepté.
    await expect(page.locator('body')).toHaveAttribute('class', /.+/)
    const hydrated = await page.evaluate(
      () => typeof (window as { __next_f?: unknown }).__next_f !== 'undefined',
    )
    expect(hydrated, 'la charge d’hydratation de Next n’a pas été exécutée').toBe(true)
  })
})

test.describe('Politique permissive sur les pages prérendues', () => {
  for (const path of PRERENDERED_PAGES) {
    test(`${path} n’exige pas de nonce`, async ({ page }) => {
      // L'inverse du test précédent, et il est tout aussi nécessaire : c'est
      // lui qui attrape l'erreur qui rendrait une page blanche. Un nonce dans
      // l'en-tête d'une page dont le HTML est figé au build refuserait tous
      // ses scripts.
      const violations: string[] = []
      page.on('console', (message) => {
        if (/content security policy/i.test(message.text())) {
          violations.push(message.text())
        }
      })

      const response = await page.goto(path)
      const scriptSrc = scriptSrcOf(
        response?.headers()['content-security-policy'] ?? '',
      )

      expect(scriptSrc, path).not.toContain("'nonce-")
      expect(violations, `${path} : le navigateur a refusé quelque chose`).toEqual([])
    })
  }
})

test.describe('Ce que la politique ferme partout', () => {
  test('les directives qui ne dépendent pas du nonce sont posées', async ({
    page,
  }) => {
    const response = await page.goto('/fr')
    const csp = response?.headers()['content-security-policy'] ?? ''

    // `connect-src` borne où un script pourrait renvoyer ce qu'il vole.
    // `*.supabase.co` en a été retiré : aucun code navigateur ne l'utilise, et
    // le joker ouvrait un canal d'exfiltration vers un service que chacun
    // ouvre en deux minutes.
    expect(csp).toContain("connect-src 'self' https://api.stripe.com")
    expect(csp).not.toContain('supabase')

    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
  })
})
