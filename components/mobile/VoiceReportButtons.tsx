'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

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
 * ça garantit un fichier propre quel que soit le navigateur.
 */

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
 * Verrou global partagé entre TOUTES les instances de VoiceReportButtons
 * montées simultanément dans l'app (bouton "Nouvelle tâche" de l'accueil,
 * fiche RDV, fiche client...) : empêche de démarrer une session d'écoute
 * pendant qu'une autre est déjà active ailleurs, ce qui ouvrirait deux
 * micros en parallèle et mélangerait les flux. Simple variable de module
 * (pas de contexte React) : une seule page/onglet à la fois côté mobile,
 * pas besoin de plus. Remise à null dès que la session propriétaire se
 * termine, échoue, est stoppée manuellement, ou que son composant se
 * démonte.
 */
let verrouSessionVocaleGlobal: { id: symbol } | null = null

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
async function convertirEnWav(blob: Blob): Promise<Blob> {
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    const audioCtx = new AudioContextClass()
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0))
    void audioCtx.close()

    // Garde-fou : un décodage "réussi" mais anormalement court (< 0.3s)
    // pour un enregistrement qu'on sait plus long est le signe d'un
    // décodage silencieusement défaillant (buffer quasi vide) plutôt que
    // d'un vrai enregistrement court — dans ce cas, mieux vaut renvoyer le
    // blob d'origine (qui a au moins une chance d'être correctement
    // interprété côté serveur) qu'un WAV "valide" mais vide.
    if (audioBuffer.duration < 0.3) {
      console.warn('[VoiceReportButtons] durée décodée suspecte (', audioBuffer.duration, 's) — envoi du blob d’origine')
      return blob
    }

    const wav = audioBufferToWav(audioBuffer)
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

// ── Comprend une échéance dictée en français ────────────────────────────
// Table complète des nombres français 0-31 (mêmes formes que dans
// MobileHomeSummary.tsx, dupliquée ici car fichiers séparés) -- utilisée
// pour reconnaître un jour du mois dicté en toutes lettres ("le quinze
// septembre"), en plus des chiffres classiques ("15 septembre").
const NOMBRES_FR_0_31 = [
  'zero', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix sept', 'dix huit', 'dix neuf',
  'vingt', 'vingt et un', 'vingt deux', 'vingt trois', 'vingt quatre', 'vingt cinq', 'vingt six', 'vingt sept', 'vingt huit', 'vingt neuf',
  'trente', 'trente et un',
]
const MOTS_VERS_NOMBRE = new Map<string, number>(NOMBRES_FR_0_31.map((mots, n) => [mots, n]))
const FORMES_TRIEES = [...NOMBRES_FR_0_31].sort((a, b) => b.split(' ').length - a.split(' ').length)
const MOIS_FR_LISTE = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']
const JOURS_SEMAINE = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] // index = Date.getDay()

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

/** Construit une date à partir d'un jour + mois, en choisissant l'année en
 * cours si la date n'est pas encore passée, sinon l'année suivante (une
 * échéance dictée est presque toujours dans le futur). */
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

/** Interprète une échéance dictée en français (relative ou absolue) et
 * renvoie une date ISO, ou null si rien de reconnaissable -- dans ce cas
 * l'appelant redemande plutôt que de deviner ou d'enregistrer une date
 * fausse. Gère : aujourd'hui/demain/après-demain, jours de la semaine
 * ("vendredi" = le prochain vendredi), "dans X jours", "la semaine
 * prochaine", jour+mois en chiffres ("15 septembre") ou en toutes lettres
 * ("le quinze septembre"), et JJ/MM. */
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
      if (delta === 0) delta = 7 // dicter "vendredi" un vendredi -> vendredi PROCHAIN
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
  // Quand fourni, n'affiche qu'un seul bouton de dictée (pas de
  // compte-rendu, pas de section "compte-rendu existant") — utilisé pour
  // la création rapide de tâche depuis l'accueil, sans client/rdv associé.
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
  /** Quand vrai, tout le flux (une fois lancé) s'affiche dans un panneau
   * quasi plein écran plutôt qu'inline -- utilisé pour la création rapide
   * de tâche depuis l'accueil. Laissé à false dans les fiches RDV/client,
   * où le composant est déjà inline dans une sheet existante (pas besoin
   * d'une seconde sheet par-dessus). */
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
  // Voix choisie par l'utilisateur (écran d'accueil, "🎙️ Voix") --
  // chargée une fois, réutilisée pour tous les appels /speak de ce
  // composant. Repli sur 'nova' si aucune préférence enregistrée.
  const [voixPreferee, setVoixPreferee] = useState('nova')
  useEffect(() => {
    let cancelled = false
    async function charger() {
      if (!userEmail) return
      const { data } = await supabase.from('vision_tci_preferences').select('voix_assistant').eq('user_email', userEmail).maybeSingle()
      if (!cancelled) setVoixPreferee(String(data?.voix_assistant || 'nova'))
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
  // Élément <audio> réutilisé pour toute la session -- voir debloquerAudio().
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const audioDeverrouilleRef = useRef(false)
  const forceStopConfirmationRef = useRef<(() => void) | null>(null)
  // Identité stable de CETTE instance -- sert à savoir si c'est bien elle
  // qui détient verrouSessionVocaleGlobal (et donc si elle peut le
  // libérer / si elle doit refuser de démarrer une nouvelle session).
  const idInstanceRef = useRef<symbol>(Symbol('voice-session'))
  // Vrai dès que "Stop écoute" (arreterCompletement) a été déclenché --
  // vérifié après chaque `await` des chaînes async longues pour cesser
  // immédiatement toute suite du flux (pas d'écriture en base après un
  // arrêt volontaire).
  const annulerRef = useRef(false)

  /** Minuscule WAV silencieux généré à la volée (pas de fichier binaire à
   * livrer) -- sert uniquement à "débloquer" l'élément <audio> ci-dessous. */
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
    // Les échantillons restent à 0 (silence) -- ArrayBuffer est initialisé à zéro.
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return 'data:audio/wav;base64,' + btoa(binary)
  }

  /** CORRECTIF lecture auto bloquée par Safari : entre le tap initial et le
   * moment où le résumé est prêt, plusieurs secondes s'écoulent (appels
   * réseau STT + IA) -- assez pour que Safari considère que le "geste
   * utilisateur" a expiré et bloque silencieusement les play() suivants.
   * Un élément <audio> ayant déjà joué un son avec succès DANS la pile
   * d'appel synchrone du clic reste ensuite autorisé à rejouer (changement
   * de src + play()) même depuis un contexte asynchrone -- c'est le
   * mécanisme de déblocage standard sur mobile. Doit être appelé en tout
   * premier, avant tout `await`, dans le handler de clic. */
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

  /** Best-effort : ne bloque jamais le flux si la lecture est refusée
   * (politique autoplay du navigateur). Le texte est de toute façon déjà
   * affiché à l'écran. Attend la fin de la lecture (ou l'échec) avant de
   * résoudre, pour permettre d'enchaîner ensuite sur l'écoute. Réutilise
   * le même élément <audio> débloqué au tap initial (voir debloquerAudio)
   * plutôt que d'en créer un nouveau, sinon celui-ci retombe sous le coup
   * de la politique autoplay pour tout appel un peu tardif. */
  async function jouerTexte(texte: string) {
    if (!texte) return
    setLectureEnCours(true)
    try {
      const res = await fetch('/api/atelier-ai/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: texte, voice: voixPreferee }),
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

  /** Coupe la lecture en cours à tout moment (bouton "⏹ Stop" affiché tant
   * que lectureEnCours est vrai). pause() ne déclenche pas onended, donc on
   * résout manuellement la promesse en attente pour laisser le flux
   * continuer normalement (ex. passer à l'écoute de confirmation). */
  function arreterLecture() {
    if (audioEnCoursRef.current) {
      try { audioEnCoursRef.current.pause() } catch {}
    }
    if (resolveLectureRef.current) {
      resolveLectureRef.current()
      resolveLectureRef.current = null
    }
  }

  /** Libère le verrou global SEULEMENT si cette instance le détient
   * actuellement -- ne touche jamais à une session détenue par une autre
   * instance. Appelé à chaque fin de flux (succès, erreur, arrêt manuel,
   * démontage). */
  function libererVerrou() {
    if (verrouSessionVocaleGlobal?.id === idInstanceRef.current) {
      verrouSessionVocaleGlobal = null
    }
  }

  /** "Stop écoute" -- arrêt complet et immédiat de la session en cours,
   * quelle que soit l'étape actuelle (annonce, enregistrement, traitement,
   * écoute de confirmation...). Coupe le micro, l'enregistreur et toute
   * lecture audio, empêche la suite du flux de continuer (annulerRef,
   * vérifié après chaque await dans stopperEtEnvoyer/ecouterConfirmation/
   * completerEcheancesManquantes -- aucune écriture en base après un
   * arrêt volontaire), libère le verrou global, puis revient à l'état de
   * repos. */
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

  /** Enregistrement mains libres pour une réponse courte (oui/non) :
   * démarre le micro et s'arrête TOUT SEUL dès qu'un silence d'environ
   * 1,3s suit un moment de parole détecté -- pas de bouton "stop" requis.
   * Filet de sécurité à 12s pour ne jamais rester bloqué si le micro ne
   * détecte jamais de silence net. */
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
    // Empêche de démarrer une 2e session pendant qu'une autre tourne déjà
    // ailleurs dans l'app (accueil, fiche RDV, fiche client...) -- voir
    // verrouSessionVocaleGlobal en tête de fichier.
    if (verrouSessionVocaleGlobal && verrouSessionVocaleGlobal.id !== idInstanceRef.current) {
      setEtape('erreur')
      setMessageFinal("Une écoute est déjà en cours ailleurs dans l'application. Arrête-la (« Stop écoute ») avant d'en démarrer une nouvelle.")
      return
    }

    // Doit être la toute première instruction, avant tout `await` -- voir
    // le commentaire de debloquerAudio() plus haut.
    debloquerAudio()

    annulerRef.current = false
    verrouSessionVocaleGlobal = { id: idInstanceRef.current }

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
          : 'Je t’écoute, décris la tâche à ajouter.'
      // On ATTEND la fin de l'annonce avant de démarrer le micro : sinon le
      // micro capte l'annonce elle-même (bouclage haut-parleur -> micro) au
      // lieu d'attendre la voix de l'utilisateur, ce qui produisait des
      // enregistrements sans contenu exploitable.
      await jouerTexte(phraseAccueil)
      if (annulerRef.current) return // "Stop écoute" pendant l'annonce

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
      const data = await res.json()
      if (annulerRef.current) return
      if (!res.ok) throw new Error(data?.error || 'Erreur de traitement.')

      dernierResultatRef.current = { transcript: data.transcript, resume: data.resume, taches: data.taches || [] }
      setResumeAffiche(data.resume || '')
      setTranscriptAffiche(data.transcript || '')
      setSpokenAffiche(data.spoken_summary || '')
      setTachesAffichees(data.taches || [])

      // Aucune tâche ne doit être enregistrée sans échéance -- si l'IA n'en
      // a détecté aucune pour une ou plusieurs tâches, on les redemande
      // une par une, à la voix, AVANT de proposer le résumé/la
      // confirmation. dernierResultatRef.current.taches est mis à jour au
      // fur et à mesure : c'est bien ce tableau complété qui part ensuite
      // dans /confirm.
      await completerEcheancesManquantes()
      if (annulerRef.current) return

      setEtape('resume_pret')

      // Mains libres : on énonce le résumé PUIS on relance automatiquement
      // l'écoute pour la confirmation orale, sans exiger de toucher
      // l'écran. Si la lecture est bloquée par le navigateur, l'écoute
      // démarre quand même (le résumé reste affiché à l'écran).
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

  /** Aucune tâche ne doit être enregistrée sans échéance -- redemande
   * chacune manquante, une par une, à la voix, mains libres. Met à jour
   * dernierResultatRef.current.taches ET tachesAffichees (affichage) au
   * fur et à mesure. Redemande en boucle tant que la réponse n'est pas
   * compréhensible comme une date, plutôt que d'abandonner ou de deviner. */
  async function completerEcheancesManquantes() {
    const taches = dernierResultatRef.current?.taches || []
    for (let i = 0; i < taches.length; i++) {
      if (annulerRef.current) return // "Stop écoute" pendant la complétion des échéances
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
          const data = await res.json()
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
      // Après 5 tentatives infructueuses : on n'insiste pas indéfiniment,
      // la tâche part sans échéance plutôt que de bloquer tout le flux --
      // l'utilisateur pourra la compléter plus tard depuis "Mes tâches".
    }
  }

  /** Confirmation orale mains libres : écoute automatiquement, s'arrête
   * seule au silence (voir enregistrerAvecDetectionSilence), puis envoie
   * directement -- plus besoin de taper sur un bouton pour dire "oui" ou
   * "non". `forceStopConfirmationRef` permet quand même de forcer l'arrêt
   * plus tôt en tapant l'indicateur à l'écran, en secours. */
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
      const data = await res.json()
      if (annulerRef.current) return
      if (!res.ok) throw new Error(data?.error || 'Erreur de confirmation.')

      if (data.confirme === null) {
        setMessageFinal(data.message)
        await jouerTexte(data.message)
        if (annulerRef.current) return
        await ecouterConfirmation() // redemande, toujours sans toucher l'écran
        return
      }

      libererVerrou() // flux terminé -- plus aucune activité micro/écriture en cours
      setEtape('termine')
      setMessageFinal(data.message)

      // Laisse le message "Tâches créées" affiché au moins 1,4s (le temps
      // de le lire) ET attend la fin de la lecture vocale si elle joue plus
      // longtemps -- puis, en mode plein écran (bouton "Nouvelle tâche" de
      // l'accueil), referme automatiquement la fenêtre pour revenir
      // directement sur l'écran d'origine, sans exiger un tap sur
      // "Fermer". Dans les fiches RDV/client (pleinEcran=false), on garde
      // le comportement existant : l'utilisateur ferme lui-même, au cas où
      // il veut relire le résumé ou enchaîner sur autre chose dans la
      // même sheet.
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

  // Nettoyage au démontage : si cette instance détient encore le verrou
  // (navigation pendant une écoute active), on coupe micro/enregistreur/
  // lecture en cours et on le libère -- sinon une session orpheline
  // bloquerait indéfiniment toute autre instance de démarrer.
  useEffect(() => {
    return () => {
      if (verrouSessionVocaleGlobal?.id === idInstanceRef.current) {
        try {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop()
          }
        } catch {}
        try { streamRef.current?.getTracks().forEach((t) => t.stop()) } catch {}
        try { audioEnCoursRef.current?.pause() } catch {}
        verrouSessionVocaleGlobal = null
      }
    }
  }, [])

  const dernierCompteRendu = comptesRendusExistants && comptesRendusExistants.length > 0 ? comptesRendusExistants[0] : null

  // Cas particulier : bouton "idle" en mode unique (accueil), rendu comme
  // un simple <button> sans wrapper ni marge -- exactement comme celui de
  // MobileHomeSummary à côté duquel il est affiché. Le reste du composant
  // passe par `corps`, enveloppé dans un <div style={{marginTop:10,...}}>
  // qui décalait ce bouton vers le bas et le faisait paraître plus petit/
  // désaligné par rapport à son voisin.
  if (etape === 'idle' && modeUnique) {
    return (
      <button type="button" onClick={() => void lancer('tache')} style={boutonStyle('#A6A181')}>
        🎙️ {labelBouton || 'Nouvelle tâche vocale'}
      </button>
    )
  }

  const corps = (
    <>
      {/* "Stop écoute" -- visible à TOUTE étape active du flux (annonce,
         enregistrement, traitement, écoute de confirmation...), pas
         seulement pendant la lecture de la voix de l'agent. Contrairement
         au "⏹ Stop" ci-dessous (qui ne coupe que la lecture audio en
         cours), celui-ci arrête complètement la session : micro,
         enregistreur, lecture, et sort du flux sans rien écrire en base. */}
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

      {/* Visible à tout moment pendant une lecture, quelle que soit l'étape
         du flux (annonce, résumé, confirmation, message final). */}
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
              <div style={{ fontSize: 13, color: '#fff', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{cr.resume}</div>
              {cr.taches_detectees?.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                  {cr.taches_detectees.length} tâche{cr.taches_detectees.length > 1 ? 's' : ''} créée{cr.taches_detectees.length > 1 ? 's' : ''} : {cr.taches_detectees.map((t) => t.description).join(' · ')}
                </div>
              )}
              {/* Gros bouton tactile — remplace l'ancien lien texte minuscule. */}
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

      {/* ---- Boutons de lancement ----
         Le cas "idle && modeUnique" est court-circuité en tête de fonction
         (rendu sans wrapper), donc pas répété ici. */}
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

      {/* Le résumé reste affiché pendant toute la suite du flux (écoute de
         confirmation, traitement, fin) — pas seulement à l'étape où il
         vient d'arriver. */}
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

  // Mode plein écran (accueil, création de tâche libre) : une fois le flux
  // lancé, tout s'affiche dans un panneau quasi plein écran plutôt qu'en
  // ligne -- même principe que MobileHomeSummary. Le bouton "idle" (avant
  // lancement) reste toujours affiché en ligne, dans les deux modes.
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

/** Gros bouton rond, pensé pour être facile à retrouver et à taper d'un
 * pouce pour arrêter l'écoute. */
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

/** Indicateur d'écoute mains libres : ne nécessite AUCUN tap (l'arrêt est
 * automatique, dès le silence détecté). Reste tapable en secours pour
 * forcer l'arrêt plus tôt si la détection tarde. */
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
