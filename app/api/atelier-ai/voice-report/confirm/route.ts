// app/api/atelier-ai/voice-report/confirm/route.ts
//
// Étape 2 du flux vocal : reçoit l'enregistrement de la réponse orale de
// l'utilisateur à "est-ce correct ?", détecte oui/non, et si c'est oui,
// écrit réellement en base : une ligne todo_actions par tâche détectée,
// et (en mode compte_rendu) une ligne client_comptes_rendus liée au rdv.
// Le client renvoie le résumé/tâches déjà obtenus à l'étape 1 (pas de
// cache serveur à gérer : tout transite par le payload).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
)

async function transcrireAudio(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  form.append('model', 'gpt-4o-mini-transcribe')
  form.append('language', 'fr')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  })

  if (!res.ok) throw new Error(`Transcription de la confirmation échouée (${res.status})`)
  const data = await res.json()
  return String(data.text || '').trim()
}

/** Détection oui/non simple par mots-clés — volontairement pas d'appel IA
 * ici : plus rapide, gratuit, et largement suffisant pour une réponse
 * courte du type "oui c'est bon" / "non annule". */
function detecterConfirmation(transcript: string): boolean | null {
  const t = transcript
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  const positifs = ['oui', 'ok', 'valide', 'correct', 'exact', "c'est bon", 'parfait', 'confirme']
  const negatifs = ['non', 'annule', 'refait', 'faux', 'incorrect', 'stop']

  const estPositif = positifs.some((mot) => t.includes(mot))
  const estNegatif = negatifs.some((mot) => t.includes(mot))

  if (estPositif && !estNegatif) return true
  if (estNegatif && !estPositif) return false
  return null // réponse ambiguë : le front doit redemander
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const audio = form.get('audio') as File | null
    const mode = String(form.get('mode') || 'compte_rendu') as 'compte_rendu' | 'tache'
    const numeroTiers = String(form.get('numero_tiers') || '').trim()
    const rdvActivityId = String(form.get('rdv_activity_id') || '').trim() || null
    const rdvLabel = String(form.get('rdv_label') || '').trim() || null
    const userEmail = String(form.get('user_email') || '').trim().toLowerCase()
    const userName = String(form.get('user_name') || '').trim() || userEmail
    const transcriptOriginal = String(form.get('transcript_original') || '').trim()
    const resume = String(form.get('resume') || '').trim()
    const tachesRaw = String(form.get('taches') || '[]')
    // Si renseigné : on complète ce compte-rendu existant (UPDATE) au lieu
    // d'en créer un nouveau (INSERT) — cf. bouton "Compléter le
    // compte-rendu" côté VoiceReportButtons.
    const compteRenduIdCible = String(form.get('compte_rendu_id') || '').trim() || null

    if (!audio) return NextResponse.json({ error: 'Aucun audio reçu.' }, { status: 400 })

    let taches: Array<{ description: string; echeance: string | null; assigned_to_email: string | null }> = []
    try {
      taches = JSON.parse(tachesRaw)
    } catch {
      taches = []
    }

    const confirmationTranscript = await transcrireAudio(audio)
    const confirme = detecterConfirmation(confirmationTranscript)

    // Trace aussi la réponse de confirmation dans la mémoire glissante.
    await supabaseAdmin.from('assistant_conversation_memory').insert({
      user_email: userEmail,
      contexte: `${mode}_confirmation`,
      numero_tiers: numeroTiers,
      contenu: confirmationTranscript,
    })

    if (confirme === null) {
      return NextResponse.json({
        confirme: null,
        message: "Je n'ai pas compris si c'était oui ou non. Peux-tu répéter clairement « oui » ou « non » ?",
      })
    }

    if (!confirme) {
      return NextResponse.json({ confirme: false, message: 'Compris, rien n’a été enregistré.' })
    }

    // --- Confirmé : écriture réelle en base ---------------------------

    let createdTaskCount = 0

    if (taches.length > 0) {
      const rows = taches.map((t) => ({
        created_by_email: userEmail,
        created_by_name: userName,
        mission_project: '',
        description_action: t.description,
        assigned_to: t.assigned_to_email || userEmail,
        due_date: t.echeance,
        status: 'Non débuté',
        comment_progress: '',
        sort_order: 0,
        numero_tiers: numeroTiers || null,
      }))

      const { data: inserted, error: todoError } = await supabaseAdmin
        .from('todo_actions')
        .insert(rows)
        .select('id')

      if (todoError) throw todoError
      createdTaskCount = inserted?.length || 0
    }

    if (mode === 'compte_rendu') {
      if (compteRenduIdCible) {
        // --- Complément d'un compte-rendu existant : on fusionne plutôt
        // que de créer un doublon déconnecté. Concaténation simple (pas
        // d'appel IA supplémentaire) : plus prévisible, aucun risque que
        // l'IA "oublie" ou reformule mal le contenu déjà validé.
        const { data: existant, error: fetchError } = await supabaseAdmin
          .from('client_comptes_rendus')
          .select('resume, taches_detectees, transcript')
          .eq('id', compteRenduIdCible)
          .maybeSingle()
        if (fetchError) throw fetchError

        const horodatage = new Date().toLocaleString('fr-FR', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        })
        const resumeFusionne = existant?.resume
          ? `${existant.resume}\n\n— Complément du ${horodatage} —\n${resume}`
          : resume
        const tachesFusionnees = [...((existant?.taches_detectees as any[]) || []), ...taches]
        const transcriptFusionne = existant?.transcript
          ? `${existant.transcript}\n\n${transcriptOriginal}`
          : transcriptOriginal

        const { error: updateError } = await supabaseAdmin
          .from('client_comptes_rendus')
          .update({ resume: resumeFusionne, taches_detectees: tachesFusionnees, transcript: transcriptFusionne })
          .eq('id', compteRenduIdCible)
        if (updateError) throw updateError
      } else {
        const { error: crError } = await supabaseAdmin.from('client_comptes_rendus').insert({
          numero_tiers: numeroTiers,
          rdv_activity_id: rdvActivityId,
          rdv_label: rdvLabel,
          created_by_email: userEmail,
          created_by_name: userName,
          transcript: transcriptOriginal,
          resume,
          taches_detectees: taches,
        })
        if (crError) throw crError
      }
    }

    return NextResponse.json({
      confirme: true,
      created_task_count: createdTaskCount,
      message:
        mode === 'compte_rendu'
          ? `Compte-rendu enregistré, avec ${createdTaskCount} tâche${createdTaskCount > 1 ? 's' : ''}.`
          : `Tâche${createdTaskCount > 1 ? 's' : ''} créée${createdTaskCount > 1 ? 's' : ''}.`,
    })
  } catch (error: any) {
    console.error('[voice-report/confirm] erreur', error)
    return NextResponse.json({ error: error?.message || 'Erreur inattendue.' }, { status: 500 })
  }
}
