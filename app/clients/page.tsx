'use client'

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { supabase } from '@/lib/supabaseClient'
import { useSocieteFilter } from '@/components/SocieteFilterContext'

type ImportRow = {
  id: string
  nom_fichier: string
  type_import: string
  nb_lignes_source: number
  nb_importees: number
  nb_mises_a_jour: number
  nb_rejets: number
  date_import: string
  commentaire: string | null
}

type RejectInsertRow = {
  import_id: string
  ligne_numero: number
  siret: string | null
  motif_rejet: string
  donnees_source_json: Record<string, unknown> | null
  created_at: string
}

type SireneImportParamRow = {
  id: string
  codes_ape: string[] | null
  departements: string[] | null
  date_creation_min: string | null
  date_creation_max: string | null
  date_modification_min: string | null
  date_modification_max: string | null
  last_import_at: string | null
  updated_at: string | null
}

type UserDepartmentAccessRow = {
  email: string
  allowed_departements: string[] | null
}

type TerritoryRow = {
  code_dep: string | null
  societe: string | null
}

type ClientCountRow = {
  siret: string | null
  codePostalEtablissement: string | null
  departement: string | null
}

type ClientCegeclimCountRow = {
  siret: string | null
  cp_sage: string | null
}

type SireneParamsForm = {
  codesApe: string
  departements: string
  dateCreationMin: string
  dateCreationMax: string
  dateMajMin: string
  dateMajMax: string
}

type CsvRawRow = Record<string, unknown>

type ClientUpsertRow = {
  siret: string | null
  raison_sociale_affichee: string | null
  activitePrincipaleEtablissement: string | null
  naf_libelle_traduit: string | null
  dateCreationEtablissement: string | null
  codePostalEtablissement: string | null
  libelleCommuneEtablissement: string | null
  departement: string | null
  adresse_complete: string | null
  coordonneeLambertAbscisseEtablissement: number | null
  coordonneeLambertOrdonneeEtablissement: number | null
  trancheEffectifsEtablissement: string | null
  nom_dirigeant: string | null
  contactable: boolean | null
  enrichment_status: string | null
  date_import: string
  source_import: string
  telephone: string | null
  email: string | null
  site_web: string | null
  effectif_estime: number | null
  ca_estime: number | null
  pappers_ca: number | null
  pappers_resultat: number | null
  rge: boolean | null
  potentiel_score: number | null
  enrichment_source: string | null
  enrichment_error: string | null
  google_maps_url: string | null
  google_rating: number | null
  google_user_ratings_total: number | null
  present_dans_cegeclim: string | null
  prospect_status: string | null
  assigned_to: string | null
  last_contact_at: string | null
  next_action_at: string | null
  next_action_label: string | null
  prospect_comment: string | null
}

const UPSERT_CHUNK_SIZE = 500
const IMPORT_TYPES = ['entreprise_france', 'api_sirene']

function normalizeSiret(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').trim()
}

function normalizeScopeValue(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeArray(value: string | null | undefined): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseMaybeDate(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [d, m, y] = raw.split('/')
    return `${y}-${m}-${d}`
  }
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function firstNonEmpty(...values: Array<unknown>) {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return null
}

function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function getDepartmentFromPostalCode(cp: string | null | undefined): string | null {
  const value = String(cp || '').trim()
  if (!value) return null
  if (/^\d{5}$/.test(value)) {
    if (value.startsWith('97') || value.startsWith('98')) return value.slice(0, 3)
    return value.slice(0, 2)
  }
  return null
}

function translateNaf(activitePrincipaleEtablissement: string | null): string {
  const code = (activitePrincipaleEtablissement || '').replace(/\s/g, '').toUpperCase()
  if (!code) return 'AUTRES'
  if (code.startsWith('43.22B') || code.startsWith('4322B')) return 'Installateur CVC'
  if (code.startsWith('43.22A') || code.startsWith('4322A')) return 'Plomberie'
  if (code.startsWith('43.21') || code.startsWith('4321')) return 'Electricité ENR'
  if (code.startsWith('41.20') || code.startsWith('4120')) return 'CMI'
  if (code.startsWith('43.99') || code.startsWith('4399')) return 'Bâtiment'
  return 'AUTRES'
}

function buildAdresseComplete(row: CsvRawRow) {
  const parts = [
    String(row.numeroVoieEtablissement ?? '').trim(),
    String(row.typeVoieEtablissement ?? '').trim(),
    String(row.libelleVoieEtablissement ?? '').trim(),
    String(row.complementAdresseEtablissement ?? '').trim(),
    String(row.codePostalEtablissement ?? '').trim(),
    String(row.libelleCommuneEtablissement ?? '').trim(),
  ].filter(Boolean)

  return parts.join(' ') || null
}

function buildRaisonSociale(row: CsvRawRow) {
  return (
    firstNonEmpty(
      row.denominationUniteLegale,
      row.denominationUsuelleEtablissement,
      [row.nomUniteLegale, row.prenom1UniteLegale].filter(Boolean).join(' ')
    ) || null
  )
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function formatDateInput(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
    return ''
  }
  return d.toISOString().slice(0, 10)
}

function formatDateFr(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('fr-FR')
}

function buildDefaultSireneParams(lastImport: ImportRow | null): SireneParamsForm {
  const defaultMin = lastImport?.date_import ? formatDateInput(lastImport.date_import) : ''
  return {
    codesApe: '',
    departements: '',
    dateCreationMin: defaultMin,
    dateCreationMax: new Date().toISOString().slice(0, 10),
    dateMajMin: '',
    dateMajMax: '',
  }
}

function StatCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statTitle}>{title}</div>
      <div style={styles.statValue}>{value}</div>
    </div>
  )
}

export default function ClientsPage() {
  const { societeFilter } = useSocieteFilter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [loading, setLoading] = useState(true)
  const [importingApi, setImportingApi] = useState(false)
  const [savingSireneParams, setSavingSireneParams] = useState(false)
  const [uploadingCsv, setUploadingCsv] = useState(false)

  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
  const [allowedDepartements, setAllowedDepartements] = useState<string[]>([])

  const [clientRows, setClientRows] = useState<ClientCountRow[]>([])
  const [clientCegeclimRows, setClientCegeclimRows] = useState<ClientCegeclimCountRow[]>([])
  const [territories, setTerritories] = useState<TerritoryRow[]>([])

  const [lastImport, setLastImport] = useState<ImportRow | null>(null)
  const [lastApiImportAt, setLastApiImportAt] = useState<string | null>(null)
  const [sireneConfigId, setSireneConfigId] = useState<string | null>(null)
  const [showImportsSection, setShowImportsSection] = useState(true)

  const [sireneParams, setSireneParams] = useState<SireneParamsForm>(buildDefaultSireneParams(null))

  const normalizedSocieteFilter = useMemo(() => normalizeScopeValue(societeFilter), [societeFilter])

  useEffect(() => {
    void loadPage()
  }, [])

  async function loadPage() {
    setLoading(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      const userEmail = session?.user?.email?.toLowerCase().trim() || null
      setCurrentUserEmail(userEmail)

      const [
        clientsRes,
        clientsCegeclimRes,
        territoriesRes,
        importRes,
        sireneParamsRes,
        userAccessRes,
      ] = await Promise.all([
        supabase.from('clients').select('siret, codePostalEtablissement, departement'),
        supabase.from('clients_cegeclim').select('siret, cp_sage'),
        supabase.from('territories').select('code_dep, societe'),
        supabase
          .from('imports_clients')
          .select('*')
          .in('type_import', IMPORT_TYPES)
          .order('date_import', { ascending: false })
          .limit(1),
        supabase.from('import_sirene_params').select('*').order('updated_at', { ascending: false }).limit(1),
        userEmail
          ? supabase
              .from('user_page_access')
              .select('email, allowed_departements')
              .eq('email', userEmail)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])

      if (clientsRes.error) throw clientsRes.error
      if (clientsCegeclimRes.error) throw clientsCegeclimRes.error
      if (territoriesRes.error) throw territoriesRes.error
      if (importRes.error) throw importRes.error
      if (sireneParamsRes.error) throw sireneParamsRes.error
      if ((userAccessRes as any).error) throw (userAccessRes as any).error

      setClientRows((clientsRes.data || []) as ClientCountRow[])
      setClientCegeclimRows((clientsCegeclimRes.data || []) as ClientCegeclimCountRow[])
      setTerritories((territoriesRes.data || []) as TerritoryRow[])

      const latestImport = (importRes.data?.[0] || null) as ImportRow | null
      setLastImport(latestImport)

      const sireneConfig = (sireneParamsRes.data?.[0] || null) as SireneImportParamRow | null
      const latestApiImport =
        formatDateInput(sireneConfig?.last_import_at) ||
        (latestImport?.type_import === 'api_sirene' ? formatDateInput(latestImport.date_import) : '')
      setLastApiImportAt(latestApiImport || null)

      if (sireneConfig) {
        setSireneConfigId(sireneConfig.id)
        setSireneParams({
        codesApe: (sireneConfig.codes_ape || []).join(', '),
        departements: (sireneConfig.departements || []).join(', '),
        dateCreationMin: latestApiImport || formatDateInput(sireneConfig.date_creation_min),
        dateCreationMax: formatDateInput(sireneConfig.date_creation_max),
        dateMajMin: formatDateInput(sireneConfig.date_modification_min),
        dateMajMax: formatDateInput(sireneConfig.date_modification_max),
})
      } else {
        setSireneConfigId(null)
        setSireneParams(buildDefaultSireneParams(latestImport))
      }

      const userAccess = (userAccessRes as any).data as UserDepartmentAccessRow | null
      setAllowedDepartements(
        Array.isArray(userAccess?.allowed_departements)
          ? userAccess!.allowed_departements.map((d) => String(d || '').trim()).filter(Boolean)
          : []
      )
    } catch (error: any) {
      console.error(error)
      alert("Erreur lors du chargement de l'écran.")
    } finally {
      setLoading(false)
    }
  }

  async function persistSireneParams(params: SireneParamsForm, forcedLastImportAt?: string | null) {
    const payload = {
      codes_ape: normalizeArray(params.codesApe),
      departements: normalizeArray(params.departements),
      date_creation_min: params.dateCreationMin || null,
      date_creation_max: params.dateCreationMax || null,
      date_modification_min: params.dateMajMin || null,
      date_modification_max: params.dateMajMax || null,
      last_import_at: forcedLastImportAt ?? lastApiImportAt ?? null,
      updated_at: new Date().toISOString(),
    }

    if (sireneConfigId) {
      const { error } = await supabase.from('import_sirene_params').update(payload).eq('id', sireneConfigId)
      if (error) throw error
    } else {
      const { data, error } = await supabase.from('import_sirene_params').insert(payload).select('id').single()
      if (error) throw error
      setSireneConfigId(data.id as string)
    }
  }

  async function saveSireneParams() {
    setSavingSireneParams(true)
    try {
      await persistSireneParams(sireneParams)
      alert('Paramètres API Sirene enregistrés.')
    } catch (error) {
      console.error(error)
      alert('Erreur lors de la sauvegarde des paramètres API Sirene.')
    } finally {
      setSavingSireneParams(false)
    }
  }

  async function finalizeSireneParamsAfterApiImport(importDate: string, sourceParams: SireneParamsForm) {
  const nextParams: SireneParamsForm = {
    ...sourceParams,
    dateCreationMin: importDate,
    dateCreationMax: '',
  }

  await persistSireneParams(nextParams, importDate)
  setLastApiImportAt(importDate)
  setSireneParams(nextParams)
}

  async function launchImportSirene() {
    setImportingApi(true)
    setSavingSireneParams(true)

    try {
      const paramsBeforeImport: SireneParamsForm = {
  ...sireneParams,
}

      setSireneParams(paramsBeforeImport)
      await persistSireneParams(paramsBeforeImport)

      const res = await fetch('/api/import-sirene', { method: 'POST' })
      const text = await res.text()

      let data: any
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(text)
      }

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Erreur import SIRENE')
      }

      alert(
        `Import terminé\n` +
          `Importés : ${data.imported ?? data.total ?? 0}\n` +
          `Déjà présents : ${data.already_present ?? 0}\n` +
          `Rejets : ${data.rejected_total ?? data.rejected_by_filter ?? 0}\n` +
          `Pages lues : ${data.pages || 0}\n` +
          `Enregistrements parcourus : ${data.fetched || 0}`
      )

      await finalizeSireneParamsAfterApiImport(new Date().toISOString().slice(0, 10), paramsBeforeImport)
      await loadPage()
    } catch (error: any) {
      console.error(error)
      alert('Erreur import : ' + (error?.message || String(error)))
    } finally {
      setSavingSireneParams(false)
      setImportingApi(false)
    }
  }

  function mapCsvRowToClient(row: CsvRawRow): ClientUpsertRow | null {
    const siret = normalizeSiret(row.siret)
    if (!siret) return null

    const raisonSociale = buildRaisonSociale(row)
    const codePostal = firstNonEmpty(row.codePostalEtablissement)
    const departement = getDepartmentFromPostalCode(codePostal)
    const apeFinal = firstNonEmpty(row.activitePrincipaleEtablissement, row.activitePrincipaleUniteLegale) || null
    const nomDirigeant = firstNonEmpty([row.prenom1UniteLegale, row.nomUniteLegale].filter(Boolean).join(' ')) || null

    return {
      siret,
      raison_sociale_affichee: raisonSociale,
      activitePrincipaleEtablissement: apeFinal,
      naf_libelle_traduit: apeFinal ? translateNaf(apeFinal) : null,
      dateCreationEtablissement: parseMaybeDate(row.dateCreationEtablissement),
      codePostalEtablissement: codePostal,
      libelleCommuneEtablissement: firstNonEmpty(row.libelleCommuneEtablissement),
      departement,
      adresse_complete: buildAdresseComplete(row),
      coordonneeLambertAbscisseEtablissement: parseNumeric(row.coordonneeLambertAbscisseEtablissement),
      coordonneeLambertOrdonneeEtablissement: parseNumeric(row.coordonneeLambertOrdonneeEtablissement),
      trancheEffectifsEtablissement: firstNonEmpty(row.trancheEffectifsEtablissement),
      nom_dirigeant: nomDirigeant,
      contactable: false,
      enrichment_status: 'a_faire',
      date_import: new Date().toISOString(),
      source_import: 'entreprise_france',
      telephone: null,
      email: null,
      site_web: null,
      effectif_estime: null,
      ca_estime: null,
      pappers_ca: null,
      pappers_resultat: null,
      rge: null,
      potentiel_score: null,
      enrichment_source: 'entreprise_france',
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

  async function handleCsvSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploadingCsv(true)

    try {
      const parsed = await new Promise<Papa.ParseResult<CsvRawRow>>((resolve, reject) => {
        Papa.parse<CsvRawRow>(file, {
          header: true,
          skipEmptyLines: true,
          complete: resolve,
          error: reject,
        })
      })

      const rows = parsed.data || []
      const rejects: RejectInsertRow[] = []
      const mappedRows: ClientUpsertRow[] = []

      rows.forEach((rawRow, index) => {
        const mapped = mapCsvRowToClient(rawRow)
        if (!mapped) {
          rejects.push({
            import_id: '',
            ligne_numero: index + 1,
            siret: normalizeSiret(rawRow.siret) || null,
            motif_rejet: 'SIRET absent ou invalide',
            donnees_source_json: rawRow,
            created_at: new Date().toISOString(),
          })
          return
        }
        mappedRows.push(mapped)
      })

      const uniqueMap = new Map<string, ClientUpsertRow>()
      for (const row of mappedRows) {
        if (row.siret) uniqueMap.set(row.siret, row)
      }
      const finalRows = Array.from(uniqueMap.values())

      const existingSirets = new Set<string>()
      for (const chunk of chunkArray(finalRows.map((row) => row.siret as string), UPSERT_CHUNK_SIZE)) {
        const { data, error } = await supabase.from('clients').select('siret').in('siret', chunk)
        if (error) throw error
        for (const item of data || []) {
          if (item?.siret) existingSirets.add(String(item.siret))
        }
      }

      const { data: importHeader, error: importHeaderError } = await supabase
        .from('imports_clients')
        .insert({
          nom_fichier: file.name,
          type_import: 'entreprise_france',
          nb_lignes_source: rows.length,
          nb_importees: 0,
          nb_mises_a_jour: 0,
          nb_rejets: rejects.length,
          date_import: new Date().toISOString(),
          commentaire: 'Import manuel CSV Entreprise France',
        })
        .select('id')
        .single()

      if (importHeaderError) throw importHeaderError
      const importId = String(importHeader.id)

      for (const reject of rejects) {
        reject.import_id = importId
      }

      for (const chunk of chunkArray(finalRows, UPSERT_CHUNK_SIZE)) {
        const { error } = await supabase.from('clients').upsert(chunk, { onConflict: 'siret' })
        if (error) throw error
      }

      if (rejects.length > 0) {
        for (const chunk of chunkArray(rejects, UPSERT_CHUNK_SIZE)) {
          const { error } = await supabase.from('imports_clients_rejets').insert(chunk)
          if (error) throw error
        }
      }

      const updatedCount = finalRows.filter((row) => row.siret && existingSirets.has(row.siret)).length
      const insertedCount = finalRows.length - updatedCount

      const { error: updateHeaderError } = await supabase
        .from('imports_clients')
        .update({
          nb_importees: insertedCount,
          nb_mises_a_jour: updatedCount,
          nb_rejets: rejects.length,
          commentaire: `Import manuel CSV - insérés=${insertedCount} - maj=${updatedCount} - rejets=${rejects.length}`,
        })
        .eq('id', importId)

      if (updateHeaderError) throw updateHeaderError

      alert(
        `Import CSV terminé\n` +
          `Lignes source : ${rows.length}\n` +
          `Insérés : ${insertedCount}\n` +
          `Mis à jour : ${updatedCount}\n` +
          `Rejets : ${rejects.length}`
      )

      await loadPage()
    } catch (error: any) {
      console.error(error)
      alert('Erreur import CSV : ' + (error?.message || String(error)))
    } finally {
      setUploadingCsv(false)
    }
  }

  const scopedDepartmentSet = useMemo(() => {
    if (normalizedSocieteFilter === 'global') return null

    return new Set(
      territories
        .filter((row) => normalizeScopeValue(row.societe) === normalizedSocieteFilter)
        .map((row) => String(row.code_dep || '').trim())
        .filter(Boolean)
    )
  }, [territories, normalizedSocieteFilter])

  const profileDepartmentSet = useMemo(() => {
    if (allowedDepartements.length === 0) return null
    return new Set(allowedDepartements)
  }, [allowedDepartements])

  function isAllowedDepartment(dep: string | null | undefined) {
    const department = String(dep || '').trim()
    if (!department) return false
    if (scopedDepartmentSet && !scopedDepartmentSet.has(department)) return false
    if (profileDepartmentSet && !profileDepartmentSet.has(department)) return false
    return true
  }

  const scopedClientRows = useMemo(() => {
    return clientRows.filter((row) => {
      const dep = getDepartmentFromPostalCode(row.codePostalEtablissement) || String(row.departement || '').trim()
      return isAllowedDepartment(dep)
    })
  }, [clientRows, scopedDepartmentSet, profileDepartmentSet])

  const scopedCegeclimRows = useMemo(() => {
    return clientCegeclimRows.filter((row) => {
      const dep = getDepartmentFromPostalCode(row.cp_sage)
      return isAllowedDepartment(dep)
    })
  }, [clientCegeclimRows, scopedDepartmentSet, profileDepartmentSet])

  const clientKpis = useMemo(() => {
    const clientSiretSet = new Set(
      scopedClientRows.map((row) => normalizeSiret(row.siret)).filter(Boolean)
    )

    const cegeclimMissing = scopedCegeclimRows.filter((row) => {
      const siret = normalizeSiret(row.siret)
      return siret ? !clientSiretSet.has(siret) : false
    })

    return {
      clientsCount: scopedClientRows.length,
      cegeclimCount: scopedCegeclimRows.length,
      cegeclimMissingCount: cegeclimMissing.length,
    }
  }, [scopedClientRows, scopedCegeclimRows])

  if (loading) {
    return <div style={{ padding: 24 }}>Chargement de la page...</div>
  }

  return (
    <section style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>Mise à jour Base Clients</h1>
        <div style={styles.pageSubline}>
          Départements visibles selon votre profil : {allowedDepartements.join(', ') || 'Tous'} • {currentUserEmail || ''}
        </div>
      </div>

      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>Synthèse</h2>
        <div style={styles.kpiGrid}>
          <StatCard title="Entreprises base Clients" value={clientKpis.clientsCount} />
          <StatCard title="Entreprise base CEGECLIM" value={clientKpis.cegeclimCount} />
          <StatCard title="Clients CEGECLIM absent base Clients" value={clientKpis.cegeclimMissingCount} />
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.sectionHeaderRow}>
          <h2 style={styles.sectionTitle}>Section Imports</h2>
          <button
            type="button"
            onClick={() => setShowImportsSection((prev) => !prev)}
            style={styles.secondaryButton}
          >
            {showImportsSection ? 'Réduire' : 'Afficher'}
          </button>
        </div>

        {showImportsSection && (
          <>
            <div style={styles.importHeaderText}>Données relatives à la dernière importation du fichier</div>

            <div style={styles.kpiGrid}>
              <StatCard title="Date dernier import" value={lastImport ? formatDateFr(lastImport.date_import) : '—'} />
              <StatCard title="Nb enreg. insérées dernier import" value={lastImport?.nb_importees ?? 0} />
              <StatCard title="Nb enreg. rejetées dernier import" value={lastImport?.nb_rejets ?? 0} />
            </div>

            <div style={styles.importOptionsGrid}>
              <div style={styles.importBox}>
                <h3 style={styles.optionTitle}>Option 1 : Import automatique via API Sirene</h3>
                <div style={styles.optionText}>Prépare les paramètres à stocker en base avant de brancher l’API.</div>

                <div style={styles.formGrid}>
                  <div>
                    <label style={styles.label}>Date création min</label>
                    <input
                      type="date"
                      value={sireneParams.dateCreationMin}
                      onChange={(e) => setSireneParams((prev) => ({ ...prev, dateCreationMin: e.target.value }))}
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>Date création max</label>
                    <input
                      type="date"
                      value={sireneParams.dateCreationMax}
                      onChange={(e) => setSireneParams((prev) => ({ ...prev, dateCreationMax: e.target.value }))}
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>Date modification min</label>
                    <input
                      type="date"
                      value={sireneParams.dateMajMin}
                      onChange={(e) => setSireneParams((prev) => ({ ...prev, dateMajMin: e.target.value }))}
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>Date modification max</label>
                    <input
                      type="date"
                      value={sireneParams.dateMajMax}
                      onChange={(e) => setSireneParams((prev) => ({ ...prev, dateMajMax: e.target.value }))}
                      style={styles.input}
                    />
                  </div>

                  <div style={{ gridColumn: '1 / span 2' }}>
                    <label style={styles.label}>Codes APE</label>
                    <input
                      value={sireneParams.codesApe}
                      onChange={(e) => setSireneParams((prev) => ({ ...prev, codesApe: e.target.value }))}
                      style={styles.input}
                    />
                    <div style={styles.helpText}>Valeurs séparées par des virgules.</div>
                  </div>
                </div>

                <div style={styles.buttonRow}>
                  <button type="button" onClick={saveSireneParams} style={styles.primaryButton} disabled={savingSireneParams || importingApi}>
                    {savingSireneParams && !importingApi ? 'Enregistrement...' : 'Enregistrer les paramètres'}
                  </button>
                  <button type="button" onClick={launchImportSirene} style={styles.secondaryButton} disabled={savingSireneParams || importingApi}>
                    {importingApi ? 'Import en cours...' : 'Lancer import API'}
                  </button>
                </div>
              </div>

              <div style={styles.importBox}>
                <h3 style={styles.optionTitle}>Option 2 : Import manuel via CSV</h3>
                <div style={styles.optionText}>Conserve le fonctionnement actuel pour alimenter la table clients.</div>

                <div style={styles.uploadRow}>
                  <div style={styles.uploadLabel}>Importer un CSV Entreprise France</div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={styles.primaryButton}
                    disabled={uploadingCsv}
                  >
                    {uploadingCsv ? 'Import en cours...' : 'Choisir un fichier'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleCsvSelected}
                    style={{ display: 'none' }}
                  />
                </div>

                <div style={{ marginTop: 18 }}>
                  https://annuaire-entreprises.data.gouv.fr/export-sirene
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 20 },
  pageHeader: {
    marginBottom: 16,
    borderBottom: '2px solid #111827',
    paddingBottom: 8,
  },
  pageTitle: {
    margin: 0,
    fontSize: 26,
    fontWeight: 800,
    color: '#111827',
  },
  pageSubline: {
    marginTop: 8,
    color: '#475569',
    fontSize: 14,
  },
  card: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 22,
    padding: 18,
    boxShadow: '0 8px 24px rgba(15,23,42,0.06)',
    marginBottom: 16,
  },
  sectionHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 20,
    fontWeight: 800,
    color: '#111827',
  },
  importHeaderText: {
    marginTop: 10,
    marginBottom: 14,
    color: '#374151',
    fontWeight: 600,
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(220px, 1fr))',
    gap: 16,
    marginTop: 12,
  },
  statCard: {
    background: '#f8fafc',
    border: '1px solid #dbe2ea',
    borderRadius: 18,
    padding: '14px 18px',
    minHeight: 82,
  },
  statTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#111827',
    marginBottom: 6,
  },
  statValue: {
    fontSize: 22,
    fontWeight: 800,
    color: '#111827',
  },
  importOptionsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 18,
    marginTop: 18,
  },
  importBox: {
    border: '1px solid #dbe2ea',
    borderRadius: 18,
    background: '#f8fafc',
    padding: 18,
  },
  optionTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 800,
    color: '#111827',
  },
  optionText: {
    marginTop: 8,
    color: '#475569',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    marginTop: 18,
  },
  label: {
    display: 'block',
    marginBottom: 6,
    fontWeight: 700,
    color: '#111827',
  },
  input: {
    width: '100%',
    borderRadius: 12,
    border: '1px solid #cbd5e1',
    padding: '11px 12px',
    fontSize: 16,
    background: '#fff',
  },
  helpText: {
    marginTop: 6,
    color: '#64748b',
    fontSize: 13,
  },
  buttonRow: {
    display: 'flex',
    gap: 10,
    marginTop: 18,
  },
  primaryButton: {
    border: '1px solid #54708b',
    background: '#6b7280',
    color: '#fff',
    borderRadius: 10,
    padding: '10px 14px',
    cursor: 'pointer',
    fontWeight: 700,
  },
  secondaryButton: {
    border: '1px solid #cbd5e1',
    background: '#fff',
    color: '#111827',
    borderRadius: 10,
    padding: '10px 14px',
    cursor: 'pointer',
    fontWeight: 700,
  },
  uploadRow: {
    marginTop: 20,
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    background: '#eef2f7',
    padding: 14,
  },
  uploadLabel: {
    fontSize: 16,
    color: '#111827',
  },
}
