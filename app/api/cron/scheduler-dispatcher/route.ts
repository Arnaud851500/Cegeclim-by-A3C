import { NextRequest, NextResponse } from 'next/server'
import {
  recomputeAllMissingNextRuns,
  runDueSchedulerJobs,
} from '@/lib/server/scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const maintenanceSecret = process.env.CLIENT_MAINTENANCE_SECRET

  const authorization = req.headers.get('authorization') || ''
  const bearer = authorization.replace(/^Bearer\s+/i, '').trim()
  const clientSecret = req.headers.get('x-client-maintenance-secret') || ''

  if (cronSecret && bearer === cronSecret) return true
  if (maintenanceSecret && bearer === maintenanceSecret) return true
  if (maintenanceSecret && clientSecret === maintenanceSecret) return true

  if (!cronSecret && !maintenanceSecret && req.headers.get('x-vercel-cron')) {
    return true
  }

  return false
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

async function handler(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, error: 'Non autorisé.' },
        { status: 401 }
      )
    }

    await recomputeAllMissingNextRuns()
    const results = await runDueSchedulerJobs()

    return NextResponse.json({
      success: true,
      results,
      executed_at: new Date().toISOString(),
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: toErrorMessage(error) },
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
