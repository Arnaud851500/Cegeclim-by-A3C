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

function normalizeText(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
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

async function getPappersCompany(siret: string) {
  const url = new URL('https://api.pappers.fr/v2/entreprise')
  url.searchParams.set('api_token', process.env.PAPPERS_API_KEY!)
  url.searchParams.set('siret', siret)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Pappers: ${errorText}`)
  }

  return await response.json()
}

function extractPappersData(pappers: any) {
  const representant = Array.isArray(pappers?.representants) ? pappers.representants[0] : null

  const nomDirigeant = representant
    ? `${representant.prenom || ''} ${representant.nom || ''}`.trim() || null
    : null

  const pappersCa =
    pappers?.finances?.chiffre_affaires ??
    pappers?.chiffre_affaires ??
    pappers?.ca ??
    null

  const pappersResultat =
    pappers?.finances?.resultat_net ??
    pappers?.resultat_net ??
    null

  const effectifEstime =
    pappers?.effectif ??
    pappers?.effectif_min ??
    null

  return {
    nomDirigeant,
    pappersCa:
      pappersCa != null && Number.isFinite(Number(pappersCa)) ? Number(pappersCa) : null,
    pappersResultat:
      pappersResultat != null && Number.isFinite(Number(pappersResultat))
        ? Number(pappersResultat)
        : null,
    effectifEstime:
      effectifEstime != null && Number.isFinite(Number(effectifEstime))
        ? Number(effectifEstime)
        : null,
  }
}

function computePotentialScore(data: {
  secteur: string | null
  rating: number | null
  userRatingCount: number | null
  contactable: boolean
  pappersCa: number | null
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

  if (data.pappersCa != null) {
    if (data.pappersCa >= 2_000_000) score += 28
    else if (data.pappersCa >= 1_000_000) score += 22
    else if (data.pappersCa >= 500_000) score += 16
    else if (data.pappersCa >= 100_000) score += 8
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

    if (!siret) {
      return NextResponse.json(
        { success: false, error: 'SIRET manquant' },
        { status: 400 }
      )
    }

    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('siret', siret)
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
      .eq('siret', siret)

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

    let pappersData = {
      nomDirigeant: null as string | null,
      pappersCa: null as number | null,
      pappersResultat: null as number | null,
      effectifEstime: null as number | null,
    }

    let pappersErrorMessage: string | null = null

    try {
      const pappers = await getPappersCompany(siret)
      pappersData = extractPappersData(pappers)
    } catch (pappersError) {
      pappersErrorMessage =
        pappersError instanceof Error ? pappersError.message : 'Erreur Pappers inconnue'
      console.error('Erreur Pappers:', pappersErrorMessage)
    }

    const finalPhone = googleDetails?.nationalPhoneNumber || client.telephone || null
    const finalWebsite = googleDetails?.websiteUri || client.site_web || null
    const finalDirigeant = pappersData.nomDirigeant || client.nom_dirigeant || null
    const finalEffectif = pappersData.effectifEstime || client.effectif_estime || null
    const finalContactable = Boolean(finalPhone || client.email)

    const potentielScore = computePotentialScore({
      secteur: client.naf_libelle_traduit,
      rating: googleDetails?.rating || null,
      userRatingCount: googleDetails?.userRatingCount || null,
      contactable: finalContactable,
      pappersCa: pappersData.pappersCa,
      effectifEstime: finalEffectif,
    })

    const sources = [
      googleDetails ? 'google_places' : null,
      pappersData.nomDirigeant || pappersData.pappersCa || pappersData.pappersResultat
        ? 'pappers'
        : null,
    ]
      .filter(Boolean)
      .join(',')

    const errors = [googleErrorMessage, pappersErrorMessage].filter(Boolean).join(' | ') || null

    const hasAnyEnrichment =
      Boolean(googleDetails) ||
      Boolean(pappersData.nomDirigeant) ||
      pappersData.pappersCa != null ||
      pappersData.pappersResultat != null ||
      pappersData.effectifEstime != null

    const updatePayload = {
      telephone: finalPhone,
      site_web: finalWebsite,
      nom_dirigeant: finalDirigeant,
      effectif_estime: finalEffectif,
      pappers_ca: pappersData.pappersCa,
      pappers_resultat: pappersData.pappersResultat,
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
      .eq('siret', siret)
      .select()
      .single()

    if (updateError) {
      throw updateError
    }

    return NextResponse.json({
      success: hasAnyEnrichment,
      data: updated,
      warning: errors,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue'

    try {
      const body = await req.clone().json()
      if (body?.siret) {
        await supabaseAdmin
          .from('clients')
          .update({
            enrichment_status: 'erreur',
            enrichment_error: message,
          })
          .eq('siret', body.siret)
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