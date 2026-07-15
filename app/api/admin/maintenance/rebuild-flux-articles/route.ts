import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/server/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const FLUX_ARTICLES_RPC =
  'rebuild_indicateur_flux_articles_mensuel_periode_front'

type MonthPeriod = {
  p_date_debut: string
  p_date_fin: string
  label: string
}

function isAuthorized(req: NextRequest) {
  const maintenanceSecret =
    process.env.CLIENT_MAINTENANCE_SECRET || ''
  const cronSecret = process.env.CRON_SECRET || ''

  const authorization =
    req.headers.get('authorization') || ''
  const bearer = authorization
    .replace(/^Bearer\s+/i, '')
    .trim()

  const headerSecret =
    req.headers.get('x-client-maintenance-secret') || ''

  return Boolean(
    (maintenanceSecret &&
      (headerSecret === maintenanceSecret ||
        bearer === maintenanceSecret)) ||
      (cronSecret && bearer === cronSecret)
  )
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function isYmd(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  )
}

function formatYmd(date: Date) {
  return date.toISOString().slice(0, 10)
}

function parseYmd(value: string) {
  const [year, month, day] = value
    .slice(0, 10)
    .split('-')
    .map(Number)

  return new Date(Date.UTC(year, month - 1, day))
}

function firstDayOfMonth(value: string) {
  const date = parseYmd(value)
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      1
    )
  )
}

function firstDayOfNextMonth(value: string) {
  const date = parseYmd(value)
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      1
    )
  )
}

function todayInParis() {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find(
    (part) => part.type === 'year'
  )?.value
  const month = parts.find(
    (part) => part.type === 'month'
  )?.value
  const day = parts.find(
    (part) => part.type === 'day'
  )?.value

  if (!year || !month || !day) {
    return new Date().toISOString().slice(0, 10)
  }

  return `${year}-${month}-${day}`
}

function defaultRange() {
  const today = todayInParis()
  const end = firstDayOfNextMonth(today)
  const start = new Date(
    Date.UTC(
      end.getUTCFullYear(),
      end.getUTCMonth() - 2,
      1
    )
  )

  return {
    startDate: formatYmd(start),
    endDate: formatYmd(end),
  }
}

function resolveRequestedRange(body: any) {
  const defaults = defaultRange()

  const rawStart =
    body?.p_date_debut ||
    body?.date_debut ||
    body?.startDate ||
    body?.fromDate ||
    body?.period?.resolved?.date_debut

  const rawEnd =
    body?.p_date_fin ||
    body?.date_fin ||
    body?.endDate ||
    body?.toDate ||
    body?.period?.resolved?.date_fin

  const startDate = isYmd(rawStart)
    ? rawStart
    : defaults.startDate

  const endDate = isYmd(rawEnd)
    ? rawEnd
    : defaults.endDate

  if (endDate < startDate) {
    throw new Error(
      `Période invalide : ${startDate} → ${endDate}`
    )
  }

  return { startDate, endDate }
}

function buildMonthlyPeriods(
  startDate: string,
  endDate: string
): MonthPeriod[] {
  const periods: MonthPeriod[] = []

  const cursor = firstDayOfMonth(startDate)

  // La date de fin reçue peut être "demain".
  // Le rebuild Flux articles fonctionne par mois :
  // on couvre donc entièrement le mois contenant endDate.
  const limit = firstDayOfNextMonth(endDate)

  while (cursor < limit) {
    const next = new Date(
      Date.UTC(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth() + 1,
        1
      )
    )

    const pDateDebut = formatYmd(cursor)
    const pDateFin = formatYmd(next)

    periods.push({
      p_date_debut: pDateDebut,
      p_date_fin: pDateFin,
      label: `${pDateDebut} → ${pDateFin}`,
    })

    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }

  return periods
}


const LOCK_RETRY_DELAYS_MS = [2000, 5000, 10000, 20000]

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

function isRetryableDatabaseError(message: string) {
  const normalized = String(message || '').toLowerCase()

  return (
    normalized.includes('lock timeout') ||
    normalized.includes('deadlock detected') ||
    normalized.includes('could not obtain lock') ||
    normalized.includes('canceling statement due to lock timeout')
  )
}

async function rebuildPeriodWithRetry(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  period: MonthPeriod
) {
  let lastError = ''

  for (let attempt = 0; attempt <= LOCK_RETRY_DELAYS_MS.length; attempt += 1) {
    const { data, error } = await supabase.rpc(
      FLUX_ARTICLES_RPC,
      {
        p_date_debut: period.p_date_debut,
        p_date_fin: period.p_date_fin,
      }
    )

    if (!error) {
      return {
        data: data ?? null,
        attempts: attempt + 1,
      }
    }

    lastError = error.message || String(error)

    if (
      !isRetryableDatabaseError(lastError) ||
      attempt >= LOCK_RETRY_DELAYS_MS.length
    ) {
      throw new Error(lastError)
    }

    await wait(LOCK_RETRY_DELAYS_MS[attempt])
  }

  throw new Error(lastError || 'Erreur inconnue pendant le rebuild flux articles.')
}

async function handler(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Non autorisé.',
      },
      { status: 401 }
    )
  }

  const startedAt = new Date().toISOString()

  try {
    const body =
      req.method === 'GET'
        ? Object.fromEntries(
            req.nextUrl.searchParams.entries()
          )
        : await req.json().catch(() => ({}))

    const { startDate, endDate } =
      resolveRequestedRange(body)

    // On traite le mois le plus récent en premier afin que les écrans du jour
    // soient actualisés même si un ancien mois rencontre un verrou temporaire.
    const periods = buildMonthlyPeriods(
      startDate,
      endDate
    ).reverse()

    if (periods.length === 0) {
      throw new Error(
        'Aucune période mensuelle à reconstruire.'
      )
    }

    const supabase = createSupabaseAdmin()
    const results: Array<{
      period: MonthPeriod
      status: 'done' | 'error'
      attempts: number
      result?: unknown
      error?: string
    }> = []

    for (const period of periods) {
      try {
        const rebuilt = await rebuildPeriodWithRetry(
          supabase,
          period
        )

        results.push({
          period,
          status: 'done',
          attempts: rebuilt.attempts,
          result: rebuilt.data,
        })
      } catch (error: unknown) {
        results.push({
          period,
          status: 'error',
          attempts: LOCK_RETRY_DELAYS_MS.length + 1,
          error: toErrorMessage(error),
        })

        // On poursuit les autres mois : un verrou sur un mois historique
        // ne doit plus empêcher le recalcul des périodes plus récentes.
      }
    }

    const failedPeriods = results.filter(
      (result) => result.status === 'error'
    )

    if (failedPeriods.length > 0) {
      const failedLabels = failedPeriods
        .map((result) =>
          `${result.period.label} : ${result.error}`
        )
        .join(' | ')

      return NextResponse.json(
        {
          success: false,
          partial: true,
          error:
            `Rebuild flux articles partiel. ` +
            `${failedPeriods.length}/${periods.length} période(s) en erreur : ` +
            failedLabels,
          rpc: FLUX_ARTICLES_RPC,
          requested_range: {
            startDate,
            endDate,
          },
          periods,
          results,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message:
        `Rebuild flux articles terminé sur ` +
        `${periods.length} mois.`,
      rpc: FLUX_ARTICLES_RPC,
      requested_range: {
        startDate,
        endDate,
      },
      periods,
      results,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    })
  } catch (error: unknown) {
    const message = toErrorMessage(error)

    console.error(
      'rebuild-flux-articles error:',
      message
    )

    return NextResponse.json(
      {
        success: false,
        error: message,
        rpc: FLUX_ARTICLES_RPC,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  return handler(req)
}

export async function GET(req: NextRequest) {
  return handler(req)
}
