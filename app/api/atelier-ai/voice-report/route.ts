// app/api/atelier-ai/voice-report/route.ts
//
// Étape 1 du flux vocal : reçoit l'audio enregistré (compte-rendu de visite
// OU dictée d'une tâche seule), le transcrit, puis demande à l'IA de le
// structurer (résumé + tâches détectées avec échéance/assigné). Ne
// commit RIEN en base côté "métier" à ce stade (ni todo_actions, ni
// compte-rendu) — ça n'arrive qu'après confirmation orale, via
// /api/atelier-ai/voice-report/confirm. Seule la mémoire de conversation
// (assistant_conversation_memory) est écrite immédiatement : elle doit
// tracer l'échange même si l'utilisateur abandonne avant confirmation.
//
// ATTENTION — adapte à ton projet si besoin :
// - Suppose une variable d'env SUPABASE_SERVICE_ROLE_KEY (clé service-role,
//   jamais exposée au client) en plus de NEXT_PUBLIC_SUPABASE_URL déjà
//   utilisée par lib/supabaseClient.ts. Si tu as déjà un client admin
//   ailleurs (ex. lib/supabaseAdmin.ts), remplace l'init ci-dessous par
//   ton import existant.
// - Utilise OPENAI_API_KEY et OPENAI_INTERPRET_MODEL (déjà présent dans ton
//   .env d'après la capture partagée) pour la structuration GPT.
// - rdv_activity_id : adapte le type/la colonne source si l'id BLG n'est
//   pas un simple texte chez toi (vu que je n'ai pas le schéma exact de
//   crm_base_activity).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
)

type Tache = {
  description: string
  echeance: string | null // 'YYYY-MM-DD' ou null
  assigned_to_email: string | null
}

type StructureResult = {
  resume: string
  spoken_summary: string
  taches: Tache[]
}

function normaliserTexte(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** Filet de sécurité : si l'IA n'a pas su rattacher une tâche à un email
 * (assigned_to_email = null), on recherche le prénom de chaque
 * collaborateur connu dans le texte de la tâche PUIS dans la transcription
 * complète — un simple rapprochement par mot entier suffit largement pour
 * ce cas d'usage, et évite de dépendre entièrement du jugement du modèle
 * sur une liste de noms parfois longue. */
function completerAssignationParPrenom(
  taches: Tache[],
  assignees: Array<{ email: string; name: string }>,
  transcript: string,
): Tache[] {
  const transcriptNorm = normaliserTexte(transcript)

  return taches.map((tache) => {
    if (tache.assigned_to_email) return tache

    const descriptionNorm = normaliserTexte(tache.description)

    for (const assignee of assignees) {
      const prenom = normaliserTexte(assignee.name).split(/\s+/)[0]
      if (!prenom || prenom.length < 3) continue
      const motEntier = new RegExp(`\\b${prenom}\\b`)
      if (motEntier.test(descriptionNorm) || motEntier.test(transcriptNorm)) {
        return { ...tache, assigned_to_email: assignee.email }
      }
    }
    return tache
  })
}

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

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Transcription échouée (${res.status}) : ${detail.slice(0, 300)}`)
  }

  const data = await res.json()
  return String(data.text || '').trim()
}

async function structurer(params: {
  mode: 'compte_rendu' | 'tache'
  transcript: string
  clientNom: string
  numeroTiers: string
  rdvLabel?: string
  assignees: Array<{ email: string; name: string }>
  memoireRecente: string
  dateAujourdhui: string
}): Promise<StructureResult> {
  const { mode, transcript, clientNom, numeroTiers, rdvLabel, assignees, memoireRecente, dateAujourdhui } = params

  const assigneesTexte = assignees.map((a) => `- ${a.name} <${a.email}>`).join('\n')

  const consigneMode =
    mode === 'compte_rendu'
      ? `L'utilisateur vient de dicter le compte-rendu oral de sa visite chez ce client. Rédige un résumé structuré (3 à 6 phrases, clair et professionnel) et détecte TOUTES les actions/tâches à créer qui ressortent du récit (relances, envois de documents, rappels, devis à faire...).`
      : `L'utilisateur vient de dicter UNE SEULE tâche à ajouter${clientNom ? ' pour ce client' : ''} (pas un compte-rendu de visite). Le "resume" doit être une reformulation courte d'une phrase de cette tâche. Détecte exactement une tâche (ou zéro si la dictée ne décrit pas une action claire).`

  const prompt = `${consigneMode}
${clientNom ? `\nClient concerné : ${clientNom}${numeroTiers ? ` (n° ${numeroTiers})` : ''}` : ''}${rdvLabel ? `\nRendez-vous concerné : ${rdvLabel}` : ''}
Date du jour : ${dateAujourdhui}

Personnes à qui une tâche peut être assignée (utilise l'email exact si l'une d'elles est nommée dans la dictée, sinon assigned_to_email = null pour laisser l'utilisateur assigné par défaut) :
${assigneesTexte || '(aucune liste disponible)'}

Contexte des échanges précédents avec cet utilisateur, à titre indicatif uniquement (ne pas répéter, juste pour la cohérence de ton et de vocabulaire) :
${memoireRecente || '(aucun historique)'}

Transcription à traiter :
"""
${transcript}
"""

Réponds UNIQUEMENT en JSON valide, sans texte autour, avec exactement cette forme :
{
  "resume": "...",
  "spoken_summary": "...(1 à 3 phrases, formulées pour être LUES À VOIX HAUTE par un assistant vocal, qui présentent le résumé puis annoncent le nombre de tâches détectées avec leur intitulé court, et terminent en demandant si c'est correct)...",
  "taches": [
    { "description": "...", "echeance": "YYYY-MM-DD ou null", "assigned_to_email": "email ou null" }
  ]
}
Si une échéance est évoquée en relatif ("la semaine prochaine", "vendredi"...), convertis-la en date absolue à partir du ${dateAujourdhui}. Si aucune tâche n'est détectée, "taches": [].`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_INTERPRET_MODEL || 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'Tu es un assistant qui structure des comptes-rendus commerciaux CVC/HVAC en JSON strict.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Structuration IA échouée (${res.status}) : ${detail.slice(0, 300)}`)
  }

  const data = await res.json()
  const raw = data.choices?.[0]?.message?.content || '{}'

  let parsed: StructureResult
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Réponse IA non exploitable (JSON invalide).')
  }

  return {
    resume: String(parsed.resume || '').trim(),
    spoken_summary: String(parsed.spoken_summary || '').trim(),
    taches: Array.isArray(parsed.taches)
      ? parsed.taches.map((t: any) => ({
          description: String(t?.description || '').trim(),
          echeance: t?.echeance && /^\d{4}-\d{2}-\d{2}$/.test(t.echeance) ? t.echeance : null,
          assigned_to_email: t?.assigned_to_email ? String(t.assigned_to_email).trim().toLowerCase() : null,
        })).filter((t: Tache) => t.description)
      : [],
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const audio = form.get('audio') as File | null
    const mode = String(form.get('mode') || 'compte_rendu') as 'compte_rendu' | 'tache'
    const numeroTiers = String(form.get('numero_tiers') || '').trim()
    const clientNom = String(form.get('client_nom') || '').trim()
    const rdvLabel = String(form.get('rdv_label') || '').trim() || undefined
    const userEmail = String(form.get('user_email') || '').trim().toLowerCase()

    if (!audio) return NextResponse.json({ error: 'Aucun audio reçu.' }, { status: 400 })
    if (!userEmail) return NextResponse.json({ error: 'Utilisateur non identifié.' }, { status: 400 })

    const transcript = await transcrireAudio(audio)
    if (!transcript) {
      return NextResponse.json({ error: "Rien n'a été compris dans l'enregistrement. Réessaie." }, { status: 422 })
    }

    const [{ data: assigneesData }, { data: memoireData }] = await Promise.all([
      supabaseAdmin.from('user_page_access').select('email, display_name').eq('can_todo', true),
      supabaseAdmin
        .from('assistant_conversation_memory')
        .select('contenu, created_at')
        .eq('user_email', userEmail)
        .order('created_at', { ascending: false })
        .limit(5),
    ])

    const assignees = (assigneesData || []).map((a: any) => ({
      email: String(a.email || '').toLowerCase(),
      name: String(a.display_name || a.email || ''),
    }))

    const memoireRecente = (memoireData || [])
      .map((m: any) => `- ${m.contenu}`.slice(0, 240))
      .join('\n')

    const dateAujourdhui = new Date().toISOString().slice(0, 10)

    const structure = await structurer({
      mode,
      transcript,
      clientNom,
      numeroTiers,
      rdvLabel,
      assignees,
      memoireRecente,
      dateAujourdhui,
    })

    structure.taches = completerAssignationParPrenom(structure.taches, assignees, transcript)

    // Mémoire de conversation : tracée immédiatement, indépendamment de la
    // confirmation à venir (accès service-role uniquement, cf. migration).
    await supabaseAdmin.from('assistant_conversation_memory').insert({
      user_email: userEmail,
      contexte: mode,
      numero_tiers: numeroTiers,
      contenu: transcript,
    })

    return NextResponse.json({
      transcript,
      resume: structure.resume,
      spoken_summary: structure.spoken_summary,
      taches: structure.taches,
    })
  } catch (error: any) {
    console.error('[voice-report] erreur', error)
    return NextResponse.json({ error: error?.message || 'Erreur inattendue.' }, { status: 500 })
  }
}
