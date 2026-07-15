import { createSupabaseAdmin } from '@/lib/server/supabaseAdmin'

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>

type SchedulerJob = {
  id: string
  job_key: string
  job_label: string
  job_type: string
  enabled: boolean
  frequency: string
  cron_expression?: string | null
  timezone: string
  scheduled_hour?: number | null
  scheduled_minute?: number | null
  scheduled_weekdays?: number[] | null
  scheduled_month_day?: number | null
  config_json?: Record<string, any>
  max_iterations?: number | null
  max_runtime_seconds?: number | null
  allow_overlap?: boolean | null
  continue_on_error?: boolean | null
  next_run_at?: string | null
  archived_at?: string | null
  archived_by?: string | null
  archive_reason?: string | null
}

type SchedulerRun = {
  id: string
  job_id: string
  job_key: string
  job_type: string
  status: string
  trigger_source: string
  result_json?: Record<string, any>
}

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

function toYmdInTimezone(date: Date, timezone = 'Europe/Paris') {
  const formatter = new Intl.DateTimeFormat('fr-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return formatter.format(date)
}

function getAppOrigin() {
  const configuredOrigin =
    process.env.APP_BASE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL

  if (!configuredOrigin) {
    throw new Error(
      'APP_BASE_URL ou VERCEL_PROJECT_PRODUCTION_URL est manquant.'
    )
  }

  return configuredOrigin.startsWith('http')
    ? configuredOrigin.replace(/\/+$/, '')
    : `https://${configuredOrigin.replace(/\/+$/, '')}`
}

function addDaysToYmd(ymd: string, days: number) {
  const date = new Date(`${ymd}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function addMonthsToYmd(ymd: string, months: number) {
  const year = Number(ymd.slice(0, 4))
  const monthIndex = Number(ymd.slice(5, 7)) - 1
  const day = Number(ymd.slice(8, 10))

  const date = new Date(Date.UTC(year, monthIndex + months, 1))
  const lastDayOfTargetMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate()

  date.setUTCDate(Math.min(day, lastDayOfTargetMonth))

  return date.toISOString().slice(0, 10)
}

function firstDayOfMonthYmd(ymd: string) {
  return `${ymd.slice(0, 7)}-01`
}

function firstDayOfNextMonthYmd(ymd: string) {
  return addMonthsToYmd(firstDayOfMonthYmd(ymd), 1)
}

function parseOffsetMinutes(date: Date, timezone: string) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
  }).formatToParts(date)

  const tz = formatted.find((part) => part.type === 'timeZoneName')?.value || 'GMT+0'
  const match = tz.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/)
  if (!match) return 0

  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2] || 0)
  const minutes = Number(match[3] || 0)
  return sign * (hours * 60 + minutes)
}

function zonedDateTimeToUtc(ymd: string, hour: number, minute: number, timezone: string) {
  const naiveUtc = new Date(`${ymd}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`)
  const offsetMinutes = parseOffsetMinutes(naiveUtc, timezone)
  return new Date(naiveUtc.getTime() - offsetMinutes * 60_000)
}

function getLocalWeekday(ymd: string) {
  const d = new Date(`${ymd}T00:00:00.000Z`)
  // 0 dimanche, 1 lundi, etc. comme JS
  return d.getUTCDay()
}

export function computeNextRunAt(job: Partial<SchedulerJob>, from = new Date()) {
  const frequency = job.frequency || 'daily'
  if (frequency === 'manual') return null

  const timezone = job.timezone || 'Europe/Paris'
  const hour = Number(job.scheduled_hour ?? 6)
  const minute = Number(job.scheduled_minute ?? 0)
  const weekdays = Array.isArray(job.scheduled_weekdays) ? job.scheduled_weekdays : []
  const monthDay = Math.max(1, Math.min(Number(job.scheduled_month_day || 1), 28))

  const todayYmd = toYmdInTimezone(from, timezone)

  if (frequency === 'hourly') {
    const next = new Date(from)
    next.setMinutes(minute, 0, 0)
    if (next <= from) next.setHours(next.getHours() + 1)
    return next.toISOString()
  }

  for (let offset = 0; offset <= 370; offset += 1) {
    const ymd = addDaysToYmd(todayYmd, offset)
    const candidate = zonedDateTimeToUtc(ymd, hour, minute, timezone)
    if (candidate <= from) continue

    if (frequency === 'weekly') {
      const weekday = getLocalWeekday(ymd)
      if (weekdays.length > 0 && !weekdays.includes(weekday)) continue
    }

    if (frequency === 'monthly') {
      const day = Number(ymd.slice(8, 10))
      if (day !== monthDay) continue
    }

    return candidate.toISOString()
  }

  return null
}

function resolveRelativeDate(offsetDays: number, timezone = 'Europe/Paris') {
  const today = toYmdInTimezone(new Date(), timezone)
  return addDaysToYmd(today, -Math.abs(Number(offsetDays || 0)))
}

function resolveSireneDateRange(config: any, timezone = 'Europe/Paris') {
  const mode = config?.mode || 'params'

  if (mode === 'today') {
    const today = toYmdInTimezone(new Date(), timezone)
    return { min: today, max: today }
  }

  if (mode === 'relative_single') {
    const date = resolveRelativeDate(config?.offsetDays ?? 1, timezone)
    return { min: date, max: date }
  }

  if (mode === 'relative_range') {
    return {
      min: resolveRelativeDate(config?.fromOffsetDays ?? 1, timezone),
      max: resolveRelativeDate(config?.toOffsetDays ?? 0, timezone),
    }
  }

  if (mode === 'fixed_range') {
    return {
      min: config?.fromDate,
      max: config?.toDate || config?.fromDate,
    }
  }

  return null
}

function normalizeDateRange(startDate?: string | null, endDate?: string | null) {
  if (!startDate || !endDate) return null

  const date_debut = String(startDate).slice(0, 10)
  const date_fin = String(endDate).slice(0, 10)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date_debut)) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date_fin)) return null
  if (date_fin < date_debut) return null

  return { date_debut, date_fin }
}

export function resolveAggregatePeriod(
  period: any,
  timezone = 'Europe/Paris',
  now = new Date()
) {
  if (!period?.mode) return null

  const today = toYmdInTimezone(now, timezone)
  const tomorrow = addDaysToYmd(today, 1)
  const firstDayCurrentMonth = firstDayOfMonthYmd(today)
  const firstDayNextMonth = firstDayOfNextMonthYmd(today)

  if (period.mode === 'fixed_range') {
    return normalizeDateRange(period.fromDate, period.toDate || period.fromDate)
  }

  if (period.mode === 'current_month') {
    return normalizeDateRange(firstDayCurrentMonth, tomorrow)
  }

  if (period.mode === 'current_full_month') {
    return normalizeDateRange(firstDayCurrentMonth, firstDayNextMonth)
  }

  if (period.mode === 'previous_month') {
    const firstDayPreviousMonth = addMonthsToYmd(firstDayCurrentMonth, -1)
    return normalizeDateRange(firstDayPreviousMonth, firstDayCurrentMonth)
  }

  if (period.mode === 'relative_days') {
    const days = Math.max(1, Number(period.days || 1))
    return normalizeDateRange(addDaysToYmd(today, -days), tomorrow)
  }

  if (period.mode === 'relative_months') {
    const months = Math.max(1, Number(period.months || 2))
    const includeCurrentMonth = period.includeCurrentMonth !== false

    if (includeCurrentMonth) {
      const start = addMonthsToYmd(firstDayCurrentMonth, -(months - 1))
      return normalizeDateRange(start, tomorrow)
    }

    const firstDayPreviousMonth = addMonthsToYmd(firstDayCurrentMonth, -1)
    const start = addMonthsToYmd(firstDayPreviousMonth, -(months - 1))
    return normalizeDateRange(start, firstDayCurrentMonth)
  }

  return null
}

export function buildSchedulerHttpBody(job: SchedulerJob) {
  const config = job.config_json || {}
  const body = {
    ...(config.body || {}),
  }

  const resolvedPeriod = resolveAggregatePeriod(config.period, job.timezone || 'Europe/Paris')

  if (resolvedPeriod?.date_debut && resolvedPeriod?.date_fin) {
    return {
      ...body,
      date_debut: resolvedPeriod.date_debut,
      date_fin: resolvedPeriod.date_fin,
      p_date_debut: resolvedPeriod.date_debut,
      p_date_fin: resolvedPeriod.date_fin,
      startDate: resolvedPeriod.date_debut,
      endDate: resolvedPeriod.date_fin,
      fromDate: resolvedPeriod.date_debut,
      toDate: resolvedPeriod.date_fin,
      period: {
        ...(config.period || {}),
        resolved: resolvedPeriod,
      },
    }
  }

  return body
}

async function addSchedulerLog(
  supabase: SupabaseAdmin,
  schedulerRunId: string,
  level: 'info' | 'warning' | 'error',
  message: string,
  payload: Record<string, any> = {}
) {
  await supabase.from('scheduler_logs').insert({
    scheduler_run_id: schedulerRunId,
    level,
    message,
    payload_json: payload,
  })
}

async function readJsonSafe(res: Response) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return { raw: text }
  }
}

async function applySireneDateOverrides(supabase: SupabaseAdmin, job: SchedulerJob) {
  const config = job.config_json || {}
  const sireneDates = config.sireneDates || {}
  const timezone = job.timezone || 'Europe/Paris'

  const creationRange = resolveSireneDateRange(sireneDates.creation, timezone)
  const cessationRange = resolveSireneDateRange(sireneDates.cessation, timezone)

  const patch: Record<string, any> = {
    updated_at: new Date().toISOString(),
  }

  if (creationRange?.min && creationRange?.max) {
    patch.date_creation_min = creationRange.min
    patch.date_creation_max = creationRange.max
  }

  if (cessationRange?.min && cessationRange?.max) {
    patch.date_modification_min = cessationRange.min
    patch.date_modification_max = cessationRange.max
  }

  if (Object.keys(patch).length <= 1) {
    return { creationRange, cessationRange, patch: null }
  }

  const { data, error } = await supabase
    .from('import_sirene_params')
    .select('id')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data?.id) throw new Error('Aucun paramètre SIRENE trouvé dans import_sirene_params.')

  const { error: updateError } = await supabase
    .from('import_sirene_params')
    .update(patch)
    .eq('id', data.id)

  if (updateError) throw updateError

  return { creationRange, cessationRange, patch }
}

async function getClientMaintenanceStatus(supabase: SupabaseAdmin, clientRunId?: string | null) {
  let query = supabase
    .from('client_maintenance_runs')
    .select('id,status,message,error_message,created_at,started_at,finished_at')
    .order('created_at', { ascending: false })
    .limit(1)

  if (clientRunId) query = query.eq('id', clientRunId)

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data || null
}

async function executeClientMaintenance(
  supabase: SupabaseAdmin,
  job: SchedulerJob,
  schedulerRun: SchedulerRun,
  origin: string
) {
  const secret = requiredEnv('CLIENT_MAINTENANCE_SECRET')
  const previousResult = schedulerRun.result_json || {}
  const maxIterations = Math.max(1, Math.min(Number(job.max_iterations || 8), 50))

  let clientRunId = previousResult.clientRunId || null
  let startJson = previousResult.startJson || null
  let dateOverrideResult = previousResult.dateOverrideResult || null

  if (!clientRunId) {
    dateOverrideResult = await applySireneDateOverrides(supabase, job)

const rawConfig = (job.config_json || {}) as Record<string, any>

// On retire sireneDates du config transmis à /api/client-maintenance/start,
// car il sert uniquement au scheduler pour calculer les dates dynamiques.
const { sireneDates, ...configWithoutSireneDates } = rawConfig

const config: Record<string, any> = {
  ...configWithoutSireneDates,
  resolvedSireneDates: {
    creation: dateOverrideResult.creationRange,
    cessation: dateOverrideResult.cessationRange,
  },
}

    const startUrl = new URL('/api/client-maintenance/start', origin)
    const startRes = await fetch(startUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-maintenance-secret': secret,
      },
      body: JSON.stringify({
        source: `scheduler:${job.job_key}`,
        config,
      }),
      cache: 'no-store',
    })

    startJson = await readJsonSafe(startRes)

    if (!startRes.ok || startJson?.success === false) {
      throw new Error(
        startJson?.error || startJson?.message || 'Erreur création run maintenance clients.'
      )
    }

    clientRunId = startJson?.run_id || startJson?.id || null

    await addSchedulerLog(supabase, schedulerRun.id, 'info', 'Run maintenance clients créé.', {
      startJson,
      dateOverrideResult,
    })
  }


  const workerUrl = new URL('/api/cron/client-maintenance-worker', origin)
workerUrl.searchParams.set('iterations', String(maxIterations))

const workerRes = await fetch(workerUrl.toString(), {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-client-maintenance-secret': secret,
  },
  body: JSON.stringify({
    iterations: maxIterations,
  }),
  cache: 'no-store',
})

  const workerJson = await readJsonSafe(workerRes)

  if (!workerRes.ok || workerJson?.success === false) {
    throw new Error(workerJson?.error || workerJson?.message || 'Erreur worker maintenance clients.')
  }

  const clientStatus = await getClientMaintenanceStatus(supabase, clientRunId)
  const stillRunning = clientStatus?.status === 'queued' || clientStatus?.status === 'running'

  return {
    done: !stillRunning,
    status: clientStatus?.status || 'unknown',
    message: stillRunning
      ? 'Maintenance clients en cours, reprise au prochain passage scheduler.'
      : 'Maintenance clients terminée.',
    result: {
      clientRunId,
      startJson,
      workerJson,
      clientStatus,
      dateOverrideResult,
    },
  }
}

async function executeHttpRoute(job: SchedulerJob, origin: string) {
  const config = job.config_json || {}
  const routePath = config.routePath || config.path
  if (!routePath) throw new Error('config_json.routePath manquant pour job http_route.')

  const method = String(config.method || 'POST').toUpperCase()
  const url = new URL(routePath, origin)
  const body = buildSchedulerHttpBody(job)

  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  }

  if (method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(body)
  } else {
    Object.entries(body).forEach(([key, value]) => {
      if (value === null || value === undefined) return
      if (typeof value === 'object') return
      url.searchParams.set(key, String(value))
    })
  }

  const res = await fetch(url.toString(), init)
  const json = await readJsonSafe(res)

  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Erreur route ${routePath}`)
  }

  return {
    done: true,
    status: 'done',
    message: `Route ${routePath} exécutée.`,
    result: {
      response: json,
      request: {
        routePath,
        method,
        body,
      },
    },
  }
}

export async function executeSchedulerRun(params: {
  supabase: SupabaseAdmin
  job: SchedulerJob
  schedulerRun: SchedulerRun
}) {
  const { supabase, job, schedulerRun } = params
  const origin = getAppOrigin()
  const startedAt = new Date().toISOString()

  await supabase
    .from('scheduler_runs')
    .update({
      status: 'running',
      started_at: schedulerRun.status === 'queued' ? startedAt : undefined,
      updated_at: startedAt,
      message: `Traitement en cours : ${job.job_label}`,
    })
    .eq('id', schedulerRun.id)

  await addSchedulerLog(supabase, schedulerRun.id, 'info', `Exécution ${job.job_label}`)

  let executionResult: any

  if (job.job_type === 'client_maintenance') {
    executionResult = await executeClientMaintenance(supabase, job, schedulerRun, origin)
  } else if (job.job_type === 'http_route') {
    executionResult = await executeHttpRoute(job, origin)
  } else {
    const config = job.config_json || {}
    if (config.routePath || config.path) {
      executionResult = await executeHttpRoute(job, origin)
    } else {
      throw new Error(`Type de job non supporté : ${job.job_type}`)
    }
  }

  const status = executionResult.done ? executionResult.status || 'done' : 'running'
  const now = new Date().toISOString()

  await supabase
    .from('scheduler_runs')
    .update({
      status,
      finished_at: executionResult.done ? now : null,
      message: executionResult.message,
      result_json: executionResult.result || {},
      updated_at: now,
    })
    .eq('id', schedulerRun.id)

  await addSchedulerLog(
    supabase,
    schedulerRun.id,
    executionResult.done ? 'info' : 'warning',
    executionResult.message,
    executionResult.result || {}
  )

  return { ...executionResult, schedulerRunStatus: status }
}

export async function createSchedulerRun(
  supabase: SupabaseAdmin,
  job: SchedulerJob,
  triggerSource: 'cron' | 'manual' | 'continuation' = 'cron'
) {
  const { data, error } = await supabase
    .from('scheduler_runs')
    .insert({
      job_id: job.id,
      job_key: job.job_key,
      job_type: job.job_type,
      status: 'queued',
      trigger_source: triggerSource,
      message: 'Traitement planifié.',
    })
    .select('*')
    .single()

  if (error) throw error
  return data as SchedulerRun
}

export async function runDueSchedulerJobs(_origin?: string) {
  const supabase = createSupabaseAdmin()
  const now = new Date().toISOString()
  const results: any[] = []

  // 1. Reprendre d'abord les runs scheduler déjà en cours.
  const { data: runningRuns, error: runningError } = await supabase
    .from('scheduler_runs')
    .select('*, scheduler_jobs(*)')
    .eq('status', 'running')
    .order('created_at', { ascending: true })
    .limit(5)

  if (runningError) throw runningError

  for (const run of runningRuns || []) {
    const job = run.scheduler_jobs as SchedulerJob | null
    if (!job) continue

    if (job.archived_at) {
      await supabase
        .from('scheduler_runs')
        .update({
          status: 'cancelled',
          finished_at: new Date().toISOString(),
          message: 'Run annulé : job archivé.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', run.id)

      results.push({ job_key: job.job_key, resumed: true, cancelled: true, reason: 'job archived' })
      continue
    }

    try {
      const execution = await executeSchedulerRun({
        supabase,
        job,
        schedulerRun: run as SchedulerRun,
      })
      results.push({ job_key: job.job_key, resumed: true, execution })
    } catch (error: any) {
      await supabase
        .from('scheduler_runs')
        .update({
          status: job.continue_on_error === false ? 'error' : 'partial',
          finished_at: new Date().toISOString(),
          error_message: error?.message || String(error),
          message: 'Erreur traitement scheduler.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', run.id)

      await addSchedulerLog(supabase, run.id, 'error', 'Erreur reprise traitement.', {
        error: error?.message || String(error),
      })

      results.push({ job_key: job.job_key, resumed: true, error: error?.message || String(error) })
    }
  }

  // 2. Lancer les jobs dus.
  const { data: jobs, error: jobsError } = await supabase
    .from('scheduler_jobs')
    .select('*')
    .eq('enabled', true)
    .is('archived_at', null)
    .or(`next_run_at.is.null,next_run_at.lte.${now}`)
    .order('next_run_at', { ascending: true, nullsFirst: true })
    .limit(10)

  if (jobsError) throw jobsError

  for (const job of (jobs || []) as SchedulerJob[]) {
    if (job.frequency === 'manual') continue

    if (!job.allow_overlap) {
      const { data: activeRun, error: activeError } = await supabase
        .from('scheduler_runs')
        .select('id,status')
        .eq('job_id', job.id)
        .eq('status', 'running')
        .limit(1)
        .maybeSingle()

      if (activeError) throw activeError
      if (activeRun?.id) continue
    }

    const schedulerRun = await createSchedulerRun(supabase, job, 'cron')

    try {
      const execution = await executeSchedulerRun({
        supabase,
        job,
        schedulerRun,
      })

      const nextRunAt = computeNextRunAt(job)

      await supabase
        .from('scheduler_jobs')
        .update({
          last_run_at: now,
          last_status: execution.schedulerRunStatus,
          next_run_at: nextRunAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      results.push({ job_key: job.job_key, launched: true, execution, next_run_at: nextRunAt })
    } catch (error: any) {
      const nextRunAt = computeNextRunAt(job)

      await supabase
        .from('scheduler_runs')
        .update({
          status: job.continue_on_error === false ? 'error' : 'partial',
          finished_at: new Date().toISOString(),
          error_message: error?.message || String(error),
          message: 'Erreur traitement scheduler.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', schedulerRun.id)

      await supabase
        .from('scheduler_jobs')
        .update({
          last_run_at: now,
          last_status: job.continue_on_error === false ? 'error' : 'partial',
          next_run_at: nextRunAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      await addSchedulerLog(supabase, schedulerRun.id, 'error', 'Erreur traitement scheduler.', {
        error: error?.message || String(error),
      })

      results.push({ job_key: job.job_key, launched: true, error: error?.message || String(error) })
    }
  }

  return results
}

export async function recomputeAllMissingNextRuns() {
  const supabase = createSupabaseAdmin()

  const { data: jobs, error } = await supabase
    .from('scheduler_jobs')
    .select('*')
    .is('next_run_at', null)
    .is('archived_at', null)
    .neq('frequency', 'manual')

  if (error) throw error

  for (const job of (jobs || []) as SchedulerJob[]) {
    await supabase
      .from('scheduler_jobs')
      .update({
        next_run_at: computeNextRunAt(job),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
  }
}
