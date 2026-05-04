import { NextRequest, NextResponse } from 'next/server'
import Papa from 'papaparse'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const API_FULL_URL = 'https://data.ademe.fr/data-fair/api/v1/datasets/operateur-atteste-gf/full'
const UPSERT_CHUNK_SIZE = 1000

// Libellé ADEME cible pour l'attestation de capacité fluides frigorigènes.
const TARGET_SECTEUR = 'Froid et climatisation'

type AdemeCsvRow = Record<string, any>

type CapaciteCacheRow = {
  identifiant_ademe: string
  siret: string | null
  siren: string | null
  raison_sociale: string | null
  code_dept: string | null
  code_region: string | null
  code_postal: string | null
  ville: string | null
  secteur_activite: string | null
  numero_capacite: string | null
  type_capacite: string | null
  date_delivrance: string | null
  date_fin_validite: string | null
  imported_at: string
}

function normalizeIdentifier(value: unknown): { identifiant: string; siret: string | null; siren: string | null } | null {
  const digits = String(value ?? '').replace(/\D/g, '').trim()

  if (digits.length >= 14) {
    const siret = digits.slice(0, 14)
    return { identifiant: siret, siret, siren: siret.slice(0, 9) }
  }

  if (digits.length === 9) {
    return { identifiant: digits, siret: null, siren: digits }
  }

  return null
}

function stripInvalidUnicode(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeText(value: unknown): string | null {
  const text = stripInvalidUnicode(String(value ?? '').trim())
  return text || null
}

function normalizeComparable(value: unknown): string {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[’‘`´]/g, "'")
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function includesAllWords(text: string, candidate: string): boolean {
  const words = candidate.split(' ').filter((w) => w.length > 2)
  if (words.length === 0) return false
  return words.every((word) => text.includes(word))
}

function rowGet(row: AdemeCsvRow, candidates: string[]): string | null {
  const entries = Object.entries(row || {})
  const normalizedCandidates = candidates.map(normalizeComparable).filter(Boolean)

  // 1) correspondance directe sur le nom exact de colonne
  for (const candidate of candidates) {
    const direct = row?.[candidate]
    if (direct != null && String(direct).trim() !== '') return safeText(direct)
  }

  // 2) correspondance normalisée exacte
  for (const [key, value] of entries) {
    if (value == null || String(value).trim() === '') continue
    const normalizedKey = normalizeComparable(key)
    if (normalizedCandidates.includes(normalizedKey)) return safeText(value)
  }

  // 3) correspondance souple : utile quand ADEME change légèrement les libellés de colonnes
  for (const [key, value] of entries) {
    if (value == null || String(value).trim() === '') continue
    const normalizedKey = normalizeComparable(key)

    for (const candidate of normalizedCandidates) {
      if (!candidate) continue
      if (normalizedKey.includes(candidate) || includesAllWords(normalizedKey, candidate)) {
        return safeText(value)
      }
    }
  }

  return null
}

function isTargetSecteur(value: unknown): boolean {
  const normalized = normalizeComparable(value)
  return normalized === normalizeComparable(TARGET_SECTEUR) || (normalized.includes('froid') && normalized.includes('clim'))
}

function findTargetSecteur(row: AdemeCsvRow): string | null {
  const byHeader = rowGet(row, [
    "Secteur d'activité",
    "Secteur d’activite",
    "Secteur d’activités",
    'Secteur activite',
    'Secteur activité',
    'Secteur',
    'Activité',
    'Activite',
  ])

  if (isTargetSecteur(byHeader)) return byHeader

  // Sécurité : si le nom de colonne ADEME change, on cherche directement la valeur cible dans la ligne.
  for (const value of Object.values(row || {})) {
    if (isTargetSecteur(value)) return safeText(value)
  }

  return null
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2200) return false
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false

  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (!isValidDateParts(year, month, day)) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function normalizeDate(value: unknown): string | null {
  let raw = String(value ?? '').trim()
  if (!raw) return null

  // Nettoyage des guillemets, espaces insécables et éventuelles heures ajoutées au CSV.
  raw = raw
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Format ADEME déclaré dans la métadonnée du dataset : D/M/YYYY.
  // On accepte aussi un suffixe horaire éventuel : 7/4/2026 00:00:00.
  const ddMmYyyy = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:\s+.*)?$/)
  if (ddMmYyyy) {
    const day = Number(ddMmYyyy[1])
    const month = Number(ddMmYyyy[2])
    const year = Number(ddMmYyyy[3])
    return toIsoDate(year, month, day)
  }

  const yyyyMmDd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/)
  if (yyyyMmDd) {
    const year = Number(yyyyMmDd[1])
    const month = Number(yyyyMmDd[2])
    const day = Number(yyyyMmDd[3])
    return toIsoDate(year, month, day)
  }

  // Sécurité si le fichier était un jour exposé en date Excel numérique.
  if (/^\d{5}$/.test(raw)) {
    const excelSerial = Number(raw)
    const excelEpoch = Date.UTC(1899, 11, 30)
    const date = new Date(excelEpoch + excelSerial * 24 * 60 * 60 * 1000)
    return toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  }

  return null
}

function compareDate(a: string | null, b: string | null) {
  const av = a ? Date.parse(a) : 0
  const bv = b ? Date.parse(b) : 0
  return av - bv
}

function shouldReplaceExisting(existing: CapaciteCacheRow, next: CapaciteCacheRow): boolean {
  const finCompare = compareDate(existing.date_fin_validite, next.date_fin_validite)
  if (finCompare !== 0) return finCompare < 0

  const delivranceCompare = compareDate(existing.date_delivrance, next.date_delivrance)
  if (delivranceCompare !== 0) return delivranceCompare < 0

  return false
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

function countOccurrences(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length
}

function decodeScore(text: string): number {
  // Plus le score est élevé, plus le décodage est probablement correct.
  // U+FFFD indique presque toujours un mauvais décodage.
  const replacementChars = countOccurrences(text, /\uFFFD/g)
  // Séquences typiques d'un UTF-8 lu en Windows-1252 : Ã©, Ã¨, Â°, etc.
  const mojibakeChars = countOccurrences(text, /[ÃÂ]/g)
  return replacementChars * -1000 + mojibakeChars * -50 + Math.min(text.length, 1000)
}

function decodeAdemeBuffer(buffer: ArrayBuffer): { text: string; encoding: string } {
  const utf8Text = new TextDecoder('utf-8').decode(buffer)
  const win1252Text = new TextDecoder('windows-1252').decode(buffer)

  const utf8Score = decodeScore(utf8Text)
  const win1252Score = decodeScore(win1252Text)

  if (win1252Score > utf8Score) {
    return { text: win1252Text, encoding: 'windows-1252' }
  }

  return { text: utf8Text, encoding: 'utf-8' }
}

async function fetchFullCsv(): Promise<AdemeCsvRow[]> {
  const response = await fetch(API_FULL_URL, {
    method: 'GET',
    headers: {
      Accept: 'text/csv, text/plain, */*',
    },
    cache: 'no-store',
  })

  const buffer = await response.arrayBuffer()
  const decoded = decodeAdemeBuffer(buffer)
  const rawText = decoded.text

  console.log('[CAPACITE] décodage CSV retenu =', decoded.encoding)

  if (!response.ok) {
    throw new Error(`ADEME capacité HTTP ${response.status}: ${rawText.slice(0, 500)}`)
  }

  const parsed = Papa.parse<AdemeCsvRow>(rawText, {
    header: true,
    delimiter: ';',
    skipEmptyLines: true,
  })

  if (parsed.errors?.length) {
    const firstError = parsed.errors[0]
    throw new Error(`CSV ADEME capacité invalide ligne ${firstError.row ?? '?'} : ${firstError.message}`)
  }

  return parsed.data || []
}

function aggregateCapaciteRows(rows: AdemeCsvRow[], importedAt: string) {
  const byIdentifier = new Map<string, CapaciteCacheRow>()
  let nbTargetRows = 0
  let nbRejectedIdentifier = 0

  const firstRow = rows[0] || {}
  console.log('[CAPACITE] colonnes CSV détectées =', Object.keys(firstRow))

  let nbTargetRowsWithDateDelivrance = 0
  let nbTargetRowsWithDateFinValidite = 0
  let firstDateDebugLogged = false

  for (const row of rows) {
    const secteur = findTargetSecteur(row)
    if (!secteur) continue

    nbTargetRows += 1

    const identifier = normalizeIdentifier(rowGet(row, ['SIREN/SIRET', 'Siren/Siret', 'SIRET', 'SIREN', 'Identifiant']))
    if (!identifier) {
      nbRejectedIdentifier += 1
      continue
    }

    const rawDateDelivrance = rowGet(row, [
      'Date_de_délivrance',
      'Date de délivrance',
      'Date delivrance',
      'Date délivrance',
      'Délivrance',
      'Delivrance',
      'livrance',
    ])
    const rawDateFinValidite = rowGet(row, [
      'Date_de_fin_de_validité',
      'Date de fin de validité',
      'Date fin validité',
      'Date fin validite',
      'Fin de validité',
      'Fin validite',
      'Validité',
      'Validite',
      'validit',
      'Date expiration',
    ])
    const dateDelivrance = normalizeDate(rawDateDelivrance)
    const dateFinValidite = normalizeDate(rawDateFinValidite)

    if (dateDelivrance) nbTargetRowsWithDateDelivrance += 1
    if (dateFinValidite) nbTargetRowsWithDateFinValidite += 1

    if (!firstDateDebugLogged) {
      console.log('[CAPACITE] exemple dates brutes =', { rawDateDelivrance, rawDateFinValidite, dateDelivrance, dateFinValidite })
      firstDateDebugLogged = true
    }

    const cacheRow: CapaciteCacheRow = {
      identifiant_ademe: identifier.identifiant,
      siret: identifier.siret,
      siren: identifier.siren,
      raison_sociale: rowGet(row, ['Raison sociale', 'Raison Sociale', 'Nom', 'Entreprise']),
      code_dept: rowGet(row, ['Code Dept', 'Code département', 'Code departement', 'Departement', 'Département']),
      code_region: rowGet(row, ['Code Région', 'Code Region', 'Région', 'Region']),
      code_postal: rowGet(row, ['Code postal', 'Code Postal', 'CP']),
      ville: rowGet(row, ['Ville', 'Commune']),
      secteur_activite: secteur || TARGET_SECTEUR,
      numero_capacite: rowGet(row, [
        'Attestation ou certificat',
        'Attestation',
        'Certificat',
        'N° attestation',
        'N° de capacité',
        'Numero attestation',
        'Numero capacite',
        'Numéro capacité',
      ]),
      type_capacite:
        rowGet(row, [
          "Catégorie d'attestation",
          "Catégorie d’attestation",
          "Categorie d'attestation",
          'Catégorie',
          'Categorie',
          'Type de capacité',
          'Type capacite',
        ]) || secteur || TARGET_SECTEUR,
      date_delivrance: dateDelivrance,
      date_fin_validite: dateFinValidite,
      imported_at: importedAt,
    }

    const existing = byIdentifier.get(identifier.identifiant)
    if (!existing || shouldReplaceExisting(existing, cacheRow)) {
      byIdentifier.set(identifier.identifiant, cacheRow)
    }
  }

  return {
    rows: Array.from(byIdentifier.values()),
    nbTargetRows,
    nbRejectedIdentifier,
    nbTargetRowsWithDateDelivrance,
    nbTargetRowsWithDateFinValidite,
  }
}

async function replaceCapaciteCache(rows: CapaciteCacheRow[]) {
  await supabaseAdmin.from('capacite_gaz_cache').delete().neq('identifiant_ademe', '')

  for (const chunk of chunkArray(rows, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabaseAdmin.from('capacite_gaz_cache').upsert(chunk, {
      onConflict: 'identifiant_ademe',
    })

    if (error) {
      throw new Error(`Erreur upsert capacite_gaz_cache: ${error.message}`)
    }
  }
}

async function updateClientsWithSql() {
  const resetSql = `
    update clients
    set
      capacite_gaz = false,
      capacite_gaz_numero = null,
      capacite_gaz_type = null,
      capacite_gaz_date_delivrance = null,
      capacite_gaz_date_fin_validite = null,
      capacite_gaz_last_check_at = now();
  `

  const updateSiretSql = `
    update clients c
    set
      capacite_gaz = true,
      capacite_gaz_numero = cc.numero_capacite,
      capacite_gaz_type = cc.type_capacite,
      capacite_gaz_date_delivrance = cc.date_delivrance,
      capacite_gaz_date_fin_validite = cc.date_fin_validite,
      capacite_gaz_last_check_at = now()
    from capacite_gaz_cache cc
    where cc.siret is not null
      and cc.siret = c.siret;
  `

  const updateSirenSql = `
    update clients c
    set
      capacite_gaz = true,
      capacite_gaz_numero = cc.numero_capacite,
      capacite_gaz_type = cc.type_capacite,
      capacite_gaz_date_delivrance = cc.date_delivrance,
      capacite_gaz_date_fin_validite = cc.date_fin_validite,
      capacite_gaz_last_check_at = now()
    from capacite_gaz_cache cc
    where cc.siret is null
      and cc.siren is not null
      and cc.siren = coalesce(nullif(c.siren, ''), substring(c.siret from 1 for 9));
  `

  for (const sql_query of [resetSql, updateSiretSql, updateSirenSql]) {
    const { error } = await supabaseAdmin.rpc('exec_sql', { sql_query })
    if (error) throw error
  }
}

async function updateClientsFallback() {
  const { data: cacheRows, error: cacheError } = await supabaseAdmin
    .from('capacite_gaz_cache')
    .select('siret, siren, numero_capacite, type_capacite, date_delivrance, date_fin_validite')

  if (cacheError) throw new Error(`Lecture capacite_gaz_cache impossible: ${cacheError.message}`)

  const bySiret = new Map<string, any>()
  const bySiren = new Map<string, any>()

  for (const row of cacheRows || []) {
    if (row.siret) bySiret.set(row.siret, row)
    else if (row.siren) bySiren.set(row.siren, row)
  }

  const { data: clients, error: clientsError } = await supabaseAdmin.from('clients').select('siret, siren')
  if (clientsError) throw new Error(`Lecture clients impossible: ${clientsError.message}`)

  const now = new Date().toISOString()
  const updates = (clients || [])
    .filter((client) => client.siret)
    .map((client) => {
      const siret = String(client.siret)
      const siren = String(client.siren || siret.slice(0, 9))
      const found = bySiret.get(siret) || bySiren.get(siren) || null

      return {
        siret,
        capacite_gaz: Boolean(found),
        capacite_gaz_numero: found?.numero_capacite ?? null,
        capacite_gaz_type: found?.type_capacite ?? null,
        capacite_gaz_date_delivrance: found?.date_delivrance ?? null,
        capacite_gaz_date_fin_validite: found?.date_fin_validite ?? null,
        capacite_gaz_last_check_at: now,
      }
    })

  for (const chunk of chunkArray(updates, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabaseAdmin.from('clients').upsert(chunk, { onConflict: 'siret' })
    if (error) throw new Error(`Erreur update clients fallback capacité: ${error.message}`)
  }
}

async function updateClientsFromCache() {
  try {
    await updateClientsWithSql()
  } catch (error: any) {
    console.warn('[CAPACITE] update SQL direct indisponible, fallback JS:', error?.message || error)
    await updateClientsFallback()
  }

  const { count, error } = await supabaseAdmin
    .from('clients')
    .select('*', { count: 'exact', head: true })
    .eq('capacite_gaz', true)

  if (error) {
    console.warn('[CAPACITE] count clients capacité non lu:', error.message)
    return null
  }

  return count ?? 0
}

async function insertImportLog(params: {
  nb_rows_source: number
  nb_rows_target: number
  nb_rows_imported: number
  nb_rows_updated: number | null
  nb_rejected_identifier: number
  status: string
  error_message?: string | null
}) {
  const { error } = await supabaseAdmin.from('capacite_gaz_import_logs').insert({
    source_file_name: 'ADEME_OPERATEUR_ATTESTE_GF_FULL',
    nb_rows_source: params.nb_rows_source,
    nb_rows_target: params.nb_rows_target,
    nb_rows_imported: params.nb_rows_imported,
    nb_rows_updated: params.nb_rows_updated,
    nb_rejected_identifier: params.nb_rejected_identifier,
    status: params.status,
    error_message: params.error_message ?? null,
  })

  if (error) {
    console.warn('[CAPACITE] log import non inséré:', error.message)
  }
}

export async function POST(_req: NextRequest) {
  const importedAt = new Date().toISOString()

  try {
    console.log('[CAPACITE] Début rafraîchissement ADEME capacité froid/clim')

    const sourceRows = await fetchFullCsv()
    const aggregated = aggregateCapaciteRows(sourceRows, importedAt)

    console.log(
      `[CAPACITE] source=${sourceRows.length}, cible=${aggregated.nbTargetRows}, agrégé=${aggregated.rows.length}, avec_date_delivrance=${aggregated.nbTargetRowsWithDateDelivrance}, avec_date_fin=${aggregated.nbTargetRowsWithDateFinValidite}`
    )

    if (aggregated.nbTargetRows === 0) {
      console.warn('[CAPACITE] Aucune ligne Froid et climatisation détectée. Vérifier les colonnes CSV affichées dans le log précédent.')
    }

    await replaceCapaciteCache(aggregated.rows)
    const nbClientsUpdated = await updateClientsFromCache()

    await insertImportLog({
      nb_rows_source: sourceRows.length,
      nb_rows_target: aggregated.nbTargetRows,
      nb_rows_imported: aggregated.rows.length,
      nb_rows_updated: nbClientsUpdated,
      nb_rejected_identifier: aggregated.nbRejectedIdentifier,
      status: 'ok',
    })

    return NextResponse.json({
      success: true,
      source: 'ADEME_OPERATEUR_ATTESTE_GF_FULL',
      secteur: TARGET_SECTEUR,
      nb_rows_source: sourceRows.length,
      nb_rows_target: aggregated.nbTargetRows,
      nb_rows_imported: aggregated.rows.length,
      nb_rows_updated: nbClientsUpdated,
      nb_rejected_identifier: aggregated.nbRejectedIdentifier,
      nb_target_rows_with_date_delivrance: aggregated.nbTargetRowsWithDateDelivrance,
      nb_target_rows_with_date_fin_validite: aggregated.nbTargetRowsWithDateFinValidite,
      imported_at: importedAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue'
    console.error('[CAPACITE] Erreur refresh:', message)

    await insertImportLog({
      nb_rows_source: 0,
      nb_rows_target: 0,
      nb_rows_imported: 0,
      nb_rows_updated: 0,
      nb_rejected_identifier: 0,
      status: 'erreur',
      error_message: message,
    })

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    )
  }
}
