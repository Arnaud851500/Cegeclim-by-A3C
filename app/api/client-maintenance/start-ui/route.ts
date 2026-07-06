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

async function readJsonSafe(res: Response) {
  const text = await res.text()

  try {
    return text ? JSON.parse(text) : null
  } catch {
    return { raw: text }
  }
}

export async function POST(req: NextRequest) {
  try {
    const secret = requiredEnv('CLIENT_MAINTENANCE_SECRET')
    const body = await req.json().catch(() => ({}))

    /**
     * 1. Création du run
     * Ici on est bien en POST avec un body.
     */
    const startUrl = new URL('/api/client-maintenance/start', req.nextUrl.origin)

    const startRes = await fetch(startUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-maintenance-secret': secret,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    const startJson = await readJsonSafe(startRes)

    if (!startRes.ok || startJson?.success === false) {
      return NextResponse.json(
        {
          success: false,
          stage: 'start',
          status: startRes.status,
          result: startJson,
          error:
            startJson?.error ||
            startJson?.message ||
            'Erreur création du run maintenance clients.',
        },
        { status: startRes.status || 500 }
      )
    }

    /**
     * 2. Lancement du worker burst
     * Ici on utilise GET, donc surtout PAS de body.
     */
    const workerUrl = new URL(
      '/api/cron/client-maintenance-worker',
      req.nextUrl.origin
    )

    workerUrl.searchParams.set('iterations', '8')

    const workerRes = await fetch(workerUrl.toString(), {
      method: 'GET',
      headers: {
        'x-client-maintenance-secret': secret,
      },
      cache: 'no-store',
    })

    const workerJson = await readJsonSafe(workerRes)

    if (!workerRes.ok || workerJson?.success === false) {
      return NextResponse.json(
        {
          success: false,
          stage: 'worker',
          start: startJson,
          worker: workerJson,
          error:
            workerJson?.error ||
            workerJson?.message ||
            'Run créé mais erreur au lancement du worker.',
        },
        { status: workerRes.status || 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Maintenance clients lancée.',
      start: startJson,
      worker: workerJson,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          'Erreur lancement maintenance clients.',
      },
      { status: 500 }
    )
  }
}