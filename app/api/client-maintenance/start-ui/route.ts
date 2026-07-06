import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}`)
  }
  return value
}

export async function POST(req: NextRequest) {
  try {
    const secret = requiredEnv('CLIENT_MAINTENANCE_SECRET')
    const body = await req.json().catch(() => ({}))

    const startUrl = new URL('/api/client-maintenance/start', req.url)

    const res = await fetch(startUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-client-maintenance-secret': secret,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    const text = await res.text()
    const contentType = res.headers.get('content-type') || 'application/json'

    return new NextResponse(text, {
      status: res.status,
      headers: {
        'Content-Type': contentType,
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Erreur lancement maintenance clients depuis le front.',
      },
      { status: 500 }
    )
  }
}