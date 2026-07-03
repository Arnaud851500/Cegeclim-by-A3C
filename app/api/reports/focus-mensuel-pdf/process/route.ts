
// app/api/reports/focus-mensuel-pdf/process/route.ts
// Worker PDF rapide : il ouvre la page print avec cache_id et ne recalcule plus les 36 périodes.
// Il doit finir sous 60 secondes.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

function admin() {
  return createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })
}

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function mark(sb: ReturnType<typeof admin>, jobId: number, step: string, extra: Record<string, any> = {}) {
  const patch = {
    step,
    updated_at: new Date().toISOString(),
    ...extra,
  }
  await sb.from('report_pdf_jobs').update(patch).eq('id', jobId)
}

function buildPrintUrl(payload: any) {
  const url = new URL(requiredEnv('FOCUS_MENSUEL_PRINT_URL'))
  const secret = requiredEnv('REPORT_PDF_RENDER_SECRET')

  const focusDate = payload.focus_date || payload.focusDate
  const cacheId = payload.pdf_cache_id || payload.cache_id || payload.comparison_cache_id

  url.searchParams.set('pdf', '1')
  url.searchParams.set('print', '1')
  url.searchParams.set('render_secret', secret)
  url.searchParams.set('pdf_cache_id', String(cacheId || ''))
  url.searchParams.set('cache_id', String(cacheId || ''))
  if (payload.month) url.searchParams.set('month', String(payload.month))
  if (focusDate) {
    url.searchParams.set('focusDate', String(focusDate))
    url.searchParams.set('focus_date', String(focusDate))
  }
  url.searchParams.set('view', String(payload.view || 'montant_ht'))
  url.searchParams.set('horsStatistiques', String(payload.horsStatistiques || payload.hors_statistiques || 'afficher'))
  url.searchParams.set('hors_statistiques', String(payload.horsStatistiques || payload.hors_statistiques || 'afficher'))
  if (payload.agence) url.searchParams.set('agence', String(payload.agence))
  if (payload.familleMacro || payload.famille_macro) {
    url.searchParams.set('familleMacro', String(payload.familleMacro || payload.famille_macro))
    url.searchParams.set('famille_macro', String(payload.familleMacro || payload.famille_macro))
  }
  if (payload.collaborateur) url.searchParams.set('collaborateur', String(payload.collaborateur))
  url.searchParams.set('render_ts', String(Date.now()))

  return url
}

export async function POST(req: NextRequest) {
  const sb = admin()
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null

  try {
    const secret = req.headers.get('x-report-secret') || req.nextUrl.searchParams.get('secret') || ''
    const expectedSecret = process.env.REPORT_PDF_RENDER_SECRET || process.env.INTERNAL_API_SECRET || ''
    if (!expectedSecret || secret !== expectedSecret) {
      return NextResponse.json({ ok: false, error: 'Unauthorized worker.' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const explicitJobId = body.job_id ? Number(body.job_id) : null

    const query = sb
      .from('report_pdf_jobs')
      .select('*')
      .eq('report_type', 'focus_mensuel')
      .in('status', ['pending', 'running'])
      .order('id', { ascending: true })
      .limit(1)

    const { data: jobs, error: jobError } = explicitJobId
      ? await sb.from('report_pdf_jobs').select('*').eq('id', explicitJobId).limit(1)
      : await query

    if (jobError) throw new Error(jobError.message)
    const job = Array.isArray(jobs) ? jobs[0] : null
    if (!job) return NextResponse.json({ ok: true, message: 'Aucun job PDF à traiter.' })

    const jobId = Number(job.id)
    const payload = job.payload || {}
    const cacheId = payload.pdf_cache_id || payload.cache_id || payload.comparison_cache_id
    if (!cacheId) throw new Error('Job PDF sans pdf_cache_id/cache_id : impossible de garantir les tableaux comparatifs.')

    await mark(sb, jobId, 'picked_by_worker', {
      status: 'running',
      started_at: job.started_at || new Date().toISOString(),
    })

    const printUrl = buildPrintUrl(payload)

    await mark(sb, jobId, 'launching_browser')
    browser = await puppeteer.launch({
      args: [...chromium.args, '--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: await chromium.executablePath(),
      headless: true,
      protocolTimeout: 45000,
      defaultViewport: {
        width: Number(process.env.FOCUS_PDF_VIEWPORT_WIDTH || 1920),
        height: Number(process.env.FOCUS_PDF_VIEWPORT_HEIGHT || 1200),
      },
    })

    const page = await browser.newPage()
    page.setDefaultTimeout(25000)
    page.setDefaultNavigationTimeout(25000)
    await page.setViewport({ width: 1920, height: 1200, deviceScaleFactor: 1 })
    await page.emulateMediaType('screen')

    await mark(sb, jobId, 'opening_print_page')
    const response = await page.goto(printUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 25000 })
    const status = response?.status() || 0
    if (status >= 400) throw new Error(`Page print HTTP ${status}`)

    await mark(sb, jobId, 'waiting_cached_tables')
    const started = Date.now()
    let pageState: any = null
    while (Date.now() - started < 18000) {
      pageState = await page.evaluate(() => {
        const body = document.body?.innerText || ''
        const root = document.querySelector('[data-focus-report-ready], [data-report-ready]') as HTMLElement | null
        return {
          ready: root?.getAttribute('data-focus-report-ready') || root?.getAttribute('data-report-ready') || null,
          status: root?.getAttribute('data-focus-report-status') || root?.getAttribute('data-report-status') || null,
          hasReportTitle: /ACTIVITE CEGECLIM/i.test(body),
          hasError: /Erreur rapport|Erreur chargement|Failed to fetch|impossible/i.test(body),
          bodyPreview: body.slice(0, 600),
        }
      })

      await mark(sb, jobId, 'waiting_cached_tables', {
        trace: [{ at: new Date().toISOString(), page_state: pageState }],
      })

      if (pageState.hasError) throw new Error(`Erreur visible page print : ${pageState.bodyPreview}`)
      if (pageState.ready === '1' || pageState.hasReportTitle) break
      await sleep(1500)
    }

    if (!pageState?.hasReportTitle) throw new Error(`Page print non prête : ${JSON.stringify(pageState)}`)

    await mark(sb, jobId, 'rendering_pdf')
    await page.addStyleTag({
      content: `
        @page { size: A4 landscape; margin: 3mm; }
        body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; background: #eef5fb !important; }
        .no-print, [data-no-print="true"], .focus-pdf-header-actions { display: none !important; }
      `,
    })

    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '3mm', right: '3mm', bottom: '3mm', left: '3mm' },
      scale: Number(process.env.FOCUS_PDF_SCALE || 0.72),
    })

    const bucket = payload.bucket || job.bucket || 'commercial-imports'
    const path = payload.path || job.path || 'reports/focus-mensuel/Rapport_activite_quotidien.pdf'

    await mark(sb, jobId, 'uploading_storage', { bytes: pdf.byteLength })
    const { error: uploadError } = await sb.storage.from(bucket).upload(path, pdf, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (uploadError) throw new Error(uploadError.message)

    await mark(sb, jobId, 'done', {
      status: 'done',
      finished_at: new Date().toISOString(),
      bytes: pdf.byteLength,
      bucket,
      path,
    })

    return NextResponse.json({ ok: true, job_id: jobId, bucket, path, bytes: pdf.byteLength })
  } catch (error) {
    return NextResponse.json({ ok: false, error: errMsg(error) }, { status: 500 })
  } finally {
    if (browser) await browser.close().catch(() => undefined)
  }
}
