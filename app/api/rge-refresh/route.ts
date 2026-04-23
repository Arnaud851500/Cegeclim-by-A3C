import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const API_BASE_URL =
  'https://data.ademe.fr/data-fair/api/v1/datasets/liste-des-entreprises-rge-2/lines'
const PAGE_SIZE = 10000
const UPSERT_CHUNK_SIZE = 1000

type RgeApiLine = Record<string, any>

type RgeApiResponse = {
  results?: RgeApiLine[]
  data?: RgeApiLine[]
  items?: RgeApiLine[]
  next?: string | number | null
}

type CacheRow = {
  siret: string
  siren: string | null
  raison_sociale: string | null
  code_postal: string | null
  commune: string | null
  statut_rge: boolean
  domaines_travaux: string | null
  source_file_name: string
  imported_at: string
}

function normalizeSiret(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').trim()
}

function stripInvalidUnicode(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeText(value: unknown): string {
  return stripInvalidUnicode(String(value ?? '').trim())
}

function normalizeText(value: unknown): string {
  return safeText(value)
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((v) => safeText(v ?? ''))
        .filter(Boolean)
    )
  )
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

function getStringCandidate(row: RgeApiLine, keys: string[]): string | null {
  for (const key of keys) {
    const value = row?.[key]
    if (value != null && String(value).trim() !== '') {
      return safeText(value)
    }
  }
  return null
}

function extractDomaines(record: RgeApiLine): string[] {
  return uniqueStrings([
    normalizeText(record['nom_qualification']),
    normalizeText(record['nom_certificat']),
    normalizeText(record['domaine']),
    normalizeText(record['meta_domaine']),
    normalizeText(record['organisme']),
  ])
}

function buildInitialUrl() {
  const url = new URL(API_BASE_URL)
  url.searchParams.set('size', String(PAGE_SIZE))
  url.searchParams.set('sort', 'siret')
  url.searchParams.set(
    'select',
    'siret,nom_entreprise,code_postal,commune,nom_qualification,nom_certificat,domaine,meta_domaine,organisme'
  )
  return url.toString()
}

function buildNextUrl(next: string | number | null): string | null {
  if (next == null) return null

  const nextValue = String(next).trim()
  if (!nextValue) return null

  if (nextValue.startsWith('http://') || nextValue.startsWith('https://')) {
    return nextValue
  }

  if (nextValue.startsWith('/')) {
    return new URL(nextValue, 'https://data.ademe.fr').toString()
  }

  const url = new URL(API_BASE_URL)
  url.searchParams.set('size', String(PAGE_SIZE))
  url.searchParams.set('sort', 'siret')
  url.searchParams.set(
    'select',
    'siret,nom_entreprise,code_postal,commune,nom_qualification,nom_certificat,domaine,meta_domaine,organisme'
  )
  url.searchParams.set('after', nextValue)
  return url.toString()
}

async function fetchRgeBatch(urlToCall: string): Promise<{
  rows: RgeApiLine[]
  next: string | number | null
}> {
  console.log('[RGE] batch URL =', urlToCall)

  const response = await fetch(urlToCall, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
  })

  const rawText = await response.text()

  if (!response.ok) {
    throw new Error(`RGE API HTTP ${response.status}: ${rawText}`)
  }

  let payload: RgeApiResponse
  try {
    payload = JSON.parse(rawText) as RgeApiResponse
  } catch {
    throw new Error(`RGE API JSON invalide: ${rawText}`)
  }

  const rows = Array.isArray(payload?.results)
    ? payload.results
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.items)
        ? payload.items
        : []

  return {
    rows,
    next: payload?.next ?? null,
  }
}

async function fetchAllRgeRows() {
  const allRows: RgeApiLine[] = []
  let nextUrl: string | null = buildInitialUrl()
  let batchIndex = 1
  let safety = 0

  while (nextUrl) {
    const { rows, next } = await fetchRgeBatch(nextUrl)
    allRows.push(...rows)

    const computedNextUrl = buildNextUrl(next)

    console.log(
      `[RGE] batch ${batchIndex} => ${rows.length} lignes, next=${String(next)}`
    )

    if (!computedNextUrl || rows.length === 0) {
      break
    }

    nextUrl = computedNextUrl
    batchIndex += 1
    safety += 1

    if (safety > 500) {
      throw new Error('Boucle pagination RGE interrompue par sécurité')
    }
  }

  return allRows
}

function aggregateRows(rows: RgeApiLine[], importedAt: string): CacheRow[] {
  const bySiret = new Map<string, CacheRow>()

  for (const row of rows) {
    const siret = normalizeSiret(row?.siret)
    if (!siret || siret.length !== 14) continue

    const siren = siret.slice(0, 9)
    const raisonSociale = getStringCandidate(row, ['nom_entreprise'])
    const codePostal = getStringCandidate(row, ['code_postal'])
    const commune = getStringCandidate(row, ['commune'])
    const domaines = extractDomaines(row)

    const existing = bySiret.get(siret)

    if (!existing) {
      bySiret.set(siret, {
        siret,
        siren,
        raison_sociale: raisonSociale ? safeText(raisonSociale) : null,
        code_postal: codePostal ? safeText(codePostal) : null,
        commune: commune ? safeText(commune) : null,
        statut_rge: true,
        domaines_travaux: domaines.length > 0 ? safeText(domaines.join(' | ')) : null,
        source_file_name: 'ADEME_RGE_API',
        imported_at: importedAt,
      })
      continue
    }

    existing.raison_sociale =
      existing.raison_sociale || (raisonSociale ? safeText(raisonSociale) : null)
    existing.code_postal =
      existing.code_postal || (codePostal ? safeText(codePostal) : null)
    existing.commune =
      existing.commune || (commune ? safeText(commune) : null)

    const merged = uniqueStrings([
      ...(existing.domaines_travaux ? existing.domaines_travaux.split(' | ') : []),
      ...domaines,
    ])

    existing.domaines_travaux = merged.length > 0 ? safeText(merged.join(' | ')) : null
  }

  return Array.from(bySiret.values())
}

async function replaceRgeCache(rows: CacheRow[]) {
  await supabaseAdmin.from('rge_cache').delete().neq('siret', '')

  const chunks = chunkArray(rows, UPSERT_CHUNK_SIZE)

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]

    const { error } = await supabaseAdmin.from('rge_cache').upsert(chunk, {
      onConflict: 'siret',
    })

    if (error) {
      console.error(`[RGE] Erreur chunk ${i + 1}/${chunks.length}`)
      console.error('[RGE] Exemple ligne chunk =', chunk[0])
      throw new Error(`Erreur upsert rge_cache (chunk ${i + 1}): ${error.message}`)
    }
  }
}

async function updateClientsFromCache() {
  const { error: matchError } = await supabaseAdmin.rpc('exec_sql', {
    sql_query: `
      update clients c
      set
        rge = rc.statut_rge,
        rge_domaines_travaux = rc.domaines_travaux,
        rge_last_check_at = now()
      from rge_cache rc
      where rc.siret = c.siret;
    `,
  })

  if (matchError) {
    console.warn('[RGE] update SQL direct indisponible:', matchError.message)

    const { data: cacheRows, error: cacheError } = await supabaseAdmin
      .from('rge_cache')
      .select('siret, statut_rge, domaines_travaux')

    if (cacheError) {
      throw new Error(`Lecture rge_cache impossible: ${cacheError.message}`)
    }

    const cacheMap = new Map(
      (cacheRows || []).map((row) => [
        row.siret,
        {
          rge: row.statut_rge,
          rge_domaines_travaux: row.domaines_travaux,
        },
      ])
    )

    const { data: clients, error: clientsError } = await supabaseAdmin
      .from('clients')
      .select('siret')

    if (clientsError) {
      throw new Error(`Lecture clients impossible: ${clientsError.message}`)
    }

    for (const chunk of chunkArray(clients || [], UPSERT_CHUNK_SIZE)) {
      const updates = chunk.map((client) => {
        const found = cacheMap.get(client.siret)
        return {
          siret: client.siret,
          rge: found ? found.rge : false,
          rge_domaines_travaux: found ? found.rge_domaines_travaux : null,
          rge_last_check_at: new Date().toISOString(),
        }
      })

      const { error: upErr } = await supabaseAdmin.from('clients').upsert(updates, {
        onConflict: 'siret',
      })

      if (upErr) {
        throw new Error(`Erreur update clients fallback: ${upErr.message}`)
      }
    }

    return
  }

  const { error: resetError } = await supabaseAdmin.rpc('exec_sql', {
    sql_query: `
      update clients c
      set
        rge = false,
        rge_domaines_travaux = null,
        rge_last_check_at = now()
      where not exists (
        select 1
        from rge_cache rc
        where rc.siret = c.siret
      );
    `,
  })

  if (resetError) {
    console.warn('[RGE] reset clients non trouvés non exécuté:', resetError.message)
  }
}

async function insertImportLog(params: {
  source_file_name: string
  nb_rows_source: number
  nb_rows_imported: number
  nb_rows_updated: number
  status: string
  error_message?: string | null
}) {
  const { error } = await supabaseAdmin.from('rge_import_logs').insert({
    source_file_name: params.source_file_name,
    nb_rows_source: params.nb_rows_source,
    nb_rows_imported: params.nb_rows_imported,
    nb_rows_updated: params.nb_rows_updated,
    status: params.status,
    error_message: params.error_message ?? null,
  })

  if (error) {
    console.warn('[RGE] log import non inséré:', error.message)
  }
}

export async function POST(_req: NextRequest) {
  const importedAt = new Date().toISOString()

  try {
    console.log('[RGE] Début rafraîchissement référentiel')

    const rows = await fetchAllRgeRows()
    const aggregated = aggregateRows(rows, importedAt)

    console.log(`[RGE] total source = ${rows.length}`)
    console.log(`[RGE] total agrégé siret = ${aggregated.length}`)

    await replaceRgeCache(aggregated)
    await updateClientsFromCache()

    await insertImportLog({
      source_file_name: 'ADEME_RGE_API',
      nb_rows_source: rows.length,
      nb_rows_imported: aggregated.length,
      nb_rows_updated: aggregated.length,
      status: 'ok',
    })

    return NextResponse.json({
      success: true,
      source: 'ADEME_RGE_API',
      nb_rows_source: rows.length,
      nb_rows_imported: aggregated.length,
      nb_rows_updated: aggregated.length,
      imported_at: importedAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue'

    console.error('[RGE] Erreur refresh:', message)

    await insertImportLog({
      source_file_name: 'ADEME_RGE_API',
      nb_rows_source: 0,
      nb_rows_imported: 0,
      nb_rows_updated: 0,
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