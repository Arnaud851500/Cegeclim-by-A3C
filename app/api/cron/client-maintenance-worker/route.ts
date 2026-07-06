import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}`)
  }
  return value
}

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const maintenanceSecret = process.env.CLIENT_MAINTENANCE_SECRET

  const authorization = req.headers.get('authorization') || ''
  const clientSecret = req.headers.get('x-client-maintenance-secret') || ''

  if (cronSecret && authorization === `Bearer ${cronSecret}`) return true
  if (maintenanceSecret && clientSecret === maintenanceSecret) return true

  return false
}

export async function GET(req: NextRequest) {
  return runWorkerBurst(req)
}

export async function POST(req: NextRequest) {
  return runWorkerBurst(req)
}

async function runWorkerBurst(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, error: 'Non autorisé.' },
        { status: 401 }
      )
    }

    const secret = requiredEnv('CLIENT_MAINTENANCE_SECRET')

    const url = new URL(req.url)
    const iterations = Math.min(
      Number(url.searchParams.get('iterations') || 6),
      10
    )

    const workerUrl = new URL('/api/client-maintenance/worker', req.url)

    const calls: any[] = []

    for (let i = 1; i <= iterations; i++) {
      const startedAt = new Date().toISOString()

      const res = await fetch(workerUrl.toString(), {
        method: 'POST',
        headers: {
          'x-client-maintenance-secret': secret,
        },
        cache: 'no-store',
      })

      const text = await res.text()

      let body: any = null
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }

      calls.push({
        iteration: i,
        status: res.status,
        ok: res.ok,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        body,
      })

      if (!res.ok) {
        break
      }

      const serialized = JSON.stringify(body).toLowerCase()

      if (
        serialized.includes('aucun run') ||
        serialized.includes('no run') ||
        serialized.includes('no_active') ||
        serialized.includes('nothing_to_do')
      ) {
        break
      }
    }

    return NextResponse.json({
      success: true,
      iterations_requested: iterations,
      iterations_done: calls.length,
      calls,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Erreur cron maintenance clients.',
      },
      { status: 500 }
    )
  }
}