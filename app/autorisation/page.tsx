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

const PERMISSIONS: Array<{ key: PermissionKey; label: string; description: string }> = [
  { key: 'can_dashboard', label: 'Tableaux de bord', description: 'Indicateurs, portefeuille, SMC, Focus mois et approvisionnements.' },
  { key: 'can_territoire', label: 'Territoire', description: 'Écran Région / Département.' },
  { key: 'can_cartographie', label: 'Cartographie', description: 'Écran de cartographie.' },
  { key: 'can_clients', label: 'Clients', description: 'Liste et gestion des clients.' },
  { key: 'can_carte', label: 'Prospects / Clients', description: 'Carte commerciale et prospects.' },
  { key: 'can_todo', label: 'Todo List', description: 'Accès à la liste des actions.' },
  { key: 'can_clients_cegeclim', label: 'Clients Cegeclim', description: 'Accès à la vue clients Cegeclim.' },
  { key: 'can_suivi_prospects', label: 'Suivi prospects', description: 'Accès au suivi des prospects.' },
  { key: 'can_agences', label: 'Agences', description: 'Accès à l’écran Agences.' },
  { key: 'can_autorisation', label: 'Administration', description: 'Autorisations, imports, jobs, analyse devis et atelier.' },
  { key: 'can_documents', label: 'Documents', description: 'Accès à la bibliothèque documentaire.' },
  { key: 'can_stocks', label: 'Stocks', description: 'Projection et disponibilité des stocks.' },
  { key: 'can_activites', label: 'Activités', description: 'Accès aux écrans d’activité.' },
  { key: 'can_change_scope', label: 'Changer de société', description: 'Autorise le changement de scope dans le bandeau.' },
]

const ALERTS: Array<{ key: AlertKey; label: string; description: string }> = [
  { key: 'show_alert_cerfa_ko', label: 'CERFA KO', description: 'Pastille et fenêtre des CERFA à régulariser.' },
  { key: 'show_alert_cdc_liv_avant_2026', label: 'CDC liv. avant 2026', description: 'Commandes clients dont la date de livraison est antérieure à 2026.' },
  { key: 'show_alert_controle_frais_port', label: 'Contrôle frais de port', description: 'Anomalies de facturation des frais de port sur les BL.' },
  { key: 'show_alert_capacite_gaz', label: 'Capacité gaz', description: 'Certifications arrivées à échéance ou proches de l’échéance.' },
  { key: 'show_alert_todo', label: 'À faire', description: 'Actions ouvertes et en retard de la Todo List.' },
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

function listToText(values: string[]) {
  return (values || []).join(', ')
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

export default function AutorisationPage() {
  const [profiles, setProfiles] = useState<AccessProfile[]>([])
  const [users, setUsers] = useState<UserAccess[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'profiles' | 'users'>('profiles')
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [profileDraft, setProfileDraft] = useState<AccessProfile>(EMPTY_PROFILE)
  const [creatingProfile, setCreatingProfile] = useState(false)
  const [newProfile, setNewProfile] = useState<AccessProfile>(EMPTY_PROFILE)
  const [newUser, setNewUser] = useState<UserAccess>(EMPTY_USER)
  const [search, setSearch] = useState('')
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [departmentUserEmail, setDepartmentUserEmail] = useState<string | null>(null)

  async function loadData(preferredProfileId?: string) {
    setLoading(true)
    setErrorMessage('')

    const [{ data: profileData, error: profileError }, { data: userData, error: userError }] = await Promise.all([
      supabase.from('access_profiles').select('*').order('name', { ascending: true }),
      supabase
        .from('user_page_access')
        .select('email, display_name, access_profile_id, allowed_scopes, allowed_agences, allowed_collaborateurs, allowed_departements, allowed_codes_postaux')
        .order('email', { ascending: true }),
    ])

    if (profileError || userError) {
      setErrorMessage(`Erreur de chargement : ${profileError?.message || userError?.message}`)
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

    const nextProfileId = preferredProfileId
      || selectedProfileId
      || formattedProfiles[0]?.id
      || ''
    const selected = formattedProfiles.find((profile) => profile.id === nextProfileId) || formattedProfiles[0]
    setSelectedProfileId(selected?.id || '')
    setProfileDraft(selected ? { ...selected } : EMPTY_PROFILE)

    if (!newUser.access_profile_id && formattedProfiles.length) {
      setNewUser((current) => ({ ...current, access_profile_id: formattedProfiles[0].id }))
    }

    setLoading(false)
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const selected = profiles.find((profile) => profile.id === selectedProfileId)
    if (selected) setProfileDraft({ ...selected })
  }, [selectedProfileId, profiles])

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return users
    return users.filter((user) => {
      const profileName = profiles.find((profile) => profile.id === user.access_profile_id)?.name || ''
      return [user.email, user.display_name, profileName].some((value) => value.toLowerCase().includes(term))
    })
  }, [users, search, profiles])

  function updateUser(email: string, patch: Partial<UserAccess>) {
    setUsers((current) => current.map((user) => user.email === email ? { ...user, ...patch } : user))
  }

  function selectAllProfileRights(value: boolean) {
    setProfileDraft((current) => ({
      ...current,
      ...Object.fromEntries(PERMISSIONS.map(({ key }) => [key, value])),
    }) as AccessProfile)
  }

  function selectAllProfileAlerts(value: boolean) {
    setProfileDraft((current) => ({
      ...current,
      ...Object.fromEntries(ALERTS.map(({ key }) => [key, value])),
    }) as AccessProfile)
  }

  async function saveProfile() {
    if (!profileDraft.id) return
    const name = profileDraft.name.trim()
    const code = slugify(profileDraft.code || name)

    if (!name || !code) {
      setErrorMessage('Le nom et le code du profil sont obligatoires.')
      return
    }

    setSavingKey(`profile:${profileDraft.id}`)
    setMessage('')
    setErrorMessage('')

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

    if (error) {
      setErrorMessage(`Erreur lors de l’enregistrement du profil : ${error.message}`)
      setSavingKey(null)
      return
    }

    setMessage(`Profil « ${name} » mis à jour. Les ${profileDraft.user_count} utilisateur(s) rattaché(s) en bénéficieront.`)
    setSavingKey(null)
    dispatchAccessChanged()
    await loadData(profileDraft.id)
  }

  async function createProfile() {
    const name = newProfile.name.trim()
    const code = slugify(newProfile.code || name)
    if (!name || !code) {
      setErrorMessage('Le nom du nouveau profil est obligatoire.')
      return
    }

    setSavingKey('profile:new')
    setMessage('')
    setErrorMessage('')

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

    if (error) {
      setErrorMessage(`Erreur lors de la création du profil : ${error.message}`)
      setSavingKey(null)
      return
    }

    const createdId = String((data as any)?.id || '')
    setMessage(`Profil « ${name} » créé.`)
    setNewProfile(EMPTY_PROFILE)
    setCreatingProfile(false)
    setSavingKey(null)
    dispatchAccessChanged()
    await loadData(createdId)
  }

  async function saveUser(user: UserAccess) {
    const email = user.email.toLowerCase().trim()
    if (!email || !user.access_profile_id) {
      setErrorMessage('L’utilisateur doit avoir un email et un profil d’accès.')
      return
    }

    setSavingKey(`user:${email}`)
    setMessage('')
    setErrorMessage('')

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

    if (error) {
      setErrorMessage(`Erreur lors de l’enregistrement de ${email} : ${error.message}`)
      setSavingKey(null)
      return
    }

    setMessage(`Utilisateur ${email} mis à jour.`)
    setSavingKey(null)
    dispatchAccessChanged()
    await loadData(selectedProfileId)
  }

  async function createUser() {
    const email = newUser.email.toLowerCase().trim()
    if (!email || !newUser.access_profile_id) {
      setErrorMessage('L’email et le profil d’accès sont obligatoires.')
      return
    }

    setSavingKey('user:new')
    setMessage('')
    setErrorMessage('')

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

    if (error) {
      setErrorMessage(`Erreur lors de la création de l’utilisateur : ${error.message}`)
      setSavingKey(null)
      return
    }

    setMessage(`Utilisateur ${email} créé.`)
    setNewUser({ ...EMPTY_USER, access_profile_id: profiles[0]?.id || '' })
    setSavingKey(null)
    dispatchAccessChanged()
    await loadData(selectedProfileId)
  }

  function toggleDepartment(email: string, department: string) {
    const user = users.find((item) => item.email === email)
    if (!user) return
    const next = user.allowed_departements.includes(department)
      ? user.allowed_departements.filter((item) => item !== department)
      : [...user.allowed_departements, department].sort((a, b) => a.localeCompare(b, 'fr'))
    updateUser(email, { allowed_departements: next })
  }

  const departmentUser = users.find((user) => user.email === departmentUserEmail) || null

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto w-full max-w-[1900px] space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Gestion des accès</h1>
              <p className="mt-1 max-w-4xl text-sm text-slate-600">
                Les écrans, la page d’accueil et les pastilles d’alerte sont définis dans un profil partagé. Les agences, collaborateurs, départements, codes postaux et scopes restent propres à chaque utilisateur.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadData(selectedProfileId)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Rafraîchir
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Metric label="Profils d’accès" value={profiles.length} />
            <Metric label="Utilisateurs" value={users.length} />
            <Metric label="Profils partagés" value={profiles.filter((profile) => profile.user_count > 1).length} />
          </div>

          {message && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
          {errorMessage && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{errorMessage}</div>}
        </section>

        <div className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <TabButton active={activeTab === 'profiles'} onClick={() => setActiveTab('profiles')}>Profils d’accès</TabButton>
          <TabButton active={activeTab === 'users'} onClick={() => setActiveTab('users')}>Utilisateurs et périmètres</TabButton>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">Chargement…</div>
        ) : activeTab === 'profiles' ? (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-bold text-slate-900">Profils</h2>
                <button type="button" onClick={() => setCreatingProfile((value) => !value)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                  Nouveau
                </button>
              </div>

              {creatingProfile && (
                <div className="mb-4 space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-3">
                  <TextInput value={newProfile.name} onChange={(value) => setNewProfile((current) => ({ ...current, name: value, code: current.code || slugify(value) }))} placeholder="Nom du profil" />
                  <TextInput value={newProfile.code} onChange={(value) => setNewProfile((current) => ({ ...current, code: slugify(value) }))} placeholder="Code technique" />
                  <button type="button" onClick={() => void createProfile()} disabled={savingKey === 'profile:new'} className="w-full rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    {savingKey === 'profile:new' ? 'Création…' : 'Créer le profil'}
                  </button>
                </div>
              )}

              <div className="space-y-2">
                {profiles.map((profile) => (
                  <button
                    type="button"
                    key={profile.id}
                    onClick={() => setSelectedProfileId(profile.id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${selectedProfileId === profile.id ? 'border-sky-400 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-900">{profile.name}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{profile.code}</div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${profile.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                        {profile.user_count} user{profile.user_count > 1 ? 's' : ''}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </aside>

            {profileDraft.id ? (
              <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <Field label="Nom du profil"><TextInput value={profileDraft.name} onChange={(value) => setProfileDraft((current) => ({ ...current, name: value }))} /></Field>
                  <Field label="Code technique"><TextInput value={profileDraft.code} onChange={(value) => setProfileDraft((current) => ({ ...current, code: slugify(value) }))} /></Field>
                  <Field label="Description" className="lg:col-span-2"><TextInput value={profileDraft.description} onChange={(value) => setProfileDraft((current) => ({ ...current, description: value }))} /></Field>
                  <Field label="Écran d’accueil par défaut">
                    <select value={profileDraft.default_landing_page} onChange={(event) => setProfileDraft((current) => ({ ...current, default_landing_page: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
                      {LANDING_PAGES.map((page) => <option key={page.value} value={page.value}>{page.label}</option>)}
                    </select>
                  </Field>
                  <Field label="État du profil">
                    <label className="flex h-[42px] items-center gap-3 rounded-xl border border-slate-300 px-3 text-sm">
                      <input type="checkbox" checked={profileDraft.is_active} onChange={(event) => setProfileDraft((current) => ({ ...current, is_active: event.target.checked }))} />
                      Profil actif
                    </label>
                  </Field>
                </div>

                <ProfileBooleanSection
                  title="Écrans et fonctions autorisés"
                  subtitle="Une modification s’applique automatiquement à tous les utilisateurs rattachés à ce profil."
                  actions={<><SmallButton onClick={() => selectAllProfileRights(true)}>Tout cocher</SmallButton><SmallButton onClick={() => selectAllProfileRights(false)}>Tout décocher</SmallButton></>}
                >
                  {PERMISSIONS.map((permission) => (
                    <BooleanCard key={permission.key} label={permission.label} description={permission.description} checked={profileDraft[permission.key]} onChange={(checked) => setProfileDraft((current) => ({ ...current, [permission.key]: checked }))} />
                  ))}
                </ProfileBooleanSection>

                <ProfileBooleanSection
                  title="Pastilles d’alerte visibles"
                  subtitle="Les alertes désactivées ne sont ni affichées ni calculées dans le layout."
                  actions={<><SmallButton onClick={() => selectAllProfileAlerts(true)}>Tout cocher</SmallButton><SmallButton onClick={() => selectAllProfileAlerts(false)}>Tout décocher</SmallButton></>}
                >
                  {ALERTS.map((alert) => (
                    <BooleanCard key={alert.key} label={alert.label} description={alert.description} checked={profileDraft[alert.key]} onChange={(checked) => setProfileDraft((current) => ({ ...current, [alert.key]: checked }))} />
                  ))}
                </ProfileBooleanSection>

                <div className="sticky bottom-4 flex justify-end rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
                  <button type="button" onClick={() => void saveProfile()} disabled={savingKey === `profile:${profileDraft.id}`} className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
                    {savingKey === `profile:${profileDraft.id}` ? 'Enregistrement…' : `Enregistrer pour ${profileDraft.user_count} utilisateur(s)`}
                  </button>
                </div>
              </section>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">Créez ou sélectionnez un profil.</div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">Créer un utilisateur</h2>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <TextInput value={newUser.email} onChange={(value) => setNewUser((current) => ({ ...current, email: value.toLowerCase().trim() }))} placeholder="email@exemple.com" type="email" />
                <TextInput value={newUser.display_name} onChange={(value) => setNewUser((current) => ({ ...current, display_name: value }))} placeholder="Nom affiché" />
                <select value={newUser.access_profile_id} onChange={(event) => setNewUser((current) => ({ ...current, access_profile_id: event.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="">Choisir un profil</option>
                  {profiles.filter((profile) => profile.is_active).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select>
                <button type="button" onClick={() => void createUser()} disabled={savingKey === 'user:new'} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                  {savingKey === 'user:new' ? 'Création…' : 'Créer l’utilisateur'}
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Utilisateurs et périmètres personnels</h2>
                  <p className="text-sm text-slate-600">Une liste vide signifie qu’aucune restriction n’est appliquée sur le critère concerné.</p>
                </div>
                <TextInput value={search} onChange={setSearch} placeholder="Rechercher email, nom ou profil" className="lg:max-w-md" />
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-[1550px] w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="sticky left-0 z-20 min-w-[250px] border-b border-r border-slate-200 bg-slate-100 px-3 py-3">Utilisateur</th>
                      <th className="min-w-[220px] border-b border-slate-200 px-3 py-3">Profil d’accès</th>
                      <th className="min-w-[180px] border-b border-slate-200 px-3 py-3">Scopes</th>
                      <th className="min-w-[230px] border-b border-slate-200 px-3 py-3">Agences</th>
                      <th className="min-w-[260px] border-b border-slate-200 px-3 py-3">Collaborateurs</th>
                      <th className="min-w-[220px] border-b border-slate-200 px-3 py-3">Codes postaux</th>
                      <th className="min-w-[160px] border-b border-slate-200 px-3 py-3">Départements</th>
                      <th className="min-w-[130px] border-b border-slate-200 px-3 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <tr key={user.email} className="border-b border-slate-100 align-top hover:bg-slate-50/60">
                        <td className="sticky left-0 z-[5] border-r border-slate-200 bg-white px-3 py-3">
                          <div className="font-semibold text-slate-900">{user.email}</div>
                          <input value={user.display_name} onChange={(event) => updateUser(user.email, { display_name: event.target.value })} placeholder="Nom affiché" className="mt-2 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm" />
                        </td>
                        <td className="px-3 py-3">
                          <select value={user.access_profile_id} onChange={(event) => updateUser(user.email, { access_profile_id: event.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2">
                            <option value="">Aucun profil</option>
                            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.is_active ? '' : ' (inactif)'}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-3"><ListInput values={user.allowed_scopes} fallback={['Global']} onChange={(values) => updateUser(user.email, { allowed_scopes: values })} /></td>
                        <td className="px-3 py-3"><ListInput values={user.allowed_agences} onChange={(values) => updateUser(user.email, { allowed_agences: values })} placeholder="ANGLET, BORDEAUX…" /></td>
                        <td className="px-3 py-3"><ListInput values={user.allowed_collaborateurs} onChange={(values) => updateUser(user.email, { allowed_collaborateurs: values })} placeholder="Noms séparés par virgule" /></td>
                        <td className="px-3 py-3"><ListInput values={user.allowed_codes_postaux} onChange={(values) => updateUser(user.email, { allowed_codes_postaux: values })} placeholder="85100, 85000…" /></td>
                        <td className="px-3 py-3">
                          <button type="button" onClick={() => setDepartmentUserEmail(user.email)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50">
                            {user.allowed_departements.length ? `${user.allowed_departements.length} sélectionné(s)` : 'Tous'}
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          <button type="button" onClick={() => void saveUser(user)} disabled={savingKey === `user:${user.email}`} className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-50">
                            {savingKey === `user:${user.email}` ? 'Sauvegarde…' : 'Enregistrer'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>

      {departmentUser && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setDepartmentUserEmail(null) }}>
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Départements autorisés</h3>
                <p className="text-sm text-slate-600">{departmentUser.email} — aucun département sélectionné = tous les départements.</p>
              </div>
              <div className="flex gap-2">
                <SmallButton onClick={() => updateUser(departmentUser.email, { allowed_departements: [] })}>Tous</SmallButton>
                <SmallButton onClick={() => updateUser(departmentUser.email, { allowed_departements: [...ALL_DEPARTEMENTS] })}>Sélectionner tous</SmallButton>
                <button type="button" onClick={() => setDepartmentUserEmail(null)} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Fermer</button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-12 lg:grid-cols-[repeat(15,minmax(0,1fr))]">
              {ALL_DEPARTEMENTS.map((department) => {
                const allAllowed = departmentUser.allowed_departements.length === 0
                const checked = allAllowed || departmentUser.allowed_departements.includes(department)
                return (
                  <label key={department} className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-2 py-2 text-sm font-semibold ${checked ? 'border-sky-300 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-500'}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        if (allAllowed) {
                          updateUser(departmentUser.email, { allowed_departements: ALL_DEPARTEMENTS.filter((item) => item !== department) })
                        } else {
                          toggleDepartment(departmentUser.email, department)
                        }
                      }}
                    />
                    {department}
                  </label>
                )
              })}
            </div>

            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => void saveUser(departmentUser)} disabled={savingKey === `user:${departmentUser.email}`} className="rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {savingKey === `user:${departmentUser.email}` ? 'Enregistrement…' : 'Enregistrer cet utilisateur'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-slate-100 p-4"><div className="text-sm text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold text-slate-900">{value}</div></div>
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`flex-1 rounded-xl px-4 py-3 text-sm font-bold transition ${active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{children}</button>
}

function Field({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return <label className={className}><span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>{children}</label>
}

function TextInput({ value, onChange, placeholder = '', type = 'text', className = '' }: { value: string; onChange: (value: string) => void; placeholder?: string; type?: string; className?: string }) {
  return <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={`w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-sky-500 ${className}`} />
}

function ListInput({ values, onChange, placeholder = '', fallback = [] }: { values: string[]; onChange: (values: string[]) => void; placeholder?: string; fallback?: string[] }) {
  const [draft, setDraft] = useState(listToText(values))
  useEffect(() => setDraft(listToText(values)), [values])
  return <input value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => onChange(textToList(draft, fallback))} placeholder={placeholder} className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm" />
}

function SmallButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">{children}</button>
}

function ProfileBooleanSection({ title, subtitle, actions, children }: { title: string; subtitle: string; actions: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><h3 className="font-bold text-slate-900">{title}</h3><p className="mt-1 text-sm text-slate-600">{subtitle}</p></div>
        <div className="flex gap-2">{actions}</div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">{children}</div>
    </section>
  )
}

function BooleanCard({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${checked ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4" />
      <span><span className="block font-semibold text-slate-900">{label}</span><span className="mt-0.5 block text-xs leading-5 text-slate-600">{description}</span></span>
    </label>
  )
}
