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
  caProjeteFactures?: string | number | boolean | null
  ca_projete_factures?: string | number | boolean | null
  filename?: string
}

type AuthorizedCaller = {
  mode: 'trusted_secret' | 'user_session'
  email?: string | null
}

type FocusReadyState = {
  ready: string | null
  status: string | null
  loading: string | null
  comparisonReady: string | null
  comparisonProgress: string | null
  projectedCurrentMonthFactures: string | null
  bodyPreview: string
  hasVisibleError: boolean
}

function getRequiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

function appendParam(url: URL, key: string, value: string | number | boolean | undefined | null) {
  if (value !== undefined && value !== null && String(value).trim() !== '') {
    url.searchParams.set(key, String(value))
  }
}

function redactSecretInUrl(url: string) {
  return url.replace(/(render_secret=)[^&]+/gi, '$1***')
}

function sanitizeError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function timeoutMs(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined

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

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
}

async function authorizeRequest(
  req: NextRequest,
  supabaseAdmin: SupabaseClient
): Promise<AuthorizedCaller> {
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
  const caProjeteFactures = payload.caProjeteFactures ?? payload.ca_projete_factures ?? '1'

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
  appendParam(focusUrl, 'caProjeteFactures', caProjeteFactures)
  appendParam(focusUrl, 'ca_projete_factures', caProjeteFactures)

  // Evite de réutiliser une page ou des appels front mis en cache pendant le rendu PDF.
  appendParam(focusUrl, 'render_ts', Date.now())

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

async function launchBrowser() {
  const executablePath = await chromium.executablePath()

  return puppeteer.launch({
    args: [
      ...chromium.args,
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
    executablePath,
    headless: true,
    protocolTimeout: timeoutMs('FOCUS_PDF_PROTOCOL_TIMEOUT_MS', 240000),
    defaultViewport: {
      width: Number(process.env.FOCUS_PDF_VIEWPORT_WIDTH || 1920),
      height: Number(process.env.FOCUS_PDF_VIEWPORT_HEIGHT || 1200),
    },
  })
}

async function createPdfJob(
  supabaseAdmin: SupabaseClient,
  bucket: string,
  path: string,
  payload: PdfRequest
) {
  const { data, error } = await supabaseAdmin
    .from('report_pdf_jobs')
    .insert({
      report_type: 'focus_mensuel',
      status: 'running',
      step: 'starting',
      bucket,
      path,
      payload,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) throw new Error(`Création job PDF impossible : ${error.message}`)
  return Number(data.id)
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
      hors_statistiques:
        url.searchParams.get('hors_statistiques') ||
        url.searchParams.get('horsStatistiques') ||
        'afficher',
      view: url.searchParams.get('view') || 'montant_ht',
      agence: url.searchParams.get('agence') || null,
      famille_macro: url.searchParams.get('famille_macro') || url.searchParams.get('familleMacro') || null,
      collaborateur: url.searchParams.get('collaborateur') || null,
      caProjeteFactures:
        url.searchParams.get('caProjeteFactures') ||
        url.searchParams.get('ca_projete_factures') ||
        '1',
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
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null
  let caller: AuthorizedCaller | null = null
  let supabaseAdmin: SupabaseClient | null = null
  let jobId: number | null = null

  const trace: Array<Record<string, unknown>> = []
  const consoleMessages: string[] = []
  const requestFailures: string[] = []

  async function mark(step: string, extra: Record<string, unknown> = {}) {
    const entry = {
      step,
      at: new Date().toISOString(),
      ...extra,
    }

    trace.push(entry)
    if (trace.length > 80) trace.splice(0, trace.length - 80)

    if (!supabaseAdmin || !jobId) return

    try {
      const { error } = await supabaseAdmin
        .from('report_pdf_jobs')
        .update({
          status: String(extra.status || 'running'),
          step,
          trace,
          updated_at: new Date().toISOString(),
          ...(extra.bytes !== undefined ? { bytes: extra.bytes } : {}),
          ...(extra.error_message !== undefined ? { error_message: extra.error_message } : {}),
          ...(extra.finished_at !== undefined ? { finished_at: extra.finished_at } : {}),
        })
        .eq('id', jobId)

      if (error) {
        console.warn(`Impossible de mettre à jour le job PDF étape ${step} :`, error.message)
      }
    } catch (exception) {
      console.warn(`Erreur silencieuse mark étape ${step} :`, exception)
    }
  }

  try {
    supabaseAdmin = buildSupabaseAdmin()
    caller = await authorizeRequest(req, supabaseAdmin)

    let payload: PdfRequest = {}
    try {
      payload = (await req.json()) as PdfRequest
    } catch {
      payload = {}
    }

    const bucket = payload.bucket || 'commercial-imports'
    const pdfPath = payload.path || 'reports/focus-mensuel/Rapport_activite_quotidien.pdf'
    const focusUrl = buildFocusPrintUrl(payload)

    const debug = req.nextUrl.searchParams.get('debug') === '1'
    if (debug) {
      return NextResponse.json({
        ok: true,
        debug: true,
        bucket,
        pdfPath,
        focusMensuelPrintUrl: process.env.FOCUS_MENSUEL_PRINT_URL || null,
        targetUrl: redactSecretInUrl(focusUrl.toString()),
        hasRenderSecret: Boolean(process.env.REPORT_PDF_RENDER_SECRET),
        caller,
      })
    }

    jobId = await createPdfJob(supabaseAdmin, bucket, pdfPath, payload)
    await mark('job_created', { target_url: redactSecretInUrl(focusUrl.toString()) })

    await mark('launching_browser')
    browser = await withTimeout(
      launchBrowser(),
      timeoutMs('FOCUS_PDF_LAUNCH_TIMEOUT_MS', 30000),
      'Lancement Chromium'
    )

    await mark('new_page')
    const page = await browser.newPage()

    page.on('console', (message) => {
      const text = `[${message.type()}] ${message.text()}`
      consoleMessages.push(text.slice(0, 500))
      if (consoleMessages.length > 25) consoleMessages.shift()
    })

    page.on('requestfailed', (request) => {
      const failure = request.failure()
      requestFailures.push(
        `${request.method()} ${request.url()} :: ${failure?.errorText || 'request failed'}`.slice(0, 500)
      )
      if (requestFailures.length > 25) requestFailures.shift()
    })

    await page.setViewport({
      width: Number(process.env.FOCUS_PDF_VIEWPORT_WIDTH || 1920),
      height: Number(process.env.FOCUS_PDF_VIEWPORT_HEIGHT || 1200),
      deviceScaleFactor: 1,
    })

    await page.emulateMediaType('screen')
    page.setDefaultTimeout(timeoutMs('FOCUS_PDF_DEFAULT_TIMEOUT_MS', 120000))
    page.setDefaultNavigationTimeout(timeoutMs('FOCUS_PDF_GOTO_TIMEOUT_MS', 45000))

    // On bloque seulement les ressources inutiles au PDF. On garde les images pour le logo.
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      const type = request.resourceType()
      if (['media', 'websocket', 'eventsource'].includes(type)) {
        void request.abort()
        return
      }
      void request.continue()
    })

    await mark('goto_start')
    const response = await withTimeout(
      page.goto(focusUrl.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs('FOCUS_PDF_GOTO_TIMEOUT_MS', 45000),
      }),
      timeoutMs('FOCUS_PDF_GOTO_HARD_TIMEOUT_MS', 60000),
      'Ouverture page Focus print'
    )

    const status = response?.status() || null
    await mark('goto_done', {
      http_status: status,
      loaded_url: redactSecretInUrl(page.url()),
    })

    if (status && status >= 400) {
      throw new Error(`La page Focus print répond HTTP ${status}. URL=${redactSecretInUrl(focusUrl.toString())}`)
    }

    async function waitForFocusReadyWithHeartbeat() {
      const startedAt = Date.now()
      const maxMs = timeoutMs('FOCUS_PDF_READY_HARD_TIMEOUT_MS', 180000)
      let lastState: FocusReadyState | null = null

      while (Date.now() - startedAt < maxMs) {
        lastState = await page.evaluate(() => {
          const root = document.querySelector('[data-focus-report-ready], [data-report-ready]') as HTMLElement | null
          const bodyText = document.body?.innerText || ''

          return {
            ready:
              root?.getAttribute('data-focus-report-ready') ||
              root?.getAttribute('data-report-ready') ||
              null,
            status:
              root?.getAttribute('data-focus-report-status') ||
              root?.getAttribute('data-report-status') ||
              null,
            loading: root?.getAttribute('data-focus-report-loading') || null,
            comparisonReady: root?.getAttribute('data-focus-comparison-ready') || null,
            comparisonProgress: root?.getAttribute('data-focus-comparison-progress') || null,
            projectedCurrentMonthFactures:
              root?.getAttribute('data-focus-projected-current-month-factures') || null,
            bodyPreview: bodyText.slice(0, 1200),
            hasVisibleError:
              /Erreur chargement|Erreur rapport|Génération PDF impossible|statement timeout|canceling statement/i.test(bodyText),
          }
        })

        await mark('waiting_focus_ready', {
          elapsed_ms: Date.now() - startedAt,
          page_state: lastState,
          console_messages: consoleMessages,
          request_failures: requestFailures,
        })

        if (
          lastState.ready === '1' &&
          lastState.status !== 'error' &&
          !lastState.hasVisibleError
        ) {
          return lastState
        }

        if (lastState.status === 'error' || lastState.hasVisibleError) {
          throw new Error(
            `La page Focus Mensuel indique une erreur avant génération PDF. Etat=${JSON.stringify(lastState)}`
          )
        }

        await sleep(3000)
      }

      throw new Error(
        `Timeout attente data-focus-report-ready=1 après ${maxMs} ms. Dernier état=${JSON.stringify(lastState)}`
      )
    }

    await mark('waiting_focus_ready_start')
    await waitForFocusReadyWithHeartbeat()
    await mark('waiting_focus_ready_done')

    await mark('checking_page_state')
    const pageState = await page.evaluate(() => {
      const root = document.querySelector('[data-focus-report-ready], [data-report-ready]') as HTMLElement | null
      const bodyText = document.body?.innerText || ''

      return {
        url: window.location.href,
        title: document.title,
        bodyPreview: bodyText.slice(0, 1000),
        ready:
          root?.getAttribute('data-focus-report-ready') ||
          root?.getAttribute('data-report-ready') ||
          null,
        status:
          root?.getAttribute('data-focus-report-status') ||
          root?.getAttribute('data-report-status') ||
          null,
        loading: root?.getAttribute('data-focus-report-loading') || null,
        comparisonReady: root?.getAttribute('data-focus-comparison-ready') || null,
        comparisonProgress: root?.getAttribute('data-focus-comparison-progress') || null,
        projectedCurrentMonthFactures:
          root?.getAttribute('data-focus-projected-current-month-factures') || null,
        hasVisibleError:
          /Erreur chargement|Erreur rapport|Génération PDF impossible|statement timeout|canceling statement/i.test(bodyText),
      }
    })

    await mark('page_state_checked', {
      page_state: {
        ...pageState,
        url: redactSecretInUrl(String(pageState.url || '')),
      },
      console_messages: consoleMessages,
      request_failures: requestFailures,
    })

    if (isLoginPageText(pageState.bodyPreview || '') || String(pageState.url || '').includes('/login')) {
      throw new Error(
        `La génération PDF a chargé l'écran de connexion. URL chargée=${redactSecretInUrl(String(pageState.url || ''))}`
      )
    }

    if (pageState.status === 'error' || pageState.hasVisibleError) {
      throw new Error(
        `La page Focus Mensuel indique une erreur avant génération PDF. Aperçu=${pageState.bodyPreview}`
      )
    }

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
        [data-focus-report-ready] *,
        [data-focus-report-ready] *::before,
        [data-focus-report-ready] *::after {
          filter: none !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }
        .no-print,
        [data-no-print="true"],
        .focus-pdf-header-actions {
          display: none !important;
        }
      `,
    })

    await mark('stabilizing_layout')
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
    )

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
      timeoutMs('FOCUS_PDF_RENDER_TIMEOUT_MS', 60000),
      'Rendu page.pdf()'
    )

    await mark('uploading_storage', { bytes: pdf.byteLength })
    const { error: uploadError } = await withTimeout(
      supabaseAdmin.storage.from(bucket).upload(pdfPath, pdf, {
        contentType: 'application/pdf',
        upsert: true,
      }),
      timeoutMs('FOCUS_PDF_UPLOAD_TIMEOUT_MS', 45000),
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
      job_id: jobId,
      bucket,
      path: pdfPath,
      focus_url: redactSecretInUrl(focusUrl.toString()),
      loaded_url: redactSecretInUrl(page.url()),
      orientation: 'landscape',
      filename: payload.filename || `Rapport d'activité quotidien.pdf`,
      bytes: pdf.byteLength,
      caller,
      trace,
    })
  } catch (error) {
    const errorMessage = sanitizeError(error)

    await mark('error', {
      status: 'error',
      error_message: errorMessage,
      finished_at: new Date().toISOString(),
      console_messages: consoleMessages,
      request_failures: requestFailures,
    })

    return NextResponse.json(
      {
        ok: false,
        job_id: jobId,
        error: errorMessage,
        caller,
        trace,
        console_messages: consoleMessages,
        request_failures: requestFailures,
      },
      { status: 500 }
    )
  } finally {
    if (browser) await browser.close().catch(() => undefined)
  }
}
