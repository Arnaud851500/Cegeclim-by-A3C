import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

type PdfRequest = {
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
}

type AuthorizedCaller = {
  mode: 'trusted_secret' | 'user_session' | 'cron_secret'
  email?: string | null
}

type PdfJobRow = {
  id: number
  report_type: string
  status: string
  step: string | null
  bucket: string | null
  path: string | null
  filename: string | null
  payload: PdfRequest | null
  trace: any[] | null
  attempt_count: number | null
  updated_at: string
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

function appendParam(url: URL, key: string, value: string | number | boolean | undefined | null) {
  if (value !== undefined && value !== null && String(value).trim() !== '') {
    url.searchParams.set(key, String(value))
  }
}

function redactSecretInUrl(url: string) {
  return url.replace(/(render_secret=)[^&]+/gi, '$1***').replace(/(cron_secret=)[^&]+/gi, '$1***')
}

function timeoutMs(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} : timeout après ${ms} ms`)), ms)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function buildSupabaseAdmin() {
  const supabaseUrl = getRequiredEnv('SUPABASE_URL')
  const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
}

async function authorizeRequest(req: NextRequest, supabaseAdmin: SupabaseClient): Promise<AuthorizedCaller> {
  const trustedSecret = process.env.REPORT_PDF_RENDER_SECRET || process.env.INTERNAL_API_SECRET || ''
  const incomingSecret =
    req.headers.get('x-report-secret') ||
    req.headers.get('x-internal-secret') ||
    req.nextUrl.searchParams.get('cron_secret') ||
    ''

  if (trustedSecret && incomingSecret && incomingSecret === trustedSecret) {
    return { mode: req.nextUrl.searchParams.get('cron_secret') ? 'cron_secret' : 'trusted_secret' }
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

function buildFocusPrintUrl(payload: PdfRequest = {}) {
  const focusBaseUrl = getRequiredEnv('FOCUS_MENSUEL_PRINT_URL')
  const renderSecret = getRequiredEnv('REPORT_PDF_RENDER_SECRET')

  const focusUrl = new URL(focusBaseUrl)
  const focusDate = payload.focus_date || payload.focusDate
  const horsStatistiques = payload.hors_statistiques || payload.horsStatistiques || 'afficher'
  const familleMacro = payload.famille_macro || payload.familleMacro || null
  const caProjete = payload.caProjeteFactures ?? payload.ca_projete_factures ?? payload.ca_projete_factures_mois_en_cours ?? '1'

  appendParam(focusUrl, 'pdf', '1')
  appendParam(focusUrl, 'print', '1')
  appendParam(focusUrl, 'render_secret', renderSecret)
  appendParam(focusUrl, 'month', payload.month)
  appendParam(focusUrl, 'focusDate', focusDate)
  appendParam(focusUrl, 'focus_date', focusDate)
  appendParam(focusUrl, 'horsStatistiques', horsStatistiques)
  appendParam(focusUrl, 'hors_statistiques', horsStatistiques)
  appendParam(focusUrl, 'view', payload.view || 'montant_ht')
  appendParam(focusUrl, 'agence', payload.agence)
  appendParam(focusUrl, 'familleMacro', familleMacro)
  appendParam(focusUrl, 'famille_macro', familleMacro)
  appendParam(focusUrl, 'collaborateur', payload.collaborateur)
  appendParam(focusUrl, 'caProjeteFactures', caProjete)
  appendParam(focusUrl, 'ca_projete_factures', caProjete)
  appendParam(focusUrl, 'render_ts', Date.now())

  return focusUrl
}

async function launchBrowser() {
  const executablePath = await chromium.executablePath()

  return puppeteer.launch({
    args: [
      ...chromium.args,
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--font-render-hinting=none',
    ],
    executablePath,
    headless: true,
    protocolTimeout: timeoutMs('FOCUS_PDF_PROTOCOL_TIMEOUT_MS', 240000),
    defaultViewport: {
      width: Number(process.env.FOCUS_PDF_VIEWPORT_WIDTH || 1920),
      height: Number(process.env.FOCUS_PDF_VIEWPORT_HEIGHT || 1200),
      deviceScaleFactor: 1,
    },
  })
}

async function readJob(supabaseAdmin: SupabaseClient, jobId: number): Promise<PdfJobRow> {
  const { data, error } = await supabaseAdmin
    .from('report_pdf_jobs')
    .select('id, report_type, status, step, bucket, path, filename, payload, trace, attempt_count, updated_at')
    .eq('id', jobId)
    .single()

  if (error) throw new Error(`Lecture job PDF impossible : ${error.message}`)
  return data as PdfJobRow
}

async function pickPendingJob(supabaseAdmin: SupabaseClient): Promise<PdfJobRow | null> {
  const { data, error } = await supabaseAdmin
    .from('report_pdf_jobs')
    .select('id, report_type, status, step, bucket, path, filename, payload, trace, attempt_count, updated_at')
    .eq('report_type', 'focus_mensuel')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Recherche job PDF pending impossible : ${error.message}`)
  return (data as PdfJobRow | null) || null
}

function isStillRecentlyRunning(job: PdfJobRow) {
  if (job.status !== 'running') return false
  const updatedAt = new Date(job.updated_at).getTime()
  return Number.isFinite(updatedAt) && Date.now() - updatedAt < timeoutMs('FOCUS_PDF_RUNNING_STALE_MS', 6 * 60 * 1000)
}

async function updateJob(
  supabaseAdmin: SupabaseClient,
  job: PdfJobRow,
  step: string,
  extra: Record<string, unknown> = {}
) {
  const currentTrace = Array.isArray(job.trace) ? job.trace : []
  const entry = {
    step,
    at: new Date().toISOString(),
    ...extra,
  }
  const nextTrace = [...currentTrace, entry].slice(-80)
  job.trace = nextTrace
  job.step = step
  job.updated_at = new Date().toISOString()

  const patch: Record<string, unknown> = {
    step,
    trace: nextTrace,
    updated_at: job.updated_at,
  }

  if (extra.status !== undefined) patch.status = extra.status
  if (extra.error_message !== undefined) patch.error_message = extra.error_message
  if (extra.bytes !== undefined) patch.bytes = extra.bytes
  if (extra.finished_at !== undefined) patch.finished_at = extra.finished_at
  if (extra.started_at !== undefined) patch.started_at = extra.started_at
  if (extra.attempt_count !== undefined) patch.attempt_count = extra.attempt_count

  const { error } = await supabaseAdmin
    .from('report_pdf_jobs')
    .update(patch)
    .eq('id', job.id)

  if (error) console.warn(`Mise à jour job PDF ${job.id} étape ${step} impossible :`, error.message)
}

async function claimJob(supabaseAdmin: SupabaseClient, requestedJobId?: number | null): Promise<PdfJobRow | null> {
  const job = requestedJobId ? await readJob(supabaseAdmin, requestedJobId) : await pickPendingJob(supabaseAdmin)
  if (!job) return null

  if (job.status === 'done') return job
  if (isStillRecentlyRunning(job)) {
    throw new Error(`Job ${job.id} déjà en cours depuis moins de quelques minutes (${job.step || 'étape inconnue'}).`)
  }

  const attemptCount = Number(job.attempt_count || 0) + 1
  const { error } = await supabaseAdmin
    .from('report_pdf_jobs')
    .update({
      status: 'running',
      step: 'picked_by_worker',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      attempt_count: attemptCount,
    })
    .eq('id', job.id)
    .in('status', ['pending', 'error', 'running'])

  if (error) throw new Error(`Prise en charge job PDF impossible : ${error.message}`)

  job.status = 'running'
  job.step = 'picked_by_worker'
  job.attempt_count = attemptCount
  await updateJob(supabaseAdmin, job, 'picked_by_worker', { status: 'running', attempt_count: attemptCount })
  return job
}

function hasLoginText(bodyText: string) {
  return bodyText.includes('Mot de passe') && bodyText.includes('Connexion') && bodyText.includes('SUIVI COMMERCIAL & PROSPECT')
}

async function readPageState(page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-focus-report-ready], [data-report-ready]') as HTMLElement | null
    const bodyText = document.body?.innerText || ''
    const hasReportTitle = /ACTIVITE\s+CEGECLIM/i.test(bodyText)
    const hasCards = /Devis/i.test(bodyText) && /CDC/i.test(bodyText) && /\bBL\b/i.test(bodyText) && /Factures/i.test(bodyText)
    const hasMainContent = hasReportTitle && hasCards

    return {
      url: window.location.href,
      title: document.title,
      ready: root?.getAttribute('data-focus-report-ready') || root?.getAttribute('data-report-ready') || null,
      status: root?.getAttribute('data-focus-report-status') || root?.getAttribute('data-report-status') || null,
      loading: root?.getAttribute('data-focus-report-loading') || null,
      comparisonReady: root?.getAttribute('data-focus-comparison-ready') || null,
      comparisonProgress: root?.getAttribute('data-focus-comparison-progress') || null,
      projectedCurrentMonthFactures: root?.getAttribute('data-focus-projected-current-month-factures') || null,
      hasReportTitle,
      hasCards,
      hasMainContent,
      hasVisibleError: /Erreur chargement|Erreur rapport|Génération PDF impossible|statement timeout|canceling statement|Failed to fetch/i.test(bodyText),
      bodyPreview: bodyText.slice(0, 1200),
    }
  })
}

async function waitForStableReport(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>,
  mark: (step: string, extra?: Record<string, unknown>) => Promise<void>
) {
  const startedAt = Date.now()

  // IMPORTANT Vercel / serverless : cette étape ne doit jamais durer plusieurs minutes.
  // La route process doit garder du temps pour page.pdf() + upload Storage.
  // On plafonne volontairement les variables d'environnement pour éviter un nouveau blocage
  // en waiting_page_stable si FOCUS_PDF_FALLBACK_MIN_WAIT_MS vaut encore 75000 ou 120000.
  const minFallbackMs = Math.min(timeoutMs('FOCUS_PDF_FALLBACK_MIN_WAIT_MS', 12000), 20000)
  const titleFallbackMs = Math.min(timeoutMs('FOCUS_PDF_TITLE_FALLBACK_MIN_WAIT_MS', 22000), 30000)
  const hardMaxMs = Math.min(timeoutMs('FOCUS_PDF_READY_HARD_TIMEOUT_MS', 35000), 45000)
  let lastState: any = null

  while (Date.now() - startedAt < hardMaxMs) {
    lastState = await readPageState(page)
    const elapsedMs = Date.now() - startedAt
    const redactedState = {
      ...lastState,
      url: redactSecretInUrl(String(lastState.url || '')),
    }

    await mark('waiting_page_stable', {
      elapsed_ms: elapsedMs,
      page_state: redactedState,
    })

    const bodyPreview = String(lastState.bodyPreview || '')
    if (String(lastState.url || '').includes('/login') || hasLoginText(bodyPreview)) {
      throw new Error(`La page print a chargé l'écran de connexion. URL=${redactSecretInUrl(String(lastState.url || ''))}`)
    }

    if (lastState.status === 'error' || lastState.hasVisibleError) {
      throw new Error(`La page Focus indique une erreur avant génération PDF. Aperçu=${bodyPreview.slice(0, 700)}`)
    }

    if (lastState.ready === '1') {
      await mark('page_ready_marker_found', { elapsed_ms: elapsedMs })
      return { mode: 'ready_marker', state: lastState }
    }

    // Sortie de secours principale : les blocs essentiels sont visibles.
    if (elapsedMs >= minFallbackMs && lastState.hasMainContent) {
      await mark('page_fallback_ready_main_content', {
        elapsed_ms: elapsedMs,
        warning: 'Génération autorisée sans data-focus-report-ready=1 : contenu principal visible et aucune erreur bloquante.',
        page_state: redactedState,
      })
      return { mode: 'fallback_main_content', state: lastState }
    }

    // Sortie de secours renforcée : le titre du rapport est visible, mais les cartes ne sont pas toutes détectées
    // dans innerText. Cela évite de laisser mourir la fonction serverless sur un compteur secondaire 35/36.
    if (elapsedMs >= titleFallbackMs && lastState.hasReportTitle) {
      await mark('page_force_ready_report_title', {
        elapsed_ms: elapsedMs,
        warning: 'Génération forcée : titre rapport visible, absence d’erreur bloquante, attente stabilité plafonnée.',
        page_state: redactedState,
      })
      return { mode: 'fallback_report_title', state: lastState }
    }

    await sleep(3000)
  }

  if (lastState?.hasReportTitle && !lastState?.hasVisibleError && lastState?.status !== 'error') {
    await mark('page_hard_timeout_force_ready', {
      elapsed_ms: Date.now() - startedAt,
      warning: 'Timeout stabilité atteint : génération forcée car le rapport est visible.',
      page_state: {
        ...lastState,
        url: redactSecretInUrl(String(lastState.url || '')),
      },
    })
    return { mode: 'hard_timeout_report_title', state: lastState }
  }

  throw new Error(`Timeout attente page Focus stable après ${hardMaxMs} ms. Dernier état=${JSON.stringify(lastState)}`)
}

async function addPrintCss(page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>) {
  await page.addStyleTag({
    content: `
      @page { size: A4 landscape; margin: 3mm 3mm 3mm 3mm; }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: #eef5fb !important;
        background-color: #eef5fb !important;
        background-image: none !important;
      }
      body, * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      body::before, body::after, main::before, main::after, section::before, section::after {
        content: none !important;
        display: none !important;
        background: transparent !important;
        background-image: none !important;
        box-shadow: none !important;
        filter: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
      [data-focus-report-ready], [data-report-ready] {
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
        background: #eef5fb !important;
        background-color: #eef5fb !important;
        background-image: none !important;
        isolation: isolate !important;
      }
      [data-focus-report-ready] *,
      [data-focus-report-ready] *::before,
      [data-focus-report-ready] *::after {
        filter: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
      [data-no-print="true"], .no-print, .focus-pdf-header-actions { display: none !important; }
      .focus-pdf-brand-header,
      .focus-pdf-filters,
      .focus-pdf-kpi-card,
      .focus-pdf-chart-box,
      .focus-pdf-section-card {
        background: #ffffff !important;
        background-color: #ffffff !important;
        background-image: none !important;
        box-shadow: none !important;
        filter: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
      .focus-pdf-brand-header,
      .focus-pdf-filters,
      .focus-pdf-kpi-card,
      .focus-pdf-chart-box,
      .focus-pdf-section-card,
      .focus-pdf-table-wrap,
      table, thead, tbody, tr, th, td {
        position: relative !important;
        z-index: 1 !important;
      }
    `,
  })
}

async function processJob(req: NextRequest) {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null
  let job: PdfJobRow | null = null
  let caller: AuthorizedCaller | null = null
  const supabaseAdmin = buildSupabaseAdmin()

  async function mark(step: string, extra: Record<string, unknown> = {}) {
    if (!job) return
    await updateJob(supabaseAdmin, job, step, extra)
  }

  try {
    caller = await authorizeRequest(req, supabaseAdmin)
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const jobId = Number(body?.job_id || req.nextUrl.searchParams.get('job_id') || 0) || null

    job = await claimJob(supabaseAdmin, jobId)
    if (!job) {
      return NextResponse.json({ ok: true, processed: false, message: 'Aucun job PDF pending.' })
    }

    if (job.status === 'done') {
      return NextResponse.json({ ok: true, processed: false, job_id: job.id, status: 'done', message: 'Job déjà terminé.' })
    }

    const payload = job.payload || {}
    const bucket = job.bucket || payload.bucket || DEFAULT_BUCKET
    const pdfPath = job.path || payload.path || DEFAULT_PATH
    const filename = job.filename || payload.filename || DEFAULT_FILENAME
    const focusUrl = buildFocusPrintUrl(payload)

    await mark('launching_browser', { target_url: redactSecretInUrl(focusUrl.toString()), caller })
    browser = await withTimeout(launchBrowser(), timeoutMs('FOCUS_PDF_LAUNCH_TIMEOUT_MS', 30000), 'Lancement Chromium')

    await mark('new_page')
    const page = await browser.newPage()

    const consoleMessages: string[] = []
    const requestFailures: string[] = []

    page.on('console', (message) => {
      consoleMessages.push(`[${message.type()}] ${message.text()}`.slice(0, 500))
      if (consoleMessages.length > 25) consoleMessages.shift()
    })

    page.on('requestfailed', (request) => {
      const failure = request.failure()
      requestFailures.push(`${request.method()} ${request.url()} :: ${failure?.errorText || 'request failed'}`.slice(0, 500))
      if (requestFailures.length > 25) requestFailures.shift()
    })

    await page.setViewport({
      width: Number(process.env.FOCUS_PDF_VIEWPORT_WIDTH || 1920),
      height: Number(process.env.FOCUS_PDF_VIEWPORT_HEIGHT || 1200),
      deviceScaleFactor: 1,
    })
    await page.emulateMediaType('screen')
    page.setDefaultTimeout(timeoutMs('FOCUS_PDF_DEFAULT_TIMEOUT_MS', 120000))
    page.setDefaultNavigationTimeout(timeoutMs('FOCUS_PDF_GOTO_TIMEOUT_MS', 60000))

    await page.setRequestInterception(true)
    page.on('request', (request) => {
      const type = request.resourceType()
      if (['media', 'websocket', 'eventsource'].includes(type)) {
        void request.abort()
        return
      }
      void request.continue()
    })

    await mark('opening_print_page')
    const response = await withTimeout(
      page.goto(focusUrl.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs('FOCUS_PDF_GOTO_TIMEOUT_MS', 60000),
      }),
      timeoutMs('FOCUS_PDF_GOTO_HARD_TIMEOUT_MS', 75000),
      'Ouverture page print Focus Mensuel'
    )

    const httpStatus = response?.status() || null
    await mark('print_page_opened', { http_status: httpStatus, loaded_url: redactSecretInUrl(page.url()) })
    if (httpStatus && httpStatus >= 400) {
      throw new Error(`La page Focus print répond HTTP ${httpStatus}. URL=${redactSecretInUrl(focusUrl.toString())}`)
    }

    await waitForStableReport(page, mark)

    await mark('checking_page_state')
    const pageState = await readPageState(page)
    await mark('page_state_checked', {
      page_state: {
        ...pageState,
        url: redactSecretInUrl(String(pageState.url || '')),
      },
      console_messages: consoleMessages,
      request_failures: requestFailures,
    })

    if (pageState.status === 'error' || pageState.hasVisibleError) {
      throw new Error(`La page Focus indique une erreur avant rendu PDF. Aperçu=${String(pageState.bodyPreview || '').slice(0, 700)}`)
    }

    await addPrintCss(page)
    await mark('stabilizing_layout')
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

    await mark('rendering_pdf')
    const pdf = await withTimeout(
      page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '3mm', right: '3mm', bottom: '3mm', left: '3mm' },
        scale: Number(process.env.FOCUS_PDF_LANDSCAPE_SCALE || process.env.FOCUS_PDF_SCALE || 0.72),
      }),
      timeoutMs('FOCUS_PDF_RENDER_TIMEOUT_MS', 90000),
      'Rendu page.pdf()'
    )

    await mark('uploading_storage', { bytes: pdf.byteLength })
    const { error: uploadError } = await withTimeout(
      supabaseAdmin.storage.from(bucket).upload(pdfPath, pdf, {
        contentType: 'application/pdf',
        upsert: true,
      }),
      timeoutMs('FOCUS_PDF_UPLOAD_TIMEOUT_MS', 60000),
      'Upload Storage PDF'
    )
    if (uploadError) throw new Error(`Upload Storage impossible : ${uploadError.message}`)

    await mark('done', {
      status: 'done',
      bytes: pdf.byteLength,
      finished_at: new Date().toISOString(),
    })

    return NextResponse.json({
      ok: true,
      processed: true,
      job_id: job.id,
      status: 'done',
      bucket,
      path: pdfPath,
      filename,
      bytes: pdf.byteLength,
      focus_url: redactSecretInUrl(focusUrl.toString()),
      loaded_url: redactSecretInUrl(page.url()),
      caller,
    })
  } catch (error) {
    const errorMessage = sanitizeError(error)
    if (job) {
      await mark('error', {
        status: 'error',
        error_message: errorMessage,
        finished_at: new Date().toISOString(),
      })
    }

    return NextResponse.json({ ok: false, job_id: job?.id || null, error: errorMessage, caller }, { status: 500 })
  } finally {
    if (browser) await browser.close().catch(() => undefined)
  }
}

export async function POST(req: NextRequest) {
  return processJob(req)
}

export async function GET(req: NextRequest) {
  return processJob(req)
}
