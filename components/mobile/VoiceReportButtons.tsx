'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { acquerirVerrouVocal, libererVerrouVocal, verrouVocalDetenuPar, verrouVocalDetenuParAutre } from '@/lib/voiceSessionLock'

/**
 * Deux boutons vocaux à insérer dans la sheet de détail d'un RDV (ou dans
 * la fiche client, juste après "prochaine visite") :
 * - "Compte-rendu vocal" (ou "Compléter" si un compte-rendu existe déjà) :
 *   dicter le compte-rendu, l'IA le structure et détecte les tâches.
 * - "Ajouter une tâche vocale" : dicter une seule tâche liée au client.
 *
 * Flux entièrement mains libres après le premier appui : annonce -> gros
 * bouton d'écoute -> nouvel appui pour arrêter -> transcription +
 * structuration -> résumé affiché ET énoncé -> ré-écoute automatique pour
 * la confirmation orale ("oui"/"non") -> écriture en base si "oui". Tout
 * est aussi affiché à l'écran en toutes circonstances (l'audio est un
 * plus, jamais le seul canal d'information).
 *
 * IMPORTANT — conversion WAV avant envoi : Safari iOS produit parfois, via
 * MediaRecorder en 'audio/mp4', un fichier sans métadonnées de durée que
 * les décodeurs serveur (dont l'API de transcription) rejettent comme
 * "corrompu". On redécode donc systématiquement l'enregistrement via
 * l'API Web Audio et on le ré-encode en WAV PCM 16 bits avant l'upload —
 * ça garantit un fichier propre quel que soit le navigateur. CORRECTIF :
 * ce ré-encodage se fait maintenant à 16 kHz mono (au lieu de la
 * fréquence native du micro, souvent 44,1 kHz stéréo, ~10 Mo/minute) --
 * un compte-rendu de réunion de plusieurs minutes dépassait la limite de
 * taille de requête de la fonction serverless (HTTP 413 /
 * FUNCTION_PAYLOAD_TOO_LARGE) bien avant toute limite de durée. 16 kHz
 * mono suffit largement : Whisper (transcription) rééchantillonne de
 * toute façon en interne à cette fréquence, aucune perte de qualité de
 * transcription, juste ~5-6x moins de poids.
 *
 * CORRECTIF : les 3 appels réseau qui attendaient du JSON (voice-report,
 * transcribe, voice-report/confirm) faisaient `await res.json()`
 * directement -- si le serveur répond avec autre chose (page d'erreur du
 * plateforme, ex. HTTP 413/FUNCTION_PAYLOAD_TOO_LARGE constaté en
 * pratique sur un compte-rendu long, avant le correctif ci-dessus), ça
 * plantait avec un SyntaxError natif du navigateur illisible ("The
 * string did not match the expected pattern."). parserReponseJson()
 * ci-dessous lit le texte d'abord et lève une erreur lisible (avec le
 * code HTTP et un extrait de la réponse) si ce n'est pas du JSON valide,
 * au lieu de planter au hasard.
 */

/** Lit la réponse en texte puis tente de la parser en JSON -- si ce n'est
 * pas du JSON valide (page d'erreur de la plateforme -- HTTP 413 pour un
 * enregistrement trop volumineux, ou un timeout pour un traitement trop
 * long), lève une erreur lisible plutôt que de laisser JSON.parse planter
 * avec un message natif cryptique. Voir note en tête de fichier. */
async function parserReponseJson(res: Response): Promise<any> {
  const texte = await res.text()
  try {
    return JSON.parse(texte)
  } catch {
    const extrait = texte.slice(0, 200).replace(/\s+/g, ' ').trim()
    const cause = res.status === 413
      ? 'enregistrement trop volumineux pour le serveur'
      : 'probablement un délai serveur dépassé (traitement trop long)'
    throw new Error(`Réponse invalide du serveur (HTTP ${res.status}) -- ${cause}${extrait ? ` : ${extrait}` : ''}.`)
  }
}

type Tache = { description: string; echeance: string | null; assigned_to_email: string | null }

type Etape =
  | 'idle'
  | 'annonce'
  | 'enregistrement'
  | 'traitement'
  | 'echeance_question'
  | 'echeance_ecoute'
  | 'echeance_traitement'
  | 'resume_pret'
  | 'enregistrement_confirmation'
  | 'traitement_confirmation'
  | 'termine'
  | 'erreur'

type Mode = 'compte_rendu' | 'tache'

/**
 * Le verrou vocal partagé entre TOUTES les instances de VoiceReportButtons
 * ET MobileHomeSummary vit désormais dans lib/voiceSessionLock.ts (voir ce
 * fichier pour le détail) -- empêche deux sessions vocales de tourner en
 * même temps, tous composants confondus.
 */

type CompteRenduExistant = {
  id: string
  created_at: string
  resume: string
  taches_detectees: Tache[]
}

/** Redécode un blob audio quelconque puis le ré-encode en WAV PCM 16 bits —
 * fichier toujours valide, indépendamment des quirks du conteneur d'origine
 * (cf. note en tête de fichier sur le bug Safari). En cas d'échec de
 * décodage (rare), on retombe sur le blob d'origine plutôt que de bloquer
 * l'envoi. */
/** Fréquence cible du WAV envoyé au serveur -- Whisper (transcription)
 * rééchantillonne de toute façon en interne à 16 kHz, donc envoyer plus
 * haut n'apporte aucune qualité de transcription supplémentaire, juste du
 * poids. CORRECTIF : avant ce rééchantillonnage, un enregistrement était
 * réencodé en PCM brut à la fréquence native du micro (souvent 44,1 kHz
 * stéréo, ~10 Mo/minute) -- un compte-rendu de réunion de plusieurs
 * minutes dépassait largement la limite de taille de requête de la
 * fonction serverless (HTTP 413 / FUNCTION_PAYLOAD_TOO_LARGE), plantant
 * avant même d'atteindre une éventuelle limite de durée. À 16 kHz mono,
 * le poids est divisé par ~5-6.
 */
const FREQUENCE_ECHANTILLONNAGE_CIBLE = 16000

async function convertirEnWav(blob: Blob): Promise<Blob> {
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    const audioCtx = new AudioContextClass()
    const audioBufferOriginal = await audioCtx.decodeAudioData(arrayBuffer.slice(0))
    void audioCtx.close()

    if (audioBufferOriginal.duration < 0.3) {
      console.warn('[VoiceReportButtons] durée décodée suspecte (', audioBufferOriginal.duration, 's) — envoi du blob d’origine')
      return blob
    }

    // Rééchantillonnage à 16 kHz + réduction mono en un seul passage via
    // OfflineAudioContext (le downmix stéréo->mono est automatique quand
    // la destination n'a qu'1 canal, standard Web Audio API).
    const dureeSecondes = audioBufferOriginal.duration
    const OfflineAudioContextClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext
    const offlineCtx = new OfflineAudioContextClass(
      1,
      Math.ceil(dureeSecondes * FREQUENCE_ECHANTILLONNAGE_CIBLE),
      FREQUENCE_ECHANTILLONNAGE_CIBLE,
    )
    const source = offlineCtx.createBufferSource()
    source.buffer = audioBufferOriginal
    source.connect(offlineCtx.destination)
    source.start(0)
    const audioBufferReechantillonne = await offlineCtx.startRendering()

    const wav = audioBufferToWav(audioBufferReechantillonne)
    return new Blob([wav], { type: 'audio/wav' })
  } catch (e) {
    console.warn('[VoiceReportButtons] conversion WAV impossible, envoi du format brut', e)
    return blob
  }
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const bitDepth = 16

  let interleaved: Float32Array
  if (numChannels === 2) {
    const ch0 = buffer.getChannelData(0)
    const ch1 = buffer.getChannelData(1)
    interleaved = new Float32Array(ch0.length * 2)
    for (let i = 0; i < ch0.length; i++) {
      interleaved[i * 2] = ch0[i]
      interleaved[i * 2 + 1] = ch1[i]
    }
  } else {
    interleaved = buffer.getChannelData(0)
  }

  const dataLength = interleaved.length * (bitDepth / 8)
  const bufferOut = new ArrayBuffer(44 + dataLength)
  const view = new DataView(bufferOut)

  function writeString(offset: number, s: string) {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true)
  view.setUint16(32, numChannels * (bitDepth / 8), true)
  view.setUint16(34, bitDepth, true)
  writeString(36, 'data')
  view.setUint32(40, dataLength, true)

  let offset = 44
  for (let i = 0; i < interleaved.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, interleaved[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return bufferOut
}

const NOMBRES_FR_0_31 = [
  'zero', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix sept', 'dix huit', 'dix neuf',
  'vingt', 'vingt et un', 'vingt deux', 'vingt trois', 'vingt quatre', 'vingt cinq', 'vingt six', 'vingt sept', 'vingt huit', 'vingt neuf',
  'trente', 'trente et un',
]
const MOTS_VERS_NOMBRE = new Map<string, number>(NOMBRES_FR_0_31.map((mots, n) => [mots, n]))
const FORMES_TRIEES = [...NOMBRES_FR_0_31].sort((a, b) => b.split(' ').length - a.split(' ').length)
const MOIS_FR_LISTE = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']
const JOURS_SEMAINE = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

function normaliserPourDate(texte: string) {
  return String(texte || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/-/g, ' ')
}

function matcherNombreDepuis(mots: string[], depart: number): { valeur: number; longueur: number } | null {
  for (const forme of FORMES_TRIEES) {
    const longueur = forme.split(' ').length
    if (mots.slice(depart, depart + longueur).join(' ') === forme) {
      return { valeur: MOTS_VERS_NOMBRE.get(forme) as number, longueur }
    }
  }
  return null
}

function isoDepuisDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function construireDateJourMois(jour: number, moisIndex: number): Date {
  const aujourdHui = new Date()
  aujourdHui.setHours(0, 0, 0, 0)
  let annee = aujourdHui.getFullYear()
  let d = new Date(annee, moisIndex, jour)
  if (d.getTime() < aujourdHui.getTime()) {
    annee += 1
    d = new Date(annee, moisIndex, jour)
  }
  return d
}

function parserEcheanceParlee(texteBrut: string): string | null {
  const texteNettoye = normaliserPourDate(texteBrut).replace(/'/g, '').replace(/[^a-z0-9\s\/]/g, ' ')
  const mots = texteNettoye.split(/\s+/).filter(Boolean)
  const texteJoin = mots.join(' ')
  const aujourdHui = new Date()
  aujourdHui.setHours(0, 0, 0, 0)

  if (/\baujourdhui\b/.test(texteJoin)) return isoDepuisDate(aujourdHui)
  if (/\bapres\s?demain\b/.test(texteJoin)) {
    const d = new Date(aujourdHui); d.setDate(d.getDate() + 2); return isoDepuisDate(d)
  }
  if (/\bdemain\b/.test(texteJoin)) {
    const d = new Date(aujourdHui); d.setDate(d.getDate() + 1); return isoDepuisDate(d)
  }

  for (let i = 0; i < JOURS_SEMAINE.length; i++) {
    if (new RegExp(`\\b${JOURS_SEMAINE[i]}\\b`).test(texteJoin)) {
      const d = new Date(aujourdHui)
      let delta = (i - d.getDay() + 7) % 7
      if (delta === 0) delta = 7
      d.setDate(d.getDate() + delta)
      return isoDepuisDate(d)
    }
  }

  if (/semaine\s+prochaine/.test(texteJoin)) {
    const d = new Date(aujourdHui)
    const jourSemaine = d.getDay() || 7
    d.setDate(d.getDate() + (7 - jourSemaine) + 1)
    return isoDepuisDate(d)
  }

  const matchDansJours = texteJoin.match(/dans\s+(\d+|[a-z\s]+?)\s+jours?/)
  if (matchDansJours) {
    const brut = matchDansJours[1].trim()
    let n: number | null = /^\d+$/.test(brut) ? parseInt(brut, 10) : null
    if (n === null) {
      const m = matcherNombreDepuis(brut.split(/\s+/), 0)
      if (m) n = m.valeur
    }
    if (n !== null) {
      const d = new Date(aujourdHui); d.setDate(d.getDate() + n); return isoDepuisDate(d)
    }
  }

  const matchChiffres = texteJoin.match(/\b(\d{1,2})\s*[\/\s]\s*(\d{1,2})\b/)
  if (matchChiffres) {
    const jour = parseInt(matchChiffres[1], 10)
    const mois = parseInt(matchChiffres[2], 10)
    if (jour >= 1 && jour <= 31 && mois >= 1 && mois <= 12) {
      return isoDepuisDate(construireDateJourMois(jour, mois - 1))
    }
  }

  for (let mi = 0; mi < MOIS_FR_LISTE.length; mi++) {
    const idx = mots.indexOf(MOIS_FR_LISTE[mi])
    if (idx === -1) continue
    let jour: number | null = null
    const motAvant = mots[idx - 1]
    if (motAvant && /^\d{1,2}$/.test(motAvant)) {
      jour = parseInt(motAvant, 10)
    } else {
      for (let longueur = 3; longueur >= 1; longueur--) {
        const depart = idx - longueur
        if (depart < 0) continue
        const m = matcherNombreDepuis(mots, depart)
        if (m && m.longueur === longueur && depart + longueur === idx) { jour = m.valeur; break }
      }
    }
    if (jour !== null && jour >= 1 && jour <= 31) {
      return isoDepuisDate(construireDateJourMois(jour, mi))
    }
  }

  return null
}

export default function VoiceReportButtons({
  numeroTiers = '',
  clientNom = '',
  rdvActivityId,
  rdvLabel,
  userEmail,
  userName,
  modeUnique,
  labelBouton,
  pleinEcran,
}: {
  numeroTiers?: string
  clientNom?: string
  rdvActivityId?: string | null
  rdvLabel?: string | null
  userEmail: string
  userName: string
  modeUnique?: 'tache'
  labelBouton?: string
  pleinEcran?: boolean
}) {
  const [modeActif, setModeActif] = useState<Mode | null>(null)
  const [etape, setEtape] = useState<Etape>('idle')
  const [messageFinal, setMessageFinal] = useState('')
  const [resumeAffiche, setResumeAffiche] = useState('')
  const [transcriptAffiche, setTranscriptAffiche] = useState('')
  const [spokenAffiche, setSpokenAffiche] = useState('')
  const [tachesAffichees, setTachesAffichees] = useState<Tache[]>([])
  const [lectureEnCours, setLectureEnCours] = useState(false)
  const [voixPreferee, setVoixPreferee] = useState('nova')
  const [vitesseLecture, setVitesseLecture] = useState(1.15)
  const [annonceCourte, setAnnonceCourte] = useState(false)
  useEffect(() => {
    let cancelled = false
    async function charger() {
      if (!userEmail) return
      const { data } = await supabase.from('vision_tci_preferences').select('voix_assistant, vitesse_lecture, annonce_courte').eq('user_email', userEmail).maybeSingle()
      if (cancelled) return
      setVoixPreferee(String(data?.voix_assistant || 'nova'))
      setVitesseLecture(data?.vitesse_lecture !== null && data?.vitesse_lecture !== undefined ? Number(data.vitesse_lecture) : 1.15)
      setAnnonceCourte(Boolean(data?.annonce_courte))
    }
    void charger()
    return () => { cancelled = true }
  }, [userEmail])
  const [compteRenduIdCible, setCompteRenduIdCible] = useState<string | null>(null)

  const [comptesRendusExistants, setComptesRendusExistants] = useState<CompteRenduExistant[] | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const dernierResultatRef = useRef<{ transcript: string; resume: string; taches: Tache[] } | null>(null)
  const audioEnCoursRef = useRef<HTMLAudioElement | null>(null)
  const resolveLectureRef = useRef<(() => void) | null>(null)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const audioDeverrouilleRef = useRef(false)
  const forceStopConfirmationRef = useRef<(() => void) | null>(null)
  const idInstanceRef = useRef<symbol>(Symbol('voice-session'))
  const annulerRef = useRef(false)

  function creerAudioSilencieux(): string {
    const sampleRate = 8000
    const numSamples = 8
    const dataLength = numSamples * 2
    const buffer = new ArrayBuffer(44 + dataLength)
    const view = new DataView(buffer)
    function writeString(offset: number, s: string) {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
    }
    writeString(0, 'RIFF'); view.setUint32(4, 36 + dataLength, true); writeString(8, 'WAVE')
    writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
    view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
    writeString(36, 'data'); view.setUint32(40, dataLength, true)
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return 'data:audio/wav;base64,' + btoa(binary)
  }

  function debloquerAudio() {
    if (audioDeverrouilleRef.current) return
    try {
      const el = new Audio(creerAudioSilencieux())
      audioElementRef.current = el
      void el.play().catch(() => {})
      audioDeverrouilleRef.current = true
    } catch {
      // Si ça échoue, jouerTexte retombera sur un nouvel Audio() classique.
    }
  }

  async function chargerComptesRendus() {
    if (modeUnique || !rdvActivityId) {
      setComptesRendusExistants([])
      return
    }
    const { data, error } = await supabase
      .from('client_comptes_rendus')
      .select('id, created_at, resume, taches_detectees')
      .eq('rdv_activity_id', rdvActivityId)
      .order('created_at', { ascending: false })
    if (error) {
      console.warn('[VoiceReportButtons] lecture comptes-rendus impossible :', error.message)
      setComptesRendusExistants([])
      return
    }
    setComptesRendusExistants((data || []) as CompteRenduExistant[])
  }

  useEffect(() => {
    let cancelled = false
    async function run() {
      await chargerComptesRendus()
    }
    void run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rdvActivityId])

  function mimeTypeSupporte() {
    if (typeof MediaRecorder === 'undefined') return ''
    if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
    if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
    return ''
  }

  async function jouerTexte(texte: string) {
    if (!texte) return
    setLectureEnCours(true)
    try {
      const res = await fetch('/api/atelier-ai/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: texte, voice: voixPreferee, speed: vitesseLecture }),
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = audioElementRef.current || new Audio()
      audioElementRef.current = audio
      audio.src = url
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

  function libererVerrou() {
    libererVerrouVocal(idInstanceRef.current)
  }

  function arreterCompletement() {
    annulerRef.current = true
    try { forceStopConfirmationRef.current?.() } catch {}
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
    } catch {}
    try { streamRef.current?.getTracks().forEach((t) => t.stop()) } catch {}
    arreterLecture()
    libererVerrou()
    reinitialiser()
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
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      mediaRecorderRef.current = recorder
      recorder.start()
    } catch (e: any) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error(`[enregistreur, mimeType="${mimeType || '(défaut)'}"] ${e?.name || 'Erreur'} : ${e?.message || e}`)
    }
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

  async function enregistrerAvecDetectionSilence(forceStopRef?: { current: (() => void) | null }): Promise<Blob> {
    const SEUIL_RMS = 0.02
    const SILENCE_MS = 1300
    const DUREE_MAX_MS = 12000

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e: any) {
      throw new Error(`[micro] ${e?.name || 'Erreur'} : ${e?.message || e}`)
    }
    streamRef.current = stream

    const mimeType = mimeTypeSupporte()
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    mediaRecorderRef.current = recorder

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    const audioCtx = new AudioContextClass()
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    const donnees = new Uint8Array(analyser.fftSize)

    return new Promise((resolve) => {
      let arrete = false
      let dernierSonTs = Date.now()
      let aParle = false
      const debutTs = Date.now()
      let frameId = 0

      function terminer() {
        if (arrete) return
        arrete = true
        if (frameId) cancelAnimationFrame(frameId)
        recorder.onstop = () => {
          const type = recorder.mimeType || 'audio/webm'
          resolve(new Blob(chunks, { type }))
          stream.getTracks().forEach((t) => t.stop())
          try { audioCtx.close() } catch {}
        }
        if (recorder.state !== 'inactive') recorder.stop()
        else {
          resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
          stream.getTracks().forEach((t) => t.stop())
          try { audioCtx.close() } catch {}
        }
      }

      function boucle() {
        if (arrete) return
        analyser.getByteTimeDomainData(donnees)
        let somme = 0
        for (let i = 0; i < donnees.length; i++) {
          const v = (donnees[i] - 128) / 128
          somme += v * v
        }
        const rms = Math.sqrt(somme / donnees.length)

        if (rms > SEUIL_RMS) {
          dernierSonTs = Date.now()
          aParle = true
        }

        const maintenant = Date.now()
        if ((aParle && maintenant - dernierSonTs > SILENCE_MS) || maintenant - debutTs > DUREE_MAX_MS) {
          terminer()
          return
        }
        frameId = requestAnimationFrame(boucle)
      }

      recorder.start()
      frameId = requestAnimationFrame(boucle)
      if (forceStopRef) forceStopRef.current = terminer
    })
  }

  async function lancer(mode: Mode, completer?: string) {
    if (verrouVocalDetenuParAutre(idInstanceRef.current)) {
      setEtape('erreur')
      setMessageFinal("Une écoute est déjà en cours ailleurs dans l'application. Arrête-la (« Stop écoute ») avant d'en démarrer une nouvelle.")
      return
    }

    debloquerAudio()

    annulerRef.current = false
    acquerirVerrouVocal(idInstanceRef.current)

    setModeActif(mode)
    setMessageFinal('')
    setResumeAffiche('')
    setTranscriptAffiche('')
    setSpokenAffiche('')
    setTachesAffichees([])
    setCompteRenduIdCible(completer || null)
    dernierResultatRef.current = null

    try {
      setEtape('annonce')
      const phraseAccueil =
        mode === 'compte_rendu'
          ? completer
            ? 'Je t’écoute pour compléter le compte rendu de ta visite.'
            : 'Je t’écoute pour synthétiser le compte rendu de ta visite.'
          : annonceCourte
            ? "J'écoute tes tâches à rajouter."
            : 'Je t’écoute, décris la tâche à ajouter.'
      await jouerTexte(phraseAccueil)
      if (annulerRef.current) return

      setEtape('enregistrement')
      await demarrerEnregistrement()
    } catch (err: any) {
      console.error(err)
      libererVerrou()
      setEtape('erreur')
      setMessageFinal(err?.message || "Impossible d'accéder au micro. Vérifie les autorisations du navigateur.")
    }
  }

  async function stopperEtEnvoyer() {
    if (!modeActif) return
    try {
      const blobBrut = await arreterEnregistrement()
      if (annulerRef.current) return
      setEtape('traitement')
      const blobWav = await convertirEnWav(blobBrut)
      if (annulerRef.current) return

      const form = new FormData()
      form.append('audio', blobWav, 'audio.wav')
      form.append('mode', modeActif)
      form.append('numero_tiers', numeroTiers)
      form.append('client_nom', clientNom)
      if (rdvLabel) form.append('rdv_label', rdvLabel)
      form.append('user_email', userEmail)

      const res = await fetch('/api/atelier-ai/voice-report', { method: 'POST', body: form })
      const data = await parserReponseJson(res)
      if (annulerRef.current) return
      if (!res.ok) throw new Error(data?.error || 'Erreur de traitement.')

      dernierResultatRef.current = { transcript: data.transcript, resume: data.resume, taches: data.taches || [] }
      setResumeAffiche(data.resume || '')
      setTranscriptAffiche(data.transcript || '')
      setSpokenAffiche(data.spoken_summary || '')
      setTachesAffichees(data.taches || [])

      await completerEcheancesManquantes()
      if (annulerRef.current) return

      setEtape('resume_pret')

      await jouerTexte(data.spoken_summary)
      if (annulerRef.current) return
      await ecouterConfirmation()
    } catch (err: any) {
      console.error(err)
      libererVerrou()
      setEtape('erreur')
      setMessageFinal(err?.name ? `${err.name} : ${err.message}` : (err?.message || 'Une erreur est survenue.'))
    }
  }

  async function completerEcheancesManquantes() {
    const taches = dernierResultatRef.current?.taches || []
    for (let i = 0; i < taches.length; i++) {
      if (annulerRef.current) return
      if (taches[i].echeance) continue

      let echeanceTrouvee: string | null = null
      let tentatives = 0

      while (!echeanceTrouvee && tentatives < 5) {
        if (annulerRef.current) return
        tentatives += 1
        setEtape('echeance_question')
        await jouerTexte(
          tentatives === 1
            ? `Quelle échéance pour : ${taches[i].description} ?`
            : "Je n'ai pas compris de date. Redis-la autrement, par exemple « demain », « vendredi », ou « le 15 septembre »."
        )
        setEtape('echeance_ecoute')
        const blob = await enregistrerAvecDetectionSilence(forceStopConfirmationRef)
        setEtape('echeance_traitement')
        const blobWav = await convertirEnWav(blob)

        const form = new FormData()
        form.append('audio', blobWav, 'audio.wav')
        try {
          const res = await fetch('/api/atelier-ai/transcribe', { method: 'POST', body: form })
          const data = await parserReponseJson(res)
          if (res.ok) {
            echeanceTrouvee = parserEcheanceParlee(String(data.transcript || ''))
          }
        } catch {
          // silencieux : echeanceTrouvee reste null, on redemande.
        }
      }

      if (echeanceTrouvee && dernierResultatRef.current) {
        dernierResultatRef.current.taches[i] = { ...taches[i], echeance: echeanceTrouvee }
        setTachesAffichees((prev) => prev.map((t, idx) => (idx === i ? { ...t, echeance: echeanceTrouvee } : t)))
      }
    }
  }

  async function ecouterConfirmation() {
    try {
      setEtape('enregistrement_confirmation')
      const blobBrut = await enregistrerAvecDetectionSilence(forceStopConfirmationRef)
      if (annulerRef.current) return
      setEtape('traitement_confirmation')
      const blobWav = await convertirEnWav(blobBrut)
      if (annulerRef.current) return

      const form = new FormData()
      form.append('audio', blobWav, 'audio.wav')
      form.append('mode', modeActif as Mode)
      form.append('numero_tiers', numeroTiers)
      if (rdvActivityId) form.append('rdv_activity_id', rdvActivityId)
      if (rdvLabel) form.append('rdv_label', rdvLabel)
      if (compteRenduIdCible) form.append('compte_rendu_id', compteRenduIdCible)
      form.append('user_email', userEmail)
      form.append('user_name', userName)
      form.append('transcript_original', dernierResultatRef.current?.transcript || '')
      form.append('resume', dernierResultatRef.current?.resume || '')
      form.append('taches', JSON.stringify(dernierResultatRef.current?.taches || []))

      const res = await fetch('/api/atelier-ai/voice-report/confirm', { method: 'POST', body: form })
      const data = await parserReponseJson(res)
      if (annulerRef.current) return
      if (!res.ok) throw new Error(data?.error || 'Erreur de confirmation.')

      if (data.confirme === null) {
        setMessageFinal(data.message)
        await jouerTexte(data.message)
        if (annulerRef.current) return
        await ecouterConfirmation()
        return
      }

      libererVerrou()
      setEtape('termine')
      setMessageFinal(data.message)

      const attenteMinimum = new Promise<void>((resolve) => { window.setTimeout(resolve, 1400) })
      await Promise.all([jouerTexte(data.message), attenteMinimum])

      if (data.confirme && modeActif === 'compte_rendu') {
        await chargerComptesRendus()
      }

      if (data.confirme && pleinEcran) {
        reinitialiser()
      }
    } catch (err: any) {
      console.error(err)
      libererVerrou()
      setEtape('erreur')
      setMessageFinal(err?.name ? `${err.name} : ${err.message}` : (err?.message || 'Une erreur est survenue.'))
    }
  }

  function reinitialiser() {
    libererVerrou()
    setModeActif(null)
    setEtape('idle')
    setMessageFinal('')
    setResumeAffiche('')
    setTranscriptAffiche('')
    setSpokenAffiche('')
    setTachesAffichees([])
    setCompteRenduIdCible(null)
    dernierResultatRef.current = null
  }

  useEffect(() => {
    return () => {
      if (verrouVocalDetenuPar(idInstanceRef.current)) {
        try {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop()
          }
        } catch {}
        try { streamRef.current?.getTracks().forEach((t) => t.stop()) } catch {}
        try { audioEnCoursRef.current?.pause() } catch {}
        libererVerrouVocal(idInstanceRef.current)
      }
    }
  }, [])

  const pathname = usePathname()
  const pathnamePrecedentRef = useRef(pathname)
  useEffect(() => {
    if (pathnamePrecedentRef.current === pathname) return
    pathnamePrecedentRef.current = pathname
    if (verrouVocalDetenuPar(idInstanceRef.current)) {
      arreterCompletement()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  const dernierCompteRendu = comptesRendusExistants && comptesRendusExistants.length > 0 ? comptesRendusExistants[0] : null

  if (etape === 'idle' && modeUnique) {
    return (
      <button type="button" onClick={() => void lancer('tache')} style={boutonStyle('#A6A181')}>
        🎙️ {labelBouton || 'Nouvelle tâche vocale'}
      </button>
    )
  }

  const corps = (
    <>
      {etape !== 'idle' && etape !== 'termine' && etape !== 'erreur' && (
        <button
          type="button"
          onClick={arreterCompletement}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '9px 12px', borderRadius: 999, border: '1px solid rgba(193,104,60,0.5)',
            background: 'rgba(193,104,60,0.15)', color: '#e0a685', fontSize: 12.5, fontWeight: 700,
            cursor: 'pointer', alignSelf: 'flex-start',
          }}
        >
          ⏹ Stop écoute
        </button>
      )}

      {lectureEnCours && (
        <button
          type="button"
          onClick={arreterLecture}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '7px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.22)',
            background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 11.5, fontWeight: 700,
            cursor: 'pointer', alignSelf: 'flex-start',
          }}
        >
          ⏹ Stop
        </button>
      )}

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
              <div style={{ fontSize: 13, color: '#fff', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{cr.resume}</div>
              {cr.taches_detectees?.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                  {cr.taches_detectees.length} tâche{cr.taches_detectees.length > 1 ? 's' : ''} créée{cr.taches_detectees.length > 1 ? 's' : ''} : {cr.taches_detectees.map((t) => t.description).join(' · ')}
                </div>
              )}
              <button
                type="button"
                onClick={() => void jouerTexte(cr.resume)}
                disabled={lectureEnCours}
                style={{
                  marginTop: 10, width: '100%', padding: '11px', borderRadius: 10,
                  border: '1px solid rgba(201,190,239,0.4)', background: 'rgba(201,190,239,0.14)',
                  color: '#C9BEEF', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                }}
              >
                🔊 {lectureEnCours ? 'Lecture…' : 'Écouter le compte-rendu'}
              </button>
            </div>
          ))}
        </div>
      )}

      {etape === 'idle' && !modeUnique && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => void lancer('compte_rendu')} style={boutonStyle('#7A5EA8')}>
              🎙️ {dernierCompteRendu ? 'Nouveau compte-rendu' : 'Compte-rendu vocal'}
            </button>
            <button type="button" onClick={() => void lancer('tache')} style={boutonStyle('#A6A181')}>
              🎙️ Tâche vocale
            </button>
          </div>
          {dernierCompteRendu && (
            <button type="button" onClick={() => void lancer('compte_rendu', dernierCompteRendu.id)} style={boutonStyle('#4B92AC')}>
              ➕ Compléter le compte-rendu
            </button>
          )}
        </div>
      )}

      {etape === 'annonce' && <StatutLigne texte="L’agent parle…" />}

      {etape === 'enregistrement' && (
        <GrandBoutonEcoute texte="Je t’écoute — appuie pour arrêter" onClick={() => void stopperEtEnvoyer()} />
      )}

      {etape === 'traitement' && <StatutLigne texte="Analyse en cours…" />}

      {etape === 'echeance_question' && <StatutLigne texte="L’agent parle…" />}
      {etape === 'echeance_ecoute' && (
        <IndicateurEcouteAuto
          texte="Dis une échéance… je m’arrête tout seul dès que tu as fini"
          onForcerArret={() => forceStopConfirmationRef.current?.()}
        />
      )}
      {etape === 'echeance_traitement' && <StatutLigne texte="Interprétation de la date…" />}

      {resumeAffiche && (etape === 'resume_pret' || etape === 'enregistrement_confirmation' || etape === 'traitement_confirmation' || etape === 'termine') && (
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

          {transcriptAffiche && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>
                Transcription brute (ce qui a été entendu)
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5, fontStyle: 'italic' }}>
                « {transcriptAffiche} »
              </div>
            </div>
          )}
        </div>
      )}

      {etape === 'enregistrement_confirmation' && (
        <IndicateurEcouteAuto
          texte="Dis « oui, c’est correct » ou « non »… je m’arrête tout seul dès que tu as fini"
          onForcerArret={() => forceStopConfirmationRef.current?.()}
        />
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
</>
  )

  if (pleinEcran && etape !== 'idle') {
    return (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 230, background: 'rgba(6,10,18,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        onClick={etape === 'termine' || etape === 'erreur' ? reinitialiser : undefined}
      >
        <div
          style={{
            width: '100%', maxWidth: 520, height: '92vh', maxHeight: '92vh',
            background: '#141A26', borderTopLeftRadius: 24, borderTopRightRadius: 24,
            border: '1px solid rgba(122,94,168,0.3)', display: 'flex', flexDirection: 'column',
            overflow: 'hidden', padding: '14px 20px 24px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 14px', flexShrink: 0 }} />
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {corps}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {corps}
    </div>
  )
}

function boutonStyle(color: string): React.CSSProperties {
  return {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 52,
    padding: '0 10px',
    borderRadius: 12,
    border: `1px solid ${color}55`,
    background: `${color}1F`,
    color: '#fff',
    fontSize: 13.5,
    fontWeight: 700,
    cursor: 'pointer',
    textAlign: 'center',
    lineHeight: 1.25,
  }
}

function StatutLigne({ texte }: { texte: string }) {
  return (
    <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'rgba(255,255,255,0.55)' }}>
      {texte}
    </div>
  )
}

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

function IndicateurEcouteAuto({ texte, onForcerArret }: { texte: string; onForcerArret: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '18px 0' }}>
      <button
        type="button"
        onClick={onForcerArret}
        aria-label="Forcer l'arrêt de l'écoute (facultatif, ça s'arrête normalement tout seul)"
        style={{
          width: 108,
          height: 108,
          borderRadius: '50%',
          border: '2px solid rgba(63,145,66,0.6)',
          background: 'rgba(63,145,66,0.20)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 44,
          lineHeight: 1,
          cursor: 'pointer',
          animation: 'cgcPulseEcouteAuto 1.1s ease-in-out infinite',
          flexShrink: 0,
        }}
      >
        🎙️
      </button>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#8fd4a8', textAlign: 'center', maxWidth: 240 }}>{texte}</div>
      <style>{`
        @keyframes cgcPulseEcouteAuto { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.07); opacity: 0.75; } }
      `}</style>
    </div>
  )
}
