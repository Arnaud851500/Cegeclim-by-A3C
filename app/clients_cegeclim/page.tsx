'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useSocieteFilter } from '@/components/SocieteFilterContext'

type SortDirection = 'asc' | 'desc'
type PresenceFilter = 'TOUS' | 'OUI' | 'NON'
type StatutFilter = 'TOUS' | 'ACTIF' | 'SOMMEIL'
type YesNoFilter = 'TOUS' | 'OUI' | 'NON'
type AxisMode = 'DEPARTEMENT' | 'AGENCE'
type ValueMode = 'VALEUR' | 'POURCENT'
type SynthMetric = 'count' | 'ca_2025'

type ClientsCegeclimRow = {
  id?: string | number | null
  siret?: string | null
  numero_client_sage?: string | null
  designation_commerciale?: string | null
  representant?: string | null
  date_creation?: string | null
  agence?: string | null
  cp_sage?: string | null
  ville_sage?: string | null
  remarque?: string | null
  ca_2023?: number | null
  ca_2024?: number | null
  ca_2025?: number | null
  statut?: string | null
  activite_principale_unite_legale?: string | null
  [key: string]: unknown
}

type ClientBaseRow = {
  id: string | number
  siret: string | null
}

type SynthSortState = {
  metric: SynthMetric
  key: string
  direction: SortDirection
}

function normalizeSiret(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').trim()
}

function normalizeUpper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function getDepartmentFromPostalCode(cp: string | null | undefined): string {
  const value = String(cp || '').trim()
  if (!value) return '999'
  if (/^\d{5}$/.test(value)) {
    if (value.startsWith('97') || value.startsWith('98')) return value.slice(0, 3)
    return value.slice(0, 2)
  }
  return '999'
}

function formatCurrency(value: number | null | undefined): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '0 €'
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(numeric)
}

function formatDateFr(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('fr-FR')
}

function toNumber(value: unknown): number {
  const n = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function getStatutLabel(row: ClientsCegeclimRow): 'ACTIF' | 'SOMMEIL' | 'AUTRE' {
  const raw = normalizeUpper(row.statut)
  if (raw === 'ACTIF') return 'ACTIF'
  if (raw === 'SOMMEIL') return 'SOMMEIL'
  return 'AUTRE'
}

function getDepartmentFromCegeclim(row: ClientsCegeclimRow): string {
  return getDepartmentFromPostalCode(String(row.cp_sage || ''))
}

function getActivityLabel(row: ClientsCegeclimRow): string {
  return String(row.activite_principale_unite_legale || 'NON RENSEIGNÉ').trim() || 'NON RENSEIGNÉ'
}

function compareValues(a: unknown, b: unknown, direction: SortDirection) {
  const aNum = typeof a === 'number' ? a : Number.NaN
  const bNum = typeof b === 'number' ? b : Number.NaN

  let result = 0
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
    result = aNum - bNum
  } else {
    result = String(a ?? '').localeCompare(String(b ?? ''), 'fr', { numeric: true, sensitivity: 'base' })
  }

  return direction === 'asc' ? result : -result
}

function compactSelectionLabel(values: string[], fallback = 'Tous') {
  if (values.length === 0) return fallback
  if (values.length <= 2) return values.join(', ')
  return `${values.length} sélectionnés`
}

function SortIndicator({ active, direction }: { active: boolean; direction: SortDirection }) {
  return <span style={{ marginLeft: 6, color: active ? '#0f172a' : '#94a3b8' }}>{active ? (direction === 'asc' ? '▲' : '▼') : '↕'}</span>
}

function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string
  value: string | number
  subtitle?: string
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #dbe2ea',
        borderRadius: 16,
        padding: '16px 18px',
        boxShadow: '0 4px 14px rgba(15,23,42,0.05)',
        minHeight: 92,
      }}
    >
      <div style={{ fontSize: 13, color: '#475569', fontWeight: 700 }}>{title}</div>
      <div style={{ marginTop: 6, fontSize: 38, lineHeight: 1, fontWeight: 800, color: '#0f172a' }}>{value}</div>
      {subtitle ? <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>{subtitle}</div> : null}
    </div>
  )
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>{title}</h2>
      {subtitle ? <div style={{ marginTop: 4, fontSize: 13, color: '#64748b' }}>{subtitle}</div> : null}
    </div>
  )
}

function ToggleButtonGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (next: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            style={{
              border: 'none',
              padding: '10px 14px',
              background: active ? '#0f172a' : '#fff',
              color: active ? '#fff' : '#0f172a',
              fontWeight: 700,
              cursor: 'pointer',
              minWidth: 110,
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function MultiSelectButtonFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function toggleValue(value: string) {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value))
    else onChange([...selected, value])
  }

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={filterButtonStyle}>
        <span style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 2 }}>{label}</span>
        <span>{compactSelectionLabel(selected, 'Tous')}</span>
      </button>

      {open && (
        <div style={multiPanelStyle}>
          <div style={{ display: 'flex', gap: 3, marginBottom: 5 }}>
            <button type="button" onClick={() => onChange([])} style={miniButtonStyle}>
              Tout effacer
            </button>
            <button type="button" onClick={() => onChange(options)} style={miniButtonStyle}>
              Tout sélectionner
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px' }}>
            {options.map((option) => (
              <label
                key={option}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => toggleValue(option)}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SingleSelectButtonFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={filterButtonStyle}>
        <span style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 2 }}>{label}</span>
        <span>{value || 'Tous'}</span>
      </button>

      {open && (
        <div style={multiPanelStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button type="button" onClick={() => { onChange('TOUS'); setOpen(false) }} style={miniButtonStyle}>
              Tous
            </button>
            {options.map((option) => (
              <button key={option} type="button" onClick={() => { onChange(option); setOpen(false) }} style={miniButtonStyle}>
                {option}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DetailModal({
  row,
  orderedKeys,
  onClose,
  onSave,
}: {
  row: ClientsCegeclimRow | null
  orderedKeys: string[]
  onClose: () => void
  onSave: (next: ClientsCegeclimRow) => Promise<void>
}) {
  const [draft, setDraft] = useState<ClientsCegeclimRow | null>(row)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(row)
  }, [row])

  if (!row || !draft) return null

  const keys = Array.from(new Set([...orderedKeys, ...Object.keys(draft).sort((a, b) => a.localeCompare(b, 'fr'))]))

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={modalHeaderStyle}>
          <div>
            <h3 style={{ margin: 0 }}>Modifier client CEGECLIM</h3>
            <div style={{ marginTop: 4, color: '#64748b', fontSize: 13 }}>
              {draft.designation_commerciale || 'Sans désignation'} • {draft.siret || 'SIRET absent'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={onClose} style={secondaryButtonStyle}>
              Fermer
            </button>
            <button type="button" onClick={handleSave} style={primaryButtonStyle} disabled={saving}>
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(260px, 1fr))', gap: 14, padding: 20 }}>
          {keys.map((key) => {
            const value = draft[key]
            const stringValue = value == null ? '' : String(value)

            return (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={fieldLabelStyle}>{key}</label>
                {stringValue.length > 120 ? (
                  <textarea
                    value={stringValue}
                    rows={4}
                    onChange={(e) => setDraft((prev) => (prev ? { ...prev, [key]: e.target.value } : prev))}
                    style={textareaStyle}
                  />
                ) : (
                  <input
                    value={stringValue}
                    onChange={(e) => setDraft((prev) => (prev ? { ...prev, [key]: e.target.value } : prev))}
                    style={inputStyle}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SynthesisTable({
  title,
  rows,
  columns,
  dataMap,
  totalByColumn,
  metric,
  sortState,
  onSort,
  valueMode,
}: {
  title: string
  rows: string[]
  columns: string[]
  dataMap: Record<string, Record<string, number>>
  totalByColumn: Record<string, number>
  metric: SynthMetric
  sortState: SynthSortState
  onSort: (metric: SynthMetric, key: string) => void
  valueMode: ValueMode
}) {
  const orderedRows = useMemo(() => {
    const next = [...rows]
    next.sort((a, b) => {
      const valueA =
        sortState.key === '__label__'
          ? a
          : sortState.key === '__total__'
            ? Object.values(dataMap[a] || {}).reduce((sum, value) => sum + value, 0)
            : dataMap[a]?.[sortState.key] || 0

      const valueB =
        sortState.key === '__label__'
          ? b
          : sortState.key === '__total__'
            ? Object.values(dataMap[b] || {}).reduce((sum, value) => sum + value, 0)
            : dataMap[b]?.[sortState.key] || 0

      return compareValues(valueA, valueB, sortState.direction)
    })
    return next
  }, [rows, dataMap, sortState])

  function renderValue(value: number, columnTotal: number) {
    if (valueMode === 'POURCENT') {
      const percent = columnTotal > 0 ? (value / columnTotal) * 100 : 0
      return `${percent.toFixed(1)} %`
    }
    return metric === 'count' ? value : formatCurrency(value)
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #dbe2ea', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{title}</div>
      </div>

      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={stickyFirstHeaderStyle}>
                <button type="button" onClick={() => onSort(metric, '__label__')} style={headerButtonStyle}>
                  Activité
                  <SortIndicator active={sortState.metric === metric && sortState.key === '__label__'} direction={sortState.direction} />
                </button>
              </th>

              <th style={stickyHeaderStyle}>
                <button type="button" onClick={() => onSort(metric, '__total__')} style={headerButtonStyle}>
                  TOTAL
                  <SortIndicator active={sortState.metric === metric && sortState.key === '__total__'} direction={sortState.direction} />
                </button>
              </th>

              {columns.map((column) => (
                <th key={column} style={stickyHeaderStyle}>
                  <button type="button" onClick={() => onSort(metric, column)} style={headerButtonStyle}>
                    {column}
                    <SortIndicator active={sortState.metric === metric && sortState.key === column} direction={sortState.direction} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {orderedRows.map((label) => {
              const total = Object.values(dataMap[label] || {}).reduce((sum, value) => sum + value, 0)
              const grandTotal = Object.values(totalByColumn).reduce((sum, value) => sum + value, 0)
              return (
                <tr key={label}>
                  <td style={stickyFirstCellStyle}>{label}</td>
                  <td style={cellNumberStyle}>{renderValue(total, grandTotal)}</td>
                  {columns.map((column) => {
                    const value = dataMap[label]?.[column] || 0
                    return (
                      <td key={column} style={cellNumberStyle}>
                        {renderValue(value, totalByColumn[column] || 0)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}

            <tr>
              <td style={{ ...stickyFirstCellStyle, fontWeight: 800, background: '#eef2f7' }}>TOTAL</td>
              <td style={{ ...cellNumberStyle, fontWeight: 800, background: '#eef2f7' }}>
                {valueMode === 'POURCENT'
                  ? '100 %'
                  : metric === 'count'
                    ? Object.values(totalByColumn).reduce((sum, value) => sum + value, 0)
                    : formatCurrency(Object.values(totalByColumn).reduce((sum, value) => sum + value, 0))}
              </td>
              {columns.map((column) => (
                <td key={column} style={{ ...cellNumberStyle, fontWeight: 800, background: '#eef2f7' }}>
                  {valueMode === 'POURCENT'
                    ? '100 %'
                    : metric === 'count'
                      ? totalByColumn[column] || 0
                      : formatCurrency(totalByColumn[column] || 0)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

const DISPLAY_COLUMNS = [
  'numero_client_sage',
  'present_base_client',
  'designation_commerciale',
  'representant',
  'date_creation',
  'agence',
  'cp_sage',
  'ville_sage',
  'departement_calcule',
  'statut',
  'siret',
  'activite_principale_unite_legale',
  'ca_2023',
  'ca_2024',
  'ca_2025',
  'remarque',
] as const

export default function ClientsCegeclimPage() {
  const { societeFilter } = useSocieteFilter()
  void societeFilter

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
  const [clientsBase, setClientsBase] = useState<ClientBaseRow[]>([])
  const [clientsCegeclim, setClientsCegeclim] = useState<ClientsCegeclimRow[]>([])

  const [selectedStatut, setSelectedStatut] = useState<StatutFilter>('TOUS')
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([])
  const [selectedAgences, setSelectedAgences] = useState<string[]>([])
  const [selectedActivities, setSelectedActivities] = useState<string[]>([])
  const [selectedPresence, setSelectedPresence] = useState<PresenceFilter>('TOUS')
  const [selectedCaPositive, setSelectedCaPositive] = useState<YesNoFilter>('TOUS')
  const [freeSearch, setFreeSearch] = useState('')

  const [axisMode, setAxisMode] = useState<AxisMode>('DEPARTEMENT')
  const [valueMode, setValueMode] = useState<ValueMode>('VALEUR')

  const [detailSortKey, setDetailSortKey] = useState<string>('designation_commerciale')
  const [detailSortDirection, setDetailSortDirection] = useState<SortDirection>('asc')

  const [synthSort, setSynthSort] = useState<SynthSortState>({
    metric: 'count',
    key: '__total__',
    direction: 'desc',
  })

  const [selectedRow, setSelectedRow] = useState<ClientsCegeclimRow | null>(null)

  useEffect(() => {
    void loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      setCurrentUserEmail(session?.user?.email?.toLowerCase().trim() || null)

      const [clientsCegeclimRes, clientsRes] = await Promise.all([
        supabase.from('clients_cegeclim').select('*'),
        supabase.from('clients').select('id, siret'),
      ])

      if (clientsCegeclimRes.error) throw clientsCegeclimRes.error
      if (clientsRes.error) throw clientsRes.error

      setClientsCegeclim((clientsCegeclimRes.data || []) as ClientsCegeclimRow[])
      setClientsBase((clientsRes.data || []) as ClientBaseRow[])
    } catch (error: any) {
      console.error(error)
      alert("Erreur lors du chargement de l'écran clients_cegeclim : " + (error?.message || String(error)))
    } finally {
      setLoading(false)
    }
  }

  async function saveRow(next: ClientsCegeclimRow) {
    setSaving(true)
    try {
      const payload = { ...next }
      delete payload.id
      delete payload.present_base_client
      delete payload.departement_calcule

      let query = supabase.from('clients_cegeclim').update(payload)

      if (next.id != null) {
        query = query.eq('id', next.id)
      } else {
        query = query.eq('siret', next.siret || '')
      }

      const { error } = await query
      if (error) throw error

      setSelectedRow(next)
      setClientsCegeclim((prev) =>
        prev.map((row) => {
          const same =
            next.id != null && row.id != null
              ? row.id === next.id
              : normalizeSiret(row.siret) === normalizeSiret(next.siret)
          return same ? next : row
        })
      )

      alert('Client CEGECLIM mis à jour.')
    } catch (error: any) {
      console.error(error)
      alert("Erreur lors de l'enregistrement : " + (error?.message || String(error)))
    } finally {
      setSaving(false)
    }
  }

  const clientBaseSirets = useMemo(
    () => new Set(clientsBase.map((row) => normalizeSiret(row.siret)).filter(Boolean)),
    [clientsBase]
  )

  const scopedWithComputed = useMemo(() => {
    return clientsCegeclim.map((row) => {
      const siret = normalizeSiret(row.siret)
      const department = getDepartmentFromCegeclim(row)
      const status = getStatutLabel(row)
      const inClients = siret ? clientBaseSirets.has(siret) : false
      const activity = getActivityLabel(row)
      const agence = String(row.agence || '').trim() || 'INCONNUE'
      const ca2025 = toNumber(row.ca_2025)

      return {
        ...row,
        _siret: siret,
        _department: department || '999',
        _status: status,
        _inClients: inClients,
        _activity: activity,
        _agence: agence,
        _ca2025: ca2025,
        present_base_client: inClients ? 'OUI' : 'NON',
        departement_calcule: department || '999',
      }
    })
  }, [clientsCegeclim, clientBaseSirets])

  const stats = useMemo(() => {
    const total = scopedWithComputed.length
    const actifs = scopedWithComputed.filter((row) => row._status === 'ACTIF').length
    const actifsAbsents = scopedWithComputed.filter((row) => row._status === 'ACTIF' && !row._inClients).length
    const sommeilAbsents = scopedWithComputed.filter((row) => row._status === 'SOMMEIL' && !row._inClients).length

    return { total, actifs, actifsAbsents, sommeilAbsents }
  }, [scopedWithComputed])

  const departmentOptions = useMemo(
    () => Array.from(new Set(scopedWithComputed.map((row) => row._department).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'fr')),
    [scopedWithComputed]
  )

  const agenceOptions = useMemo(
    () => Array.from(new Set(scopedWithComputed.map((row) => row._agence).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'fr')),
    [scopedWithComputed]
  )

  const activityOptions = useMemo(
    () => Array.from(new Set(scopedWithComputed.map((row) => row._activity).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'fr')),
    [scopedWithComputed]
  )

  const filteredRows = useMemo(() => {
    return scopedWithComputed.filter((row) => {
      if (selectedStatut !== 'TOUS' && row._status !== selectedStatut) return false
      if (selectedDepartments.length > 0 && !selectedDepartments.includes(row._department)) return false
      if (selectedAgences.length > 0 && !selectedAgences.includes(row._agence)) return false
      if (selectedActivities.length > 0 && !selectedActivities.includes(row._activity)) return false
      if (selectedPresence === 'OUI' && !row._inClients) return false
      if (selectedPresence === 'NON' && row._inClients) return false
      if (selectedCaPositive === 'OUI' && row._ca2025 <= 0) return false
      if (selectedCaPositive === 'NON' && row._ca2025 > 0) return false

      if (freeSearch.trim()) {
        const q = freeSearch.trim().toLowerCase()
        const haystack = [
          row.siret,
          row.designation_commerciale,
          row.numero_client_sage,
          row.representant,
          row.ville_sage,
          row.agence,
          row.remarque,
          row._activity,
        ]
          .join(' ')
          .toLowerCase()

        if (!haystack.includes(q)) return false
      }

      return true
    })
  }, [
    scopedWithComputed,
    selectedStatut,
    selectedDepartments,
    selectedAgences,
    selectedActivities,
    selectedPresence,
    selectedCaPositive,
    freeSearch,
  ])

  const synthColumns = useMemo(() => {
    const values =
      axisMode === 'DEPARTEMENT'
        ? filteredRows.map((row) => row._department || '999')
        : filteredRows.map((row) => row._agence || 'INCONNUE')
    return Array.from(new Set(values)).filter(Boolean).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [filteredRows, axisMode])

  const synthCountMap = useMemo(() => {
    const map: Record<string, Record<string, number>> = {}
    for (const row of filteredRows) {
      const label = row._activity
      const axis = axisMode === 'DEPARTEMENT' ? row._department || '999' : row._agence || 'INCONNUE'
      if (!map[label]) map[label] = {}
      map[label][axis] = (map[label][axis] || 0) + 1
    }
    return map
  }, [filteredRows, axisMode])

  const synthCaMap = useMemo(() => {
    const map: Record<string, Record<string, number>> = {}
    for (const row of filteredRows) {
      const label = row._activity
      const axis = axisMode === 'DEPARTEMENT' ? row._department || '999' : row._agence || 'INCONNUE'
      if (!map[label]) map[label] = {}
      map[label][axis] = (map[label][axis] || 0) + row._ca2025
    }
    return map
  }, [filteredRows, axisMode])

  const synthRows = useMemo(() => Array.from(new Set(filteredRows.map((row) => row._activity))), [filteredRows])

  const synthCountTotals = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const column of synthColumns) totals[column] = 0
    for (const row of filteredRows) {
      const axis = axisMode === 'DEPARTEMENT' ? row._department || '999' : row._agence || 'INCONNUE'
      totals[axis] = (totals[axis] || 0) + 1
    }
    return totals
  }, [filteredRows, synthColumns, axisMode])

  const synthCaTotals = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const column of synthColumns) totals[column] = 0
    for (const row of filteredRows) {
      const axis = axisMode === 'DEPARTEMENT' ? row._department || '999' : row._agence || 'INCONNUE'
      totals[axis] = (totals[axis] || 0) + row._ca2025
    }
    return totals
  }, [filteredRows, synthColumns, axisMode])

  const sortedDetailRows = useMemo(() => {
    const rows = [...filteredRows]
    rows.sort((a, b) => compareValues(a[detailSortKey], b[detailSortKey], detailSortDirection))
    return rows
  }, [filteredRows, detailSortKey, detailSortDirection])

  const hiddenKeys = useMemo(() => {
    const visible = new Set(DISPLAY_COLUMNS)
    const all = new Set<string>()
    scopedWithComputed.forEach((row) => Object.keys(row).forEach((k) => { if (!k.startsWith('_')) all.add(k) }))
    return Array.from(all).filter((k) => !visible.has(k as any)).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [scopedWithComputed])

  const modalKeys = useMemo(() => {
    const merged = [...DISPLAY_COLUMNS, ...hiddenKeys]
    return Array.from(new Set(merged))
  }, [hiddenKeys])

  function toggleDetailSort(key: string) {
    setDetailSortKey((current) => {
      if (current === key) {
        setDetailSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
        return current
      }
      setDetailSortDirection('asc')
      return key
    })
  }

  function toggleSynthSort(metric: SynthMetric, key: string) {
    setSynthSort((prev) => {
      if (prev.metric === metric && prev.key === key) {
        return {
          ...prev,
          direction: prev.direction === 'asc' ? 'desc' : 'asc',
        }
      }
      return {
        metric,
        key,
        direction: metric === 'count' && key === '__total__' ? 'desc' : 'asc',
      }
    })
  }

  if (loading) {
    return <div style={{ padding: 24 }}>Chargement de la page clients_cegeclim...</div>
  }

  return (
    <section style={{ padding: 16, background: '#f5f7fb', minHeight: '100vh' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 30, color: '#0f172a' }}>Clients CEGECLIM</h1>
        <div style={{ marginTop: 6, color: '#64748b', fontSize: 14 }}>
          {currentUserEmail || 'Utilisateur'} • visibilité complète sur la table clients_cegeclim
        </div>
      </div>

      <div style={sectionCardStyle}>
        <SectionTitle
          title="SECTION 1 : CLIENTS CEGECLIM"
          subtitle="4 pavés de synthèse sur la base des tables clients_cegeclim et clients."
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))', gap: 14 }}>
          <StatCard title="Enregistrements clients_cegeclim" value={stats.total} subtitle="Source : table clients_cegeclim" />
          <StatCard title="Clients statut ACTIF" value={stats.actifs} subtitle="Source : table clients_cegeclim" />
          <StatCard
            title="Actifs absents de la base clients"
            value={stats.actifsAbsents}
            subtitle="Croisement clients_cegeclim / clients"
          />
          <StatCard
            title="Sommeil absents de la base clients"
            value={stats.sommeilAbsents}
            subtitle="Croisement clients_cegeclim / clients"
          />
        </div>
      </div>

      <div style={sectionCardStyle}>
        <SectionTitle
          title="SECTION 2 : SYNTHESE"
          subtitle="Filtres en boutons, bascule département/agence, et affichage valeur ou % de la colonne."
        />

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          
          <button type="button" style={{ ...filterButtonStyle, minWidth: 110, textAlign: 'left' }}>
            <span style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 2 }}>Recherche libre</span>
            <input
              value={freeSearch}
              onChange={(e) => setFreeSearch(e.target.value)}
              placeholder="SIRET, désignation, agence..."
              style={{ border: 'none', outline: 'none', width: '100%', background: 'transparent', padding: 0, fontSize: 14 }}
            />
          </button>
          <SingleSelectButtonFilter
            label="Statut"
            value={selectedStatut}
            options={['ACTIF', 'SOMMEIL']}
            onChange={(next) => setSelectedStatut(next as StatutFilter)}
          />
          <MultiSelectButtonFilter
            label={axisMode === 'DEPARTEMENT' ? 'Dept' : 'Dept'}
            options={departmentOptions}
            selected={selectedDepartments}
            onChange={setSelectedDepartments}
          />
          <MultiSelectButtonFilter
            label="Agence"
            options={agenceOptions}
            selected={selectedAgences}
            onChange={setSelectedAgences}
          />
          <MultiSelectButtonFilter
            label="Activité"
            options={activityOptions}
            selected={selectedActivities}
            onChange={setSelectedActivities}
          />
          <SingleSelectButtonFilter
            label="Présence base client"
            value={selectedPresence}
            options={['OUI', 'NON']}
            onChange={(next) => setSelectedPresence(next as PresenceFilter)}
          />
          <SingleSelectButtonFilter
            label="CA 2025 > 0"
            value={selectedCaPositive}
            options={['OUI', 'NON']}
            onChange={(next) => setSelectedCaPositive(next as YesNoFilter)}
          />
          <ToggleButtonGroup
            value={axisMode}
            onChange={setAxisMode}
            options={[
              { value: 'DEPARTEMENT', label: 'Dpt' },
              { value: 'AGENCE', label: 'Agence' },
            ]}
          />
          <ToggleButtonGroup
            value={valueMode}
            onChange={setValueMode}
            options={[
              { value: 'VALEUR', label: 'Valeur' },
              { value: 'POURCENT', label: '% col.' },
            ]}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <SynthesisTable
            title={valueMode === 'POURCENT' ? "Nombre d'entreprises (% colonne)" : "Nombre d'entreprises"}
            rows={synthRows}
            columns={synthColumns}
            dataMap={synthCountMap}
            totalByColumn={synthCountTotals}
            metric="count"
            sortState={synthSort}
            onSort={toggleSynthSort}
            valueMode={valueMode}
          />
          <SynthesisTable
            title={valueMode === 'POURCENT' ? 'CA 2025 (% colonne)' : 'CA 2025'}
            rows={synthRows}
            columns={synthColumns}
            dataMap={synthCaMap}
            totalByColumn={synthCaTotals}
            metric="ca_2025"
            sortState={synthSort}
            onSort={toggleSynthSort}
            valueMode={valueMode}
          />
        </div>
      </div>

      <div style={sectionCardStyle}>
        <SectionTitle
          title="SECTION 3 : Détail des clients CEGECLIM"
          subtitle={`Colonnes triables • ${sortedDetailRows.length} ligne(s) après filtres • champs absents visibles dans Modifier.`}
        />

        <div style={{ overflow: 'auto', border: '1px solid #dbe2ea', borderRadius: 16, background: '#fff' }}>
          <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                {DISPLAY_COLUMNS.map((column, index) => (
                  <th key={column} style={index === 0 ? stickyFirstHeaderStyle : stickyHeaderStyle}>
                    <button type="button" onClick={() => toggleDetailSort(column)} style={headerButtonStyle}>
                      {column}
                      <SortIndicator active={detailSortKey === column} direction={detailSortDirection} />
                    </button>
                  </th>
                ))}
                <th style={stickyHeaderStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedDetailRows.map((row, rowIndex) => (
                <tr key={`${row.id ?? row.siret ?? rowIndex}`}>
                  {DISPLAY_COLUMNS.map((column, index) => {
                    const raw = row[column]
                    const display =
                      column === 'present_base_client'
                        ? String(raw ?? 'NON')
                        : column === 'departement_calcule'
                          ? String(raw ?? '999')
                          : column === 'date_creation'
                            ? formatDateFr(String(raw || ''))
                            : column === 'ca_2023' || column === 'ca_2024' || column === 'ca_2025'
                              ? formatCurrency(toNumber(raw))
                              : String(raw ?? '—')
                    return (
                      <td key={column} style={index === 0 ? stickyFirstCellStyle : cellStyle}>
                        {display}
                      </td>
                    )
                  })}
                  <td style={cellStyle}>
                    <button type="button" onClick={() => setSelectedRow(row)} style={primaryButtonStyle}>
                      Modifier
                    </button>
                  </td>
                </tr>
              ))}

              {sortedDetailRows.length === 0 ? (
                <tr>
                  <td colSpan={DISPLAY_COLUMNS.length + 1} style={{ ...cellStyle, textAlign: 'center', padding: 24, color: '#64748b' }}>
                    Aucun enregistrement pour les filtres sélectionnés.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <DetailModal row={selectedRow} orderedKeys={modalKeys} onClose={() => setSelectedRow(null)} onSave={saveRow} />

      {saving ? (
        <div style={{ position: 'fixed', right: 16, bottom: 16, background: '#0f172a', color: '#fff', padding: '10px 14px', borderRadius: 12 }}>
          Enregistrement en cours...
        </div>
      ) : null}
    </section>
  )
}

const sectionCardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #dbe2ea',
  borderRadius: 20,
  padding: 18,
  boxShadow: '0 8px 26px rgba(15,23,42,0.05)',
  marginBottom: 18,
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,0.38)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 18,
}

const modalStyle: React.CSSProperties = {
  width: 'min(1450px, calc(100vw - 32px))',
  maxHeight: 'calc(100vh - 32px)',
  overflow: 'auto',
  background: '#fff',
  borderRadius: 22,
  boxShadow: '0 24px 60px rgba(15,23,42,0.25)',
  border: '1px solid #dbe2ea',
}

const modalHeaderStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: '#fff',
  borderBottom: '1px solid #e2e8f0',
  padding: '18px 20px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
}

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: 12,
  fontWeight: 700,
  color: '#475569',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid #cbd5e1',
  borderRadius: 10,
  padding: '10px 12px',
  fontSize: 14,
  background: '#fff',
  color: '#0f172a',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: 90,
}

const primaryButtonStyle: React.CSSProperties = {
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  padding: '9px 12px',
  cursor: 'pointer',
  fontWeight: 700,
}

const secondaryButtonStyle: React.CSSProperties = {
  background: '#fff',
  color: '#0f172a',
  border: '1px solid #cbd5e1',
  borderRadius: 10,
  padding: '9px 12px',
  cursor: 'pointer',
  fontWeight: 700,
}

const stickyHeaderStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: '#f8fafc',
  borderBottom: '1px solid #dbe2ea',
  padding: 0,
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

const stickyFirstHeaderStyle: React.CSSProperties = {
  ...stickyHeaderStyle,
  left: 0,
  zIndex: 3,
  borderRight: '1px solid #dbe2ea',
}

const stickyFirstCellStyle: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 1,
  background: '#fff',
  borderRight: '1px solid #e2e8f0',
  borderBottom: '1px solid #e2e8f0',
  padding: '10px 12px',
  whiteSpace: 'nowrap',
  fontWeight: 600,
}

const cellStyle: React.CSSProperties = {
  borderBottom: '1px solid #e2e8f0',
  padding: '10px 12px',
  whiteSpace: 'nowrap',
  fontSize: 13,
  color: '#0f172a',
}

const cellNumberStyle: React.CSSProperties = {
  ...cellStyle,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
}

const headerButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: 'none',
  background: 'transparent',
  textAlign: 'left',
  fontWeight: 800,
  cursor: 'pointer',
  color: '#0f172a',
  whiteSpace: 'nowrap',
}

const filterButtonStyle: React.CSSProperties = {
  minWidth: 115,
  height: 56,
  border: '1px solid #cbd5e1',
  background: '#fff',
  borderRadius: 12,
  padding: '8px 12px',
  textAlign: 'left',
  cursor: 'pointer',
  color: '#0f172a',
  fontWeight: 600,
}

const multiPanelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  left: 0,
  minWidth: 260,
  maxWidth: 420,
  maxHeight: 320,
  overflow: 'auto',
  background: '#fff',
  border: '1px solid #cbd5e1',
  borderRadius: 14,
  padding: 12,
  boxShadow: '0 18px 50px rgba(15,23,42,0.15)',
  zIndex: 20,
}

const miniButtonStyle: React.CSSProperties = {
  border: '1px solid #cbd5e1',
  background: '#fff',
  borderRadius: 10,
  padding: '8px 10px',
  cursor: 'pointer',
  textAlign: 'left',
  fontWeight: 600,
}
