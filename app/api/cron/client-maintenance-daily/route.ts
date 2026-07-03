import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(req: NextRequest) {
  const secret = process.env.CLIENT_MAINTENANCE_SECRET
  if (!secret) return true

  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const headerSecret = req.headers.get('x-client-maintenance-secret')
  return auth === secret || headerSecret === secret
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, error: 'Non autorisé.' }, { status: 401 })
    }

    const startUrl = new URL('/api/client-maintenance/start', req.nextUrl.origin)
    const startRes = await fetch(startUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-maintenance-secret': process.env.CLIENT_MAINTENANCE_SECRET || '',
      },
      body: JSON.stringify({
        source: 'cron',
        config: {
          sirene: true,
          cessations: true,
          rge: true,
          capacite: true,
          enrichment: true,
          enrichmentLimit: Number(process.env.CLIENT_MAINTENANCE_ENRICHMENT_LIMIT || 1000),
          enrichmentBatchSize: Number(process.env.CLIENT_MAINTENANCE_ENRICHMENT_BATCH_SIZE || 25),
        },
      }),
    })

    const startData = await startRes.json().catch(() => null)

    if (!startRes.ok && startRes.status !== 409) {
      return NextResponse.json({ success: false, error: startData?.error || 'Erreur création run.' }, { status: startRes.status })
    }

    const workerUrl = new URL('/api/client-maintenance/worker', req.nextUrl.origin)
    const workerRes = await fetch(workerUrl.toString(), {
      method: 'POST',
      headers: { 'x-client-maintenance-secret': process.env.CLIENT_MAINTENANCE_SECRET || '' },
    })
    const workerData = await workerRes.json().catch(() => null)

    return NextResponse.json({ success: true, start: startData, worker: workerData })
  } catch (error: any) {
    console.error('cron/client-maintenance-daily error:', error)
    return NextResponse.json({ success: false, error: error?.message || String(error) }, { status: 500 })
  }
}
