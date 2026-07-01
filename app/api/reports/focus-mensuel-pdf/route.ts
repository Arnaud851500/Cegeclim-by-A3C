import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

type PdfRequest = {
  run_id?: number
  bucket?: string
  path?: string
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
  filename?: string
  caProjeteFactures?: string | boolean | number | null
  ca_projete_factures?: string | boolean | number | null
  wait_for_ready_selector?: string | null
  wait_timeout_ms?: number | null
}

type AuthorizedCaller = {
  mode: 'trusted_secret' | 'user_session'
  email?: string | null
}

type TraceEntry = {
  step: string
  at: string
  ms_from_start: number
  extra?: Record<string, unknown>
}

function getRequiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

function appendParam(url: URL, key: string, value: string | undefined | null) {
  if (value !== undefined && value !== null && String(value).trim() !== '') {
    url.searchParams.set(key, String(value))
  }
}

function boolParam(value: unknown, defaultValue = '1') {
  if (value === undefined || value === null || value === '') return defaultValue
  if (value === true || value === 1 || String(value).toLowerCase() === 'true') return '1'
  if (value === false || value === 0 || String(value).toLowerCase() === 'false') return '0'
  return String(value)
}

function redactSecretInUrl(url: string) {
  return url.replace(/(render_secret=)[^&]+/gi, '$1***')
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

function buildFocusPrintUrl(payload: PdfRequest = {}) {
  const focusBaseUrl = getRequiredEnv('FOCUS_MENSUEL_PRINT_URL')
  const renderSecret = getRequiredEnv('REPORT_PDF_RENDER_SECRET')

  const focusUrl = new URL(focusBaseUrl)
  const focusDate = payload.focus_date || payload.focusDate
  const horsStatistiques = payload.hors_statistiques || payload.horsStatistiques || 'afficher'
  const familleMacro = payload.famille_macro || payload.familleMacro || null
  const caProjeteFactures = boolParam(payload.caProjeteFactures ?? payload.ca_projete_factures, '1')

  appendParam(focusUrl, 'pdf', '1')
  appendParam(focusUrl, 'render_secret', renderSecret)
  appendParam(focusUrl, 'render_ts', String(Date.now()))
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
  appendParam(focusUrl, 'caProjeteFactures', caProjeteFactures)
  appendParam(focusUrl, 'ca_projete_factures', caProjeteFactures)

  return focusUrl
}

function isLoginPageText(bodyText: string) {
  const text = String(bodyText || '')
  return (
    text.includes('Mot de passe') &&
    text.includes('Connexion') &&
    text.includes('SUIVI COMMERCIAL & PROSPECT')
  )
}

function hasFocusErrorText(bodyText: string) {
  return /Erreur chargement focus mensuel|Erreur chargement documents distincts|Erreur tableaux activité|Erreur rapport/i.test(
    String(bodyText || '')
  )
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
    defaultViewport: {
      width: Number(process.env.FOCUS_PDF_VIEWPORT_WIDTH || 1920),
      height: Number(process.env.FOCUS_PDF_VIEWPORT_HEIGHT || 1200),
      deviceScaleFactor: 1,
    },
  })
}

async function createPdfJob(
  supabaseAdmin: SupabaseClient,
  bucket: string,
  path: string,
  payload: PdfRequest
): Promise<number | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('report_pdf_jobs')
      .insert({
        report_type: 'focus_mensuel',
        status: 'running',
        step: 'starting',
        bucket,
        path,
        payload: payload as any,
      })
      .select('id')
      .single()

    if (error) {
      console.warn('Création report_pdf_jobs impossible', error.message)
      return null
    }

    return Number(data?.id || 0) || null
  } catch (error) {
    console.warn('Table report_pdf_jobs indisponible', sanitizeError(error))
    return null
  }
}

async function updatePdfJob(
  supabaseAdmin: SupabaseClient,
  jobId: number | null,
  step: string,
  patch: Record<string, unknown> = {}
) {
  if (!jobId) return

  try {
    const statusPatch = step === 'done'
      ? { status: 'done', finished_at: new Date().toISOString() }
      : step === 'error'
        ? { status: 'error', finished_at: new Date().toISOString() }
        : {}

    await supabaseAdmin
      .from('report_pdf_jobs')
      .update({
        step,
        updated_at: new Date().toISOString(),
        ...statusPatch,
        ...patch,
      })
      .eq('id', jobId)
  } catch (error) {
    console.warn(`Mise à jour job PDF impossible étape=${step}`, sanitizeError(error))
  }
}

function makeTracer(startedAt: number, trace: TraceEntry[]) {
  return (step: string, extra?: Record<string, unknown>) => {
    const entry: TraceEntry = {
      step,
      at: new Date().toISOString(),
      ms_from_start: Date.now() - startedAt,
      ...(extra ? { extra } : {}),
    }
    trace.push(entry)
    console.log('[focus-pdf]', step, extra || '')
    return entry
  }
}

async function openFocusPageAndAssertReady(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>,
  targetUrl: string,
  waitTimeoutMs: number
) {
  page.setDefaultTimeout(waitTimeoutMs)
  page.setDefaultNavigationTimeout(waitTimeoutMs)

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: waitTimeoutMs })

  await page
    .waitForFunction(
      () => {
        const root = document.querySelector('[data-focus-report-ready], [data-report-ready]') as HTMLElement | null
        if (!root) return false

        const focusReady = root.getAttribute('data-focus-report-ready') || root.getAttribute('data-report-ready')
        const focusStatus = root.getAttribute('data-focus-report-status') || ''
        const comparisonReady = root.getAttribute('data-focus-comparison-ready') || '1'
        const docsReady = root.getAttribute('data-focus-docs-distinct-ready') || '1'
        const body = document.body?.innerText || ''

        if (focusStatus === 'error') return true
        if (/Erreur chargement focus mensuel|Erreur chargement documents distincts|Erreur tableaux activité/i.test(body)) return true

        return focusReady === '1' && comparisonReady !== '0' && docsReady !== '0'
      },
      { timeout: waitTimeoutMs }
    )
    .catch(() => null)

  const loadedUrl = page.url()
  const bodyText = await page.evaluate(() => document.body?.innerText || '')
  const title = await page.title().catch(() => '')
  const attrs = await page.evaluate(() => {
    const root = document.querySelector('[data-focus-report-ready], [data-report-ready]') as HTMLElement | null
    if (!root) return null
    return {
      focusReportReady: root.getAttribute('data-focus-report-ready'),
      reportReady: root.getAttribute('data-report-ready'),
      focusReportStatus: root.getAttribute('data-focus-report-status'),
      focusReportLoading: root.getAttribute('data-focus-report-loading'),
      focusComparisonReady: root.getAttribute('data-focus-comparison-ready'),
      focusComparisonProgress: root.getAttribute('data-focus-comparison-progress'),
      focusDocsDistinctReady: root.getAttribute('data-focus-docs-distinct-ready'),
      focusDocsDistinctProgress: root.getAttribute('data-focus-docs-distinct-progress'),
      projectedCurrentMonthFactures: root.getAttribute('data-focus-projected-current-month-factures'),
    }
  })

  const readyFound = Boolean(attrs?.focusReportReady === '1' || attrs?.reportReady === '1')

  if (loadedUrl.includes('/login') || isLoginPageText(bodyText)) {
    throw new Error(
      [
        `La génération PDF a chargé l'écran de connexion au lieu du Focus Mensuel.`,
        `URL demandée=${redactSecretInUrl(targetUrl)}`,
        `URL chargée=${redactSecretInUrl(loadedUrl)}`,
        `Titre=${title || '—'}`,
        `Indice : FOCUS_MENSUEL_PRINT_URL doit pointer vers /focus_mensuel_print et cette route doit être exclue de l'auth globale.`,
      ].join(' ')
    )
  }

  if (attrs?.focusReportStatus === 'error' || hasFocusErrorText(bodyText)) {
    throw new Error(
      [
        `La page Focus Mensuel indique une erreur avant génération PDF.`,
        `URL=${redactSecretInUrl(targetUrl)}`,
        `Attributs=${JSON.stringify(attrs)}`,
        `Aperçu=${bodyText.slice(0, 1200)}`,
      ].join(' ')
    )
  }

  if (!readyFound) {
    throw new Error(
      [
        `Timeout : marqueur data-focus-report-ready="1" introuvable avant génération PDF.`,
        `URL=${redactSecretInUrl(targetUrl)}`,
        `Attributs=${JSON.stringify(attrs)}`,
        `Aperçu=${bodyText.slice(0, 1200)}`,
      ].join(' ')
    )
  }

  return {
    loadedUrl,
    title,
    readyFound,
    attrs,
    bodyPreview: bodyText.slice(0, 500),
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl
    const debugSecret = url.searchParams.get('debug_secret') || url.searchParams.get('render_secret') || ''
    const expectedSecret = process.env.REPORT_PDF_RENDER_SECRET || ''

    if (!expectedSecret || debugSecret !== expectedSecret) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Unauthorized debug request. Ajoute ?debug_secret=<REPORT_PDF_RENDER_SECRET>.',
        },
        { status: 401 }
      )
    }

    const focusUrl = buildFocusPrintUrl({
      month: url.searchParams.get('month') || undefined,
      focus_date: url.searchParams.get('focus_date') || url.searchParams.get('focusDate') || undefined,
      hors_statistiques: url.searchParams.get('hors_statistiques') || url.searchParams.get('horsStatistiques') || 'afficher',
      view: url.searchParams.get('view') || 'montant_ht',
      agence: url.searchParams.get('agence') || null,
      famille_macro: url.searchParams.get('famille_macro') || url.searchParams.get('familleMacro') || null,
      collaborateur: url.searchParams.get('collaborateur') || null,
      caProjeteFactures: url.searchParams.get('caProjeteFactures') || url.searchParams.get('ca_projete_factures') || '1',
    })

    return NextResponse.json({
      ok: true,
      route: '/api/reports/focus-mensuel-pdf',
      focusMensuelPrintUrl: process.env.FOCUS_MENSUEL_PRINT_URL || null,
      hasRenderSecret: Boolean(process.env.REPORT_PDF_RENDER_SECRET),
      hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
      hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      targetUrl: redactSecretInUrl(focusUrl.toString()),
      expectedPrintPath: new URL(process.env.FOCUS_MENSUEL_PRINT_URL || 'https://invalid.local').pathname,
    })
  } catch (error) {
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const trace: TraceEntry[] = []
  const mark = makeTracer(startedAt, trace)
  const pageConsole: string[] = []
  const pageErrors: string[] = []

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null
  let caller: AuthorizedCaller | null = null
  let jobId: number | null = null
  let supabaseAdmin: SupabaseClient | null = null

  try {
    mark('build_supabase_admin')
    supabaseAdmin = buildSupabaseAdmin()

    mark('authorize_request')
    caller = await authorizeRequest(req, supabaseAdmin)

    const payload = (await req.json()) as PdfRequest
    const bucket = payload.bucket || 'commercial-imports'
    const pdfPath = payload.path || 'reports/focus-mensuel/Rapport_activite_quotidien.pdf'
    const focusUrl = buildFocusPrintUrl(payload)
    const waitTimeoutMs = Math.min(Math.max(Number(payload.wait_timeout_ms || 240000), 30000), 285000)

    mark('create_job', { bucket, pdfPath })
    jobId = await createPdfJob(supabaseAdmin, bucket, pdfPath, payload)

    const debug = req.nextUrl.searchParams.get('debug') === '1'
    if (debug) {
      await updatePdfJob(supabaseAdmin, jobId, 'debug_done', { trace })
      return NextResponse.json({
        ok: true,
        debug: true,
        job_id: jobId,
        bucket,
        pdfPath,
        focusMensuelPrintUrl: process.env.FOCUS_MENSUEL_PRINT_URL || null,
        targetUrl: redactSecretInUrl(focusUrl.toString()),
        hasRenderSecret: Boolean(process.env.REPORT_PDF_RENDER_SECRET),
        caller,
        trace,
      })
    }

    await updatePdfJob(supabaseAdmin, jobId, 'launching_browser', { trace })
    mark('launching_browser')
    browser = await launchBrowser()

    await updatePdfJob(supabaseAdmin, jobId, 'opening_page', { trace })
    mark('opening_page')
    const page = await browser.newPage()

    page.on('console', (message) => {
      const text = `[${message.type()}] ${message.text()}`
      pageConsole.push(text.slice(0, 1000))
      console.log('[focus-pdf page console]', text)
    })
    page.on('pageerror', (error) => {
      const text = sanitizeError(error)
      pageErrors.push(text.slice(0, 1000))
      console.warn('[focus-pdf page error]', text)
    })
    page.on('error', (error) => {
      const text = sanitizeError(error)
      pageErrors.push(text.slice(0, 1000))
      console.warn('[focus-pdf page crashed]', text)
    })

    await page.setViewport({
      width: Number(process.env.FOCUS_PDF_VIEWPORT_WIDTH || 1920),
      height: Number(process.env.FOCUS_PDF_VIEWPORT_HEIGHT || 1200),
      deviceScaleFactor: 1,
    })
    await page.emulateMediaType('screen')

    await updatePdfJob(supabaseAdmin, jobId, 'waiting_focus_ready', {
      trace,
      target_url: redactSecretInUrl(focusUrl.toString()),
    })
    mark('waiting_focus_ready', { waitTimeoutMs, targetUrl: redactSecretInUrl(focusUrl.toString()) })
    const pageInfo = await openFocusPageAndAssertReady(page, focusUrl.toString(), waitTimeoutMs)

    mark('inject_print_css')
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
          filter: none !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }
        [data-focus-report-ready] *, [data-focus-report-ready] *::before, [data-focus-report-ready] *::after {
          filter: none !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }
        .focus-pdf-brand-header,
        .focus-pdf-filters,
        .focus-pdf-kpi-grid > div,
        .focus-pdf-chart-box,
        .focus-pdf-section-card,
        .focus-pdf-table-wrap {
          background-image: none !important;
          box-shadow: none !important;
          filter: none !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          position: relative !important;
          z-index: 1 !important;
        }
        .no-print, [data-no-print="true"] { display: none !important; }
      `,
    })

    await page.evaluate(() => new Promise((resolve) => window.requestAnimationFrame(() => resolve(true))))
    await new Promise((resolve) => setTimeout(resolve, 1200))

    await updatePdfJob(supabaseAdmin, jobId, 'rendering_pdf', {
      trace,
      page_info: pageInfo,
      page_console: pageConsole.slice(-30),
      page_errors: pageErrors.slice(-30),
    })
    mark('rendering_pdf')
    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '3mm', right: '3mm', bottom: '3mm', left: '3mm' },
      scale: Number(process.env.FOCUS_PDF_LANDSCAPE_SCALE || process.env.FOCUS_PDF_SCALE || 0.72),
    })

    await updatePdfJob(supabaseAdmin, jobId, 'uploading_storage', {
      bytes: pdf.byteLength,
      trace,
    })
    mark('uploading_storage', { bytes: pdf.byteLength })
    const { error: uploadError } = await supabaseAdmin.storage.from(bucket).upload(pdfPath, pdf, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (uploadError) throw new Error(`Upload Storage impossible : ${uploadError.message}`)

    mark('done', { bytes: pdf.byteLength })
    await updatePdfJob(supabaseAdmin, jobId, 'done', {
      bytes: pdf.byteLength,
      trace,
    })

    return NextResponse.json({
      ok: true,
      job_id: jobId,
      bucket,
      path: pdfPath,
      focus_url: redactSecretInUrl(focusUrl.toString()),
      loaded_url: redactSecretInUrl(pageInfo.loadedUrl),
      page_ready_marker_found: pageInfo.readyFound,
      page_attrs: pageInfo.attrs,
      orientation: 'landscape',
      filename: payload.filename || `Rapport d'activité quotidien.pdf`,
      bytes: pdf.byteLength,
      caller,
      trace,
      page_console: pageConsole.slice(-20),
      page_errors: pageErrors.slice(-20),
    })
  } catch (error) {
    const errorMessage = sanitizeError(error)
    mark('error', { error: errorMessage })

    if (supabaseAdmin) {
      await updatePdfJob(supabaseAdmin, jobId, 'error', {
        error_message: errorMessage,
        trace,
        page_console: pageConsole.slice(-50),
        page_errors: pageErrors.slice(-50),
      })
    }

    return NextResponse.json(
      {
        ok: false,
        error: errorMessage,
        job_id: jobId,
        caller,
        trace,
        page_console: pageConsole.slice(-20),
        page_errors: pageErrors.slice(-20),
      },
      { status: 500 }
    )
  } finally {
    if (browser) await browser.close().catch(() => undefined)
  }
}
