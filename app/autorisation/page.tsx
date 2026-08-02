 'use client'

import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { supabase } from '@/lib/supabaseClient'

type PermissionKey =
  | 'can_dashboard'
  | 'can_territoire'
  | 'can_cartographie'
  | 'can_clients'
  | 'can_carte'
  | 'can_todo'
  | 'can_clients_cegeclim'
  | 'can_suivi_prospects'
  | 'can_agences'
  | 'can_autorisation'
  | 'can_documents'
  | 'can_stocks'
  | 'can_activites'
  | 'can_change_scope'

type AlertKey =
  | 'show_alert_cerfa_ko'
  | 'show_alert_cdc_liv_avant_2026'
  | 'show_alert_controle_frais_port'
  | 'show_alert_capacite_gaz'
  | 'show_alert_todo'

type AccessProfile = Record<PermissionKey | AlertKey, boolean> & {
  id: string
  code: string
  name: string
  description: string
  is_active: boolean
  default_landing_page: string
  user_count: number
}

type UserAccess = {
  email: string
  display_name: string
  access_profile_id: string
  allowed_scopes: string[]
  allowed_agences: string[]
  allowed_collaborateurs: string[]
  allowed_departements: string[]
  allowed_codes_postaux: string[]
}

type TabKey = 'profiles' | 'users' | 'matrix'

type ToastState = { tone: 'success' | 'error'; text: string } | null

const ALL_DEPARTEMENTS = [
  '01', '02', '03', '04', '05', '06', '07', '08', '09',
  '10', '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '23', '24', '25', '26', '27', '28', '29',
  '30', '31', '32', '33', '34', '35', '36', '37', '38', '39',
  '40', '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '50', '51', '52', '53', '54', '55', '56', '57', '58', '59',
  '60', '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '70', '71', '72', '73', '74', '75', '76', '77', '78', '79',
  '80', '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '90', '91', '92', '93', '94', '95',
  '971', '972', '973', '974', '975', '976', '977', '978',
]

// Les écrans sont regroupés par famille métier : c'est ainsi qu'on raisonne
// quand on ouvre un accès ("il lui faut le commercial, pas l'administration").
const PERMISSION_GROUPS: Array<{
  family: string
  hint: string
  items: Array<{ key: PermissionKey; label: string; description: string }>
}> = [
  {
    family: 'Commercial',
    hint: 'Prospection, clients et territoire',
    items: [
      { key: 'can_carte', label: 'Prospects / Clients', description: 'Carte commerciale et fiches prospects.' },
      { key: 'can_clients', label: 'Clients', description: 'Liste et gestion de la base clients.' },
      { key: 'can_clients_cegeclim', label: 'Clients Cegeclim', description: 'Vue dédiée aux clients Cegeclim.' },
      { key: 'can_suivi_prospects', label: 'Suivi prospects', description: 'Avancement et relances commerciales.' },
      { key: 'can_territoire', label: 'Territoire', description: 'Écran Région / Département.' },
      { key: 'can_cartographie', label: 'Cartographie', description: 'Écran de cartographie.' },
      { key: 'can_agences', label: 'Agences', description: 'Fiches et paramétrage des agences.' },
    ],
  },
  {
    family: 'Pilotage',
    hint: 'Chiffres, stocks et activité',
    items: [
      { key: 'can_dashboard', label: 'Tableaux de bord', description: 'Indicateurs, portefeuille, SMC, Focus mois, appros.' },
      { key: 'can_stocks', label: 'Stocks', description: 'Projection et disponibilité des stocks.' },
      { key: 'can_activites', label: 'Activités', description: 'Écrans de suivi d’activité.' },
      { key: 'can_todo', label: 'Todo List', description: 'Liste des actions à traiter.' },
      { key: 'can_documents', label: 'Documents', description: 'Bibliothèque documentaire.' },
    ],
  },
  {
    family: 'Administration',
    hint: 'À réserver aux administrateurs',
    items: [
      { key: 'can_autorisation', label: 'Administration', description: 'Accès, imports, jobs, analyse devis et atelier.' },
      { key: 'can_change_scope', label: 'Changer de société', description: 'Autorise le changement de scope dans le bandeau.' },
    ],
  },
]

const PERMISSIONS = PERMISSION_GROUPS.flatMap((group) => group.items)

const ALERTS: Array<{ key: AlertKey; label: string; description: string }> = [
  { key: 'show_alert_cerfa_ko', label: 'CERFA KO', description: 'CERFA à régulariser.' },
  { key: 'show_alert_cdc_liv_avant_2026', label: 'CDC liv. avant 2026', description: 'Commandes clients à livrer avant 2026.' },
  { key: 'show_alert_controle_frais_port', label: 'Contrôle frais de port', description: 'Anomalies de facturation sur les BL.' },
  { key: 'show_alert_capacite_gaz', label: 'Capacité gaz', description: 'Certifications échues ou proches de l’échéance.' },
  { key: 'show_alert_todo', label: 'À faire', description: 'Actions ouvertes et en retard.' },
]

const LANDING_PAGES = [
  { value: '/accueil', label: 'Accueil' },
  { value: '/carte', label: 'Prospects / Clients' },
  { value: '/territoire', label: 'Territoire' },
  { value: '/agences', label: 'Agences' },
  { value: '/cartographie', label: 'Cartographie' },
  { value: '/approvisionnements', label: 'Flux Devis-CDC-BC-Fact' },
  { value: '/portefeuille-livraison', label: 'Portefeuille commande' },
  { value: '/synthese_multi_clients', label: 'Suivi Multi Clients' },
  { value: '/atelier-analyse', label: 'Tableaux de bord' },
  { value: '/focus_mensuel', label: 'Focus mois' },
  { value: '/stocks-disponibilites', label: 'Projection stock' },
  { value: '/Indicateurs', label: 'Indicateurs' },
  { value: '/todo', label: 'Todo List' },
  { value: '/documents', label: 'Documents' },
  { value: '/autorisation', label: 'Autorisations' },
  { value: '/admin/planification', label: 'Job scheduling' },
  { value: '/clients', label: 'MAJ base clients' },
  { value: '/Import', label: 'MAJ données activité' },
]

const EMPTY_PROFILE: AccessProfile = {
  id: '',
  code: '',
  name: '',
  description: '',
  is_active: true,
  default_landing_page: '/accueil',
  user_count: 0,
  can_dashboard: false,
  can_territoire: false,
  can_cartographie: false,
  can_clients: false,
  can_carte: false,
  can_todo: false,
  can_clients_cegeclim: false,
  can_suivi_prospects: false,
  can_agences: false,
  can_autorisation: false,
  can_documents: false,
  can_stocks: false,
  can_activites: false,
  can_change_scope: false,
  show_alert_cerfa_ko: false,
  show_alert_cdc_liv_avant_2026: false,
  show_alert_controle_frais_port: false,
  show_alert_capacite_gaz: false,
  show_alert_todo: false,
}

const EMPTY_USER: UserAccess = {
  email: '',
  display_name: '',
  access_profile_id: '',
  allowed_scopes: ['Global'],
  allowed_agences: [],
  allowed_collaborateurs: [],
  allowed_departements: [],
  allowed_codes_postaux: [],
}

function normalizeList(value: unknown, fallback: string[] = []) {
  if (Array.isArray(value)) {
    const values = value.map((item) => String(item || '').trim()).filter(Boolean)
    return values.length ? Array.from(new Set(values)) : fallback
  }
  const text = String(value || '').trim()
  if (!text) return fallback
  return Array.from(new Set(text.split(/[;,|\n]/).map((item) => item.trim()).filter(Boolean)))
}

function textToList(value: string, fallback: string[] = []) {
  const result = value.split(/[;,|\n]/).map((item) => item.trim()).filter(Boolean)
  return result.length ? Array.from(new Set(result)) : fallback
}

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function dispatchAccessChanged() {
  window.dispatchEvent(new CustomEvent('cegeclim:access-changed'))
}

function countGranted(profile: AccessProfile, keys: Array<PermissionKey | AlertKey>) {
  return keys.filter((key) => profile[key]).length
}

function profileSignature(profile: AccessProfile) {
  return JSON.stringify({
    code: profile.code,
    name: profile.name,
    description: profile.description,
    is_active: profile.is_active,
    default_landing_page: profile.default_landing_page,
    permissions: PERMISSIONS.map(({ key }) => profile[key]),
    alerts: ALERTS.map(({ key }) => profile[key]),
  })
}

function userSignature(user: UserAccess) {
  return JSON.stringify({
    display_name: user.display_name,
    access_profile_id: user.access_profile_id,
    allowed_scopes: [...user.allowed_scopes].sort(),
    allowed_agences: [...user.allowed_agences].sort(),
    allowed_collaborateurs: [...user.allowed_collaborateurs].sort(),
    allowed_departements: [...user.allowed_departements].sort(),
    allowed_codes_postaux: [...user.allowed_codes_postaux].sort(),
  })
}

function initialsOf(user: UserAccess) {
  const source = user.display_name.trim() || user.email
  const parts = source.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  const letters = parts.slice(0, 2).map((part) => part[0]).join('')
  return (letters || source.slice(0, 2)).toUpperCase()
}

function perimeterSummary(user: UserAccess) {
  const parts: string[] = []
  if (user.allowed_departements.length) parts.push(`${user.allowed_departements.length} dép.`)
  if (user.allowed_codes_postaux.length) parts.push(`${user.allowed_codes_postaux.length} CP`)
  if (user.allowed_agences.length) parts.push(`${user.allowed_agences.length} agence${user.allowed_agences.length > 1 ? 's' : ''}`)
  if (user.allowed_collaborateurs.length) parts.push(`${user.allowed_collaborateurs.length} collab.`)
  return parts.length ? parts.join(' · ') : 'Périmètre national'
}

export default function AutorisationPage() {
  const [profiles, setProfiles] = useState<AccessProfile[]>([])
  const [users, setUsers] = useState<UserAccess[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('profiles')

  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [profileDraft, setProfileDraft] = useState<AccessProfile>(EMPTY_PROFILE)
  const [creatingProfile, setCreatingProfile] = useState(false)
  const [newProfile, setNewProfile] = useState<AccessProfile>(EMPTY_PROFILE)

  const [selectedUserEmail, setSelectedUserEmail] = useState<string>('')
  const [userDraft, setUserDraft] = useState<UserAccess | null>(null)
  const [creatingUser, setCreatingUser] = useState(false)
  const [newUser, setNewUser] = useState<UserAccess>(EMPTY_USER)

  const [search, setSearch] = useState('')
  const [profileFilter, setProfileFilter] = useState('TOUS')
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 5200)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function loadData(options?: { profileId?: string; userEmail?: string }) {
    setLoading(true)

    const [{ data: profileData, error: profileError }, { data: userData, error: userError }] = await Promise.all([
      supabase.from('access_profiles').select('*').order('name', { ascending: true }),
      supabase
        .from('user_page_access')
        .select('email, display_name, access_profile_id, allowed_scopes, allowed_agences, allowed_collaborateurs, allowed_departements, allowed_codes_postaux')
        .order('email', { ascending: true }),
    ])

    if (profileError || userError) {
      setToast({ tone: 'error', text: `Chargement impossible : ${profileError?.message || userError?.message}` })
      setProfiles([])
      setUsers([])
      setLoading(false)
      return
    }

    const formattedUsers: UserAccess[] = ((userData || []) as any[]).map((row) => ({
      email: String(row.email || '').toLowerCase().trim(),
      display_name: String(row.display_name || '').trim(),
      access_profile_id: String(row.access_profile_id || '').trim(),
      allowed_scopes: normalizeList(row.allowed_scopes, ['Global']),
      allowed_agences: normalizeList(row.allowed_agences),
      allowed_collaborateurs: normalizeList(row.allowed_collaborateurs),
      allowed_departements: normalizeList(row.allowed_departements),
      allowed_codes_postaux: normalizeList(row.allowed_codes_postaux),
    }))

    const countByProfile = new Map<string, number>()
    formattedUsers.forEach((user) => {
      if (!user.access_profile_id) return
      countByProfile.set(user.access_profile_id, (countByProfile.get(user.access_profile_id) || 0) + 1)
    })

    const formattedProfiles: AccessProfile[] = ((profileData || []) as any[]).map((row) => ({
      ...EMPTY_PROFILE,
      id: String(row.id || ''),
      code: String(row.code || '').trim(),
      name: String(row.name || '').trim(),
      description: String(row.description || '').trim(),
      is_active: row.is_active !== false,
      default_landing_page: String(row.default_landing_page || '/accueil').trim() || '/accueil',
      user_count: countByProfile.get(String(row.id || '')) || 0,
      ...Object.fromEntries(PERMISSIONS.map(({ key }) => [key, !!row[key]])),
      ...Object.fromEntries(ALERTS.map(({ key }) => [key, !!row[key]])),
    })) as AccessProfile[]

    setProfiles(formattedProfiles)
    setUsers(formattedUsers)

    const nextProfileId = options?.profileId || selectedProfileId || formattedProfiles[0]?.id || ''
    const selectedProfile = formattedProfiles.find((profile) => profile.id === nextProfileId) || formattedProfiles[0]
    setSelectedProfileId(selectedProfile?.id || '')
    setProfileDraft(selectedProfile ? { ...selectedProfile } : EMPTY_PROFILE)

    const nextUserEmail = options?.userEmail || selectedUserEmail || ''
    const selectedUser = formattedUsers.find((user) => user.email === nextUserEmail) || null
    setSelectedUserEmail(selectedUser?.email || '')
    setUserDraft(selectedUser ? { ...selectedUser } : null)

    if (!newUser.access_profile_id && formattedProfiles.length) {
      setNewUser((current) => ({ ...current, access_profile_id: formattedProfiles[0].id }))
    }

    setLoading(false)
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const originalProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) || null,
    [profiles, selectedProfileId]
  )

  const originalUser = useMemo(
    () => users.find((user) => user.email === selectedUserEmail) || null,
    [users, selectedUserEmail]
  )

  const profileDirty = Boolean(
    originalProfile && profileDraft.id && profileSignature(originalProfile) !== profileSignature(profileDraft)
  )

  const userDirty = Boolean(originalUser && userDraft && userSignature(originalUser) !== userSignature(userDraft))

  const profileById = useMemo(() => {
    const map = new Map<string, AccessProfile>()
    profiles.forEach((profile) => map.set(profile.id, profile))
    return map
  }, [profiles])

  const usersOfSelectedProfile = useMemo(
    () => users.filter((user) => user.access_profile_id === selectedProfileId),
    [users, selectedProfileId]
  )

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase()
    return users.filter((user) => {
      if (profileFilter !== 'TOUS') {
        if (profileFilter === 'AUCUN' ? Boolean(user.access_profile_id) : user.access_profile_id !== profileFilter) {
          return false
        }
      }
      if (!term) return true
      const profileName = profileById.get(user.access_profile_id)?.name || ''
      return [user.email, user.display_name, profileName].some((value) => value.toLowerCase().includes(term))
    })
  }, [users, search, profileFilter, profileById])

  const usersWithoutProfile = users.filter((user) => !user.access_profile_id).length

  function selectProfile(id: string) {
    if (profileDirty && !window.confirm('Les modifications de ce profil ne sont pas enregistrées. Les abandonner ?')) return
    setSelectedProfileId(id)
    const target = profiles.find((profile) => profile.id === id)
    setProfileDraft(target ? { ...target } : EMPTY_PROFILE)
  }

  function selectUser(email: string) {
    if (userDirty && !window.confirm('Les modifications de cet utilisateur ne sont pas enregistrées. Les abandonner ?')) return
    setSelectedUserEmail(email)
    const target = users.find((user) => user.email === email)
    setUserDraft(target ? { ...target } : null)
    setCreatingUser(false)
  }

  function patchProfileDraft(patch: Partial<AccessProfile>) {
    setProfileDraft((current) => ({ ...current, ...patch }) as AccessProfile)
  }

  function patchUserDraft(patch: Partial<UserAccess>) {
    setUserDraft((current) => (current ? { ...current, ...patch } : current))
  }

  function setAllPermissions(value: boolean) {
    patchProfileDraft(Object.fromEntries(PERMISSIONS.map(({ key }) => [key, value])) as Partial<AccessProfile>)
  }

  function setGroupPermissions(family: string, value: boolean) {
    const group = PERMISSION_GROUPS.find((item) => item.family === family)
    if (!group) return
    patchProfileDraft(Object.fromEntries(group.items.map(({ key }) => [key, value])) as Partial<AccessProfile>)
  }

  function setAllAlerts(value: boolean) {
    patchProfileDraft(Object.fromEntries(ALERTS.map(({ key }) => [key, value])) as Partial<AccessProfile>)
  }

  async function saveProfile() {
    if (!profileDraft.id) return
    const name = profileDraft.name.trim()
    const code = slugify(profileDraft.code || name)

    if (!name || !code) {
      setToast({ tone: 'error', text: 'Donnez un nom au profil pour l’enregistrer.' })
      return
    }

    setSavingKey(`profile:${profileDraft.id}`)

    const payload: Record<string, unknown> = {
      code,
      name,
      description: profileDraft.description.trim(),
      is_active: profileDraft.is_active,
      default_landing_page: profileDraft.default_landing_page || '/accueil',
    }
    PERMISSIONS.forEach(({ key }) => { payload[key] = profileDraft[key] })
    ALERTS.forEach(({ key }) => { payload[key] = profileDraft[key] })

    const { error } = await supabase.from('access_profiles').update(payload).eq('id', profileDraft.id)
    setSavingKey(null)

    if (error) {
      setToast({ tone: 'error', text: `Le profil n’a pas été enregistré : ${error.message}` })
      return
    }

    setToast({
      tone: 'success',
      text: profileDraft.user_count
        ? `Profil « ${name} » enregistré pour ${profileDraft.user_count} utilisateur${profileDraft.user_count > 1 ? 's' : ''}.`
        : `Profil « ${name} » enregistré.`,
    })
    dispatchAccessChanged()
    await loadData({ profileId: profileDraft.id })
  }

  async function createProfile() {
    const name = newProfile.name.trim()
    const code = slugify(newProfile.code || name)
    if (!name || !code) {
      setToast({ tone: 'error', text: 'Donnez un nom au nouveau profil.' })
      return
    }

    setSavingKey('profile:new')

    const payload: Record<string, unknown> = {
      code,
      name,
      description: newProfile.description.trim(),
      is_active: newProfile.is_active,
      default_landing_page: newProfile.default_landing_page || '/accueil',
    }
    PERMISSIONS.forEach(({ key }) => { payload[key] = newProfile[key] })
    ALERTS.forEach(({ key }) => { payload[key] = newProfile[key] })

    const { data, error } = await supabase.from('access_profiles').insert(payload).select('id').single()
    setSavingKey(null)

    if (error) {
      setToast({ tone: 'error', text: `Le profil n’a pas été créé : ${error.message}` })
      return
    }

    setToast({ tone: 'success', text: `Profil « ${name} » créé. Cochez les écrans autorisés puis enregistrez.` })
    setNewProfile(EMPTY_PROFILE)
    setCreatingProfile(false)
    dispatchAccessChanged()
    await loadData({ profileId: String((data as any)?.id || '') })
  }

  async function saveUser(user: UserAccess) {
    const email = user.email.toLowerCase().trim()
    if (!email || !user.access_profile_id) {
      setToast({ tone: 'error', text: 'Un utilisateur doit avoir un email et un profil d’accès.' })
      return
    }

    setSavingKey(`user:${email}`)

    const { error } = await supabase
      .from('user_page_access')
      .update({
        display_name: user.display_name.trim(),
        access_profile_id: user.access_profile_id,
        allowed_scopes: user.allowed_scopes.length ? user.allowed_scopes : ['Global'],
        allowed_agences: user.allowed_agences,
        allowed_collaborateurs: user.allowed_collaborateurs,
        allowed_departements: user.allowed_departements,
        allowed_codes_postaux: user.allowed_codes_postaux,
      })
      .eq('email', email)

    setSavingKey(null)

    if (error) {
      setToast({ tone: 'error', text: `${email} n’a pas été enregistré : ${error.message}` })
      return
    }

    setToast({ tone: 'success', text: `${email} enregistré.` })
    dispatchAccessChanged()
    await loadData({ userEmail: email })
  }

  async function createUser() {
    const email = newUser.email.toLowerCase().trim()
    if (!email || !newUser.access_profile_id) {
      setToast({ tone: 'error', text: 'L’email et le profil d’accès sont obligatoires.' })
      return
    }

    setSavingKey('user:new')

    const { error } = await supabase.from('user_page_access').insert({
      email,
      display_name: newUser.display_name.trim(),
      access_profile_id: newUser.access_profile_id,
      allowed_scopes: newUser.allowed_scopes.length ? newUser.allowed_scopes : ['Global'],
      allowed_agences: newUser.allowed_agences,
      allowed_collaborateurs: newUser.allowed_collaborateurs,
      allowed_departements: newUser.allowed_departements,
      allowed_codes_postaux: newUser.allowed_codes_postaux,
    })

    setSavingKey(null)

    if (error) {
      setToast({ tone: 'error', text: `L’utilisateur n’a pas été créé : ${error.message}` })
      return
    }

    setToast({ tone: 'success', text: `${email} créé. Définissez son périmètre à droite.` })
    setNewUser({ ...EMPTY_USER, access_profile_id: profiles[0]?.id || '' })
    setCreatingUser(false)
    dispatchAccessChanged()
    await loadData({ userEmail: email })
  }

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      {/* Bandeau d'identité : encre + ambre, repris des tableaux de bord CEGECLIM. */}
      <header className="border-b border-[#1E2833] bg-[#111820]">
        <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-6 px-4 py-6 md:px-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#B4761A]">Administration</div>
            <h1 className="mt-2 text-[28px] font-bold leading-tight text-white md:text-[32px]">Accès et permissions</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
              Les écrans, la page d’accueil et les pastilles d’alerte se règlent une fois par profil.
              Les agences, collaborateurs, départements, codes postaux et scopes restent propres à chaque personne.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <HeaderStat label="Profils" value={profiles.length} />
            <HeaderStat label="Utilisateurs" value={users.length} />
            <HeaderStat
              label="Sans profil"
              value={usersWithoutProfile}
              tone={usersWithoutProfile > 0 ? 'warn' : 'default'}
            />
            <button
              type="button"
              onClick={() => void loadData()}
              className="h-[52px] rounded-xl border border-[#2C3946] px-4 text-sm font-semibold text-slate-200 transition hover:border-[#B4761A] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]"
            >
              Recharger
            </button>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-[1760px] gap-1 px-4 md:px-8">
          <TabButton active={activeTab === 'profiles'} onClick={() => setActiveTab('profiles')}>Profils</TabButton>
          <TabButton active={activeTab === 'users'} onClick={() => setActiveTab('users')}>Utilisateurs</TabButton>
          <TabButton active={activeTab === 'matrix'} onClick={() => setActiveTab('matrix')}>Vue d’ensemble</TabButton>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1760px] px-4 py-6 md:px-8">
        {loading ? (
          <div className="rounded-2xl border border-[#E2DFD8] bg-white p-16 text-center text-sm text-slate-500">
            Chargement des profils et des utilisateurs…
          </div>
        ) : activeTab === 'profiles' ? (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[330px_minmax(0,1fr)]">
            {/* ---------------------------------------------------------- Liste des profils */}
            <aside className="flex flex-col gap-3">
              <div className="rounded-2xl border border-[#E2DFD8] bg-white p-3">
                <div className="flex items-center justify-between px-1 pb-3">
                  <Eyebrow>{profiles.length} profil{profiles.length > 1 ? 's' : ''}</Eyebrow>
                  <button
                    type="button"
                    onClick={() => setCreatingProfile((value) => !value)}
                    className="rounded-lg border border-[#D8D3C8] px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[#B4761A] hover:text-[#8A5A11]"
                  >
                    {creatingProfile ? 'Annuler' : 'Nouveau profil'}
                  </button>
                </div>

                {creatingProfile && (
                  <div className="mb-3 space-y-2 rounded-xl border border-[#EBD8AE] bg-[#FDF7EA] p-3">
                    <TextField
                      value={newProfile.name}
                      onChange={(value) => setNewProfile((current) => ({ ...current, name: value, code: slugify(value) }))}
                      placeholder="Nom du profil"
                      autoFocus
                    />
                    <TextField
                      value={newProfile.code}
                      onChange={(value) => setNewProfile((current) => ({ ...current, code: slugify(value) }))}
                      placeholder="Code technique"
                      mono
                    />
                    <button
                      type="button"
                      onClick={() => void createProfile()}
                      disabled={savingKey === 'profile:new'}
                      className="w-full rounded-lg bg-[#111820] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#25313D] disabled:opacity-50"
                    >
                      {savingKey === 'profile:new' ? 'Création…' : 'Créer le profil'}
                    </button>
                    <p className="text-[11px] leading-4 text-[#8A5A11]">
                      Le profil est créé sans aucun droit. Vous cocherez les écrans juste après.
                    </p>
                  </div>
                )}

                <div className="space-y-1.5">
                  {profiles.map((profile) => {
                    const active = selectedProfileId === profile.id
                    const screens = countGranted(profile, PERMISSIONS.map((item) => item.key))
                    const alerts = countGranted(profile, ALERTS.map((item) => item.key))
                    return (
                      <button
                        type="button"
                        key={profile.id}
                        onClick={() => selectProfile(profile.id)}
                        className={`w-full rounded-xl border px-3 py-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] ${
                          active
                            ? 'border-[#111820] bg-[#111820] text-white'
                            : 'border-transparent bg-[#FAF9F7] hover:border-[#D8D3C8] hover:bg-white'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[15px] font-semibold">{profile.name || 'Sans nom'}</span>
                          <span
                            className={`shrink-0 text-xs font-bold tabular-nums ${active ? 'text-[#E0A961]' : 'text-slate-500'}`}
                          >
                            {profile.user_count}
                          </span>
                        </div>
                        <div className={`mt-1 flex items-center gap-2 text-[11px] ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                          <span className="font-mono">{profile.code}</span>
                          {!profile.is_active && (
                            <span className={active ? 'text-[#E0A961]' : 'text-[#A32C2C]'}>inactif</span>
                          )}
                        </div>
                        <div className={`mt-1.5 text-[11px] tabular-nums ${active ? 'text-slate-400' : 'text-slate-500'}`}>
                          {screens}/{PERMISSIONS.length} écrans · {alerts}/{ALERTS.length} alertes
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </aside>

            {/* ---------------------------------------------------------- Détail du profil */}
            {profileDraft.id ? (
              <section className="space-y-4">
                <div className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Field label="Nom du profil">
                      <TextField value={profileDraft.name} onChange={(value) => patchProfileDraft({ name: value })} />
                    </Field>
                    <Field label="Code technique" hint="Utilisé par le code, sans espace ni accent.">
                      <TextField value={profileDraft.code} onChange={(value) => patchProfileDraft({ code: slugify(value) })} mono />
                    </Field>
                    <Field label="Description" className="lg:col-span-2" hint="À qui ce profil est-il destiné ?">
                      <TextField
                        value={profileDraft.description}
                        onChange={(value) => patchProfileDraft({ description: value })}
                        placeholder="Commerciaux itinérants Pays de la Loire, lecture seule sur les stocks…"
                      />
                    </Field>
                    <Field label="Écran ouvert à la connexion">
                      <SelectField
                        value={profileDraft.default_landing_page}
                        onChange={(value) => patchProfileDraft({ default_landing_page: value })}
                        options={LANDING_PAGES}
                      />
                    </Field>
                    <Field label="Disponibilité">
                      <label className="flex h-[42px] cursor-pointer items-center gap-3 rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm">
                        <input
                          type="checkbox"
                          checked={profileDraft.is_active}
                          onChange={(event) => patchProfileDraft({ is_active: event.target.checked })}
                          className="h-4 w-4 accent-[#B4761A]"
                        />
                        <span className="font-medium text-slate-800">
                          {profileDraft.is_active ? 'Proposé à l’affectation' : 'Masqué à l’affectation'}
                        </span>
                      </label>
                    </Field>
                  </div>

                  <ImpactBanner users={usersOfSelectedProfile} />
                </div>

                <div className="rounded-2xl border border-[#E2DFD8] bg-white">
                  <SectionHeader
                    eyebrow="Périmètre applicatif"
                    title="Écrans autorisés"
                    description="Chaque modification s’applique immédiatement à toutes les personnes rattachées à ce profil."
                    actions={
                      <>
                        <GhostButton onClick={() => setAllPermissions(true)}>Tout ouvrir</GhostButton>
                        <GhostButton onClick={() => setAllPermissions(false)}>Tout fermer</GhostButton>
                      </>
                    }
                  />

                  <div className="divide-y divide-[#EFEDE8]">
                    {PERMISSION_GROUPS.map((group) => {
                      const granted = group.items.filter(({ key }) => profileDraft[key]).length
                      return (
                        <div key={group.family} className="px-5 py-4">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-baseline gap-3">
                              <h4 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-800">{group.family}</h4>
                              <span className="text-xs text-slate-500">{group.hint}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold tabular-nums text-slate-500">
                                {granted}/{group.items.length}
                              </span>
                              <GhostButton onClick={() => setGroupPermissions(group.family, granted !== group.items.length)}>
                                {granted === group.items.length ? 'Tout fermer' : 'Tout ouvrir'}
                              </GhostButton>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                            {group.items.map((permission) => (
                              <ToggleCard
                                key={permission.key}
                                label={permission.label}
                                description={permission.description}
                                checked={profileDraft[permission.key]}
                                onChange={(checked) => patchProfileDraft({ [permission.key]: checked } as Partial<AccessProfile>)}
                              />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="rounded-2xl border border-[#E2DFD8] bg-white">
                  <SectionHeader
                    eyebrow="Bandeau"
                    title="Pastilles d’alerte"
                    description="Une alerte fermée n’est ni affichée ni calculée : c’est aussi un gain de temps au chargement."
                    actions={
                      <>
                        <GhostButton onClick={() => setAllAlerts(true)}>Tout ouvrir</GhostButton>
                        <GhostButton onClick={() => setAllAlerts(false)}>Tout fermer</GhostButton>
                      </>
                    }
                  />
                  <div className="grid grid-cols-1 gap-2 px-5 pb-5 md:grid-cols-2 2xl:grid-cols-3">
                    {ALERTS.map((alert) => (
                      <ToggleCard
                        key={alert.key}
                        label={alert.label}
                        description={alert.description}
                        checked={profileDraft[alert.key]}
                        onChange={(checked) => patchProfileDraft({ [alert.key]: checked } as Partial<AccessProfile>)}
                      />
                    ))}
                  </div>
                </div>

                <SaveBar
                  dirty={profileDirty}
                  saving={savingKey === `profile:${profileDraft.id}`}
                  idleLabel="Aucune modification en attente."
                  dirtyLabel={
                    profileDraft.user_count
                      ? `Modifications en attente — elles toucheront ${profileDraft.user_count} utilisateur${profileDraft.user_count > 1 ? 's' : ''}.`
                      : 'Modifications en attente.'
                  }
                  onCancel={() => originalProfile && setProfileDraft({ ...originalProfile })}
                  onSave={() => void saveProfile()}
                  saveLabel="Enregistrer le profil"
                />
              </section>
            ) : (
              <EmptyState
                title="Aucun profil pour l’instant"
                body="Créez un premier profil — par exemple « Commercial terrain » — puis cochez les écrans dont il a besoin."
                action={<PrimaryButton onClick={() => setCreatingProfile(true)}>Créer un profil</PrimaryButton>}
              />
            )}
          </div>
        ) : activeTab === 'users' ? (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
            {/* ---------------------------------------------------------- Liste des personnes */}
            <aside className="flex flex-col gap-3">
              <div className="rounded-2xl border border-[#E2DFD8] bg-white p-3">
                <div className="space-y-2 px-1 pb-3">
                  <TextField value={search} onChange={setSearch} placeholder="Rechercher un email, un nom, un profil" />
                  <SelectField
                    value={profileFilter}
                    onChange={setProfileFilter}
                    options={[
                      { value: 'TOUS', label: `Tous les profils (${users.length})` },
                      ...profiles.map((profile) => ({ value: profile.id, label: `${profile.name} (${profile.user_count})` })),
                      { value: 'AUCUN', label: `Sans profil (${usersWithoutProfile})` },
                    ]}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingUser((value) => !value)
                      setSelectedUserEmail('')
                      setUserDraft(null)
                    }}
                    className="w-full rounded-lg border border-[#D8D3C8] px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-[#B4761A] hover:text-[#8A5A11]"
                  >
                    {creatingUser ? 'Annuler l’ajout' : 'Ajouter une personne'}
                  </button>
                </div>

                <div className="max-h-[calc(100vh-320px)] space-y-1.5 overflow-y-auto pr-0.5">
                  {filteredUsers.length === 0 ? (
                    <p className="px-2 py-8 text-center text-sm text-slate-500">
                      Aucune personne ne correspond à cette recherche.
                    </p>
                  ) : (
                    filteredUsers.map((user) => {
                      const active = selectedUserEmail === user.email
                      const profile = profileById.get(user.access_profile_id)
                      return (
                        <button
                          type="button"
                          key={user.email}
                          onClick={() => selectUser(user.email)}
                          className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] ${
                            active
                              ? 'border-[#111820] bg-[#111820] text-white'
                              : 'border-transparent bg-[#FAF9F7] hover:border-[#D8D3C8] hover:bg-white'
                          }`}
                        >
                          <span
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              active ? 'bg-[#B4761A] text-white' : 'bg-[#EDEAE3] text-slate-600'
                            }`}
                          >
                            {initialsOf(user)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {user.display_name || user.email}
                            </span>
                            <span className={`block truncate text-[11px] ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                              {profile ? profile.name : 'Sans profil — aucun accès'}
                            </span>
                            <span className={`block truncate text-[11px] ${active ? 'text-slate-400' : 'text-slate-400'}`}>
                              {perimeterSummary(user)}
                            </span>
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            </aside>

            {/* ---------------------------------------------------------- Détail personne */}
            {creatingUser ? (
              <section className="rounded-2xl border border-[#EBD8AE] bg-[#FDF7EA] p-5">
                <Eyebrow>Nouvelle personne</Eyebrow>
                <h2 className="mt-1 text-xl font-bold text-slate-900">Ouvrir un accès</h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-600">
                  L’email doit être celui utilisé pour se connecter. Le périmètre géographique se règle après la création.
                </p>

                <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field label="Email de connexion">
                    <TextField
                      value={newUser.email}
                      onChange={(value) => setNewUser((current) => ({ ...current, email: value.toLowerCase().trim() }))}
                      placeholder="prenom.nom@cegeclim.fr"
                      type="email"
                    />
                  </Field>
                  <Field label="Nom affiché">
                    <TextField
                      value={newUser.display_name}
                      onChange={(value) => setNewUser((current) => ({ ...current, display_name: value }))}
                      placeholder="Prénom Nom"
                    />
                  </Field>
                  <Field label="Profil d’accès" className="md:col-span-2" hint="Détermine les écrans visibles.">
                    <SelectField
                      value={newUser.access_profile_id}
                      onChange={(value) => setNewUser((current) => ({ ...current, access_profile_id: value }))}
                      options={[
                        { value: '', label: 'Choisir un profil' },
                        ...profiles.filter((profile) => profile.is_active).map((profile) => ({ value: profile.id, label: profile.name })),
                      ]}
                    />
                  </Field>
                </div>

                <div className="mt-5 flex gap-2">
                  <PrimaryButton onClick={() => void createUser()} disabled={savingKey === 'user:new'}>
                    {savingKey === 'user:new' ? 'Création…' : 'Créer la personne'}
                  </PrimaryButton>
                  <GhostButton onClick={() => setCreatingUser(false)}>Annuler</GhostButton>
                </div>
              </section>
            ) : userDraft ? (
              <section className="space-y-4">
                <div className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#111820] text-sm font-bold text-white">
                        {initialsOf(userDraft)}
                      </span>
                      <div>
                        <h2 className="text-xl font-bold leading-tight text-slate-900">
                          {userDraft.display_name || userDraft.email}
                        </h2>
                        <p className="font-mono text-xs text-slate-500">{userDraft.email}</p>
                      </div>
                    </div>
                    {!userDraft.access_profile_id && (
                      <span className="rounded-full bg-[#FBE9E9] px-3 py-1.5 text-xs font-bold text-[#A32C2C]">
                        Sans profil : cette personne ne voit aucun écran
                      </span>
                    )}
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Field label="Nom affiché">
                      <TextField value={userDraft.display_name} onChange={(value) => patchUserDraft({ display_name: value })} placeholder="Prénom Nom" />
                    </Field>
                    <Field label="Profil d’accès">
                      <SelectField
                        value={userDraft.access_profile_id}
                        onChange={(value) => patchUserDraft({ access_profile_id: value })}
                        options={[
                          { value: '', label: 'Aucun profil' },
                          ...profiles.map((profile) => ({
                            value: profile.id,
                            label: profile.is_active ? profile.name : `${profile.name} (inactif)`,
                          })),
                        ]}
                      />
                    </Field>
                  </div>

                  <ProfilePreview profile={profileById.get(userDraft.access_profile_id) || null} />
                </div>

                <div className="rounded-2xl border border-[#E2DFD8] bg-white">
                  <SectionHeader
                    eyebrow="Périmètre personnel"
                    title="Ce que cette personne peut voir"
                    description="Une liste vide veut dire « aucune restriction » sur le critère concerné."
                  />
                  <div className="grid grid-cols-1 gap-4 px-5 pb-5 lg:grid-cols-2">
                    <Field label="Scopes société" hint="Vide = Global.">
                      <ChipsField
                        values={userDraft.allowed_scopes}
                        onChange={(values) => patchUserDraft({ allowed_scopes: values })}
                        placeholder="Global, CEGECLIM Energies…"
                        fallback={['Global']}
                      />
                    </Field>
                    <Field label="Agences" hint="Vide = toutes les agences.">
                      <ChipsField
                        values={userDraft.allowed_agences}
                        onChange={(values) => patchUserDraft({ allowed_agences: values })}
                        placeholder="ANGLET, BORDEAUX…"
                      />
                    </Field>
                    <Field label="Collaborateurs" hint="Vide = tous les représentants.">
                      <ChipsField
                        values={userDraft.allowed_collaborateurs}
                        onChange={(values) => patchUserDraft({ allowed_collaborateurs: values })}
                        placeholder="Nom du représentant"
                      />
                    </Field>
                    <Field label="Codes postaux" hint="Prioritaire sur les départements.">
                      <ChipsField
                        values={userDraft.allowed_codes_postaux}
                        onChange={(values) => patchUserDraft({ allowed_codes_postaux: values })}
                        placeholder="85270, 85100…"
                      />
                    </Field>
                  </div>

                  <DepartmentPicker
                    selected={userDraft.allowed_departements}
                    onChange={(values) => patchUserDraft({ allowed_departements: values })}
                  />
                </div>

                <SaveBar
                  dirty={userDirty}
                  saving={savingKey === `user:${userDraft.email}`}
                  idleLabel="Aucune modification en attente."
                  dirtyLabel="Modifications en attente sur cette personne."
                  onCancel={() => originalUser && setUserDraft({ ...originalUser })}
                  onSave={() => void saveUser(userDraft)}
                  saveLabel="Enregistrer la personne"
                />
              </section>
            ) : (
              <EmptyState
                title="Sélectionnez une personne"
                body="Choisissez quelqu’un dans la liste pour ajuster son profil et son périmètre géographique, ou ajoutez un nouvel accès."
                action={<PrimaryButton onClick={() => setCreatingUser(true)}>Ajouter une personne</PrimaryButton>}
              />
            )}
          </div>
        ) : (
          /* ---------------------------------------------------------- Matrice d'ensemble */
          <section className="rounded-2xl border border-[#E2DFD8] bg-white">
            <SectionHeader
              eyebrow="Lecture croisée"
              title="Qui voit quoi"
              description="Une ligne par profil, une colonne par écran. Cliquez sur un profil pour l’ouvrir."
            />

            {profiles.length === 0 ? (
              <p className="px-5 pb-8 text-sm text-slate-500">Créez un profil pour afficher la matrice.</p>
            ) : (
              <div className="overflow-x-auto px-5 pb-5">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 border-b border-[#E2DFD8] bg-white px-3 py-2 text-left align-bottom">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Profil</span>
                      </th>
                      <th className="border-b border-[#E2DFD8] px-2 py-2 align-bottom">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Pers.</span>
                      </th>
                      {PERMISSION_GROUPS.map((group) =>
                        group.items.map((permission, index) => (
                          <th
                            key={permission.key}
                            className={`border-b border-[#E2DFD8] px-1 py-2 align-bottom ${
                              index === 0 ? 'border-l border-[#E2DFD8]' : ''
                            }`}
                          >
                            <div className="mx-auto h-[130px] w-6">
                              <span className="block origin-bottom-left translate-x-5 -rotate-90 whitespace-nowrap text-[11px] font-semibold text-slate-600">
                                {permission.label}
                              </span>
                            </div>
                          </th>
                        ))
                      )}
                      {ALERTS.map((alert, index) => (
                        <th
                          key={alert.key}
                          className={`border-b border-[#E2DFD8] px-1 py-2 align-bottom ${
                            index === 0 ? 'border-l-2 border-l-[#B4761A]' : ''
                          }`}
                        >
                          <div className="mx-auto h-[130px] w-6">
                            <span className="block origin-bottom-left translate-x-5 -rotate-90 whitespace-nowrap text-[11px] font-semibold text-[#8A5A11]">
                              {alert.label}
                            </span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {profiles.map((profile) => (
                      <tr key={profile.id} className="group">
                        <td className="sticky left-0 z-10 border-b border-[#EFEDE8] bg-white px-3 py-2 group-hover:bg-[#FAF9F7]">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTab('profiles')
                              selectProfile(profile.id)
                            }}
                            className="text-left text-sm font-semibold text-slate-900 underline-offset-4 hover:text-[#8A5A11] hover:underline"
                          >
                            {profile.name}
                          </button>
                          {!profile.is_active && <span className="ml-2 text-[11px] text-[#A32C2C]">inactif</span>}
                        </td>
                        <td className="border-b border-[#EFEDE8] px-2 py-2 text-center text-xs font-bold tabular-nums text-slate-500 group-hover:bg-[#FAF9F7]">
                          {profile.user_count}
                        </td>
                        {PERMISSION_GROUPS.map((group) =>
                          group.items.map((permission, index) => (
                            <MatrixCell
                              key={permission.key}
                              on={profile[permission.key]}
                              leading={index === 0}
                              title={`${profile.name} — ${permission.label}`}
                            />
                          ))
                        )}
                        {ALERTS.map((alert, index) => (
                          <MatrixCell
                            key={alert.key}
                            on={profile[alert.key]}
                            accent
                            strongLeading={index === 0}
                            title={`${profile.name} — ${alert.label}`}
                          />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="mt-4 flex flex-wrap items-center gap-5 text-xs text-slate-500">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#111820]" /> écran autorisé
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#B4761A]" /> alerte affichée
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full border border-[#D8D3C8]" /> fermé
                  </span>
                </div>
              </div>
            )}
          </section>
        )}
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
  return (
    <div
      className={`min-w-[104px] rounded-xl border px-4 py-2.5 ${
        tone === 'warn' && value > 0 ? 'border-[#B4761A] bg-[#1B1710]' : 'border-[#2C3946] bg-[#161F29]'
      }`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold tabular-nums ${tone === 'warn' && value > 0 ? 'text-[#E0A961]' : 'text-white'}`}>
        {value}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative -mb-px px-5 py-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] ${
        active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
      <span
        className={`absolute inset-x-3 bottom-0 h-[3px] rounded-t ${active ? 'bg-[#B4761A]' : 'bg-transparent'}`}
        aria-hidden="true"
      />
    </button>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8A5A11]">{children}</div>
}

function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-[#EFEDE8] px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h3 className="mt-1 text-lg font-bold text-slate-900">{title}</h3>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  )
}

function Field({
  label,
  hint,
  className = '',
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-semibold text-slate-800">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

function TextField({
  value,
  onChange,
  placeholder = '',
  type = 'text',
  mono = false,
  autoFocus = false,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  mono?: boolean
  autoFocus?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={`h-[42px] w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25 ${
        mono ? 'font-mono' : ''
      }`}
    />
  )
}

function SelectField({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-[42px] w-full cursor-pointer rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
    >
      {options.map((option) => (
        <option key={`${option.value}-${option.label}`} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/**
 * Saisie sous forme d'étiquettes : on voit ce qui est réellement enregistré,
 * au lieu d'une chaîne « 44, 49, 85 » qu'il faut relire pour la comprendre.
 * Entrée ou virgule valide, Retour arrière sur champ vide retire la dernière.
 */
function ChipsField({
  values,
  onChange,
  placeholder = '',
  fallback = [],
}: {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  fallback?: string[]
}) {
  const [draft, setDraft] = useState('')

  function commit(raw: string) {
    const additions = textToList(raw)
    if (!additions.length) return
    onChange(Array.from(new Set([...values, ...additions])))
    setDraft('')
  }

  function removeAt(index: number) {
    const next = values.filter((_, position) => position !== index)
    onChange(next.length ? next : fallback)
  }

  return (
    <div className="rounded-xl border border-[#D8D3C8] bg-white p-2 transition focus-within:border-[#B4761A] focus-within:ring-2 focus-within:ring-[#B4761A]/25">
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((value, index) => (
          <span
            key={`${value}-${index}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#EDEAE3] py-1 pl-2.5 pr-1.5 text-xs font-semibold text-slate-700"
          >
            {value}
            <button
              type="button"
              onClick={() => removeAt(index)}
              className="rounded text-slate-500 transition hover:text-[#A32C2C]"
              aria-label={`Retirer ${value}`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(event) => {
            const raw = event.target.value
            if (/[;,|]/.test(raw)) commit(raw)
            else setDraft(raw)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit(draft)
            }
            if (event.key === 'Backspace' && !draft && values.length) {
              removeAt(values.length - 1)
            }
          }}
          onBlur={() => commit(draft)}
          placeholder={values.length ? '' : placeholder}
          className="min-w-[120px] flex-1 border-0 bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-slate-400"
        />
      </div>
    </div>
  )
}

function ToggleCard({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
        checked ? 'border-[#111820] bg-[#F7F6F3]' : 'border-[#E7E4DD] bg-white hover:border-[#D8D3C8]'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#B4761A]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-600">{description}</span>
      </span>
    </label>
  )
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
      className="rounded-xl bg-[#111820] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#25313D] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] disabled:cursor-not-allowed disabled:opacity-40"
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
      className="rounded-lg border border-[#D8D3C8] bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[#B4761A] hover:text-[#8A5A11] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]"
    >
      {children}
    </button>
  )
}

/**
 * Barre d'enregistrement collante : elle indique en permanence s'il reste
 * quelque chose à sauvegarder, ce qui évite de quitter un écran sans le savoir.
 */
function SaveBar({
  dirty,
  saving,
  idleLabel,
  dirtyLabel,
  onCancel,
  onSave,
  saveLabel,
}: {
  dirty: boolean
  saving: boolean
  idleLabel: string
  dirtyLabel: string
  onCancel: () => void
  onSave: () => void
  saveLabel: string
}) {
  return (
    <div
      className={`sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 backdrop-blur transition ${
        dirty ? 'border-[#B4761A] bg-[#FDF7EA]/95 shadow-lg' : 'border-[#E2DFD8] bg-white/90'
      }`}
    >
      <span className={`flex items-center gap-2 text-sm ${dirty ? 'font-semibold text-[#8A5A11]' : 'text-slate-500'}`}>
        <span className={`h-2 w-2 rounded-full ${dirty ? 'bg-[#B4761A]' : 'bg-[#D8D3C8]'}`} aria-hidden="true" />
        {dirty ? dirtyLabel : idleLabel}
      </span>
      <div className="flex gap-2">
        {dirty && <GhostButton onClick={onCancel}>Annuler les modifications</GhostButton>}
        <PrimaryButton onClick={onSave} disabled={!dirty || saving}>
          {saving ? 'Enregistrement…' : saveLabel}
        </PrimaryButton>
      </div>
    </div>
  )
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#D8D3C8] bg-white px-8 py-20 text-center">
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Rappel visuel de la portée d'une modification de profil. */
function ImpactBanner({ users }: { users: UserAccess[] }) {
  if (users.length === 0) {
    return (
      <div className="mt-5 rounded-xl border border-[#E7E4DD] bg-[#FAF9F7] px-4 py-3 text-sm text-slate-600">
        Personne n’est encore rattaché à ce profil. Vous pouvez le régler librement.
      </div>
    )
  }

  return (
    <div className="mt-5 rounded-xl border border-[#EBD8AE] bg-[#FDF7EA] px-4 py-3">
      <div className="text-sm font-semibold text-[#8A5A11]">
        {users.length} personne{users.length > 1 ? 's' : ''} héritent de ce profil
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {users.map((user) => (
          <span
            key={user.email}
            title={user.email}
            className="rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-[#EBD8AE]"
          >
            {user.display_name || user.email}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Résumé lisible du profil choisi, pour éviter d'aller vérifier dans l'autre onglet. */
function ProfilePreview({ profile }: { profile: AccessProfile | null }) {
  if (!profile) return null

  const granted = PERMISSIONS.filter(({ key }) => profile[key])
  const alerts = ALERTS.filter(({ key }) => profile[key])
  const landing = LANDING_PAGES.find((page) => page.value === profile.default_landing_page)

  return (
    <div className="mt-5 rounded-xl border border-[#E7E4DD] bg-[#FAF9F7] px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-slate-900">Ce que donne le profil « {profile.name} »</span>
        <span className="text-xs text-slate-500">
          ouvre sur {landing?.label || profile.default_landing_page}
        </span>
      </div>

      {granted.length === 0 ? (
        <p className="mt-2 text-sm text-[#A32C2C]">Aucun écran n’est ouvert sur ce profil.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {granted.map((permission) => (
            <span key={permission.key} className="rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-[#E2DFD8]">
              {permission.label}
            </span>
          ))}
          {alerts.map((alert) => (
            <span key={alert.key} className="rounded-lg bg-[#FDF7EA] px-2.5 py-1 text-xs font-medium text-[#8A5A11] ring-1 ring-[#EBD8AE]">
              ⬤ {alert.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const DEPARTMENT_PRESETS: Array<{ label: string; codes: string[] }> = [
  { label: 'Pays de la Loire', codes: ['44', '49', '53', '72', '85'] },
  { label: 'Bretagne', codes: ['22', '29', '35', '56'] },
  { label: 'Nouvelle-Aquitaine', codes: ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'] },
  { label: 'Centre-Val de Loire', codes: ['18', '28', '36', '37', '41', '45'] },
]

/**
 * Sélecteur de départements en clair : deux modes explicites plutôt qu'une
 * liste vide qui signifiait « tous » sans le dire. La sémantique en base est
 * conservée — un tableau vide reste un accès national.
 */
function DepartmentPicker({ selected, onChange }: { selected: string[]; onChange: (values: string[]) => void }) {
  const [restricted, setRestricted] = useState(selected.length > 0)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    setRestricted(selected.length > 0)
  }, [selected])

  const visible = filter.trim()
    ? ALL_DEPARTEMENTS.filter((code) => code.startsWith(filter.trim()))
    : ALL_DEPARTEMENTS

  function toggle(code: string) {
    const next = selected.includes(code)
      ? selected.filter((item) => item !== code)
      : [...selected, code].sort((a, b) => a.localeCompare(b, 'fr'))
    onChange(next)
  }

  function applyPreset(codes: string[]) {
    const merged = Array.from(new Set([...selected, ...codes])).sort((a, b) => a.localeCompare(b, 'fr'))
    onChange(merged)
  }

  return (
    <div className="border-t border-[#EFEDE8] px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-slate-900">Départements</h4>
          <p className="mt-1 text-sm text-slate-600">
            {restricted
              ? `${selected.length} département${selected.length > 1 ? 's' : ''} sélectionné${selected.length > 1 ? 's' : ''}.`
              : 'Accès national : tous les départements sont visibles.'}
          </p>
        </div>

        <div className="inline-flex rounded-xl border border-[#D8D3C8] bg-white p-1">
          <ModeButton
            active={!restricted}
            onClick={() => {
              setRestricted(false)
              onChange([])
            }}
          >
            Toute la France
          </ModeButton>
          <ModeButton active={restricted} onClick={() => setRestricted(true)}>
            Sélection
          </ModeButton>
        </div>
      </div>

      {restricted && (
        <div className="mt-4 rounded-xl border border-[#E7E4DD] bg-[#FAF9F7] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value.replace(/\D/g, '').slice(0, 3))}
              placeholder="Filtrer : 85"
              inputMode="numeric"
              className="h-9 w-28 rounded-lg border border-[#D8D3C8] bg-white px-3 text-sm outline-none focus:border-[#B4761A]"
            />
            {DEPARTMENT_PRESETS.map((preset) => (
              <GhostButton key={preset.label} onClick={() => applyPreset(preset.codes)}>
                + {preset.label}
              </GhostButton>
            ))}
            {selected.length > 0 && <GhostButton onClick={() => onChange([])}>Vider la sélection</GhostButton>}
          </div>

          <div className="mt-3 grid grid-cols-6 gap-1.5 sm:grid-cols-10 lg:grid-cols-[repeat(16,minmax(0,1fr))]">
            {visible.map((code) => {
              const checked = selected.includes(code)
              return (
                <button
                  type="button"
                  key={code}
                  onClick={() => toggle(code)}
                  aria-pressed={checked}
                  className={`rounded-lg border py-1.5 text-xs font-semibold tabular-nums transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] ${
                    checked
                      ? 'border-[#111820] bg-[#111820] text-white'
                      : 'border-[#E2DFD8] bg-white text-slate-500 hover:border-[#B4761A] hover:text-slate-800'
                  }`}
                >
                  {code}
                </button>
              )
            })}
          </div>

          {selected.length === 0 && (
            <p className="mt-3 text-xs font-semibold text-[#8A5A11]">
              Aucun département coché : l’accès restera national tant que la sélection est vide.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] ${
        active ? 'bg-[#111820] text-white' : 'text-slate-600 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  )
}

function MatrixCell({
  on,
  accent = false,
  leading = false,
  strongLeading = false,
  title,
}: {
  on: boolean
  accent?: boolean
  leading?: boolean
  strongLeading?: boolean
  title: string
}) {
  return (
    <td
      title={`${title} — ${on ? 'autorisé' : 'fermé'}`}
      className={`border-b border-[#EFEDE8] px-1 py-2 text-center group-hover:bg-[#FAF9F7] ${
        strongLeading ? 'border-l-2 border-l-[#B4761A]' : leading ? 'border-l border-l-[#E2DFD8]' : ''
      }`}
    >
      <span
        className={`mx-auto block h-2.5 w-2.5 rounded-full ${
          on ? (accent ? 'bg-[#B4761A]' : 'bg-[#111820]') : 'border border-[#D8D3C8]'
        }`}
      />
    </td>
  )
}
