import { NextResponse } from 'next/server'

const INSEE_SIRENE_URL = 'https://api.insee.fr/api-sirene/3.11/siret'
const PAGE_SIZE = 20000
const MAX_PAGES = 200

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

function boolFromOorN(value: unknown): boolean | null {
  const v = String(value || '').trim().toUpperCase()
  if (v === 'O') return true
  if (v === 'N') return false
  return null
}

function translateNaf(activitePrincipaleEtablissement: string | null) {
  const code = (activitePrincipaleEtablissement || '').replace(/\s/g, '').toUpperCase()
  if (!code) return 'AUTRES'
  if (code.startsWith('43.22B') || code.startsWith('4322B')) return 'Installateur CVC'
  if (code.startsWith('43.22A') || code.startsWith('4322A')) return 'Plomberie'
  if (code.startsWith('43.21') || code.startsWith('4321')) return 'Electricité ENR'
  if (code.startsWith('41.20') || code.startsWith('4120')) return 'CMI'
  if (code.startsWith('43.99') || code.startsWith('4399')) return 'Bâtiment'
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

function buildQuery(params: any) {
  const apeCodes = normalizeArray(params.codes_ape)

  const apePart =
    apeCodes.length > 0
      ? '(' +
        apeCodes
          .map((code) => `activitePrincipaleUniteLegale:${String(code).trim().toUpperCase()}`)
          .join(' OR ') +
        ')'
      : ''

  const minDate = params.date_creation_min || '*'
  const maxDate = params.date_creation_max || '*'
  const datePart = `dateCreationEtablissement:[${minDate} TO ${maxDate}]`

  const parts = [apePart, datePart].filter(Boolean)

  return parts.join(' AND ')
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

async function fetchSirenePage(apiKey: string, q: string, cursor?: string | null) {
  const body = new URLSearchParams()
  body.set('q', q)
  body.set('nombre', String(PAGE_SIZE))
  if (cursor) body.set('curseur', cursor)

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
    nextCursor: null,
    total: 0,
  }
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
    nextCursor: data?.header?.curseurSuivant || null,
    total: data?.header?.total ?? null,
  }
}

export async function POST() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const inseeApiKey = (process.env.INSEE_API_KEY || '').trim()

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant')
    }

    if (!inseeApiKey) {
      throw new Error('INSEE_API_KEY manquant dans .env.local')
    }

    const paramsRes = await fetch(
      `${supabaseUrl}/rest/v1/import_sirene_params?select=*&order=updated_at.desc.nullslast&limit=1`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      }
    )

    const paramsText = await paramsRes.text()

    if (!paramsRes.ok) {
      throw new Error(`Erreur lecture paramètres Supabase: ${paramsText}`)
    }

    let paramsJson: any[]
    try {
      paramsJson = JSON.parse(paramsText)
    } catch {
      throw new Error(`Réponse paramètres non JSON: ${paramsText}`)
    }

    const params = paramsJson?.[0]
    if (!params) {
      throw new Error('Aucun paramètre trouvé dans import_sirene_params')
    }

    const q = buildQuery(params)
    console.log('Q SIRENE =', q)

    const allMap = new Map<string, any>()
    let cursor: string | null = null
    let pageCount = 0
    let totalFetched = 0
    let totalAvailable: number | null = null

    while (pageCount < MAX_PAGES) {
      const page = await fetchSirenePage(inseeApiKey, q, cursor)

      if (totalAvailable === null) totalAvailable = page.total

      for (const e of page.etablissements) {
        if (e?.siret) allMap.set(String(e.siret), e)
      }

      totalFetched += page.etablissements.length
      pageCount += 1

      if (!page.nextCursor || page.etablissements.length === 0) break
      cursor = page.nextCursor
    }

    const etablissementsFiltres = filterRowsByDepartments(Array.from(allMap.values()), params)

    const rows = etablissementsFiltres
      .map((e: any) => {
        const adresse = e.adresseEtablissement || {}
        const uniteLegale = e.uniteLegale || {}

        const raisonSociale =
          firstNonEmpty(
            uniteLegale.denominationUniteLegale,
            e.denominationUsuelleEtablissement,
            [uniteLegale.nomUniteLegale, uniteLegale.prenom1UniteLegale]
              .filter(Boolean)
              .join(' ')
          ) || null

        const codePostal = firstNonEmpty(adresse.codePostalEtablissement)
        const departement = getDepartmentFromPostalCode(codePostal)

        const apeEtablissement = firstNonEmpty(
          e.activitePrincipaleEtablissement,
          e.periodesEtablissement?.[0]?.activitePrincipaleEtablissement
        )

        const apeUniteLegale = firstNonEmpty(uniteLegale.activitePrincipaleUniteLegale)
        const apeFinal = firstNonEmpty(apeEtablissement, apeUniteLegale)

        const nomDirigeant = firstNonEmpty(
          [uniteLegale.prenom1UniteLegale, uniteLegale.nomUniteLegale]
            .filter(Boolean)
            .join(' ')
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

          coordonneeLambertAbscisseEtablissement: parseLambert(
            adresse.coordonneeLambertAbscisseEtablissement
          ),
          coordonneeLambertOrdonneeEtablissement: parseLambert(
            adresse.coordonneeLambertOrdonneeEtablissement
          ),

          trancheEffectifsEtablissement: firstNonEmpty(e.trancheEffectifsEtablissement),

          nom_dirigeant: nomDirigeant,
          contactable: false,
          enrichment_status: 'a_faire',
          date_import: new Date().toISOString(),
          source_import: 'api_sirene',

          // champs présents dans la table, laissés vides si non fournis par l'API
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
      })
       .filter((row: any) => {
  const ape = String(row.activitePrincipaleEtablissement || '').trim().toUpperCase()
  const allowed = new Set(
    normalizeArray(params.codes_ape).map((code) => String(code).trim().toUpperCase())
  )

  const rs = String(row.raison_sociale_affichee || '').trim().toUpperCase()

  return (
    row.siret &&
    rs !== '' &&
    rs !== 'ND' &&
    rs !== '[ND]' &&
    (allowed.size === 0 || allowed.has(ape))
  )
})

    if (rows.length === 0) {
      const importHeaderRes = await fetch(`${supabaseUrl}/rest/v1/imports_clients`, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nom_fichier: 'import_api_sirene',
          type_import: 'api_sirene',
          nb_lignes_source: totalFetched,
          nb_importees: 0,
          nb_mises_a_jour: 0,
          nb_rejets: 0,
          date_import: new Date().toISOString(),
          commentaire: `Import API SIRENE - q=${q} - Aucun établissement trouvé`,
        }),
      })

      const importHeaderText = await importHeaderRes.text()
      if (!importHeaderRes.ok) {
        console.error('Erreur création import header:', importHeaderText)
      }

      return NextResponse.json({
        success: true,
        total: 0,
        fetched: totalFetched,
        pages: pageCount,
        api_total: totalAvailable,
        q,
        message: 'Aucun établissement trouvé',
      })
    }

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/clients?on_conflict=siret`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(rows),
    })

    const insertText = await insertRes.text()

    if (!insertRes.ok) {
      throw new Error(`Erreur insertion clients: ${insertText}`)
    }

    const importHeaderRes = await fetch(`${supabaseUrl}/rest/v1/imports_clients`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nom_fichier: 'import_api_sirene',
        type_import: 'api_sirene',
        nb_lignes_source: totalFetched,
        nb_importees: rows.length,
        nb_mises_a_jour: 0,
        nb_rejets: 0,
        date_import: new Date().toISOString(),
        commentaire: `Import API SIRENE - q=${q}`,
      }),
    })

    const importHeaderText = await importHeaderRes.text()

    if (!importHeaderRes.ok) {
      console.error('Erreur création import header:', importHeaderText)
    }

    return NextResponse.json({
      success: true,
      total: rows.length,
      fetched: totalFetched,
      pages: pageCount,
      api_total: totalAvailable,
      q,
    })
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