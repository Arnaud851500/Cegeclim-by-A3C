import { NextRequest, NextResponse } from 'next/server'
import {
  recomputeAllMissingNextRuns,
  runDueSchedulerJobs,
} from '@/lib/server/scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function getOrigin(req: NextRequest) {
  const origin = req.headers.get('origin')
  if (origin) return origin

  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'https'

  if (!host) throw new Error('Impossible de déterminer l’origine de l’application.')
  return `${proto}://${host}`
}

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const maintenanceSecret = process.env.CLIENT_MAINTENANCE_SECRET

  const authorization = req.headers.get('authorization') || ''
  const bearer = authorization.replace(/^Bearer\s+/i, '').trim()
  const clientSecret = req.headers.get('x-client-maintenance-secret') || ''

  if (cronSecret && bearer === cronSecret) return true
  if (maintenanceSecret && bearer === maintenanceSecret) return true
  if (maintenanceSecret && clientSecret === maintenanceSecret) return true

  // Vercel Cron ajoute généralement cet en-tête.
  // On ne l'accepte que si aucun secret n'est défini pour éviter d'ouvrir la route inutilement.
  if (!cronSecret && !maintenanceSecret && req.headers.get('x-vercel-cron')) return true

  return false
}

async function handler(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, error: 'Non autorisé.' },
        { status: 401 }
      )
    }

    await recomputeAllMissingNextRuns()
    const results = await runDueSchedulerJobs(getOrigin(req))

    return NextResponse.json({
      success: true,
      results,
      executed_at: new Date().toISOString(),
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
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
