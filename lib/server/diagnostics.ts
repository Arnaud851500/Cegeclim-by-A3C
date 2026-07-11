import { randomUUID } from 'crypto'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export type DiagnosticStatus = 'STARTED' | 'SUCCESS' | 'WARNING' | 'ERROR'

export type DiagnosticStep = {
  event_id?: string | null
  trace_id: string
  module: string
  action: string
  layer: string
  step: string
  object_name?: string | null
  run_id?: string | null
  batch_offset?: number | null
  batch_limit?: number | null
  started_at: string
  finished_at?: string | null
  duration_ms?: number | null
  status: DiagnosticStatus
  http_status?: number | null
  error_code?: string | null
  error_message?: string | null
  error_details?: string | null
  error_hint?: string | null
  error_context?: string | null
  row_count?: number | null
  context?: Record<string, unknown> | null
  raw_error?: unknown
}

export type DiagnosticReport = {
  trace_id: string
  module: string
  action: string
  status: 'SUCCESS' | 'WARNING' | 'ERROR'
  category?: string | null
  user_message?: string | null
  technical_message?: string | null
  started_at: string
  finished_at: string
  duration_ms: number
  steps: DiagnosticStep[]
}

type NormalizedError = {
  category: string
  userMessage: string
  technicalMessage: string
  httpStatus: number
  code: string | null
  details: string | null
  hint: string | null
  context: string | null
  raw: unknown
}

type TraceMeta = {
  module: string
  action: string
  traceId?: string
  runId?: string | null
}

type StepMeta = {
  layer: string
  step: string
  objectName?: string | null
  runId?: string | null
  batchOffset?: number | null
  batchLimit?: number | null
  context?: Record<string, unknown> | null
}

type RunStepOptions = StepMeta & {
  rowCount?: (data: unknown) => number | null
}

export class DiagnosticError extends Error {
  readonly report: DiagnosticReport
  readonly httpStatus: number
  readonly causeValue: unknown

  constructor(report: DiagnosticReport, httpStatus: number, causeValue?: unknown) {
    super(report.user_message || report.technical_message || 'Erreur technique')
    this.name = 'DiagnosticError'
    this.report = report
    this.httpStatus = httpStatus
    this.causeValue = causeValue
  }
}

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

function supabaseUrl() {
  return process.env.SUPABASE_URL || requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
}

export function createAdminClient(traceId?: string) {
  const headers: Record<string, string> = {}
  if (traceId) headers['x-trace-id'] = traceId

  return createClient(supabaseUrl(), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
  })
}

export function makeTraceId(prefix = 'APP') {
  const now = new Date()
  const stamp = now
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14)
  return `${prefix}-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`
}

export function resolveTraceId(req: NextRequest, prefix = 'APP') {
  const fromHeader = req.headers.get('x-trace-id')?.trim()
  if (fromHeader) return fromHeader.slice(0, 120)

  const fromQuery = new URL(req.url).searchParams.get('trace_id')?.trim()
  if (fromQuery) return fromQuery.slice(0, 120)

  return makeTraceId(prefix)
}

function text(value: unknown) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}


function jsonSafe(value: unknown) {
  if (value === undefined) return null
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, current) => {
        if (current instanceof Error) {
          return {
            name: current.name,
            message: current.message,
            stack: current.stack,
          }
        }
        if (typeof current === 'bigint') return current.toString()
        return current
      }),
    )
  } catch {
    return { value: text(value) }
  }
}

function pickHttpStatus(error: any) {
  const candidates = [error?.status, error?.statusCode, error?.response?.status]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value) && value >= 100 && value <= 599) return value
  }
  return 500
}

export function normalizeTechnicalError(error: unknown, fallback = 'Erreur technique inconnue.'): NormalizedError {
  const source: any = error || {}
  const message = text(source?.message || source?.error || error || fallback)
  const details = text(source?.details || source?.detail || source?.response?.data?.details) || null
  const hint = text(source?.hint) || null
  const context = text(source?.context || source?.where || source?.stack) || null
  const code = text(source?.code || source?.error_code || source?.response?.data?.code) || null
  const httpStatus = pickHttpStatus(source)
  const haystack = `${message} ${details || ''} ${hint || ''} ${context || ''} ${code || ''}`.toLowerCase()

  if (
    haystack.includes('ssl handshake failed') ||
    haystack.includes('error code 525') ||
    haystack.includes('cloudflare ray id') ||
    haystack.includes('cf-error-details')
  ) {
    return {
      category: 'supabase_gateway_ssl',
      userMessage: 'La connexion entre Supabase et son infrastructure réseau a échoué (SSL 525). Aucun correctif SQL ne doit être appliqué sur cette seule base.',
      technicalMessage: message || 'SSL handshake failed',
      httpStatus: 503,
      code: code || '525',
      details,
      hint,
      context,
      raw: error,
    }
  }

  if (
    haystack.includes('failed to fetch') ||
    haystack.includes('fetch failed') ||
    haystack.includes('networkerror') ||
    haystack.includes('network request failed') ||
    haystack.includes('econnreset') ||
    haystack.includes('enotfound')
  ) {
    return {
      category: 'network_transport',
      userMessage: 'La requête réseau n’a pas atteint correctement le service distant. Le diagnostic indique un problème de transport, pas encore un problème SQL.',
      technicalMessage: message || 'Network transport error',
      httpStatus: 503,
      code,
      details,
      hint,
      context,
      raw: error,
    }
  }

  if (
    code === '57014' ||
    haystack.includes('statement timeout') ||
    haystack.includes('canceling statement due to statement timeout') ||
    haystack.includes('connection terminated due to connection timeout')
  ) {
    return {
      category: 'postgres_timeout',
      userMessage: 'PostgreSQL a interrompu une requête trop longue. Le rapport technique identifie l’objet SQL, l’étape et le lot concernés.',
      technicalMessage: message || 'PostgreSQL statement timeout',
      httpStatus: 504,
      code: code || '57014',
      details,
      hint,
      context,
      raw: error,
    }
  }

  if (haystack.includes('timeout') || haystack.includes('timed out') || haystack.includes('aborted')) {
    return {
      category: 'request_timeout',
      userMessage: 'La requête a dépassé son délai. Le rapport technique permet de distinguer un délai Vercel, réseau ou PostgreSQL.',
      technicalMessage: message || 'Request timeout',
      httpStatus: 504,
      code,
      details,
      hint,
      context,
      raw: error,
    }
  }

  if (httpStatus === 401 || haystack.includes('jwt') || haystack.includes('session utilisateur invalide')) {
    return {
      category: 'authentication',
      userMessage: 'La session utilisateur n’est pas valide ou a expiré.',
      technicalMessage: message || 'Authentication error',
      httpStatus: 401,
      code,
      details,
      hint,
      context,
      raw: error,
    }
  }

  if (httpStatus === 403 || code === '42501' || haystack.includes('permission denied') || haystack.includes('row-level security')) {
    return {
      category: 'authorization',
      userMessage: 'La requête est bloquée par une autorisation ou une politique de sécurité.',
      technicalMessage: message || 'Authorization error',
      httpStatus: 403,
      code: code || '42501',
      details,
      hint,
      context,
      raw: error,
    }
  }

  if (
    code === '42P01' ||
    code === '42883' ||
    code === 'PGRST202' ||
    haystack.includes('does not exist') ||
    haystack.includes('could not find the function') ||
    haystack.includes('schema cache')
  ) {
    return {
      category: 'schema_object_missing',
      userMessage: 'Un objet SQL attendu est absent, mal nommé ou non visible dans le cache de schéma.',
      technicalMessage: message || 'Database object not found',
      httpStatus: 500,
      code,
      details,
      hint,
      context,
      raw: error,
    }
  }

  return {
    category: 'application_error',
    userMessage: fallback,
    technicalMessage: message || fallback,
    httpStatus,
    code,
    details,
    hint,
    context,
    raw: error,
  }
}

async function settleWithin<T>(promise: PromiseLike<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Diagnostic persistence timeout after ${timeoutMs} ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function consoleEvent(step: DiagnosticStep) {
  const payload = {
    diagnostic: true,
    ...step,
    raw_error: undefined,
  }
  const line = JSON.stringify(payload)
  if (step.status === 'ERROR') console.error(line)
  else if (step.status === 'WARNING') console.warn(line)
  else console.info(line)
}

export class DiagnosticTrace {
  readonly traceId: string
  readonly module: string
  readonly action: string
  readonly startedAt: Date
  private readonly admin: SupabaseClient
  private readonly defaultRunId: string | null
  private readonly steps: DiagnosticStep[] = []

  constructor(admin: SupabaseClient, meta: TraceMeta) {
    this.admin = admin
    this.traceId = meta.traceId || makeTraceId('APP')
    this.module = meta.module
    this.action = meta.action
    this.defaultRunId = meta.runId || null
    this.startedAt = new Date()
  }

  private async insertStart(step: DiagnosticStep) {
    consoleEvent(step)
    try {
      const result: any = await settleWithin<any>(
        this.admin
          .from('app_diagnostic_events')
          .insert({
            trace_id: step.trace_id,
            module: step.module,
            action: step.action,
            layer: step.layer,
            step: step.step,
            object_name: step.object_name || null,
            run_id: step.run_id || null,
            batch_offset: step.batch_offset ?? null,
            batch_limit: step.batch_limit ?? null,
            started_at: step.started_at,
            status: 'STARTED',
            context: step.context || {},
          })
          .select('id')
          .maybeSingle(),
        1800,
      )
      return result?.data?.id ? String(result.data.id) : null
    } catch (loggingError) {
      console.warn(
        JSON.stringify({
          diagnostic_logging_failed: true,
          trace_id: this.traceId,
          step: step.step,
          message: text((loggingError as any)?.message || loggingError),
        }),
      )
      return null
    }
  }

  private async updateFinish(step: DiagnosticStep) {
    consoleEvent(step)
    if (!step.event_id) return
    try {
      await settleWithin(
        this.admin
          .from('app_diagnostic_events')
          .update({
            finished_at: step.finished_at || new Date().toISOString(),
            duration_ms: step.duration_ms ?? null,
            status: step.status,
            http_status: step.http_status ?? null,
            error_code: step.error_code || null,
            error_message: step.error_message || null,
            error_details: step.error_details || null,
            error_hint: step.error_hint || null,
            error_context: step.error_context || null,
            row_count: step.row_count ?? null,
            context: step.context || {},
            raw_error: jsonSafe(step.raw_error),
          })
          .eq('id', step.event_id),
        1800,
      )
    } catch (loggingError) {
      console.warn(
        JSON.stringify({
          diagnostic_logging_failed: true,
          trace_id: this.traceId,
          step: step.step,
          message: text((loggingError as any)?.message || loggingError),
        }),
      )
    }
  }

  async runStep<T>(meta: RunStepOptions, fn: () => PromiseLike<T> | T): Promise<T> {
    const startedAt = new Date()
    const startedMs = Date.now()
    const base: DiagnosticStep = {
      trace_id: this.traceId,
      module: this.module,
      action: this.action,
      layer: meta.layer,
      step: meta.step,
      object_name: meta.objectName || null,
      run_id: meta.runId || this.defaultRunId,
      batch_offset: meta.batchOffset ?? null,
      batch_limit: meta.batchLimit ?? null,
      started_at: startedAt.toISOString(),
      status: 'STARTED',
      context: meta.context || {},
    }

    const eventId = await this.insertStart(base)

    try {
      // Les builders Supabase/PostgREST sont des PromiseLike (thenables), pas des Promise natives.
      // Promise.resolve les adopte correctement sans imposer les propriétés catch/finally de Promise.
      const result: any = await Promise.resolve(fn())
      if (result && typeof result === 'object' && 'error' in result && result.error) {
        const wrapped: any = result.error
        wrapped.status = wrapped.status || result.status
        throw wrapped
      }

      const data = result && typeof result === 'object' && 'data' in result ? result.data : result
      const rowCount = meta.rowCount
        ? meta.rowCount(data)
        : Array.isArray(data)
          ? data.length
          : null

      const finished: DiagnosticStep = {
        ...base,
        event_id: eventId,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedMs,
        status: 'SUCCESS',
        row_count: rowCount,
      }
      this.steps.push(finished)
      await this.updateFinish(finished)
      return result
    } catch (error) {
      const normalized = normalizeTechnicalError(error, `Erreur pendant l’étape ${meta.step}.`)
      const finished: DiagnosticStep = {
        ...base,
        event_id: eventId,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedMs,
        status: 'ERROR',
        http_status: normalized.httpStatus,
        error_code: normalized.code,
        error_message: normalized.technicalMessage,
        error_details: normalized.details,
        error_hint: normalized.hint,
        error_context: normalized.context,
        raw_error: normalized.raw,
      }
      this.steps.push(finished)
      await this.updateFinish(finished)
      throw new DiagnosticError(this.reportError(normalized), normalized.httpStatus, error)
    }
  }

  async recordManual(meta: StepMeta & {
    status: DiagnosticStatus
    durationMs?: number | null
    httpStatus?: number | null
    errorCode?: string | null
    errorMessage?: string | null
    errorDetails?: string | null
    errorHint?: string | null
    errorContext?: string | null
    rowCount?: number | null
    rawError?: unknown
  }) {
    const now = new Date().toISOString()
    const step: DiagnosticStep = {
      trace_id: this.traceId,
      module: this.module,
      action: this.action,
      layer: meta.layer,
      step: meta.step,
      object_name: meta.objectName || null,
      run_id: meta.runId || this.defaultRunId,
      batch_offset: meta.batchOffset ?? null,
      batch_limit: meta.batchLimit ?? null,
      started_at: now,
      finished_at: now,
      duration_ms: meta.durationMs ?? 0,
      status: meta.status,
      http_status: meta.httpStatus ?? null,
      error_code: meta.errorCode || null,
      error_message: meta.errorMessage || null,
      error_details: meta.errorDetails || null,
      error_hint: meta.errorHint || null,
      error_context: meta.errorContext || null,
      row_count: meta.rowCount ?? null,
      context: meta.context || {},
      raw_error: meta.rawError,
    }
    const eventId = await this.insertStart(step)
    step.event_id = eventId
    this.steps.push(step)
    await this.updateFinish(step)
  }

  reportSuccess(): DiagnosticReport {
    const finishedAt = new Date()
    const hasWarning = this.steps.some((step) => step.status === 'WARNING')
    return {
      trace_id: this.traceId,
      module: this.module,
      action: this.action,
      status: hasWarning ? 'WARNING' : 'SUCCESS',
      category: null,
      user_message: hasWarning ? 'Traitement terminé avec avertissement.' : null,
      technical_message: null,
      started_at: this.startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - this.startedAt.getTime(),
      steps: [...this.steps],
    }
  }

  reportError(normalized: NormalizedError): DiagnosticReport {
    const finishedAt = new Date()
    return {
      trace_id: this.traceId,
      module: this.module,
      action: this.action,
      status: 'ERROR',
      category: normalized.category,
      user_message: normalized.userMessage,
      technical_message: normalized.technicalMessage,
      started_at: this.startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - this.startedAt.getTime(),
      steps: [...this.steps],
    }
  }

  reportFromUnknown(error: unknown, fallback: string) {
    return this.reportError(normalizeTechnicalError(error, fallback))
  }
}

export function bearerToken(req: NextRequest) {
  return (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
}

export async function requireAuthenticatedUser(
  req: NextRequest,
  admin: SupabaseClient,
  trace: DiagnosticTrace,
) {
  const token = bearerToken(req)
  if (!token) {
    const error = { status: 401, code: 'AUTH_TOKEN_MISSING', message: 'Session utilisateur absente.' }
    await trace.recordManual({
      layer: 'authentication',
      step: 'validate_bearer_token',
      objectName: 'Authorization header',
      status: 'ERROR',
      httpStatus: 401,
      errorCode: 'AUTH_TOKEN_MISSING',
      errorMessage: error.message,
    })
    throw new DiagnosticError(trace.reportFromUnknown(error, error.message), 401, error)
  }

  const response = await trace.runStep(
    {
      layer: 'supabase_auth',
      step: 'validate_user_session',
      objectName: 'auth.getUser',
    },
    () => admin.auth.getUser(token),
  )

  const user = (response as any)?.data?.user
  if (!user) {
    const error = { status: 401, code: 'AUTH_USER_MISSING', message: 'Utilisateur non retourné par Supabase Auth.' }
    throw new DiagnosticError(trace.reportFromUnknown(error, error.message), 401, error)
  }
  return user
}

export function diagnosticJson(
  payload: Record<string, unknown>,
  report: DiagnosticReport,
  status = 200,
) {
  return NextResponse.json(
    { ...payload, trace_id: report.trace_id, diagnostic: report },
    { status, headers: { 'x-trace-id': report.trace_id } },
  )
}

export function diagnosticErrorJson(error: unknown, trace: DiagnosticTrace, fallback: string) {
  if (error instanceof DiagnosticError) {
    return diagnosticJson({ success: false, error: error.report.user_message }, error.report, error.httpStatus)
  }
  const normalized = normalizeTechnicalError(error, fallback)
  const report = trace.reportError(normalized)
  return diagnosticJson({ success: false, error: report.user_message }, report, normalized.httpStatus)
}