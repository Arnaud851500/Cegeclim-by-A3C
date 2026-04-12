'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type UserPageAccess = {
  email: string
  display_name: string | null
  can_todo: boolean
}

type TodoRow = {
  id: string
  created_at: string
  updated_at: string
  created_by_email: string
  created_by_name: string
  mission_project: string | null
  description_action: string | null
  assigned_to: string | null
  due_date: string | null
  status: 'Non débuté' | 'En cours' | 'Terminé' | 'Annulé'
  comment_progress: string | null
  sort_order: number
}

type SortKey =
  | 'created_by_name'
  | 'mission_project'
  | 'description_action'
  | 'assigned_to'
  | 'due_date'
  | 'status'
  | 'comment_progress'

type SortConfig = {
  key: SortKey
  direction: 'asc' | 'desc'
}

type TextFilters = {
  created_by_name: string
  mission_project: string
  description_action: string
  assigned_to: string
  due_date: string
  status: string
  comment_progress: string
}

const STATUS_OPTIONS: TodoRow['status'][] = [
  'Non débuté',
  'En cours',
  'Terminé',
  'Annulé',
]

const DEFAULT_FILTERS: TextFilters = {
  created_by_name: '',
  mission_project: '',
  description_action: '',
  assigned_to: '',
  due_date: '',
  status: '',
  comment_progress: '',
}

export default function TodoPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const [currentEmail, setCurrentEmail] = useState('')
  const [currentDisplayName, setCurrentDisplayName] = useState('')

  const [canTodo, setCanTodo] = useState(false)
  const [assignees, setAssignees] = useState<string[]>([])
  const [rows, setRows] = useState<TodoRow[]>([])

  const [activeSortConfig, setActiveSortConfig] = useState<SortConfig>({
    key: 'due_date',
    direction: 'asc',
  })

  const [closedSortConfig, setClosedSortConfig] = useState<SortConfig>({
    key: 'due_date',
    direction: 'asc',
  })

  const [activeFilters, setActiveFilters] = useState<TextFilters>(DEFAULT_FILTERS)
  const [closedFilters, setClosedFilters] = useState<TextFilters>(DEFAULT_FILTERS)

  const autosaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    init()
  }, [])

  async function init() {
    setLoading(true)

    const { data: authData } = await supabase.auth.getUser()
    const user = authData?.user

    if (!user?.email) {
      router.push('/login')
      return
    }

    const email = user.email
    setCurrentEmail(email)

    const { data: access, error: accessError } = await supabase
      .from('user_page_access')
      .select('email, display_name, can_todo')
      .eq('email', email)
      .maybeSingle<UserPageAccess>()

    if (accessError || !access?.can_todo) {
      router.push('/')
      return
    }

    const displayName = access.display_name?.trim() || email.split('@')[0]
    setCurrentDisplayName(displayName)
    setCanTodo(true)

    const { data: usersData } = await supabase
      .from('user_page_access')
      .select('display_name, email, can_todo')
      .eq('can_todo', true)
      .order('display_name', { ascending: true })

    const assigneeNames =
      (usersData || [])
        .map((u: any) => (u.display_name?.trim() || u.email?.split('@')[0] || '').trim())
        .filter(Boolean)

    setAssignees(Array.from(new Set(assigneeNames)))

    await loadRows(email, displayName)

    setLoading(false)
  }

  async function loadRows(emailParam?: string, displayNameParam?: string) {
    const email = emailParam || currentEmail
    const displayName = displayNameParam || currentDisplayName

    if (!email) return

    const { data, error } = await supabase
      .from('todo_actions')
      .select('*')
      .or(
        `created_by_email.eq.${escapeSupabaseValue(email)},assigned_to.eq.${escapeSupabaseValue(displayName)}`
      )
      .order('status', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })

    if (error) {
      console.error(error)
      return
    }

    setRows((data || []) as TodoRow[])
  }

  function escapeSupabaseValue(value: string) {
    return String(value || '').replace(/,/g, '\\,')
  }

  function normalize(value: string | null | undefined) {
    return (value || '').toString().trim().toLowerCase()
  }

  function includesText(value: string | null | undefined, search: string) {
    if (!search.trim()) return true
    return normalize(value).includes(search.trim().toLowerCase())
  }

  function formatDateFr(dateStr: string | null | undefined) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    if (!y || !m || !d) return dateStr || ''
    return `${d}/${m}/${y}`
  }

  function baseSortRows(list: TodoRow[]) {
    return [...list].sort((a, b) => {
      const aDone = a.status === 'Terminé' || a.status === 'Annulé'
      const bDone = b.status === 'Terminé' || b.status === 'Annulé'

      if (aDone !== bDone) return aDone ? 1 : -1

      const da = a.due_date || '9999-12-31'
      const db = b.due_date || '9999-12-31'
      if (da !== db) return da.localeCompare(db)

      return (a.sort_order || 0) - (b.sort_order || 0)
    })
  }

  function applyTextFilters(list: TodoRow[], filters: TextFilters) {
    return list.filter(row => {
      const dueDateMatches =
        includesText(row.due_date, filters.due_date) ||
        includesText(formatDateFr(row.due_date), filters.due_date)

      const statusMatches = filters.status
        ? normalize(row.status) === normalize(filters.status)
        : true

      return (
        includesText(row.created_by_name, filters.created_by_name) &&
        includesText(row.mission_project, filters.mission_project) &&
        includesText(row.description_action, filters.description_action) &&
        includesText(row.assigned_to, filters.assigned_to) &&
        dueDateMatches &&
        statusMatches &&
        includesText(row.comment_progress, filters.comment_progress)
      )
    })
  }

  function applyColumnSort(list: TodoRow[], sortConfig: SortConfig) {
    const sorted = [...list]

    sorted.sort((a, b) => {
      let av = ''
      let bv = ''

      switch (sortConfig.key) {
        case 'created_by_name':
          av = a.created_by_name || ''
          bv = b.created_by_name || ''
          break
        case 'mission_project':
          av = a.mission_project || ''
          bv = b.mission_project || ''
          break
        case 'description_action':
          av = a.description_action || ''
          bv = b.description_action || ''
          break
        case 'assigned_to':
          av = a.assigned_to || ''
          bv = b.assigned_to || ''
          break
        case 'due_date':
          av = a.due_date || '9999-12-31'
          bv = b.due_date || '9999-12-31'
          break
        case 'status':
          av = a.status || ''
          bv = b.status || ''
          break
        case 'comment_progress':
          av = a.comment_progress || ''
          bv = b.comment_progress || ''
          break
      }

      const result = av.localeCompare(bv, 'fr', { numeric: true, sensitivity: 'base' })
      return sortConfig.direction === 'asc' ? result : -result
    })

    return sorted
  }

  const visibleRows = useMemo(() => {
    return rows.filter(row => {
      const isCreator = normalize(row.created_by_email) === normalize(currentEmail)
      const isAssignee = normalize(row.assigned_to) === normalize(currentDisplayName)
      return isCreator || isAssignee
    })
  }, [rows, currentEmail, currentDisplayName])

  const activeRows = useMemo(() => {
    const subset = visibleRows.filter(r => r.status !== 'Terminé' && r.status !== 'Annulé')
    return baseSortRows(applyColumnSort(applyTextFilters(subset, activeFilters), activeSortConfig))
  }, [visibleRows, activeFilters, activeSortConfig])

  const closedRows = useMemo(() => {
    const subset = visibleRows.filter(r => r.status === 'Terminé' || r.status === 'Annulé')
    return baseSortRows(applyColumnSort(applyTextFilters(subset, closedFilters), closedSortConfig))
  }, [visibleRows, closedFilters, closedSortConfig])

  function toggleSort(
    key: SortKey,
    section: 'active' | 'closed'
  ) {
    const setter = section === 'active' ? setActiveSortConfig : setClosedSortConfig

    setter(prev => {
      if (prev.key === key) {
        return {
          key,
          direction: prev.direction === 'asc' ? 'desc' : 'asc',
        }
      }
      return {
        key,
        direction: 'asc',
      }
    })
  }

  function setSectionFilter(
    section: 'active' | 'closed',
    key: keyof TextFilters,
    value: string
  ) {
    const setter = section === 'active' ? setActiveFilters : setClosedFilters
    setter(prev => ({ ...prev, [key]: value }))
  }

  function resetSectionFilters(section: 'active' | 'closed') {
    if (section === 'active') {
      setActiveFilters(DEFAULT_FILTERS)
      return
    }
    setClosedFilters(DEFAULT_FILTERS)
  }

  async function addRow() {
    if (!canTodo) return

    const maxSort = rows.reduce((m, r) => Math.max(m, r.sort_order || 0), 0)

    const payload = {
      created_by_email: currentEmail,
      created_by_name: currentDisplayName,
      mission_project: '',
      description_action: '',
      assigned_to: currentDisplayName,
      due_date: null,
      status: 'Non débuté' as TodoRow['status'],
      comment_progress: '',
      sort_order: maxSort + 1,
    }

    const { data, error } = await supabase
      .from('todo_actions')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      console.error(error)
      alert("Impossible de créer la tâche.")
      return
    }

    setRows(prev => baseSortRows([data as TodoRow, ...prev]))
  }

  async function deleteRow(id: string) {
    const ok = window.confirm('Supprimer cette tâche ?')
    if (!ok) return

    const { error } = await supabase.from('todo_actions').delete().eq('id', id)
    if (error) {
      console.error(error)
      alert("Impossible de supprimer la tâche.")
      return
    }

    setRows(prev => prev.filter(r => r.id !== id))
  }

  function updateLocal(id: string, patch: Partial<TodoRow>) {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }

  function queueSave(id: string, patch: Partial<TodoRow>) {
    updateLocal(id, patch)

    if (autosaveTimers.current[id]) {
      clearTimeout(autosaveTimers.current[id])
    }

    autosaveTimers.current[id] = setTimeout(() => {
      saveRow(id, patch)
    }, 350)
  }

  async function saveRow(id: string, patch: Partial<TodoRow>) {
    setSavingId(id)

    const { error } = await supabase
      .from('todo_actions')
      .update(patch)
      .eq('id', id)

    setSavingId(prev => (prev === id ? null : prev))

    if (error) {
      console.error(error)
      alert("Erreur lors de l'enregistrement.")
    }
  }

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          Chargement...
        </div>
      </div>
    )
  }

  if (!canTodo) return null

  return (
    <div className="p-4 md:p-6">
      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-bold">TODO List</h1>
            <p className="text-sm text-slate-500">
              Gestion des actions avec séparation automatique des tâches en cours et clôturées
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={addRow}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              + Nouvelle tâche
            </button>
          </div>
        </div>

        <div className="p-4 md:p-6">
          <TodoSection
            sectionKey="active"
            title="TODO LIST (tâches non terminées)"
            rows={activeRows}
            assignees={assignees}
            savingId={savingId}
            queueSave={queueSave}
            deleteRow={deleteRow}
            autoResize={autoResize}
            sortConfig={activeSortConfig}
            filters={activeFilters}
            toggleSort={toggleSort}
            setFilter={setSectionFilter}
            resetFilters={resetSectionFilters}
          />

          <div className="h-8" />

          <TodoSection
            sectionKey="closed"
            title="Liste des tâches terminées ou annulées"
            rows={closedRows}
            assignees={assignees}
            savingId={savingId}
            queueSave={queueSave}
            deleteRow={deleteRow}
            autoResize={autoResize}
            sortConfig={closedSortConfig}
            filters={closedFilters}
            toggleSort={toggleSort}
            setFilter={setSectionFilter}
            resetFilters={resetSectionFilters}
          />
        </div>
      </div>
    </div>
  )
}

function TodoSection({
  sectionKey,
  title,
  rows,
  assignees,
  savingId,
  queueSave,
  deleteRow,
  autoResize,
  sortConfig,
  filters,
  toggleSort,
  setFilter,
  resetFilters,
}: {
  sectionKey: 'active' | 'closed'
  title: string
  rows: TodoRow[]
  assignees: string[]
  savingId: string | null
  queueSave: (id: string, patch: Partial<TodoRow>) => void
  deleteRow: (id: string) => void
  autoResize: (el: HTMLTextAreaElement) => void
  sortConfig: SortConfig
  filters: TextFilters
  toggleSort: (key: SortKey, section: 'active' | 'closed') => void
  setFilter: (section: 'active' | 'closed', key: keyof TextFilters, value: string) => void
  resetFilters: (section: 'active' | 'closed') => void
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-bold">{title}</h2>
        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-500">{rows.length} tâche(s)</div>
          <button
            type="button"
            onClick={() => resetFilters(sectionKey)}
            className="rounded-lg border px-3 py-1 text-xs hover:bg-slate-50"
          >
            Réinitialiser filtres
          </button>
        </div>
      </div>

      <div className="max-h-[520px] overflow-auto rounded-2xl border">
        <table className="min-w-[1500px] w-full border-collapse text-sm">
          <colgroup>
            <col style={{ width: '140px' }} />
            <col style={{ width: '220px' }} />
            <col style={{ width: '420px' }} />
            <col style={{ width: '220px' }} />
            <col style={{ width: '140px' }} />
            <col style={{ width: '150px' }} />
            <col style={{ width: '420px' }} />
            <col style={{ width: '90px' }} />
          </colgroup>

          <thead>
            <tr className="sticky top-0 z-20 bg-slate-100 shadow-sm">
              <SortableTh
                label="Créée par"
                active={sortConfig.key === 'created_by_name'}
                direction={sortConfig.direction}
                onClick={() => toggleSort('created_by_name', sectionKey)}
              />
              <SortableTh
                label="Mission / Projet"
                active={sortConfig.key === 'mission_project'}
                direction={sortConfig.direction}
                onClick={() => toggleSort('mission_project', sectionKey)}
              />
              <SortableTh
                label="Description action"
                active={sortConfig.key === 'description_action'}
                direction={sortConfig.direction}
                onClick={() => toggleSort('description_action', sectionKey)}
              />
              <SortableTh
                label="Assignée à"
                active={sortConfig.key === 'assigned_to'}
                direction={sortConfig.direction}
                onClick={() => toggleSort('assigned_to', sectionKey)}
              />
              <SortableTh
                label="Pour le :"
                active={sortConfig.key === 'due_date'}
                direction={sortConfig.direction}
                onClick={() => toggleSort('due_date', sectionKey)}
              />
              <SortableTh
                label="Statut"
                active={sortConfig.key === 'status'}
                direction={sortConfig.direction}
                onClick={() => toggleSort('status', sectionKey)}
              />
              <SortableTh
                label="Commentaire - avancement"
                active={sortConfig.key === 'comment_progress'}
                direction={sortConfig.direction}
                onClick={() => toggleSort('comment_progress', sectionKey)}
              />
              <Th stickyTop="top-[41px]">Suppr.</Th>
            </tr>

            <tr className="sticky top-[41px] z-10 bg-white shadow-sm">
              <FilterTh>
                <FilterInput
                  value={filters.created_by_name}
                  onChange={v => setFilter(sectionKey, 'created_by_name', v)}
                  placeholder="Filtrer..."
                />
              </FilterTh>
              <FilterTh>
                <FilterInput
                  value={filters.mission_project}
                  onChange={v => setFilter(sectionKey, 'mission_project', v)}
                  placeholder="Filtrer..."
                />
              </FilterTh>
              <FilterTh>
                <FilterInput
                  value={filters.description_action}
                  onChange={v => setFilter(sectionKey, 'description_action', v)}
                  placeholder="Filtrer..."
                />
              </FilterTh>
              <FilterTh>
                <FilterInput
                  value={filters.assigned_to}
                  onChange={v => setFilter(sectionKey, 'assigned_to', v)}
                  placeholder="Filtrer..."
                />
              </FilterTh>
              <FilterTh>
                <FilterInput
                  value={filters.due_date}
                  onChange={v => setFilter(sectionKey, 'due_date', v)}
                  placeholder="JJ/MM/AAAA"
                />
              </FilterTh>
              <FilterTh>
                <select
                  value={filters.status}
                  onChange={e => setFilter(sectionKey, 'status', e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                >
                  <option value="">Tous</option>
                  {STATUS_OPTIONS.map(status => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </FilterTh>
              <FilterTh>
                <FilterInput
                  value={filters.comment_progress}
                  onChange={v => setFilter(sectionKey, 'comment_progress', v)}
                  placeholder="Filtrer..."
                />
              </FilterTh>
              <FilterTh />
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                  Aucune tâche dans cette section
                </td>
              </tr>
            ) : (
              rows.map(row => (
                <tr key={row.id} className="align-top odd:bg-white even:bg-slate-50/50">
                  <Td>
                    <div className="min-h-[42px] px-2 py-2 font-medium">
                      {row.created_by_name}
                    </div>
                  </Td>

                  <Td>
                    <input
                      value={row.mission_project || ''}
                      onChange={e => queueSave(row.id, { mission_project: e.target.value })}
                      className="min-h-[42px] w-full border-0 bg-transparent px-2 py-2 outline-none"
                      style={{
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    />
                  </Td>

                  <Td>
                    <textarea
                      value={row.description_action || ''}
                      onChange={e => queueSave(row.id, { description_action: e.target.value })}
                      onInput={e => autoResize(e.currentTarget)}
                      rows={1}
                      className="w-full resize-none border-0 bg-transparent px-2 py-2 leading-5 outline-none"
                      style={{
                        overflow: 'hidden',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    />
                  </Td>

                  <Td>
                    <select
                      value={row.assigned_to || ''}
                      onChange={e => queueSave(row.id, { assigned_to: e.target.value })}
                      className="min-h-[42px] w-full border-0 bg-transparent px-2 py-2 outline-none"
                    >
                      <option value="">--</option>
                      {assignees.map(name => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </Td>

                  <Td>
                    <input
                      type="date"
                      value={row.due_date || ''}
                      onChange={e => queueSave(row.id, { due_date: e.target.value || null })}
                      className="min-h-[42px] w-full border-0 bg-transparent px-2 py-2 outline-none"
                    />
                  </Td>

                  <Td>
                    <select
                      value={row.status}
                      onChange={e => queueSave(row.id, { status: e.target.value as TodoRow['status'] })}
                      className="min-h-[42px] w-full border-0 bg-transparent px-2 py-2 outline-none"
                    >
                      {STATUS_OPTIONS.map(status => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </Td>

                  <Td>
                    <textarea
                      value={row.comment_progress || ''}
                      onChange={e => queueSave(row.id, { comment_progress: e.target.value })}
                      onInput={e => autoResize(e.currentTarget)}
                      rows={1}
                      className="w-full resize-none border-0 bg-transparent px-2 py-2 leading-5 outline-none"
                      style={{
                        overflow: 'hidden',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    />
                  </Td>

                  <Td>
                    <div className="flex min-h-[42px] items-start justify-center px-2 py-2">
                      <button
                        onClick={() => deleteRow(row.id)}
                        className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-100"
                        title="Supprimer"
                      >
                        🗑
                      </button>
                    </div>
                    {savingId === row.id && (
                      <div className="pb-2 text-center text-[10px] text-slate-400">
                        Enreg.
                      </div>
                    )}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SortableTh({
  label,
  active,
  direction,
  onClick,
}: {
  label: string
  active: boolean
  direction: 'asc' | 'desc'
  onClick: () => void
}) {
  return (
    <th className="border-b border-r bg-slate-100 px-3 py-2 text-left font-bold last:border-r-0">
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 text-left hover:text-slate-700"
      >
        <span>{label}</span>
        <span className="text-xs text-slate-400">
          {active ? (direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  )
}

function FilterTh({ children }: { children?: React.ReactNode }) {
  return <th className="border-b border-r bg-white px-2 py-2 last:border-r-0">{children}</th>
}

function FilterInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-slate-400"
    />
  )
}

function Th({
  children,
  stickyTop,
}: {
  children: React.ReactNode
  stickyTop?: string
}) {
  return (
    <th
      className={`border-b border-r px-3 py-3 text-left font-bold last:border-r-0 ${
        stickyTop ? `sticky z-20 bg-slate-100 ${stickyTop}` : ''
      }`}
    >
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="border-r border-b align-top last:border-r-0">{children}</td>
}