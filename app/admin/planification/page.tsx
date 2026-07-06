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
    creation: {
      mode: 'relative_range',
      fromOffsetDays: 1,
      toOffsetDays: 1,
    },
    cessation: {
      mode: 'relative_range',
      fromOffsetDays: 1,
      toOffsetDays: 1,
    },
  },
}

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

function formatDate(value?: string | null) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function statusClass(status?: string | null) {
  if (status === 'done') return 'status done'
  if (status === 'running') return 'status running'
  if (status === 'queued') return 'status queued'
  if (status === 'partial') return 'status partial'
  if (status === 'error') return 'status error'
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
      setJobs(json.jobs || [])
      setRuns(json.runs || [])
      setLogs(json.logs || [])
      if (!selected && json.jobs?.[0]) setSelected(json.jobs[0])
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
  }, [])

  async function saveJob() {
    if (!selected) return
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      const res = await fetch('/api/admin/scheduler/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: selected }),
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

  const config = selected?.config_json || {}
  const sireneDates = config.sireneDates || {}

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

          <table>
            <thead>
              <tr>
                <th>Traitement</th>
                <th>Activé</th>
                <th>Fréquence</th>
                <th>Dernier statut</th>
                <th>Prochain passage</th>
                <th></th>
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
                  <td><button onClick={() => runNow(job)} disabled={loading}>Lancer</button></td>
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
                            : { routePath: '/api/reports/focus-mensuel-pdf/process', method: 'POST', body: {} },
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
                    <input
                      value={config.routePath || ''}
                      onChange={(e) => setSelected(setNestedConfig(selected, ['routePath'], e.target.value))}
                    />
                  </label>
                  <label>
                    Méthode
                    <select
                      value={config.method || 'POST'}
                      onChange={(e) => setSelected(setNestedConfig(selected, ['method'], e.target.value))}
                    >
                      <option value="POST">POST</option>
                      <option value="GET">GET</option>
                    </select>
                  </label>
                  <label>
                    Body JSON
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
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; color: #334155; background: #f8fafc; border-bottom: 1px solid #dbe3ef; padding: 10px; }
        td { border-bottom: 1px solid #e5eaf1; padding: 10px; vertical-align: top; }
        tr.selected { background: #eff6ff; }
        .linkButton { border: 0; background: transparent; padding: 0; text-align: left; }
        .linkButton strong { display: block; }
        .linkButton small { display: block; color: #64748b; margin-top: 2px; }
        .status { display: inline-block; border-radius: 999px; padding: 5px 9px; background: #f1f5f9; font-weight: 800; font-size: 12px; }
        .status.done { background: #dcfce7; color: #166534; }
        .status.running { background: #dbeafe; color: #1d4ed8; }
        .status.queued { background: #fef9c3; color: #854d0e; }
        .status.partial { background: #ffedd5; color: #9a3412; }
        .status.error { background: #fee2e2; color: #991b1b; }
        .form label { display: flex; flex-direction: column; gap: 6px; color: #334155; font-weight: 800; font-size: 13px; }
        input, select, textarea { border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 12px; font: inherit; background: white; }
        textarea { min-height: 120px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
        .twoCols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
        .threeCols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px; }
        .subPanel { border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px; margin: 14px 0; background: #f8fafc; }
        .checks { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
        .check { flex-direction: row !important; align-items: center; gap: 8px !important; }
        .check input { width: auto; }
        .dateBox { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; }
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
