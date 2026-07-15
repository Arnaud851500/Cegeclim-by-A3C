// app/api/reports/focus-mensuel-pdf/process/route.ts
// Worker PDF Focus Mensuel.
// La page de rendu est ouverte sans session utilisateur. Les appels REST
// Supabase de cette page sont donc interceptés côté serveur et authentifiés
// avec la clé service_role, sans jamais exposer cette clé au navigateur client.

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

async function mark(
  sb: ReturnType<typeof admin>,
  jobId: number,
  step: string,
  extra: Record<string, any> = {},
) {
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
  const cacheId =
    payload.pdf_cache_id ||
    payload.cache_id ||
    payload.comparison_cache_id

  url.searchParams.set('pdf', '1')
  url.searchParams.set('print', '1')
  url.searchParams.set('render_secret', secret)
  url.searchParams.set('pdf_cache_id', String(cacheId || ''))
  url.searchParams.set('cache_id', String(cacheId || ''))

  if (payload.month) {
    url.searchParams.set('month', String(payload.month))
  }

  if (focusDate) {
    url.searchParams.set('focusDate', String(focusDate))
    url.searchParams.set('focus_date', String(focusDate))
  }

  url.searchParams.set('view', String(payload.view || 'montant_ht'))

  const horsStatistiques = String(
    payload.horsStatistiques ||
      payload.hors_statistiques ||
      'afficher',
  )

  url.searchParams.set('horsStatistiques', horsStatistiques)
  url.searchParams.set('hors_statistiques', horsStatistiques)

  if (payload.agence) {
    url.searchParams.set('agence', String(payload.agence))
  }

  if (payload.familleMacro || payload.famille_macro) {
    const familleMacro = String(
      payload.familleMacro || payload.famille_macro,
    )

    url.searchParams.set('familleMacro', familleMacro)
    url.searchParams.set('famille_macro', familleMacro)
  }

  if (payload.collaborateur) {
    url.searchParams.set(
      'collaborateur',
      String(payload.collaborateur),
    )
  }

  const caProjeteFactures =
    payload.caProjeteFactures ??
    payload.ca_projete_factures ??
    payload.ca_projete_factures_mois_en_cours

  if (caProjeteFactures !== undefined && caProjeteFactures !== null) {
    const enabled =
      caProjeteFactures === true ||
      caProjeteFactures === 1 ||
      ['1', 'true', 'oui', 'yes', 'on'].includes(
        String(caProjeteFactures).toLowerCase(),
      )

    url.searchParams.set(
      'caProjeteFactures',
      enabled ? '1' : '0',
    )
    url.searchParams.set(
      'ca_projete_factures',
      enabled ? '1' : '0',
    )
  }

  url.searchParams.set('render_ts', String(Date.now()))

  return url
}

function isVisibleReportError(body: string) {
  return /Erreur rapport|Erreur chargement|Failed to fetch|permission denied|42501|Erreur tableaux portefeuille\s*\/\s*projection|fonction get_focus_mensuel_agency_control_cached|impossible/i.test(
    body,
  )
}

export async function POST(req: NextRequest) {
  const sb = admin()
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null

  try {
    const secret =
      req.headers.get('x-report-secret') ||
      req.headers.get('x-internal-secret') ||
      req.nextUrl.searchParams.get('secret') ||
      ''

    const expectedSecret =
      process.env.REPORT_PDF_RENDER_SECRET ||
      process.env.INTERNAL_API_SECRET ||
      ''

    const authHeader = req.headers.get('authorization') || ''
    const token = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : ''

    if (expectedSecret && secret && secret === expectedSecret) {
      // Appel worker interne autorisé.
    } else if (token) {
      const { data: userData, error: userError } =
        await sb.auth.getUser(token)

      if (userError || !userData?.user) {
        return NextResponse.json(
          {
            ok: false,
            error:
              `Unauthorized worker : session utilisateur invalide` +
              `${userError?.message ? ` (${userError.message})` : ''}.`,
          },
          { status: 401 },
        )
      }
    } else {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized worker.' },
        { status: 401 },
      )
    }

    const body = await req.json().catch(() => ({}))
    const explicitJobId = body.job_id
      ? Number(body.job_id)
      : null

    const query = sb
      .from('report_pdf_jobs')
      .select('*')
      .eq('report_type', 'focus_mensuel')
      .in('status', ['pending', 'running'])
      .order('id', { ascending: true })
      .limit(1)

    const { data: jobs, error: jobError } = explicitJobId
      ? await sb
          .from('report_pdf_jobs')
          .select('*')
          .eq('id', explicitJobId)
          .limit(1)
      : await query

    if (jobError) throw new Error(jobError.message)

    const job = Array.isArray(jobs) ? jobs[0] : null

    if (!job) {
      return NextResponse.json({
        ok: true,
        message: 'Aucun job PDF à traiter.',
      })
    }

    const jobId = Number(job.id)
    const payload = job.payload || {}
    const cacheId =
      payload.pdf_cache_id ||
      payload.cache_id ||
      payload.comparison_cache_id

    if (!cacheId) {
      throw new Error(
        'Job PDF sans pdf_cache_id/cache_id : impossible de garantir les tableaux comparatifs.',
      )
    }

    await mark(sb, jobId, 'picked_by_worker', {
      status: 'running',
      started_at:
        job.started_at || new Date().toISOString(),
    })

    const printUrl = buildPrintUrl(payload)

    await mark(sb, jobId, 'launching_browser')

    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
      executablePath: await chromium.executablePath(),
      headless: true,
      protocolTimeout: 45000,
      defaultViewport: {
        width: Number(
          process.env.FOCUS_PDF_VIEWPORT_WIDTH || 1920,
        ),
        height: Number(
          process.env.FOCUS_PDF_VIEWPORT_HEIGHT || 1200,
        ),
      },
    })

    const page = await browser.newPage()

    page.setDefaultTimeout(25000)
    page.setDefaultNavigationTimeout(25000)

    await page.setViewport({
      width: 1920,
      height: 1200,
      deviceScaleFactor: 1,
    })

    await page.emulateMediaType('screen')

    // La page print n'a volontairement aucune session utilisateur.
    // Sans cette interception, Supabase exécute les RPC avec le rôle anon,
    // d'où l'erreur :
    // "permission denied for function get_focus_mensuel_agency_control_cached".
    //
    // La substitution est effectuée uniquement dans Chromium côté serveur,
    // uniquement pour /rest/v1/ du projet Supabase. La clé service_role
    // n'est jamais envoyée au domaine Vercel ni intégrée dans le HTML.
    const supabaseUrl = requiredEnv('SUPABASE_URL').replace(
      /\/+$/,
      '',
    )
    const serviceRoleKey = requiredEnv(
      'SUPABASE_SERVICE_ROLE_KEY',
    )
    const supabaseRestPrefix = `${supabaseUrl}/rest/v1/`

    await page.setRequestInterception(true)

    page.on('request', (request) => {
      const requestUrl = request.url()

      if (requestUrl.startsWith(supabaseRestPrefix)) {
        void request
          .continue({
            headers: {
              ...request.headers(),
              apikey: serviceRoleKey,
              authorization: `Bearer ${serviceRoleKey}`,
            },
          })
          .catch(() => undefined)

        return
      }

      void request.continue().catch(() => undefined)
    })

    await mark(sb, jobId, 'opening_print_page')

    const response = await page.goto(printUrl.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    })

    const status = response?.status() || 0

    if (status >= 400) {
      throw new Error(`Page print HTTP ${status}`)
    }

    // Le titre de la page ne suffit pas : il apparaît avant la fin des RPC.
    // On attend désormais le vrai marqueur qui inclut explicitement :
    // - données journalières ;
    // - documents distincts ;
    // - TOP 20 ;
    // - portefeuille / projection ;
    // - tableaux comparatifs.
    await mark(sb, jobId, 'waiting_report_ready')

    const readyWaitMs = Number(
      process.env.FOCUS_PDF_READY_WAIT_MS || 32000,
    )
    const started = Date.now()
    let pageState: any = null

    while (Date.now() - started < readyWaitMs) {
      pageState = await page.evaluate(() => {
        const body = document.body?.innerText || ''
        const root = document.querySelector(
          '[data-focus-report-ready], [data-report-ready]',
        ) as HTMLElement | null

        return {
          ready:
            root?.getAttribute('data-focus-report-ready') ||
            root?.getAttribute('data-report-ready') ||
            null,
          status:
            root?.getAttribute('data-focus-report-status') ||
            root?.getAttribute('data-report-status') ||
            null,
          loading:
            root?.getAttribute('data-focus-report-loading') ||
            '',
          hasReportTitle: /ACTIVITE CEGECLIM/i.test(body),
          hasError:
            /Erreur rapport|Erreur chargement|Failed to fetch|permission denied|42501|Erreur tableaux portefeuille\s*\/\s*projection|fonction get_focus_mensuel_agency_control_cached|impossible/i.test(
              body,
            ),
          bodyPreview: body.slice(0, 2500),
        }
      })

      await mark(sb, jobId, 'waiting_report_ready', {
        trace: [
          {
            at: new Date().toISOString(),
            page_state: pageState,
          },
        ],
      })

      if (
        pageState.status === 'error' ||
        pageState.hasError ||
        isVisibleReportError(pageState.bodyPreview || '')
      ) {
        throw new Error(
          `Erreur visible page print : ${pageState.bodyPreview}`,
        )
      }

      if (pageState.ready === '1') break

      await sleep(1000)
    }

    if (pageState?.ready !== '1') {
      throw new Error(
        `Page print non prête après ${readyWaitMs} ms : ${JSON.stringify(
          pageState,
        )}`,
      )
    }

    // Le marqueur ready signifie que le portefeuille et la projection sont
    // déjà chargés. On ne garde qu'un bref délai de stabilisation visuelle.
    const stabilizationWaitMs = Number(
      process.env.FOCUS_PDF_POST_READY_WAIT_MS || 1000,
    )

    if (
      Number.isFinite(stabilizationWaitMs) &&
      stabilizationWaitMs > 0
    ) {
      await mark(sb, jobId, 'stabilizing_report', {
        wait_ms: stabilizationWaitMs,
      })

      await sleep(stabilizationWaitMs)
    }

    const finalState = await page.evaluate(() => {
      const body = document.body?.innerText || ''
      const root = document.querySelector(
        '[data-focus-report-ready], [data-report-ready]',
      ) as HTMLElement | null

      return {
        ready:
          root?.getAttribute('data-focus-report-ready') ||
          root?.getAttribute('data-report-ready') ||
          null,
        status:
          root?.getAttribute('data-focus-report-status') ||
          root?.getAttribute('data-report-status') ||
          null,
        hasAgencyError:
          /Erreur tableaux portefeuille\s*\/\s*projection|permission denied|42501|fonction get_focus_mensuel_agency_control_cached/i.test(
            body,
          ),
        hasPortfolio:
          /Portefeuille de commande/i.test(body),
        hasProjection:
          /Projection facturation mois par agence/i.test(
            body,
          ),
        bodyPreview: body.slice(0, 2500),
      }
    })

    await mark(sb, jobId, 'report_ready_checked', {
      page_state: finalState,
    })

    if (
      finalState.ready !== '1' ||
      finalState.status === 'error' ||
      finalState.hasAgencyError
    ) {
      throw new Error(
        `Rapport invalide avant capture : ${JSON.stringify(
          finalState,
        )}`,
      )
    }

    await mark(sb, jobId, 'rendering_pdf')

    await page.addStyleTag({
      content: `
        @page { size: A4 landscape; margin: 3mm; }
        body {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          background: #eef5fb !important;
        }
        .no-print,
        [data-no-print="true"],
        .focus-pdf-header-actions {
          display: none !important;
        }
      `,
    })

    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '3mm',
        right: '3mm',
        bottom: '3mm',
        left: '3mm',
      },
      scale: Number(process.env.FOCUS_PDF_SCALE || 0.72),
    })

    const bucket =
      payload.bucket ||
      job.bucket ||
      'commercial-imports'

    const path =
      payload.path ||
      job.path ||
      'reports/focus-mensuel/Rapport_activite_quotidien.pdf'

    await mark(sb, jobId, 'uploading_storage', {
      bytes: pdf.byteLength,
    })

    const { error: uploadError } = await sb.storage
      .from(bucket)
      .upload(path, pdf, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadError) {
      throw new Error(uploadError.message)
    }

    await mark(sb, jobId, 'done', {
      status: 'done',
      finished_at: new Date().toISOString(),
      bytes: pdf.byteLength,
      bucket,
      path,
    })

    return NextResponse.json({
      ok: true,
      job_id: jobId,
      bucket,
      path,
      bytes: pdf.byteLength,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: errMsg(error) },
      { status: 500 },
    )
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
  }
}