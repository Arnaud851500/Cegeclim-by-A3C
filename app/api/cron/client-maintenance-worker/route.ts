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
  const maintenanceSecret = process.env.CLIENT_MAINTENANCE_SECRET
  const cronSecret = process.env.CRON_SECRET

  const headerSecret = req.headers.get('x-client-maintenance-secret') || ''
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''

  if (maintenanceSecret && headerSecret === maintenanceSecret) return true
  if (maintenanceSecret && bearer === maintenanceSecret) return true
  if (cronSecret && bearer === cronSecret) return true

  return false
}

function shouldStopAfterWorkerResponse(body: any) {
  const text = JSON.stringify(body || {}).toLowerCase()

  return (
    text.includes('aucun run actif') ||
    text.includes('aucun run') ||
    text.includes('no active') ||
    text.includes('nothing_to_do') ||
    body?.finalized === true
  )
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

    const iterations = Math.max(
      1,
      Math.min(Number(req.nextUrl.searchParams.get('iterations') || 8), 12)
    )

    const workerUrl = new URL('/api/client-maintenance/worker', req.nextUrl.origin)

    const calls: any[] = []

    for (let i = 1; i <= iterations; i++) {
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
        body = text ? JSON.parse(text) : null
      } catch {
        body = { raw: text }
      }

      calls.push({
        iteration: i,
        status: res.status,
        ok: res.ok,
        body,
      })

      if (!res.ok) {
        break
      }

      if (shouldStopAfterWorkerResponse(body)) {
        break
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Burst worker maintenance clients exécuté.',
      iterations_requested: iterations,
      iterations_done: calls.length,
      calls,
    })
  } catch (error: any) {
    console.error('cron/client-maintenance-worker error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error?.message || String(error),
      },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  return runWorkerBurst(req)
}

export async function POST(req: NextRequest) {
  return runWorkerBurst(req)
}