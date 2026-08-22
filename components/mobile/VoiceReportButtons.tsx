'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

/**
 * Deux boutons vocaux à insérer dans la sheet de détail d'un RDV (ou dans
 * la fiche client, juste après "prochaine visite") :
 * - "Compte-rendu vocal" : dicter le compte-rendu de la visite, l'IA le
 *   structure et détecte les tâches à créer.
 * - "Ajouter une tâche vocale" : dicter une seule tâche liée au client.
 *
 * Flux : appui -> annonce vocale + gros bouton d'écoute -> nouvel appui
 * pour arrêter -> transcription + structuration
 * (POST /api/atelier-ai/voice-report) -> résumé affiché À L'ÉCRAN (et lu à
 * voix haute en best-effort) -> nouvel enregistrement pour confirmer ->
 * POST .../confirm qui écrit réellement en base si "oui".
 *
 * Tout est affiché visuellement à chaque étape : la lecture audio est un
 * plus, jamais le seul moyen de savoir ce qui se passe (Safari iOS peut
 * bloquer un play() qui ne part pas directement d'un geste utilisateur —
 * dans ce cas le bouton "🔊 Écouter" permet de rejouer manuellement).
 *
 * Au montage, si rdvActivityId est fourni, le(s) compte(s)-rendu(s) déjà
 * enregistré(s) pour ce rdv sont chargés et affichés en premier (lecture +
 * écoute), avant les boutons d'enregistrement.
 */

type Tache = { description: string; echeance: string | null; assigned_to_email: string | null }

type Etape =
  | 'idle'
  | 'annonce'
  | 'enregistrement'
  | 'traitement'
  | 'resume_pret'
  | 'enregistrement_confirmation'
  | 'traitement_confirmation'
  | 'termine'
  | 'erreur'

type Mode = 'compte_rendu' | 'tache'

type CompteRenduExistant = {
  id: string
  created_at: string
  resume: string
  taches_detectees: Tache[]
}

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
  const [resumeAffiche, setResumeAffiche] = useState('')
  const [spokenAffiche, setSpokenAffiche] = useState('')
  const [tachesAffichees, setTachesAffichees] = useState<Tache[]>([])
  const [lectureEnCours, setLectureEnCours] = useState(false)

  const [comptesRendusExistants, setComptesRendusExistants] = useState<CompteRenduExistant[] | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const dernierResultatRef = useRef<{ transcript: string; resume: string; taches: Tache[] } | null>(null)

  // Charge le(s) compte(s)-rendu(s) déjà enregistré(s) pour ce rdv.
  useEffect(() => {
    let cancelled = false
    async function charger() {
      if (!rdvActivityId) {
        setComptesRendusExistants([])
        return
      }
      const { data, error } = await supabase
        .from('client_comptes_rendus')
        .select('id, created_at, resume, taches_detectees')
        .eq('rdv_activity_id', rdvActivityId)
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (error) {
        console.warn('[VoiceReportButtons] lecture comptes-rendus impossible :', error.message)
        setComptesRendusExistants([])
        return
      }
      setComptesRendusExistants((data || []) as CompteRenduExistant[])
    }
    void charger()
    return () => { cancelled = true }
  }, [rdvActivityId])

  function mimeTypeSupporte() {
    if (typeof MediaRecorder === 'undefined') return ''
    if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
    if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
    return ''
  }

  /** Best-effort : ne bloque jamais le flux si la lecture est refusée
   * (politique autoplay iOS). Le texte est de toute façon déjà affiché. */
  async function jouerTexte(texte: string) {
    if (!texte) return
    setLectureEnCours(true)
    try {
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
    } catch {
      // silencieux : le texte reste affiché à l'écran dans tous les cas.
    } finally {
      setLectureEnCours(false)
    }
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
    setResumeAffiche('')
    setSpokenAffiche('')
    setTachesAffichees([])
    dernierResultatRef.current = null

    try {
      setEtape('annonce')
      const phraseAccueil =
        mode === 'compte_rendu'
          ? 'Je t’écoute pour synthétiser le compte rendu de ta visite.'
          : 'Je t’écoute, décris la tâche à ajouter.'
      void jouerTexte(phraseAccueil) // n'attend pas la fin : le micro peut démarrer pendant l'annonce

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
      setResumeAffiche(data.resume || '')
      setSpokenAffiche(data.spoken_summary || '')
      setTachesAffichees(data.taches || [])

      setEtape('resume_pret')
      void jouerTexte(data.spoken_summary)
    } catch (err: any) {
      console.error(err)
      setEtape('erreur')
      setMessageFinal(err?.message || 'Une erreur est survenue.')
    }
  }

  async function demarrerConfirmation() {
    try {
      setEtape('enregistrement_confirmation')
      await demarrerEnregistrement()
    } catch (err) {
      console.error(err)
      setEtape('erreur')
      setMessageFinal("Impossible d'accéder au micro. Vérifie les autorisations du navigateur.")
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
        setMessageFinal(data.message)
        setEtape('resume_pret') // on repropose le bouton de confirmation
        void jouerTexte(data.message)
        return
      }

      setEtape('termine')
      setMessageFinal(data.message)
      void jouerTexte(data.message)

      if (data.confirme && modeActif === 'compte_rendu') {
        // Recharge la liste des comptes-rendus pour que celui qu'on vient
        // de créer apparaisse immédiatement si on rouvre ce RDV.
        const { data: refreshed } = await supabase
          .from('client_comptes_rendus')
          .select('id, created_at, resume, taches_detectees')
          .eq('rdv_activity_id', rdvActivityId || '')
          .order('created_at', { ascending: false })
        setComptesRendusExistants((refreshed || []) as CompteRenduExistant[])
      }
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
    setResumeAffiche('')
    setSpokenAffiche('')
    setTachesAffichees([])
    dernierResultatRef.current = null
  }

  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ---- Compte(s)-rendu(s) déjà enregistré(s) pour ce rdv ---- */}
      {comptesRendusExistants && comptesRendusExistants.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
            Compte-rendu enregistré
          </div>
          {comptesRendusExistants.map((cr) => (
            <div
              key={cr.id}
              style={{
                borderRadius: 10, border: '1px solid rgba(122,94,168,0.35)', background: 'rgba(122,94,168,0.10)',
                padding: '10px 12px',
              }}
            >
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>
                {new Date(cr.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
              <div style={{ fontSize: 13, color: '#fff', lineHeight: 1.5 }}>{cr.resume}</div>
              {cr.taches_detectees?.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                  {cr.taches_detectees.length} tâche{cr.taches_detectees.length > 1 ? 's' : ''} créée{cr.taches_detectees.length > 1 ? 's' : ''} : {cr.taches_detectees.map((t) => t.description).join(' · ')}
                </div>
              )}
              <button
                type="button"
                onClick={() => void jouerTexte(cr.resume)}
                disabled={lectureEnCours}
                style={{ marginTop: 8, background: 'none', border: 'none', color: '#C9BEEF', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}
              >
                🔊 {lectureEnCours ? 'Lecture…' : 'Écouter'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ---- Boutons de lancement ---- */}
      {etape === 'idle' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => void lancer('compte_rendu')} style={boutonStyle('#7A5EA8')}>
            🎙️ Compte-rendu vocal
          </button>
          <button type="button" onClick={() => void lancer('tache')} style={boutonStyle('#A6A181')}>
            🎙️ Tâche vocale
          </button>
        </div>
      )}

      {etape === 'annonce' && <StatutLigne texte="L’agent parle…" />}

      {etape === 'enregistrement' && (
        <GrandBoutonEcoute texte="Je t’écoute — appuie pour arrêter" onClick={() => void stopperEtEnvoyer()} />
      )}

      {etape === 'traitement' && <StatutLigne texte="Analyse en cours…" />}

      {etape === 'resume_pret' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
              Résumé
            </div>
            <div style={{ fontSize: 13.5, color: '#fff', lineHeight: 1.55 }}>{resumeAffiche}</div>

            {tachesAffichees.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
                  {tachesAffichees.length} tâche{tachesAffichees.length > 1 ? 's' : ''} détectée{tachesAffichees.length > 1 ? 's' : ''}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {tachesAffichees.map((t, i) => (
                    <div key={i} style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.8)' }}>
                      • {t.description}{t.echeance ? ` (${new Date(t.echeance).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })})` : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => void jouerTexte(spokenAffiche)}
              disabled={lectureEnCours}
              style={{ marginTop: 10, background: 'none', border: 'none', color: '#E4C98A', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
              🔊 {lectureEnCours ? 'Lecture…' : 'Réécouter le résumé'}
            </button>
          </div>

          {messageFinal && (
            <div style={{ fontSize: 12.5, color: '#e0a685' }}>{messageFinal}</div>
          )}

          <button
            type="button"
            onClick={() => void demarrerConfirmation()}
            style={{
              ...boutonStyle('#3F9142'),
              width: '100%',
            }}
          >
            🎙️ Dire « oui, c’est correct » ou « non »
          </button>
        </div>
      )}

      {etape === 'enregistrement_confirmation' && (
        <GrandBoutonEcoute texte="Dis « oui » ou « non » — appuie pour arrêter" onClick={() => void stopperConfirmationEtEnvoyer()} />
      )}

      {etape === 'traitement_confirmation' && <StatutLigne texte="Enregistrement…" />}

      {(etape === 'termine' || etape === 'erreur') && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            fontSize: 13.5,
            color: etape === 'erreur' ? '#e0a685' : '#8fd4a8',
            background: etape === 'erreur' ? 'rgba(193,104,60,0.12)' : 'rgba(63,145,66,0.12)',
            border: `1px solid ${etape === 'erreur' ? 'rgba(193,104,60,0.3)' : 'rgba(63,145,66,0.3)'}`,
          }}
        >
          {etape === 'termine' ? '✅ ' : '⚠️ '}{messageFinal}
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

/** Gros bouton rond, pensé pour être facile à retrouver et à taper d'un
 * pouce pour arrêter l'écoute — remplace le petit bandeau discret d'avant. */
function GrandBoutonEcoute({ texte, onClick }: { texte: string; onClick: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '18px 0' }}>
      <button
        type="button"
        onClick={onClick}
        aria-label="Arrêter l'écoute"
        style={{
          width: 108,
          height: 108,
          borderRadius: '50%',
          border: '2px solid rgba(193,104,60,0.6)',
          background: 'rgba(193,104,60,0.20)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 44,
          lineHeight: 1,
          cursor: 'pointer',
          animation: 'cgcPulseRec 1.1s ease-in-out infinite',
          flexShrink: 0,
        }}
      >
        🎙️
      </button>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#e0a685', textAlign: 'center', maxWidth: 220 }}>{texte}</div>
      <style>{`
        @keyframes cgcPulseRec { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.07); opacity: 0.75; } }
      `}</style>
    </div>
  )
}
