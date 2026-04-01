import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { sirets } = await req.json()

    if (!Array.isArray(sirets) || sirets.length === 0) {
      return NextResponse.json({ success: false, error: 'Liste vide' }, { status: 400 })
    }

    const results = []

    for (const siret of sirets.slice(0, 50)) {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || ''}/api/enrich-client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siret }),
      })

      const json = await res.json()
      results.push({ siret, ok: Boolean(json.success), error: json.error || null })
    }

    return NextResponse.json({ success: true, results })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}