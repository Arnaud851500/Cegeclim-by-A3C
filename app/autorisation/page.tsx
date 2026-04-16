'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type UserPageAccess = {
  email: string
  can_dashboard: boolean
  can_territoire: boolean
  can_cartographie: boolean
  can_clients: boolean
  can_carte: boolean
  can_todo: boolean
  can_suivi_prospects: boolean
  can_clients_cegeclim: boolean
  can_agences: boolean
  can_autorisation: boolean
  can_documents: boolean
  can_stocks: boolean
  can_activites: boolean
  can_change_scope: boolean
  display_name: string
  allowed_scopes: string[]
  allowed_agences: string[]
  allowed_departements: string[]
  allowed_codes_postaux: string[]
  default_landing_page: string
}

const EMPTY_MESSAGE = ''

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
  '971', '972', '973', '974', '975', '976', '977', '978'
]

const defaultNewRow: UserPageAccess = {
  email: '',
  can_dashboard: false,
  can_territoire: false,
  can_cartographie: false,
  can_clients: false,
  can_carte: false,
  can_todo: true,
  can_suivi_prospects: false,
  can_clients_cegeclim: false,
  can_agences: false,
  can_autorisation: false,
  can_documents: false,
  can_stocks: false,
  can_activites: false,
  can_change_scope: false,
  display_name: '',
  allowed_scopes: ['Global'],
  allowed_agences: [],
  allowed_departements: [],
  allowed_codes_postaux: [],
  default_landing_page: '/accueil',
}

export default function AutorisationPage() {
  const [rows, setRows] = useState<UserPageAccess[]>([])
  const [loading, setLoading] = useState(true)
  const [savingEmail, setSavingEmail] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState(EMPTY_MESSAGE)
  const [errorMessage, setErrorMessage] = useState(EMPTY_MESSAGE)
  const [newRow, setNewRow] = useState<UserPageAccess>(defaultNewRow)
  const [selectedDeptUserEmail, setSelectedDeptUserEmail] = useState<string | null>(null)

  async function loadData() {
    setLoading(true)
    setMessage(EMPTY_MESSAGE)
    setErrorMessage(EMPTY_MESSAGE)

    const { data, error } = await supabase
      .from('user_page_access')
      .select(`
        email,
        can_dashboard,
        can_territoire,
        can_cartographie,
        can_clients,
        can_carte,
        can_todo,
        can_suivi_prospects,
        can_clients_cegeclim,
        can_agences,
        can_autorisation,
        can_documents,
        can_stocks,
        can_activites,
        can_change_scope,
        display_name,
        allowed_scopes,
        allowed_agences,
        allowed_departements,
        allowed_codes_postaux,
        default_landing_page
      `)
      .order('email', { ascending: true })

    if (error) {
      setErrorMessage(`Erreur lors du chargement : ${error.message}`)
      setRows([])
      setLoading(false)
      return
    }

    const formattedRows = (data || []).map((item) => ({
      email: String(item.email || '').toLowerCase().trim(),
      can_dashboard: !!item.can_dashboard,
      can_territoire: !!item.can_territoire,
      can_cartographie: !!item.can_cartographie,
      can_clients: !!item.can_clients,
      can_carte: !!item.can_carte,
      can_todo: !!item.can_todo,
      can_clients_cegeclim: !!item.can_clients_cegeclim,
      can_suivi_prospects: !!item.can_suivi_prospects,
      can_agences: !!item.can_agences,
      can_autorisation: !!item.can_autorisation,
      can_documents: !!item.can_documents,
      can_stocks: !!item.can_stocks,
      can_activites: !!item.can_activites,
      can_change_scope: !!item.can_change_scope,
      display_name:
        typeof item.display_name === 'string'
          ? item.display_name
          : Array.isArray(item.display_name)
            ? item.display_name.join(', ').trim()
            : '',
      allowed_scopes:
        Array.isArray(item.allowed_scopes) && item.allowed_scopes.length > 0
          ? item.allowed_scopes
          : ['Global'],
      allowed_agences:
        Array.isArray(item.allowed_agences) && item.allowed_agences.length > 0
          ? item.allowed_agences
          : [],
      allowed_departements:
        Array.isArray(item.allowed_departements) && item.allowed_departements.length > 0
          ? item.allowed_departements
          : [],
      allowed_codes_postaux:
        Array.isArray(item.allowed_codes_postaux) && item.allowed_codes_postaux.length > 0
          ? item.allowed_codes_postaux.map((cp) => String(cp || '').trim()).filter(Boolean)
          : [],
      default_landing_page:
        typeof item.default_landing_page === 'string' && item.default_landing_page.trim()
          ? item.default_landing_page.trim()
          : '/accueil',
    }))

    setRows(formattedRows)

    if (formattedRows.length > 0) {
      setSelectedDeptUserEmail((prev) =>
        prev && formattedRows.some((row) => row.email === prev)
          ? prev
          : formattedRows[0].email
      )
    } else {
      setSelectedDeptUserEmail(null)
    }

    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  function updateLocalValue(
    email: string,
    field: keyof Omit<UserPageAccess, 'email' | 'display_name' | 'allowed_scopes' | 'allowed_agences' | 'allowed_departements' | 'allowed_codes_postaux' | 'default_landing_page'>,
    value: boolean
  ) {
    const normalizedEmail = email.toLowerCase().trim()

    setRows((prev) =>
      prev.map((row) =>
        row.email === normalizedEmail ? { ...row, [field]: value } : row
      )
    )
  }

  function updateAllowedScopes(email: string, value: string) {
    const normalizedEmail = email.toLowerCase().trim()

    const scopes = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    setRows((prev) =>
      prev.map((row) =>
        row.email === normalizedEmail
          ? { ...row, allowed_scopes: scopes.length ? scopes : ['Global'] }
          : row
      )
    )
  }
  function updateDisplayName(email: string, value: string) {
    const normalizedEmail = email.toLowerCase().trim()

    setRows((prev) =>
      prev.map((row) =>
        row.email === normalizedEmail
          ? { ...row, display_name: value }
          : row
      )
    )
  }

  function updateAllowedAgences(email: string, value: string) {
    const normalizedEmail = email.toLowerCase().trim()

    const agences = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    setRows((prev) =>
      prev.map((row) =>
        row.email === normalizedEmail
          ? { ...row, allowed_agences: agences }
          : row
      )
    )
  }

  function updateAllowedCodesPostaux(email: string, value: string) {
    const normalizedEmail = email.toLowerCase().trim()

    const codesPostaux = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    setRows((prev) =>
      prev.map((row) =>
        row.email === normalizedEmail
          ? { ...row, allowed_codes_postaux: codesPostaux }
          : row
      )
    )
  }

  function updateAllowedDepartements(email: string, nextDepartements: string[]) {
    const normalizedEmail = email.toLowerCase().trim()

    setRows((prev) =>
      prev.map((row) =>
        row.email === normalizedEmail
          ? { ...row, allowed_departements: nextDepartements }
          : row
      )
    )
  }

  function updateDefaultLandingPage(email: string, value: string) {
    const normalizedEmail = email.toLowerCase().trim()

    setRows((prev) =>
      prev.map((row) =>
        row.email === normalizedEmail
          ? { ...row, default_landing_page: value || '/accueil' }
          : row
      )
    )
  }

  function toggleDepartementForUser(email: string, dep: string) {
    const row = rows.find((r) => r.email === email)
    if (!row) return

    const exists = row.allowed_departements.includes(dep)
    const next = exists
      ? row.allowed_departements.filter((d) => d !== dep)
      : [...row.allowed_departements, dep].sort((a, b) => a.localeCompare(b, 'fr'))

    updateAllowedDepartements(email, next)
  }

  function allowAllDepartementsForUser(email: string) {
    updateAllowedDepartements(email, [])
  }

  function denyAllDepartementsForUser(email: string) {
    updateAllowedDepartements(email, [...ALL_DEPARTEMENTS])
  }

  function updateNewRowValue(
    field: keyof Omit<UserPageAccess, 'email' | 'display_name' | 'allowed_scopes' | 'allowed_agences' | 'allowed_departements' | 'allowed_codes_postaux' | 'default_landing_page'>,
    value: boolean
  ) {
    setNewRow((prev) => ({ ...prev, [field]: value }))
  }

  function updateNewRowAllowedScopes(value: string) {
    const scopes = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    setNewRow((prev) => ({
      ...prev,
      allowed_scopes: scopes.length ? scopes : ['Global'],
    }))
  }

  function updateNewRowAllowedAgences(value: string) {
    const agences = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    setNewRow((prev) => ({
      ...prev,
      allowed_agences: agences,
    }))
  }

  function updateNewRowAllowedCodesPostaux(value: string) {
    const codesPostaux = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    setNewRow((prev) => ({
      ...prev,
      allowed_codes_postaux: codesPostaux,
    }))
  }

  function updateNewRowDefaultLandingPage(value: string) {
    setNewRow((prev) => ({
      ...prev,
      default_landing_page: value || '/accueil',
    }))
  }

  async function saveRow(row: UserPageAccess) {
    const normalizedEmail = row.email.toLowerCase().trim()

    setSavingEmail(normalizedEmail)
    setMessage(EMPTY_MESSAGE)
    setErrorMessage(EMPTY_MESSAGE)

    const { error } = await supabase
      .from('user_page_access')
      .update({
        can_dashboard: row.can_dashboard,
        can_territoire: row.can_territoire,
        can_cartographie: row.can_cartographie,
        can_clients: row.can_clients,
        can_carte: row.can_carte,
        can_todo: row.can_todo,
        can_clients_cegeclim: row.can_clients_cegeclim,
        can_suivi_prospects: row.can_suivi_prospects,
        can_agences: row.can_agences,
        can_autorisation: row.can_autorisation,
        can_documents: row.can_documents,
        can_stocks: row.can_stocks,
        can_activites: row.can_activites,
        can_change_scope: row.can_change_scope,
        display_name: row.display_name.trim(),
        allowed_scopes: row.allowed_scopes,
        allowed_agences: row.allowed_agences,
        allowed_departements: row.allowed_departements,
        allowed_codes_postaux: row.allowed_codes_postaux,
        default_landing_page: row.default_landing_page || '/accueil',
      })
      .eq('email', normalizedEmail)

    if (error) {
      setErrorMessage(`Erreur lors de l'enregistrement : ${error.message}`)
      setSavingEmail(null)
      return
    }

    setMessage(`Autorisations mises à jour pour ${normalizedEmail}`)
    setSavingEmail(null)
    await loadData()
  }

  async function createRow() {
    const normalizedEmail = newRow.email.toLowerCase().trim()

    setCreating(true)
    setMessage(EMPTY_MESSAGE)
    setErrorMessage(EMPTY_MESSAGE)

    if (!normalizedEmail) {
      setErrorMessage("Merci de renseigner l'email.")
      setCreating(false)
      return
    }

    const { error } = await supabase.from('user_page_access').insert({
      email: normalizedEmail,
      can_dashboard: newRow.can_dashboard,
      can_territoire: newRow.can_territoire,
      can_cartographie: newRow.can_cartographie,
      can_clients: newRow.can_clients,
      can_carte: newRow.can_carte,
      can_todo: newRow.can_todo,
      can_clients_cegeclim: newRow.can_clients_cegeclim,
      can_suivi_prospects: newRow.can_suivi_prospects,
      can_agences: newRow.can_agences,
      can_autorisation: newRow.can_autorisation,
      can_documents: newRow.can_documents,
      can_stocks: newRow.can_stocks,
      can_activites: newRow.can_activites,
      can_change_scope: newRow.can_change_scope,
      display_name: newRow.display_name.trim(),
      allowed_scopes: newRow.allowed_scopes,
      allowed_agences: newRow.allowed_agences,
      allowed_departements: newRow.allowed_departements,
      allowed_codes_postaux: newRow.allowed_codes_postaux,
      default_landing_page: newRow.default_landing_page || '/accueil',
    })

    if (error) {
      setErrorMessage(`Erreur lors de la création : ${error.message}`)
      setCreating(false)
      return
    }

    setMessage(`Ligne créée pour ${normalizedEmail}`)
    setNewRow(defaultNewRow)
    setCreating(false)
    await loadData()
  }

  function setAllForRow(email: string, value: boolean) {
    const normalizedEmail = email.toLowerCase().trim()

    setRows((prev) =>
      prev.map((row) =>
        row.email === normalizedEmail
          ? {
              ...row,
              can_dashboard: value,
              can_territoire: value,
              can_cartographie: value,
              can_clients: value,
              can_carte: value,
              can_todo: value,
              can_clients_cegeclim: value,
              can_suivi_prospects: value,
              can_agences: value,
              can_autorisation: value,
              can_documents: value,
              can_stocks: value,
              can_activites: value,
              can_change_scope: value,

            }
          : row
      )
    )
  }

  function setAllForNewRow(value: boolean) {
    setNewRow((prev) => ({
      ...prev,
      can_dashboard: value,
      can_territoire: value,
      can_cartographie: value,
      can_clients: value,
      can_carte: value,
      can_todo: value,
      can_clients_cegeclim: value,
      can_suivi_prospects: value,
      can_agences: value,
      can_autorisation: value,
      can_documents: value,
      can_stocks: value,
      can_activites: value,
      can_change_scope: value,
    }))
  }

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((row) => row.email.includes(term))
  }, [rows, search])

  const selectedDeptUser = useMemo(() => {
    return filteredRows.find((row) => row.email === selectedDeptUserEmail)
      || rows.find((row) => row.email === selectedDeptUserEmail)
      || null
  }, [filteredRows, rows, selectedDeptUserEmail])

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="w-full px-4 xl:px-6 2xl:px-8">
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                Gestion des autorisations
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Gestion des pages, scopes autorisés, agences autorisées, départements visibles et page d’ouverture après login.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher par email"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm outline-none transition focus:border-slate-500"
              />

              <button
                onClick={loadData}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
              >
                Rafraîchir
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl bg-slate-100 p-4">
              <div className="text-sm text-slate-500">Nombre total</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">{rows.length}</div>
            </div>

            <div className="rounded-xl bg-slate-100 p-4">
              <div className="text-sm text-slate-500">Résultats affichés</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">
                {filteredRows.length}
              </div>
            </div>

            <div className="rounded-xl bg-slate-100 p-4">
              <div className="text-sm text-slate-500">Droits pilotés</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">14</div>
            </div>
          </div>

          {message && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {message}
            </div>
          )}

          {errorMessage && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            Créer une ligne d’accès
          </h2>

          <div className="mt-4 grid grid-cols-1 gap-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
              <input
                type="email"
                value={newRow.email}
                onChange={(e) =>
                  setNewRow((prev) => ({
                    ...prev,
                    email: e.target.value.toLowerCase().trim(),
                  }))
                }
                placeholder="email@exemple.com"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
              />

              <input
                type="text"
                value={newRow.display_name}
                onChange={(e) =>
                  setNewRow((prev) => ({
                    ...prev,
                    display_name: e.target.value,
                  }))
                }
                placeholder="Nom affiché"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
              <CreateCheckbox label="Indicateurs" checked={newRow.can_dashboard} onChange={(checked) => updateNewRowValue('can_dashboard', checked)} />
              <CreateCheckbox label="Territoire" checked={newRow.can_territoire} onChange={(checked) => updateNewRowValue('can_territoire', checked)} />
              <CreateCheckbox label="Cartographie" checked={newRow.can_cartographie} onChange={(checked) => updateNewRowValue('can_cartographie', checked)} />
              <CreateCheckbox label="Liste globale" checked={newRow.can_clients} onChange={(checked) => updateNewRowValue('can_clients', checked)} />
              <CreateCheckbox label="Agences" checked={newRow.can_agences} onChange={(checked) => updateNewRowValue('can_agences', checked)} />
              <CreateCheckbox label="Carte" checked={newRow.can_carte} onChange={(checked) => updateNewRowValue('can_carte', checked)} />
              <CreateCheckbox label="Todo" checked={newRow.can_todo} onChange={(checked) => updateNewRowValue('can_todo', checked)} />
              <CreateCheckbox label="Clients Cegeclim" checked={newRow.can_clients_cegeclim} onChange={(checked) => updateNewRowValue('can_clients_cegeclim', checked)} />
              <CreateCheckbox label="Suivi Prospects" checked={newRow.can_suivi_prospects} onChange={(checked) => updateNewRowValue('can_suivi_prospects', checked)} />
              <CreateCheckbox label="Autorisation" checked={newRow.can_autorisation} onChange={(checked) => updateNewRowValue('can_autorisation', checked)} />
              <CreateCheckbox label="Documents" checked={newRow.can_documents} onChange={(checked) => updateNewRowValue('can_documents', checked)} />
              <CreateCheckbox label="Stocks" checked={newRow.can_stocks} onChange={(checked) => updateNewRowValue('can_stocks', checked)} />
              <CreateCheckbox label="Activités" checked={newRow.can_activites} onChange={(checked) => updateNewRowValue('can_activites', checked)} />
              <CreateCheckbox label="Change scope" checked={newRow.can_change_scope} onChange={(checked) => updateNewRowValue('can_change_scope', checked)} />
            </div>

            <input
              type="text"
              value={newRow.allowed_scopes.join(', ')}
              onChange={(e) => updateNewRowAllowedScopes(e.target.value)}
              placeholder="Global, Cegeclim, CVC"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
            />

            <input
              type="text"
              value={(newRow.allowed_agences ?? []).join(', ')}
              onChange={(e) => updateNewRowAllowedAgences(e.target.value)}
              placeholder="Agences autorisées séparées par des virgules"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
            />

            <input
              type="text"
              value={(newRow.allowed_codes_postaux ?? []).join(', ')}
              onChange={(e) => updateNewRowAllowedCodesPostaux(e.target.value)}
              placeholder="Codes postaux autorisés séparés par des virgules (prioritaires sur les départements)"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
            />

            <select
              value={newRow.default_landing_page}
              onChange={(e) => updateNewRowDefaultLandingPage(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
            >
              <option value="/accueil">/accueil</option>
              <option value="/dashboard">/dashboard</option>
              <option value="/territoire">/territoire</option>
              <option value="/cartographie">/cartographie</option>
              <option value="/clients">/clients</option>
              <option value="/carte">/carte</option>
              <option value="/agences">/agences</option>
              <option value="/todo">/todo</option>
              <option value="/suivi_prospects">/suivi_prospects</option>
              <option value="/documents">/documents</option>
              <option value="/stocks">/stocks</option>
              <option value="/activites">/activites</option>
              <option value="/autorisation">/autorisation</option>
            </select>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Les codes postaux autorisés, s’ils sont renseignés, seront prioritaires sur les départements dans la page Carte.
              </div>
              <div className="mb-2 text-sm font-semibold text-slate-800">
                Départements visibles
              </div>
              <div className="mb-3 text-xs text-slate-500">
                Si aucun département n’est sélectionné, tous les départements seront visibles.
              </div>

              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setNewRow((prev) => ({ ...prev, allowed_departements: [] }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-white"
                >
                  Tous visibles
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setNewRow((prev) => ({
                      ...prev,
                      allowed_departements: [...ALL_DEPARTEMENTS],
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-white"
                >
                  Tout masquer
                </button>
              </div>

              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 xl:grid-cols-16">
                {ALL_DEPARTEMENTS.map((dep) => {
                  const checked = newRow.allowed_departements.length === 0
                    ? true
                    : newRow.allowed_departements.includes(dep)

                  return (
                    <label
                      key={dep}
                      className={`flex items-center justify-center rounded-lg border px-2 py-2 text-xs font-medium ${
                        checked
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-300 bg-white text-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={checked}
                        onChange={() => {
                          const current =
                            newRow.allowed_departements.length === 0
                              ? [...ALL_DEPARTEMENTS]
                              : [...newRow.allowed_departements]

                          const next = current.includes(dep)
                            ? current.filter((d) => d !== dep)
                            : [...current, dep].sort((a, b) => a.localeCompare(b, 'fr'))

                          setNewRow((prev) => ({
                            ...prev,
                            allowed_departements: next.length === ALL_DEPARTEMENTS.length ? [...ALL_DEPARTEMENTS] : next,
                          }))
                        }}
                      />
                      {dep}
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setAllForNewRow(true)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Tout cocher
              </button>

              <button
                onClick={() => setAllForNewRow(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Tout décocher
              </button>

              <button
                onClick={createRow}
                disabled={creating}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? 'Création...' : 'Créer la ligne'}
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-max min-w-full table-auto border-collapse">
              <thead className="bg-slate-100">
                <tr>
                  <th className="sticky left-0 z-30 min-w-[280px] whitespace-nowrap border-r border-slate-200 bg-slate-100 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Utilisateur
                  </th>
                  <th className="sticky left-[280px] z-30 min-w-[220px] whitespace-nowrap border-r border-slate-200 bg-slate-100 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Nom
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    KPI
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Territoire
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Carto
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Clients
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Carte
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Todo
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Cegeclim
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Prospects
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Agences
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Auto
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Documents
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Stocks
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Activités
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Scope
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Allowed scopes
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Allowed agences
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Écran d'ouverture
                  </th>
                  <th className="min-w-[290px] whitespace-nowrap px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={20} className="px-4 py-10 text-center text-sm text-slate-500">
                      Chargement des autorisations...
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={20} className="px-4 py-10 text-center text-sm text-slate-500">
                      Aucun utilisateur trouvé.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={row.email} className="border-t border-slate-200 hover:bg-slate-50/80">
                      <td className="sticky left-0 z-20 whitespace-nowrap border-r border-slate-200 bg-white px-3 py-2 align-top">
                        <div className="min-w-fit text-sm font-medium leading-5 text-slate-900">
                          {row.email}
                        </div>
                      </td>
                      <td className="sticky left-[280px] z-20 border-r border-slate-200 bg-white px-3 py-2 align-top">
                        <input
                          type="text"
                          value={row.display_name || ''}
                          onChange={(e) => updateDisplayName(row.email, e.target.value)}
                          className="w-52 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500"
                        />
                      </td>
                      <PermissionCell checked={row.can_dashboard} onChange={(checked) => updateLocalValue(row.email, 'can_dashboard', checked)} />
                      <PermissionCell checked={row.can_territoire} onChange={(checked) => updateLocalValue(row.email, 'can_territoire', checked)} />
                      <PermissionCell checked={row.can_cartographie} onChange={(checked) => updateLocalValue(row.email, 'can_cartographie', checked)} />
                      <PermissionCell checked={row.can_clients} onChange={(checked) => updateLocalValue(row.email, 'can_clients', checked)} />
                      <PermissionCell checked={row.can_carte} onChange={(checked) => updateLocalValue(row.email, 'can_carte', checked)} />
                      <PermissionCell checked={row.can_todo} onChange={(checked) => updateLocalValue(row.email, 'can_todo', checked)} />
                      <PermissionCell checked={row.can_clients_cegeclim} onChange={(checked) => updateLocalValue(row.email, 'can_clients_cegeclim', checked)} />
                      <PermissionCell checked={row.can_suivi_prospects} onChange={(checked) => updateLocalValue(row.email, 'can_suivi_prospects', checked)} />      
                      <PermissionCell checked={row.can_agences} onChange={(checked) => updateLocalValue(row.email, 'can_agences', checked)} />
                      <PermissionCell checked={row.can_autorisation} onChange={(checked) => updateLocalValue(row.email, 'can_autorisation', checked)} />
                      <PermissionCell checked={row.can_documents} onChange={(checked) => updateLocalValue(row.email, 'can_documents', checked)} />
                      <PermissionCell checked={row.can_stocks} onChange={(checked) => updateLocalValue(row.email, 'can_stocks', checked)} />
                      <PermissionCell checked={row.can_activites} onChange={(checked) => updateLocalValue(row.email, 'can_activites', checked)} />
                      <PermissionCell checked={row.can_change_scope} onChange={(checked) => updateLocalValue(row.email, 'can_change_scope', checked)} />

                      <td className="px-4 py-4 align-top">
                        <input
                          type="text"
                          value={row.allowed_scopes.join(', ')}
                          onChange={(e) => updateAllowedScopes(row.email, e.target.value)}
                          className="w-52 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500"
                        />
                      </td>

                      <td className="px-4 py-4 align-top">
                        <input
                          type="text"
                          value={(row.allowed_agences ?? []).join(', ')}
                          onChange={(e) => updateAllowedAgences(row.email, e.target.value)}
                          className="w-52 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500"
                          placeholder="Toutes si vide"
                        />
                      </td>

                      <td className="px-4 py-4 align-top">
                        <select
                          value={row.default_landing_page || '/accueil'}
                          onChange={(e) => updateDefaultLandingPage(row.email, e.target.value)}
                          className="w-44 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500"
                        >
                          <option value="/accueil">/accueil</option>
                          <option value="/dashboard">/dashboard</option>
                          <option value="/territoire">/territoire</option>
                          <option value="/cartographie">/cartographie</option>
                          <option value="/clients">/clients</option>
                          <option value="/carte">/carte</option>
                          <option value="/agences">/agences</option>
                          <option value="/todo">/todo</option>
                          <option value="/suivi_prospects">/suivi_prospects</option>
                          <option value="/documents">/documents</option>
                          <option value="/stocks">/stocks</option>
                          <option value="/activites">/activites</option>
                          <option value="/autorisation">/autorisation</option>
                        </select>
                      </td>

                      <td className="min-w-[290px] px-3 py-2 align-top">
                        <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedDeptUserEmail(row.email)}
                            className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${
                              selectedDeptUserEmail === row.email
                                ? 'bg-blue-600 text-white'
                                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            Départements
                          </button>

                          <button
                            onClick={() => setAllForRow(row.email, true)}
                            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 transition hover:bg-slate-100"
                          >
                            Tout cocher
                          </button>

                          <button
                            onClick={() => setAllForRow(row.email, false)}
                            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 transition hover:bg-slate-100"
                          >
                            Tout décocher
                          </button>

                          <button
                            onClick={() => saveRow(row)}
                            disabled={savingEmail === row.email}
                            className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {savingEmail === row.email ? 'Enregistrement...' : 'Enregistrer'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Départements visibles par utilisateur
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Si un département est décoché, les sociétés dont l’adresse est dans ce département ne seront pas visibles.
                Si aucun département n’est restreint, alors tous les départements restent visibles.
              </p>
            </div>

            <select
              value={selectedDeptUserEmail || ''}
              onChange={(e) => setSelectedDeptUserEmail(e.target.value)}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-slate-500"
            >
              {rows.map((row) => (
                <option key={row.email} value={row.email}>
                  {row.email}
                </option>
              ))}
            </select>
          </div>

          {selectedDeptUser ? (
            <div className="mt-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-800">
                  Utilisateur : {selectedDeptUser.email}
                </div>

                <button
                  type="button"
                  onClick={() => allowAllDepartementsForUser(selectedDeptUser.email)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Tous visibles
                </button>

                <button
                  type="button"
                  onClick={() => denyAllDepartementsForUser(selectedDeptUser.email)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Tout masquer
                </button>

                <button
                  type="button"
                  onClick={() => saveRow(selectedDeptUser)}
                  disabled={savingEmail === selectedDeptUser.email}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingEmail === selectedDeptUser.email ? 'Enregistrement...' : 'Enregistrer les départements'}
                </button>
              </div>

              <div className="mb-4">
                <label className="mb-2 block text-sm font-semibold text-slate-800">
                  Codes postaux autorisés
                </label>
                <input
                  type="text"
                  value={(selectedDeptUser.allowed_codes_postaux ?? []).join(', ')}
                  onChange={(e) => updateAllowedCodesPostaux(selectedDeptUser.email, e.target.value)}
                  placeholder="Ex : 75001, 75008, 85100"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Si au moins un code postal est renseigné, il devient prioritaire sur les départements pour la page Carte.
                </p>
              </div>

              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 xl:grid-cols-16">
                {ALL_DEPARTEMENTS.map((dep) => {
                  const checked =
                    selectedDeptUser.allowed_departements.length === 0
                      ? true
                      : selectedDeptUser.allowed_departements.includes(dep)

                  return (
                    <label
                      key={dep}
                      className={`flex cursor-pointer items-center justify-center rounded-lg border px-2 py-2 text-xs font-medium ${
                        checked
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-300 bg-white text-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={checked}
                        onChange={() => toggleDepartementForUser(selectedDeptUser.email, dep)}
                      />
                      {dep}
                    </label>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="mt-4 text-sm text-slate-500">
              Aucun utilisateur sélectionné.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PermissionCell({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <td className="px-3 py-2 text-center align-middle">
      <label className="inline-flex cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
      </label>
    </td>
  )
}

function CreateCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300"
      />
      <span>{label}</span>
    </label>
  )
}