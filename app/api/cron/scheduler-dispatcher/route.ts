import { NextRequest, NextResponse } from 'next/server'
import { recomputeAllMissingNextRuns, runDueSchedulerJobs } from '../../../../lib/server/scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const maintenanceSecret = process.env.CLIENT_MAINTENANCE_SECRET

  const authorization = req.headers.get('authorization') || ''
  const bearer = authorization.replace(/^Bearer\s+/i, '')
  const clientSecret = req.headers.get('x-client-maintenance-secret') || ''

  if (cronSecret && bearer === cronSecret) return true
  if (maintenanceSecret && bearer === maintenanceSecret) return true
  if (maintenanceSecret && clientSecret === maintenanceSecret) return true

  return false
}

async function handler(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, error: 'Non autorisé.' }, { status: 401 })
    }

    await recomputeAllMissingNextRuns()

    const results = await runDueSchedulerJobs(req.nextUrl.origin)

    return NextResponse.json({
      success: true,
      message: 'Dispatcher scheduler exécuté.',
      count: results.length,
      results,
    })
  } catch (error: any) {
    console.error('scheduler-dispatcher error:', error)

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
  return handler(req)
}

export async function POST(req: NextRequest) {
  return handler(req)
}
