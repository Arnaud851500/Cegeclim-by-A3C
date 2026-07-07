'use client'

import { useEffect, useMemo, useState } from 'react'

type SchedulerJob = {
  id?: string
  job_key: string
  job_label: string
  job_type: string
  enabled: boolean
  frequency: string
  timezone: string
  scheduled_hour: number | null
  scheduled_minute: number | null
  scheduled_weekdays?: number[]
  scheduled_month_day?: number | null
  config_json: any
  max_iterations: number
  max_runtime_seconds: number
  allow_overlap: boolean
  continue_on_error: boolean
  last_run_at?: string | null
  next_run_at?: string | null
  last_status?: string | null
}

type SchedulerRun = {
  id: string
  job_id: string
  job_key: string
  job_type: string
  status: string
  trigger_source: string
  message?: string | null
  error_message?: string | null
  created_at: string
  started_at?: string | null
  finished_at?: string | null
  result_json?: any
}

type SchedulerLog = {
  id: string
  scheduler_run_id: string
  level: string
  message: string
  payload_json: any
  created_at: string
}

const emptyClientMaintenanceConfig = {
  sirene: true,
  cessations: true,
  rge: true,
  capacite: true,
  enrichment: false,
  sireneDates: {
    creation: { mode: 'relative_range', fromOffsetDays: 1, toOffsetDays: 1 },
    cessation: { mode: 'relative_range', fromOffsetDays: 1, toOffsetDays: 1 },
  },
}

const defaultAggregatePeriod = { mode: 'relative_months', months: 2, includeCurrentMonth: true }

const quickAggregateJobs = [
  {
    job_key: 'recompute_activity_aggregates_daily',
    job_label: 'Recalcul agrégats activité',
    routePath: '/api/admin/maintenance/recompute-activity-aggregates',
  },
  {
    job_key: 'recompute_invoice_aggregates_daily',
    job_label: 'Recalcul agrégats factures',
    routePath: '/api/admin/maintenance/recompute-invoice-aggregates',
  },
  {
    job_key: 'recompute_quote_aggregates_daily',
    job_label: 'Recalcul agrégats devis',
    routePath: '/api/admin/maintenance/recompute-quote-aggregates',
  },
  {
    job_key: 'rebuild_flux_articles_daily',
    job_label: 'Rebuild flux articles',
    routePath: '/api/admin/maintenance/rebuild-flux-articles',
  },
  {
    job_key: 'refresh_smc_daily',
    job_label: 'Mise à jour SMC quotidienne',
    routePath: '/api/admin/maintenance/refresh-smc',
  },
] as const

function newJob(): SchedulerJob {
  return {
    job_key: `job_${Date.now()}`,
    job_label: 'Nouveau traitement',
    job_type: 'client_maintenance',
    enabled: false,
    frequency: 'daily',
    timezone: 'Europe/Paris',
    scheduled_hour: 6,
    scheduled_minute: 30,
    scheduled_weekdays: [],
    scheduled_month_day: 1,
    config_json: emptyClientMaintenanceConfig,
    max_iterations: 20,
    max_runtime_seconds: 600,
    allow_overlap: false,
    continue_on_error: true,
  }
}

function newAggregateJob(template: typeof quickAggregateJobs[number]): SchedulerJob {
  return {
    job_key: template.job_key,
    job_label: template.job_label,
    job_type: 'http_route',
    enabled: false,
    frequency: 'daily',
    timezone: 'Europe/Paris',
    scheduled_hour: 6,
    scheduled_minute: 30,
    scheduled_weekdays: [],
    scheduled_month_day: 1,
    config_json: {
      routePath: template.routePath,
      method: 'POST',
      body: {},
      period: defaultAggregatePeriod,
    },
    max_iterations: 20,
    max_runtime_seconds: 600,
    allow_overlap: false,
    continue_on_error: true,
  }
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
  } catch {
    return value
  }
}

function statusClass(status?: string | null) {
  if (status === 'done' || status === 'success') return 'status done'
  if (status === 'running') return 'status running'
  if (status === 'queued') return 'status queued'
  if (status === 'partial') return 'status partial'
  if (status === 'error') return 'status error'
  if (status === 'cancelled') return 'status cancelled'
  return 'status'
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function setNestedConfig(job: SchedulerJob, path: string[], value: any): SchedulerJob {
  const next = clone(job)
  let cursor = next.config_json || {}
  next.config_json = cursor

  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]
    cursor[key] = cursor[key] || {}
    cursor = cursor[key]
  }

  cursor[path[path.length - 1]] = value
  return next
}

function isAggregateJob(job: SchedulerJob | null) {
  if (!job || job.job_type !== 'http_route') return false
  const key = `${job.job_key || ''} ${job.job_label || ''} ${job.config_json?.routePath || ''}`.toLowerCase()

  return (
    key.includes('agregat') ||
    key.includes('agrégat') ||
    key.includes('aggregate') ||
    key.includes('recompute') ||
    key.includes('flux') ||
    key.includes('smc')
  )
}

function safeJson(value: any) {
  try {
    if (typeof value === 'string') return JSON.parse(value || '{}')
    return value || {}
  } catch {
    return {}
  }
}

function SireneDateEditor({
  title,
  value,
  onChange,
}: {
  title: string
  value: any
  onChange: (value: any) => void
}) {
  const mode = value?.mode || 'params'

  return (
    <div className="dateBox">
      <h4>{title}</h4>
      <label>
        Mode de dates
        <select value={mode} onChange={(e) => onChange({ ...value, mode: e.target.value })}>
          <option value="params">Utiliser import_sirene_params</option>
          <option value="today">Date du jour</option>
          <option value="relative_single">Date du jour - X</option>
          <option value="relative_range">Plage relative J-X à J-Y</option>
          <option value="fixed_range">Plage fixe</option>
        </select>
      </label>

      {mode === 'relative_single' && (
        <label>
          X jours
          <input
            type="number"
            value={value?.offsetDays ?? 1}
            min={0}
            onChange={(e) => onChange({ ...value, offsetDays: Number(e.target.value) })}
          />
        </label>
      )}

      {mode === 'relative_range' && (
        <div className="twoCols">
          <label>
            De J -
            <input
              type="number"
              value={value?.fromOffsetDays ?? 1}
              min={0}
              onChange={(e) => onChange({ ...value, fromOffsetDays: Number(e.target.value) })}
            />
          </label>
          <label>
            À J -
            <input
              type="number"
              value={value?.toOffsetDays ?? 1}
              min={0}
              onChange={(e) => onChange({ ...value, toOffsetDays: Number(e.target.value) })}
            />
          </label>
        </div>
      )}

      {mode === 'fixed_range' && (
        <div className="twoCols">
          <label>
            Du
            <input
              type="date"
              value={value?.fromDate || ''}
              onChange={(e) => onChange({ ...value, fromDate: e.target.value })}
            />
          </label>
          <label>
            Au
            <input
              type="date"
              value={value?.toDate || ''}
              onChange={(e) => onChange({ ...value, toDate: e.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  )
}

function AggregatePeriodEditor({
  value,
  onChange,
}: {
  value: any
  onChange: (value: any) => void
}) {
  const mode = value?.mode || 'relative_months'

  return (
    <div className="dateBox aggregatePeriod">
      <h4>Période de mise à jour des agrégats</h4>

      <label>
        Mode de période
        <select value={mode} onChange={(e) => onChange({ ...value, mode: e.target.value })}>
          <option value="relative_months">X derniers mois</option>
          <option value="relative_days">X derniers jours</option>
          <option value="current_month">Mois courant</option>
          <option value="previous_month">Mois précédent</option>
          <option value="fixed_range">Plage fixe</option>
        </select>
      </label>

      {mode === 'relative_months' && (
        <div className="twoCols">
          <label>
            Nombre de mois
            <input
              type="number"
              min={1}
              max={24}
              value={value?.months ?? 2}
              onChange={(e) => onChange({ ...value, months: Number(e.target.value) })}
            />
          </label>
          <label>
            Inclure le mois courant
            <select
              value={value?.includeCurrentMonth === false ? 'false' : 'true'}
              onChange={(e) => onChange({ ...value, includeCurrentMonth: e.target.value === 'true' })}
            >
              <option value="true">Oui</option>
              <option value="false">Non</option>
            </select>
          </label>
        </div>
      )}

      {mode === 'relative_days' && (
        <label>
          Nombre de jours
          <input
            type="number"
            min={1}
            max={365}
            value={value?.days ?? 1}
            onChange={(e) => onChange({ ...value, days: Number(e.target.value) })}
          />
        </label>
      )}

      {mode === 'fixed_range' && (
        <div className="twoCols">
          <label>
            Du
            <input
              type="date"
              value={value?.fromDate || ''}
              onChange={(e) => onChange({ ...value, fromDate: e.target.value })}
            />
          </label>
          <label>
            Au
            <input
              type="date"
              value={value?.toDate || ''}
              onChange={(e) => onChange({ ...value, toDate: e.target.value })}
            />
          </label>
        </div>
      )}

      <p className="helpText">
        Cette période est stockée dans <code>config_json.period</code>. Le worker doit la résoudre au moment de
        l’exécution pour alimenter <code>date_debut</code>, <code>date_fin</code>, <code>p_date_debut</code> et{' '}
        <code>p_date_fin</code>.
      </p>
    </div>
  )
}

function WeekdaySelector({
  value,
  onChange,
}: {
  value: number[]
  onChange: (value: number[]) => void
}) {
  const days = [
    { value: 1, label: 'Lun' },
    { value: 2, label: 'Mar' },
    { value: 3, label: 'Mer' },
    { value: 4, label: 'Jeu' },
    { value: 5, label: 'Ven' },
    { value: 6, label: 'Sam' },
    { value: 0, label: 'Dim' },
  ]

  function toggle(day: number) {
    if (value.includes(day)) onChange(value.filter((v) => v !== day))
    else onChange([...value, day])
  }

  return (
    <div className="weekdayBox">
      <div className="weekdayActions">
        <button type="button" onClick={() => onChange([1, 2, 3, 4, 5])}>Ouvrés</button>
        <button type="button" onClick={() => onChange([1, 2, 3, 4, 5, 6, 0])}>Tous</button>
        <button type="button" onClick={() => onChange([])}>Aucun</button>
      </div>
      <div className="weekdayList">
        {days.map((day) => (
          <label key={day.value} className="check miniCheck">
            <input type="checkbox" checked={value.includes(day.value)} onChange={() => toggle(day.value)} />
            {day.label}
          </label>
        ))}
      </div>
      <p className="helpText">Si aucun jour n’est coché, le job n’est pas limité par jour.</p>
    </div>
  )
}

export default function PlanificationTraitementsPage() {
  const [jobs, setJobs] = useState<SchedulerJob[]>([])
  const [runs, setRuns] = useState<SchedulerRun[]>([])
  const [logs, setLogs] = useState<SchedulerLog[]>([])
  const [selected, setSelected] = useState<SchedulerJob | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const stats = useMemo(() => {
    return {
      activeJobs: jobs.filter((j) => j.enabled).length,
      runningRuns: runs.filter((r) => r.status === 'running').length,
      errors: runs.filter((r) => r.status === 'error').length,
      partials: runs.filter((r) => r.status === 'partial').length,
      nextRun: jobs
        .filter((j) => j.enabled && j.next_run_at)
        .sort((a, b) => String(a.next_run_at).localeCompare(String(b.next_run_at)))[0]?.next_run_at,
    }
  }, [jobs, runs])

  async function refresh() {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/admin/scheduler/jobs', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || json.success === false) throw new Error(json.error || 'Erreur chargement scheduler')

      const nextJobs = json.jobs || []
      setJobs(nextJobs)
      setRuns(json.runs || [])
      setLogs(json.logs || [])

      if (!selected && nextJobs?.[0]) {
        setSelected(nextJobs[0])
      } else if (selected?.id) {
        const refreshedSelected = nextJobs.find((job: SchedulerJob) => job.id === selected.id)
        if (refreshedSelected) setSelected(refreshedSelected)
      }
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 15000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function saveJob() {
    if (!selected) return
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      const normalized = { ...selected, config_json: safeJson(selected.config_json) }

      const res = await fetch('/api/admin/scheduler/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: normalized }),
      })
      const json = await res.json()
      if (!res.ok || json.success === false) throw new Error(json.error || 'Erreur sauvegarde')

      setSelected(json.job)
      setMessage('Traitement sauvegardé.')
      await refresh()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  async function runNow(job: SchedulerJob) {
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      const res = await fetch('/api/admin/scheduler/run-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.id, job_key: job.job_key }),
      })
      const json = await res.json()
      if (!res.ok || json.success === false) throw new Error(json.error || 'Erreur lancement')

      setMessage('Traitement lancé. Le monitoring se mettra à jour automatiquement.')
      await refresh()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  async function deleteJob(job: SchedulerJob) {
    if (!job.id) {
      setJobs((current) => current.filter((j) => j.job_key !== job.job_key))
      if (selected?.job_key === job.job_key) setSelected(null)
      setMessage('Job non sauvegardé retiré de l’écran.')
      return
    }

    const confirmed = window.confirm(
      `Supprimer ce traitement ?\n\n${job.job_label}\n${job.job_key}\n\n` +
        `Le job sera archivé, désactivé et retiré de la liste. L’historique des runs sera conservé.`
    )

    if (!confirmed) return

    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      const res = await fetch('/api/admin/scheduler/jobs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: job.id,
          job_key: job.job_key,
          reason: 'Suppression utilisateur depuis écran planification',
        }),
      })

      const json = await res.json().catch(() => null)

      if (!res.ok || json?.success === false) {
        throw new Error(json?.error || 'Erreur suppression job')
      }

      setJobs((current) => current.filter((j) => j.id !== job.id))
      if (selected?.id === job.id) setSelected(null)

      setMessage('Job archivé, désactivé et retiré de la liste.')
      await refresh()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const config = selected?.config_json || {}
  const sireneDates = config.sireneDates || {}
  const selectedIsAggregateJob = isAggregateJob(selected)

  return (
    <div className="page">
      <div className="header">
        <div>
          <h1>Planification des traitements</h1>
          <p>Orchestration des mises à jour clients, recalculs d’agrégats, SMC et envois de documents.</p>
        </div>
        <button onClick={refresh} disabled={loading}>Actualiser</button>
      </div>

      {message && <div className="alert ok">{message}</div>}
      {error && <div className="alert ko">{error}</div>}

      <div className="cards">
        <div className="card"><span>Traitements actifs</span><strong>{stats.activeJobs}</strong></div>
        <div className="card"><span>Runs en cours</span><strong>{stats.runningRuns}</strong></div>
        <div className="card"><span>Runs partiels</span><strong>{stats.partials}</strong></div>
        <div className="card"><span>Erreurs récentes</span><strong>{stats.errors}</strong></div>
        <div className="card wide"><span>Prochaine exécution</span><strong>{formatDate(stats.nextRun)}</strong></div>
      </div>

      <div className="layout">
        <section className="panel listPanel">
          <div className="sectionHeader">
            <h2>Traitements</h2>
            <button onClick={() => setSelected(newJob())}>Nouveau</button>
          </div>

          <div className="quickJobs">
            <strong>Ajouter rapidement un job d’agrégat</strong>
            <div className="quickJobButtons">
              {quickAggregateJobs.map((template) => (
                <button key={template.job_key} type="button" onClick={() => setSelected(newAggregateJob(template))}>
                  {template.job_label}
                </button>
              ))}
            </div>
            <p>Les routes proposées sont des modèles : adapte le chemin API si ta route réelle porte un autre nom.</p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Traitement</th>
                <th>Activé</th>
                <th>Fréquence</th>
                <th>Dernier statut</th>
                <th>Prochain passage</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id || job.job_key} className={selected?.id === job.id ? 'selected' : ''}>
                  <td>
                    <button className="linkButton" onClick={() => setSelected(clone(job))}>
                      <strong>{job.job_label}</strong>
                      <small>{job.job_key}</small>
                    </button>
                  </td>
                  <td>{job.enabled ? 'Oui' : 'Non'}</td>
                  <td>{job.frequency}</td>
                  <td><span className={statusClass(job.last_status)}>{job.last_status || '—'}</span></td>
                  <td>{formatDate(job.next_run_at)}</td>
                  <td>
                    <div className="rowActions">
                      <button onClick={() => runNow(job)} disabled={loading}>Lancer</button>
                      <button onClick={() => deleteJob(job)} disabled={loading} className="dangerButton">Supprimer</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel editPanel">
          <h2>Paramétrage</h2>

          {!selected ? (
            <p>Sélectionne un traitement.</p>
          ) : (
            <div className="form">
              <div className="twoCols">
                <label>
                  Clé technique
                  <input value={selected.job_key} onChange={(e) => setSelected({ ...selected, job_key: e.target.value })} />
                </label>
                <label>
                  Libellé
                  <input value={selected.job_label} onChange={(e) => setSelected({ ...selected, job_label: e.target.value })} />
                </label>
              </div>

              <div className="twoCols">
                <label>
                  Type
                  <select
                    value={selected.job_type}
                    onChange={(e) => {
                      const jobType = e.target.value
                      setSelected({
                        ...selected,
                        job_type: jobType,
                        config_json:
                          jobType === 'client_maintenance'
                            ? emptyClientMaintenanceConfig
                            : {
                                routePath: '/api/admin/maintenance/recompute-activity-aggregates',
                                method: 'POST',
                                body: {},
                                period: defaultAggregatePeriod,
                              },
                      })
                    }}
                  >
                    <option value="client_maintenance">Maintenance clients</option>
                    <option value="http_route">Route HTTP générique</option>
                  </select>
                </label>
                <label>
                  Activé
                  <select
                    value={selected.enabled ? 'true' : 'false'}
                    onChange={(e) => setSelected({ ...selected, enabled: e.target.value === 'true' })}
                  >
                    <option value="true">Oui</option>
                    <option value="false">Non</option>
                  </select>
                </label>
              </div>

              <div className="threeCols">
                <label>
                  Fréquence
                  <select value={selected.frequency} onChange={(e) => setSelected({ ...selected, frequency: e.target.value })}>
                    <option value="manual">Manuel uniquement</option>
                    <option value="hourly">Toutes les heures</option>
                    <option value="daily">Tous les jours</option>
                    <option value="weekly">Chaque semaine</option>
                    <option value="monthly">Chaque mois</option>
                  </select>
                </label>
                <label>
                  Heure
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={selected.scheduled_hour ?? 0}
                    onChange={(e) => setSelected({ ...selected, scheduled_hour: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Minute
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={selected.scheduled_minute ?? 0}
                    onChange={(e) => setSelected({ ...selected, scheduled_minute: Number(e.target.value) })}
                  />
                </label>
              </div>

              <label>
                Jours d’exécution
                <WeekdaySelector
                  value={selected.scheduled_weekdays || []}
                  onChange={(value) => setSelected({ ...selected, scheduled_weekdays: value })}
                />
              </label>

              <div className="threeCols">
                <label>
                  Fuseau horaire
                  <input value={selected.timezone} onChange={(e) => setSelected({ ...selected, timezone: e.target.value })} />
                </label>
                <label>
                  Itérations worker
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={selected.max_iterations}
                    onChange={(e) => setSelected({ ...selected, max_iterations: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Continuer en erreur
                  <select
                    value={selected.continue_on_error ? 'true' : 'false'}
                    onChange={(e) => setSelected({ ...selected, continue_on_error: e.target.value === 'true' })}
                  >
                    <option value="true">Oui</option>
                    <option value="false">Non</option>
                  </select>
                </label>
              </div>

              {selected.job_type === 'client_maintenance' ? (
                <div className="subPanel">
                  <h3>Maintenance clients</h3>
                  <div className="checks">
                    {[
                      ['sirene', 'Création / mise à jour SIRENE'],
                      ['cessations', 'Cessations SIRENE'],
                      ['rge', 'RGE'],
                      ['capacite', 'Capacité gaz / froid-clim'],
                      ['enrichment', 'Enrichissement INPI / Google'],
                    ].map(([key, label]) => (
                      <label key={key} className="check">
                        <input
                          type="checkbox"
                          checked={Boolean(config[key])}
                          onChange={(e) => setSelected(setNestedConfig(selected, [key], e.target.checked))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>

                  <div className="twoCols">
                    <SireneDateEditor
                      title="Dates création / mise à jour"
                      value={sireneDates.creation || { mode: 'params' }}
                      onChange={(value) => setSelected(setNestedConfig(selected, ['sireneDates', 'creation'], value))}
                    />
                    <SireneDateEditor
                      title="Dates cessations"
                      value={sireneDates.cessation || { mode: 'params' }}
                      onChange={(value) => setSelected(setNestedConfig(selected, ['sireneDates', 'cessation'], value))}
                    />
                  </div>
                </div>
              ) : (
                <div className="subPanel">
                  <h3>Route HTTP</h3>
                  <label>
                    Route
                    <input value={config.routePath || ''} onChange={(e) => setSelected(setNestedConfig(selected, ['routePath'], e.target.value))} />
                  </label>
                  <label>
                    Méthode
                    <select value={config.method || 'POST'} onChange={(e) => setSelected(setNestedConfig(selected, ['method'], e.target.value))}>
                      <option value="POST">POST</option>
                      <option value="GET">GET</option>
                    </select>
                  </label>

                  {selectedIsAggregateJob && (
                    <AggregatePeriodEditor
                      value={config.period || defaultAggregatePeriod}
                      onChange={(value) => setSelected(setNestedConfig(selected, ['period'], value))}
                    />
                  )}

                  <label>
                    Body JSON complémentaire
                    <textarea
                      value={JSON.stringify(config.body || {}, null, 2)}
                      onChange={(e) => {
                        try {
                          setSelected(setNestedConfig(selected, ['body'], JSON.parse(e.target.value || '{}')))
                        } catch {
                          setSelected(setNestedConfig(selected, ['body'], e.target.value))
                        }
                      }}
                    />
                  </label>
                </div>
              )}

              <div className="actions">
                <button onClick={saveJob} disabled={loading}>Sauvegarder</button>
                <button onClick={() => runNow(selected)} disabled={loading || !selected.id}>Lancer maintenant</button>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Historique des runs</h2>
        <table>
          <thead>
            <tr>
              <th>Début</th>
              <th>Traitement</th>
              <th>Source</th>
              <th>Statut</th>
              <th>Message</th>
              <th>Erreur</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{formatDate(run.created_at)}</td>
                <td>{run.job_key}</td>
                <td>{run.trigger_source}</td>
                <td><span className={statusClass(run.status)}>{run.status}</span></td>
                <td>{run.message || '—'}</td>
                <td>{run.error_message || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Logs récents</h2>
        <div className="logs">
          {logs.map((log) => (
            <div key={log.id} className={`log ${log.level}`}>
              <span>{formatDate(log.created_at)}</span>
              <strong>{log.level.toUpperCase()}</strong>
              <p>{log.message}</p>
            </div>
          ))}
        </div>
      </section>

      <style jsx>{`
        .page { padding: 24px; color: #111827; }
        .header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 16px; }
        h1 { margin: 0; font-size: 28px; }
        h2 { margin: 0 0 16px; font-size: 20px; }
        h3 { margin: 0 0 12px; font-size: 17px; }
        h4 { margin: 0 0 10px; font-size: 15px; }
        p { margin: 6px 0 0; color: #475569; }
        code { background: #eef2ff; color: #3730a3; border-radius: 6px; padding: 1px 5px; }
        button { border: 1px solid #cbd5e1; background: white; border-radius: 10px; padding: 10px 14px; font-weight: 700; cursor: pointer; }
        button:hover { background: #f8fafc; }
        button:disabled { opacity: .5; cursor: not-allowed; }
        .alert { padding: 12px 14px; border-radius: 12px; margin-bottom: 14px; font-weight: 700; }
        .alert.ok { background: #ecfdf5; color: #166534; border: 1px solid #86efac; }
        .alert.ko { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
        .cards { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
        .card { background: white; border: 1px solid #dbe3ef; border-radius: 16px; padding: 14px; }
        .card span { display: block; font-size: 13px; color: #475569; font-weight: 700; }
        .card strong { display: block; margin-top: 8px; font-size: 22px; }
        .card.wide strong { font-size: 16px; }
        .layout { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(420px, .9fr); gap: 16px; align-items: start; }
        .panel { background: white; border: 1px solid #dbe3ef; border-radius: 18px; padding: 16px; margin-bottom: 16px; box-shadow: 0 8px 20px rgba(15, 23, 42, .04); }
        .sectionHeader { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .quickJobs { border: 1px solid #e2e8f0; border-radius: 14px; padding: 12px; margin-bottom: 14px; background: #f8fafc; }
        .quickJobButtons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
        .quickJobs p { font-size: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; color: #334155; background: #f8fafc; border-bottom: 1px solid #dbe3ef; padding: 10px; }
        td { border-bottom: 1px solid #e5eaf1; padding: 10px; vertical-align: top; }
        tr.selected { background: #eff6ff; }
        .linkButton { border: 0; background: transparent; padding: 0; text-align: left; }
        .linkButton strong { display: block; }
        .linkButton small { display: block; color: #64748b; margin-top: 2px; }
        .rowActions { display: flex; gap: 8px; align-items: center; }
        .dangerButton { border-color: #fecaca; background: #fef2f2; color: #991b1b; }
        .dangerButton:hover { background: #fee2e2; }
        .status { display: inline-block; border-radius: 999px; padding: 5px 9px; background: #f1f5f9; font-weight: 800; font-size: 12px; }
        .status.done { background: #dcfce7; color: #166534; }
        .status.running { background: #dbeafe; color: #1d4ed8; }
        .status.queued { background: #fef9c3; color: #854d0e; }
        .status.partial { background: #ffedd5; color: #9a3412; }
        .status.error { background: #fee2e2; color: #991b1b; }
        .status.cancelled { background: #e5e7eb; color: #374151; }
        .form label { display: flex; flex-direction: column; gap: 6px; color: #334155; font-weight: 800; font-size: 13px; }
        input, select, textarea { border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 12px; font: inherit; background: white; }
        textarea { min-height: 120px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
        .twoCols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
        .threeCols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px; }
        .subPanel { border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px; margin: 14px 0; background: #f8fafc; }
        .checks { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
        .check { flex-direction: row !important; align-items: center; gap: 8px !important; }
        .check input { width: auto; }
        .miniCheck { font-size: 12px !important; font-weight: 700 !important; }
        .dateBox { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; }
        .aggregatePeriod { margin: 12px 0; border-color: #bfdbfe; background: #eff6ff; }
        .weekdayBox { border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px; margin-bottom: 12px; background: #fff; }
        .weekdayActions { display: flex; gap: 8px; margin-bottom: 8px; }
        .weekdayActions button { padding: 7px 10px; font-size: 12px; }
        .weekdayList { display: flex; flex-wrap: wrap; gap: 10px; }
        .helpText { font-size: 12px; color: #64748b; font-weight: 500; }
        .actions { display: flex; gap: 10px; justify-content: flex-end; }
        .logs { background: #0f172a; border-radius: 14px; color: #e5e7eb; padding: 10px 14px; max-height: 340px; overflow: auto; }
        .log { display: grid; grid-template-columns: 150px 70px 1fr; gap: 10px; border-bottom: 1px solid rgba(255,255,255,.08); padding: 8px 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
        .log p { color: #e5e7eb; margin: 0; }
        .log.error strong { color: #fca5a5; }
        .log.warning strong { color: #fde68a; }
        .log.info strong { color: #93c5fd; }
        @media (max-width: 1100px) {
          .layout, .cards { grid-template-columns: 1fr; }
          .twoCols, .threeCols { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  )
}
