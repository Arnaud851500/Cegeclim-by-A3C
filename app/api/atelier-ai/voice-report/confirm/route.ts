// app/api/atelier-ai/voice-report/confirm/route.ts
//
// Étape 2 du flux vocal : reçoit soit l'enregistrement de la réponse orale
// de l'utilisateur à "est-ce correct ?", soit une réponse manuelle envoyée
// par les gros boutons Oui/Non de l'UI (champ reponse_manuelle, sans
// audio -- plus rapide et 100% fiable, en secours de la reconnaissance
// vocale sur un mot isolé qui est intrinsèquement moins fiable). Si c'est
// oui, écrit réellement en base : une ligne todo_actions par tâche
// détectée, et (en mode compte_rendu) une ligne client_comptes_rendus liée
// au rdv. Le client renvoie le résumé/tâches déjà obtenus à l'étape 1 (pas
// de cache serveur à gérer : tout transite par le payload).
//
// ÉVOLUTION : résolution de l'affectation vocale ("affecte à Arnaud",
// "assigne à Jean-Marc") vers un email connu de l'app avant d'écrire les
// tâches. Table public.assistant_collaborateurs_connus (email, prenom,
// nom, alias[]) : pour chaque tâche, on garde l'assigned_to_email transmis
// par l'étape 1 SI c'est déjà un email connu ; sinon on cherche dans le
// transcript d'origine un motif "affecte/assigne (...) à <alias connu>" et
// on bascule vers l'email correspondant ; à défaut, on retombe sur le
// créateur de la tâche (comportement historique).

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

/** Normalisation commune (accents, apostrophes, ponctuation) réutilisée par
 * la détection oui/non ET par la résolution d'affectation ci-dessous. */
function normaliserTexte(texte: string): string {
  return String(texte || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents
    .replace(/['’ʼ`]/g, ' ') // toutes les formes d'apostrophe
    .replace(/[^a-z0-9\s-]/g, ' ') // ponctuation
    .replace(/\s+/g, ' ')
    .trim()
}

/** Détection oui/non par mots-clés — volontairement pas d'appel IA ici :
 * plus rapide, gratuit, et largement suffisant pour une réponse courte du
 * type "oui c'est bon" / "non annule".
 *
 * CORRECTIF (liste étoffée) : couvre maintenant davantage de tournures
 * courantes ("banco", "je valide", "impec", "vas-y", "ça marche"...) --
 * l'ancienne liste ratait des confirmations pourtant sans ambiguïté pour un
 * humain, obligeant à redemander inutilement. */
function detecterConfirmation(transcript: string): boolean | null {
  const t = normaliserTexte(transcript).replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim()

  const positifs = [
    'oui', 'ouais', 'ouai', 'yes', 'ouep', 'ouip', 'ok', 'okay', 'valide', 'correct', 'exact',
    'exactement', 'cest bon', 'cest ca', 'cest ça', 'parfait', 'confirme',
    'confirmes', 'daccord', "d'accord".normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/'/g, ''),
    'top', 'nickel', 'impec', 'impeccable', 'tout a fait', 'voila', 'affirmatif', 'enregistre',
    'banco', 'ca marche', 'ça marche', 'ca me va', 'ça me va', 'je valide', 'vas y', "vas-y",
    'tout bon', 'cest good', 'ca roule', 'ça roule', 'ok pour moi', 'nickel chrome',
  ]
  const negatifs = [
    'non', 'annule', 'annules', 'refait', 'refaits', 'recommence', 'reprends',
    'faux', 'incorrect', 'stop', 'pas correct', 'pas bon', 'erreur', 'nan',
    'attends', 'pas ca', 'pas ça', 'change ca', 'change ça', 'ce nest pas ca', "ce n'est pas ça".normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/'/g, ''),
  ]

  const estPositif = positifs.some((mot) => t.includes(mot))
  const estNegatif = negatifs.some((mot) => t.includes(mot))

  if (estPositif && !estNegatif) return true
  if (estNegatif && !estPositif) return false
  return null // réponse ambiguë (ou vide) : le front doit redemander
}

type CollaborateurConnu = { email: string; alias: string[] }

/** Cherche dans le transcript d'origine un motif "affecte(-la) à <nom>" ou
 * "assigne(-la) à <nom>" et tente de faire correspondre <nom> à un alias
 * connu (table assistant_collaborateurs_connus). Renvoie le premier email
 * trouvé, ou null si aucun motif d'affectation n'est présent ou si le nom
 * cité ne correspond à personne de connu. */
function resoudreAssignationDepuisTranscript(transcript: string, collaborateurs: CollaborateurConnu[]): string | null {
  const texte = normaliserTexte(transcript)
  if (!texte || collaborateurs.length === 0) return null

  for (const collab of collaborateurs) {
    for (const aliasBrut of collab.alias || []) {
      const alias = normaliserTexte(aliasBrut)
      if (!alias) continue
      // "affecte(e/es/ee) ... à <alias>" ou "assigne(e/es/ee) ... à <alias>",
      // avec jusqu'à ~20 caractères de mots de liaison entre les deux
      // (ex. "affecte la tâche à Jean-Marc").
      const motif = new RegExp(`(affect|assign)[a-z]*[^a-z0-9]{0,25}${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
      if (motif.test(texte)) return collab.email
    }
  }
  return null
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const audio = form.get('audio') as File | null
    // Réponse envoyée directement par les boutons Oui/Non de l'UI, sans
    // passer par le micro. Prioritaire sur l'audio si les deux sont
    // présents (ne devrait pas arriver côté client, mais au cas où).
    const reponseManuelle = String(form.get('reponse_manuelle') || '').trim().toLowerCase()
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

    let confirme: boolean | null
    let confirmationTranscript = ''

    if (reponseManuelle === 'oui' || reponseManuelle === 'non') {
      confirme = reponseManuelle === 'oui'
      confirmationTranscript = `[réponse tactile] ${reponseManuelle}`
    } else {
      if (!audio) return NextResponse.json({ error: 'Aucun audio reçu.' }, { status: 400 })
      confirmationTranscript = await transcrireAudio(audio)
      confirme = detecterConfirmation(confirmationTranscript)
    }

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
        message: "Je n'ai pas compris si c'était oui ou non. Peux-tu répéter clairement « oui » ou « non », ou utiliser les boutons à l'écran ?",
      })
    }

    if (!confirme) {
      return NextResponse.json({ confirme: false, message: 'Compris, rien n’a été enregistré. On reprend la dictée.' })
    }

    // --- Confirmé : écriture réelle en base ---------------------------

    let taches: Array<{ description: string; echeance: string | null; assigned_to_email: string | null }> = []
    try {
      taches = JSON.parse(tachesRaw)
    } catch {
      taches = []
    }

    let createdTaskCount = 0

    if (taches.length > 0) {
      // Résolution de l'affectation vocale ("affecte à Arnaud", "assigne à
      // Jean-Marc") -- voir note en tête de fichier. Un seul aller-retour
      // base pour toute la liste des collaborateurs connus, réutilisé pour
      // chaque tâche.
      const { data: collaborateursData, error: collabError } = await supabaseAdmin
        .from('assistant_collaborateurs_connus')
        .select('email, alias')
        .eq('actif', true)
      if (collabError) console.warn('[voice-report/confirm] lecture collaborateurs connus impossible :', collabError.message)

      const collaborateurs = (collaborateursData || []) as CollaborateurConnu[]
      const emailsConnus = new Set(collaborateurs.map((c) => c.email.toLowerCase()))
      const emailDicteDansTranscript = resoudreAssignationDepuisTranscript(transcriptOriginal, collaborateurs)

      const rows = taches.map((t) => {
        const emailAnnonce = (t.assigned_to_email || '').trim().toLowerCase()
        const emailValideAnnonce = emailAnnonce && emailsConnus.has(emailAnnonce) ? emailAnnonce : null
        const assignedTo = emailValideAnnonce || emailDicteDansTranscript || userEmail
        return {
          created_by_email: userEmail,
          created_by_name: userName,
          mission_project: '',
          description_action: t.description,
          assigned_to: assignedTo,
          due_date: t.echeance,
          status: 'Non débuté',
          comment_progress: '',
          sort_order: 0,
          numero_tiers: numeroTiers || null,
        }
      })

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
          timeZone: 'Europe/Paris',
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
