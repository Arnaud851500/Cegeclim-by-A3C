import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

type GoogleSearchPlace = {
  id?: string
  displayName?: { text?: string }
  formattedAddress?: string
}

type GooglePlaceDetails = {
  id?: string
  displayName?: { text?: string }
  formattedAddress?: string
  nationalPhoneNumber?: string
  websiteUri?: string
  rating?: number
  userRatingCount?: number
  googleMapsUri?: string
}

type InpiFormalityContent = {
  content?: {
    personneMorale?: {
      identite?: {
        description?: {
          montantCapital?: number | string | null
          deviseCapital?: string | null
        }
      }
      composition?: {
        pouvoirs?: Array<{
          individu?: {
            descriptionPersonne?: {
              nom?: string | null
              prenoms?: string[] | null
            }
          } | null
          representant?: {
            descriptionPersonne?: {
              nom?: string | null
              prenoms?: string[] | null
            }
          } | null
          roleEntreprise?: string | null
          secondRoleEntreprise?: string | null
        }>
      }
    } | null
  }
}

type InpiLoginResponse = {
  token?: string
}

type InpiCompanyResponse = InpiFormalityContent & {
  siren?: string
  updatedAt?: string
  id?: number | string
  nombreRepresentantsActifs?: number
  nombreEtablissementsOuverts?: number
  formality?: InpiFormalityContent | null
}

let inpiTokenCache: { token: string; expiresAt: number } | null = null

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeText(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function normalizeSiret(value: string | null | undefined) {
  return String(value || '').replace(/\D/g, '').trim()
}

function sirenFromSiret(siret: string) {
  return normalizeSiret(siret).slice(0, 9)
}

function isGoodGoogleMatch(params: {
  clientName?: string | null
  clientCity?: string | null
  clientPostalCode?: string | null
  googleName?: string | null
  googleAddress?: string | null
}) {
  const clientName = normalizeText(params.clientName)
  const clientCity = normalizeText(params.clientCity)
  const clientPostalCode = normalizeText(params.clientPostalCode)
  const googleName = normalizeText(params.googleName)
  const googleAddress = normalizeText(params.googleAddress)

  const nameOk =
    clientName.length > 0 &&
    googleName.length > 0 &&
    (googleName.includes(clientName) || clientName.includes(googleName))

  const cityOk = clientCity.length > 0 && googleAddress.includes(clientCity)
  const postalOk = clientPostalCode.length > 0 && googleAddress.includes(clientPostalCode)

  return nameOk || (cityOk && postalOk)
}

async function searchGooglePlace(textQuery: string) {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY!,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress',
    },
    body: JSON.stringify({
      textQuery,
      languageCode: 'fr',
      maxResultCount: 5,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Google Text Search: ${errorText}`)
  }

  const json = await response.json()
  return (json.places || []) as GoogleSearchPlace[]
}

async function getGooglePlaceDetails(placeId: string) {
  const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY!,
      'X-Goog-FieldMask':
        'id,displayName,formattedAddress,nationalPhoneNumber,websiteUri,rating,userRatingCount,googleMapsUri',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Google Place Details: ${errorText}`)
  }

  return (await response.json()) as GooglePlaceDetails
}

function getInpiBaseUrl() {
  return (process.env.INPI_BASE_URL || 'https://registre-national-entreprises.inpi.fr').replace(
    /\/$/,
    ''
  )
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function getInpiToken(forceRefresh = false) {
  const username = process.env.INPI_USERNAME
  const password = process.env.INPI_PASSWORD
  const baseUrl = getInpiBaseUrl()
  const loginUrl = `${baseUrl}/api/sso/login`

  if (!username || !password) {
    throw new Error('Variables INPI_USERNAME / INPI_PASSWORD manquantes')
  }

  const now = Date.now()

  if (!forceRefresh && inpiTokenCache && inpiTokenCache.expiresAt > now) {
    console.log('[INPI] token cache hit')
    return inpiTokenCache.token
  }

  let lastError: any = null

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[INPI] login URL = ${loginUrl} (attempt ${attempt}/3)`)

      const response = await fetchWithTimeout(
        loginUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            username,
            password,
          }),
        },
        15000
      )

      const rawText = await response.text()

      if (!response.ok) {
        throw new Error(`INPI login HTTP ${response.status}: ${rawText}`)
      }

      let json: InpiLoginResponse
      try {
        json = JSON.parse(rawText)
      } catch {
        throw new Error(`INPI login JSON invalide: ${rawText}`)
      }

      if (!json?.token) {
        throw new Error(`INPI login: token absent. Réponse = ${rawText}`)
      }

      inpiTokenCache = {
        token: json.token,
        expiresAt: Date.now() + 10 * 60 * 1000,
      }

      console.log('[INPI] token cached for 10 minutes')
      return json.token
    } catch (error: any) {
      lastError = error
      console.error('[INPI] login error:', error)
      console.error('[INPI] login cause:', error?.cause)

      if (attempt < 3) {
        await sleep(400 * attempt)
      }
    }
  }

  throw new Error(`INPI login failed: ${lastError?.message || 'unknown error'}`)
}

async function getInpiCompanyBySiren(siren: string) {
  const baseUrl = getInpiBaseUrl()
  const companyUrl = `${baseUrl}/api/companies/${encodeURIComponent(siren)}`

  async function doFetch(token: string) {
    const response = await fetchWithTimeout(
      companyUrl,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      },
      15000
    )

    const rawText = await response.text()

    if (!response.ok) {
      throw new Error(`INPI company HTTP ${response.status}: ${rawText}`)
    }

    try {
      return JSON.parse(rawText) as InpiCompanyResponse
    } catch {
      throw new Error(`INPI company JSON invalide: ${rawText}`)
    }
  }

  try {
    console.log('[INPI] company URL =', companyUrl)
    console.log('[INPI] siren used =', siren)

    const token = await getInpiToken(false)
    return await doFetch(token)
  } catch (error: any) {
    console.error('[INPI] company error:', error)
    console.error('[INPI] company cause:', error?.cause)

    const message = String(error?.message || '')
    if (message.includes('401') || message.includes('403')) {
      console.log('[INPI] retry with forced token refresh')
      const freshToken = await getInpiToken(true)
      return await doFetch(freshToken)
    }

    throw new Error(`INPI company failed: ${error?.message || 'unknown error'}`)
  }
}

function getInpiPayload(company: InpiCompanyResponse): InpiFormalityContent | null {
  if (company?.content) return company
  if (company?.formality?.content) return company.formality
  return null
}

function buildFullName(person: { nom?: string | null; prenoms?: string[] | null } | null | undefined) {
  if (!person) return null
  const prenoms = Array.isArray(person.prenoms) ? person.prenoms.filter(Boolean).join(' ') : ''
  const nom = person.nom || ''
  const full = `${prenoms} ${nom}`.trim()
  return full || null
}

function extractInpiDirigeant(company: InpiCompanyResponse) {
  const payload = getInpiPayload(company)
  const pouvoirs = payload?.content?.personneMorale?.composition?.pouvoirs

  if (!Array.isArray(pouvoirs)) return null

  for (const pouvoir of pouvoirs) {
    const fromIndividu = buildFullName(pouvoir?.individu?.descriptionPersonne)
    if (fromIndividu) return fromIndividu

    const fromRepresentant = buildFullName(pouvoir?.representant?.descriptionPersonne)
    if (fromRepresentant) return fromRepresentant
  }

  return null
}

function extractInpiCapital(company: InpiCompanyResponse) {
  const payload = getInpiPayload(company)
  const description = payload?.content?.personneMorale?.identite?.description
  const montant = description?.montantCapital
  const devise = description?.deviseCapital

  if (montant == null || String(montant).trim() === '') return null
  return devise ? `${montant} ${devise}` : String(montant)
}

function extractInpiEffectif(_company: InpiCompanyResponse) {
  return null
}

function computePotentialScore(data: {
  secteur: string | null
  rating: number | null
  userRatingCount: number | null
  contactable: boolean
  effectifEstime: number | null
}) {
  let score = 0

  const secteur = normalizeText(data.secteur)

  if (secteur.includes('cvc')) score += 25
  else if (secteur.includes('enr')) score += 20
  else if (secteur.includes('plomberie')) score += 12
  else if (secteur.includes('batiment')) score += 8

  if (data.rating != null) {
    if (data.rating >= 4.5) score += 12
    else if (data.rating >= 4.0) score += 9
    else if (data.rating >= 3.5) score += 5
  }

  if (data.userRatingCount != null) {
    if (data.userRatingCount >= 50) score += 10
    else if (data.userRatingCount >= 20) score += 6
    else if (data.userRatingCount >= 5) score += 3
  }

  if (data.effectifEstime != null) {
    if (data.effectifEstime >= 20) score += 15
    else if (data.effectifEstime >= 10) score += 10
    else if (data.effectifEstime >= 3) score += 5
  }

  if (data.contactable) score += 10

  return Math.min(score, 100)
}

export async function POST(req: NextRequest) {
  try {
    const { siret } = await req.json()

    const cleanSiret = normalizeSiret(siret)

    if (!cleanSiret || cleanSiret.length !== 14) {
      return NextResponse.json(
        { success: false, error: 'SIRET manquant ou invalide' },
        { status: 400 }
      )
    }

    const siren = sirenFromSiret(cleanSiret)

    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('siret', cleanSiret)
      .single()

    if (clientError || !client) {
      return NextResponse.json(
        { success: false, error: 'Client introuvable' },
        { status: 404 }
      )
    }

    await supabaseAdmin
      .from('clients')
      .update({
        enrichment_status: 'en_cours',
        enrichment_error: null,
      })
      .eq('siret', cleanSiret)

    let googleDetails: GooglePlaceDetails | null = null
    let googlePlaceId: string | null = null
    let googleErrorMessage: string | null = null

    const textQuery = [
      client.raison_sociale_affichee,
      client.codePostalEtablissement,
      client.libelleCommuneEtablissement,
    ]
      .filter(Boolean)
      .join(' ')

    try {
      const candidates = await searchGooglePlace(textQuery)

      if (candidates.length > 0) {
        const bestCandidate =
          candidates.find((candidate) =>
            isGoodGoogleMatch({
              clientName: client.raison_sociale_affichee,
              clientCity: client.libelleCommuneEtablissement,
              clientPostalCode: client.codePostalEtablissement,
              googleName: candidate.displayName?.text,
              googleAddress: candidate.formattedAddress,
            })
          ) || candidates[0]

        if (bestCandidate.id) {
          googlePlaceId = bestCandidate.id
          googleDetails = await getGooglePlaceDetails(bestCandidate.id)
        }
      } else {
        googleErrorMessage = 'Aucun résultat Google Maps'
      }
    } catch (googleError) {
      googleErrorMessage =
        googleError instanceof Error ? googleError.message : 'Erreur Google inconnue'
      console.error('Erreur Google:', googleErrorMessage)
    }

    let inpiData = {
      nomDirigeant: null as string | null,
      capitalSocial: null as string | null,
      effectifEstime: null as number | null,
    }

    let inpiErrorMessage: string | null = null

    try {
      const inpiCompany = await getInpiCompanyBySiren(siren)
      const inpiPayload = getInpiPayload(inpiCompany)

      console.log('[INPI] raw company response keys =', Object.keys(inpiCompany || {}))
      console.log('[INPI] has root content =', Boolean(inpiCompany?.content))
      console.log('[INPI] has formality =', Boolean(inpiCompany?.formality))
      console.log(
        '[INPI] has payload.content.personneMorale =',
        Boolean(inpiPayload?.content?.personneMorale)
      )

      inpiData = {
        nomDirigeant: extractInpiDirigeant(inpiCompany),
        capitalSocial: extractInpiCapital(inpiCompany),
        effectifEstime: extractInpiEffectif(inpiCompany),
      }

      console.log('[INPI] dirigeant extrait =', inpiData.nomDirigeant)
      console.log('[INPI] capital extrait =', inpiData.capitalSocial)
    } catch (inpiError) {
      inpiErrorMessage =
        inpiError instanceof Error ? inpiError.message : 'Erreur INPI inconnue'
      console.error('Erreur INPI:', inpiErrorMessage)
    }

    const finalPhone = googleDetails?.nationalPhoneNumber || client.telephone || null
    const finalWebsite = googleDetails?.websiteUri || client.site_web || null
    const finalDirigeant = inpiData.nomDirigeant || client.nom_dirigeant || null
    const finalEffectif = inpiData.effectifEstime || client.effectif_estime || null
    const finalCapitalSocial = inpiData.capitalSocial || client.capital_social || null
    const finalContactable = Boolean(finalPhone || client.email)

    const potentielScore = computePotentialScore({
      secteur: client.naf_libelle_traduit,
      rating: googleDetails?.rating || null,
      userRatingCount: googleDetails?.userRatingCount || null,
      contactable: finalContactable,
      effectifEstime: finalEffectif,
    })

    const sources = [
      googleDetails ? 'google_places' : null,
      inpiData.nomDirigeant || inpiData.capitalSocial ? 'inpi' : null,
    ]
      .filter(Boolean)
      .join(',')

    const errors = [googleErrorMessage, inpiErrorMessage].filter(Boolean).join(' | ') || null

    const hasAnyEnrichment =
      Boolean(googleDetails) ||
      Boolean(inpiData.nomDirigeant) ||
      Boolean(inpiData.capitalSocial) ||
      inpiData.effectifEstime != null

    const updatePayload: Record<string, any> = {
      telephone: finalPhone,
      site_web: finalWebsite,
      nom_dirigeant: finalDirigeant,
      effectif_estime: finalEffectif,
      capital_social: finalCapitalSocial,
      google_place_id: googleDetails?.id || googlePlaceId,
      google_rating: googleDetails?.rating || null,
      google_user_ratings_total: googleDetails?.userRatingCount || null,
      google_maps_url: googleDetails?.googleMapsUri || null,
      potentiel_score: potentielScore,
      enrichment_status: hasAnyEnrichment ? 'ok' : 'erreur',
      last_enrichment_at: new Date().toISOString(),
      enrichment_source: sources || null,
      enrichment_error: errors,
      contactable: finalContactable,
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('clients')
      .update(updatePayload)
      .eq('siret', cleanSiret)
      .select()
      .single()

    if (updateError) {
      throw updateError
    }

    return NextResponse.json({
      success: hasAnyEnrichment,
      data: updated,
      warning: errors,
      siren_used_for_inpi: siren,
      inpi_preview: inpiData,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue'

    try {
      const body = await req.clone().json()
      const cleanSiret = normalizeSiret(body?.siret)

      if (cleanSiret) {
        await supabaseAdmin
          .from('clients')
          .update({
            enrichment_status: 'erreur',
            enrichment_error: message,
          })
          .eq('siret', cleanSiret)
      }
    } catch {
      // rien
    }

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}