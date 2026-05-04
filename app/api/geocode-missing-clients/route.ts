import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ClientRow = {
  id: string
  siret: string | null
  raison_sociale_affichee: string | null
  adresse_complete: string | null
  codePostalEtablissement: string | null
  libelleCommuneEtablissement: string | null
  latitude: number | null
  longitude: number | null
  coordonneeLambertAbscisseEtablissement: number | null
  coordonneeLambertOrdonneeEtablissement: number | null
  google_maps_url?: string | null
  date_import?: string | null
}

type GeocodeResult = {
  lat: number
  lng: number
  formattedAddress: string | null
  rawStatus: string
}

const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'
const DEFAULT_BATCH_SIZE = 100
const DEFAULT_DELAY_MS = 120

function normalizeSiret(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').trim()
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function isPlausibleFranceLatLng(lat: number, lng: number) {
  return lat >= 41 && lat <= 52 && lng >= -6 && lng <= 10
}

function isAddressCoherentWithClient(row: ClientRow, formattedAddress: string | null) {
  const address = normalizeText(formattedAddress)
  const cp = String(row.codePostalEtablissement || '').trim()
  const city = normalizeText(row.libelleCommuneEtablissement)

  const cpOk = cp.length > 0 && address.includes(cp)
  const cityOk = city.length > 0 && address.includes(city)

  return cpOk && cityOk
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildAddressCandidates(row: ClientRow): string[] {
  const adresse = String(row.adresse_complete || '').trim()
  const cp = String(row.codePostalEtablissement || '').trim()
  const ville = String(row.libelleCommuneEtablissement || '').trim()
  const raison = String(row.raison_sociale_affichee || '').trim()

  const candidates = [
    [adresse, cp, ville, 'France'].filter(Boolean).join(', '),
    [raison, adresse, cp, ville, 'France'].filter(Boolean).join(', '),
    [adresse, ville, 'France'].filter(Boolean).join(', '),
    [raison, ville, cp, 'France'].filter(Boolean).join(', '),
  ]
    .map((v) => v.trim())
    .filter(Boolean)

  return Array.from(new Set(candidates))
}

async function geocodeAddress(address: string, apiKey: string): Promise<GeocodeResult | null> {
  const url = new URL(GOOGLE_GEOCODE_URL)
  url.searchParams.set('address', address)
  url.searchParams.set('key', apiKey)
  url.searchParams.set('region', 'fr')

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Google Geocoding HTTP ${response.status}`)
  }

  const payload = await response.json()
  const status = String(payload?.status || '')

  if (status === 'ZERO_RESULTS') return null
  if (status !== 'OK') {
    throw new Error(`Google Geocoding status ${status}`)
  }

  const first = payload?.results?.[0]
  const location = first?.geometry?.location

  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    return null
  }

  return {
    lat: location.lat,
    lng: location.lng,
    formattedAddress: first?.formatted_address || null,
    rawStatus: status,
  }
}

async function geocodeWithFallback(row: ClientRow, apiKey: string) {
  const candidates = buildAddressCandidates(row)

  if (candidates.length === 0) {
    return {
      result: null as GeocodeResult | null,
      usedAddress: null as string | null,
      tried: [] as string[],
    }
  }

  for (const candidate of candidates) {
    const result = await geocodeAddress(candidate, apiKey)
    if (result) {
      return {
        result,
        usedAddress: candidate,
        tried: candidates,
      }
    }
  }

  return {
    result: null as GeocodeResult | null,
    usedAddress: null as string | null,
    tried: candidates,
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))

    const batchSize = Math.min(
      Number(body?.batchSize) > 0 ? Number(body.batchSize) : DEFAULT_BATCH_SIZE,
      500
    )

    const delayMs = Math.max(
      Number(body?.delayMs) >= 0 ? Number(body.delayMs) : DEFAULT_DELAY_MS,
      0
    )

    const onlyIds = Array.isArray(body?.ids)
      ? body.ids.map((v: unknown) => String(v)).filter(Boolean)
      : []

    const onlySirets = Array.isArray(body?.sirets)
      ? body.sirets.map((v: unknown) => normalizeSiret(v)).filter(Boolean)
      : []

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { success: false, error: 'Variables Supabase manquantes (URL ou SERVICE_ROLE_KEY).' },
        { status: 500 }
      )
    }

    if (!googleApiKey) {
      return NextResponse.json(
        { success: false, error: 'Variable GOOGLE_MAPS_API_KEY manquante.' },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    let query = supabase
      .from('clients')
      .select(`
        id,
        siret,
        raison_sociale_affichee,
        adresse_complete,
        codePostalEtablissement,
        libelleCommuneEtablissement,
        latitude,
        longitude,
        coordonneeLambertAbscisseEtablissement,
        coordonneeLambertOrdonneeEtablissement,
        google_maps_url,
        date_import
      `)
      .order('date_import', { ascending: false, nullsFirst: false })
      .limit(batchSize)

    if (onlyIds.length > 0) {
      query = supabase
        .from('clients')
        .select(`
          id,
          siret,
          raison_sociale_affichee,
          adresse_complete,
          codePostalEtablissement,
          libelleCommuneEtablissement,
          latitude,
          longitude,
          coordonneeLambertAbscisseEtablissement,
          coordonneeLambertOrdonneeEtablissement,
          google_maps_url,
          date_import
        `)
        .in('id', onlyIds)
        .limit(batchSize)
    } else if (onlySirets.length > 0) {
      query = supabase
        .from('clients')
        .select(`
          id,
          siret,
          raison_sociale_affichee,
          adresse_complete,
          codePostalEtablissement,
          libelleCommuneEtablissement,
          latitude,
          longitude,
          coordonneeLambertAbscisseEtablissement,
          coordonneeLambertOrdonneeEtablissement,
          google_maps_url,
          date_import
        `)
        .in('siret', onlySirets)
        .limit(batchSize)
    } else {
      query = supabase
        .from('clients')
        .select(`
          id,
          siret,
          raison_sociale_affichee,
          adresse_complete,
          codePostalEtablissement,
          libelleCommuneEtablissement,
          latitude,
          longitude,
          coordonneeLambertAbscisseEtablissement,
          coordonneeLambertOrdonneeEtablissement,
          google_maps_url,
          date_import
        `)
        .or('latitude.is.null,longitude.is.null')
        .order('date_import', { ascending: false, nullsFirst: false })
        .limit(batchSize)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    const rows = ((data || []) as ClientRow[]).filter((row) => {
      const hasLatLng =
        typeof row.latitude === 'number' &&
        typeof row.longitude === 'number' &&
        Number.isFinite(row.latitude) &&
        Number.isFinite(row.longitude)

      if (hasLatLng) return false

      return true
    })

    let updated = 0
    let zeroResults = 0
    let skippedNoAddress = 0

    const results: Array<{
      id: string
      siret: string | null
      name: string | null
      status: 'updated' | 'zero_results' | 'skipped_no_address' | 'error'
      usedAddress?: string | null
      latitude?: number | null
      longitude?: number | null
      error?: string
    }> = []

    for (const row of rows) {
      const addressCandidates = buildAddressCandidates(row)

      if (addressCandidates.length === 0) {
        skippedNoAddress += 1
        results.push({
          id: row.id,
          siret: row.siret,
          name: row.raison_sociale_affichee,
          status: 'skipped_no_address',
        })
        continue
      }

      try {
        const geocoded = await geocodeWithFallback(row, googleApiKey)

        if (!geocoded.result) {
          zeroResults += 1
          results.push({
            id: row.id,
            siret: row.siret,
            name: row.raison_sociale_affichee,
            status: 'zero_results',
            usedAddress: geocoded.usedAddress,
          })
          continue
        }

        const lat = geocoded.result.lat
        const lng = geocoded.result.lng

        if (!isPlausibleFranceLatLng(lat, lng)) {
          results.push({
            id: row.id,
            siret: row.siret,
            name: row.raison_sociale_affichee,
            status: 'error',
            usedAddress: geocoded.usedAddress,
            latitude: lat,
            longitude: lng,
            error: 'Coordonnées rejetées : hors plage France métropolitaine',
          })
          continue
        }

        if (!isAddressCoherentWithClient(row, geocoded.result.formattedAddress)) {
          results.push({
            id: row.id,
            siret: row.siret,
            name: row.raison_sociale_affichee,
            status: 'error',
            usedAddress: geocoded.usedAddress,
            latitude: lat,
            longitude: lng,
            error: `Coordonnées rejetées : adresse Google incohérente avec ${row.codePostalEtablissement || ''} ${row.libelleCommuneEtablissement || ''}`.trim(),
          })
          continue
        }

        const { error: updateError } = await supabase
          .from('clients')
          .update({
            latitude: lat,
            longitude: lng,
            google_maps_url: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
          })
          .eq('id', row.id)

        if (updateError) {
          throw updateError
        }

        updated += 1

        results.push({
          id: row.id,
          siret: row.siret,
          name: row.raison_sociale_affichee,
          status: 'updated',
          usedAddress: geocoded.usedAddress,
          latitude: lat,
          longitude: lng,
        })

        if (delayMs > 0) {
          await sleep(delayMs)
        }
      } catch (err: any) {
        results.push({
          id: row.id,
          siret: row.siret,
          name: row.raison_sociale_affichee,
          status: 'error',
          error: err?.message || 'Erreur inconnue',
        })
      }
    }

    return NextResponse.json({
      success: true,
      requested: batchSize,
      scanned: rows.length,
      updated,
      zeroResults,
      skippedNoAddress,
      results,
    })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Erreur serveur' },
      { status: 500 }
    )
  }
}