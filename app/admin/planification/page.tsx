'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

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

// ---------------------------------------------------------------------------
// Administration serveur (reprise du panneau Admin mobile)
// ---------------------------------------------------------------------------

type StorageObject = {
  name: string
  created_at?: string
  updated_at?: string
  metadata?: { size?: number }
}

type JobStatus = 'pending' | 'running' | 'completed' | 'error'

type SchemaName = 'public' | 'sage' | 'blg'

type WhereCondition = {
  field: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'is_null' | 'is_not_null'
  value: string
}

type RapportPerimetre = { code: string; libelle: string; type: string }

type RapportDemande = {
  id: string
  mois: string | null
  perimetre: string | null
  statut: JobStatus
  demande_par: string | null
  demande_le: string
  debut: string | null
  fin: string | null
  message: string | null
}

type RapportRun = {
  id: string
  mois: string
  perimetre: string
  statut: string
  fichier: string | null
  document_id: string | null
  duree_ms: number | null
  message: string | null
  declencheur: string | null
  created_at: string
}

const BUCKET_SAGE = 'sage-imports'

const SCHEMAS: { id: SchemaName; label: string }[] = [
  { id: 'public', label: 'Public (app)' },
  { id: 'sage', label: 'Sage' },
  { id: 'blg', label: 'BLG' },
]

const OPERATOR_LABELS: Record<WhereCondition['operator'], string> = {
  eq: '= égal à',
  neq: '≠ différent de',
  gt: '> supérieur à',
  gte: '≥ supérieur ou égal à',
  lt: '< inférieur à',
  lte: '≤ inférieur ou égal à',
  like: 'contient',
  ilike: 'contient (insensible à la casse)',
  is_null: 'est vide',
  is_not_null: "n'est pas vide",
}

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

// Mois clos disponibles pour les rapports : du mois précédent à janvier 2025
function moisClos(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []
  const now = new Date()
  let y = now.getFullYear()
  let m = now.getMonth() // mois précédent (0-11)
  if (m === 0) {
    y -= 1
    m = 12
  }
  while (y > 2025 || (y === 2025 && m >= 1)) {
    out.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: `${MOIS_FR[m - 1]} ${y}` })
    m -= 1
    if (m === 0) {
      y -= 1
      m = 12
    }
  }
  return out
}

function libelleMoisRapport(value?: string | null) {
  if (!value) return 'mois précédent'
  const [y, m] = value.slice(0, 7).split('-').map(Number)
  return m ? `${MOIS_FR[m - 1]} ${y}` : value
}

function jobStatusClass(status: JobStatus | null) {
  if (status === 'completed') return 'status done'
  if (status === 'running') return 'status running'
  if (status === 'pending') return 'status queued'
  if (status === 'error') return 'status error'
  return 'status'
}

const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending: 'En attente',
  running: 'En cours…',
  completed: 'Terminé ✓',
  error: 'Erreur ✗',
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

type QuickSchedulerJobTemplate = {
  job_key: string
  job_label: string
  job_type: 'http_route' | 'smc_background'
  routePath?: string
}

const quickAggregateJobs: QuickSchedulerJobTemplate[] = [
  {
    job_key: 'recompute_activity_aggregates_daily',
    job_label: 'Recalcul agrégats activité',
    job_type: 'http_route',
    routePath: '/api/admin/maintenance/recompute-activity-aggregates',
  },
  {
    job_key: 'recompute_invoice_aggregates_daily',
    job_label: 'Recalcul agrégats factures',
    job_type: 'http_route',
    routePath: '/api/admin/maintenance/recompute-invoice-aggregates',
  },
  {
    job_key: 'recompute_quote_aggregates_daily',
    job_label: 'Recalcul agrégats devis',
    job_type: 'http_route',
    routePath: '/api/admin/maintenance/recompute-quote-aggregates',
  },
  {
    job_key: 'rebuild_flux_articles_daily',
    job_label: 'Rebuild flux articles',
    job_type: 'http_route',
    routePath: '/api/admin/maintenance/rebuild-flux-articles',
  },
  {
    job_key: 'refresh_smc_daily',
    job_label: 'Mise à jour SMC quotidienne',
    job_type: 'smc_background',
  },
]

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

function newAggregateJob(template: QuickSchedulerJobTemplate): SchedulerJob {
  const isSmcBackground = template.job_type === 'smc_background'

  return {
    job_key: template.job_key,
    job_label: template.job_label,
    job_type: template.job_type,
    enabled: false,
    frequency: 'daily',
    timezone: 'Europe/Paris',
    scheduled_hour: 6,
    scheduled_minute: 30,
    scheduled_weekdays: [],
    scheduled_month_day: 1,
    config_json: isSmcBackground
      ? {
          period: defaultAggregatePeriod,
          batch_size: 25,
          smc_job_name: 'smc_period_catchup',
          smc_cron_job_name: 'smc_period_catchup_auto',
        }
      : {
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

function isSmcJob(job: SchedulerJob | null) {
  if (!job) return false
  const routePath = String(job.config_json?.routePath || job.config_json?.path || '')

  return (
    job.job_type === 'smc_background' ||
    job.job_key === 'refresh_smc_daily' ||
    routePath === '/api/admin/maintenance/refresh-smc'
  )
}

function isAggregateJob(job: SchedulerJob | null) {
  if (!job || job.job_type !== 'http_route' || isSmcJob(job)) return false
  const key = `${job.job_key || ''} ${job.job_label || ''} ${job.config_json?.routePath || ''}`.toLowerCase()

  return (
    key.includes('agregat') ||
    key.includes('agrégat') ||
    key.includes('aggregate') ||
    key.includes('recompute') ||
    key.includes('flux')
  )
}

function normalizeSmcJobForSave(job: SchedulerJob): SchedulerJob {
  if (!isSmcJob(job)) return job

  const config = safeJson(job.config_json)

  return {
    ...job,
    job_type: 'smc_background',
    config_json: {
      period: config.period || defaultAggregatePeriod,
      batch_size: Number(config.batch_size || config.batchSize || 25),
      smc_job_name: config.smc_job_name || 'smc_period_catchup',
      smc_cron_job_name: config.smc_cron_job_name || 'smc_period_catchup_auto',
    },
  }
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

  // ---------------------------------------------------------------------------
  // Administration serveur (reprise du panneau Admin mobile + rapports mensuels)
  // ---------------------------------------------------------------------------
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  const [pendingFiles, setPendingFiles] = useState<StorageObject[]>([])
  const [archivedFiles, setArchivedFiles] = useState<StorageObject[]>([])
  const [bucketLoading, setBucketLoading] = useState(false)

  const [vpsStatus, setVpsStatus] = useState<JobStatus | null>(null)
  const [syncJobStatus, setSyncJobStatus] = useState<JobStatus | null>(null)
  const [recalculJobStatus, setRecalculJobStatus] = useState<JobStatus | null>(null)

  const [confirmModal, setConfirmModal] = useState<{ label: string; onConfirmed: () => Promise<void> } | null>(null)
  const [confirmPassword, setConfirmPassword] = useState('')
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  const [selectedSchema, setSelectedSchema] = useState<SchemaName>('public')
  const [tables, setTables] = useState<string[]>([])
  const [selectedTable, setSelectedTable] = useState<string>('')
  const [columns, setColumns] = useState<string[]>([])
  const [selectedFields, setSelectedFields] = useState<string[]>([])
  const [whereConditions, setWhereConditions] = useState<WhereCondition[]>([])
  const [queryResults, setQueryResults] = useState<Record<string, any>[] | null>(null)
  const [queryCount, setQueryCount] = useState<number | null>(null)
  const [queryLoading, setQueryLoading] = useState(false)
  const [queryError, setQueryError] = useState<string | null>(null)

  const moisOptions = useMemo(() => moisClos(), [])
  const [rapportMois, setRapportMois] = useState<string>(() => moisClos()[0]?.value || '')
  const [rapportPerimetre, setRapportPerimetre] = useState<string>('')
  const [perimetres, setPerimetres] = useState<RapportPerimetre[]>([])
  const [rapportDemande, setRapportDemande] = useState<RapportDemande | null>(null)
  const [rapportRuns, setRapportRuns] = useState<RapportRun[]>([])
  const [rapportError, setRapportError] = useState<string | null>(null)

  const intervals = useRef<ReturnType<typeof setInterval>[]>([])
  useEffect(() => {
    return () => {
      intervals.current.forEach((i) => clearInterval(i))
    }
  }, [])

  // -- Vérification admin (source de vérité : la fonction SQL elle-même) -----
  useEffect(() => {
    supabase.rpc('current_user_is_admin').then(({ data, error }) => {
      if (error) {
        console.error(error)
        setIsAdmin(false)
        return
      }
      setIsAdmin(Boolean(data))
    })
  }, [])

  // -- Bucket sage-imports -----------------------------------------------------
  const loadBucket = useCallback(async () => {
    setBucketLoading(true)
    const [rootRes, archiveRes] = await Promise.all([
      supabase.storage.from(BUCKET_SAGE).list('', { limit: 50 }),
      supabase.storage.from(BUCKET_SAGE).list('archive', {
        limit: 20,
        sortBy: { column: 'created_at', order: 'desc' },
      }),
    ])
    setPendingFiles((rootRes.data as StorageObject[]) || [])
    setArchivedFiles((archiveRes.data as StorageObject[]) || [])
    setBucketLoading(false)
  }, [])

  // -- Rapports mensuels ---------------------------------------------------------
  const loadRapports = useCallback(async () => {
    const [demRes, runsRes] = await Promise.all([
      supabase
        .from('rapport_mensuel_demandes')
        .select('id, mois, perimetre, statut, demande_par, demande_le, debut, fin, message')
        .order('demande_le', { ascending: false })
        .limit(1),
      supabase
        .from('rapport_mensuel_runs')
        .select('id, mois, perimetre, statut, fichier, document_id, duree_ms, message, declencheur, created_at')
        .order('created_at', { ascending: false })
        .limit(30),
    ])
    if (demRes.error) setRapportError(demRes.error.message)
    setRapportDemande(((demRes.data as RapportDemande[]) || [])[0] || null)
    setRapportRuns((runsRes.data as RapportRun[]) || [])
    return ((demRes.data as RapportDemande[]) || [])[0] || null
  }, [])

  const pollRapport = useCallback(() => {
    const interval = setInterval(async () => {
      const d = await loadRapports()
      if (!d || d.statut === 'completed' || d.statut === 'error') {
        clearInterval(interval)
        intervals.current = intervals.current.filter((i) => i !== interval)
      }
    }, 5000)
    intervals.current.push(interval)
  }, [loadRapports])

  useEffect(() => {
    if (!isAdmin) return
    void loadBucket()
    supabase
      .from('rapport_mensuel_perimetres')
      .select('code, libelle, type')
      .eq('actif', true)
      .order('ordre')
      .then(({ data }) => setPerimetres((data as RapportPerimetre[]) || []))
    loadRapports().then((d) => {
      if (d && (d.statut === 'pending' || d.statut === 'running')) pollRapport()
    })
  }, [isAdmin, loadBucket, loadRapports, pollRapport])

  // -- Requêteur : tables puis colonnes -------------------------------------------
  useEffect(() => {
    if (!isAdmin) return
    setSelectedTable('')
    supabase.rpc('admin_list_tables', { p_schema: selectedSchema }).then(({ data, error }) => {
      if (error) {
        console.error(error)
        setTables([])
        return
      }
      setTables((data || []).map((r: any) => r.table_name))
    })
  }, [isAdmin, selectedSchema])

  useEffect(() => {
    if (!selectedTable) {
      setColumns([])
      setSelectedFields([])
      return
    }
    supabase.rpc('admin_list_columns', { p_table: selectedTable, p_schema: selectedSchema }).then(({ data, error }) => {
      if (error) {
        console.error(error)
        return
      }
      setColumns((data || []).map((r: any) => r.column_name))
      setSelectedFields([])
      setWhereConditions([])
      setQueryResults(null)
      setQueryCount(null)
    })
  }, [selectedTable, selectedSchema])

  // -- Confirmation par mot de passe avant action sensible ----------------------
  function requireConfirmation(label: string, action: () => Promise<void>) {
    setConfirmPassword('')
    setConfirmError(null)
    setConfirmModal({ label, onConfirmed: action })
  }

  async function handlePasswordConfirm() {
    if (!confirmModal) return
    setConfirmLoading(true)
    setConfirmError(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const email = userData?.user?.email
      if (!email) throw new Error('Session expirée, reconnecte-toi.')
      const { error } = await supabase.auth.signInWithPassword({ email, password: confirmPassword })
      if (error) throw new Error('Mot de passe incorrect.')
      await confirmModal.onConfirmed()
      setConfirmModal(null)
      setConfirmPassword('')
    } catch (e: any) {
      setConfirmError(e?.message || 'Action impossible.')
    } finally {
      setConfirmLoading(false)
    }
  }

  // -- Déclenchements VPS et jobs de fond -----------------------------------------
  function pollJobStatus(table: 'admin_vps_commands' | 'admin_background_jobs', id: string, setStatus: (s: JobStatus) => void) {
    const interval = setInterval(async () => {
      const { data } = await supabase.from(table).select('status').eq('id', id).single()
      if (data) {
        setStatus(data.status as JobStatus)
        if (data.status === 'completed' || data.status === 'error') {
          clearInterval(interval)
          intervals.current = intervals.current.filter((i) => i !== interval)
          if (table === 'admin_vps_commands') void loadBucket()
        }
      }
    }, 2000)
    intervals.current.push(interval)
  }

  function triggerVpsImport() {
    requireConfirmation("Lancer l'import VPS", async () => {
      setVpsStatus('pending')
      const { data, error } = await supabase
        .from('admin_vps_commands')
        .insert({ command: 'start_sage_import' })
        .select('id')
        .single()
      if (error || !data) {
        setVpsStatus('error')
        throw new Error(error?.message || 'Commande non créée.')
      }
      pollJobStatus('admin_vps_commands', data.id, setVpsStatus)
    })
  }

  function triggerBackgroundJob(
    jobName: 'sync_sage_to_activite' | 'stock_projection_recalcul',
    label: string,
    setStatus: (s: JobStatus) => void,
  ) {
    requireConfirmation(label, async () => {
      setStatus('pending')
      const { data, error } = await supabase
        .from('admin_background_jobs')
        .insert({ job_name: jobName })
        .select('id')
        .single()
      if (error || !data) {
        setStatus('error')
        throw new Error(error?.message || 'Job non créé.')
      }
      pollJobStatus('admin_background_jobs', data.id, setStatus)
    })
  }

  function triggerRapportMensuel() {
    const per = perimetres.find((p) => p.code === rapportPerimetre)
    const label = `Générer les rapports de ${libelleMoisRapport(rapportMois)} — ${per ? per.libelle : 'entreprise et toutes les agences'}`
    requireConfirmation(label, async () => {
      setRapportError(null)
      const { error } = await supabase
        .from('rapport_mensuel_demandes')
        .insert({ mois: rapportMois || null, perimetre: rapportPerimetre || null })
      if (error) throw new Error(error.message)
      await loadRapports()
      pollRapport()
    })
  }

  async function openRapport(run: RapportRun) {
    setRapportError(null)
    if (!run.document_id) return
    const { data, error } = await supabase.from('documents').select('storage_path').eq('id', run.document_id).single()
    if (error || !data?.storage_path) {
      setRapportError(error?.message || 'Fichier introuvable dans Documents.')
      return
    }
    const { data: signed, error: e2 } = await supabase.storage.from('documents').createSignedUrl(data.storage_path, 60)
    if (e2 || !signed?.signedUrl) {
      setRapportError(e2?.message || 'Lien de téléchargement impossible.')
      return
    }
    window.open(signed.signedUrl, '_blank', 'noopener,noreferrer')
  }

  // -- Requêteur -----------------------------------------------------------------------
  function toggleField(field: string) {
    setSelectedFields((prev) => (prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]))
  }

  function addWhereCondition() {
    if (columns.length === 0) return
    setWhereConditions((prev) => [...prev, { field: columns[0], operator: 'eq', value: '' }])
  }

  function updateWhereCondition(index: number, patch: Partial<WhereCondition>) {
    setWhereConditions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  function removeWhereCondition(index: number) {
    setWhereConditions((prev) => prev.filter((_, i) => i !== index))
  }

  async function runQuery() {
    if (!selectedTable || selectedFields.length === 0) return
    setQueryLoading(true)
    setQueryError(null)
    setQueryResults(null)
    setQueryCount(null)

    const { data, error } = await supabase.rpc('admin_query', {
      p_table: selectedTable,
      p_fields: selectedFields,
      p_where: whereConditions.filter((c) => c.field && c.operator),
      p_limit: 100,
      p_schema: selectedSchema,
    })

    setQueryLoading(false)
    if (error) {
      setQueryError(error.message)
      return
    }
    // admin_query renvoie { count, rows } : count = total filtré, rows plafonnées à p_limit
    const result = data as { count: number; rows: Record<string, any>[] }
    setQueryCount(result.count)
    setQueryResults(result.rows)
  }

  const rapportEnCours = rapportDemande?.statut === 'pending' || rapportDemande?.statut === 'running'
  const libellePerimetre = (code?: string | null) =>
    !code ? 'Tous' : perimetres.find((p) => p.code === code)?.libelle || code

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

      // Ne jamais écraser le formulaire en cours d'édition lors d'une actualisation.
      // Les jobs, runs et logs sont rafraîchis, mais le job sélectionné reste intact
      // jusqu'à une sauvegarde explicite ou la sélection volontaire d'un autre job.
      if (!selected && nextJobs?.[0]) {
        setSelected(clone(nextJobs[0]))
      }
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Chargement initial uniquement. Aucun rafraîchissement automatique :
    // un timer réinjectait les données serveur toutes les 15 secondes et
    // supprimait les paramètres saisis avant leur sauvegarde.
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function saveJob() {
    if (!selected) return
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      const normalized = normalizeSmcJobForSave({ ...selected, config_json: safeJson(selected.config_json) })

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

      setMessage('Traitement lancé. Clique sur Actualiser pour mettre à jour le suivi, sans interrompre une saisie en cours.')
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
        <button onClick={() => void refresh()} disabled={loading}>Actualiser</button>
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
            <p>Les mises à jour de la liste, des runs et des logs se font uniquement avec le bouton Actualiser afin de préserver les saisies non sauvegardées.</p>
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
                    value={isSmcJob(selected) ? 'smc_background' : selected.job_type}
                    onChange={(e) => {
                      const jobType = e.target.value
                      setSelected({
                        ...selected,
                        job_type: jobType,
                        config_json:
                          jobType === 'client_maintenance'
                            ? emptyClientMaintenanceConfig
                            : jobType === 'smc_background'
                              ? {
                                  period: defaultAggregatePeriod,
                                  batch_size: 25,
                                  smc_job_name: 'smc_period_catchup',
                                  smc_cron_job_name: 'smc_period_catchup_auto',
                                }
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
                    <option value="smc_background">SMC en arrière-plan</option>
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
              ) : selected.job_type === 'smc_background' || isSmcJob(selected) ? (
                <div className="subPanel">
                  <h3>SMC en arrière-plan</h3>
                  <p>
                    Le scheduler prépare la file SMC puis active le cron SQL, exactement comme dans import.tsx.
                    Le run scheduler se termine dès que le traitement d’arrière-plan est lancé.
                  </p>

                  <AggregatePeriodEditor
                    value={config.period || defaultAggregatePeriod}
                    onChange={(value) => setSelected(setNestedConfig(selected, ['period'], value))}
                  />

                  <div className="threeCols">
                    <label>
                      Taille des lots clients
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={Number(config.batch_size || 25)}
                        onChange={(e) => setSelected(setNestedConfig(selected, ['batch_size'], Number(e.target.value)))}
                      />
                    </label>
                    <label>
                      Nom du job SMC
                      <input
                        value={config.smc_job_name || 'smc_period_catchup'}
                        onChange={(e) => setSelected(setNestedConfig(selected, ['smc_job_name'], e.target.value))}
                      />
                    </label>
                    <label>
                      Nom du cron SMC
                      <input
                        value={config.smc_cron_job_name || 'smc_period_catchup_auto'}
                        onChange={(e) => setSelected(setNestedConfig(selected, ['smc_cron_job_name'], e.target.value))}
                      />
                    </label>
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

      {isAdmin && (
        <>
          <div className="adminTitle">
            <h2>Administration serveur</h2>
            <p>Actions sensibles : chaque lancement redemande le mot de passe du compte connecté.</p>
          </div>

          <div className="adminGrid">
            <section className="panel">
              <h2>Actions serveur</h2>
              <div className="actionRow">
                <span>Lancer l’import VPS</span>
                <div className="actionRight">
                  {vpsStatus && <span className={jobStatusClass(vpsStatus)}>{JOB_STATUS_LABELS[vpsStatus]}</span>}
                  <button onClick={triggerVpsImport} disabled={vpsStatus === 'pending' || vpsStatus === 'running'}>
                    Lancer
                  </button>
                </div>
              </div>
              <div className="actionRow">
                <span>Sync SAGE → activité</span>
                <div className="actionRight">
                  {syncJobStatus && <span className={jobStatusClass(syncJobStatus)}>{JOB_STATUS_LABELS[syncJobStatus]}</span>}
                  <button
                    onClick={() => triggerBackgroundJob('sync_sage_to_activite', 'Lancer sync SAGE → activité', setSyncJobStatus)}
                    disabled={syncJobStatus === 'pending' || syncJobStatus === 'running'}
                  >
                    Lancer
                  </button>
                </div>
              </div>
              <div className="actionRow">
                <span>Recalcul projection stock</span>
                <div className="actionRight">
                  {recalculJobStatus && (
                    <span className={jobStatusClass(recalculJobStatus)}>{JOB_STATUS_LABELS[recalculJobStatus]}</span>
                  )}
                  <button
                    onClick={() =>
                      triggerBackgroundJob('stock_projection_recalcul', 'Lancer le recalcul de projection stock', setRecalculJobStatus)
                    }
                    disabled={recalculJobStatus === 'pending' || recalculJobStatus === 'running'}
                  >
                    Lancer
                  </button>
                </div>
              </div>

              <div className="bucketBox">
                <div className="sectionHeader">
                  <h3>Bucket sage-imports</h3>
                  <button className="smallButton" onClick={() => void loadBucket()} disabled={bucketLoading}>
                    {bucketLoading ? '…' : 'Rafraîchir'}
                  </button>
                </div>
                <p className="miniTitle">En attente ({pendingFiles.length})</p>
                {pendingFiles.length === 0 && <p className="helpText">Aucun fichier en attente.</p>}
                {pendingFiles.map((f) => (
                  <div key={f.name} className="fileRow">
                    <span>{f.name}</span>
                    <small>{f.metadata?.size ? `${Math.round((f.metadata.size / 1024) * 10) / 10} Ko` : ''}</small>
                  </div>
                ))}
                <p className="miniTitle">Derniers archivés</p>
                {archivedFiles.map((f) => (
                  <div key={f.name} className="fileRow muted">
                    <span>{f.name}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="sectionHeader">
                <h2>Rapports mensuels</h2>
                <button className="smallButton" onClick={() => void loadRapports()}>
                  Actualiser
                </button>
              </div>
              <p className="helpText">
                Génération automatique le 5 de chaque mois à 6 h 30. Ici, relance à la demande : les PDF sont déposés dans
                Documents › Rapport d’activité (un mois relancé remplace ses fichiers).
              </p>

              <div className="form rapportForm">
                <div className="twoCols">
                  <label>
                    Mois
                    <select value={rapportMois} onChange={(e) => setRapportMois(e.target.value)} disabled={rapportEnCours}>
                      {moisOptions.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Périmètre
                    <select
                      value={rapportPerimetre}
                      onChange={(e) => setRapportPerimetre(e.target.value)}
                      disabled={rapportEnCours}
                    >
                      <option value="">Tous (entreprise + agences)</option>
                      {perimetres.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.type === 'entreprise' ? `Entreprise — ${p.libelle}` : p.libelle}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="actions">
                  <button className="primaryButton" onClick={triggerRapportMensuel} disabled={rapportEnCours || !rapportMois}>
                    {rapportEnCours ? 'Génération en cours…' : 'Générer'}
                  </button>
                </div>
              </div>

              {rapportError && <div className="alert ko">{rapportError}</div>}

              {rapportDemande && (
                <div className="demandeBox">
                  <div className="demandeHead">
                    <strong>
                      Dernière demande : {libelleMoisRapport(rapportDemande.mois)} · {libellePerimetre(rapportDemande.perimetre)}
                    </strong>
                    <span className={jobStatusClass(rapportDemande.statut)}>{JOB_STATUS_LABELS[rapportDemande.statut]}</span>
                  </div>
                  <small>
                    {rapportDemande.demande_par || '—'} · demandé le {formatDate(rapportDemande.demande_le)}
                    {rapportDemande.fin ? ` · terminé le ${formatDate(rapportDemande.fin)}` : ''}
                  </small>
                  {rapportDemande.statut === 'pending' && (
                    <p className="helpText">En attente de prise en charge par le VPS (contrôle toutes les 15 s).</p>
                  )}
                  {rapportDemande.message && <pre className="demandeMessage">{rapportDemande.message}</pre>}
                </div>
              )}

              <h3 className="runsTitle">Derniers rapports produits</h3>
              {rapportRuns.length === 0 ? (
                <p className="helpText">Aucun rapport produit pour l’instant.</p>
              ) : (
                <div className="tableScroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Mois</th>
                        <th>Périmètre</th>
                        <th>Source</th>
                        <th>Statut</th>
                        <th>Durée</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rapportRuns.map((run) => (
                        <tr key={run.id}>
                          <td>{formatDate(run.created_at)}</td>
                          <td>{libelleMoisRapport(run.mois)}</td>
                          <td>{libellePerimetre(run.perimetre)}</td>
                          <td>{run.declencheur || '—'}</td>
                          <td>
                            <span className={run.statut === 'ok' ? 'status done' : run.statut === 'erreur' ? 'status error' : 'status running'}>
                              {run.statut}
                            </span>
                            {run.statut === 'erreur' && run.message && <small className="runError">{run.message}</small>}
                          </td>
                          <td>{run.duree_ms != null ? `${(run.duree_ms / 1000).toFixed(1)} s` : '—'}</td>
                          <td>
                            {run.document_id && (
                              <button className="smallButton" onClick={() => void openRapport(run)}>
                                Ouvrir
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <section className="panel">
            <h2>Requêteur (lecture seule)</h2>
            <div className="form">
              <div className="twoCols">
                <label>
                  Environnement
                  <div className="schemaButtons">
                    {SCHEMAS.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={selectedSchema === s.id ? 'schemaActive' : ''}
                        onClick={() => setSelectedSchema(s.id)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </label>
                <label>
                  Table
                  <select value={selectedTable} onChange={(e) => setSelectedTable(e.target.value)}>
                    <option value="">— Choisir une table —</option>
                    {tables.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {columns.length > 0 && (
                <>
                  <p className="miniTitle">Champs à retourner</p>
                  <div className="fieldChips">
                    {columns.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={selectedFields.includes(c) ? 'chip chipActive' : 'chip'}
                        onClick={() => toggleField(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>

                  <p className="miniTitle">Conditions (WHERE)</p>
                  {whereConditions.map((cond, i) => {
                    const needsValue = cond.operator !== 'is_null' && cond.operator !== 'is_not_null'
                    return (
                      <div key={i} className="whereRow">
                        <select value={cond.field} onChange={(e) => updateWhereCondition(i, { field: e.target.value })}>
                          {columns.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <select
                          value={cond.operator}
                          onChange={(e) => updateWhereCondition(i, { operator: e.target.value as WhereCondition['operator'] })}
                        >
                          {(Object.keys(OPERATOR_LABELS) as WhereCondition['operator'][]).map((op) => (
                            <option key={op} value={op}>
                              {OPERATOR_LABELS[op]}
                            </option>
                          ))}
                        </select>
                        <input
                          value={cond.value}
                          disabled={!needsValue}
                          onChange={(e) => updateWhereCondition(i, { value: e.target.value })}
                          placeholder={needsValue ? 'Valeur à comparer' : '—'}
                        />
                        <button type="button" className="dangerButton" onClick={() => removeWhereCondition(i)}>
                          Retirer
                        </button>
                      </div>
                    )
                  })}
                  <div className="actions queryActions">
                    <button type="button" onClick={addWhereCondition}>
                      + Ajouter une condition
                    </button>
                    <button
                      type="button"
                      className="primaryButton"
                      onClick={() => void runQuery()}
                      disabled={selectedFields.length === 0 || queryLoading}
                    >
                      {queryLoading ? 'Exécution…' : 'Exécuter'}
                    </button>
                  </div>
                </>
              )}
            </div>

            {queryError && <div className="alert ko">{queryError}</div>}

            {queryCount !== null && (
              <p className="queryCount">
                {queryCount === 0
                  ? 'Aucune occurrence trouvée'
                  : queryCount === 1
                    ? '1 occurrence trouvée'
                    : `${queryCount} occurrences trouvées`}
                {queryResults && queryResults.length < queryCount && (
                  <span> — {queryResults.length} affichées (limite 100)</span>
                )}
              </p>
            )}

            {queryResults && queryResults.length > 0 && (
              <div className="tableScroll">
                <table>
                  <thead>
                    <tr>
                      {selectedFields.map((f) => (
                        <th key={f}>{f}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {queryResults.map((row, i) => (
                      <tr key={i}>
                        {selectedFields.map((f) => (
                          <td key={f} className="nowrap">
                            {row[f] !== null && typeof row[f] === 'object' ? JSON.stringify(row[f]) : String(row[f] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

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

      {confirmModal && (
        <div className="modalBackdrop" onClick={() => !confirmLoading && setConfirmModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Confirmation requise</h3>
            <p>
              Ressaisis ton mot de passe pour : <strong>{confirmModal.label}</strong>
            </p>
            <input
              type="password"
              autoFocus
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && confirmPassword && !confirmLoading) void handlePasswordConfirm()
              }}
              placeholder="Mot de passe"
            />
            {confirmError && <div className="alert ko modalError">{confirmError}</div>}
            <div className="actions">
              <button type="button" onClick={() => setConfirmModal(null)} disabled={confirmLoading}>
                Annuler
              </button>
              <button
                type="button"
                className="primaryButton"
                onClick={() => void handlePasswordConfirm()}
                disabled={confirmLoading || confirmPassword.length === 0}
              >
                {confirmLoading ? 'Vérification…' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}

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
        .adminTitle { margin: 8px 0 12px; }
        .adminTitle h2 { margin: 0; }
        .adminGrid { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 16px; align-items: start; }
        .actionRow { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #e5eaf1; font-size: 14px; font-weight: 600; }
        .actionRight { display: flex; align-items: center; gap: 8px; }
        .bucketBox { border: 1px solid #e2e8f0; border-radius: 14px; padding: 12px; margin-top: 14px; background: #f8fafc; }
        .bucketBox h3 { margin: 0; }
        .miniTitle { font-size: 12px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: .04em; margin: 12px 0 6px; }
        .fileRow { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; padding: 3px 0; }
        .fileRow span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .fileRow small { color: #64748b; flex-shrink: 0; }
        .fileRow.muted { color: #64748b; }
        .smallButton { padding: 6px 10px; font-size: 12px; }
        .primaryButton { background: #0f172a; color: white; border-color: #0f172a; }
        .primaryButton:hover { background: #1e293b; }
        .rapportForm { margin-top: 12px; }
        .demandeBox { border: 1px solid #e2e8f0; border-radius: 14px; padding: 12px; margin: 14px 0; background: #f8fafc; }
        .demandeHead { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 4px; }
        .demandeBox small { color: #64748b; }
        .demandeMessage { margin: 10px 0 0; padding: 10px; background: #0f172a; color: #e5e7eb; border-radius: 10px; font-size: 12px; white-space: pre-wrap; max-height: 220px; overflow: auto; }
        .runsTitle { margin-top: 16px; }
        .runError { display: block; color: #991b1b; margin-top: 4px; max-width: 320px; white-space: normal; }
        .tableScroll { overflow-x: auto; }
        .nowrap { white-space: nowrap; }
        .schemaButtons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .schemaButtons button { padding: 9px 10px; font-size: 13px; }
        .schemaButtons .schemaActive { background: #0f172a; color: white; border-color: #0f172a; }
        .fieldChips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
        .chip { border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 600; background: #f1f5f9; border-color: #e2e8f0; }
        .chipActive { background: #7a5ea8; color: white; border-color: #7a5ea8; }
        .chipActive:hover { background: #6b4f99; }
        .whereRow { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 8px; margin-bottom: 8px; }
        .queryActions { justify-content: space-between; margin-top: 4px; }
        .queryCount { font-weight: 700; color: #0f172a; margin: 12px 0 8px; }
        .queryCount span { font-weight: 500; color: #64748b; }
        .modalBackdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, .55); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        .modal { background: white; border-radius: 18px; padding: 20px; width: 100%; max-width: 420px; box-shadow: 0 20px 50px rgba(15, 23, 42, .25); }
        .modal h3 { margin: 0 0 6px; }
        .modal p { margin: 0 0 12px; }
        .modal input { width: 100%; box-sizing: border-box; margin-bottom: 12px; }
        .modalError { margin-bottom: 12px; }
        @media (max-width: 1100px) {
          .adminGrid, .whereRow { grid-template-columns: 1fr; }
        }
        @media (max-width: 1100px) {
          .layout, .cards { grid-template-columns: 1fr; }
          .twoCols, .threeCols { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  )
}
