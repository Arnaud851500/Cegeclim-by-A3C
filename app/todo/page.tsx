'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

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
  numero_tiers: string | null
  // Nouveaux champs (migration 20260920_todo_categories_equipes.sql)
  category_id: string | null
  team_id: string | null
  /** Personne concernée par la tâche (sujet) — différent de assigned_to (personne à qui elle est confiée). */
  concerned_person: string | null
}

type Category = {
  id: string
  name: string
  color: string
  sort_order: number
  is_active: boolean
}

type Team = {
  id: string
  name: string
  color: string
  sort_order: number
  is_active: boolean
}

type TeamMember = { team_id: string; email: string }

/** Personne à qui une action peut être confiée. Le nom vient de l'écran Autorisations. */
type Assignee = { email: string; name: string }

type ScopeKey = 'all' | 'mine' | 'created'
type TabKey = 'active' | 'closed'
type ViewKey = 'table' | 'planning' | 'columns'
type ColumnGroupKey = 'category' | 'concerned' | 'team'
type TableSortKey = 'description' | 'category' | 'team' | 'assigned' | 'concerned' | 'client' | 'status' | 'due'
type ToastState = { tone: 'success' | 'error'; text: string } | null

type Draft = {
  description_action: string
  category_id: string | null
  team_id: string | null
  assigned_to: string | null
  concerned_person: string
  numero_tiers: string
  due_date: string | null
  status: TodoStatus
  comment_progress: string
}

/* ------------------------------------------------------------------ */
/* Constantes                                                           */
/* ------------------------------------------------------------------ */

const STATUS_OPTIONS: TodoStatus[] = ['Non débuté', 'En cours', 'Terminé', 'Annulé']
const OPEN_STATUSES: TodoStatus[] = ['Non débuté', 'En cours']

const NO_CATEGORY = '__none_cat__'
const NO_TEAM = '__none_team__'
const NO_PERSON = '__none_person__'

/** Palette proposée dans le paramétrage (une couleur libre reste possible). */
const COLOR_SWATCHES = [
  '#2C6F88', '#B4761A', '#2F6B4F', '#7A5EA8', '#C1683C',
  '#4E7A9B', '#A32C2C', '#8A8375', '#C79A4E', '#1F5B44',
  '#5B6B9A', '#B85C8A', '#3F8F8A', '#8C6D3F', '#4A4A4A',
]

const VIEW_OPTIONS: Array<{ value: ViewKey; label: string; hint: string }> = [
  { value: 'table', label: 'Tableur', hint: 'Une ligne par tâche, colonnes triables' },
  { value: 'planning', label: 'Planning', hint: 'Regroupé par catégorie, trié par échéance' },
  { value: 'columns', label: 'Colonnes', hint: 'Tableau façon Trello' },
]

/* ------------------------------------------------------------------ */
/* Utilitaires                                                          */
/* ------------------------------------------------------------------ */

function normalize(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
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

function formatDateShortFr(dateStr: string | null | undefined) {
  if (!dateStr) return ''
  const date = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(date.getTime())) return dateStr
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
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

function isOpenStatus(status: TodoStatus) {
  return OPEN_STATUSES.includes(status)
}

function isOverdue(row: { status: TodoStatus; due_date: string | null }) {
  return isOpenStatus(row.status) && Boolean(row.due_date) && (row.due_date as string) < todayIso()
}

function isDueSoon(row: { status: TodoStatus; due_date: string | null }) {
  if (!isOpenStatus(row.status) || !row.due_date) return false
  const today = todayIso()
  return row.due_date >= today && row.due_date <= addDaysIso(today, 2)
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
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || email
  )
}

function safeColor(color: string | null | undefined, fallback = '#8A8375') {
  const value = String(color || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

/** Style d'une pastille colorée (fond teinté, texte de la couleur). */
function chipStyle(color: string): React.CSSProperties {
  const c = safeColor(color)
  return { backgroundColor: `${c}1F`, color: c, boxShadow: `inset 0 0 0 1px ${c}55` }
}

function sortByOrder<T extends { sort_order: number; name: string }>(list: T[]) {
  return [...list].sort(
    (a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })
  )
}

function emptyDraft(currentEmail: string): Draft {
  return {
    description_action: '',
    category_id: null,
    team_id: null,
    assigned_to: currentEmail,
    concerned_person: '',
    numero_tiers: '',
    due_date: null,
    status: 'Non débuté',
    comment_progress: '',
  }
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export default function TodoPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number>(0)

  const [currentEmail, setCurrentEmail] = useState('')
  const [currentDisplayName, setCurrentDisplayName] = useState('')
  const [canTodo, setCanTodo] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [rows, setRows] = useState<TodoRow[]>([])

  const [view, setView] = useState<ViewKey>('table')
  const [columnGroup, setColumnGroup] = useState<ColumnGroupKey>('category')
  const [tableSort, setTableSort] = useState<{ key: TableSortKey; dir: 'asc' | 'desc' }>({ key: 'due', dir: 'asc' })

  const [tab, setTab] = useState<TabKey>('active')
  const [scope, setScope] = useState<ScopeKey>('all')
  const [search, setSearch] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('TOUS')
  const [statusFilter, setStatusFilter] = useState<'TOUS' | TodoStatus>('TOUS')
  const [categoryFilter, setCategoryFilter] = useState('TOUS')
  const [teamFilter, setTeamFilter] = useState('TOUS')

  const [selectedId, setSelectedId] = useState<string>('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [creating, setCreating] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

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

  // Le choix de vue est conservé d'une session à l'autre (préférence locale).
  useEffect(() => {
    try {
      const savedView = window.localStorage.getItem('todo.view') as ViewKey | null
      const savedGroup = window.localStorage.getItem('todo.columnGroup') as ColumnGroupKey | null
      if (savedView && VIEW_OPTIONS.some((option) => option.value === savedView)) setView(savedView)
      if (savedGroup && ['category', 'concerned', 'team'].includes(savedGroup)) setColumnGroup(savedGroup)
    } catch {
      /* stockage local indisponible : on garde les valeurs par défaut */
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem('todo.view', view)
      window.localStorage.setItem('todo.columnGroup', columnGroup)
    } catch {
      /* ignoré */
    }
  }, [view, columnGroup])

  /* ---------------------------------------------------------------- */
  /* Chargement                                                        */
  /* ---------------------------------------------------------------- */

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

    const [{ data: adminData }, { data: usersData }] = await Promise.all([
      supabase.rpc('todo_is_admin'),
      supabase
        .from('user_page_access')
        .select('email, display_name, can_todo')
        .eq('can_todo', true)
        .order('email', { ascending: true }),
    ])

    const admin = Boolean(adminData)
    setIsAdmin(admin)

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

    const members = await loadReferentials()
    await loadRows(email, displayName, admin, members)

    setLoading(false)
  }

  /** Catégories, projets / équipes et membres. Retourne les membres (utile pour le premier chargement). */
  async function loadReferentials(): Promise<TeamMember[]> {
    const [{ data: cats }, { data: tms }, { data: mbrs }] = await Promise.all([
      supabase.from('todo_categories').select('id, name, color, sort_order, is_active').order('sort_order'),
      supabase.from('todo_teams').select('id, name, color, sort_order, is_active').order('sort_order'),
      supabase.from('todo_team_members').select('team_id, email'),
    ])
    setCategories(sortByOrder((cats || []) as Category[]))
    setTeams(sortByOrder((tms || []) as Team[]))
    const members = (mbrs || []) as TeamMember[]
    setTeamMembers(members)
    return members
  }

  async function loadRows(emailParam?: string, displayNameParam?: string, adminParam?: boolean, membersParam?: TeamMember[]) {
    const email = emailParam || currentEmail
    const displayName = displayNameParam || currentDisplayName
    const admin = adminParam ?? isAdmin
    const members = membersParam ?? teamMembers

    if (!email) return

    let query = supabase.from('todo_actions').select('*')

    if (!admin) {
      // Visibilité : ce que j'ai créé, ce qui m'est confié, et les tâches des
      // projets / équipes dont je suis membre.
      const assignedToFilters = assigneeIdentityValues(email, displayName).map(
        (value) => `assigned_to.eq.${escapeSupabaseValue(value)}`
      )
      const myTeamIds = members.filter((m) => m.email === email).map((m) => m.team_id)
      const orParts = [`created_by_email.eq.${escapeSupabaseValue(email)}`, ...assignedToFilters]
      if (myTeamIds.length > 0) orParts.push(`team_id.in.(${myTeamIds.join(',')})`)
      query = query.or(orParts.join(','))
    }

    const { data, error } = await query
      .order('status', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })

    if (error) {
      console.error(error)
      setToast({ tone: 'error', text: 'Les tâches n’ont pas pu être chargées.' })
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

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams])

  const resolveAssignee = useCallback(
    (value: string | null | undefined): Assignee | null => {
      const raw = String(value || '').trim()
      if (!raw) return null
      const byEmail = assigneeByEmail.get(raw.toLowerCase())
      if (byEmail) return byEmail
      const byName = assignees.find((item) => normalize(item.name) === normalize(raw))
      if (byName) return byName
      return { email: raw, name: raw }
    },
    [assigneeByEmail, assignees]
  )

  function assigneeLabel(value: string | null | undefined) {
    return resolveAssignee(value)?.name || 'Non assignée'
  }

  const myIdentities = useMemo(
    () => assigneeIdentityValues(currentEmail, currentDisplayName).map(normalize),
    [currentEmail, currentDisplayName]
  )

  const isAssignedToMe = useCallback(
    (row: TodoRow) => myIdentities.includes(normalize(row.assigned_to)),
    [myIdentities]
  )

  const isCreatedByMe = useCallback(
    (row: TodoRow) => normalize(row.created_by_email) === normalize(currentEmail),
    [currentEmail]
  )

  const myTeamIds = useMemo(
    () => new Set(teamMembers.filter((m) => m.email === currentEmail).map((m) => m.team_id)),
    [teamMembers, currentEmail]
  )

  /* ---------------------------------------------------------------- */
  /* Filtres et tri                                                    */
  /* ---------------------------------------------------------------- */

  const visibleRows = useMemo(
    () =>
      isAdmin
        ? rows
        : rows.filter((row) => isCreatedByMe(row) || isAssignedToMe(row) || (row.team_id ? myTeamIds.has(row.team_id) : false)),
    [rows, isAdmin, isCreatedByMe, isAssignedToMe, myTeamIds]
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
      if (categoryFilter !== 'TOUS' && (row.category_id || NO_CATEGORY) !== categoryFilter) return false
      if (teamFilter !== 'TOUS' && (row.team_id || NO_TEAM) !== teamFilter) return false

      if (!term) return true

      const haystack = [
        row.mission_project,
        row.description_action,
        row.comment_progress,
        row.created_by_name,
        row.numero_tiers,
        row.concerned_person,
        categoryById.get(row.category_id || '')?.name,
        teamById.get(row.team_id || '')?.name,
        assigneeLabel(row.assigned_to),
        formatDateFr(row.due_date),
      ]
        .map((value) => normalize(value))
        .join(' ')

      return haystack.includes(term)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows, tab, scope, assigneeFilter, statusFilter, categoryFilter, teamFilter, search, assignees, categories, teams])

  /** Tri par échéance (puis ordre manuel) : la lecture de base d'un planning. */
  const byDue = useCallback((a: TodoRow, b: TodoRow) => {
    const da = a.due_date || '9999-12-31'
    const db = b.due_date || '9999-12-31'
    if (da !== db) return da.localeCompare(db)
    return (a.sort_order || 0) - (b.sort_order || 0)
  }, [])

  const tableRows = useMemo(() => {
    const list = [...filteredRows]
    const dir = tableSort.dir === 'asc' ? 1 : -1
    const text = (v: string | null | undefined) => normalize(v) || '￿'

    list.sort((a, b) => {
      let cmp = 0
      switch (tableSort.key) {
        case 'description':
          cmp = text(a.description_action).localeCompare(text(b.description_action))
          break
        case 'category':
          cmp = text(categoryById.get(a.category_id || '')?.name || a.mission_project).localeCompare(
            text(categoryById.get(b.category_id || '')?.name || b.mission_project)
          )
          break
        case 'team':
          cmp = text(teamById.get(a.team_id || '')?.name).localeCompare(text(teamById.get(b.team_id || '')?.name))
          break
        case 'assigned':
          cmp = text(assigneeLabel(a.assigned_to)).localeCompare(text(assigneeLabel(b.assigned_to)))
          break
        case 'concerned':
          cmp = text(a.concerned_person).localeCompare(text(b.concerned_person))
          break
        case 'client':
          cmp = text(a.numero_tiers).localeCompare(text(b.numero_tiers))
          break
        case 'status':
          cmp = STATUS_OPTIONS.indexOf(a.status) - STATUS_OPTIONS.indexOf(b.status)
          break
        case 'due':
        default:
          cmp = byDue(a, b)
      }
      if (cmp === 0) cmp = byDue(a, b)
      return cmp * dir
    })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows, tableSort, categoryById, teamById, assignees, byDue])

  /** Planning : regroupé par catégorie (ordre du paramétrage), trié par échéance. */
  const planningGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; color: string; rows: TodoRow[] }> = []
    const sorted = [...filteredRows].sort(byDue)

    categories.forEach((cat) => {
      const catRows = sorted.filter((row) => row.category_id === cat.id)
      if (catRows.length > 0) groups.push({ key: cat.id, label: cat.name, color: cat.color, rows: catRows })
    })

    // Anciennes tâches avec un texte libre sans catégorie correspondante
    const freeText = new Map<string, TodoRow[]>()
    sorted
      .filter((row) => !row.category_id && String(row.mission_project || '').trim())
      .forEach((row) => {
        const key = normalize(row.mission_project)
        if (!freeText.has(key)) freeText.set(key, [])
        freeText.get(key)!.push(row)
      })
    Array.from(freeText.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([key, list]) => {
        groups.push({ key: `free:${key}`, label: String(list[0].mission_project).trim(), color: '#8A8375', rows: list })
      })

    const none = sorted.filter((row) => !row.category_id && !String(row.mission_project || '').trim())
    if (none.length > 0) groups.push({ key: NO_CATEGORY, label: 'Sans catégorie', color: '#B8B2A5', rows: none })

    return groups
  }, [filteredRows, categories, byDue])

  /** Colonnes façon Trello : par catégorie, par personne concernée ou par projet / équipe. */
  const columnGroups = useMemo(() => {
    const sorted = [...filteredRows].sort(byDue)
    const cols: Array<{ key: string; label: string; color: string; rows: TodoRow[] }> = []

    if (columnGroup === 'category') {
      categories
        .filter((cat) => cat.is_active || sorted.some((row) => row.category_id === cat.id))
        .forEach((cat) => cols.push({ key: cat.id, label: cat.name, color: cat.color, rows: sorted.filter((r) => r.category_id === cat.id) }))
      cols.push({ key: NO_CATEGORY, label: 'Sans catégorie', color: '#B8B2A5', rows: sorted.filter((r) => !r.category_id) })
    } else if (columnGroup === 'team') {
      teams
        .filter((team) => team.is_active || sorted.some((row) => row.team_id === team.id))
        .forEach((team) => cols.push({ key: team.id, label: team.name, color: team.color, rows: sorted.filter((r) => r.team_id === team.id) }))
      cols.push({ key: NO_TEAM, label: 'Sans projet / équipe', color: '#B8B2A5', rows: sorted.filter((r) => !r.team_id) })
    } else {
      const persons = new Map<string, { label: string; rows: TodoRow[] }>()
      sorted.forEach((row) => {
        const label = String(row.concerned_person || '').trim()
        const key = label ? normalize(label) : NO_PERSON
        if (!persons.has(key)) persons.set(key, { label: label || 'Sans personne concernée', rows: [] })
        persons.get(key)!.rows.push(row)
      })
      Array.from(persons.entries())
        .sort((a, b) => (a[0] === NO_PERSON ? 1 : b[0] === NO_PERSON ? -1 : a[1].label.localeCompare(b[1].label, 'fr')))
        .forEach(([key, value], index) =>
          cols.push({
            key: key === NO_PERSON ? NO_PERSON : `person:${value.label}`,
            label: value.label,
            color: key === NO_PERSON ? '#B8B2A5' : COLOR_SWATCHES[index % COLOR_SWATCHES.length],
            rows: value.rows,
          })
        )
    }

    return cols
  }, [filteredRows, columnGroup, categories, teams, byDue])

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
  }, [visibleRows, isAssignedToMe])

  const selectedRow = useMemo(
    () => visibleRows.find((row) => row.id === selectedId) || null,
    [visibleRows, selectedId]
  )

  const filtersActive =
    Boolean(search.trim()) ||
    scope !== 'all' ||
    assigneeFilter !== 'TOUS' ||
    statusFilter !== 'TOUS' ||
    categoryFilter !== 'TOUS' ||
    teamFilter !== 'TOUS'

  function resetFilters() {
    setSearch('')
    setScope('all')
    setAssigneeFilter('TOUS')
    setStatusFilter('TOUS')
    setCategoryFilter('TOUS')
    setTeamFilter('TOUS')
  }

  /* ---------------------------------------------------------------- */
  /* Écritures                                                         */
  /* ---------------------------------------------------------------- */

  async function createFromDraft() {
    if (!canTodo || creating || !draft) return
    const description = draft.description_action.trim()
    if (!description) {
      setToast({ tone: 'error', text: 'Décrivez la tâche avant de la créer.' })
      return
    }

    setCreating(true)
    const maxSort = rows.reduce((max, row) => Math.max(max, row.sort_order || 0), 0)

    const payload = {
      created_by_email: currentEmail,
      created_by_name: currentDisplayName,
      mission_project: draft.category_id ? categoryById.get(draft.category_id)?.name || '' : '',
      description_action: description,
      assigned_to: draft.assigned_to || null,
      due_date: draft.due_date || null,
      status: draft.status,
      comment_progress: draft.comment_progress || '',
      sort_order: maxSort + 1,
      numero_tiers: draft.numero_tiers.trim() || null,
      category_id: draft.category_id,
      team_id: draft.team_id,
      concerned_person: draft.concerned_person.trim() || null,
    }

    const { data, error } = await supabase.from('todo_actions').insert(payload).select('*').single()
    setCreating(false)

    if (error) {
      console.error(error)
      setToast({ tone: 'error', text: 'La tâche n’a pas pu être créée.' })
      return
    }

    const created = data as TodoRow
    setRows((prev) => [created, ...prev])
    setDraft(null)
    setTab(isOpenStatus(created.status) ? 'active' : 'closed')
    setToast({ tone: 'success', text: 'Tâche créée.' })
  }

  async function deleteRow(id: string) {
    const row = rows.find((item) => item.id === id)
    const label = String(row?.description_action || '').trim()
    const ok = window.confirm(
      label ? `Supprimer définitivement « ${label.slice(0, 80)} » ?` : 'Supprimer définitivement cette tâche ?'
    )
    if (!ok) return

    const { error } = await supabase.from('todo_actions').delete().eq('id', id)
    if (error) {
      console.error(error)
      setToast({ tone: 'error', text: 'La tâche n’a pas pu être supprimée.' })
      return
    }

    setRows((prev) => prev.filter((item) => item.id !== id))
    if (selectedId === id) setSelectedId('')
    setToast({ tone: 'success', text: 'Tâche supprimée.' })
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

  /** Changement de catégorie : le texte « mission_project » suit, pour les écrans qui l'affichent encore. */
  function patchCategory(id: string, categoryId: string | null) {
    queueSave(id, {
      category_id: categoryId,
      mission_project: categoryId ? categoryById.get(categoryId)?.name || '' : '',
    })
  }

  function toggleDone(row: TodoRow) {
    const nextStatus: TodoStatus = row.status === 'Terminé' ? 'En cours' : 'Terminé'
    updateLocal(row.id, { status: nextStatus })
    void saveRow(row.id, { status: nextStatus })
  }

  /** Glisser-déposer d'une carte vers une autre colonne (vue Colonnes). */
  function dropOnColumn(columnKey: string) {
    if (!dragId) return
    const row = rows.find((item) => item.id === dragId)
    setDragId(null)
    setDragOverKey(null)
    if (!row) return

    if (columnGroup === 'category') {
      const target = columnKey === NO_CATEGORY ? null : columnKey
      if ((row.category_id || null) !== target) patchCategory(row.id, target)
    } else if (columnGroup === 'team') {
      const target = columnKey === NO_TEAM ? null : columnKey
      if ((row.team_id || null) !== target) queueSave(row.id, { team_id: target })
    } else {
      const target = columnKey === NO_PERSON ? null : columnKey.replace(/^person:/, '')
      if (normalize(row.concerned_person) !== normalize(target)) queueSave(row.id, { concerned_person: target })
    }
  }

  /* ---------------------------------------------------------------- */
  /* Rendu                                                             */
  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F4F3F0] p-6">
        <div className="mx-auto max-w-[1600px] rounded-2xl border border-[#E2DFD8] bg-white p-16 text-center text-sm text-slate-500">
          Chargement de vos tâches…
        </div>
      </div>
    )
  }

  if (!canTodo) return null

  const shownCount = filteredRows.length

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-12">
      {/* ------------------------------------------------ Bandeau */}
      <header className="border-b border-[#1E2833] bg-[#111820]">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 md:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#B4761A]">Suivi</div>
              <h1 className="mt-1 text-[26px] font-bold leading-tight text-white md:text-[30px]">Tâches</h1>
            </div>
            <button
              type="button"
              onClick={() => setDraft(emptyDraft(currentEmail))}
              className="flex h-[52px] items-center gap-2 rounded-xl bg-[#B4761A] px-6 text-base font-bold text-white shadow-lg shadow-[#B4761A]/30 transition hover:bg-[#C98A2A] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <span className="text-2xl leading-none">+</span>
              Nouvelle tâche
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="flex h-[44px] items-center gap-2 rounded-xl border border-[#2C3946] bg-[#161F29] px-4 text-sm font-semibold text-slate-200 transition hover:border-[#B4761A] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]"
                title="Catégories, projets et équipes"
              >
                ⚙ Paramétrage
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <HeaderStat label="En retard" value={stats.overdue} tone={stats.overdue > 0 ? 'warn' : 'default'} />
            <HeaderStat label="Sous 7 jours" value={stats.week} />
            <HeaderStat label="Pour moi" value={stats.mine} />
            <HeaderStat label="Ouvertes" value={stats.open} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] px-4 py-4 md:px-6">
        {/* ------------------------------------------------ Vues + filtres */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-[#D8D3C8] bg-white p-1">
            {VIEW_OPTIONS.map((option) => {
              const active = option.value === view
              return (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => setView(option.value)}
                  title={option.hint}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] ${
                    active ? 'bg-[#111820] text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          {view === 'columns' && (
            <Segmented
              value={columnGroup}
              onChange={(value) => setColumnGroup(value as ColumnGroupKey)}
              options={[
                { value: 'category', label: 'Par catégorie' },
                { value: 'concerned', label: 'Par personne concernée' },
                { value: 'team', label: 'Par projet / équipe' },
              ]}
            />
          )}

          <span className="mx-1 hidden h-6 w-px bg-[#D8D3C8] lg:block" />

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
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher dans les tâches"
            className="h-[38px] w-full max-w-xs rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
          />

          <SelectField
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={[
              { value: 'TOUS', label: 'Toutes les catégories' },
              ...categories.map((item) => ({ value: item.id, label: item.name })),
              { value: NO_CATEGORY, label: 'Sans catégorie' },
            ]}
            className="h-[38px] w-[200px]"
          />

          <SelectField
            value={teamFilter}
            onChange={setTeamFilter}
            options={[
              { value: 'TOUS', label: 'Tous les projets / équipes' },
              ...teams.map((item) => ({ value: item.id, label: item.name })),
              { value: NO_TEAM, label: 'Sans projet / équipe' },
            ]}
            className="h-[38px] w-[210px]"
          />

          <SelectField
            value={assigneeFilter}
            onChange={setAssigneeFilter}
            options={[
              { value: 'TOUS', label: 'Toutes les personnes' },
              ...assignees.map((item) => ({ value: item.email, label: item.name })),
            ]}
            className="h-[38px] w-[190px]"
          />

          <SelectField
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as 'TOUS' | TodoStatus)}
            options={[
              { value: 'TOUS', label: 'Tous les statuts' },
              ...STATUS_OPTIONS.map((status) => ({ value: status, label: status })),
            ]}
            className="h-[38px] w-[160px]"
          />

          {filtersActive && <GhostButton onClick={resetFilters}>Effacer les filtres</GhostButton>}

          <span className="ml-auto text-xs text-slate-500">
            {shownCount} tâche{shownCount > 1 ? 's' : ''} affichée{shownCount > 1 ? 's' : ''}
          </span>
        </div>

        {/* ------------------------------------------------ Contenu */}
        <div className="mt-4">
          {shownCount === 0 ? (
            <EmptyState filtersActive={filtersActive} tab={tab} onReset={resetFilters} onCreate={() => setDraft(emptyDraft(currentEmail))} />
          ) : view === 'table' ? (
            <TableView
              rows={tableRows}
              sort={tableSort}
              onSort={(key) =>
                setTableSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }))
              }
              categoryById={categoryById}
              teamById={teamById}
              resolveAssignee={resolveAssignee}
              savingId={savingId}
              onOpen={(id) => setSelectedId(id)}
              onToggleDone={toggleDone}
            />
          ) : view === 'planning' ? (
            <PlanningView
              groups={planningGroups}
              teamById={teamById}
              resolveAssignee={resolveAssignee}
              savingId={savingId}
              onOpen={(id) => setSelectedId(id)}
              onToggleDone={toggleDone}
            />
          ) : (
            <ColumnsView
              columns={columnGroups}
              columnGroup={columnGroup}
              categoryById={categoryById}
              teamById={teamById}
              resolveAssignee={resolveAssignee}
              onOpen={(id) => setSelectedId(id)}
              dragId={dragId}
              dragOverKey={dragOverKey}
              onDragStart={(id) => setDragId(id)}
              onDragEnd={() => {
                setDragId(null)
                setDragOverKey(null)
              }}
              onDragOver={(key) => setDragOverKey(key)}
              onDrop={dropOnColumn}
            />
          )}
        </div>
      </main>

      {/* ------------------------------------------------ Fiche plein écran : modification */}
      {selectedRow && (
        <FullScreenPanel
          eyebrow="Tâche"
          title={String(selectedRow.description_action || '').trim() || 'Tâche sans description'}
          subtitle={`Créée par ${selectedRow.created_by_name || '—'} · ${formatDateTimeFr(selectedRow.created_at)} · modifiée le ${formatDateTimeFr(selectedRow.updated_at)}`}
          onClose={() => setSelectedId('')}
          headerRight={<SaveIndicator saving={savingId === selectedRow.id} savedAt={savedAt} />}
          footer={
            <>
              <button
                type="button"
                onClick={() => void deleteRow(selectedRow.id)}
                className="rounded-lg border border-[#E2B4B4] bg-white px-3 py-2 text-xs font-semibold text-[#A32C2C] transition hover:border-[#A32C2C] hover:bg-[#FBE9E9] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A32C2C]"
              >
                Supprimer la tâche
              </button>
              <PrimaryButton onClick={() => setSelectedId('')}>Fermer</PrimaryButton>
            </>
          }
        >
          <TaskForm
            value={{
              description_action: selectedRow.description_action || '',
              category_id: selectedRow.category_id,
              team_id: selectedRow.team_id,
              assigned_to: resolveAssignee(selectedRow.assigned_to)?.email || null,
              concerned_person: selectedRow.concerned_person || '',
              numero_tiers: selectedRow.numero_tiers || '',
              due_date: selectedRow.due_date,
              status: selectedRow.status,
              comment_progress: selectedRow.comment_progress || '',
            }}
            legacyMission={!selectedRow.category_id ? selectedRow.mission_project : null}
            onChange={(patch) => {
              if ('category_id' in patch) {
                // La catégorie entraîne aussi le texte « mission_project » (écrans qui l'affichent encore).
                patchCategory(selectedRow.id, patch.category_id ?? null)
                return
              }
              queueSave(selectedRow.id, toRowPatch(patch))
            }}
            categories={categories}
            teams={teams}
            teamMembers={teamMembers}
            assignees={assignees}
            assigneeByEmail={assigneeByEmail}
            isAdmin={isAdmin}
            myTeamIds={myTeamIds}
          />
        </FullScreenPanel>
      )}

      {/* ------------------------------------------------ Fiche plein écran : création */}
      {draft && (
        <FullScreenPanel
          eyebrow="Nouvelle tâche"
          title={draft.description_action.trim() || 'Décrivez la tâche'}
          subtitle={`Créée par ${currentDisplayName}`}
          onClose={() => setDraft(null)}
          footer={
            <>
              <GhostButton onClick={() => setDraft(null)}>Annuler</GhostButton>
              <PrimaryButton onClick={() => void createFromDraft()} disabled={creating || !draft.description_action.trim()}>
                {creating ? 'Création…' : 'Créer la tâche'}
              </PrimaryButton>
            </>
          }
        >
          <TaskForm
            value={draft}
            autoFocus
            onChange={(patch) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
            onSubmit={() => void createFromDraft()}
            categories={categories}
            teams={teams}
            teamMembers={teamMembers}
            assignees={assignees}
            assigneeByEmail={assigneeByEmail}
            isAdmin={isAdmin}
            myTeamIds={myTeamIds}
          />
        </FullScreenPanel>
      )}

      {/* ------------------------------------------------ Paramétrage (administrateurs) */}
      {settingsOpen && isAdmin && (
        <SettingsPanel
          categories={categories}
          teams={teams}
          teamMembers={teamMembers}
          assignees={assignees}
          currentEmail={currentEmail}
          onClose={() => setSettingsOpen(false)}
          onChanged={async () => {
            await loadReferentials()
          }}
          notify={(tone, text) => setToast({ tone, text })}
        />
      )}

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

/** Convertit un patch de formulaire (chaînes) en patch de ligne (null pour les champs vides). */
function toRowPatch(patch: Partial<Draft>): Partial<TodoRow> {
  const out: Partial<TodoRow> = {}
  if ('description_action' in patch) out.description_action = patch.description_action ?? ''
  if ('team_id' in patch) out.team_id = patch.team_id ?? null
  if ('assigned_to' in patch) out.assigned_to = patch.assigned_to || null
  if ('concerned_person' in patch) out.concerned_person = String(patch.concerned_person || '').trim() || null
  if ('numero_tiers' in patch) out.numero_tiers = String(patch.numero_tiers || '').trim() || null
  if ('due_date' in patch) out.due_date = patch.due_date || null
  if ('status' in patch && patch.status) out.status = patch.status
  if ('comment_progress' in patch) out.comment_progress = patch.comment_progress ?? ''
  return out
}

/* ------------------------------------------------------------------ */
/* Vue Tableur                                                          */
/* ------------------------------------------------------------------ */

function TableView({
  rows,
  sort,
  onSort,
  categoryById,
  teamById,
  resolveAssignee,
  savingId,
  onOpen,
  onToggleDone,
}: {
  rows: TodoRow[]
  sort: { key: TableSortKey; dir: 'asc' | 'desc' }
  onSort: (key: TableSortKey) => void
  categoryById: Map<string, Category>
  teamById: Map<string, Team>
  resolveAssignee: (value: string | null | undefined) => Assignee | null
  savingId: string | null
  onOpen: (id: string) => void
  onToggleDone: (row: TodoRow) => void
}) {
  const columns: Array<{ key: TableSortKey; label: string; className?: string }> = [
    { key: 'description', label: 'Tâche', className: 'min-w-[320px]' },
    { key: 'category', label: 'Catégorie', className: 'w-[170px]' },
    { key: 'team', label: 'Projet / équipe', className: 'w-[170px]' },
    { key: 'assigned', label: 'Confiée à', className: 'w-[160px]' },
    { key: 'concerned', label: 'Personne concernée', className: 'w-[170px]' },
    { key: 'client', label: 'Client', className: 'w-[110px]' },
    { key: 'status', label: 'Statut', className: 'w-[120px]' },
    { key: 'due', label: 'Échéance', className: 'w-[150px]' },
  ]

  return (
    <div className="overflow-hidden rounded-2xl border border-[#E2DFD8] bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#E2DFD8] bg-[#FAF9F7] text-left text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
              <th className="w-[44px] px-3 py-2.5" />
              {columns.map((column) => {
                const active = sort.key === column.key
                return (
                  <th key={column.key} className={`px-3 py-2.5 ${column.className || ''}`}>
                    <button
                      type="button"
                      onClick={() => onSort(column.key)}
                      className={`inline-flex items-center gap-1 transition hover:text-slate-900 ${active ? 'text-slate-900' : ''}`}
                    >
                      {column.label}
                      <span className={`text-[10px] ${active ? 'opacity-100' : 'opacity-0'}`}>{sort.dir === 'asc' ? '▲' : '▼'}</span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const category = categoryById.get(row.category_id || '')
              const team = teamById.get(row.team_id || '')
              const assignee = resolveAssignee(row.assigned_to)
              const done = row.status === 'Terminé'
              const cancelled = row.status === 'Annulé'
              const overdue = isOverdue(row)
              const soon = isDueSoon(row)

              return (
                <tr
                  key={row.id}
                  onClick={() => onOpen(row.id)}
                  className="cursor-pointer border-b border-[#EFEDE8] transition last:border-0 hover:bg-[#FAF9F7]"
                >
                  <td className="px-3 py-2 align-middle" onClick={(event) => event.stopPropagation()}>
                    <DoneToggle done={done} onClick={() => onToggleDone(row)} />
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className={`font-semibold ${done || cancelled ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                      {String(row.description_action || '').trim() || 'Tâche sans description'}
                    </div>
                    {row.comment_progress && (
                      <div className="mt-0.5 line-clamp-1 text-xs text-slate-500">{row.comment_progress}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    {category ? (
                      <Chip color={category.color}>{category.name}</Chip>
                    ) : row.mission_project ? (
                      <Chip color="#8A8375">{row.mission_project}</Chip>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    {team ? <Chip color={team.color}>{team.name}</Chip> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <PersonBadge name={assignee?.name || 'Non assignée'} muted={!assignee} />
                  </td>
                  <td className="px-3 py-2 align-middle">
                    {row.concerned_person ? (
                      <PersonBadge name={row.concerned_person} />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    {row.numero_tiers ? (
                      <span className="rounded-md bg-[#E6EEF3] px-2 py-0.5 text-xs font-semibold text-[#2C6F88]">{row.numero_tiers}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${getStatusClasses(row.status)}`}>{row.status}</span>
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <DueBadge dueDate={row.due_date} overdue={overdue} soon={soon} done={done || cancelled} />
                    {savingId === row.id && <span className="ml-2 text-[10px] font-semibold text-[#8A5A11]">Enreg.</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Vue Planning                                                         */
/* ------------------------------------------------------------------ */

function PlanningView({
  groups,
  teamById,
  resolveAssignee,
  savingId,
  onOpen,
  onToggleDone,
}: {
  groups: Array<{ key: string; label: string; color: string; rows: TodoRow[] }>
  teamById: Map<string, Team>
  resolveAssignee: (value: string | null | undefined) => Assignee | null
  savingId: string | null
  onOpen: (id: string) => void
  onToggleDone: (row: TodoRow) => void
}) {
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.key}>
          <div className="mb-2 flex items-center gap-2">
            <span className="h-4 w-1.5 rounded-full" style={{ backgroundColor: safeColor(group.color) }} />
            <h2 className="text-[12px] font-bold uppercase tracking-[0.16em]" style={{ color: safeColor(group.color) }}>
              {group.label}
            </h2>
            <span className="text-[11px] font-semibold tabular-nums text-slate-400">{group.rows.length}</span>
          </div>

          <ul className="overflow-hidden rounded-2xl border border-[#E2DFD8] bg-white">
            {group.rows.map((row) => {
              const assignee = resolveAssignee(row.assigned_to)
              const team = teamById.get(row.team_id || '')
              const done = row.status === 'Terminé'
              const cancelled = row.status === 'Annulé'
              const overdue = isOverdue(row)
              const soon = isDueSoon(row)

              return (
                <li key={row.id} className="border-b border-[#EFEDE8] last:border-0">
                  <div className="group flex items-center gap-3 px-3 py-2 transition hover:bg-[#FAF9F7]">
                    <DoneToggle done={done} onClick={() => onToggleDone(row)} />

                    <button
                      type="button"
                      onClick={() => onOpen(row.id)}
                      className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] md:grid-cols-[minmax(0,1fr)_170px_150px_150px_150px]"
                    >
                      <span className={`min-w-0 truncate text-sm font-semibold ${done || cancelled ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                        {String(row.description_action || '').trim() || 'Tâche sans description'}
                      </span>

                      <span className="hidden min-w-0 md:block">
                        {team ? <Chip color={team.color}>{team.name}</Chip> : <span className="text-xs text-slate-300">—</span>}
                      </span>

                      <span className="hidden min-w-0 md:block">
                        <PersonBadge name={assignee?.name || 'Non assignée'} muted={!assignee} />
                      </span>

                      <span className="hidden min-w-0 md:block">
                        {row.concerned_person ? (
                          <PersonBadge name={row.concerned_person} />
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </span>

                      <span className="flex items-center justify-end gap-2">
                        <span className={`hidden rounded-full px-2 py-0.5 text-[10px] font-bold lg:inline-flex ${getStatusClasses(row.status)}`}>{row.status}</span>
                        <DueBadge dueDate={row.due_date} overdue={overdue} soon={soon} done={done || cancelled} />
                      </span>
                    </button>

                    {savingId === row.id && <span className="shrink-0 text-[10px] font-semibold text-[#8A5A11]">Enreg.</span>}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Vue Colonnes (façon Trello)                                          */
/* ------------------------------------------------------------------ */

function ColumnsView({
  columns,
  columnGroup,
  categoryById,
  teamById,
  resolveAssignee,
  onOpen,
  dragId,
  dragOverKey,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  columns: Array<{ key: string; label: string; color: string; rows: TodoRow[] }>
  columnGroup: ColumnGroupKey
  categoryById: Map<string, Category>
  teamById: Map<string, Team>
  resolveAssignee: (value: string | null | undefined) => Assignee | null
  onOpen: (id: string) => void
  dragId: string | null
  dragOverKey: string | null
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragOver: (key: string | null) => void
  onDrop: (key: string) => void
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-6 md:px-6">
      <div className="flex min-h-[60vh] items-start gap-3">
        {columns.map((column) => {
          const color = safeColor(column.color)
          const isOver = dragOverKey === column.key && dragId !== null
          return (
            <section
              key={column.key}
              onDragOver={(event) => {
                event.preventDefault()
                if (dragOverKey !== column.key) onDragOver(column.key)
              }}
              onDragLeave={() => {
                if (dragOverKey === column.key) onDragOver(null)
              }}
              onDrop={(event) => {
                event.preventDefault()
                onDrop(column.key)
              }}
              className={`flex w-[300px] shrink-0 flex-col rounded-2xl border transition ${
                isOver ? 'border-[#B4761A] ring-2 ring-[#B4761A]/30' : 'border-[#E2DFD8]'
              }`}
              style={{ backgroundColor: `${color}14` }}
            >
              <header className="flex items-center gap-2 px-3 pb-2 pt-3">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">{column.label}</h2>
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-600">
                  {column.rows.length}
                </span>
              </header>

              <div className="flex flex-col gap-2 px-2 pb-3">
                {column.rows.length === 0 && (
                  <div className="rounded-xl border border-dashed border-[#D8D3C8] px-3 py-6 text-center text-xs text-slate-400">
                    Aucune tâche — déposez une carte ici
                  </div>
                )}
                {column.rows.map((row) => {
                  const category = categoryById.get(row.category_id || '')
                  const team = teamById.get(row.team_id || '')
                  const assignee = resolveAssignee(row.assigned_to)
                  const done = row.status === 'Terminé'
                  const cancelled = row.status === 'Annulé'
                  const overdue = isOverdue(row)
                  const soon = isDueSoon(row)
                  const dragging = dragId === row.id

                  return (
                    <article
                      key={row.id}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', row.id)
                        onDragStart(row.id)
                      }}
                      onDragEnd={onDragEnd}
                      onClick={() => onOpen(row.id)}
                      className={`cursor-pointer rounded-xl border border-[#E2DFD8] bg-white p-3 shadow-sm transition hover:border-[#B4761A] hover:shadow ${
                        dragging ? 'opacity-40' : ''
                      }`}
                    >
                      <div className="flex flex-wrap gap-1">
                        {columnGroup !== 'category' && category && <Chip color={category.color} small>{category.name}</Chip>}
                        {columnGroup !== 'team' && team && <Chip color={team.color} small>{team.name}</Chip>}
                        {columnGroup !== 'concerned' && row.concerned_person && (
                          <Chip color="#5B6B9A" small>{row.concerned_person}</Chip>
                        )}
                      </div>

                      <p className={`mt-1.5 text-sm font-semibold leading-snug ${done || cancelled ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                        {String(row.description_action || '').trim() || 'Tâche sans description'}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <DueBadge dueDate={row.due_date} overdue={overdue} soon={soon} done={done || cancelled} compact />
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${getStatusClasses(row.status)}`}>{row.status}</span>
                        {row.numero_tiers && (
                          <span className="rounded-md bg-[#E6EEF3] px-1.5 py-0.5 text-[10px] font-semibold text-[#2C6F88]">{row.numero_tiers}</span>
                        )}
                        {row.comment_progress && (
                          <span className="text-[10px] text-slate-400" title={row.comment_progress}>
                            ☰ commentaire
                          </span>
                        )}
                        <span className="ml-auto" title={`Confiée à ${assignee?.name || 'personne'}`}>
                          <Avatar name={assignee?.name || '?'} />
                        </span>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Formulaire de tâche (création et modification)                       */
/* ------------------------------------------------------------------ */

function TaskForm({
  value,
  onChange,
  onSubmit,
  autoFocus = false,
  legacyMission = null,
  categories,
  teams,
  teamMembers,
  assignees,
  assigneeByEmail,
  isAdmin,
  myTeamIds,
}: {
  value: Draft
  onChange: (patch: Partial<Draft>) => void
  onSubmit?: () => void
  autoFocus?: boolean
  /** Ancien texte « mission / projet » d'une tâche sans catégorie rattachée. */
  legacyMission?: string | null
  categories: Category[]
  teams: Team[]
  teamMembers: TeamMember[]
  assignees: Assignee[]
  assigneeByEmail: Map<string, Assignee>
  isAdmin: boolean
  myTeamIds: Set<string>
}) {
  const activeCategories = categories.filter((c) => c.is_active || c.id === value.category_id)
  const activeTeams = teams.filter((t) => t.is_active || t.id === value.team_id)
  const selectedTeam = teams.find((t) => t.id === value.team_id) || null
  const selectedTeamMembers = selectedTeam ? teamMembers.filter((m) => m.team_id === selectedTeam.id) : []

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* Colonne principale */}
      <div className="space-y-6">
        <Field label="Description">
          <textarea
            value={value.description_action}
            autoFocus={autoFocus}
            onChange={(event) => onChange({ description_action: event.target.value })}
            onInput={(event) => autoResize(event.currentTarget)}
            onKeyDown={(event) => {
              if (onSubmit && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                onSubmit()
              }
            }}
            rows={4}
            placeholder="Ce qu’il y a à faire, en une phrase claire"
            className="w-full resize-none rounded-xl border border-[#D8D3C8] bg-white px-4 py-3 text-base leading-relaxed outline-none transition placeholder:text-slate-400 focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
          />
          {onSubmit && <p className="mt-1 text-[11px] text-slate-400">Ctrl + Entrée pour créer la tâche.</p>}
        </Field>

        <Field label="Commentaire et avancement">
          <textarea
            value={value.comment_progress}
            onChange={(event) => onChange({ comment_progress: event.target.value })}
            onInput={(event) => autoResize(event.currentTarget)}
            rows={6}
            placeholder="Où en est-on ? Points bloquants, prochaine étape…"
            className="w-full resize-none rounded-xl border border-[#D8D3C8] bg-white px-4 py-3 text-sm leading-relaxed outline-none transition placeholder:text-slate-400 focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
          />
        </Field>

        <Field label="Statut">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_OPTIONS.map((status) => {
              const active = value.status === status
              return (
                <button
                  type="button"
                  key={status}
                  onClick={() => onChange({ status })}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] ${
                    active ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#E2DFD8] bg-white text-slate-600 hover:border-[#B4761A]'
                  }`}
                >
                  <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${getStatusDotClass(status)}`} />
                  {status}
                </button>
              )
            })}
          </div>
        </Field>
      </div>

      {/* Colonne latérale : classement et personnes */}
      <div className="space-y-5 rounded-2xl border border-[#E2DFD8] bg-[#FAF9F7] p-5">
        <Field label="Catégorie">
          <div className="flex flex-wrap gap-1.5">
            <ChoiceChip active={!value.category_id} color="#8A8375" onClick={() => onChange({ category_id: null })}>
              Aucune
            </ChoiceChip>
            {activeCategories.map((cat) => (
              <ChoiceChip key={cat.id} active={value.category_id === cat.id} color={cat.color} onClick={() => onChange({ category_id: cat.id })}>
                {cat.name}
              </ChoiceChip>
            ))}
          </div>
          {legacyMission && !value.category_id && (
            <p className="mt-2 text-[11px] text-slate-500">
              Ancienne mission saisie : <span className="font-semibold">{legacyMission}</span> — choisissez une catégorie pour la classer.
            </p>
          )}
          {activeCategories.length === 0 && (
            <p className="mt-2 text-[11px] text-slate-500">
              Aucune catégorie n’est encore définie{isAdmin ? ' — créez-en dans Paramétrage.' : '. Demandez à un administrateur d’en créer.'}
            </p>
          )}
        </Field>

        <Field label="Projet / équipe">
          <SelectField
            value={value.team_id || ''}
            onChange={(v) => onChange({ team_id: v || null })}
            options={[
              { value: '', label: 'Aucun' },
              ...activeTeams.map((team) => ({
                value: team.id,
                label: myTeamIds.has(team.id) || isAdmin ? team.name : `${team.name} (vous n’en êtes pas membre)`,
              })),
            ]}
          />
          {selectedTeam && (
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Visible par{' '}
              {selectedTeamMembers.length === 0
                ? 'aucun membre pour l’instant (à définir dans Paramétrage).'
                : selectedTeamMembers
                    .map((m) => assigneeByEmail.get(m.email)?.name || fallbackNameFromEmail(m.email))
                    .sort((a, b) => a.localeCompare(b, 'fr'))
                    .join(', ') + '.'}
            </p>
          )}
        </Field>

        <div className="grid grid-cols-1 gap-4">
          <Field label="Confiée à" hint="La personne qui doit réaliser la tâche">
            <SelectField
              value={value.assigned_to || ''}
              onChange={(v) => onChange({ assigned_to: v || null })}
              options={[{ value: '', label: 'Non assignée' }, ...assignees.map((item) => ({ value: item.email, label: item.name }))]}
            />
          </Field>

          <Field label="Personne concernée" hint="De qui parle la tâche (collègue, contact, client…) — pas forcément celle qui la réalise">
            <input
              value={value.concerned_person}
              onChange={(event) => onChange({ concerned_person: event.target.value })}
              list="todo-concerned-persons"
              placeholder="Ex. Kevin, Yoann (Angoulême)…"
              className="h-[42px] w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
            />
            <datalist id="todo-concerned-persons">
              {assignees.map((item) => (
                <option key={item.email} value={item.name} />
              ))}
            </datalist>
          </Field>

          <Field label="Client (n° tiers)">
            <input
              value={value.numero_tiers}
              onChange={(event) => onChange({ numero_tiers: event.target.value })}
              placeholder="Ex. DB0079"
              className="h-[42px] w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
            />
          </Field>

          <Field label="À faire pour le">
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={value.due_date || ''}
                onChange={(event) => onChange({ due_date: event.target.value || null })}
                className="h-[42px] w-full min-w-0 rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm outline-none transition focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
              />
              {value.due_date && (
                <button
                  type="button"
                  onClick={() => onChange({ due_date: null })}
                  className="shrink-0 rounded-lg border border-[#D8D3C8] px-2 py-2 text-xs text-slate-500 transition hover:border-[#A32C2C] hover:text-[#A32C2C]"
                  title="Retirer l’échéance"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <DueShortcut label="Aujourd’hui" onClick={() => onChange({ due_date: todayIso() })} />
              <DueShortcut label="Demain" onClick={() => onChange({ due_date: addDaysIso(todayIso(), 1) })} />
              <DueShortcut label="+1 semaine" onClick={() => onChange({ due_date: addDaysIso(todayIso(), 7) })} />
              <DueShortcut label="+1 mois" onClick={() => onChange({ due_date: addDaysIso(todayIso(), 30) })} />
            </div>
          </Field>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Paramétrage : catégories et projets / équipes (administrateurs)      */
/* ------------------------------------------------------------------ */

function SettingsPanel({
  categories,
  teams,
  teamMembers,
  assignees,
  currentEmail,
  onClose,
  onChanged,
  notify,
}: {
  categories: Category[]
  teams: Team[]
  teamMembers: TeamMember[]
  assignees: Assignee[]
  currentEmail: string
  onClose: () => void
  onChanged: () => Promise<void>
  notify: (tone: 'success' | 'error', text: string) => void
}) {
  const [tab, setTab] = useState<'categories' | 'teams'>('categories')
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLOR_SWATCHES[0])
  const [busy, setBusy] = useState(false)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const table = tab === 'categories' ? 'todo_categories' : 'todo_teams'
  const items: Array<Category | Team> = tab === 'categories' ? categories : teams

  async function create() {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    const maxSort = items.reduce((max, item) => Math.max(max, item.sort_order || 0), 0)
    const { error } = await supabase
      .from(table)
      .insert({ name, color: safeColor(newColor), sort_order: maxSort + 10, created_by_email: currentEmail })
    setBusy(false)
    if (error) {
      console.error(error)
      notify('error', /duplicate|unique/i.test(error.message) ? 'Ce nom existe déjà.' : 'La création a échoué.')
      return
    }
    setNewName('')
    setNewColor(COLOR_SWATCHES[(items.length + 1) % COLOR_SWATCHES.length])
    await onChanged()
  }

  function queueUpdate(id: string, patch: Partial<Category>) {
    const key = `${table}:${id}`
    if (timers.current[key]) clearTimeout(timers.current[key])
    timers.current[key] = setTimeout(() => void update(id, patch), 350)
  }

  async function update(id: string, patch: Partial<Category>) {
    const { error } = await supabase.from(table).update(patch).eq('id', id)
    if (error) {
      console.error(error)
      notify('error', /duplicate|unique/i.test(error.message) ? 'Ce nom existe déjà.' : 'La modification a échoué.')
    }
    await onChanged()
  }

  async function remove(item: Category | Team) {
    const label = tab === 'categories' ? 'cette catégorie' : 'ce projet / cette équipe'
    const ok = window.confirm(
      `Supprimer ${label} « ${item.name} » ? Les tâches rattachées sont conservées mais ne seront plus classées.`
    )
    if (!ok) return
    const { error } = await supabase.from(table).delete().eq('id', item.id)
    if (error) {
      console.error(error)
      notify('error', 'La suppression a échoué.')
      return
    }
    await onChanged()
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const a = items[index]
    const b = items[target]
    const orderA = (index + 1) * 10
    const orderB = (target + 1) * 10
    await Promise.all([
      supabase.from(table).update({ sort_order: orderB }).eq('id', a.id),
      supabase.from(table).update({ sort_order: orderA }).eq('id', b.id),
    ])
    await onChanged()
  }

  async function toggleMember(teamId: string, email: string, present: boolean) {
    const { error } = present
      ? await supabase.from('todo_team_members').delete().eq('team_id', teamId).eq('email', email)
      : await supabase.from('todo_team_members').insert({ team_id: teamId, email })
    if (error) {
      console.error(error)
      notify('error', 'La liste des membres n’a pas pu être modifiée.')
      return
    }
    await onChanged()
  }

  return (
    <FullScreenPanel
      eyebrow="Paramétrage"
      title="Catégories, projets et équipes"
      subtitle="Réservé aux administrateurs. Les couleurs s’appliquent partout : tableur, planning et colonnes."
      onClose={onClose}
      footer={<PrimaryButton onClick={onClose}>Fermer</PrimaryButton>}
    >
      <div className="mx-auto max-w-4xl">
        <Segmented
          value={tab}
          onChange={(value) => {
            setTab(value as 'categories' | 'teams')
            setNewName('')
          }}
          options={[
            { value: 'categories', label: `Catégories (${categories.length})` },
            { value: 'teams', label: `Projets / équipes (${teams.length})` },
          ]}
        />

        <p className="mt-3 text-sm text-slate-600">
          {tab === 'categories'
            ? 'Une catégorie classe les tâches (ancien champ « Mission ou projet »). Elle sert de regroupement dans la vue Planning et de colonne dans la vue Colonnes.'
            : 'Un projet ou une équipe partage ses tâches : chaque membre autorisé voit toutes les tâches qui y sont rattachées, même s’il ne les a ni créées ni reçues.'}
        </p>

        {/* Création */}
        <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-[#E2DFD8] bg-white p-3 md:flex-row md:items-center">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void create()
              }
            }}
            placeholder={tab === 'categories' ? 'Nouvelle catégorie — nom puis Entrée' : 'Nouveau projet ou équipe — nom puis Entrée'}
            className="h-[42px] min-w-0 flex-1 rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
          />
          <ColorPicker value={newColor} onChange={setNewColor} />
          <PrimaryButton onClick={() => void create()} disabled={busy || !newName.trim()}>
            {busy ? 'Ajout…' : 'Ajouter'}
          </PrimaryButton>
        </div>

        {/* Liste */}
        <ul className="mt-4 space-y-2">
          {items.length === 0 && (
            <li className="rounded-2xl border border-dashed border-[#D8D3C8] bg-white px-6 py-10 text-center text-sm text-slate-500">
              Rien n’est encore défini. Ajoutez un premier élément ci-dessus.
            </li>
          )}
          {items.map((item, index) => {
            const members = tab === 'teams' ? teamMembers.filter((m) => m.team_id === item.id) : []
            const memberSet = new Set(members.map((m) => m.email))
            return (
              <li key={item.id} className={`rounded-2xl border border-[#E2DFD8] bg-white p-3 ${item.is_active ? '' : 'opacity-60'}`}>
                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                  <div className="flex items-center gap-1">
                    <IconButton title="Monter" onClick={() => void move(index, -1)} disabled={index === 0}>
                      ▲
                    </IconButton>
                    <IconButton title="Descendre" onClick={() => void move(index, 1)} disabled={index === items.length - 1}>
                      ▼
                    </IconButton>
                  </div>

                  <NameInput value={item.name} onCommit={(name) => queueUpdate(item.id, { name })} />

                  <ColorPicker value={item.color} onChange={(color) => queueUpdate(item.id, { color })} />

                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                    <input
                      type="checkbox"
                      checked={item.is_active}
                      onChange={(event) => void update(item.id, { is_active: event.target.checked })}
                      className="h-4 w-4 accent-[#B4761A]"
                    />
                    Actif
                  </label>

                  <button
                    type="button"
                    onClick={() => void remove(item)}
                    className="rounded-lg border border-[#E2B4B4] bg-white px-3 py-1.5 text-xs font-semibold text-[#A32C2C] transition hover:border-[#A32C2C] hover:bg-[#FBE9E9]"
                  >
                    Supprimer
                  </button>
                </div>

                {tab === 'teams' && (
                  <div className="mt-3 border-t border-[#EFEDE8] pt-3">
                    <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                      Personnes pouvant voir les tâches ({members.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {assignees.map((person) => {
                        const present = memberSet.has(person.email)
                        return (
                          <button
                            type="button"
                            key={person.email}
                            onClick={() => void toggleMember(item.id, person.email, present)}
                            className={`rounded-full border px-3 py-1 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] ${
                              present ? 'border-transparent text-white' : 'border-[#D8D3C8] bg-white text-slate-600 hover:border-[#B4761A]'
                            }`}
                            style={present ? { backgroundColor: safeColor(item.color) } : undefined}
                          >
                            {present ? '✓ ' : ''}
                            {person.name}
                          </button>
                        )
                      })}
                      {assignees.length === 0 && <span className="text-xs text-slate-400">Aucun utilisateur avec accès aux tâches.</span>}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </FullScreenPanel>
  )
}

/** Champ nom : enregistré à la validation (Entrée ou perte de focus). */
function NameInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])

  function commit() {
    const next = local.trim()
    if (!next) {
      setLocal(value)
      return
    }
    if (next !== value) onCommit(next)
  }

  return (
    <input
      value={local}
      onChange={(event) => setLocal(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
      className="h-[40px] min-w-0 flex-1 rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm font-semibold outline-none transition focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
    />
  )
}

function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const current = safeColor(value)
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex flex-wrap gap-1">
        {COLOR_SWATCHES.slice(0, 10).map((color) => (
          <button
            type="button"
            key={color}
            onClick={() => onChange(color)}
            title={color}
            className={`h-5 w-5 rounded-full transition ${current.toLowerCase() === color.toLowerCase() ? 'ring-2 ring-[#111820] ring-offset-1' : 'hover:scale-110'}`}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
      <input
        type="color"
        value={current}
        onChange={(event) => onChange(event.target.value)}
        title="Couleur libre"
        className="h-7 w-9 cursor-pointer rounded-md border border-[#D8D3C8] bg-white p-0.5"
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Panneau plein écran                                                  */
/* ------------------------------------------------------------------ */

function FullScreenPanel({
  eyebrow,
  title,
  subtitle,
  onClose,
  headerRight,
  footer,
  children,
}: {
  eyebrow: string
  title: string
  subtitle?: string
  onClose: () => void
  headerRight?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[9000] flex flex-col bg-[#F4F3F0]">
      <div className="border-b border-[#1E2833] bg-[#111820]">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-4 px-4 py-4 md:px-6">
          <button
            type="button"
            onClick={onClose}
            className="flex h-[40px] shrink-0 items-center gap-2 rounded-xl border border-[#2C3946] bg-[#161F29] px-3 text-sm font-semibold text-slate-200 transition hover:border-[#B4761A] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]"
            title="Retour (Échap)"
          >
            ← Retour
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#B4761A]">{eyebrow}</div>
            <h2 className="truncate text-lg font-bold leading-tight text-white md:text-xl">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-slate-400">{subtitle}</p>}
          </div>
          {headerRight && <div className="shrink-0 text-slate-200">{headerRight}</div>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6">{children}</div>
      </div>

      {footer && (
        <div className="border-t border-[#E2DFD8] bg-white">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-end gap-3 px-4 py-3 md:px-6">{footer}</div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Briques d'interface                                                  */
/* ------------------------------------------------------------------ */

function EmptyState({
  filtersActive,
  tab,
  onReset,
  onCreate,
}: {
  filtersActive: boolean
  tab: TabKey
  onReset: () => void
  onCreate: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#D8D3C8] bg-white px-8 py-20 text-center">
      <h3 className="text-lg font-bold text-slate-900">
        {filtersActive ? 'Aucune tâche ne correspond' : tab === 'active' ? 'Rien en cours' : 'Aucune tâche clôturée'}
      </h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-600">
        {filtersActive
          ? 'Élargissez la recherche ou effacez les filtres pour retrouver vos tâches.'
          : tab === 'active'
            ? 'Créez une première tâche avec le bouton « Nouvelle tâche ».'
            : 'Les tâches terminées ou annulées apparaîtront ici.'}
      </p>
      <div className="mt-5 flex gap-2">
        {filtersActive && <GhostButton onClick={onReset}>Effacer les filtres</GhostButton>}
        {!filtersActive && tab === 'active' && <PrimaryButton onClick={onCreate}>+ Nouvelle tâche</PrimaryButton>}
      </div>
    </div>
  )
}

function HeaderStat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'warn' }) {
  const alert = tone === 'warn' && value > 0
  return (
    <div className={`min-w-[104px] rounded-xl border px-4 py-2 ${alert ? 'border-[#B4761A] bg-[#1B1710]' : 'border-[#2C3946] bg-[#161F29]'}`}>
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
      className={`cursor-pointer rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25 ${
        className || 'h-[42px] w-full'
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-800">{label}</span>
      {hint && <span className="-mt-1 mb-1.5 block text-[11px] leading-snug text-slate-500">{hint}</span>}
      {children}
    </label>
  )
}

function Chip({ color, children, small = false }: { color: string; children: React.ReactNode; small?: boolean }) {
  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded-md font-semibold ${small ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'}`}
      style={chipStyle(color)}
    >
      {children}
    </span>
  )
}

function ChoiceChip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean
  color: string
  onClick: () => void
  children: React.ReactNode
}) {
  const c = safeColor(color)
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] ${
        active ? 'border-transparent text-white' : 'border-[#D8D3C8] bg-white text-slate-700 hover:border-[#B4761A]'
      }`}
      style={active ? { backgroundColor: c } : undefined}
    >
      {!active && <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: c }} />}
      {children}
    </button>
  )
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2F6B4F] text-[9px] font-bold text-white" title={name}>
      {initialsOf(name)}
    </span>
  )
}

function PersonBadge({ name, muted = false }: { name: string; muted?: boolean }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 text-xs ${muted ? 'text-slate-400' : 'text-slate-700'}`}>
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold ${muted ? 'bg-[#EDEAE3] text-slate-400' : 'bg-[#EDEAE3] text-slate-700'}`}>
        {initialsOf(name)}
      </span>
      <span className="truncate">{name}</span>
    </span>
  )
}

function DueBadge({
  dueDate,
  overdue,
  soon,
  done,
  compact = false,
}: {
  dueDate: string | null
  overdue: boolean
  soon: boolean
  done: boolean
  compact?: boolean
}) {
  if (!dueDate) return <span className={`text-slate-300 ${compact ? 'text-[10px]' : 'text-xs'}`}>—</span>
  const tone = done
    ? 'bg-[#F1EFEA] text-slate-500'
    : overdue
      ? 'bg-[#A32C2C] text-white'
      : soon
        ? 'bg-[#FDF2DE] text-[#8A5A11] ring-1 ring-[#EBD8AE]'
        : 'bg-[#F1EFEA] text-slate-700'
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md font-semibold tabular-nums ${tone} ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'}`}
      title={relativeDueLabel(dueDate)}
    >
      <span aria-hidden="true">🕓</span>
      {compact ? formatDateShortFr(dueDate) : overdue && !done ? relativeDueLabel(dueDate) : formatDateFr(dueDate)}
    </span>
  )
}

function DoneToggle({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      aria-pressed={done}
      title={done ? 'Rouvrir la tâche' : 'Marquer comme terminée'}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] ${
        done ? 'border-[#2F6B4F] bg-[#2F6B4F] text-white' : 'border-[#CBC5B8] bg-white text-transparent hover:border-[#B4761A] hover:text-[#B4761A]'
      }`}
    >
      ✓
    </button>
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
      <span className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[#E0A961]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#B4761A]" />
        Enregistrement…
      </span>
    )
  }

  if (recent) {
    return (
      <span className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[#8FD1AE]">
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

function IconButton({
  title,
  onClick,
  disabled = false,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E2DFD8] bg-white text-[10px] text-slate-600 transition hover:border-[#B4761A] disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  )
}
