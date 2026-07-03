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

    const workerUrl = new URL('/api/client-maintenance/worker', req.nextUrl.origin)
    const workerRes = await fetch(workerUrl.toString(), {
      method: 'POST',
      headers: { 'x-client-maintenance-secret': process.env.CLIENT_MAINTENANCE_SECRET || '' },
    })
    const workerData = await workerRes.json().catch(() => null)

    return NextResponse.json({ success: workerRes.ok, worker: workerData }, { status: workerRes.status })
  } catch (error: any) {
    console.error('cron/client-maintenance-worker error:', error)
    return NextResponse.json({ success: false, error: error?.message || String(error) }, { status: 500 })
  }
}
