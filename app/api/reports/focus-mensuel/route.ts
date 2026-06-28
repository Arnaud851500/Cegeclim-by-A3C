import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
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
  hors_statistiques?: 'afficher' | 'masquer' | string
  filename?: string
}

function appendParam(url: URL, key: string, value: string | undefined | null) {
  if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value)
}

function getRequiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

export async function POST(req: NextRequest) {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null

  try {
    const secret = req.headers.get('x-report-secret') || ''
    if (!process.env.REPORT_PDF_RENDER_SECRET || secret !== process.env.REPORT_PDF_RENDER_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = (await req.json()) as PdfRequest
    const bucket = payload.bucket || 'commercial-imports'
    const pdfPath = payload.path || 'reports/focus-mensuel/Rapport_activite_quotidien.pdf'

    const supabaseUrl = getRequiredEnv('SUPABASE_URL')
    const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
    const focusBaseUrl = getRequiredEnv('FOCUS_MENSUEL_PRINT_URL')

    const focusUrl = new URL(focusBaseUrl)
    appendParam(focusUrl, 'pdf', '1')
    appendParam(focusUrl, 'month', payload.month)
    appendParam(focusUrl, 'focusDate', payload.focus_date)
    appendParam(focusUrl, 'focus_date', payload.focus_date)
    appendParam(focusUrl, 'horsStatistiques', payload.hors_statistiques || 'afficher')
    appendParam(focusUrl, 'hors_statistiques', payload.hors_statistiques || 'afficher')
    appendParam(focusUrl, 'view', 'montant_ht')

    const executablePath = await chromium.executablePath()
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath,
      headless: true,
      defaultViewport: { width: Number(process.env.FOCUS_PDF_VIEWPORT_WIDTH || 1680), height: Number(process.env.FOCUS_PDF_VIEWPORT_HEIGHT || 2400) },
    })

    const page = await browser.newPage()
    await page.setViewport({ width: Number(process.env.FOCUS_PDF_VIEWPORT_WIDTH || 1680), height: Number(process.env.FOCUS_PDF_VIEWPORT_HEIGHT || 2400), deviceScaleFactor: 1 })
    await page.emulateMediaType('screen')

    await page.goto(focusUrl.toString(), { waitUntil: 'networkidle0', timeout: 90000 })

    await page
      .waitForFunction(
        () => {
          const ready = document.querySelector('[data-focus-report-ready="1"], [data-report-ready="1"]')
          if (ready) return true
          const body = document.body?.innerText || ''
          return !/Chargement|Reconstruction|Erreur chargement/i.test(body)
        },
        { timeout: 60000 }
      )
      .catch(() => null)

    await page.addStyleTag({
      content: `
        @page { size: A4 portrait; margin: 6mm 4mm 6mm 4mm; }
        html, body { margin: 0 !important; padding: 0 !important; background: #eef5fb !important; }
        body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        [data-focus-report-ready] { width: 100% !important; box-sizing: border-box !important; }
        .no-print, [data-no-print="true"] { display: none !important; }
      `,
    })

    const pdf = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '6mm', right: '4mm', bottom: '6mm', left: '4mm' },
      scale: Number(process.env.FOCUS_PDF_SCALE || 0.62),
    })

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
    const { error: uploadError } = await supabase.storage.from(bucket).upload(pdfPath, pdf, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (uploadError) throw new Error(`Upload Storage impossible : ${uploadError.message}`)

    return NextResponse.json({
      ok: true,
      bucket,
      path: pdfPath,
      focus_url: focusUrl.toString(),
      filename: payload.filename || `Rapport d'activité quotidien.pdf`,
      bytes: pdf.byteLength,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 })
  } finally {
    if (browser) await browser.close().catch(() => undefined)
  }
}
