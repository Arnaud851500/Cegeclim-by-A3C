import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const INSEE_SIRENE_URL = 'https://api.insee.fr/api-sirene/3.11/siret'
const MAX_PAGES = Number(process.env.SIRENE_MAX_PAGES || '500')
const DB_CHUNK_SIZE = 500
const REJECTS_CHUNK_SIZE = 500

// L'API INSEE retourne actuellement 429 au-delà de 30 requêtes / minute.
// 2300 ms ≈ 26 requêtes / minute, avec une marge de sécurité.
const SIRENE_MIN_DELAY_MS = Number(process.env.SIRENE_MIN_DELAY_MS || '2300')
const SIRENE_MAX_RETRIES = Number(process.env.SIRENE_MAX_RETRIES || '5')
const SIRENE_429_FALLBACK_WAIT_MS = Number(process.env.SIRENE_429_FALLBACK_WAIT_MS || '65000')

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

function toYmd(date: Date) {
  return date.toISOString().slice(0, 10)
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
  // Il faut donc couvrir toute la journée, sinon une recherche [2026-05-21 TO 2026-05-21]
  // peut ne remonter aucun établissement traité à 10h, 15h, etc.
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

const SIRENE_PAGE_SIZE = 1000
const SIRENE_MAX_DEBUT = Number(process.env.SIRENE_MAX_DEBUT || '10000')
const SIRENE_MAX_SPLIT_DEPTH = Number(process.env.SIRENE_MAX_SPLIT_DEPTH || '24')
const SIREN_RANGE_MIN = 0
const SIREN_RANGE_MAX = 999999999

type SireneQueryChunk = {
  mode: ImportMode
  min: string
  max: string
  q: string
  siren_min: string
  siren_max: string
  total: number
  fetched: number
  pages: number
  depth: number
  split?: boolean
}

function padSiren(value: number) {
  return String(Math.max(0, Math.min(999999999, Math.floor(value)))).padStart(9, '0')
}

function withSirenRange(q: string, sirenMin: number, sirenMax: number) {
  return `(${q}) AND siren:[${padSiren(sirenMin)} TO ${padSiren(sirenMax)}]`
}

function shouldSplitSireneQuery(total: number) {
  // L'API INSEE bloque la fenêtre de pagination autour de debut=10000.
  // Donc dès qu'une requête peut nécessiter un offset > 10000, on la découpe.
  return total > SIRENE_MAX_DEBUT
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

async function collectSireneRows(params: any, mode: ImportMode, apiKey: string) {
  const { minDate, maxDate, dateField } = buildDateConfig(params, mode)
  const allMap = new Map<string, any>()
  const dailyRanges = buildDailyRanges(minDate, maxDate === '*' ? toYmd(new Date()) : maxDate)

  // Les cessations restent découpées par journée, mais sans découpage par APE
  // dans la requête SIRENE. Le filtre APE est fait après réception.
  const queryUnits = dailyRanges.map((range) => ({ ...range, ape: null as string | null }))

  let pageCount = 0
  let totalFetched = 0
  let totalAvailable = 0
  let splitBySiren = false
  const queryChunks: SireneQueryChunk[] = []

  async function collectUnitBySirenRange(args: {
    unit: { min: string; max: string; ape: string | null }
    sirenMin: number
    sirenMax: number
    depth: number
  }): Promise<{
    rows: any[]
    totalFetched: number
    totalAvailable: number
    pageCount: number
    chunks: SireneQueryChunk[]
    splitBySiren: boolean
  }> {
    const baseQ = buildQueryFromDates(args.unit.min, args.unit.max, mode, dateField)

    const isFullSirenRange =
      args.sirenMin === SIREN_RANGE_MIN && args.sirenMax === SIREN_RANGE_MAX

    const q = isFullSirenRange
      ? baseQ
      : withSirenRange(baseQ, args.sirenMin, args.sirenMax)

    console.log('SIRENE QUERY UNIT START', {
      mode,
      min: args.unit.min,
      max: args.unit.max,
      ape: args.unit.ape,
      sirenMin: padSiren(args.sirenMin),
      sirenMax: padSiren(args.sirenMax),
      depth: args.depth,
      q,
    })

    const firstPage = await fetchSirenePage(apiKey, q, 0)
    const firstPageCount = 1
    const totalForUnit = Number(firstPage.total || 0)

    console.log('PAGE SIRENE', {
      mode,
      pageNumber: 1,
      rangeMin: args.unit.min,
      rangeMax: args.unit.max,
      ape: args.unit.ape,
      sirenMin: padSiren(args.sirenMin),
      sirenMax: padSiren(args.sirenMax),
      depth: args.depth,
      received: firstPage.etablissements.length,
      total: firstPage.total,
      debutSent: 0,
      debutReturned: firstPage.debut,
      nombreReturned: firstPage.nombre,
    })

    if (shouldSplitSireneQuery(totalForUnit)) {
      splitBySiren = true

      if (args.depth >= SIRENE_MAX_SPLIT_DEPTH || args.sirenMin >= args.sirenMax) {
        throw new Error(
          `Pagination SIRENE impossible : ${totalForUnit} résultats sur la plage ` +
            `${args.unit.min} -> ${args.unit.max} / SIREN ${padSiren(args.sirenMin)}-${padSiren(args.sirenMax)}. ` +
            `La profondeur de découpage maximale est atteinte.`
        )
      }

      const middle = Math.floor((args.sirenMin + args.sirenMax) / 2)

      console.warn('SIRENE QUERY SPLIT BY SIREN', {
        mode,
        min: args.unit.min,
        max: args.unit.max,
        totalForUnit,
        sirenMin: padSiren(args.sirenMin),
        sirenMax: padSiren(args.sirenMax),
        left: `${padSiren(args.sirenMin)}-${padSiren(middle)}`,
        right: `${padSiren(middle + 1)}-${padSiren(args.sirenMax)}`,
        depth: args.depth,
      })

      const left = await collectUnitBySirenRange({
        unit: args.unit,
        sirenMin: args.sirenMin,
        sirenMax: middle,
        depth: args.depth + 1,
      })

      const right = await collectUnitBySirenRange({
        unit: args.unit,
        sirenMin: middle + 1,
        sirenMax: args.sirenMax,
        depth: args.depth + 1,
      })

      return {
        rows: [...left.rows, ...right.rows],
        totalFetched: left.totalFetched + right.totalFetched,
        totalAvailable: left.totalAvailable + right.totalAvailable,
        // On compte aussi la page parent qui a servi à détecter le split.
        pageCount: firstPageCount + left.pageCount + right.pageCount,
        chunks: [
          {
            mode,
            min: args.unit.min,
            max: args.unit.max,
            q,
            siren_min: padSiren(args.sirenMin),
            siren_max: padSiren(args.sirenMax),
            total: totalForUnit,
            fetched: 0,
            pages: firstPageCount,
            depth: args.depth,
            split: true,
          },
          ...left.chunks,
          ...right.chunks,
        ],
        splitBySiren: true,
      }
    }

    const rows = [...firstPage.etablissements]
    let fetchedForUnit = firstPage.etablissements.length
    let pagesForUnit = firstPageCount
    let debut = firstPage.nombre || firstPage.etablissements.length || SIRENE_PAGE_SIZE

    while (debut < totalForUnit) {
      if (debut > SIRENE_MAX_DEBUT) {
        throw new Error(
          `Pagination SIRENE bloquée pour la plage ${args.unit.min} -> ${args.unit.max}` +
            `${args.unit.ape ? ` / APE ${args.unit.ape}` : ''}` +
            ` / SIREN ${padSiren(args.sirenMin)}-${padSiren(args.sirenMax)} : ` +
            `debut=${debut} dépasse la limite API de ${SIRENE_MAX_DEBUT}`
        )
      }

      const page = await fetchSirenePage(apiKey, q, debut)

      console.log('PAGE SIRENE', {
        mode,
        pageNumber: pagesForUnit + 1,
        rangeMin: args.unit.min,
        rangeMax: args.unit.max,
        ape: args.unit.ape,
        sirenMin: padSiren(args.sirenMin),
        sirenMax: padSiren(args.sirenMax),
        depth: args.depth,
        received: page.etablissements.length,
        total: page.total,
        debutSent: debut,
        debutReturned: page.debut,
        nombreReturned: page.nombre,
      })

      if (page.etablissements.length === 0) break

      rows.push(...page.etablissements)
      fetchedForUnit += page.etablissements.length
      pagesForUnit += 1

      const nextDebut = debut + (page.nombre || page.etablissements.length || SIRENE_PAGE_SIZE)
      if (nextDebut <= debut) break
      debut = nextDebut
    }

    if (totalForUnit > fetchedForUnit) {
      console.warn('Pagination potentiellement incomplète sur la plage', {
        mode,
        rangeMin: args.unit.min,
        rangeMax: args.unit.max,
        ape: args.unit.ape,
        sirenMin: padSiren(args.sirenMin),
        sirenMax: padSiren(args.sirenMax),
        totalForUnit,
        fetchedForUnit,
        nextDebut: debut,
      })
    }

    return {
      rows,
      totalFetched: fetchedForUnit,
      totalAvailable: totalForUnit,
      pageCount: pagesForUnit,
      chunks: [
        {
          mode,
          min: args.unit.min,
          max: args.unit.max,
          q,
          siren_min: padSiren(args.sirenMin),
          siren_max: padSiren(args.sirenMax),
          total: totalForUnit,
          fetched: fetchedForUnit,
          pages: pagesForUnit,
          depth: args.depth,
        },
      ],
      splitBySiren: false,
    }
  }

  for (const unit of queryUnits) {
    const result = await collectUnitBySirenRange({
      unit,
      sirenMin: SIREN_RANGE_MIN,
      sirenMax: SIREN_RANGE_MAX,
      depth: 0,
    })

    for (const e of result.rows) {
      if (e?.siret) allMap.set(String(e.siret), e)
    }

    totalFetched += result.totalFetched
    totalAvailable += result.totalAvailable
    pageCount += result.pageCount
    splitBySiren = splitBySiren || result.splitBySiren
    queryChunks.push(...result.chunks)

    if (pageCount > MAX_PAGES) {
      throw new Error(
        `Import SIRENE interrompu : ${pageCount} pages appelées, limite MAX_PAGES=${MAX_PAGES}. ` +
          `Augmenter SIRENE_MAX_PAGES ou réduire le périmètre.`
      )
    }
  }

  return {
    minDate,
    maxDate,
    allRows: Array.from(allMap.values()),
    uniqueSirets: allMap.size,
    totalFetched,
    totalAvailable,
    pageCount,
    dailyBatchCount: dailyRanges.length,
    queryUnitCount: queryChunks.filter((chunk) => !chunk.split).length,
    splitByApe: false,
    splitBySiren,
    queryChunks,
  }
}

async function handleCreationImport(params: any, apiKey: string) {
  const collected = await collectSireneRows(params, 'creation', apiKey)
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

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await supabase.from('clients').upsert(rowsToInsert, { onConflict: 'siret' })
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
        ` - pages=${collected.pageCount}` +
        ` - fetched=${collected.totalFetched}` +
        ` - unique=${collected.uniqueSirets}` +
        ` - présents=${alreadyPresentRows.length}` +
        ` - filtres=${rejectedByFilter.length}` +
        ` - split_siren=${collected.splitBySiren}` +
        ` - delay=${SIRENE_MIN_DELAY_MS}ms`,
    })
    .eq('id', importId)

  if (updateImportError) console.error('Erreur update imports_clients:', updateImportError)

  return NextResponse.json({
    success: true,
    mode: 'creation',
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
    query_chunks: collected.queryChunks,
    rate_limit_delay_ms: SIRENE_MIN_DELAY_MS,
  })
}

async function handleCessationImport(params: any, apiKey: string) {
  const collected = await collectSireneRows(params, 'cessation', apiKey)
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
        ` - pages=${collected.pageCount}` +
        ` - fetched=${collected.totalFetched}` +
        ` - unique=${collected.uniqueSirets}` +
        ` - fermés CEGECLIM marqués=${cegeclimMarkedClosed}` +
        ` - prospects supprimés=${deletedFromClients}` +
        ` - batchs=${collected.dailyBatchCount}` +
        ` - unités=${collected.queryUnitCount}` +
        ` - delay=${SIRENE_MIN_DELAY_MS}ms`,
    })
    .eq('id', importId)

  if (updateImportError) console.error('Erreur update imports_clients:', updateImportError)

  return NextResponse.json({
    success: true,
    mode: 'cessation',
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
      return await handleCessationImport(params, inseeApiKey)
    }

    return await handleCreationImport(params, inseeApiKey)
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
