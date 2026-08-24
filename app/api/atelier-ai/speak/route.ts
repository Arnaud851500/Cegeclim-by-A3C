// app/api/atelier-ai/speak/route.ts
//
// Texte -> audio (OpenAI TTS). Retourne directement le flux audio/mpeg,
// que le front joue via un élément <audio>. Pas de stockage : généré à la
// volée à chaque appel.

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Les 6 timbres proposés par OpenAI TTS (tts-1) -- doit rester synchronisé
// avec VOIX_OPTIONS côté front (MobileHome.tsx). Filet de sécurité : si le
// front envoie un identifiant inattendu (préférence corrompue, ancienne
// valeur...), on retombe sur 'nova' plutôt que de faire échouer l'appel
// OpenAI (qui rejetterait une valeur de "voice" non reconnue).
const VOIX_AUTORISEES = new Set(['nova', 'alloy', 'echo', 'fable', 'onyx', 'shimmer'])

// Plage acceptée par l'API OpenAI TTS pour "speed" -- même filet de
// sécurité que pour la voix : une valeur hors plage ou absente retombe sur
// 1.15 (vitesse par défaut historique de cette route) plutôt que de faire
// échouer l'appel OpenAI.
const VITESSE_MIN = 0.25
const VITESSE_MAX = 4.0
const VITESSE_DEFAUT = 1.15

export async function POST(req: NextRequest) {
  try {
    const { text, voice, speed } = await req.json()
    const cleanText = String(text || '').trim().slice(0, 2000)

    // CORRECTIF : le paramètre `voice` envoyé par le front (choix de
    // l'utilisateur dans "🎙️ Voix", ou voixPreferee dans
    // VoiceReportButtons/MobileHomeSummary) n'était jusqu'ici jamais lu --
    // seul `text` était déstructuré, et 'nova' partait toujours en dur
    // vers OpenAI ci-dessous. D'où le retour systématique de la même voix
    // féminine quel que soit le timbre sélectionné à l'écran.
    const voixDemandee = String(voice || '').trim().toLowerCase()
    const voixFinale = VOIX_AUTORISEES.has(voixDemandee) ? voixDemandee : 'nova'

    // Vitesse de lecture -- même principe que la voix : réglable par
    // l'utilisateur (vision_tci_preferences.vitesse_lecture), transmise ici
    // par le front à chaque appel. Repli sur la vitesse par défaut si
    // absente ou hors plage OpenAI.
    const vitesseDemandee = Number(speed)
    const vitesseFinale = Number.isFinite(vitesseDemandee) && vitesseDemandee >= VITESSE_MIN && vitesseDemandee <= VITESSE_MAX
      ? vitesseDemandee
      : VITESSE_DEFAUT

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
        voice: voixFinale,
        input: cleanText,
        response_format: 'mp3',
        speed: vitesseFinale,
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
