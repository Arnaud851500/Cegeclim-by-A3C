// app/api/blg-sync/route.ts
//
// Proxy côté serveur vers le déclencheur de synchro BLG sur le VPS. Le jeton
// secret (BLG_SYNC_TRIGGER_SECRET) et l'URL du VPS (BLG_SYNC_TRIGGER_URL)
// restent uniquement dans les variables d'environnement Next.js (jamais
// exposées au navigateur) — le bouton front appelle cette route, pas le VPS
// directement.
//
// Variables d'environnement à ajouter (Vercel > Settings > Environment Variables) :
//   BLG_SYNC_TRIGGER_URL    = http://37.59.125.60:3002
//   BLG_SYNC_TRIGGER_SECRET = <le même secret que sur le VPS>

import { NextResponse } from 'next/server'

export async function POST() {
  const url = process.env.BLG_SYNC_TRIGGER_URL
  const secret = process.env.BLG_SYNC_TRIGGER_SECRET

  if (!url || !secret) {
    return NextResponse.json({ error: 'Configuration manquante (BLG_SYNC_TRIGGER_URL / BLG_SYNC_TRIGGER_SECRET)' }, { status: 500 })
  }

  try {
    const res = await fetch(`${url}/trigger`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      // Le VPS répond immédiatement (202), pas besoin d'attendre la fin de la synchro
      signal: AbortSignal.timeout(10_000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch (e) {
    return NextResponse.json({ error: `Impossible de joindre le VPS : ${(e as Error).message}` }, { status: 502 })
  }
}

export async function GET() {
  const url = process.env.BLG_SYNC_TRIGGER_URL
  const secret = process.env.BLG_SYNC_TRIGGER_SECRET
  if (!url || !secret) {
    return NextResponse.json({ error: 'Configuration manquante' }, { status: 500 })
  }
  try {
    const res = await fetch(`${url}/status`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(5_000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch (e) {
    return NextResponse.json({ error: `Impossible de joindre le VPS : ${(e as Error).message}` }, { status: 502 })
  }
}
