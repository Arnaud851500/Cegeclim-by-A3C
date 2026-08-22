'use client'

import { useRef, useState } from 'react'

/**
 * Deux boutons vocaux à insérer dans la sheet de détail d'un RDV (ou dans
 * la fiche client, juste après "prochaine visite") :
 * - "Compte-rendu vocal" : dicter le compte-rendu de la visite, l'IA le
 *   structure et détecte les tâches à créer.
 * - "Ajouter une tâche vocale" : dicter une seule tâche liée au client.
 *
 * Flux : appui -> annonce vocale + enregistrement -> nouvel appui pour
 * arrêter -> transcription + structuration (POST /api/atelier-ai/voice-report)
 * -> l'agent énonce le résumé et demande confirmation -> enregistrement de
 * la réponse -> POST .../confirm qui écrit réellement en base si "oui".
 *
 * Ne nécessite QUE ces props ; toute la logique d'état est interne, donc ce
 * composant se colle tel quel dans MobileRdv.tsx et dans le
 * openVisiteDetail(...) de MobileClients_v2.tsx sans autre modification.
 *
 * Point d'attention iOS : la lecture audio doit démarrer depuis un geste
 * utilisateur direct pour ne pas être bloquée par Safari. Le premier
 * play() (annonce initiale) est bien dans le handler onClick du bouton, ok.
 * Les lectures suivantes (résumé, redemande) se font dans des handlers
 * async déclenchés en cascade depuis ce même clic initial ; à tester sur
 * device réel — si Safari bloque, il faudra insérer un bouton "Écouter la
 * réponse" intermédiaire plutôt qu'une lecture auto.
 */

type Tache = { description: string; echeance: string | null; assigned_to_email: string | null }

type Etape =
  | 'idle'
  | 'annonce'
  | 'enregistrement'
  | 'traitement'
  | 'lecture_resume'
  | 'enregistrement_confirmation'
  | 'traitement_confirmation'
  | 'termine'
  | 'erreur'

type Mode = 'compte_rendu' | 'tache'

export default function VoiceReportButtons({
  numeroTiers,
  clientNom,
  rdvActivityId,
  rdvLabel,
  userEmail,
  userName,
}: {
  numeroTiers: string
  clientNom: string
  rdvActivityId?: string | null
  rdvLabel?: string | null
  userEmail: string
  userName: string
}) {
  const [modeActif, setModeActif] = useState<Mode | null>(null)
  const [etape, setEtape] = useState<Etape>('idle')
  const [messageFinal, setMessageFinal] = useState('')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const dernierResultatRef = useRef<{ transcript: string; resume: string; taches: Tache[] } | null>(null)

  function mimeTypeSupporte() {
    if (typeof MediaRecorder === 'undefined') return ''
    if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
    if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
    return ''
  }

  async function jouerTexte(texte: string) {
    const res = await fetch('/api/atelier-ai/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texte }),
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve()
      audio.onerror = () => resolve()
      void audio.play().catch(() => resolve())
    })
    URL.revokeObjectURL(url)
  }

  async function demarrerEnregistrement(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream
    const mimeType = mimeTypeSupporte()
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    chunksRef.current = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    mediaRecorderRef.current = recorder
    recorder.start()
  }

  function arreterEnregistrement(): Promise<Blob> {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder) {
        resolve(new Blob())
        return
      }
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm'
        resolve(new Blob(chunksRef.current, { type }))
        streamRef.current?.getTracks().forEach((t) => t.stop())
      }
      recorder.stop()
    })
  }

  async function lancer(mode: Mode) {
    setModeActif(mode)
    setMessageFinal('')
    dernierResultatRef.current = null

    try {
      setEtape('annonce')
      const phraseAccueil =
        mode === 'compte_rendu'
          ? 'Je t’écoute pour synthétiser le compte rendu de ta visite.'
          : 'Je t’écoute, décris la tâche à ajouter.'
      await jouerTexte(phraseAccueil)

      setEtape('enregistrement')
      await demarrerEnregistrement()
    } catch (err) {
      console.error(err)
      setEtape('erreur')
      setMessageFinal("Impossible d'accéder au micro. Vérifie les autorisations du navigateur.")
    }
  }

  async function stopperEtEnvoyer() {
    if (!modeActif) return
    try {
      const blob = await arreterEnregistrement()
      setEtape('traitement')

      const form = new FormData()
      form.append('audio', blob, blob.type.includes('mp4') ? 'audio.mp4' : 'audio.webm')
      form.append('mode', modeActif)
      form.append('numero_tiers', numeroTiers)
      form.append('client_nom', clientNom)
      if (rdvLabel) form.append('rdv_label', rdvLabel)
      form.append('user_email', userEmail)

      const res = await fetch('/api/atelier-ai/voice-report', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Erreur de traitement.')

      dernierResultatRef.current = { transcript: data.transcript, resume: data.resume, taches: data.taches || [] }

      setEtape('lecture_resume')
      await jouerTexte(data.spoken_summary)

      setEtape('enregistrement_confirmation')
      await demarrerEnregistrement()
    } catch (err: any) {
      console.error(err)
      setEtape('erreur')
      setMessageFinal(err?.message || 'Une erreur est survenue.')
    }
  }

  async function stopperConfirmationEtEnvoyer() {
    if (!modeActif || !dernierResultatRef.current) return
    try {
      const blob = await arreterEnregistrement()
      setEtape('traitement_confirmation')

      const form = new FormData()
      form.append('audio', blob, blob.type.includes('mp4') ? 'audio.mp4' : 'audio.webm')
      form.append('mode', modeActif)
      form.append('numero_tiers', numeroTiers)
      if (rdvActivityId) form.append('rdv_activity_id', rdvActivityId)
      if (rdvLabel) form.append('rdv_label', rdvLabel)
      form.append('user_email', userEmail)
      form.append('user_name', userName)
      form.append('transcript_original', dernierResultatRef.current.transcript)
      form.append('resume', dernierResultatRef.current.resume)
      form.append('taches', JSON.stringify(dernierResultatRef.current.taches))

      const res = await fetch('/api/atelier-ai/voice-report/confirm', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Erreur de confirmation.')

      if (data.confirme === null) {
        // Réponse ambiguë : on redemande une confirmation orale.
        await jouerTexte(data.message)
        setEtape('enregistrement_confirmation')
        await demarrerEnregistrement()
        return
      }

      setEtape('termine')
      setMessageFinal(data.message)
      await jouerTexte(data.message)
    } catch (err: any) {
      console.error(err)
      setEtape('erreur')
      setMessageFinal(err?.message || 'Une erreur est survenue.')
    }
  }

  function reinitialiser() {
    setModeActif(null)
    setEtape('idle')
    setMessageFinal('')
    dernierResultatRef.current = null
  }

  const enCours = etape !== 'idle' && etape !== 'termine' && etape !== 'erreur'

  return (
    <div style={{ marginTop: 10 }}>
      {!enCours && etape !== 'termine' && etape !== 'erreur' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => void lancer('compte_rendu')}
            style={boutonStyle('#7A5EA8')}
          >
            🎙️ Compte-rendu vocal
          </button>
          <button
            type="button"
            onClick={() => void lancer('tache')}
            style={boutonStyle('#A6A181')}
          >
            🎙️ Tâche vocale
          </button>
        </div>
      )}

      {etape === 'annonce' && <StatutLigne texte="L’agent parle…" />}

      {etape === 'enregistrement' && (
        <BoutonStop texte="Je t’écoute… appuie pour arrêter" onClick={() => void stopperEtEnvoyer()} />
      )}

      {etape === 'traitement' && <StatutLigne texte="Analyse en cours…" />}

      {etape === 'lecture_resume' && <StatutLigne texte="L’agent résume…" />}

      {etape === 'enregistrement_confirmation' && (
        <BoutonStop texte="Dis « oui » ou « non »… appuie pour arrêter" onClick={() => void stopperConfirmationEtEnvoyer()} />
      )}

      {etape === 'traitement_confirmation' && <StatutLigne texte="Enregistrement…" />}

      {(etape === 'termine' || etape === 'erreur') && (
        <div
          style={{
            marginTop: 4,
            padding: '10px 12px',
            borderRadius: 10,
            fontSize: 13,
            color: etape === 'erreur' ? '#e0a685' : '#8fd4a8',
            background: etape === 'erreur' ? 'rgba(193,104,60,0.12)' : 'rgba(63,145,66,0.12)',
            border: `1px solid ${etape === 'erreur' ? 'rgba(193,104,60,0.3)' : 'rgba(63,145,66,0.3)'}`,
          }}
        >
          {messageFinal}
          <button
            type="button"
            onClick={reinitialiser}
            style={{ display: 'block', marginTop: 8, background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 12, textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
          >
            Fermer
          </button>
        </div>
      )}
    </div>
  )
}

function boutonStyle(color: string): React.CSSProperties {
  return {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${color}55`,
    background: `${color}1F`,
    color: '#fff',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
  }
}

function StatutLigne({ texte }: { texte: string }) {
  return (
    <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'rgba(255,255,255,0.55)' }}>
      {texte}
    </div>
  )
}

function BoutonStop({ texte, onClick }: { texte: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        padding: '12px',
        borderRadius: 10,
        border: '1px solid rgba(193,104,60,0.5)',
        background: 'rgba(193,104,60,0.14)',
        color: '#e0a685',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        animation: 'cgcPulseRec 1.2s ease-in-out infinite',
      }}
    >
      🔴 {texte}
      <style>{`
        @keyframes cgcPulseRec { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
      `}</style>
    </button>
  )
}
