'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import { useSocieteFilter } from '@/components/SocieteFilterContext'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

type Territory = {
  id: string
  code_dep: string | null
  nom: string | null
  region: string | null
  societe: string | null
  rattachement_agence: string | null
  population: number | null
  superficie: number | null
  logements_2022: number | null
  part_res_principales_2022: number | null
  revenu_median_2021: number | null
  logements_commences_2025_estimes: number | null
  logements_commences_2023_ref_admin: number | null
  potentiel_remplacement_pac_an: number | null
  potentiel_neuf_pac_an: number | null
  potentiel_total: number | null
  marche_theorique_eur: number | null
  indice_potentiel_100: number | null
  indice_revenu_100: number | null
  score_attractivite: number | null
  rang: number | null
  source_population: string | null
  source_logements: string | null
  source_revenu: string | null
  source_doc: string | null
}

type SortKey =
  | 'code_dep'
  | 'nom'
  | 'region'
  | 'societe'
  | 'population'
  | 'potentiel_total'
  | 'score_attractivite'
  | 'rang'

type RegionSummary = {
  label: string
  departementCount: number
  population: number
  potentiel: number
  attractivite: number
}

const REGION_ORDER = [
  'Nouvelle-Aquitaine',
  'Pays de Loire',
  'Bretagne',
  'Normandie',
]

function fmtNumber(value: number | null | undefined, digits = 0) {
  if (value == null) return ''
  return value.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function scoreColor(score: number) {
  if (score >= 60) return '#8ee183'
  if (score >= 45) return '#cdd373'
  return '#e0b2b2'
}

function normalizeRegion(region: string | null | undefined) {
  return (region || '').trim()
}

function normalizeSociete(societe: string | null | undefined) {
  return (societe || '').trim().toLowerCase()
}

function isSocieteMatch(
  rowSociete: string | null | undefined,
  societeFilter: 'Global' | 'Cegeclim' | 'CVC PdL'
) {
  if (societeFilter === 'Global') return true

  const value = normalizeSociete(rowSociete)

  if (societeFilter === 'Cegeclim') {
    return value === 'cegeclim'
  }

  if (societeFilter === 'CVC PdL') {
    return value === 'cvc' || value === 'cvc pdl' || value === 'cvc pdl' || value === 'cvc pdl'
  }

  return true
}

function buildRegionSummaries(rows: Territory[]): RegionSummary[] {
  const summariesByRegion = REGION_ORDER.map((regionLabel) => {
    const regionRows = rows.filter(
      (row) => normalizeRegion(row.region) === regionLabel
    )

    const scores = regionRows
      .map((row) => row.score_attractivite)
      .filter((v): v is number => v != null)

    return {
      label: regionLabel,
      departementCount: regionRows.length,
      population: regionRows.reduce((sum, row) => sum + (row.population || 0), 0),
      potentiel: regionRows.reduce((sum, row) => sum + (row.potentiel_total || 0), 0),
      attractivite:
        scores.length > 0
          ? scores.reduce((sum, value) => sum + value, 0) / scores.length
          : 0,
    }
  })

  const totalScores = rows
    .map((row) => row.score_attractivite)
    .filter((v): v is number => v != null)

  const total: RegionSummary = {
    label: 'Total',
    departementCount: rows.length,
    population: rows.reduce((sum, row) => sum + (row.population || 0), 0),
    potentiel: rows.reduce((sum, row) => sum + (row.potentiel_total || 0), 0),
    attractivite:
      totalScores.length > 0
        ? totalScores.reduce((sum, value) => sum + value, 0) / totalScores.length
        : 0,
  }

  return [total, ...summariesByRegion]
}

function isValidUrl(value: string | null | undefined) {
  if (!value) return false

  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

export default function TerritoirePage() {
  const router = useRouter()
  const { societeFilter } = useSocieteFilter()

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Territory[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('rang')
  const [sortAsc, setSortAsc] = useState(true)
  const [selected, setSelected] = useState<Territory | null>(null)

  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Territory>>({})

  const [codeDep, setCodeDep] = useState('')
  const [nom, setNom] = useState('')
  const [region, setRegion] = useState('')
  const [societe, setSociete] = useState('')
  const [population, setPopulation] = useState('')
  const [potentielTotal, setPotentielTotal] = useState('')
  const [scoreAttractivite, setScoreAttractivite] = useState('')

  const loadRows = async () => {
    const { data, error } = await supabase.from('territories').select('*')

    if (error) {
      setErrorMsg(error.message)
      setRows([])
    } else {
      setRows((data as Territory[]) || [])
      setErrorMsg('')
    }
  }

  useEffect(() => {
    const init = async () => {
      const { data, error } = await supabase.auth.getUser()

      if (error || !data.user) {
        router.replace('/login')
        return
      }

      await loadRows()
      setLoading(false)
    }

    init()
  }, [router])

  const handleAdd = async () => {
    setErrorMsg('')

    if (!nom.trim()) {
      setErrorMsg('Le nom du territoire est obligatoire.')
      return
    }

    const payload = {
      code_dep: codeDep.trim() || null,
      nom: nom.trim(),
      region: region.trim() || null,
      societe: societe.trim() || null,
      population: population ? Number(population) : null,
      potentiel_total: potentielTotal ? Number(potentielTotal) : null,
      score_attractivite: scoreAttractivite ? Number(scoreAttractivite) : null,
    }

    const { error } = await supabase.from('territories').insert(payload)

    if (error) {
      setErrorMsg(error.message)
      return
    }

    setCodeDep('')
    setNom('')
    setRegion('')
    setSociete('')
    setPopulation('')
    setPotentielTotal('')
    setScoreAttractivite('')

    await loadRows()
  }

  const handleDelete = async (id: string) => {
    const ok = window.confirm('Supprimer cet enregistrement ?')
    if (!ok) return

    const { error } = await supabase.from('territories').delete().eq('id', id)

    if (error) {
      setErrorMsg(error.message)
      return
    }

    await loadRows()
  }

  const handleOpenDetail = (row: Territory) => {
    setSelected(row)
    setIsEditing(false)
    setEditForm(row)
  }

  const handleSaveEdit = async () => {
    if (!selected) return

    const payload = {
      code_dep: editForm.code_dep?.toString().trim() || null,
      nom: editForm.nom?.toString().trim() || null,
      region: editForm.region?.toString().trim() || null,
      societe: editForm.societe?.toString().trim() || null,
      rattachement_agence: editForm.rattachement_agence?.toString().trim() || null,
      population:
        editForm.population != null
          ? Number(editForm.population)
          : null,
      superficie:
        editForm.superficie != null
          ? Number(editForm.superficie)
          : null,
      logements_2022:
        editForm.logements_2022 != null
          ? Number(editForm.logements_2022)
          : null,
      part_res_principales_2022:
        editForm.part_res_principales_2022 != null
          ? Number(editForm.part_res_principales_2022)
          : null,
      revenu_median_2021:
        editForm.revenu_median_2021 != null
          ? Number(editForm.revenu_median_2021)
          : null,
      logements_commences_2025_estimes:
        editForm.logements_commences_2025_estimes != null
          ? Number(editForm.logements_commences_2025_estimes)
          : null,
      logements_commences_2023_ref_admin:
        editForm.logements_commences_2023_ref_admin != null
          ? Number(editForm.logements_commences_2023_ref_admin)
          : null,
      potentiel_remplacement_pac_an:
        editForm.potentiel_remplacement_pac_an != null
          ? Number(editForm.potentiel_remplacement_pac_an)
          : null,
      potentiel_neuf_pac_an:
        editForm.potentiel_neuf_pac_an != null
          ? Number(editForm.potentiel_neuf_pac_an)
          : null,
      potentiel_total:
        editForm.potentiel_total != null
          ? Number(editForm.potentiel_total)
          : null,
      marche_theorique_eur:
        editForm.marche_theorique_eur != null
          ? Number(editForm.marche_theorique_eur)
          : null,
      indice_potentiel_100:
        editForm.indice_potentiel_100 != null
          ? Number(editForm.indice_potentiel_100)
          : null,
      indice_revenu_100:
        editForm.indice_revenu_100 != null
          ? Number(editForm.indice_revenu_100)
          : null,
      score_attractivite:
        editForm.score_attractivite != null
          ? Number(editForm.score_attractivite)
          : null,
      rang:
        editForm.rang != null
          ? Number(editForm.rang)
          : null,
      source_population: editForm.source_population?.toString().trim() || null,
      source_logements: editForm.source_logements?.toString().trim() || null,
      source_revenu: editForm.source_revenu?.toString().trim() || null,
      source_doc: editForm.source_doc?.toString().trim() || null,
    }

    const { error } = await supabase
      .from('territories')
      .update(payload)
      .eq('id', selected.id)

    if (error) {
      setErrorMsg(error.message)
      return
    }

    await loadRows()

    const updatedSelected = {
      ...selected,
      ...payload,
    } as Territory

    setSelected(updatedSelected)
    setEditForm(updatedSelected)
    setIsEditing(false)
    setErrorMsg('')
  }

  const rowsAfterGlobalFilter = useMemo(() => {
    return rows.filter((row) => isSocieteMatch(row.societe, societeFilter))
  }, [rows, societeFilter])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()

    const filtered = rowsAfterGlobalFilter.filter((row) => {
      if (!q) return true
      return (
        (row.code_dep || '').toLowerCase().includes(q) ||
        (row.nom || '').toLowerCase().includes(q) ||
        (row.region || '').toLowerCase().includes(q) ||
        (row.societe || '').toLowerCase().includes(q)
      )
    })

    return [...filtered].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]

      if (av == null && bv == null) return 0
      if (av == null) return sortAsc ? -1 : 1
      if (bv == null) return sortAsc ? 1 : -1

      if (typeof av === 'number' && typeof bv === 'number') {
        return sortAsc ? av - bv : bv - av
      }

      const as = String(av).toLowerCase()
      const bs = String(bv).toLowerCase()
      if (as < bs) return sortAsc ? -1 : 1
      if (as > bs) return sortAsc ? 1 : -1
      return 0
    })
  }, [rowsAfterGlobalFilter, search, sortKey, sortAsc])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const indicators = useMemo(() => {
    const nb = filteredRows.length
    const population = filteredRows.reduce((sum, r) => sum + (r.population || 0), 0)
    const potentiel = filteredRows.reduce((sum, r) => sum + (r.potentiel_total || 0), 0)

    const scores = filteredRows
      .map((r) => r.score_attractivite)
      .filter((v): v is number => v != null)

    const scoreMoyen =
      scores.length > 0
        ? scores.reduce((sum, v) => sum + v, 0) / scores.length
        : 0

    const ca = filteredRows.reduce(
      (sum, r) => sum + (r.marche_theorique_eur || 0),
      0
    )

    return {
      nb,
      population,
      potentiel,
      scoreMoyen,
      ca,
    }
  }, [filteredRows])

  const regionSummaries = useMemo(() => {
    return buildRegionSummaries(rowsAfterGlobalFilter)
  }, [rowsAfterGlobalFilter])

  const chartData = useMemo(() => {
    return [...filteredRows]
      .filter((r) => r.score_attractivite != null && r.nom)
      .sort((a, b) => (b.score_attractivite || 0) - (a.score_attractivite || 0))
      .slice(0, 12)
      .map((r) => ({
        nom: r.nom as string,
        score: r.score_attractivite as number,
        fill: scoreColor(r.score_attractivite as number),
      }))
  }, [filteredRows])

  if (loading) {
    return <div style={{ padding: 40 }}>Chargement...</div>
  }

  return (
    <>
      <h1 style={{ marginBottom: 18 }}>Territoire</h1>
      <div style={{ marginBottom: 16, color: '#334155', fontSize: 14, fontWeight: 600 }}>
        Vision active : {societeFilter}
      </div>

      <div style={sectionCardStyle}>
        <h2 style={{ marginTop: 0, marginBottom: 16 }}>Synthèse par région</h2>

        <div style={{ overflowX: 'auto' }}>
          <div style={regionSummaryWrapperStyle}>
            <div style={regionSummaryLeftColStyle}>
              <div style={regionSummaryCornerStyle}>Territoire</div>
              {regionSummaries.map((item) => (
                <div
                  key={item.label}
                  style={
                    item.label === 'Total'
                      ? regionSummaryLabelTotalStyle
                      : regionSummaryLabelStyle
                  }
                >
                  {item.label}
                </div>
              ))}
            </div>

            <div style={regionSummaryMetricColStyle}>
              <div style={regionSummaryMetricHeaderStyle}>DÉPARTEMENT</div>
              {regionSummaries.map((item) => (
                <div
                  key={item.label}
                  style={
                    item.label === 'Total'
                      ? regionSummaryMetricValueTotalStyle
                      : regionSummaryMetricValueStyle
                  }
                >
                  {fmtNumber(item.departementCount)}
                </div>
              ))}
            </div>

            <div style={regionSummaryMetricColStyle}>
              <div style={regionSummaryMetricHeaderStyle}>POPULATION CUMULÉE</div>
              {regionSummaries.map((item) => (
                <div
                  key={item.label}
                  style={
                    item.label === 'Total'
                      ? regionSummaryMetricValueTotalStyle
                      : regionSummaryMetricValueStyle
                  }
                >
                  {fmtNumber(item.population)}
                </div>
              ))}
            </div>

            <div style={regionSummaryMetricColStyle}>
              <div style={regionSummaryMetricHeaderStyle}>POTENTIEL PAC/AN</div>
              {regionSummaries.map((item) => (
                <div
                  key={item.label}
                  style={
                    item.label === 'Total'
                      ? regionSummaryMetricValueTotalStyle
                      : regionSummaryMetricValueStyle
                  }
                >
                  {fmtNumber(item.potentiel)}
                </div>
              ))}
            </div>

            <div style={regionSummaryMetricColStyle}>
              <div style={regionSummaryMetricHeaderStyle}>ATTRACTIVITÉ MOYENNE</div>
              {regionSummaries.map((item) => (
                <div
                  key={item.label}
                  style={
                    item.label === 'Total'
                      ? regionSummaryMetricValueTotalStyle
                      : regionSummaryMetricValueStyle
                  }
                >
                  {fmtNumber(item.attractivite, 1)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={cardsGridStyle}>
        <MetricCard title="Départements" value={fmtNumber(indicators.nb)} />
        <MetricCard title="Population cumulée" value={fmtNumber(indicators.population)} />
        <MetricCard title="Potentiel PAC/an" value={fmtNumber(indicators.potentiel)} />
        <MetricCard title="Score attrac. moyen" value={fmtNumber(indicators.scoreMoyen, 1)} />
        <MetricCard title="CA théorique (€)" value={fmtNumber(indicators.ca, 1)} />
      </div>

      <div style={sectionCardStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={{ margin: 0 }}>Top 12 territoires — Score attractivité</h2>
        </div>

        <div style={{ width: '100%', height: 420 }}>
          <ResponsiveContainer>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 10, right: 30, left: 30, bottom: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 100]} />
              <YAxis dataKey="nom" type="category" width={160} />
              <Tooltip formatter={(value) => fmtNumber(Number(value), 1)} />
              <Bar dataKey="score" radius={[0, 8, 8, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={sectionCardStyle}>
        <h2 style={{ marginTop: 0 }}>Ajouter un territoire</h2>

        <div style={formGridStyle}>
          <input placeholder="Code département" value={codeDep} onChange={(e) => setCodeDep(e.target.value)} />
          <input placeholder="Nom" value={nom} onChange={(e) => setNom(e.target.value)} />
          <input placeholder="Région" value={region} onChange={(e) => setRegion(e.target.value)} />
          <input placeholder="Société" value={societe} onChange={(e) => setSociete(e.target.value)} />
          <input placeholder="Population" value={population} onChange={(e) => setPopulation(e.target.value)} />
          <input placeholder="Potentiel total PAC/an" value={potentielTotal} onChange={(e) => setPotentielTotal(e.target.value)} />
          <input placeholder="Score attractivité" value={scoreAttractivite} onChange={(e) => setScoreAttractivite(e.target.value)} />
        </div>

        <div style={{ marginTop: 14 }}>
          <button onClick={handleAdd}>Ajouter</button>
        </div>

        {errorMsg && <p style={{ color: '#b42318', marginTop: 12 }}>{errorMsg}</p>}
      </div>

      <div style={sectionCardStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={{ margin: 0 }}>Enregistrements</h2>
          <input
            placeholder="Rechercher par code, nom, région ou société"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 360, maxWidth: '100%' }}
          />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
            <thead style={{ background: '#eef2f7' }}>
              <tr>
                <SortableTh label="Code dép." col="code_dep" active={sortKey} asc={sortAsc} onSort={toggleSort} />
                <SortableTh label="Nom" col="nom" active={sortKey} asc={sortAsc} onSort={toggleSort} />
                <SortableTh label="Région" col="region" active={sortKey} asc={sortAsc} onSort={toggleSort} />
                <SortableTh label="Société" col="societe" active={sortKey} asc={sortAsc} onSort={toggleSort} />
                <SortableTh label="Population" col="population" active={sortKey} asc={sortAsc} onSort={toggleSort} />
                <SortableTh label="Potentiel PAC/an" col="potentiel_total" active={sortKey} asc={sortAsc} onSort={toggleSort} />
                <SortableTh label="Score attrac." col="score_attractivite" active={sortKey} asc={sortAsc} onSort={toggleSort} />
                <SortableTh label="Rang" col="rang" active={sortKey} asc={sortAsc} onSort={toggleSort} />
                <th style={thStyle}>Détail</th>
                <th style={thStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: 16 }}>
                    Aucune donnée.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{row.code_dep ?? ''}</td>
                    <td style={tdStyle}>{row.nom ?? ''}</td>
                    <td style={tdStyle}>{row.region ?? ''}</td>
                    <td style={tdStyle}>{row.societe ?? ''}</td>
                    <td style={tdStyle}>{fmtNumber(row.population)}</td>
                    <td style={tdStyle}>{fmtNumber(row.potentiel_total)}</td>
                    <td style={tdStyle}>{fmtNumber(row.score_attractivite, 1)}</td>
                    <td style={tdStyle}>{fmtNumber(row.rang)}</td>
                    <td style={tdStyle}>
                      <button onClick={() => handleOpenDetail(row)}>Voir</button>
                    </td>
                    <td style={tdStyle}>
                      <button onClick={() => handleDelete(row.id)}>Supprimer</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div
          style={overlayStyle}
          onClick={() => {
            setSelected(null)
            setIsEditing(false)
          }}
        >
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h2 style={{ margin: 0 }}>
                {selected.nom || 'Territoire'} {selected.code_dep ? `(${selected.code_dep})` : ''}
              </h2>

              <div style={{ display: 'flex', gap: 10 }}>
                {!isEditing ? (
                  <button onClick={() => setIsEditing(true)}>Modifier</button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setIsEditing(false)
                        setEditForm(selected)
                      }}
                    >
                      Annuler
                    </button>
                    <button onClick={handleSaveEdit}>Enregistrer</button>
                  </>
                )}
                <button
                  onClick={() => {
                    setSelected(null)
                    setIsEditing(false)
                  }}
                >
                  Fermer
                </button>
              </div>
            </div>

            <div style={detailGridStyle}>
              <EditableDetailItem
                label="Code département"
                value={editForm.code_dep}
                editing={isEditing}
                onChange={(value) => setEditForm((prev) => ({ ...prev, code_dep: value }))}
              />
              <EditableDetailItem
                label="Nom"
                value={editForm.nom}
                editing={isEditing}
                onChange={(value) => setEditForm((prev) => ({ ...prev, nom: value }))}
              />
              <EditableDetailItem
                label="Région"
                value={editForm.region}
                editing={isEditing}
                onChange={(value) => setEditForm((prev) => ({ ...prev, region: value }))}
              />
              <EditableDetailItem
                label="Société"
                value={editForm.societe}
                editing={isEditing}
                onChange={(value) => setEditForm((prev) => ({ ...prev, societe: value }))}
              />
              <EditableDetailItem
                label="Rattachement agence"
                value={editForm.rattachement_agence}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({ ...prev, rattachement_agence: value }))
                }
              />
              <EditableDetailItem
                label="Population 2022"
                value={editForm.population}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    population: value === '' ? null : Number(value),
                  }))
                }
                type="number"
              />
              <EditableDetailItem
                label="Superficie"
                value={editForm.superficie}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    superficie: value === '' ? null : Number(value),
                  }))
                }
                type="number"
              />
              <EditableDetailItem
                label="Logements 2022"
                value={editForm.logements_2022}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    logements_2022: value === '' ? null : Number(value),
                  }))
                }
                type="number"
              />
              <EditableDetailItem
                label="Part rés. principales 2022"
                value={editForm.part_res_principales_2022}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    part_res_principales_2022: value === '' ? null : Number(value),
                  }))
                }
                type="number"
              />
              <EditableDetailItem
                label="Revenu médian 2021 (€)"
                value={editForm.revenu_median_2021}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    revenu_median_2021: value === '' ? null : Number(value),
                  }))
                }
                type="number"
              />
              <EditableDetailItem
                label="Logements commencés 2025 estimés"
                value={editForm.logements_commences_2025_estimes}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    logements_commences_2025_estimes: value === '' ? null : Number(value),
                  }))
                }
                type="number"
              />
              <EditableDetailItem
                label="Logements commencés 2023 (ref. admin.)"
                value={editForm.logements_commences_2023_ref_admin}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    logements_commences_2023_ref_admin: value === '' ? null : Number(value),
                  }))
                }
                type="number"
              />
              <EditableDetailItem
                label="Potentiel remplacement PAC/an"
                value={editForm.potentiel_remplacement_pac_an}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    potentiel_remplacement_pac_an: value === '' ? null : Number(value),
                  }))
                }
                type="number"
              />
              <EditableDetailItem
                label="Potentiel neuf PAC/an"
                value={editForm.potentiel_neuf_pac_an}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    potentiel_neuf_pac_an: value === '' ? null : Number(value),
                  }))
                }
                type="number"
              />
              <EditableDetailItem
                label="Potentiel total PAC/an"
                value={editForm.potentiel_total}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    potentiel_total: value === '' ? null : Number(value),
                  }))
                }
                type="number"
              />
              <EditableDetailItem
                label="Marché théorique (€)"
                value={editForm.marche_theorique_eur}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    marche_theorique_eur: value === '' ? null : Number(value),
                  }))
                }
                type="number"
              />
              <EditableDetailItem
                label="Indice potentiel (0-100)"
                value={editForm.indice_potentiel_100}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    indice_potentiel_100: value === '' ? null : Number(value),
                  }))
                }
                type="number"
              />
              <EditableDetailItem
                label="Indice revenu (0-100)"
                value={editForm.indice_revenu_100}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    indice_revenu_100: value === '' ? null : Number(value),
                  }))
                }
                type="number"
              />
              <EditableDetailItem
                label="Score attractivité (0-100)"
                value={editForm.score_attractivite}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    score_attractivite: value === '' ? null : Number(value),
                  }))
                }
                type="number"
              />
              <EditableDetailItem
                label="Rang"
                value={editForm.rang}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    rang: value === '' ? null : Number(value),
                  }))
                }
                type="number"
              />

              <DetailLinkItem
                label="Source population"
                value={editForm.source_population}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({ ...prev, source_population: value }))
                }
              />
              <DetailLinkItem
                label="Source logements"
                value={editForm.source_logements}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({ ...prev, source_logements: value }))
                }
              />
              <DetailLinkItem
                label="Source revenu"
                value={editForm.source_revenu}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({ ...prev, source_revenu: value }))
                }
              />
              <DetailLinkItem
                label="Source DOC"
                value={editForm.source_doc}
                editing={isEditing}
                onChange={(value) =>
                  setEditForm((prev) => ({ ...prev, source_doc: value }))
                }
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <div style={metricCardStyle}>
      <div style={metricTitleStyle}>{title}</div>
      <div style={metricValueStyle}>{value}</div>
    </div>
  )
}

function EditableDetailItem({
  label,
  value,
  editing,
  onChange,
  type = 'text',
}: {
  label: string
  value: string | number | null | undefined
  editing: boolean
  onChange: (value: string) => void
  type?: 'text' | 'number'
}) {
  if (editing) {
    return (
      <div style={detailItemStyle}>
        <div style={detailLabelStyle}>{label}</div>
        <input
          type={type}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={detailInputStyle}
        />
      </div>
    )
  }

  return (
    <div style={detailItemStyle}>
      <div style={detailLabelStyle}>{label}</div>
      <div style={detailValueStyle}>
        {typeof value === 'number'
          ? fmtNumber(value, Number.isInteger(value) ? 0 : 1)
          : value || ''}
      </div>
    </div>
  )
}

function DetailLinkItem({
  label,
  value,
  editing,
  onChange,
}: {
  label: string
  value: string | null | undefined
  editing: boolean
  onChange: (value: string) => void
}) {
  if (editing) {
    return (
      <div style={detailItemStyle}>
        <div style={detailLabelStyle}>{label}</div>
        <input
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={detailInputStyle}
        />
      </div>
    )
  }

  return (
    <div style={detailItemStyle}>
      <div style={detailLabelStyle}>{label}</div>
      <div style={detailValueStyle}>
        {isValidUrl(value) ? (
          <a
            href={value as string}
            target="_blank"
            rel="noopener noreferrer"
            style={detailLinkStyle}
          >
            {value}
          </a>
        ) : (
          value || ''
        )}
      </div>
    </div>
  )
}

function SortableTh({
  label,
  col,
  active,
  asc,
  onSort,
}: {
  label: string
  col: SortKey
  active: SortKey
  asc: boolean
  onSort: (key: SortKey) => void
}) {
  const indicator = active === col ? (asc ? ' ▲' : ' ▼') : ''

  return (
    <th
      style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onSort(col)}
    >
      {label}
      {indicator}
    </th>
  )
}

const cardsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, minmax(170px, 1fr))',
  gap: 16,
  marginBottom: 24,
}

const metricCardStyle: React.CSSProperties = {
  border: '1px solid #d0d7de',
  borderRadius: 14,
  padding: '18px 18px',
  background: '#fff',
}

const metricTitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#667085',
  fontWeight: 700,
  textTransform: 'uppercase',
  marginBottom: 10,
}

const metricValueStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: '#101828',
}

const sectionCardStyle: React.CSSProperties = {
  border: '1px solid #d0d7de',
  borderRadius: 14,
  padding: 20,
  marginBottom: 24,
  background: '#fff',
}

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  marginBottom: 16,
  flexWrap: 'wrap',
}

const formGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(180px, 1fr))',
  gap: 12,
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 14px',
  borderBottom: '1px solid #d0d7de',
  fontSize: 14,
}

const tdStyle: React.CSSProperties = {
  padding: '12px 14px',
  borderBottom: '1px solid #e5e7eb',
  fontSize: 14,
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
  padding: 20,
}

const modalStyle: React.CSSProperties = {
  width: 'min(1100px, 100%)',
  maxHeight: '90vh',
  overflowY: 'auto',
  background: '#fff',
  borderRadius: 16,
  padding: 22,
  boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
}

const modalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  marginBottom: 18,
  flexWrap: 'wrap',
}

const detailGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(280px, 1fr))',
  gap: 14,
}

const detailItemStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: 12,
  background: '#f8fafc',
}

const detailLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#667085',
  marginBottom: 6,
  textTransform: 'uppercase',
}

const detailValueStyle: React.CSSProperties = {
  fontSize: 15,
  color: '#101828',
  wordBreak: 'break-word',
}

const regionSummaryWrapperStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '260px repeat(4, minmax(220px, 1fr))',
  gap: 14,
  minWidth: 1100,
  alignItems: 'stretch',
}

const regionSummaryLeftColStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateRows: '54px repeat(5, 64px)',
  alignItems: 'center',
}

const regionSummaryCornerStyle: React.CSSProperties = {
  padding: '8px 0',
  fontSize: 14,
  fontWeight: 700,
  color: '#344054',
}

const regionSummaryLabelStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: '#101828',
  display: 'flex',
  alignItems: 'center',
}

const regionSummaryLabelTotalStyle: React.CSSProperties = {
  ...regionSummaryLabelStyle,
  fontSize: 34,
  color: '#364f84',
}

const regionSummaryMetricColStyle: React.CSSProperties = {
  border: '1px solid #d0d7de',
  borderRadius: 22,
  overflow: 'hidden',
  background: '#fff',
  display: 'grid',
  gridTemplateRows: '54px repeat(5, 64px)',
}

const regionSummaryMetricHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '0 18px',
  fontSize: 13,
  fontWeight: 800,
  color: '#7b8794',
  textTransform: 'uppercase',
  borderBottom: '1px solid #e5e7eb',
}

const regionSummaryMetricValueStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '0 18px',
  fontSize: 18,
  fontWeight: 700,
  color: '#101828',
  borderBottom: '1px solid #e5e7eb',
}

const regionSummaryMetricValueTotalStyle: React.CSSProperties = {
  ...regionSummaryMetricValueStyle,
  fontSize: 38,
  fontWeight: 800,
}

const detailInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #d0d5dd',
  fontSize: 14,
  background: '#fff',
}

const detailLinkStyle: React.CSSProperties = {
  color: '#175cd3',
  textDecoration: 'underline',
  wordBreak: 'break-word',
}