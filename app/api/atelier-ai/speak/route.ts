// app/api/atelier-ai/speak/route.ts
//
// Texte -> audio (OpenAI TTS). Retourne directement le flux audio/mpeg,
// que le front joue via un élément <audio>. Pas de stockage : généré à la
// volée à chaque appel.

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json()
    const cleanText = String(text || '').trim().slice(0, 2000)

    if (!cleanText) {
      return NextResponse.json({ error: 'Texte manquant.' }, { status: 400 })
    }

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: 'nova',
        input: cleanText,
        response_format: 'mp3',
      }),
    })

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Synthèse vocale échouée (${res.status}) : ${detail.slice(0, 300)}`)
    }

    return new NextResponse(res.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error: any) {
    console.error('[speak] erreur', error)
    return NextResponse.json({ error: error?.message || 'Erreur inattendue.' }, { status: 500 })
  }
}
