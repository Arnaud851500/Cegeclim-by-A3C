'use client'

import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

/**
 * Bouton "Résumé vocal" pour l'accueil : entièrement conversationnel — un
 * seul appui pour ouvrir, ensuite tout se fait à la voix.
 *
 * Flux : appui -> l'agent demande "tâches en retard / cette semaine, ou
 * rdv à venir ?" -> écoute -> transcription -> interprétation du choix par
 * mots-clés (pas d'IA nécessaire ici, un simple choix parmi 3) -> lecture
 * déterministe des données déjà en base -> énoncé du résultat -> propose
 * de recommencer, toujours à la voix.
 *
 * Si la réponse n'est pas comprise, l'agent le dit et redemande — jamais
 * de blocage silencieux. Le texte est aussi affiché à l'écran à chaque
 * étape (l'audio est un plus, jamais le seul canal d'information), et un
 * bouton "⏹ Stop" reste disponible à tout moment pendant une lecture.
 */

type Portee = 'jour' | 'semaine' | 'rdv'
type Etape = 'idle' | 'question' | 'ecoute' | 'traitement' | 'incompris' | 'resultat' | 'erreur'

const RDV_TYPE_KEYS = ['meeting', 'phoneCall', 'reminder', '4', '7', '9']
const QUESTION = 'Souhaites-tu connaître tes tâches en retard, tes tâches de la semaine, ou tes prochains rendez-vous ?'

function safeText(value: any) {
  return String(value ?? '').trim()
}
const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
function formatDateParlee(value: any) {
  const text = safeText(value)
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  const jour = Number(m[3])
  const mois = MOIS_FR[Number(m[2]) - 1]
  return mois ? `le ${jour} ${mois}` : ''
}
function finDeSemaineIso() {
  const d = new Date()
  const jour = d.getDay() || 7
  d.setDate(d.getDate() + (7 - jour))
  return d.toISOString().slice(0, 10)
}
function todayIso() {
  return new Date().toISOString().slice(0, 10)
}
function normaliser(value: string) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Interprète la réponse parlée par mots-clés -- pas besoin d'IA pour un
 * choix entre 3 options. Renvoie null si rien de reconnaissable, auquel
 * cas l'agent redemande plutôt que de deviner. */
function classifierChoix(transcript: string): Portee | null {
  const t = normaliser(transcript)
  if (/\brdv\b|rendez[- ]?vous/.test(t)) return 'rdv'
  if (/semaine/.test(t)) return 'semaine'
  if (/retard|aujourd\s?hui|\bjour\b/.test(t)) return 'jour'
  return null
}

/** Redécode l'audio et le ré-encode en WAV PCM 16 bits -- même correctif
 * que VoiceReportButtons (bug Safari iOS : MediaRecorder en 'audio/mp4'
 * produit parfois un fichier sans métadonnées de durée que l'API de
 * transcription rejette). */
async function convertirEnWav(blob: Blob): Promise<Blob> {
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    const audioCtx = new AudioContextClass()
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0))
    void audioCtx.close()
    if (audioBuffer.duration < 0.3) return blob

    const numChannels = audioBuffer.numberOfChannels
    const sampleRate = audioBuffer.sampleRate
    let interleaved: Float32Array
    if (numChannels === 2) {
      const ch0 = audioBuffer.getChannelData(0)
      const ch1 = audioBuffer.getChannelData(1)
      interleaved = new Float32Array(ch0.length * 2)
      for (let i = 0; i < ch0.length; i++) {
        interleaved[i * 2] = ch0[i]
        interleaved[i * 2 + 1] = ch1[i]
      }
    } else {
      interleaved = audioBuffer.getChannelData(0)
    }

    const dataLength = interleaved.length * 2
    const bufferOut = new ArrayBuffer(44 + dataLength)
    const view = new DataView(bufferOut)
    function writeString(offset: number, s: string) {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
    }
    writeString(0, 'RIFF'); view.setUint32(4, 36 + dataLength, true); writeString(8, 'WAVE')
    writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
    view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * numChannels * 2, true); view.setUint16(32, numChannels * 2, true)
    view.setUint16(34, 16, true); writeString(36, 'data'); view.setUint32(40, dataLength, true)

    let offset = 44
    for (let i = 0; i < interleaved.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, interleaved[i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    }
    return new Blob([bufferOut], { type: 'audio/wav' })
  } catch (e) {
    console.warn('[MobileHomeSummary] conversion WAV impossible, envoi du format brut', e)
    return blob
  }
}

export default function MobileHomeSummary({ userEmail }: { userEmail?: string | null }) {
  const [etape, setEtape] = useState<Etape>('idle')
  const [texte, setTexte] = useState('')
  const [messageIncompris, setMessageIncompris] = useState('')
  const [erreur, setErreur] = useState('')
  const [lectureEnCours, setLectureEnCours] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioEnCoursRef = useRef<HTMLAudioElement | null>(null)
  const resolveLectureRef = useRef<(() => void) | null>(null)

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
      audioEnCoursRef.current = audio
      await new Promise<void>((resolve) => {
        resolveLectureRef.current = resolve
        audio.onended = () => resolve()
        audio.onerror = () => resolve()
        void audio.play().catch(() => resolve())
      })
      URL.revokeObjectURL(url)
    } catch {
      // silencieux : le texte reste affiché à l'écran dans tous les cas.
    } finally {
      audioEnCoursRef.current = null
      resolveLectureRef.current = null
      setLectureEnCours(false)
    }
  }

  function arreterLecture() {
    if (audioEnCoursRef.current) {
      try { audioEnCoursRef.current.pause() } catch {}
    }
    if (resolveLectureRef.current) {
      resolveLectureRef.current()
      resolveLectureRef.current = null
    }
  }

  function mimeTypeSupporte() {
    if (typeof MediaRecorder === 'undefined') return ''
    if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
    if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
    return ''
  }

  async function demarrerEnregistrement(): Promise<void> {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e: any) {
      throw new Error(`[micro] ${e?.name || 'Erreur'} : ${e?.message || e}`)
    }
    streamRef.current = stream
    const mimeType = mimeTypeSupporte()
    try {
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mediaRecorderRef.current = recorder
      recorder.start()
    } catch (e: any) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error(`[enregistreur] ${e?.name || 'Erreur'} : ${e?.message || e}`)
    }
  }

  function arreterEnregistrement(): Promise<Blob> {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder) { resolve(new Blob()); return }
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm'
        resolve(new Blob(chunksRef.current, { type }))
        streamRef.current?.getTracks().forEach((t) => t.stop())
      }
      recorder.stop()
    })
  }

  /** Lance (ou relance) le cycle conversationnel : question -> écoute. */
  async function poserLaQuestion() {
    setTexte('')
    setMessageIncompris('')
    setErreur('')
    try {
      setEtape('question')
      await jouerTexte(QUESTION)
      setEtape('ecoute')
      await demarrerEnregistrement()
    } catch (e: any) {
      setEtape('erreur')
      setErreur(e?.message || 'Une erreur est survenue.')
    }
  }

  async function arreterEtInterpreter() {
    try {
      const blobBrut = await arreterEnregistrement()
      setEtape('traitement')
      const blobWav = await convertirEnWav(blobBrut)

      const form = new FormData()
      form.append('audio', blobWav, 'audio.wav')
      const res = await fetch('/api/atelier-ai/transcribe', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Erreur de transcription.')

      const portee = classifierChoix(data.transcript || '')
      if (!portee) {
        setMessageIncompris(
          `Je n'ai pas compris "${data.transcript || '...'}". Dis par exemple "mes tâches en retard", "cette semaine", ou "mes rendez-vous".`,
        )
        setEtape('incompris')
        await jouerTexte("Je n'ai pas bien compris. Peux-tu répéter ?")
        setEtape('ecoute')
        await demarrerEnregistrement()
        return
      }

      await genererResume(portee)
    } catch (e: any) {
      setEtape('erreur')
      setErreur(e?.message || 'Une erreur est survenue.')
    }
  }

  async function genererResume(portee: Portee) {
    try {
      const email = String(userEmail || '').toLowerCase().trim()
      if (!email) throw new Error('Utilisateur non identifié.')

      const { data: access } = await supabase
        .from('user_page_access')
        .select('display_name, blg_partner_id')
        .eq('email', email)
        .maybeSingle()
      const displayName = String(access?.display_name || '').trim() || email.split('@')[0]

      let resultat = ''

      if (portee === 'rdv') {
        if (!access?.blg_partner_id) throw new Error('Identifiant partner BLG non renseigné pour ce compte.')

        const { data: rows, error } = await supabase
          .from('crm_base_activity')
          .select('type, comment, start_date')
          .eq('internal_tag', 'normal')
          .in('type', RDV_TYPE_KEYS)
          .eq('from_fk', access.blg_partner_id)
          .gte('start_date', new Date().toISOString())
          .order('start_date', { ascending: true })
          .limit(10)
        if (error) throw error

        if (!rows || rows.length === 0) {
          resultat = "Tu n'as aucun rendez-vous à venir."
        } else {
          const lignes = rows.map((r: any, i: number) => {
            const d = new Date(r.start_date)
            const dateLabel = d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit' })
            const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            const sujet = safeText(r.comment) || 'sans sujet précisé'
            return `${i + 1}. ${dateLabel} à ${heure} — ${sujet}`
          })
          const compte = rows.length === 1 ? 'un' : String(rows.length)
          resultat = `Voici tes ${compte} prochain${rows.length > 1 ? 's' : ''} rendez-vous :\n${lignes.join('\n')}`
        }
      } else {
        const identities = Array.from(new Set([email, displayName]))
        const assignedFilter = identities.map((v) => `assigned_to.eq.${v.replace(/,/g, '\\,')}`).join(',')
        const fin = portee === 'jour' ? todayIso() : finDeSemaineIso()

        const { data: rows, error } = await supabase
          .from('todo_actions')
          .select('description_action, due_date')
          .or(assignedFilter)
          .not('status', 'in', '("Terminé","Annulé")')
          .not('due_date', 'is', null)
          .lte('due_date', fin)
          .order('due_date', { ascending: true })
          .limit(30)
        if (error) throw error

        const periodeTexte = portee === 'jour' ? "pour aujourd'hui (ou en retard)" : 'cette semaine (ou en retard)'

        if (!rows || rows.length === 0) {
          resultat = `Tu n'as aucune tâche ${periodeTexte}.`
        } else {
          const lignes = rows.map((r: any, i: number) => {
            const echeance = formatDateParlee(r.due_date)
            return `${i + 1}. ${safeText(r.description_action) || '(sans libellé)'}${echeance ? `, échéance ${echeance}` : ''}`
          })
          const compte = rows.length === 1 ? 'une' : String(rows.length)
          resultat = `Tu as ${compte} tâche${rows.length > 1 ? 's' : ''} ${periodeTexte} :\n${lignes.join('\n')}`
        }
      }

      setTexte(resultat)
      setEtape('resultat')
      await jouerTexte(resultat)
    } catch (e: any) {
      setEtape('erreur')
      setErreur(e?.message || 'Erreur inattendue.')
    }
  }

  function fermer() {
    setEtape('idle')
    setTexte('')
    setMessageIncompris('')
    setErreur('')
  }

  if (etape === 'idle') {
    return (
      <button
        type="button"
        onClick={() => void poserLaQuestion()}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          width: '100%', height: 52, padding: '0 10px', borderRadius: 12,
          border: '1px solid rgba(75,146,172,0.4)', background: 'rgba(75,146,172,0.14)',
          color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', lineHeight: 1.25,
        }}
      >
        🔊 Résumé vocal
      </button>
    )
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 230, background: 'rgba(6,10,18,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={etape === 'resultat' || etape === 'erreur' ? fermer : undefined}
    >
      <div
        style={{
          width: '100%', maxWidth: 520, height: '92vh', maxHeight: '92vh',
          background: '#141A26', borderTopLeftRadius: 24, borderTopRightRadius: 24,
          border: '1px solid rgba(75,146,172,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '14px auto 6px', flexShrink: 0 }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px 16px', flexShrink: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>🔊 Résumé vocal</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {lectureEnCours && (
              <button type="button" onClick={arreterLecture} style={stopBtnStyle}>⏹ Stop</button>
            )}
            <button type="button" onClick={fermer} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 28, lineHeight: 1, cursor: 'pointer' }}>✕</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {(etape === 'question' || etape === 'traitement') && (
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', textAlign: 'center', padding: '20px 0' }}>
              {etape === 'question' ? "L'agent parle…" : 'Interprétation…'}
            </div>
          )}

          {(etape === 'ecoute') && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '18px 0' }}>
              {messageIncompris && (
                <div style={{ fontSize: 13.5, color: '#e0a685', textAlign: 'center', lineHeight: 1.5 }}>{messageIncompris}</div>
              )}
              <button
                type="button"
                onClick={() => void arreterEtInterpreter()}
                aria-label="Arrêter l'écoute"
                style={{
                  width: 116, height: 116, borderRadius: '50%', border: '2px solid rgba(75,146,172,0.6)',
                  background: 'rgba(75,146,172,0.20)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 46, cursor: 'pointer', animation: 'cgcPulseSummary 1.1s ease-in-out infinite',
                }}
              >
                🎙️
              </button>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: '#8FC7DA', textAlign: 'center' }}>
                Je t'écoute — appuie pour arrêter
              </div>
              <style>{`@keyframes cgcPulseSummary { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.06); opacity: 0.75; } }`}</style>
            </div>
          )}

          {erreur && (
            <div style={{ fontSize: 14, color: '#e0a685' }}>{erreur}</div>
          )}

          {texte && etape === 'resultat' && (
            <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', padding: '18px 16px' }}>
              <div style={{ fontSize: 17, color: '#fff', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{texte}</div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button
                  type="button"
                  onClick={() => void jouerTexte(texte)}
                  disabled={lectureEnCours}
                  style={{ flex: 1, padding: '14px', borderRadius: 12, border: '1px solid rgba(143,199,218,0.4)', background: 'rgba(143,199,218,0.14)', color: '#8FC7DA', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}
                >
                  🔊 Réécouter
                </button>
                <button
                  type="button"
                  onClick={() => void poserLaQuestion()}
                  style={{ flex: 1, padding: '14px', borderRadius: 12, border: '1px solid rgba(166,161,129,0.4)', background: 'rgba(166,161,129,0.14)', color: '#fff', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}
                >
                  🎙️ Autre demande
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const stopBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 999,
  border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.1)',
  color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
}
