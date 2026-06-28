import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

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
}

type AuthorizedCaller = {
  mode: 'trusted_secret' | 'user_session'
  email?: string | null
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

  appendParam(focusUrl, 'pdf', '1')
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

async function openFocusPageAndAssertNotLogin(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>,
  targetUrl: string
) {
  await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 90000 })

  await page
    .waitForFunction(
      () => {
        const ready = document.querySelector('[data-focus-report-ready="1"], [data-report-ready="1"]')
        if (ready) return true
        const body = document.body?.innerText || ''
        if (body.includes('Mot de passe') && body.includes('Connexion')) return true
        return !/Chargement|Reconstruction/i.test(body)
      },
      { timeout: 60000 }
    )
    .catch(() => null)

  const loadedUrl = page.url()
  const bodyText = await page.evaluate(() => document.body?.innerText || '')
  const title = await page.title().catch(() => '')
  const readyFound = await page
    .$('[data-focus-report-ready="1"], [data-report-ready="1"]')
    .then(Boolean)
    .catch(() => false)

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

  if (!readyFound) {
    console.warn('Aucun marqueur data-focus-report-ready/data-report-ready trouvé. Le PDF sera généré quand même.')
  }

  return {
    loadedUrl,
    title,
    readyFound,
    bodyPreview: bodyText.slice(0, 300),
  }
}

async function launchBrowser() {
  const executablePath = await chromium.executablePath()

  return puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: true,
    defaultViewport: {
      width: Number(process.env.FOCUS_PDF_VIEWPORT_WIDTH || 2400),
      height: Number(process.env.FOCUS_PDF_VIEWPORT_HEIGHT || 1600),
    },
  })
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

  try {
    const supabaseAdmin = buildSupabaseAdmin()
    caller = await authorizeRequest(req, supabaseAdmin)

    const payload = (await req.json()) as PdfRequest
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

    browser = await launchBrowser()
    const page = await browser.newPage()

    await page.setViewport({
      width: Number(process.env.FOCUS_PDF_VIEWPORT_WIDTH || 2400),
      height: Number(process.env.FOCUS_PDF_VIEWPORT_HEIGHT || 1600),
      deviceScaleFactor: 1,
    })
    await page.emulateMediaType('screen')

    const pageInfo = await openFocusPageAndAssertNotLogin(page, focusUrl.toString())

    await page.addStyleTag({
      content: `
        @page { size: A4 landscape; margin: 5mm 5mm 5mm 5mm; }
        html, body { margin: 0 !important; padding: 0 !important; background: #eef5fb !important; }
        body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        [data-focus-report-ready], [data-report-ready] { width: 100% !important; box-sizing: border-box !important; }
        .no-print, [data-no-print="true"] { display: none !important; }
      `,
    })

    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '5mm', right: '5mm', bottom: '5mm', left: '5mm' },
      scale: Number(process.env.FOCUS_PDF_LANDSCAPE_SCALE || process.env.FOCUS_PDF_SCALE || 0.84),
    })

    const { error: uploadError } = await supabaseAdmin.storage.from(bucket).upload(pdfPath, pdf, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (uploadError) throw new Error(`Upload Storage impossible : ${uploadError.message}`)

    return NextResponse.json({
      ok: true,
      bucket,
      path: pdfPath,
      focus_url: redactSecretInUrl(focusUrl.toString()),
      loaded_url: redactSecretInUrl(pageInfo.loadedUrl),
      page_ready_marker_found: pageInfo.readyFound,
      orientation: 'landscape',
      filename: payload.filename || `Rapport d'activité quotidien.pdf`,
      bytes: pdf.byteLength,
      caller,
    })
  } catch (error) {
    return NextResponse.json({ ok: false, error: sanitizeError(error), caller }, { status: 500 })
  } finally {
    if (browser) await browser.close().catch(() => undefined)
  }
}
