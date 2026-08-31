'use server'

import { prisma } from '@/lib/db/client'
import { requireAdmin } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { recordAudit } from '@/lib/audit/trail'
import {
  EDITABLE_SETTINGS,
  parseSettingInput,
  writeSettings,
  type SettingKey,
} from '@/lib/config/settings'

/**
 * Les réglages métier, modifiables depuis le back-office.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * `'use server'` ne rend pas un fichier privé : il rend PUBLIC tout ce qu'il
 * exporte. Ce module n'exporte donc qu'UNE action, et elle commence par
 * `requireAdmin()`.
 *
 * Le middleware protège `/admin`, mais une Server Action n'est pas une page :
 * elle est appelée par un POST vers l'URL de la page qui l'a rendue, et rien
 * n'oblige un appelant à passer par cette page. Ici l'enjeu est direct — sans
 * ce contrôle, n'importe qui poserait la marge minimale à zéro et achèterait
 * ensuite tout le catalogue au prix de revient.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi cet écran existe
 * ---------------------------------------------------------------------------
 * Ces nombres racontent l'économie de la boutique : ce qu'elle gagne par pièce,
 * ce qu'elle prend sur chaque colis, jusqu'où elle cède et au bout de combien de
 * temps. Ils vivaient dans `prisma/seed.ts`, donc dans un dépôt public.
 *
 * Ils n'y sont plus. Le seed ne pose que des valeurs explicitement fictives
 * (`prisma/seed-data/fixtures.ts`), et les vraies n'existent que dans la base de
 * production, posées ici. C'est ce qui permet de les changer sans redéployer —
 * et, surtout, sans jamais les écrire dans un fichier.
 *
 * ---------------------------------------------------------------------------
 * L'enregistrement fait passer le profil en « production »
 * ---------------------------------------------------------------------------
 * `settingsProfile` ne figure pas dans le formulaire : il est une CONSÉQUENCE.
 * Le seed écrit `development` ; enregistrer de vraies valeurs ici le fait passer
 * à `production`, ce qui lève le refus de `getPricingConfig()`.
 *
 * Le faire cocher à la main aurait deux défauts : on peut cocher sans avoir rien
 * saisi, et on peut saisir sans penser à cocher — le second laissant la boutique
 * refuser de vendre alors que tout est réglé.
 */

export type AdminSettingsState =
  | { status: 'idle' }
  | { status: 'error'; messageKey: string; key?: string }
  | { status: 'done'; changed: number }

const ERROR = (messageKey: string, key?: string): AdminSettingsState => ({
  status: 'error',
  messageKey,
  ...(key === undefined ? {} : { key }),
})

export async function updateSettingsAction(
  _previous: AdminSettingsState,
  formData: FormData,
): Promise<AdminSettingsState> {
  // EN PREMIER, avant toute lecture de l'entrée.
  const admin = await requireAdmin()

  // Compteur sur l'identité prouvée. Il ne protège pas d'un administrateur
  // malveillant — rien ne le peut à ce niveau de droits — mais du script qui
  // boucle : chaque enregistrement ouvre une transaction, et la production
  // n'accorde qu'une connexion par instance.
  const allowed = await checkRateLimit({
    key: `settings-update:${admin.id}`,
    limit: 60,
    windowSeconds: 3600,
    sensitive: true,
  })
  if (!allowed) return ERROR('rateLimited')

  // On ne lit QUE les clés de la liste fermée, jamais ce que le formulaire a
  // envoyé. Boucler sur `formData` laisserait un appelant ajouter un champ
  // nommé d'après un réglage qui n'est pas censé être éditable — et
  // `writeSettings` le refuserait, mais après avoir accepté de le considérer.
  const entries: { key: SettingKey; value: unknown }[] = []

  for (const setting of EDITABLE_SETTINGS) {
    const raw = formData.get(setting.key)

    // Une case décochée n'est pas envoyée : c'est le seul champ dont l'absence
    // est une valeur, et elle vaut « faux ». Pour tous les autres, une absence
    // est une requête malformée — pas un motif d'écrire une valeur par défaut.
    if (raw === null) {
      if (setting.kind === 'boolean') {
        entries.push({ key: setting.key, value: false })
        continue
      }
      return ERROR('invalidRequest', setting.key)
    }

    if (typeof raw !== 'string') return ERROR('invalidRequest', setting.key)

    const parsed = parseSettingInput(setting.key, raw)
    if (!parsed.ok) return ERROR('invalidValue', setting.key)

    entries.push({ key: setting.key, value: parsed.value })
  }

  /**
   * La zone de plancher doit EXISTER, et c'est ici qu'on le vérifie.
   *
   * `parseSettingInput` est pure : elle contrôle la forme, pas le contenu de la
   * base. L'écran propose une liste construite à partir des zones réellement
   * présentes, mais une Server Action est un POST — rien n'oblige un appelant à
   * passer par la page qui a rendu la liste, et une liste côté client n'est
   * jamais une validation.
   *
   * Sans ce contrôle, un code de zone inexistant s'écrirait sans broncher, et
   * le calcul du plancher tomberait ensuite sur TOUTES les pièces à la fois —
   * loin d'ici, et sans rien qui désigne ce formulaire.
   */
  const zoneEntry = entries.find(
    (entry) => entry.key === 'floorShippingZoneCode',
  )
  if (zoneEntry) {
    const zone = await prisma.shippingZone.findUnique({
      where: { code: String(zoneEntry.value) },
      select: { id: true },
    })
    // Sans clé de champ : le message générique « la valeur de X n'est pas
    // acceptée » n'apprendrait rien ici, alors que le motif, lui, se dit en une
    // phrase — et dire quoi faire vaut mieux que désigner un champ.
    if (!zone) return ERROR('unknownZone')
  }

  // Les valeurs d'avant, pour la piste d'audit. Lues AVANT la transaction : une
  // modification de réglage de prix est exactement le geste qu'on veut pouvoir
  // reconstituer six mois plus tard, quand une commande paraît anormale.
  const before = await prisma.setting.findMany({
    where: { key: { in: entries.map((entry) => entry.key) } },
    select: { key: true, value: true },
  })
  const previousByKey = new Map(before.map((row) => [row.key, row.value]))

  const changedKeys = entries
    .filter(
      (entry) =>
        JSON.stringify(previousByKey.get(entry.key)) !==
        JSON.stringify(entry.value),
    )
    .map((entry) => entry.key)

  try {
    await prisma.$transaction(async (tx) => {
      const written = await writeSettings(entries, tx)

      // `writeSettings` revalide avec le schéma de LECTURE. Un refus ici n'est
      // pas un cas résiduel : `parseSettingInput` convertit, il ne contrôle ni
      // les bornes ni la cohérence d'un barème.
      if (!written.ok) {
        throw new SettingRejected(written.key, written.reason)
      }

      // Voir l'en-tête : conséquence, pas case à cocher.
      //
      // `upsert` pour la même raison que dans `writeSettings` : ce marqueur a
      // été ajouté APRÈS la mise en service, donc sa ligne n'existe pas dans
      // une base semée avant lui. Un `update` y levait P2025 et annulait tout
      // l'enregistrement — la boutique ne pouvait plus quitter le mode
      // démonstration par l'écran prévu pour ça.
      await tx.setting.upsert({
        where: { key: 'settingsProfile' },
        update: { value: 'production' },
        create: { key: 'settingsProfile', value: 'production' },
      })

      // Une entrée PAR réglage modifié, et rien pour ceux qu'on a réenvoyés
      // inchangés : une piste d'audit qui consigne chaque enregistrement du
      // formulaire, champs intacts compris, devient illisible au bout d'un mois.
      //
      // Aucune VALEUR n'est consignée — ni avant, ni après. Le nom du réglage,
      // l'auteur et l'instant suffisent à reconstituer « ce tarif a changé ce
      // jour-là » ; recopier les montants dupliquerait dans une table conservée
      // dix ans précisément ce qu'on vient de sortir du dépôt.
      for (const key of changedKeys) {
        await recordAudit(tx, {
          action: 'settings.updated',
          entity: 'Setting',
          entityId: key,
          actorId: admin.id,
        })
      }
    })
  } catch (error) {
    if (error instanceof SettingRejected) {
      return ERROR('invalidValue', error.key)
    }
    throw error
  }

  return { status: 'done', changed: changedKeys.length }
}

/** Sort de la transaction sans l'engager. Interne au module. */
class SettingRejected extends Error {
  constructor(
    readonly key: string,
    reason: string,
  ) {
    super(`Réglage refusé : ${key} (${reason})`)
    this.name = 'SettingRejected'
  }
}
