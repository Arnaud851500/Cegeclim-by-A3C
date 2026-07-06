import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const INSEE_SIRENE_URL = 'https://api.insee.fr/api-sirene/3.11/siret'
const DB_CHUNK_SIZE = 500
const REJECTS_CHUNK_SIZE = 500

// L'API INSEE retourne actuellement 429 au-delà de 30 requêtes / minute.
// 2300 ms ≈ 26 requêtes / minute, avec une marge de sécurité.
const SIRENE_MIN_DELAY_MS = Number(process.env.SIRENE_MIN_DELAY_MS || '2300')
const SIRENE_MAX_RETRIES = Number(process.env.SIRENE_MAX_RETRIES || '5')
const SIRENE_429_FALLBACK_WAIT_MS = Number(process.env.SIRENE_429_FALLBACK_WAIT_MS || '65000')

// Pour éviter les timeouts Vercel, un appel à cette route ne traite que quelques pages.
// Le worker rappelle la même étape tant que la réponse contient partial=true.
const SIRENE_MAX_PAGES_PER_INVOCATION = Number(process.env.SIRENE_MAX_PAGES_PER_INVOCATION || '4')
const SIRENE_MAX_RUNTIME_MS = Number(process.env.SIRENE_MAX_RUNTIME_MS || '220000')

// Quand une journée dépasse la limite API INSEE des 10 000 résultats paginables,
// on découpe la requête par plage de SIREN.
const SIRENE_API_MAX_OFFSET = 10000
const SIREN_MIN = 0
const SIREN_MAX = 999999999
const SIREN_BUCKET_SIZE = Math.max(1, Number(process.env.SIRENE_SIREN_BUCKET_SIZE || '10000000'))

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type ImportMode = 'creation' | 'cessation'

type SireneFetchResult = {
  etablissements: any[]
  total: number
  debut: number
  nombre: number
}

type SireneCursor = {
  id: string
  run_id: string
  mode: ImportMode
  date_field: string
  min_date: string
  max_date: string
  cursor_date: string
  cursor_siren_min: string | null
  cursor_siren_max: string | null
  cursor_debut: number
  status: string
  total_fetched: number
  total_available: number
  last_error: string | null
}

type CollectedRows = {
  minDate: string
  maxDate: string
  allRows: any[]
  uniqueSirets: number
  totalFetched: number
  totalAvailable: number
  pageCount: number
  dailyBatchCount: number
  queryUnitCount: number
  splitByApe: boolean
  splitBySiren: boolean
  partial: boolean
  done: boolean
  stoppedBecauseOfRuntime: boolean
  stoppedBecauseOfPageLimit: boolean
  cursor?: SireneCursor | null
  cursorTotalFetched?: number
  cursorTotalAvailable?: number
  queryChunks: any[]
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let lastSireneRequestAt = 0

async function waitBeforeSireneRequest() {
  const now = Date.now()
  const elapsed = now - lastSireneRequestAt

  if (elapsed > 0 && elapsed < SIRENE_MIN_DELAY_MS) {
    await sleep(SIRENE_MIN_DELAY_MS - elapsed)
  }

  lastSireneRequestAt = Date.now()
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000) + 1000
  }

  const dateValue = new Date(value)
  if (!Number.isNaN(dateValue.getTime())) {
    return Math.max(0, dateValue.getTime() - Date.now()) + 1000
  }

  return null
}

function normalizeArray(value: any): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => String(v || '').trim()).filter(Boolean)
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return String(value).trim()
    }
  }
  return null
}

function parseLambert(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function normalizeApe(code: string | null | undefined) {
  return String(code || '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .toUpperCase()
}

function normalizeSiret(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').trim()
}

function padSiren(value: number | string | null | undefined) {
  const n = Number(value ?? 0)
  const safe = Math.max(SIREN_MIN, Math.min(SIREN_MAX, Number.isFinite(n) ? n : 0))
  return String(Math.trunc(safe)).padStart(9, '0')
}

function translateNaf(activitePrincipaleEtablissement: string | null) {
  const code = normalizeApe(activitePrincipaleEtablissement)
  if (!code) return 'AUTRES'
  if (code.startsWith('4322B')) return 'Installateur CVC'
  if (code.startsWith('4322A')) return 'Plomberie'
  if (code.startsWith('4321')) return 'Electricité ENR'
  if (code.startsWith('4120')) return 'CMI'
  if (code.startsWith('4399')) return 'Bâtiment'
  if (code.startsWith('2825Z')) return 'Equip Frigo Indu.'
  if (code.startsWith('3320B')) return 'Instal Machine Indu.'
  if (code.startsWith('3312Z')) return 'Repa Machine Indu.'
  if (code.startsWith('4329A')) return 'Travaux isolat.'
  return 'AUTRES'
}

function buildAdresseComplete(adresse: any) {
  return (
    [
      adresse.numeroVoieEtablissement,
      adresse.typeVoieEtablissement,
      adresse.libelleVoieEtablissement,
      adresse.complementAdresseEtablissement,
      adresse.codePostalEtablissement,
      adresse.libelleCommuneEtablissement,
    ]
      .filter(Boolean)
      .join(' ')
      .trim() || null
  )
}

function getDepartmentFromPostalCode(codePostal: string | null) {
  if (!codePostal) return null
  if (codePostal.startsWith('97') || codePostal.startsWith('98')) return codePostal.slice(0, 3)
  return codePostal.slice(0, 2)
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function toYmd(date: Date | string) {
  return new Date(date).toISOString().slice(0, 10)
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function buildDailyRanges(minDate: string, maxDate: string) {
  const ranges: Array<{ min: string; max: string }> = []
  const safeMinDate = minDate === '*' ? toYmd(new Date()) : minDate
  const safeMaxDate = !maxDate || maxDate === '*' ? toYmd(new Date()) : maxDate

  let current = new Date(`${safeMinDate}T00:00:00.000Z`)
  const end = new Date(`${safeMaxDate}T00:00:00.000Z`)

  while (current <= end) {
    const ymd = toYmd(current)
    ranges.push({ min: ymd, max: ymd })
    current = addDays(current, 1)
  }

  return ranges
}

function buildDateConfig(params: any, mode: ImportMode) {
  if (mode === 'cessation') {
    const minDate = params.date_modification_min || params.date_creation_min || toYmd(new Date())
    const maxDate = params.date_modification_max || params.date_creation_max || toYmd(new Date())

    return {
      minDate,
      maxDate,
      dateField: 'dateDernierTraitementEtablissement',
    }
  }

  return {
    minDate: params.date_creation_min || '*',
    maxDate: params.date_creation_max || toYmd(new Date()),
    dateField: 'dateCreationEtablissement',
  }
}

function buildSireneDateRange(dateField: string, minDate: string, maxDate: string, mode: ImportMode) {
  // Pour les cessations, dateDernierTraitementEtablissement est une date/heure.
  // Il faut donc couvrir toute la journée.
  if (mode === 'cessation' && dateField === 'dateDernierTraitementEtablissement') {
    return `${dateField}:[${minDate}T00:00:00 TO ${maxDate}T23:59:59]`
  }

  return `${dateField}:[${minDate} TO ${maxDate}]`
}

function buildQueryFromDates(
  minDate: string,
  maxDate: string,
  mode: ImportMode,
  dateField: string
) {
  const dateClause = buildSireneDateRange(dateField, minDate, maxDate, mode)

  if (mode === 'cessation') {
    // Important : on ne filtre PAS par APE dans la requête SIRENE pour les cessations.
    // Les champs APE sont historisés et peuvent changer avec la période de fermeture.
    // On récupère donc les établissements fermés du jour, puis on filtre les APE côté route.
    return `periode(etatAdministratifEtablissement:F) AND ${dateClause}`
  }

  return dateClause
}

function withSirenRange(baseQuery: string, sirenMin: string | null, sirenMax: string | null) {
  if (!sirenMin || !sirenMax) return baseQuery
  return `(${baseQuery}) AND siren:[${sirenMin} TO ${sirenMax}]`
}

function filterRowsByDepartments(etablissements: any[], params: any) {
  const departments = new Set(normalizeArray(params.departements))

  if (departments.size === 0) return etablissements

  return etablissements.filter((e: any) => {
    const adresse = e.adresseEtablissement || {}
    const codePostal = adresse.codePostalEtablissement || null
    const dep = getDepartmentFromPostalCode(codePostal)
    return dep && departments.has(dep)
  })
}

async function fetchSirenePage(apiKey: string, q: string, debut = 0): Promise<SireneFetchResult> {
  for (let attempt = 1; attempt <= SIRENE_MAX_RETRIES; attempt += 1) {
    await waitBeforeSireneRequest()

    const body = new URLSearchParams()
    body.set('q', q)
    body.set('nombre', '1000')
    body.set('debut', String(debut))

    const res = await fetch(INSEE_SIRENE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-INSEE-Api-Key-Integration': apiKey,
      },
      body: body.toString(),
      cache: 'no-store',
    })

    const text = await res.text()

    if (res.status === 404) {
      return {
        etablissements: [],
        total: 0,
        debut,
        nombre: 0,
      }
    }

    if (res.status === 429) {
      const waitMs = retryAfterMs(res.headers.get('retry-after')) ?? SIRENE_429_FALLBACK_WAIT_MS
      console.warn('SIRENE RATE LIMIT 429', {
        attempt,
        maxRetries: SIRENE_MAX_RETRIES,
        waitMs,
        debut,
        q,
      })

      if (attempt >= SIRENE_MAX_RETRIES) {
        throw new Error(
          `Rate limit SIRENE persistant après ${SIRENE_MAX_RETRIES} tentatives. ` +
            `Dernière réponse: ${text}`
        )
      }

      await sleep(waitMs)
      continue
    }

    if (!res.ok) {
      throw new Error(`Erreur SIRENE: ${text}`)
    }

    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`Réponse SIRENE non JSON: ${text}`)
    }

    return {
      etablissements: Array.isArray(data?.etablissements) ? data.etablissements : [],
      total: Number(data?.header?.total ?? 0),
      debut: Number(data?.header?.debut ?? debut),
      nombre: Number(data?.header?.nombre ?? 0),
    }
  }

  throw new Error('Erreur SIRENE inattendue : boucle de retry terminée sans réponse')
}

function extractApeFinal(e: any) {
  const uniteLegale = e.uniteLegale || {}
  return firstNonEmpty(
    e.activitePrincipaleEtablissement,
    e.periodesEtablissement?.[0]?.activitePrincipaleEtablissement,
    uniteLegale.activitePrincipaleUniteLegale
  )
}

function mapSireneRowToClient(e: any) {
  const adresse = e.adresseEtablissement || {}
  const uniteLegale = e.uniteLegale || {}

  const raisonSociale =
    firstNonEmpty(
      uniteLegale.denominationUniteLegale,
      e.denominationUsuelleEtablissement,
      [uniteLegale.nomUniteLegale, uniteLegale.prenom1UniteLegale].filter(Boolean).join(' ')
    ) || null

  const codePostal = firstNonEmpty(adresse.codePostalEtablissement)
  const departement = getDepartmentFromPostalCode(codePostal)
  const apeFinal = extractApeFinal(e)

  const nomDirigeant = firstNonEmpty(
    [uniteLegale.prenom1UniteLegale, uniteLegale.nomUniteLegale].filter(Boolean).join(' ')
  )

  return {
    siret: firstNonEmpty(e.siret),
    raison_sociale_affichee: raisonSociale,
    activitePrincipaleEtablissement: apeFinal,
    naf_libelle_traduit: apeFinal ? translateNaf(apeFinal) : null,
    dateCreationEtablissement: firstNonEmpty(e.dateCreationEtablissement),
    codePostalEtablissement: codePostal,
    libelleCommuneEtablissement: firstNonEmpty(adresse.libelleCommuneEtablissement),
    departement,
    adresse_complete: buildAdresseComplete(adresse),
    coordonneeLambertAbscisseEtablissement: parseLambert(adresse.coordonneeLambertAbscisseEtablissement),
    coordonneeLambertOrdonneeEtablissement: parseLambert(adresse.coordonneeLambertOrdonneeEtablissement),
    trancheEffectifsEtablissement: firstNonEmpty(e.trancheEffectifsEtablissement),
    nom_dirigeant: nomDirigeant,
    contactable: false,
    enrichment_status: 'a_faire',
    date_import: new Date().toISOString(),
    source_import: 'api_sirene',
    telephone: null,
    email: null,
    site_web: null,
    effectif_estime: null,
    ca_estime: null,
    pappers_ca: null,
    pappers_resultat: null,
    rge: null,
    potentiel_score: null,
    enrichment_source: 'api_sirene',
    enrichment_error: null,
    google_maps_url: null,
    google_rating: null,
    google_user_ratings_total: null,
    present_dans_cegeclim: null,
    prospect_status: null,
    assigned_to: null,
    last_contact_at: null,
    next_action_at: null,
    next_action_label: null,
    prospect_comment: null,
  }
}

function getCessationDate(e: any) {
  const periodes = Array.isArray(e.periodesEtablissement) ? e.periodesEtablissement : []

  const closedPeriods = periodes.filter(
    (p: any) => String(p?.etatAdministratifEtablissement || '').toUpperCase() === 'F'
  )

  // On privilégie la période fermée courante quand dateFin est vide,
  // puis la période fermée la plus récente.
  const currentClosedPeriod =
    closedPeriods.find((p: any) => !p?.dateFin) ||
    closedPeriods.sort((a: any, b: any) =>
      String(b?.dateDebut || '').localeCompare(String(a?.dateDebut || ''))
    )[0]

  return firstNonEmpty(
    currentClosedPeriod?.dateDebut,
    e.dateDernierTraitementEtablissement,
    e.dateMiseAJourInsee,
    e.dateCreationEtablissement
  )
}

function nextSirenRangeFrom(start: number) {
  const safeStart = Math.max(SIREN_MIN, Math.min(SIREN_MAX, start))
  const safeEnd = Math.min(SIREN_MAX, safeStart + SIREN_BUCKET_SIZE - 1)

  return {
    min: padSiren(safeStart),
    max: padSiren(safeEnd),
  }
}

function dateIsAfterMax(date: string, maxDate: string) {
  return new Date(`${date}T00:00:00.000Z`) > new Date(`${maxDate}T00:00:00.000Z`)
}

function nextDay(date: string) {
  return toYmd(addDays(new Date(`${date}T00:00:00.000Z`), 1))
}

async function getOrCreateCursor(runId: string, mode: ImportMode, minDate: string, maxDate: string, dateField: string) {
  const { data: existing, error: existingError } = await supabase
    .from('sirene_import_cursors')
    .select('*')
    .eq('run_id', runId)
    .eq('mode', mode)
    .in('status', ['running', 'done'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing) return existing as SireneCursor

  const { data: inserted, error: insertError } = await supabase
    .from('sirene_import_cursors')
    .insert({
      run_id: runId,
      mode,
      date_field: dateField,
      min_date: minDate,
      max_date: maxDate,
      cursor_date: minDate,
      cursor_siren_min: null,
      cursor_siren_max: null,
      cursor_debut: 0,
      status: 'running',
    })
    .select('*')
    .single()

  if (insertError) throw insertError
  return inserted as SireneCursor
}

async function updateCursor(cursorId: string, patch: Record<string, any>) {
  const { data, error } = await supabase
    .from('sirene_import_cursors')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', cursorId)
    .select('*')
    .single()

  if (error) throw error
  return data as SireneCursor
}

async function advanceCursorAfterCompletedUnit(cursor: SireneCursor) {
  const currentMax = cursor.cursor_siren_max ? Number(cursor.cursor_siren_max) : null

  // Si on est dans un découpage SIREN, on avance au bucket suivant.
  if (cursor.cursor_siren_min && cursor.cursor_siren_max && currentMax !== null && currentMax < SIREN_MAX) {
    const nextRange = nextSirenRangeFrom(currentMax + 1)

    return await updateCursor(cursor.id, {
      cursor_siren_min: nextRange.min,
      cursor_siren_max: nextRange.max,
      cursor_debut: 0,
    })
  }

  const next = nextDay(toYmd(cursor.cursor_date))

  if (dateIsAfterMax(next, toYmd(cursor.max_date))) {
    return await updateCursor(cursor.id, {
      status: 'done',
      cursor_date: toYmd(cursor.max_date),
      cursor_siren_min: null,
      cursor_siren_max: null,
      cursor_debut: 0,
    })
  }

  return await updateCursor(cursor.id, {
    cursor_date: next,
    cursor_siren_min: null,
    cursor_siren_max: null,
    cursor_debut: 0,
  })
}

async function collectSireneRowsWithCursor(
  params: any,
  mode: ImportMode,
  apiKey: string,
  runId: string
): Promise<CollectedRows> {
  const { minDate, maxDate, dateField } = buildDateConfig(params, mode)
  const safeMinDate = minDate === '*' ? toYmd(new Date()) : minDate
  const safeMaxDate = !maxDate || maxDate === '*' ? toYmd(new Date()) : maxDate

  let cursor = await getOrCreateCursor(runId, mode, safeMinDate, safeMaxDate, dateField)

  const allMap = new Map<string, any>()
  const invocationStartedAt = Date.now()
  const queryChunks: any[] = []

  let pageCount = 0
  let totalFetched = 0
  let totalAvailable = 0
  let splitBySiren = Boolean(cursor.cursor_siren_min && cursor.cursor_siren_max)
  let stoppedBecauseOfRuntime = false
  let stoppedBecauseOfPageLimit = false

  if (cursor.status === 'done') {
    return {
      minDate: safeMinDate,
      maxDate: safeMaxDate,
      allRows: [],
      uniqueSirets: 0,
      totalFetched: 0,
      totalAvailable: 0,
      pageCount: 0,
      dailyBatchCount: buildDailyRanges(safeMinDate, safeMaxDate).length,
      queryUnitCount: 0,
      splitByApe: false,
      splitBySiren,
      partial: false,
      done: true,
      stoppedBecauseOfRuntime: false,
      stoppedBecauseOfPageLimit: false,
      cursor,
      cursorTotalFetched: Number(cursor.total_fetched || 0),
      cursorTotalAvailable: Number(cursor.total_available || 0),
      queryChunks,
    }
  }

  while (pageCount < SIRENE_MAX_PAGES_PER_INVOCATION) {
    if (Date.now() - invocationStartedAt > SIRENE_MAX_RUNTIME_MS) {
      stoppedBecauseOfRuntime = true
      break
    }

    if (dateIsAfterMax(toYmd(cursor.cursor_date), safeMaxDate)) {
      cursor = await updateCursor(cursor.id, { status: 'done' })
      break
    }

    const day = toYmd(cursor.cursor_date)
    const baseQuery = buildQueryFromDates(day, day, mode, dateField)
    const q = withSirenRange(baseQuery, cursor.cursor_siren_min, cursor.cursor_siren_max)

    const page = await fetchSirenePage(apiKey, q, Number(cursor.cursor_debut || 0))
    pageCount += 1

    const isFullDayQuery = !cursor.cursor_siren_min || !cursor.cursor_siren_max

    // La journée est trop volumineuse : on ignore cette première page globale
    // et on bascule sur des plages de SIREN. Les lignes seront reprises via les buckets.
    if (isFullDayQuery && page.total > SIRENE_API_MAX_OFFSET) {
      const nextRange = nextSirenRangeFrom(SIREN_MIN)
      splitBySiren = true

      cursor = await updateCursor(cursor.id, {
        cursor_siren_min: nextRange.min,
        cursor_siren_max: nextRange.max,
        cursor_debut: 0,
        total_available: Number(cursor.total_available || 0) + Number(page.total || 0),
      })

      queryChunks.push({
        day,
        q,
        total: page.total,
        action: 'split_by_siren',
        next_siren_min: nextRange.min,
        next_siren_max: nextRange.max,
      })

      // On a déjà consommé une requête API dans cette invocation.
      continue
    }

    if (!isFullDayQuery && page.total > SIRENE_API_MAX_OFFSET) {
      throw new Error(
        `Pagination SIRENE encore trop large pour ${day} / SIREN ${cursor.cursor_siren_min}-${cursor.cursor_siren_max} : ` +
          `${page.total} résultats. Diminue SIRENE_SIREN_BUCKET_SIZE.`
      )
    }

    for (const e of page.etablissements) {
      if (e?.siret) allMap.set(String(e.siret), e)
    }

    totalFetched += page.etablissements.length
    totalAvailable += Number(page.total || 0)

    const returnedNombre = Number(page.nombre || page.etablissements.length || 0)
    const nextDebut = Number(cursor.cursor_debut || 0) + returnedNombre
    const completed = page.etablissements.length === 0 || nextDebut >= Number(page.total || 0)

    queryChunks.push({
      day,
      q,
      siren_min: cursor.cursor_siren_min,
      siren_max: cursor.cursor_siren_max,
      debut: cursor.cursor_debut,
      received: page.etablissements.length,
      total: page.total,
      completed,
    })

    if (completed) {
      const updated = await updateCursor(cursor.id, {
        cursor_debut: 0,
        total_fetched: Number(cursor.total_fetched || 0) + page.etablissements.length,
        total_available: Number(cursor.total_available || 0) + Number(page.total || 0),
      })

      cursor = await advanceCursorAfterCompletedUnit(updated)
    } else {
      cursor = await updateCursor(cursor.id, {
        cursor_debut: nextDebut,
        total_fetched: Number(cursor.total_fetched || 0) + page.etablissements.length,
        total_available: Number(cursor.total_available || 0) + Number(page.total || 0),
      })
    }
  }

  if (pageCount >= SIRENE_MAX_PAGES_PER_INVOCATION && cursor.status !== 'done') {
    stoppedBecauseOfPageLimit = true
  }

  const done = cursor.status === 'done'
  const partial = !done

  return {
    minDate: safeMinDate,
    maxDate: safeMaxDate,
    allRows: Array.from(allMap.values()),
    uniqueSirets: allMap.size,
    totalFetched,
    totalAvailable,
    pageCount,
    dailyBatchCount: buildDailyRanges(safeMinDate, safeMaxDate).length,
    queryUnitCount: queryChunks.length,
    splitByApe: false,
    splitBySiren,
    partial,
    done,
    stoppedBecauseOfRuntime,
    stoppedBecauseOfPageLimit,
    cursor,
    cursorTotalFetched: Number(cursor.total_fetched || 0),
    cursorTotalAvailable: Number(cursor.total_available || 0),
    queryChunks,
  }
}

async function collectSireneRows(
  params: any,
  mode: ImportMode,
  apiKey: string,
  runId?: string | null
): Promise<CollectedRows> {
  if (runId) {
    return await collectSireneRowsWithCursor(params, mode, apiKey, runId)
  }

  // Fallback direct : traitement d'un petit lot uniquement, sans curseur.
  // Pour les gros volumes, utiliser le pipeline maintenance qui fournit run_id.
  const { minDate, maxDate, dateField } = buildDateConfig(params, mode)
  const safeMinDate = minDate === '*' ? toYmd(new Date()) : minDate
  const safeMaxDate = !maxDate || maxDate === '*' ? toYmd(new Date()) : maxDate
  const firstDay = buildDailyRanges(safeMinDate, safeMaxDate)[0]
  const q = buildQueryFromDates(firstDay.min, firstDay.max, mode, dateField)
  const allMap = new Map<string, any>()
  const queryChunks: any[] = []
  let pageCount = 0
  let totalFetched = 0
  let totalAvailable = 0

  for (let debut = 0; pageCount < SIRENE_MAX_PAGES_PER_INVOCATION; ) {
    const page = await fetchSirenePage(apiKey, q, debut)
    pageCount += 1

    if (page.total > SIRENE_API_MAX_OFFSET) {
      throw new Error(
        `Pagination SIRENE bloquée pour la plage ${firstDay.min} -> ${firstDay.max} : ` +
          `${page.total} résultats. Lance via la maintenance automatique avec curseur run_id.`
      )
    }

    for (const e of page.etablissements) {
      if (e?.siret) allMap.set(String(e.siret), e)
    }

    totalFetched += page.etablissements.length
    totalAvailable += Number(page.total || 0)

    const nextDebut = debut + Number(page.nombre || page.etablissements.length || 0)
    const completed = page.etablissements.length === 0 || nextDebut >= Number(page.total || 0)

    queryChunks.push({
      day: firstDay.min,
      q,
      debut,
      received: page.etablissements.length,
      total: page.total,
      completed,
    })

    if (completed) break
    debut = nextDebut
  }

  return {
    minDate: safeMinDate,
    maxDate: safeMaxDate,
    allRows: Array.from(allMap.values()),
    uniqueSirets: allMap.size,
    totalFetched,
    totalAvailable,
    pageCount,
    dailyBatchCount: buildDailyRanges(safeMinDate, safeMaxDate).length,
    queryUnitCount: queryChunks.length,
    splitByApe: false,
    splitBySiren: false,
    partial: true,
    done: false,
    stoppedBecauseOfRuntime: false,
    stoppedBecauseOfPageLimit: pageCount >= SIRENE_MAX_PAGES_PER_INVOCATION,
    cursor: null,
    cursorTotalFetched: totalFetched,
    cursorTotalAvailable: totalAvailable,
    queryChunks,
  }
}

async function handleCreationImport(params: any, apiKey: string, runId?: string | null) {
  const collected = await collectSireneRows(params, 'creation', apiKey, runId)
  const etablissementsFiltres = filterRowsByDepartments(collected.allRows, params)

  const allowedApeCodes = new Set(normalizeArray(params.codes_ape).map(normalizeApe).filter(Boolean))

  const candidates = etablissementsFiltres.map((e: any) => {
    const row = mapSireneRowToClient(e)
    const ape = normalizeApe(row.activitePrincipaleEtablissement)
    const rs = String(row.raison_sociale_affichee || '').trim().toUpperCase()

    let rejectReason: string | null = null

    if (!row.siret) {
      rejectReason = 'SIRET absent'
    } else if (rs === '' || rs === 'ND' || rs === '[ND]') {
      rejectReason = 'Raison sociale absente ou ND'
    } else if (allowedApeCodes.size > 0 && !allowedApeCodes.has(ape)) {
      rejectReason = `Code APE hors périmètre (${ape || 'vide'})`
    }

    return { row, raw: e, rejectReason }
  })

  const rejectedByFilter = candidates.filter((x) => x.rejectReason)
  const validRows = candidates.filter((x) => !x.rejectReason).map((x) => x.row)

  const { data: importHeader, error: importHeaderError } = await supabase
    .from('imports_clients')
    .insert({
      nom_fichier: 'import_api_sirene',
      type_import: 'api_sirene',
      nb_lignes_source: collected.totalFetched,
      nb_importees: 0,
      nb_mises_a_jour: 0,
      nb_rejets: 0,
      date_import: new Date().toISOString(),
      commentaire: `Import API SIRENE - période=${collected.minDate}→${collected.maxDate}`,
    })
    .select('id')
    .single()

  if (importHeaderError) throw importHeaderError

  const importId = importHeader.id

  const existingSirets = new Set<string>()
  const validSirets = validRows.map((row) => normalizeSiret(row.siret)).filter(Boolean)

  for (const chunk of chunkArray(validSirets, DB_CHUNK_SIZE)) {
    const { data: existingRows, error: existingError } = await supabase
      .from('clients')
      .select('siret')
      .in('siret', chunk)

    if (existingError) throw existingError

    for (const existing of existingRows || []) {
      if (existing?.siret) existingSirets.add(normalizeSiret(existing.siret))
    }
  }

  const rowsToInsert = validRows.filter((row) => !existingSirets.has(normalizeSiret(row.siret)))
  const alreadyPresentRows = validRows.filter((row) => existingSirets.has(normalizeSiret(row.siret)))

  for (const chunk of chunkArray(rowsToInsert, DB_CHUNK_SIZE)) {
    const { error: insertError } = await supabase.from('clients').upsert(chunk, { onConflict: 'siret' })
    if (insertError) throw insertError
  }

  const rejectRows = [
    ...rejectedByFilter.map((item, index) => ({
      import_id: importId,
      ligne_numero: index + 1,
      siret: item.row.siret,
      motif_rejet: item.rejectReason,
      donnees_source_json: item.raw,
      created_at: new Date().toISOString(),
    })),
    ...alreadyPresentRows.map((row, index) => ({
      import_id: importId,
      ligne_numero: rejectedByFilter.length + index + 1,
      siret: row.siret,
      motif_rejet: 'Déjà présent en base (call API)',
      donnees_source_json: row,
      created_at: new Date().toISOString(),
    })),
  ]

  if (rejectRows.length > 0) {
    for (const chunk of chunkArray(rejectRows, REJECTS_CHUNK_SIZE)) {
      const { error: rejectInsertError } = await supabase.from('imports_clients_rejets').insert(chunk)
      if (rejectInsertError) console.error('Erreur insert imports_clients_rejets:', rejectInsertError)
    }
  }

  const { error: updateImportError } = await supabase
    .from('imports_clients')
    .update({
      nb_lignes_source: collected.totalFetched,
      nb_importees: rowsToInsert.length,
      nb_mises_a_jour: 0,
      nb_rejets: rejectRows.length,
      commentaire:
        `Import API SIRENE - période=${collected.minDate}→${collected.maxDate}` +
        ` - pages_batch=${collected.pageCount}` +
        ` - fetched_batch=${collected.totalFetched}` +
        ` - unique_batch=${collected.uniqueSirets}` +
        ` - présents=${alreadyPresentRows.length}` +
        ` - filtres=${rejectedByFilter.length}` +
        ` - partial=${collected.partial}` +
        ` - split_siren=${collected.splitBySiren}` +
        ` - delay=${SIRENE_MIN_DELAY_MS}ms`,
    })
    .eq('id', importId)

  if (updateImportError) console.error('Erreur update imports_clients:', updateImportError)

  return NextResponse.json({
    success: true,
    mode: 'creation',
    partial: collected.partial,
    done: collected.done,
    total_api_after_department_filter: etablissementsFiltres.length,
    fetched: collected.totalFetched,
    pages: collected.pageCount,
    api_total: collected.totalAvailable,
    imported: rowsToInsert.length,
    already_present: alreadyPresentRows.length,
    rejected_by_filter: rejectedByFilter.length,
    rejected_total: rejectRows.length,
    import_id: importId,
    daily_batches: collected.dailyBatchCount,
    query_units: collected.queryUnitCount,
    split_by_ape: collected.splitByApe,
    split_by_siren: collected.splitBySiren,
    stopped_because_of_runtime: collected.stoppedBecauseOfRuntime,
    stopped_because_of_page_limit: collected.stoppedBecauseOfPageLimit,
    cursor_total_fetched: collected.cursorTotalFetched,
    cursor_total_available: collected.cursorTotalAvailable,
    query_chunks: collected.queryChunks,
    rate_limit_delay_ms: SIRENE_MIN_DELAY_MS,
  })
}

async function handleCessationImport(params: any, apiKey: string, runId?: string | null) {
  const collected = await collectSireneRows(params, 'cessation', apiKey, runId)
  const etablissementsFiltres = filterRowsByDepartments(collected.allRows, params)

  const allowedApeCodes = new Set(normalizeArray(params.codes_ape).map(normalizeApe).filter(Boolean))

  const candidates = etablissementsFiltres.map((e: any) => {
    const apeFinal = extractApeFinal(e)
    const ape = normalizeApe(apeFinal)
    const siret = normalizeSiret(e.siret)

    let rejectReason: string | null = null

    if (!siret) {
      rejectReason = 'SIRET absent'
    } else if (allowedApeCodes.size > 0 && !allowedApeCodes.has(ape)) {
      rejectReason = `Code APE hors périmètre (${ape || 'vide'})`
    }

    return { raw: e, siret, ape, cessationDate: getCessationDate(e), rejectReason }
  })

  const rejectedByFilter = candidates.filter((x) => x.rejectReason)
  const validRows = candidates.filter((x) => !x.rejectReason && x.siret)
  const validSirets = Array.from(new Set(validRows.map((row) => row.siret)))

  const cegeclimSirets = new Set<string>()

  for (const chunk of chunkArray(validSirets, DB_CHUNK_SIZE)) {
    const [clientsCegeclimRes, refTiersRes] = await Promise.all([
      supabase.from('clients_cegeclim').select('siret').in('siret', chunk),
      supabase.from('ref_tiers').select('siret').in('siret', chunk),
    ])

    if (clientsCegeclimRes.error) throw clientsCegeclimRes.error
    if (refTiersRes.error) throw refTiersRes.error

    for (const row of clientsCegeclimRes.data || []) {
      const siret = normalizeSiret(row.siret)
      if (siret) cegeclimSirets.add(siret)
    }

    for (const row of refTiersRes.data || []) {
      const siret = normalizeSiret(row.siret)
      if (siret) cegeclimSirets.add(siret)
    }
  }

  const cegeclimClosedRows = validRows.filter((row) => cegeclimSirets.has(row.siret))
  const prospectClosedSirets = validSirets.filter((siret) => !cegeclimSirets.has(siret))

  const { data: importHeader, error: importHeaderError } = await supabase
    .from('imports_clients')
    .insert({
      nom_fichier: 'import_api_sirene_cessations',
      type_import: 'api_sirene',
      nb_lignes_source: collected.totalFetched,
      nb_importees: 0,
      nb_mises_a_jour: 0,
      nb_rejets: 0,
      date_import: new Date().toISOString(),
      commentaire: `Import cessations SIRENE - période=${collected.minDate}→${collected.maxDate}`,
    })
    .select('id')
    .single()

  if (importHeaderError) throw importHeaderError
  const importId = importHeader.id

  let deletedFromClients = 0
  let cegeclimMarkedClosed = 0

  for (const chunk of chunkArray(prospectClosedSirets, DB_CHUNK_SIZE)) {
    const { data, error } = await supabase.from('clients').delete().in('siret', chunk).select('siret')
    if (error) throw error
    deletedFromClients += data?.length || 0
  }

  for (const chunk of chunkArray(cegeclimClosedRows, DB_CHUNK_SIZE)) {
    const updates = chunk.map((row) => ({
      siret: row.siret,
      sirene_est_ferme: true,
      date_cessation_etablissement: row.cessationDate || null,
      date_detection_cessation: new Date().toISOString(),
      cessation_source: 'api_sirene',
      cessation_raw: row.raw,
      source_import: 'api_sirene_cessation',
    }))

    const { data, error } = await supabase.from('clients').upsert(updates, { onConflict: 'siret' }).select('siret')
    if (error) throw error
    cegeclimMarkedClosed += data?.length || 0
  }

  const rejectRows = rejectedByFilter.map((item, index) => ({
    import_id: importId,
    ligne_numero: index + 1,
    siret: item.siret || null,
    motif_rejet: item.rejectReason,
    donnees_source_json: item.raw,
    created_at: new Date().toISOString(),
  }))

  if (rejectRows.length > 0) {
    for (const chunk of chunkArray(rejectRows, REJECTS_CHUNK_SIZE)) {
      const { error } = await supabase.from('imports_clients_rejets').insert(chunk)
      if (error) console.error('Erreur insert imports_clients_rejets:', error)
    }
  }

  const { error: updateImportError } = await supabase
    .from('imports_clients')
    .update({
      nb_lignes_source: collected.totalFetched,
      nb_importees: 0,
      nb_mises_a_jour: cegeclimMarkedClosed,
      nb_rejets: rejectRows.length,
      commentaire:
        `Import cessations SIRENE - période=${collected.minDate}→${collected.maxDate}` +
        ` - pages_batch=${collected.pageCount}` +
        ` - fetched_batch=${collected.totalFetched}` +
        ` - unique_batch=${collected.uniqueSirets}` +
        ` - fermés CEGECLIM marqués=${cegeclimMarkedClosed}` +
        ` - prospects supprimés=${deletedFromClients}` +
        ` - partial=${collected.partial}` +
        ` - split_siren=${collected.splitBySiren}` +
        ` - delay=${SIRENE_MIN_DELAY_MS}ms`,
    })
    .eq('id', importId)

  if (updateImportError) console.error('Erreur update imports_clients:', updateImportError)

  return NextResponse.json({
    success: true,
    mode: 'cessation',
    partial: collected.partial,
    done: collected.done,
    fetched: collected.totalFetched,
    pages: collected.pageCount,
    api_total: collected.totalAvailable,
    unique_sirets: collected.uniqueSirets,
    total_api_after_department_filter: etablissementsFiltres.length,
    closed_candidates: validRows.length,
    deleted_from_clients: deletedFromClients,
    cegeclim_marked_closed: cegeclimMarkedClosed,
    rejected_by_filter: rejectedByFilter.length,
    rejected_total: rejectRows.length,
    import_id: importId,
    daily_batches: collected.dailyBatchCount,
    query_units: collected.queryUnitCount,
    split_by_ape: collected.splitByApe,
    split_by_siren: collected.splitBySiren,
    stopped_because_of_runtime: collected.stoppedBecauseOfRuntime,
    stopped_because_of_page_limit: collected.stoppedBecauseOfPageLimit,
    cursor_total_fetched: collected.cursorTotalFetched,
    cursor_total_available: collected.cursorTotalAvailable,
    query_chunks: collected.queryChunks,
    rate_limit_delay_ms: SIRENE_MIN_DELAY_MS,
  })
}

export async function POST(req: NextRequest) {
  try {
    const inseeApiKey = (process.env.INSEE_API_KEY || '').trim()

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant')
    }

    if (!inseeApiKey) {
      throw new Error('INSEE_API_KEY manquant dans .env.local')
    }

    let body: any = null
    try {
      body = await req.json()
    } catch {
      body = null
    }

    const mode: ImportMode = body?.mode === 'cessation' ? 'cessation' : 'creation'
    const runId = body?.run_id ? String(body.run_id) : null

    const { data: paramsRows, error: paramsError } = await supabase
      .from('import_sirene_params')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)

    if (paramsError) throw paramsError

    const params = paramsRows?.[0]
    if (!params) {
      throw new Error('Aucun paramètre trouvé dans import_sirene_params')
    }

    if (mode === 'cessation') {
      return await handleCessationImport(params, inseeApiKey, runId)
    }

    return await handleCreationImport(params, inseeApiKey, runId)
  } catch (error: any) {
    console.error('IMPORT SIRENE ERROR:', error)
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Erreur inconnue import SIRENE',
      },
      { status: 500 }
    )
  }
}
