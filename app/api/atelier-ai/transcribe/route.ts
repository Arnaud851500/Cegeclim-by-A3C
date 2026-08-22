// app/api/atelier-ai/transcribe/route.ts
//
// Transcription pure (pas de structuration GPT) : utilisée pour les
// interactions vocales où il s'agit juste d'interpréter un choix parmi
// quelques options (ex: "aujourd'hui / cette semaine / mes rdv" dans
// MobileHomeSummary), pas de dicter un compte-rendu ou une tâche.
// Contrairement à /api/atelier-ai/voice-report, ne nécessite ni client ni
// contexte métier, et ne fait qu'un seul appel réseau (Whisper), donc plus
// rapide pour ce cas d'usage.

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const audio = form.get('audio') as File | null
    if (!audio) return NextResponse.json({ error: 'Aucun audio reçu.' }, { status: 400 })

    const openaiForm = new FormData()
    openaiForm.append('file', audio)
    openaiForm.append('model', 'gpt-4o-mini-transcribe')
    openaiForm.append('language', 'fr')

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: openaiForm,
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Transcription échouée (${res.status}) : ${detail.slice(0, 300)}`)
    }

    const data = await res.json()
    return NextResponse.json({ transcript: String(data.text || '').trim() })
  } catch (error: any) {
    console.error('[transcribe] erreur', error)
    return NextResponse.json({ error: error?.message || 'Erreur inattendue.' }, { status: 500 })
  }
}
