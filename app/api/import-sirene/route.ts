import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const INSEE_SIRENE_URL = 'https://api.insee.fr/api-sirene/3.11/siret'
const PAGE_SIZE = 20000
const MAX_PAGES = 200
const DB_CHUNK_SIZE = 500
const REJECTS_CHUNK_SIZE = 500

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function buildQuery(params: any) {
  const minDate = params.date_creation_min || '*'
  const maxDate = params.date_creation_max || '*'
  return `dateCreationEtablissement:[${minDate} TO ${maxDate}]`
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
    const inseeApiKey = (process.env.INSEE_API_KEY || '').trim()

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant')
    }

    if (!inseeApiKey) {
      throw new Error('INSEE_API_KEY manquant dans .env.local')
    }

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

    const allowedApeCodes = new Set(
      normalizeArray(params.codes_ape).map((code) => String(code).trim().toUpperCase())
    )

    const candidates = etablissementsFiltres.map((e: any) => {
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

      const row = {
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

      const ape = String(row.activitePrincipaleEtablissement || '').trim().toUpperCase()
      const rs = String(row.raison_sociale_affichee || '').trim().toUpperCase()

      let rejectReason: string | null = null

      if (!row.siret) {
        rejectReason = 'SIRET absent'
      } else if (rs === '' || rs === 'ND' || rs === '[ND]') {
        rejectReason = 'Raison sociale absente ou ND'
      } else if (allowedApeCodes.size > 0 && !allowedApeCodes.has(ape)) {
        rejectReason = `Code APE hors périmètre (${ape || 'vide'})`
      }

      return {
        row,
        raw: e,
        rejectReason,
      }
    })

    const rejectedByFilter = candidates.filter((x) => x.rejectReason)
    const validRows = candidates.filter((x) => !x.rejectReason).map((x) => x.row)

    const { data: importHeader, error: importHeaderError } = await supabase
      .from('imports_clients')
      .insert({
        nom_fichier: 'import_api_sirene',
        type_import: 'api_sirene',
        nb_lignes_source: totalFetched,
        nb_importees: 0,
        nb_mises_a_jour: 0,
        nb_rejets: 0,
        date_import: new Date().toISOString(),
        commentaire: `Import API SIRENE - q=${q}`,
      })
      .select('id')
      .single()

    if (importHeaderError) {
      throw importHeaderError
    }

    const importId = importHeader.id

    const existingSirets = new Set<string>()
    const validSirets = validRows
      .map((row) => String(row.siret || '').trim())
      .filter(Boolean)

    for (const chunk of chunkArray(validSirets, DB_CHUNK_SIZE)) {
      const { data: existingRows, error: existingError } = await supabase
        .from('clients')
        .select('siret')
        .in('siret', chunk)

      if (existingError) throw existingError

      for (const existing of existingRows || []) {
        if (existing?.siret) existingSirets.add(String(existing.siret))
      }
    }

    const rowsToInsert = validRows.filter((row) => !existingSirets.has(String(row.siret)))
    const alreadyPresentRows = validRows.filter((row) => existingSirets.has(String(row.siret)))

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('clients')
        .upsert(rowsToInsert, { onConflict: 'siret' })

      if (insertError) {
        throw insertError
      }
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
        const { error: rejectInsertError } = await supabase
          .from('imports_clients_rejets')
          .insert(chunk)

        if (rejectInsertError) {
          console.error('Erreur insert imports_clients_rejets:', rejectInsertError)
        }
      }
    }

    const { error: updateImportError } = await supabase
      .from('imports_clients')
      .update({
        nb_lignes_source: totalFetched,
        nb_importees: rowsToInsert.length,
        nb_mises_a_jour: 0,
        nb_rejets: rejectRows.length,
        commentaire:
          `Import API SIRENE - q=${q}` +
          ` - présents=${alreadyPresentRows.length}` +
          ` - filtres=${rejectedByFilter.length}`,
      })
      .eq('id', importId)

    if (updateImportError) {
      console.error('Erreur update imports_clients:', updateImportError)
    }

    return NextResponse.json({
      success: true,
      total_api_after_department_filter: etablissementsFiltres.length,
      fetched: totalFetched,
      pages: pageCount,
      api_total: totalAvailable,
      q,
      imported: rowsToInsert.length,
      already_present: alreadyPresentRows.length,
      rejected_by_filter: rejectedByFilter.length,
      rejected_total: rejectRows.length,
      import_id: importId,
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