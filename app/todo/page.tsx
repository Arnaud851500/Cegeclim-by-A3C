'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type UserPageAccess = {
  email: string
  display_name: string | null
  can_todo: boolean
}

type TodoStatus = 'Non débuté' | 'En cours' | 'Terminé' | 'Annulé'

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
  status: TodoStatus
  comment_progress: string | null
  sort_order: number
  // Lien optionnel vers un client (numero_tiers) — ajouté pour permettre de
  // retrouver les actions liées à un client donné depuis sa fiche (desktop
  // Vision Client / mobile "Mes clients"). Nécessite la migration
  // supabase/migrations/add_numero_tiers_to_todo_actions.sql.
  numero_tiers: string | null
}

/** Personne à qui une action peut être confiée. Le nom vient de l'écran Autorisations. */
type Assignee = {
  email: string
  name: string
}

type ScopeKey = 'all' | 'mine' | 'created'
type TabKey = 'active' | 'closed'
type SortKey = 'due_date' | 'recent' | 'mission'

type DueBucketKey = 'overdue' | 'today' | 'week' | 'later' | 'none'

type ToastState = { tone: 'success' | 'error'; text: string } | null

const STATUS_OPTIONS: TodoStatus[] = ['Non débuté', 'En cours', 'Terminé', 'Annulé']
const OPEN_STATUSES: TodoStatus[] = ['Non débuté', 'En cours']

const DUE_BUCKETS: Array<{ key: DueBucketKey; label: string; rail: string; tone: string }> = [
  { key: 'overdue', label: 'En retard', rail: 'bg-[#A32C2C]', tone: 'text-[#A32C2C]' },
  { key: 'today', label: 'Aujourd’hui', rail: 'bg-[#B4761A]', tone: 'text-[#8A5A11]' },
  { key: 'week', label: 'Cette semaine', rail: 'bg-[#C79A4E]', tone: 'text-[#8A5A11]' },
  { key: 'later', label: 'Plus tard', rail: 'bg-[#9BA5AF]', tone: 'text-slate-600' },
  { key: 'none', label: 'Sans échéance', rail: 'bg-[#D8D3C8]', tone: 'text-slate-500' },
]

function normalize(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function escapeSupabaseValue(value: string) {
  return String(value || '').replace(/,/g, '\\,')
}

function assigneeIdentityValues(emailValue?: string, displayNameValue?: string) {
  return Array.from(
    new Set([emailValue, displayNameValue].map((value) => String(value || '').trim()).filter(Boolean))
  )
}

function todayIso() {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10)
}

function addDaysIso(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10)
}

function formatDateFr(dateStr: string | null | undefined) {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-')
  if (!y || !m || !d) return dateStr || '—'
  return `${d}/${m}/${y}`
}

function formatDateTimeFr(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('fr-FR')
}

/** Distance à l'échéance, exprimée comme on la dit à l'oral. */
function relativeDueLabel(dueDate: string | null | undefined) {
  if (!dueDate) return 'Sans échéance'
  const today = todayIso()
  if (dueDate === today) return 'Aujourd’hui'
  if (dueDate === addDaysIso(today, 1)) return 'Demain'
  if (dueDate === addDaysIso(today, -1)) return 'Hier'

  const diff = Math.round(
    (new Date(`${dueDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000
  )

  if (diff < 0) return `${Math.abs(diff)} j de retard`
  if (diff <= 7) return `dans ${diff} j`
  return formatDateFr(dueDate)
}

function getDueBucket(row: TodoRow): DueBucketKey {
  if (!row.due_date) return 'none'
  const today = todayIso()
  if (row.due_date < today) return 'overdue'
  if (row.due_date === today) return 'today'
  if (row.due_date <= addDaysIso(today, 7)) return 'week'
  return 'later'
}

function isOpenStatus(status: TodoStatus) {
  return OPEN_STATUSES.includes(status)
}

function isOverdue(row: TodoRow) {
  return isOpenStatus(row.status) && Boolean(row.due_date) && (row.due_date as string) < todayIso()
}

function getStatusClasses(status: TodoStatus): string {
  if (status === 'Terminé') return 'bg-[#E7F1EA] text-[#1F5B44] ring-1 ring-[#BFDCCE]'
  if (status === 'En cours') return 'bg-[#FDF2DE] text-[#8A5A11] ring-1 ring-[#EBD8AE]'
  if (status === 'Annulé') return 'bg-[#F1EFEA] text-[#8A8375] ring-1 ring-[#DFDACF]'
  return 'bg-[#F1EFEA] text-[#6B6355] ring-1 ring-[#DFDACF]'
}

function getStatusDotClass(status: TodoStatus): string {
  if (status === 'Terminé') return 'bg-[#2F6B4F]'
  if (status === 'En cours') return 'bg-[#B4761A]'
  if (status === 'Annulé') return 'bg-[#B8B2A5]'
  return 'bg-[#CBC5B8]'
}

function initialsOf(name: string) {
  const source = String(name || '').replace(/@.*/, '')
  const parts = source.split(/[\s._-]+/).filter(Boolean)
  const letters = parts.slice(0, 2).map((part) => part[0]).join('')
  return (letters || source.slice(0, 2) || '?').toUpperCase()
}

/** Nom lisible par défaut quand l'écran Autorisations n'en fournit pas. */
function fallbackNameFromEmail(email: string) {
  const local = String(email || '').split('@')[0] || email
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || email
}

export default function TodoPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number>(0)

  const [currentEmail, setCurrentEmail] = useState('')
  const [currentDisplayName, setCurrentDisplayName] = useState('')

  const [canTodo, setCanTodo] = useState(false)
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [rows, setRows] = useState<TodoRow[]>([])

  const [tab, setTab] = useState<TabKey>('active')
  const [scope, setScope] = useState<ScopeKey>('all')
  const [search, setSearch] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('TOUS')
  const [statusFilter, setStatusFilter] = useState<'TOUS' | TodoStatus>('TOUS')
  const [sortKey, setSortKey] = useState<SortKey>('due_date')
  const [selectedId, setSelectedId] = useState<string>('')
  const [quickAdd, setQuickAdd] = useState('')
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)

  const autosaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    return () => {
      Object.values(autosaveTimers.current).forEach((timer) => clearTimeout(timer))
    }
  }, [])

  async function init() {
    setLoading(true)

    const { data: authData } = await supabase.auth.getUser()
    const user = authData?.user

    if (!user?.email) {
      router.push('/login')
      return
    }

    const email = user.email.trim().toLowerCase()
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

    const displayName = access.display_name?.trim() || fallbackNameFromEmail(email)
    setCurrentDisplayName(displayName)
    setCanTodo(true)

    // La liste des personnes assignables provient de l'écran Autorisations :
    // on affiche le nom saisi là-bas, et on enregistre l'email en base.
    const { data: usersData } = await supabase
      .from('user_page_access')
      .select('email, display_name, can_todo')
      .eq('can_todo', true)
      .order('email', { ascending: true })

    const nextAssignees: Assignee[] = ((usersData || []) as UserPageAccess[])
      .map((row) => {
        const rowEmail = String(row.email || '').trim().toLowerCase()
        if (!rowEmail) return null
        return {
          email: rowEmail,
          name: String(row.display_name || '').trim() || fallbackNameFromEmail(rowEmail),
        }
      })
      .filter((item): item is Assignee => Boolean(item))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))

    const uniqueByEmail = new Map<string, Assignee>()
    nextAssignees.forEach((item) => uniqueByEmail.set(item.email, item))
    setAssignees(Array.from(uniqueByEmail.values()))

    await loadRows(email, displayName)

    setLoading(false)
  }

  async function loadRows(emailParam?: string, displayNameParam?: string) {
    const email = emailParam || currentEmail
    const displayName = displayNameParam || currentDisplayName

    if (!email) return

    const assignedToFilters = assigneeIdentityValues(email, displayName).map(
      (value) => `assigned_to.eq.${escapeSupabaseValue(value)}`
    )

    const { data, error } = await supabase
      .from('todo_actions')
      .select('*')
      .or([`created_by_email.eq.${escapeSupabaseValue(email)}`, ...assignedToFilters].join(','))
      .order('status', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })

    if (error) {
      console.error(error)
      setToast({ tone: 'error', text: 'Les actions n’ont pas pu être chargées.' })
      return
    }

    setRows((data || []) as TodoRow[])
  }

  /* ---------------------------------------------------------------- */
  /* Identité et libellés                                              */
  /* ---------------------------------------------------------------- */

  const assigneeByEmail = useMemo(() => {
    const map = new Map<string, Assignee>()
    assignees.forEach((item) => map.set(item.email, item))
    return map
  }, [assignees])

  /**
   * Les lignes anciennes ont pu stocker un nom au lieu d'un email :
   * on résout les deux formes vers le nom affiché aujourd'hui.
   */
  function resolveAssignee(value: string | null | undefined): Assignee | null {
    const raw = String(value || '').trim()
    if (!raw) return null

    const byEmail = assigneeByEmail.get(raw.toLowerCase())
    if (byEmail) return byEmail

    const byName = assignees.find((item) => normalize(item.name) === normalize(raw))
    if (byName) return byName

    return { email: raw, name: raw }
  }

  function assigneeLabel(value: string | null | undefined) {
    return resolveAssignee(value)?.name || 'Non assignée'
  }

  const myIdentities = useMemo(
    () => assigneeIdentityValues(currentEmail, currentDisplayName).map(normalize),
    [currentEmail, currentDisplayName]
  )

  function isAssignedToMe(row: TodoRow) {
    return myIdentities.includes(normalize(row.assigned_to))
  }

  function isCreatedByMe(row: TodoRow) {
    return normalize(row.created_by_email) === normalize(currentEmail)
  }

  /* ---------------------------------------------------------------- */
  /* Filtres et tri                                                    */
  /* ---------------------------------------------------------------- */

  const visibleRows = useMemo(
    () => rows.filter((row) => isCreatedByMe(row) || isAssignedToMe(row)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, myIdentities, currentEmail]
  )

  const filteredRows = useMemo(() => {
    const term = normalize(search)

    return visibleRows.filter((row) => {
      const open = isOpenStatus(row.status)
      if (tab === 'active' ? !open : open) return false

      if (scope === 'mine' && !isAssignedToMe(row)) return false
      if (scope === 'created' && !isCreatedByMe(row)) return false

      if (assigneeFilter !== 'TOUS') {
        const resolved = resolveAssignee(row.assigned_to)
        if (!resolved || resolved.email !== assigneeFilter) return false
      }

      if (statusFilter !== 'TOUS' && row.status !== statusFilter) return false

      if (!term) return true

      const haystack = [
        row.mission_project,
        row.description_action,
        row.comment_progress,
        row.created_by_name,
        row.numero_tiers,
        assigneeLabel(row.assigned_to),
        formatDateFr(row.due_date),
      ]
        .map((value) => normalize(value))
        .join(' ')

      return haystack.includes(term)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows, tab, scope, assigneeFilter, statusFilter, search, assignees])

  const sortedRows = useMemo(() => {
    const list = [...filteredRows]

    list.sort((a, b) => {
      if (sortKey === 'recent') {
        return String(b.created_at || '').localeCompare(String(a.created_at || ''))
      }
      if (sortKey === 'mission') {
        const cmp = String(a.mission_project || 'zzz').localeCompare(String(b.mission_project || 'zzz'), 'fr', {
          sensitivity: 'base',
        })
        if (cmp !== 0) return cmp
      }
      const da = a.due_date || '9999-12-31'
      const db = b.due_date || '9999-12-31'
      if (da !== db) return da.localeCompare(db)
      return (a.sort_order || 0) - (b.sort_order || 0)
    })

    return list
  }, [filteredRows, sortKey])

  /** Regroupement par urgence : c'est la lecture utile d'une liste d'actions. */
  const groupedRows = useMemo(() => {
    if (tab === 'closed') {
      return [{ key: 'later' as DueBucketKey, label: 'Clôturées', rail: 'bg-[#9BA5AF]', tone: 'text-slate-600', rows: sortedRows }]
    }

    return DUE_BUCKETS.map((bucket) => ({
      ...bucket,
      rows: sortedRows.filter((row) => getDueBucket(row) === bucket.key),
    })).filter((bucket) => bucket.rows.length > 0)
  }, [sortedRows, tab])

  const stats = useMemo(() => {
    const open = visibleRows.filter((row) => isOpenStatus(row.status))
    const today = todayIso()
    const weekEnd = addDaysIso(today, 7)

    return {
      open: open.length,
      overdue: open.filter((row) => row.due_date && row.due_date < today).length,
      week: open.filter((row) => row.due_date && row.due_date >= today && row.due_date <= weekEnd).length,
      mine: open.filter((row) => isAssignedToMe(row)).length,
      closed: visibleRows.filter((row) => !isOpenStatus(row.status)).length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows, myIdentities])

  const selectedRow = useMemo(
    () => visibleRows.find((row) => row.id === selectedId) || null,
    [visibleRows, selectedId]
  )

  useEffect(() => {
    if (selectedId && sortedRows.some((row) => row.id === selectedId)) return
    setSelectedId(sortedRows[0]?.id || '')
  }, [sortedRows, selectedId])

  const filtersActive =
    Boolean(search.trim()) || scope !== 'all' || assigneeFilter !== 'TOUS' || statusFilter !== 'TOUS'

  function resetFilters() {
    setSearch('')
    setScope('all')
    setAssigneeFilter('TOUS')
    setStatusFilter('TOUS')
  }

  /* ---------------------------------------------------------------- */
  /* Écritures                                                         */
  /* ---------------------------------------------------------------- */

  async function addRow(description?: string) {
    if (!canTodo || creating) return

    setCreating(true)
    const maxSort = rows.reduce((max, row) => Math.max(max, row.sort_order || 0), 0)

    const payload = {
      created_by_email: currentEmail,
      created_by_name: currentDisplayName,
      mission_project: '',
      description_action: String(description || '').trim(),
      assigned_to: currentEmail,
      due_date: null,
      status: 'Non débuté' as TodoStatus,
      comment_progress: '',
      sort_order: maxSort + 1,
      numero_tiers: null,
    }

    const { data, error } = await supabase.from('todo_actions').insert(payload).select('*').single()
    setCreating(false)

    if (error) {
      console.error(error)
      setToast({ tone: 'error', text: 'L’action n’a pas pu être créée.' })
      return
    }

    const created = data as TodoRow
    setRows((prev) => [created, ...prev])
    setQuickAdd('')
    setTab('active')
    setSelectedId(created.id)
  }

  async function deleteRow(id: string) {
    const row = rows.find((item) => item.id === id)
    const label = String(row?.description_action || '').trim()
    const ok = window.confirm(
      label ? `Supprimer définitivement « ${label.slice(0, 80)} » ?` : 'Supprimer définitivement cette action ?'
    )
    if (!ok) return

    const { error } = await supabase.from('todo_actions').delete().eq('id', id)
    if (error) {
      console.error(error)
      setToast({ tone: 'error', text: 'L’action n’a pas pu être supprimée.' })
      return
    }

    setRows((prev) => prev.filter((item) => item.id !== id))
    setToast({ tone: 'success', text: 'Action supprimée.' })
  }

  function updateLocal(id: string, patch: Partial<TodoRow>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  /** Enregistrement différé : on tape sans attendre, la base suit. */
  function queueSave(id: string, patch: Partial<TodoRow>) {
    updateLocal(id, patch)

    if (autosaveTimers.current[id]) clearTimeout(autosaveTimers.current[id])
    autosaveTimers.current[id] = setTimeout(() => {
      void saveRow(id, patch)
    }, 400)
  }

  async function saveRow(id: string, patch: Partial<TodoRow>) {
    setSavingId(id)

    const { error } = await supabase.from('todo_actions').update(patch).eq('id', id)

    setSavingId((prev) => (prev === id ? null : prev))

    if (error) {
      console.error(error)
      setToast({ tone: 'error', text: 'L’enregistrement a échoué. Vos dernières saisies ne sont pas sauvegardées.' })
      return
    }

    setSavedAt(Date.now())
  }

  function toggleDone(row: TodoRow) {
    const nextStatus: TodoStatus = row.status === 'Terminé' ? 'En cours' : 'Terminé'
    updateLocal(row.id, { status: nextStatus })
    void saveRow(row.id, { status: nextStatus })
  }

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  /* ---------------------------------------------------------------- */
  /* Rendu                                                             */
  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F4F3F0] p-6">
        <div className="mx-auto max-w-[1500px] rounded-2xl border border-[#E2DFD8] bg-white p-16 text-center text-sm text-slate-500">
          Chargement de vos actions…
        </div>
      </div>
    )
  }

  if (!canTodo) return null

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-12">
      <header className="border-b border-[#1E2833] bg-[#111820]">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 px-4 py-6 md:px-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#B4761A]">Suivi</div>
            <h1 className="mt-2 text-[28px] font-bold leading-tight text-white md:text-[32px]">Actions</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
              Ce que vous avez créé et ce qui vous est confié, classé par échéance.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <HeaderStat label="En retard" value={stats.overdue} tone={stats.overdue > 0 ? 'warn' : 'default'} />
            <HeaderStat label="Sous 7 jours" value={stats.week} />
            <HeaderStat label="Pour moi" value={stats.mine} />
            <HeaderStat label="Ouvertes" value={stats.open} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1500px] px-4 py-5 md:px-8">
        {/* ------------------------------------------------ Barre d'action */}
        <div className="rounded-2xl border border-[#E2DFD8] bg-white p-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-[#D8D3C8] bg-white px-3 transition focus-within:border-[#B4761A] focus-within:ring-2 focus-within:ring-[#B4761A]/25">
              <span className="text-lg leading-none text-[#B4761A]">+</span>
              <input
                value={quickAdd}
                onChange={(event) => setQuickAdd(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && quickAdd.trim()) {
                    event.preventDefault()
                    void addRow(quickAdd)
                  }
                }}
                placeholder="Nouvelle action — décrivez-la puis Entrée"
                className="h-[44px] w-full border-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
            <PrimaryButton onClick={() => void addRow(quickAdd)} disabled={creating}>
              {creating ? 'Création…' : 'Ajouter'}
            </PrimaryButton>
          </div>
        </div>

        {/* ------------------------------------------------ Filtres */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Segmented
            value={tab}
            onChange={(value) => setTab(value as TabKey)}
            options={[
              { value: 'active', label: `En cours (${stats.open})` },
              { value: 'closed', label: `Clôturées (${stats.closed})` },
            ]}
          />

          <Segmented
            value={scope}
            onChange={(value) => setScope(value as ScopeKey)}
            options={[
              { value: 'all', label: 'Tout' },
              { value: 'mine', label: 'Pour moi' },
              { value: 'created', label: 'Créées par moi' },
            ]}
          />

          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher dans les actions"
            className="h-[38px] w-full max-w-xs rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
          />

          <SelectField
            value={assigneeFilter}
            onChange={setAssigneeFilter}
            options={[
              { value: 'TOUS', label: 'Toutes les personnes' },
              ...assignees.map((item) => ({ value: item.email, label: item.name })),
            ]}
            className="w-[200px]"
          />

          <SelectField
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as 'TOUS' | TodoStatus)}
            options={[
              { value: 'TOUS', label: 'Tous les statuts' },
              ...STATUS_OPTIONS.map((status) => ({ value: status, label: status })),
            ]}
            className="w-[170px]"
          />

          <SelectField
            value={sortKey}
            onChange={(value) => setSortKey(value as SortKey)}
            options={[
              { value: 'due_date', label: 'Trier par échéance' },
              { value: 'recent', label: 'Trier par création' },
              { value: 'mission', label: 'Trier par mission' },
            ]}
            className="w-[190px]"
          />

          {filtersActive && <GhostButton onClick={resetFilters}>Effacer les filtres</GhostButton>}

          <span className="ml-auto text-xs text-slate-500">
            {sortedRows.length} action{sortedRows.length > 1 ? 's' : ''} affichée{sortedRows.length > 1 ? 's' : ''}
          </span>
        </div>

        {/* ------------------------------------------------ Liste + fiche */}
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
          <section className="min-w-0">
            {sortedRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#D8D3C8] bg-white px-8 py-20 text-center">
                <h3 className="text-lg font-bold text-slate-900">
                  {filtersActive ? 'Aucune action ne correspond' : tab === 'active' ? 'Rien en cours' : 'Aucune action clôturée'}
                </h3>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-600">
                  {filtersActive
                    ? 'Élargissez la recherche ou effacez les filtres pour retrouver vos actions.'
                    : tab === 'active'
                      ? 'Écrivez une action dans le champ du haut et validez avec Entrée.'
                      : 'Les actions terminées ou annulées apparaîtront ici.'}
                </p>
                {filtersActive && (
                  <div className="mt-5">
                    <GhostButton onClick={resetFilters}>Effacer les filtres</GhostButton>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {groupedRows.map((bucket) => (
                  <div key={bucket.key}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className={`h-3 w-1 rounded-full ${bucket.rail}`} />
                      <h2 className={`text-[11px] font-bold uppercase tracking-[0.16em] ${bucket.tone}`}>
                        {bucket.label}
                      </h2>
                      <span className="text-[11px] font-semibold tabular-nums text-slate-400">{bucket.rows.length}</span>
                    </div>

                    <ul className="overflow-hidden rounded-2xl border border-[#E2DFD8] bg-white">
                      {bucket.rows.map((row) => {
                        const active = row.id === selectedId
                        const overdue = isOverdue(row)
                        const done = row.status === 'Terminé'
                        const cancelled = row.status === 'Annulé'
                        const assignee = resolveAssignee(row.assigned_to)

                        return (
                          <li key={row.id} className="border-b border-[#EFEDE8] last:border-0">
                            <div
                              className={`group flex items-start gap-3 px-3 py-2.5 transition ${
                                active ? 'bg-[#FDF7EA]' : 'hover:bg-[#FAF9F7]'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => toggleDone(row)}
                                aria-pressed={done}
                                title={done ? 'Rouvrir l’action' : 'Marquer comme terminée'}
                                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] ${
                                  done
                                    ? 'border-[#2F6B4F] bg-[#2F6B4F] text-white'
                                    : 'border-[#CBC5B8] bg-white text-transparent hover:border-[#B4761A] hover:text-[#B4761A]'
                                }`}
                              >
                                ✓
                              </button>

                              <button
                                type="button"
                                onClick={() => setSelectedId(row.id)}
                                className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <span
                                    className={`min-w-0 flex-1 truncate text-sm font-semibold ${
                                      done || cancelled ? 'text-slate-400 line-through' : 'text-slate-900'
                                    }`}
                                  >
                                    {String(row.description_action || '').trim() || 'Action sans description'}
                                  </span>

                                  <span
                                    className={`shrink-0 text-xs font-semibold tabular-nums ${
                                      overdue ? 'text-[#A32C2C]' : 'text-slate-500'
                                    }`}
                                  >
                                    {row.due_date ? relativeDueLabel(row.due_date) : '—'}
                                  </span>
                                </div>

                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                                  <span className={`inline-flex rounded-full px-2 py-0.5 font-bold ${getStatusClasses(row.status)}`}>
                                    {row.status}
                                  </span>

                                  {row.mission_project && (
                                    <span className="max-w-[220px] truncate rounded-md bg-[#EDEAE3] px-2 py-0.5 font-medium text-slate-600">
                                      {row.mission_project}
                                    </span>
                                  )}

                                  {row.numero_tiers && (
                                    <span className="max-w-[160px] truncate rounded-md bg-[#E6EEF3] px-2 py-0.5 font-medium text-[#2C6F88]">
                                      Client {row.numero_tiers}
                                    </span>
                                  )}

                                  <span className="inline-flex items-center gap-1.5">
                                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#EDEAE3] text-[8px] font-bold text-slate-600">
                                      {initialsOf(assignee?.name || '?')}
                                    </span>
                                    {assignee?.name || 'Non assignée'}
                                  </span>

                                  {row.comment_progress && <span className="text-slate-400">a un commentaire</span>}
                                </div>
                              </button>

                              {savingId === row.id && (
                                <span className="mt-1 shrink-0 text-[10px] font-semibold text-[#8A5A11]">Enreg.</span>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* --------------------------------------------- Fiche action */}
          <aside className="min-w-0">
            {selectedRow ? (
              <div className="sticky top-4 rounded-2xl border border-[#E2DFD8] bg-white">
                <div className="flex items-start justify-between gap-3 border-b border-[#EFEDE8] px-5 py-4">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8A5A11]">Action</div>
                    <h2 className="mt-1 truncate text-lg font-bold text-slate-900">
                      {String(selectedRow.description_action || '').trim() || 'Action sans description'}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Créée par {selectedRow.created_by_name || '—'} · {formatDateTimeFr(selectedRow.created_at)}
                    </p>
                  </div>
                  <SaveIndicator saving={savingId === selectedRow.id} savedAt={savedAt} />
                </div>

                <div className="space-y-4 px-5 py-4">
                  <Field label="Description">
                    <textarea
                      value={selectedRow.description_action || ''}
                      onChange={(event) => queueSave(selectedRow.id, { description_action: event.target.value })}
                      onInput={(event) => autoResize(event.currentTarget)}
                      rows={3}
                      placeholder="Ce qu’il y a à faire, en une phrase claire"
                      className="w-full resize-none rounded-xl border border-[#D8D3C8] bg-white px-3 py-2.5 text-sm leading-relaxed outline-none transition placeholder:text-slate-400 focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
                    />
                  </Field>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Mission ou projet">
                      <input
                        value={selectedRow.mission_project || ''}
                        onChange={(event) => queueSave(selectedRow.id, { mission_project: event.target.value })}
                        placeholder="Projections stock, Focus mensuel…"
                        className="h-[42px] w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
                      />
                    </Field>

                    <Field label="Client (n° tiers)">
                      <input
                        value={selectedRow.numero_tiers || ''}
                        onChange={(event) => queueSave(selectedRow.id, { numero_tiers: event.target.value || null })}
                        placeholder="Ex. DB0079"
                        className="h-[42px] w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Confiée à">
                      <SelectField
                        value={resolveAssignee(selectedRow.assigned_to)?.email || ''}
                        onChange={(value) => queueSave(selectedRow.id, { assigned_to: value || null })}
                        options={[
                          { value: '', label: 'Non assignée' },
                          ...assignees.map((item) => ({ value: item.email, label: item.name })),
                        ]}
                      />
                    </Field>

                    <Field label="À faire pour le">
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={selectedRow.due_date || ''}
                          onChange={(event) => queueSave(selectedRow.id, { due_date: event.target.value || null })}
                          className="h-[42px] w-full min-w-0 rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm outline-none transition focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
                        />
                        {selectedRow.due_date && (
                          <button
                            type="button"
                            onClick={() => queueSave(selectedRow.id, { due_date: null })}
                            className="shrink-0 rounded-lg border border-[#D8D3C8] px-2 py-2 text-xs text-slate-500 transition hover:border-[#A32C2C] hover:text-[#A32C2C]"
                            title="Retirer l’échéance"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <DueShortcut label="Aujourd’hui" onClick={() => queueSave(selectedRow.id, { due_date: todayIso() })} />
                        <DueShortcut label="Demain" onClick={() => queueSave(selectedRow.id, { due_date: addDaysIso(todayIso(), 1) })} />
                        <DueShortcut label="+1 semaine" onClick={() => queueSave(selectedRow.id, { due_date: addDaysIso(todayIso(), 7) })} />
                      </div>
                    </Field>
                  </div>

                  <Field label="Statut">
                    <div className="flex flex-wrap gap-1.5">
                      {STATUS_OPTIONS.map((status) => {
                        const active = selectedRow.status === status
                        return (
                          <button
                            type="button"
                            key={status}
                            onClick={() => queueSave(selectedRow.id, { status })}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] ${
                              active
                                ? 'border-[#111820] bg-[#111820] text-white'
                                : 'border-[#E2DFD8] bg-white text-slate-600 hover:border-[#B4761A]'
                            }`}
                          >
                            <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${getStatusDotClass(status)}`} />
                            {status}
                          </button>
                        )
                      })}
                    </div>
                  </Field>

                  <Field label="Commentaire et avancement">
                    <textarea
                      value={selectedRow.comment_progress || ''}
                      onChange={(event) => queueSave(selectedRow.id, { comment_progress: event.target.value })}
                      onInput={(event) => autoResize(event.currentTarget)}
                      rows={4}
                      placeholder="Où en est-on ? Points bloquants, prochaine étape…"
                      className="w-full resize-none rounded-xl border border-[#D8D3C8] bg-white px-3 py-2.5 text-sm leading-relaxed outline-none transition placeholder:text-slate-400 focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
                    />
                  </Field>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-[#EFEDE8] px-5 py-3">
                  <span className="text-xs text-slate-500">
                    Modifiée le {formatDateTimeFr(selectedRow.updated_at)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void deleteRow(selectedRow.id)}
                    className="rounded-lg border border-[#E2B4B4] bg-white px-3 py-1.5 text-xs font-semibold text-[#A32C2C] transition hover:border-[#A32C2C] hover:bg-[#FBE9E9] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A32C2C]"
                  >
                    Supprimer l’action
                  </button>
                </div>
              </div>
            ) : (
              <div className="sticky top-4 rounded-2xl border border-dashed border-[#D8D3C8] bg-white px-6 py-16 text-center">
                <h3 className="text-base font-bold text-slate-900">Aucune action sélectionnée</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Choisissez une action à gauche pour la modifier ici. Les saisies sont enregistrées automatiquement.
                </p>
              </div>
            )}
          </aside>
        </div>
      </main>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[10000] flex justify-center px-4">
          <div
            role="status"
            className={`pointer-events-auto flex max-w-2xl items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-xl ${
              toast.tone === 'success' ? 'bg-[#111820] text-white' : 'bg-[#7F1D1D] text-white'
            }`}
          >
            <span className="flex-1 leading-relaxed">{toast.text}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="shrink-0 rounded px-1 text-white/70 transition hover:text-white"
              aria-label="Fermer le message"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Briques d'interface                                                  */
/* ------------------------------------------------------------------ */

function HeaderStat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'warn' }) {
  const alert = tone === 'warn' && value > 0
  return (
    <div className={`min-w-[108px] rounded-xl border px-4 py-2.5 ${alert ? 'border-[#B4761A] bg-[#1B1710]' : 'border-[#2C3946] bg-[#161F29]'}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold tabular-nums ${alert ? 'text-[#E0A961]' : 'text-white'}`}>{value}</div>
    </div>
  )
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div className="inline-flex rounded-xl border border-[#D8D3C8] bg-white p-1">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            type="button"
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] ${
              active ? 'bg-[#111820] text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function SelectField({
  value,
  onChange,
  options,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  className?: string
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`h-[42px] cursor-pointer rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25 ${
        className || 'w-full'
      }`}
    >
      {options.map((option) => (
        <option key={`${option.value}-${option.label}`} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-800">{label}</span>
      {children}
    </label>
  )
}

function DueShortcut({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-[#E2DFD8] bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-[#B4761A] hover:text-[#8A5A11] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]"
    >
      {label}
    </button>
  )
}

/** Confirme visuellement l'enregistrement automatique, sans bouton Enregistrer. */
function SaveIndicator({ saving, savedAt }: { saving: boolean; savedAt: number }) {
  const [recent, setRecent] = useState(false)

  useEffect(() => {
    if (!savedAt) return
    setRecent(true)
    const timer = window.setTimeout(() => setRecent(false), 2200)
    return () => window.clearTimeout(timer)
  }, [savedAt])

  if (saving) {
    return (
      <span className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[#8A5A11]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#B4761A]" />
        Enregistrement…
      </span>
    )
  }

  if (recent) {
    return (
      <span className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[#1F5B44]">
        <span className="h-2 w-2 rounded-full bg-[#2F6B4F]" />
        Enregistré
      </span>
    )
  }

  return <span className="shrink-0 text-xs text-slate-400">Enregistrement automatique</span>
}

function PrimaryButton({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-[44px] shrink-0 rounded-xl bg-[#111820] px-5 text-sm font-semibold text-white transition hover:bg-[#25313D] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function GhostButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-[#D8D3C8] bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-[#B4761A] hover:text-[#8A5A11] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]"
    >
      {children}
    </button>
  )
}
