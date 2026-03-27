'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type UserPageAccess = {
  email: string
  can_dashboard: boolean
  can_territoire: boolean
  can_cartographie: boolean
  can_clients: boolean
  can_agences: boolean
  can_autorisation: boolean
  can_parametrage: boolean
  can_stocks: boolean
  can_activites: boolean
  can_change_scope: boolean
  allowed_scopes: string[]
}

const EMPTY_MESSAGE = ''

const defaultNewRow: UserPageAccess = {
  email: '',
  can_dashboard: false,
  can_territoire: false,
  can_cartographie: false,
  can_clients: false,
  can_agences: false,
  can_autorisation: false,
  can_parametrage: false,
  can_stocks: false,
  can_activites: false,
  can_change_scope: false,
  allowed_scopes: ['Global'],
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
        can_agences,
        can_autorisation,
        can_parametrage,
        can_stocks,
        can_activites,
        can_change_scope,
        allowed_scopes
      `)
      .order('email', { ascending: true })

    if (error) {
      setErrorMessage(`Erreur lors du chargement : ${error.message}`)
      setRows([])
      setLoading(false)
      return
    }

    setRows(
      (data || []).map((item) => ({
        email: String(item.email || '').toLowerCase().trim(),
        can_dashboard: !!item.can_dashboard,
        can_territoire: !!item.can_territoire,
        can_cartographie: !!item.can_cartographie,
        can_clients: !!item.can_clients,
        can_agences: !!item.can_agences,
        can_autorisation: !!item.can_autorisation,
        can_parametrage: !!item.can_parametrage,
        can_stocks: !!item.can_stocks,
        can_activites: !!item.can_activites,
        can_change_scope: !!item.can_change_scope,
        allowed_scopes:
          Array.isArray(item.allowed_scopes) && item.allowed_scopes.length > 0
            ? item.allowed_scopes
            : ['Global'],
      }))
    )

    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  function updateLocalValue(
    email: string,
    field: keyof Omit<UserPageAccess, 'email' | 'allowed_scopes'>,
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

  function updateNewRowValue(
    field: keyof Omit<UserPageAccess, 'email' | 'allowed_scopes'>,
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
        can_agences: row.can_agences,
        can_autorisation: row.can_autorisation,
        can_parametrage: row.can_parametrage,
        can_stocks: row.can_stocks,
        can_activites: row.can_activites,
        can_change_scope: row.can_change_scope,
        allowed_scopes: row.allowed_scopes,
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
      can_agences: newRow.can_agences,
      can_autorisation: newRow.can_autorisation,
      can_parametrage: newRow.can_parametrage,
      can_stocks: newRow.can_stocks,
      can_activites: newRow.can_activites,
      can_change_scope: newRow.can_change_scope,
      allowed_scopes: newRow.allowed_scopes,
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
              can_agences: value,
              can_autorisation: value,
              can_parametrage: value,
              can_stocks: value,
              can_activites: value,
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
      can_agences: value,
      can_autorisation: value,
      can_parametrage: value,
      can_stocks: value,
      can_activites: value,
    }))
  }

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((row) => row.email.includes(term))
  }, [rows, search])

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                Gestion des autorisations
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Lecture, création et mise à jour des droits par email.
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
              <div className="mt-1 text-2xl font-bold text-slate-900">10</div>
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

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <CreateCheckbox
                label="Dashboard"
                checked={newRow.can_dashboard}
                onChange={(checked) => updateNewRowValue('can_dashboard', checked)}
              />
              <CreateCheckbox
                label="Territoire"
                checked={newRow.can_territoire}
                onChange={(checked) => updateNewRowValue('can_territoire', checked)}
              />
              <CreateCheckbox
                label="Cartographie"
                checked={newRow.can_cartographie}
                onChange={(checked) => updateNewRowValue('can_cartographie', checked)}
              />
              <CreateCheckbox
                label="Clients"
                checked={newRow.can_clients}
                onChange={(checked) => updateNewRowValue('can_clients', checked)}
              />
              <CreateCheckbox
                label="Agences"
                checked={newRow.can_agences}
                onChange={(checked) => updateNewRowValue('can_agences', checked)}
              />
              <CreateCheckbox
                label="Autorisation"
                checked={newRow.can_autorisation}
                onChange={(checked) => updateNewRowValue('can_autorisation', checked)}
              />
              <CreateCheckbox
                label="Paramétrage"
                checked={newRow.can_parametrage}
                onChange={(checked) => updateNewRowValue('can_parametrage', checked)}
              />
              <CreateCheckbox
                label="Stocks"
                checked={newRow.can_stocks}
                onChange={(checked) => updateNewRowValue('can_stocks', checked)}
              />
              <CreateCheckbox
                label="Activités"
                checked={newRow.can_activites}
                onChange={(checked) => updateNewRowValue('can_activites', checked)}
              />
              <CreateCheckbox
                label="Change scope"
                checked={newRow.can_change_scope}
                onChange={(checked) => updateNewRowValue('can_change_scope', checked)}
              />
            </div>

            <input
              type="text"
              value={newRow.allowed_scopes.join(', ')}
              onChange={(e) => updateNewRowAllowedScopes(e.target.value)}
              placeholder="Global, Cegeclim, CVC"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500"
            />

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

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Utilisateur
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Dash
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
                    Agences
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Auto
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Param
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
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={13} className="px-4 py-10 text-center text-sm text-slate-500">
                      Chargement des autorisations...
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="px-4 py-10 text-center text-sm text-slate-500">
                      Aucun utilisateur trouvé.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={row.email} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-4 align-top">
                        <div className="max-w-[280px] break-all text-sm font-medium text-slate-900">
                          {row.email}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Clé d’accès utilisée
                        </div>
                      </td>

                      <PermissionCell checked={row.can_dashboard} onChange={(checked) => updateLocalValue(row.email, 'can_dashboard', checked)} />
                      <PermissionCell checked={row.can_territoire} onChange={(checked) => updateLocalValue(row.email, 'can_territoire', checked)} />
                      <PermissionCell checked={row.can_cartographie} onChange={(checked) => updateLocalValue(row.email, 'can_cartographie', checked)} />
                      <PermissionCell checked={row.can_clients} onChange={(checked) => updateLocalValue(row.email, 'can_clients', checked)} />
                      <PermissionCell checked={row.can_agences} onChange={(checked) => updateLocalValue(row.email, 'can_agences', checked)} />
                      <PermissionCell checked={row.can_autorisation} onChange={(checked) => updateLocalValue(row.email, 'can_autorisation', checked)} />
                      <PermissionCell checked={row.can_parametrage} onChange={(checked) => updateLocalValue(row.email, 'can_parametrage', checked)} />
                      <PermissionCell checked={row.can_stocks} onChange={(checked) => updateLocalValue(row.email, 'can_stocks', checked)} />
                      <PermissionCell checked={row.can_activites} onChange={(checked) => updateLocalValue(row.email, 'can_activites', checked)} />
                      <PermissionCell checked={row.can_change_scope} onChange={(checked) => updateLocalValue(row.email, 'can_change_scope', checked)} />

                      <td className="px-4 py-4 align-top">
                        <input
                          type="text"
                          value={row.allowed_scopes.join(', ')}
                          onChange={(e) => updateAllowedScopes(row.email, e.target.value)}
                          className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                        />
                      </td>

                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => setAllForRow(row.email, true)}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                          >
                            Tout cocher
                          </button>

                          <button
                            onClick={() => setAllForRow(row.email, false)}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                          >
                            Tout décocher
                          </button>

                          <button
                            onClick={() => saveRow(row)}
                            disabled={savingEmail === row.email}
                            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
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
    <td className="px-4 py-4 text-center align-middle">
      <label className="inline-flex cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-5 w-5 rounded border-slate-300"
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
    <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
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