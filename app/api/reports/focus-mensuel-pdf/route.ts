import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

type PdfRequest = {
  run_id?: number
  bucket?: string
  path?: string
  filename?: string
  month?: string
  focus_date?: string
  focusDate?: string
  hors_statistiques?: 'afficher' | 'masquer' | string
  horsStatistiques?: 'afficher' | 'masquer' | string
  view?: string
  agence?: string | null
  famille_macro?: string | null
  familleMacro?: string | null
  collaborateur?: string | null
  caProjeteFactures?: string | number | boolean | null
  ca_projete_factures?: string | number | boolean | null
  ca_projete_factures_mois_en_cours?: string | number | boolean | null
  comparison_snapshot_id?: string | null
  comparisonSnapshotId?: string | null
}

type AuthorizedCaller = {
  mode: 'trusted_secret' | 'user_session'
  email?: string | null
}

const DEFAULT_BUCKET = 'commercial-imports'
const DEFAULT_PATH = 'reports/focus-mensuel/Rapport_activite_quotidien.pdf'
const DEFAULT_FILENAME = "Rapport d'activité quotidien.pdf"

function getRequiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

function sanitizeError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function buildSupabaseAdmin() {
  const supabaseUrl = getRequiredEnv('SUPABASE_URL')
  const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
}

async function authorizeRequest(req: NextRequest, supabaseAdmin: SupabaseClient): Promise<AuthorizedCaller> {
  const trustedSecret = process.env.REPORT_PDF_RENDER_SECRET || process.env.INTERNAL_API_SECRET || ''
  const incomingSecret = req.headers.get('x-report-secret') || req.headers.get('x-internal-secret') || ''

  if (trustedSecret && incomingSecret && incomingSecret === trustedSecret) {
    return { mode: 'trusted_secret' }
  }

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : ''

  if (!token) {
    throw new Error('Unauthorized : ajoute un Bearer token utilisateur ou le header interne x-report-secret.')
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) {
    throw new Error(`Unauthorized : session utilisateur invalide${error?.message ? ` (${error.message})` : ''}.`)
  }

  return { mode: 'user_session', email: data.user.email }
}

function appendTrace(step: string, extra: Record<string, unknown> = {}) {
  return [
    {
      step,
      at: new Date().toISOString(),
      ...extra,
    },
  ]
}

function normalizePayload(payload: PdfRequest): PdfRequest {
  const caProjete =
    payload.caProjeteFactures ??
    payload.ca_projete_factures ??
    payload.ca_projete_factures_mois_en_cours ??
    '1'

  return {
    ...payload,
    bucket: payload.bucket || DEFAULT_BUCKET,
    path: payload.path || DEFAULT_PATH,
    filename: payload.filename || DEFAULT_FILENAME,
    hors_statistiques: payload.hors_statistiques || payload.horsStatistiques || 'afficher',
    view: payload.view || 'montant_ht',
    agence: payload.agence || null,
    famille_macro: payload.famille_macro || payload.familleMacro || null,
    familleMacro: payload.familleMacro || payload.famille_macro || null,
    collaborateur: payload.collaborateur || null,
    caProjeteFactures: String(caProjete) === 'true' ? '1' : String(caProjete) === 'false' ? '0' : caProjete,
    ca_projete_factures: String(caProjete) === 'true' ? '1' : String(caProjete) === 'false' ? '0' : caProjete,
  }
}

async function getJobById(supabaseAdmin: SupabaseClient, jobId: number) {
  const { data, error } = await supabaseAdmin
    .from('report_pdf_jobs')
    .select('id, report_type, status, step, bucket, path, filename, payload, error_message, bytes, trace, created_at, started_at, finished_at, updated_at')
    .eq('id', jobId)
    .single()

  if (error) throw new Error(`Lecture job PDF impossible : ${error.message}`)
  return data
}

export async function GET(req: NextRequest) {
  try {
    const jobId = Number(req.nextUrl.searchParams.get('job_id') || 0)

    if (!jobId) {
      const debugSecret = req.nextUrl.searchParams.get('debug_secret') || req.nextUrl.searchParams.get('render_secret') || ''
      const expectedSecret = process.env.REPORT_PDF_RENDER_SECRET || ''
      if (!expectedSecret || debugSecret !== expectedSecret) {
        return NextResponse.json({ ok: false, error: 'job_id manquant.' }, { status: 400 })
      }

      return NextResponse.json({
        ok: true,
        route: '/api/reports/focus-mensuel-pdf',
        role: 'create_job_and_status',
        processRoute: '/api/reports/focus-mensuel-pdf/process',
        hasRenderSecret: Boolean(process.env.REPORT_PDF_RENDER_SECRET),
        hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
        hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      })
    }

    const supabaseAdmin = buildSupabaseAdmin()
    const caller = await authorizeRequest(req, supabaseAdmin)
    const job = await getJobById(supabaseAdmin, jobId)
    return NextResponse.json({ ok: true, caller, job })
  } catch (error) {
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = buildSupabaseAdmin()
    const caller = await authorizeRequest(req, supabaseAdmin)
    const payload = normalizePayload((await req.json()) as PdfRequest)
    const bucket = payload.bucket || DEFAULT_BUCKET
    const pdfPath = payload.path || DEFAULT_PATH
    const filename = payload.filename || DEFAULT_FILENAME

    const { data, error } = await supabaseAdmin
      .from('report_pdf_jobs')
      .insert({
        report_type: 'focus_mensuel',
        status: 'pending',
        step: 'created',
        bucket,
        path: pdfPath,
        filename,
        payload,
        created_by_email: caller.email || null,
        trace: appendTrace('created', {
          mode: caller.mode,
          email: caller.email || null,
        }),
        updated_at: new Date().toISOString(),
      })
      .select('id, status, step, bucket, path, filename, created_at, updated_at')
      .single()

    if (error) throw new Error(`Création job PDF impossible : ${error.message}`)

    return NextResponse.json({
      ok: true,
      job_id: data.id,
      status: data.status,
      step: data.step,
      bucket: data.bucket,
      path: data.path,
      filename: data.filename,
      message: 'Job PDF créé. La génération peut être traitée en arrière-plan.',
      caller,
    })
  } catch (error) {
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 })
  }
}
