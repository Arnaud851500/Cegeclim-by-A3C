/**
 * Règle partagée "CDC liv < M-2" (2026-09-09).
 *
 * Remplace l'ancienne règle fixe "CDC < 2026" : un CDC est considéré en
 * retard de livraison dès que sa date de livraison est STRICTEMENT
 * antérieure au 1er jour du mois M-2 (M = mois courant). Au 09/09/2026 :
 * seuil = 2026-07-01, donc juin 2026 et tous les mois antérieurs sont en
 * retard ; juillet et août sont "à surveiller" (orange dans le tableau de
 * synthèse), septembre est courant.
 *
 * Utilisé par :
 *  - components/ClientRootShell.tsx  (pastille "Mes alertes", desktop)
 *  - app/portefeuille-livraison/page.tsx (couleurs synthèse, KPI, listes)
 *  - components/mobile/MobileAlertes.tsx + useMobileAlertsCount (mobile)
 *
 * Pour changer le décalage, ne modifier que CDC_RETARD_MOIS.
 */

export const CDC_RETARD_MOIS = 2

/** Libellé court affiché dans les pastilles / titres de tiroir. */
export const CDC_RETARD_LABEL = `CDC liv < M-${CDC_RETARD_MOIS}`

/** Ancien libellé, conservé pour la compatibilité (menus, matching). */
export const CDC_RETARD_LEGACY_LABEL = 'CDC < 2026'

const MOIS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

/** 1er jour du mois M-2 (gère le passage d'année automatiquement). */
export function getCdcRetardThresholdDate(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() - CDC_RETARD_MOIS, 1)
}

/** Seuil au format ISO 'YYYY-MM-01' (pour les filtres Supabase .lt()). */
export function getCdcRetardThresholdIso(now: Date = new Date()): string {
  const d = getCdcRetardThresholdDate(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** Seuil au format clé de mois 'YYYY-MM' (colonnes du tableau de synthèse). */
export function getCdcRetardThresholdMonthKey(now: Date = new Date()): string {
  return getCdcRetardThresholdIso(now).slice(0, 7)
}

/** Ex. "livraison avant juillet 2026" -- pour les sous-titres / infobulles. */
export function getCdcRetardDescription(now: Date = new Date()): string {
  const d = getCdcRetardThresholdDate(now)
  return `livraison avant ${MOIS_FR[d.getMonth()]} ${d.getFullYear()}`
}

/** Normalise une date (ISO, FR, Date) en 'YYYY-MM-DD' ; '' si illisible. */
export function normalizeDateIsoForRetard(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  }
  const text = String(value ?? '').trim()
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const fr = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
  return ''
}

/** true si la date de livraison est strictement avant le seuil M-2. */
export function isDateLivraisonEnRetard(value: unknown, now: Date = new Date()): boolean {
  const iso = normalizeDateIsoForRetard(value)
  if (!iso) return false
  return iso < getCdcRetardThresholdIso(now)
}

/** true si la clé de mois ('YYYY-MM' ou 'AVANT_2026') est avant le seuil M-2. */
export function isMoisLivraisonEnRetard(month: string | null | undefined, now: Date = new Date()): boolean {
  const key = String(month || '').trim()
  if (key === 'AVANT_2026') return true
  if (!/^\d{4}-\d{2}$/.test(key)) return false
  return key < getCdcRetardThresholdMonthKey(now)
}

/**
 * Règle complète pour un document / une ligne : CDC + (mois AVANT_2026 ou
 * date de livraison avant le seuil). Le fallback sur mois_livraison couvre
 * les pièces historiques sans date exploitable.
 */
export function isCdcEnRetard(
  row: { type_document?: string | null; date_livraison?: unknown; mois_livraison?: string | null },
  now: Date = new Date(),
): boolean {
  if (String(row.type_document || '').trim().toUpperCase() !== 'CDC') return false
  if (String(row.mois_livraison || '').trim() === 'AVANT_2026') return true
  return isDateLivraisonEnRetard(row.date_livraison, now)
}
