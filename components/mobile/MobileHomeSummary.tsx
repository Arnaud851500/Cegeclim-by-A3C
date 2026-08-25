'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { acquerirVerrouVocal, libererVerrouVocal, verrouVocalDetenuPar, verrouVocalDetenuParAutre } from '@/lib/voiceSessionLock'

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

// Intents reconnus par /api/atelier-ai/interpret-summary (LLM, remplace
// l'ancienne classification par mots-clés -- voir classifierChoix plus
// bas, conservée en solution de repli locale si l'appel réseau échoue).
// Les nouveaux intents (rdv_prochains, taches_prochaines, ca_periode,
// devis_montant, rdv_sans_compte_rendu) prennent des PARAMÈTRES (nombre,
// seuil, période, famille) qu'une regex ne peut pas extraire de façon
// fiable depuis une phrase dictée -- d'où le passage par un modèle.
type Intent =
  | 'jour' | 'semaine' | 'semaine_prochaine'
  | 'rdv' | 'rdv_semaine_prochaine' | 'rdv_prochains'
  | 'taches_prochaines'
  | 'ca_periode' | 'devis_montant' | 'rdv_sans_compte_rendu'
  | 'compte_rendu' | 'alertes'
type IntentParams = {
  n?: number
  montant_min?: number
  jours?: number
  periode?: 'hier' | 'aujourdhui' | 'mois'
  famille?: string | null
}
type Etape = 'idle' | 'question' | 'ecoute' | 'traitement' | 'incompris' | 'resultat' | 'erreur'
  | 'question_client' | 'ecoute_client' | 'traitement_client'

const RDV_TYPE_KEYS = ['meeting', 'phoneCall', 'reminder', '4', '7', '9']
// Familles connues côté get_ca_periode_par_famille -- pour un rapprochement
// tolérant (accents/majuscules/variantes usuelles) entre ce que le modèle
// d'interprétation renvoie et les libellés réels en base.
const FAMILLES_CONNUES = ['R/R', 'R/O', 'ECS', 'DRV', 'R_ZONE', 'ACC', 'PV', 'TECH', 'SAV', 'AUTRES', 'DIV']
const QUESTION =
  'Que veux-tu savoir ? Tes tâches, tes prochains rendez-vous, ton chiffre d’affaires, tes derniers devis, les rendez-vous sans compte-rendu, ou tes alertes ?'
// Variante "annonce courte" (réglage utilisateur, vision_tci_preferences.
// annonce_courte) -- ne remplace QUE cette question d'accueil, jamais les
// questions de relance ("je n'ai pas compris...") ni les questions liées
// au compte-rendu client, qui restent explicites quel que soit ce réglage.
const QUESTION_COURTE = 'Que souhaites-tu savoir ?'


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
/** Lundi de la semaine prochaine. */
function debutSemaineProchaineIso() {
  const d = new Date()
  const jour = d.getDay() || 7
  d.setDate(d.getDate() + (7 - jour) + 1)
  return d.toISOString().slice(0, 10)
}
/** Dimanche de la semaine prochaine. */
function finSemaineProchaineIso() {
  const d = new Date(debutSemaineProchaineIso())
  d.setDate(d.getDate() + 6)
  return d.toISOString().slice(0, 10)
}
function todayIso() {
  return new Date().toISOString().slice(0, 10)
}
/** Date ISO en fuseau LOCAL (pas UTC comme toISOString) -- pour les
 * bornes de get_ca_periode_par_famille, où décaler le jour d'un fuseau
 * changerait le résultat ("hier" ne doit jamais glisser sur "avant-hier"
 * ou "aujourd'hui" selon l'heure de la requête). */
function isoDepuisDateLocale(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
/** Rapproche un terme dicté ("pompes à chaleur", "photovoltaïque"...) du
 * code de famille macro réellement utilisé en base -- la personne ne
 * dicte jamais "R/R" ou "PV" directement. Le modèle d'interprétation
 * fait déjà une partie de ce travail (voir le prompt système de
 * /api/atelier-ai/interpret-summary), ce rapprochement est une seconde
 * passe tolérante côté front, au cas où sa réponse ne matche pas
 * exactement un code connu. */
const FAMILLE_SYNONYMES: Record<string, string> = {
  pac: 'R/R', 'pompe a chaleur': 'R/R', 'pompes a chaleur': 'R/R', reversible: 'R/R', refrigeration: 'R/R',
  renouvellement: 'R/O',
  ecs: 'ECS', 'eau chaude': 'ECS', 'eau chaude sanitaire': 'ECS', ballon: 'ECS',
  drv: 'DRV', vrv: 'DRV',
  zone: 'R_ZONE', multisplit: 'R_ZONE', 'multi split': 'R_ZONE', 'r zone': 'R_ZONE',
  accessoire: 'ACC', accessoires: 'ACC',
  photovoltaique: 'PV', pv: 'PV', 'panneaux solaires': 'PV', solaire: 'PV',
  technique: 'TECH', presta: 'TECH', prestation: 'TECH', prestations: 'TECH',
  sav: 'SAV', 'service apres vente': 'SAV',
  divers: 'DIV',
  autres: 'AUTRES',
}
function rapprocherFamille(saisie: string): string | null {
  const n = normaliser(saisie).trim()
  if (!n) return null
  const exact = FAMILLES_CONNUES.find((f) => normaliser(f) === n)
  if (exact) return exact
  if (FAMILLE_SYNONYMES[n]) return FAMILLE_SYNONYMES[n]
  const cle = Object.keys(FAMILLE_SYNONYMES).find((k) => n.includes(k) || k.includes(n))
  return cle ? FAMILLE_SYNONYMES[cle] : null
}
/** Montant formaté pour la lecture vocale -- ex. "24 327 €", sans
 * décimales (inutiles à l'oral). */
function formatMontantParle(montant: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(montant || 0)
}

function normaliser(value: string) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Table complète des nombres français 0-99 (formes correctes y compris
// les irrégularités 70-79/80-99), sans accents et tirets remplacés par
// des espaces -- générée une fois pour toutes, pas d'heuristique risquée.
const NOMBRES_FR_0_99 = [
  'zero', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix sept', 'dix huit', 'dix neuf',
  'vingt', 'vingt et un', 'vingt deux', 'vingt trois', 'vingt quatre', 'vingt cinq', 'vingt six', 'vingt sept', 'vingt huit', 'vingt neuf',
  'trente', 'trente et un', 'trente deux', 'trente trois', 'trente quatre', 'trente cinq', 'trente six', 'trente sept', 'trente huit', 'trente neuf',
  'quarante', 'quarante et un', 'quarante deux', 'quarante trois', 'quarante quatre', 'quarante cinq', 'quarante six', 'quarante sept', 'quarante huit', 'quarante neuf',
  'cinquante', 'cinquante et un', 'cinquante deux', 'cinquante trois', 'cinquante quatre', 'cinquante cinq', 'cinquante six', 'cinquante sept', 'cinquante huit', 'cinquante neuf',
  'soixante', 'soixante et un', 'soixante deux', 'soixante trois', 'soixante quatre', 'soixante cinq', 'soixante six', 'soixante sept', 'soixante huit', 'soixante neuf',
  'soixante dix', 'soixante et onze', 'soixante douze', 'soixante treize', 'soixante quatorze', 'soixante quinze', 'soixante seize', 'soixante dix sept', 'soixante dix huit', 'soixante dix neuf',
  'quatre vingts', 'quatre vingt un', 'quatre vingt deux', 'quatre vingt trois', 'quatre vingt quatre', 'quatre vingt cinq', 'quatre vingt six', 'quatre vingt sept', 'quatre vingt huit', 'quatre vingt neuf',
  'quatre vingt dix', 'quatre vingt onze', 'quatre vingt douze', 'quatre vingt treize', 'quatre vingt quatorze', 'quatre vingt quinze', 'quatre vingt seize', 'quatre vingt dix sept', 'quatre vingt dix huit', 'quatre vingt dix neuf',
]
// Table inversée "mots -> valeur", triée par nombre de mots décroissant
// pour matcher en priorité les formes les plus longues (ex. "quatre
// vingt dix sept" avant "quatre vingt dix" avant "quatre").
const MOTS_VERS_NOMBRE = new Map<string, number>(NOMBRES_FR_0_99.map((mots, n) => [mots, n]))
const FORMES_TRIEES = [...NOMBRES_FR_0_99].sort((a, b) => b.split(' ').length - a.split(' ').length)

/** Convertit une suite de mots FR normalisés (ex. "zero cent soixante
 * deux" ou "c zero cent soixante deux") en une chaîne de chiffres (ex.
 * "0162"), en conservant les préfixes alphabétiques tels quels (lettres
 * de code SAGE : "C", "DB", ...).
 *
 * Principe : "zéro" démarre toujours un nouveau groupe de chiffres à lui
 * seul (c'est comme ça qu'on dicte naturellement un code composé :
 * "zéro" puis "cent soixante-deux" = deux groupes "0" et "162" qu'on
 * concatène, pas une addition). À l'intérieur d'un groupe, "cent" se
 * combine avec ce qui l'entoure ("deux cent" = 200, "cent soixante
 * deux" = 162) plutôt que d'être ignoré.
 */
function motsVersNumeroClient(texte: string): string {
  // CORRECTIF : Whisper transcrit très souvent une lettre isolée dictée
  // ("C") comme le mot homophone le plus courant ("c'est"), en tout début
  // de phrase -- confirmé en usage réel ("C zéro cent..." transcrit
  // "C'est zéro cent..."). On corrige ces confusions connues avant tout
  // découpage, uniquement en tout début de texte pour limiter le risque
  // de faux positif sur un usage normal du mot ailleurs dans la phrase.
  const texteCorrige = texte.replace(/^\s*(c'est|ces|ses|sait|s'est)\b/i, 'C')

  const mots = normaliser(texteCorrige).replace(/-/g, ' ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const sortie: string[] = []
  let i = 0

  function matcherForme0a99(depart: number): { valeur: number; longueur: number } | null {
    for (const forme of FORMES_TRIEES) {
      const longueur = forme.split(' ').length
      if (mots.slice(depart, depart + longueur).join(' ') === forme) {
        return { valeur: MOTS_VERS_NOMBRE.get(forme) as number, longueur }
      }
    }
    return null
  }

  while (i < mots.length) {
    // Lettre isolée (préfixe de code SAGE, ex. "C", "D") -> conservée telle quelle.
    if (/^[a-z]$/.test(mots[i])) {
      sortie.push(mots[i].toUpperCase())
      i += 1
      continue
    }

    if (mots[i] === 'zero') {
      sortie.push('0')
      i += 1
      continue
    }

    // "<0-9> cent" (ex. "deux cent" = 200) : le petit nombre juste avant
    // "cent" est un multiplicateur, pas un chiffre isolé.
    const avantCent = matcherForme0a99(i)
    if (avantCent && avantCent.valeur <= 9 && mots[i + avantCent.longueur] === 'cent') {
      let valeur = avantCent.valeur * 100
      let j = i + avantCent.longueur + 1
      const apres = matcherForme0a99(j)
      if (apres) { valeur += apres.valeur; j += apres.longueur }
      sortie.push(String(valeur))
      i = j
      continue
    }

    // "cent" seul en tête (ex. "cent soixante deux" = 162).
    if (mots[i] === 'cent') {
      let valeur = 100
      let j = i + 1
      const apres = matcherForme0a99(j)
      if (apres) { valeur += apres.valeur; j += apres.longueur }
      sortie.push(String(valeur))
      i = j
      continue
    }

    // Nombre simple 0-99 (forme la plus longue en priorité).
    const simple = matcherForme0a99(i)
    if (simple) {
      sortie.push(String(simple.valeur))
      i += simple.longueur
      continue
    }

    // Mot non reconnu (bruit de transcription) : ignoré, on continue
    // plutôt que de tout faire échouer.
    i += 1
  }

  return sortie.join('')
}

/** Solution de repli LOCALE (mots-clés, aucun réseau) -- utilisée
 * uniquement si l'appel à /api/atelier-ai/interpret-summary échoue
 * (réseau coupé, API indisponible...), pour ne jamais bloquer les
 * demandes simples les plus fréquentes. Ne couvre PAS les nouveaux
 * intents paramétrés (rdv_prochains avec un nombre précis, devis_montant,
 * ca_periode avec période/famille précises, rdv_sans_compte_rendu...) --
 * une regex ne peut pas extraire ces paramètres de façon fiable ; dans ce
 * cas la personne obtient un comportement par défaut raisonnable plutôt
 * qu'un blocage complet. */
function classifierChoixRepli(transcript: string): { intent: Intent; params: IntentParams } | null {
  const t = normaliser(transcript)
  if (/compte[- ]?rendu/.test(t)) return { intent: 'compte_rendu', params: {} }
  if (/alerte/.test(t)) return { intent: 'alertes', params: {} }
  // CORRECTIF : "ca" seul est trop ambigu en repli local (se confond avec
  // "ça" une fois les accents retirés par normaliser()) -- on exige la
  // formulation explicite "chiffre d'affaires" pour ce chemin de secours
  // sans réseau. periode volontairement absent des params : genererResume()
  // retombe sur "aujourd'hui" par défaut quand params.periode n'est pas
  // fourni, donc pas besoin de le deviner ici.
  if (/chiffre.*affaires?/.test(t)) return { intent: 'ca_periode', params: {} }

  const estSemaineProchaine = /semaine\s+prochaine|prochaine\s+semaine/.test(t)
  const estRdv = /\brdv\b|rendez[- ]?vous|reunion|reunions|agenda|planning|visites?\b/.test(t)

  if (estSemaineProchaine && estRdv) return { intent: 'rdv_semaine_prochaine', params: {} }
  if (estSemaineProchaine) return { intent: 'semaine_prochaine', params: {} }
  if (estRdv) return { intent: 'rdv', params: {} }
  if (/semaine|hebdo/.test(t)) return { intent: 'semaine', params: {} }
  if (/retard|aujourd\s?hui|\bjour\b|jours|maintenant|taches?\b/.test(t)) return { intent: 'jour', params: {} }
  return null
}

/** Interprète la demande dictée -- passe par le modèle
 * (/api/atelier-ai/interpret-summary) pour reconnaître les tournures
 * paramétrées ("mes 3 prochains rdv", "les 10 derniers devis de plus de
 * 15000 euros"...), avec repli local en cas d'échec réseau. */
async function interpreterDemande(transcript: string): Promise<{ intent: Intent; params: IntentParams } | null> {
  try {
    const res = await fetch('/api/atelier-ai/interpret-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
    })
    if (res.ok) {
      const data = await res.json()
      const intent = String(data?.intent || 'inconnu') as Intent | 'inconnu'
      if (intent !== 'inconnu') return { intent: intent as Intent, params: (data?.params || {}) as IntentParams }
      return null
    }
  } catch {
    // silencieux -- repli local ci-dessous
  }
  return classifierChoixRepli(transcript)
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
  // Solution de secours fiable : la reconnaissance vocale d'un code
  // alphanumérique ou d'un nom propre a des limites dures (lettres
  // isolées confondues avec des mots, variantes phonétiques de noms
  // propres) -- taper directement lève toute ambiguïté.
  const [saisieClientTexte, setSaisieClientTexte] = useState('')
  const [saisieClientEnCours, setSaisieClientEnCours] = useState(false)
  const [modeClient, setModeClient] = useState(false)
  const [erreur, setErreur] = useState('')
  const [lectureEnCours, setLectureEnCours] = useState(false)
  // Voix, vitesse de lecture et mode "annonce courte" choisis par
  // l'utilisateur (écran d'accueil, "🎙️ Voix"), tous les trois dans
  // vision_tci_preferences -- chargés une fois, réutilisés pour tous les
  // appels /speak de ce composant. Replis : 'nova' / 1.15 / false si
  // aucune préférence enregistrée.
  const [voixPreferee, setVoixPreferee] = useState('nova')
  const [vitesseLecture, setVitesseLecture] = useState(1.15)
  const [annonceCourte, setAnnonceCourte] = useState(false)
  useEffect(() => {
    let cancelled = false
    async function charger() {
      const email = String(userEmail || '').toLowerCase().trim()
      if (!email) return
      const { data } = await supabase.from('vision_tci_preferences').select('voix_assistant, vitesse_lecture, annonce_courte').eq('user_email', email).maybeSingle()
      if (cancelled) return
      setVoixPreferee(String(data?.voix_assistant || 'nova'))
      setVitesseLecture(data?.vitesse_lecture !== null && data?.vitesse_lecture !== undefined ? Number(data.vitesse_lecture) : 1.15)
      setAnnonceCourte(Boolean(data?.annonce_courte))
    }
    void charger()
    return () => { cancelled = true }
  }, [userEmail])

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioEnCoursRef = useRef<HTMLAudioElement | null>(null)
  const resolveLectureRef = useRef<(() => void) | null>(null)
  // Élément <audio> réutilisé pour toute la session -- voir debloquerAudio().
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const audioDeverrouilleRef = useRef(false)
  const forceStopRef = useRef<(() => void) | null>(null)
  // Identité stable de CETTE instance -- sert à savoir si c'est bien elle
  // qui détient le verrou vocal partagé (lib/voiceSessionLock), et donc si
  // elle peut le libérer / doit refuser de démarrer une nouvelle session
  // pendant qu'une autre (VoiceReportButtons ailleurs dans l'app) tourne.
  const idInstanceRef = useRef<symbol>(Symbol('voice-session-summary'))
  // Vrai dès qu'un arrêt forcé (changement d'écran, démontage) a été
  // déclenché -- vérifié après chaque `await` des chaînes async longues
  // (interpreter, genererResume, demanderClient...) pour cesser
  // immédiatement toute suite du flux plutôt que de continuer à afficher
  // un résultat ou relancer une écoute après que l'utilisateur a quitté
  // l'écran.
  const annulerRef = useRef(false)

  /** Minuscule WAV silencieux généré à la volée -- sert uniquement à
   * "débloquer" l'élément <audio> ci-dessous (voir debloquerAudio). */
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

  /** CORRECTIF lecture auto bloquée par Safari (voir VoiceReportButtons
   * pour le détail) : joue un son silencieux DANS la pile synchrone du
   * clic initial pour débloquer l'élément <audio>, réutilisé ensuite pour
   * toute la session même depuis des contextes asynchrones tardifs. Doit
   * rester la toute première instruction du handler de clic. */
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

  /** Joue un blob audio déjà en mémoire (sans requête réseau) -- utilisé
   * directement quand un blob a été préchargé (voir accueilPrechargeRef
   * et jouerAccueil ci-dessous), sinon appelé en interne par jouerTexte
   * après avoir récupéré l'audio depuis /api/atelier-ai/speak. Réutilise
   * le même élément <audio> débloqué au tap initial plutôt que d'en créer
   * un nouveau (qui retomberait sous le coup de la politique autoplay
   * pour tout appel un peu tardif). */
  async function jouerBlob(blob: Blob) {
    setLectureEnCours(true)
    try {
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

  /** Récupère l'audio depuis /api/atelier-ai/speak puis le joue. Transmet
   * la vitesse de lecture préférée de l'utilisateur à chaque appel -- voir
   * cette route, qui l'applique côté OpenAI TTS. */
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
      setLectureEnCours(false) // jouerBlob remet lectureEnCours à true -- évite un clignotement du bouton Stop
      await jouerBlob(blob)
    } catch {
      // silencieux : le texte reste affiché à l'écran dans tous les cas.
      setLectureEnCours(false)
    }
  }

  /** Clé de cache de l'accueil -- dépend du texte exact (long/court selon
   * "annonce courte"), de la voix et de la vitesse : un changement de
   * n'importe lequel de ces réglages doit invalider le préchargement. */
  function clePrechargeAccueil() {
    return `${annonceCourte ? QUESTION_COURTE : QUESTION}::${voixPreferee}::${vitesseLecture}`
  }

  // CORRECTIF LATENCE : avant ce préchargement, chaque appui sur "Résumé
  // vocal" attendait un aller-retour réseau complet vers OpenAI TTS
  // (génération + transfert de l'audio, 1 à 3s typiquement) avant même de
  // commencer à parler -- tout ce temps, l'utilisateur ne savait pas si
  // son appui avait été pris en compte. La question d'accueil étant un
  // texte fixe et connu à l'avance (long ou court selon "annonce
  // courte"), on la génère et on la garde en mémoire dès que les
  // préférences vocales sont chargées (et à chaque fois qu'elles
  // changent) -- l'appui sur le bouton n'a alors plus qu'à LIRE ce blob
  // déjà prêt, sans aucun aller-retour réseau. Si le préchargement n'a
  // pas encore abouti au moment du tap (ex. réseau lent, premier accès),
  // jouerAccueil() retombe simplement sur le chemin normal (jouerTexte).
  const accueilPrechargeRef = useRef<{ cle: string; blob: Blob } | null>(null)
  useEffect(() => {
    let cancelled = false
    async function precharger() {
      const cle = clePrechargeAccueil()
      try {
        const res = await fetch('/api/atelier-ai/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: annonceCourte ? QUESTION_COURTE : QUESTION, voice: voixPreferee, speed: vitesseLecture }),
        })
        if (!res.ok || cancelled) return
        const blob = await res.blob()
        if (!cancelled) accueilPrechargeRef.current = { cle, blob }
      } catch {
        // silencieux -- jouerAccueil() retombera sur le chemin réseau normal.
      }
    }
    void precharger()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voixPreferee, vitesseLecture, annonceCourte])

  /** Joue la question d'accueil -- instantanément si le préchargement a
   * abouti pour les réglages actuels, sinon via le chemin réseau normal. */
  async function jouerAccueil() {
    const cle = clePrechargeAccueil()
    const precharge = accueilPrechargeRef.current
    if (precharge && precharge.cle === cle) {
      await jouerBlob(precharge.blob)
      return
    }
    await jouerTexte(annonceCourte ? QUESTION_COURTE : QUESTION)
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

  /** "Stop" complet et immédiat de la session en cours, quelle que soit
   * l'étape actuelle -- coupe le micro, l'enregistreur et toute lecture
   * audio, empêche la suite du flux de continuer (annulerRef, vérifié
   * après chaque await dans poserLaQuestion/interpreter/genererResume/
   * demanderClient/interpreterClient/resoudreClientEtLire/
   * genererDernierCompteRendu), libère le verrou vocal partagé, puis
   * revient à l'état de repos. Utilisée à la fois pour un arrêt manuel
   * éventuel et pour la coupure automatique au changement d'écran
   * ci-dessous. */
  function arreterCompletement() {
    annulerRef.current = true
    try { forceStopRef.current?.() } catch {}
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
    } catch {}
    try { streamRef.current?.getTracks().forEach((t) => t.stop()) } catch {}
    arreterLecture()
    libererVerrouVocal(idInstanceRef.current)
    fermer()
  }

  // Nettoyage au démontage : si cette instance détient encore le verrou
  // (navigation pendant une écoute active), on coupe micro/enregistreur/
  // lecture en cours et on le libère -- sinon une session orpheline
  // bloquerait indéfiniment VoiceReportButtons ailleurs dans l'app.
  useEffect(() => {
    return () => {
      if (verrouVocalDetenuPar(idInstanceRef.current)) {
        annulerRef.current = true
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

  // Changement d'écran (route Next.js) : coupe immédiatement toute session
  // vocale ACTIVE pour cette instance -- micro, enregistreur, lecture,
  // verrou -- sans attendre un éventuel démontage différé du composant
  // (ex. shell d'app qui garde les écrans en mémoire). Sans effet si
  // aucune session n'était en cours.
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

  function mimeTypeSupporte() {
    if (typeof MediaRecorder === 'undefined') return ''
    if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
    if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
    return ''
  }

  /** Enregistrement mains libres : démarre le micro et s'arrête TOUT SEUL
   * dès qu'un silence d'environ 1,3s suit un moment de parole détecté --
   * pas de bouton "stop" requis. `forceStopRef` permet de forcer l'arrêt
   * plus tôt en tapant l'indicateur à l'écran, en secours. Filet de
   * sécurité à 12s pour ne jamais rester bloqué. */
  async function enregistrerAvecDetectionSilence(stopRef?: { current: (() => void) | null }): Promise<Blob> {
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
      if (stopRef) stopRef.current = terminer
    })
  }

  /** Lance (ou relance) le cycle conversationnel : question -> écoute
   * mains libres -> interprétation. */
  async function poserLaQuestion() {
    // Refuse de démarrer si une autre session vocale (VoiceReportButtons
    // ailleurs dans l'app -- tâche, compte-rendu) tourne déjà -- évite
    // deux micros/lectures TTS en parallèle.
    if (verrouVocalDetenuParAutre(idInstanceRef.current)) {
      setEtape('erreur')
      setErreur("Une écoute est déjà en cours ailleurs dans l'application. Arrête-la avant d'en démarrer une nouvelle.")
      return
    }

    // Doit être la toute première instruction, avant tout `await`.
    debloquerAudio()

    annulerRef.current = false
    acquerirVerrouVocal(idInstanceRef.current)

    setTexte('')
    setMessageIncompris('')
    setErreur('')
    setModeClient(false)
    try {
      setEtape('question')
      // "Annonce courte" (réglage utilisateur) : question d'accueil
      // raccourcie -- ne touche à rien d'autre (relances, compte-rendu).
      // jouerAccueil() utilise le blob préchargé si disponible (latence
      // quasi nulle) -- voir accueilPrechargeRef plus haut.
      await jouerAccueil()
      if (annulerRef.current) return // écran quitté pendant l'annonce
      setEtape('ecoute')
      const blobBrut = await enregistrerAvecDetectionSilence(forceStopRef)
      if (annulerRef.current) return
      await interpreter(blobBrut)
    } catch (e: any) {
      libererVerrouVocal(idInstanceRef.current)
      setEtape('erreur')
      setErreur(e?.message || 'Une erreur est survenue.')
    }
  }

  async function interpreter(blobBrut: Blob) {
    try {
      setEtape('traitement')
      const blobWav = await convertirEnWav(blobBrut)
      if (annulerRef.current) return

      const form = new FormData()
      form.append('audio', blobWav, 'audio.wav')
      const res = await fetch('/api/atelier-ai/transcribe', { method: 'POST', body: form })
      const data = await res.json()
      if (annulerRef.current) return
      if (!res.ok) throw new Error(data?.error || 'Erreur de transcription.')

      const choix = await interpreterDemande(data.transcript || '')
      if (annulerRef.current) return
      if (!choix) {
        setMessageIncompris(
          `Je n'ai pas compris "${data.transcript || '...'}". Dis par exemple "mes tâches", "mes prochains rendez-vous", "mon chiffre d'affaires d'aujourd'hui", "mes derniers devis de plus de 15000 euros", "le compte-rendu d'un client", ou "mes alertes".`,
        )
        setEtape('incompris')
        await jouerTexte("Je n'ai pas bien compris. Peux-tu répéter ?")
        if (annulerRef.current) return
        setEtape('ecoute')
        const blobRetente = await enregistrerAvecDetectionSilence(forceStopRef)
        if (annulerRef.current) return
        await interpreter(blobRetente)
        return
      }

      if (choix.intent === 'compte_rendu') {
        await demanderClient()
        return
      }

      await genererResume(choix.intent, choix.params)
    } catch (e: any) {
      libererVerrouVocal(idInstanceRef.current)
      setEtape('erreur')
      setErreur(e?.message || 'Une erreur est survenue.')
    }
  }

  /** Résout le nom d'entreprise lié à chaque RDV (crm_activity_company ->
   * partner_base_partner.company_name), même logique que MobileRdv.tsx --
   * en 2 requêtes batch, jamais bloquant (repli silencieux sur "sans
   * entreprise associée" en cas d'erreur ou d'absence de lien). */
  async function resoudreEntreprisesRdv(rows: { id: number }[]): Promise<Map<number, string>> {
    const companyByActivity = new Map<number, string>()
    try {
      const activityIds = rows.map((r) => r.id).filter((v) => v !== null && v !== undefined)
      if (activityIds.length === 0) return companyByActivity

      const { data: links } = await supabase
        .from('crm_activity_company')
        .select('activity_fk, company_fk')
        .in('activity_fk', activityIds)

      const companyIds = Array.from(
        new Set(((links || []) as any[]).map((l) => l.company_fk).filter((v) => v !== null && v !== undefined)),
      )
      if (companyIds.length === 0) return companyByActivity

      const { data: companies } = await supabase
        .from('partner_base_partner')
        .select('id, company_name')
        .in('id', companyIds)

      const nameById = new Map(((companies || []) as any[]).map((c) => [c.id, String(c.company_name || '').trim()]))
      ;((links || []) as any[]).forEach((l) => {
        const name = nameById.get(l.company_fk)
        if (name) companyByActivity.set(l.activity_fk, name)
      })
    } catch (e) {
      console.warn('[MobileHomeSummary] résolution entreprise liée impossible :', e)
    }
    return companyByActivity
  }

  async function genererResume(portee: Intent, params: IntentParams = {}) {
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

      if (portee === 'rdv' || portee === 'rdv_prochains') {
        if (!access?.blg_partner_id) throw new Error('Identifiant partner BLG non renseigné pour ce compte.')
        // "rdv" (mots-clés simples, sans nombre précisé) garde le
        // comportement historique (10) ; "rdv_prochains" (via le modèle)
        // porte le nombre dicté par la personne, ex. "mes 3 prochains rdv".
        const n = portee === 'rdv_prochains' ? Math.max(1, Math.min(30, Math.round(Number(params.n) || 5))) : 10

        const { data: rows, error } = await supabase
          .from('crm_base_activity')
          .select('id, type, comment, start_date')
          .eq('internal_tag', 'normal')
          .in('type', RDV_TYPE_KEYS)
          .eq('from_fk', access.blg_partner_id)
          .gte('start_date', new Date().toISOString())
          .order('start_date', { ascending: true })
          .limit(n)
        if (error) throw error

        if (!rows || rows.length === 0) {
          resultat = "Tu n'as aucun rendez-vous à venir."
        } else {
          const entreprisesParActivite = await resoudreEntreprisesRdv(rows as any[])
          const lignes = rows.map((r: any, i: number) => {
            const d = new Date(r.start_date)
            const dateLabel = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
            const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            const entreprise = entreprisesParActivite.get(r.id) || 'sans entreprise associée'
            return `${i + 1}. ${dateLabel} à ${heure} — ${entreprise}`
          })
          const compte = rows.length === 1 ? 'un' : String(rows.length)
          resultat = `Voici tes ${compte} prochain${rows.length > 1 ? 's' : ''} rendez-vous :\n${lignes.join('\n')}`
        }
      } else if (portee === 'rdv_semaine_prochaine') {
        if (!access?.blg_partner_id) throw new Error('Identifiant partner BLG non renseigné pour ce compte.')

        const debut = debutSemaineProchaineIso()
        const fin = finSemaineProchaineIso()

        const { data: rows, error } = await supabase
          .from('crm_base_activity')
          .select('id, type, comment, start_date')
          .eq('internal_tag', 'normal')
          .in('type', RDV_TYPE_KEYS)
          .eq('from_fk', access.blg_partner_id)
          .gte('start_date', `${debut}T00:00:00`)
          .lte('start_date', `${fin}T23:59:59`)
          .order('start_date', { ascending: true })
          .limit(20)
        if (error) throw error

        if (!rows || rows.length === 0) {
          resultat = "Tu n'as aucun rendez-vous prévu la semaine prochaine."
        } else {
          const entreprisesParActivite = await resoudreEntreprisesRdv(rows as any[])
          const lignes = rows.map((r: any, i: number) => {
            const d = new Date(r.start_date)
            const dateLabel = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
            const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            const entreprise = entreprisesParActivite.get(r.id) || 'sans entreprise associée'
            return `${i + 1}. ${dateLabel} à ${heure} — ${entreprise}`
          })
          const compte = rows.length === 1 ? 'un' : String(rows.length)
          resultat = `Tu as ${compte} rendez-vous${rows.length > 1 ? '' : ''} la semaine prochaine :\n${lignes.join('\n')}`
        }
      } else if (portee === 'jour' || portee === 'semaine') {
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
      } else if (portee === 'semaine_prochaine') {
        // Vraie plage de dates (lundi -> dimanche prochain), contrairement
        // à jour/semaine qui incluent aussi le retard -- ici on ne veut
        // QUE la semaine prochaine, pas le passé.
        const identities = Array.from(new Set([email, displayName]))
        const assignedFilter = identities.map((v) => `assigned_to.eq.${v.replace(/,/g, '\\,')}`).join(',')
        const debut = debutSemaineProchaineIso()
        const fin = finSemaineProchaineIso()

        const { data: rows, error } = await supabase
          .from('todo_actions')
          .select('description_action, due_date')
          .or(assignedFilter)
          .not('status', 'in', '("Terminé","Annulé")')
          .gte('due_date', debut)
          .lte('due_date', fin)
          .order('due_date', { ascending: true })
          .limit(30)
        if (error) throw error

        if (!rows || rows.length === 0) {
          resultat = "Tu n'as aucune tâche prévue la semaine prochaine."
        } else {
          const lignes = rows.map((r: any, i: number) => {
            const echeance = formatDateParlee(r.due_date)
            return `${i + 1}. ${safeText(r.description_action) || '(sans libellé)'}${echeance ? `, échéance ${echeance}` : ''}`
          })
          const compte = rows.length === 1 ? 'une' : String(rows.length)
          resultat = `Tu as ${compte} tâche${rows.length > 1 ? 's' : ''} prévue${rows.length > 1 ? 's' : ''} la semaine prochaine :\n${lignes.join('\n')}`
        }
      } else if (portee === 'taches_prochaines') {
        // "Mes Y tâches à réaliser" -- nombre dicté, triées par échéance,
        // SANS borne de date (contrairement à jour/semaine qui bornent à
        // aujourd'hui/fin de semaine) : les Y prochaines tâches, point.
        const n = Math.max(1, Math.min(30, Math.round(Number(params.n) || 5)))
        const identities = Array.from(new Set([email, displayName]))
        const assignedFilter = identities.map((v) => `assigned_to.eq.${v.replace(/,/g, '\\,')}`).join(',')

        const { data: rows, error } = await supabase
          .from('todo_actions')
          .select('description_action, due_date')
          .or(assignedFilter)
          .not('status', 'in', '("Terminé","Annulé")')
          .order('due_date', { ascending: true, nullsFirst: false })
          .limit(n)
        if (error) throw error

        if (!rows || rows.length === 0) {
          resultat = "Tu n'as aucune tâche en cours."
        } else {
          const lignes = rows.map((r: any, i: number) => {
            const echeance = formatDateParlee(r.due_date)
            return `${i + 1}. ${safeText(r.description_action) || '(sans libellé)'}${echeance ? `, échéance ${echeance}` : ', sans échéance'}`
          })
          const compte = rows.length === 1 ? 'ta' : `tes ${rows.length}`
          resultat = `Voici ${compte} prochaine${rows.length > 1 ? 's' : ''} tâche${rows.length > 1 ? 's' : ''} :\n${lignes.join('\n')}`
        }
      } else if (portee === 'ca_periode') {
        // "Quel CA ai-je fait hier/aujourd'hui/depuis le début du mois
        // (sur telle famille) ?" -- s'appuie sur la RPC déjà utilisée
        // ailleurs dans l'app (get_ca_periode_par_famille), filtrée côté
        // client sur la famille si demandée (rapprochement tolérant, la
        // personne ne dicte jamais le code exact "R/R").
        const aujourdHui = new Date()
        aujourdHui.setHours(0, 0, 0, 0)
        let dateDebut: Date
        let dateFin: Date
        let periodeTexte: string
        if (params.periode === 'hier') {
          dateDebut = new Date(aujourdHui); dateDebut.setDate(dateDebut.getDate() - 1)
          dateFin = dateDebut
          periodeTexte = 'hier'
        } else if (params.periode === 'mois') {
          dateDebut = new Date(aujourdHui.getFullYear(), aujourdHui.getMonth(), 1)
          dateFin = aujourdHui
          periodeTexte = 'depuis le début du mois'
        } else {
          dateDebut = aujourdHui
          dateFin = aujourdHui
          periodeTexte = "aujourd'hui"
        }

        const { data: rows, error } = await supabase.rpc('get_ca_periode_par_famille', {
          p_date_debut: isoDepuisDateLocale(dateDebut),
          p_date_fin: isoDepuisDateLocale(dateFin),
          p_collaborateur: null,
        })
        if (error) throw error

        const toutesLesFamilles = (rows || []) as { famille_macro: string; montant_ht: number }[]
        const familleDemandee = safeText(params.famille)
        const familleRapprochee = familleDemandee ? rapprocherFamille(familleDemandee) : null

        if (familleRapprochee) {
          const ligne = toutesLesFamilles.find((r) => normaliser(r.famille_macro) === normaliser(familleRapprochee))
          const montant = Number(ligne?.montant_ht || 0)
          resultat = `Ton chiffre d'affaires ${periodeTexte} sur ${familleRapprochee} est de ${formatMontantParle(montant)}.`
        } else {
          const total = toutesLesFamilles.reduce((s, r) => s + Number(r.montant_ht || 0), 0)
          if (toutesLesFamilles.length === 0) {
            resultat = `Aucun chiffre d'affaires enregistré ${periodeTexte}.`
          } else {
            const detail = toutesLesFamilles
              .filter((r) => Math.abs(Number(r.montant_ht || 0)) > 0.01)
              .sort((a, b) => Number(b.montant_ht) - Number(a.montant_ht))
              .map((r) => `${r.famille_macro} : ${formatMontantParle(Number(r.montant_ht))}`)
              .join(', ')
            resultat = `Ton chiffre d'affaires ${periodeTexte} est de ${formatMontantParle(total)}${detail ? `, dont ${detail}` : ''}.`
          }
        }
      } else if (portee === 'devis_montant') {
        // "Les N derniers devis de plus de X euros" -- RPC dédiée
        // (get_devis_recents_montant_min), qui agrège par pièce côté base
        // plutôt que ligne par ligne (numero_tiers_entete est très
        // souvent vide sur les devis -- la RPC utilise numero_tiers_ligne).
        const n = Math.max(1, Math.min(20, Math.round(Number(params.n) || 10)))
        const montantMin = Math.max(0, Number(params.montant_min) || 15000)

        const { data: rows, error } = await supabase.rpc('get_devis_recents_montant_min', {
          p_montant_min: montantMin,
          p_limit: n,
        })
        if (error) throw error

        if (!rows || rows.length === 0) {
          resultat = `Aucun devis de plus de ${formatMontantParle(montantMin)} trouvé.`
        } else {
          const lignes = (rows as any[]).map((r, i) => {
            const dateLabel = formatDateParlee(r.date_devis)
            const client = safeText(r.intitule) || safeText(r.numero_tiers) || 'client non renseigné'
            return `${i + 1}. ${client}${dateLabel ? `, ${dateLabel}` : ''} — ${formatMontantParle(Number(r.montant))}`
          })
          resultat = `Voici les ${rows.length} derniers devis de plus de ${formatMontantParle(montantMin)} :\n${lignes.join('\n')}`
        }
      } else if (portee === 'rdv_sans_compte_rendu') {
        // "Combien de rdv passés ces N derniers jours n'ont pas de
        // compte-rendu ?" -- v_rdv_unifie porte déjà a_compte_rendu
        // (fusion BLG + compagnon CEGECLIM), pas besoin de RPC dédiée.
        const jours = Math.max(1, Math.min(90, Math.round(Number(params.jours) || 7)))
        const depuis = new Date()
        depuis.setDate(depuis.getDate() - jours)

        const { data: rows, error } = await supabase
          .from('v_rdv_unifie')
          .select('subject, company_name, start_date, a_compte_rendu')
          .lt('start_date', new Date().toISOString())
          .gte('start_date', depuis.toISOString())
          .order('start_date', { ascending: false })
          .limit(200)
        if (error) throw error

        const sansCr = ((rows || []) as any[]).filter((r) => !r.a_compte_rendu)

        if (sansCr.length === 0) {
          resultat = `Tous les rendez-vous des ${jours} derniers jours ont un compte-rendu.`
        } else {
          const lignes = sansCr.slice(0, 10).map((r, i) => {
            const d = new Date(r.start_date)
            const dateLabel = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
            const entreprise = safeText(r.company_name) || 'sans entreprise associée'
            return `${i + 1}. ${dateLabel} — ${entreprise}`
          })
          const suffixe = sansCr.length > 10 ? `\n… et ${sansCr.length - 10} de plus` : ''
          resultat = `${sansCr.length} rendez-vous des ${jours} derniers jours n'ont pas de compte-rendu :\n${lignes.join('\n')}${suffixe}`
        }
      } else if (portee === 'alertes') {
        // (AppShell) et le hook useMobileAlertsCount, mais réinterrogée
        // ici directement -- ce composant n'a pas accès à ce hook (arbre
        // de composants différent).
        const alertesTexte: string[] = []

        try {
          const { data: cdcRows } = await supabase
            .from('v_portefeuille_livraison_lignes')
            .select('type_document,numero_document,numero_tiers')
            .eq('type_document', 'CDC')
            .or('mois_livraison.eq.AVANT_2026,date_livraison.lt.2026-01-01')
            .limit(50000)
          const distinctCdc = new Set(
            (cdcRows || []).map((r: any) => [r.type_document, r.numero_document, r.numero_tiers].map((v) => String(v ?? '').trim()).join('::')),
          )
          if (distinctCdc.size > 0) alertesTexte.push(`${distinctCdc.size} CDC avec livraison avant 2026`)
        } catch { /* signal optionnel, on continue même s'il échoue */ }

        try {
          const { data: fraisPortRows } = await supabase
            .from('v_controle_frais_port_groupes')
            .select('statut_groupe,nb_bl_a_supprimer')
            .neq('statut_groupe', 'OK')
            .limit(20000)
          const rows = fraisPortRows || []
          const manquants = rows.filter((r: any) => String(r.statut_groupe || '').trim() === 'FRAIS_PORT_MANQUANT').length
          const blASupprimer = rows.reduce((s: number, r: any) => s + Number(r.nb_bl_a_supprimer || 0), 0)
          const total = manquants + blASupprimer
          if (total > 0) alertesTexte.push(`${total} écart${total > 1 ? 's' : ''} sur le contrôle des frais de port`)
        } catch { /* idem */ }

        try {
          const { data: gazRows } = await supabase.rpc('get_client_certification_alert_rows', { p_kind: 'capacite', p_limit: 10000 })
          const rows = gazRows || []
          if (rows.length > 0) {
            const expirees = rows.filter((r: any) => String(r.alert_status || '').toLowerCase() === 'expired').length
            alertesTexte.push(`${rows.length} capacité${rows.length > 1 ? 's' : ''} gaz à surveiller${expirees > 0 ? `, dont ${expirees} déjà expirée${expirees > 1 ? 's' : ''}` : ''}`)
          }
        } catch { /* idem */ }

        resultat = alertesTexte.length === 0
          ? "Aucune alerte en cours. Tout est propre."
          : `Voici tes alertes en cours :\n${alertesTexte.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
      } else {
        // Filet de sécurité TypeScript -- ne devrait jamais arriver, tous
        // les intents connus étant couverts ci-dessus.
        resultat = "Je n'ai pas su traiter cette demande."
      }

      setTexte(resultat)
      setEtape('resultat')
      // Fin de l'activité micro/écriture pour cette demande -- le verrou
      // est libéré ici (avant même la lecture du résultat) pour ne pas
      // bloquer inutilement une autre session ailleurs pendant que
      // l'utilisateur lit/écoute simplement la réponse.
      libererVerrouVocal(idInstanceRef.current)
      await jouerTexte(resultat)
    } catch (e: any) {
      libererVerrouVocal(idInstanceRef.current)
      setEtape('erreur')
      setErreur(e?.message || 'Erreur inattendue.')
    }
  }

  function fermer() {
    libererVerrouVocal(idInstanceRef.current)
    setEtape('idle')
    setTexte('')
    setMessageIncompris('')
    setErreur('')
    setModeClient(false)
  }

  /** Sous-flux "compte-rendu d'un client" : demande le nom/numéro à la
   * voix, cherche le client correspondant, puis lit son dernier
   * compte-rendu en précisant bien numéro + nom (demande explicite).
   * Volontairement PAS concerné par "annonce courte" -- cf. en-tête du
   * composant. */
  async function demanderClient() {
    setMessageIncompris('')
    setSaisieClientTexte('')
    setModeClient(true)
    try {
      setEtape('question_client')
      await jouerTexte('De quel client veux-tu le dernier compte-rendu ? Dis son nom ou son numéro.')
      if (annulerRef.current) return
      setEtape('ecoute_client')
      const blob = await enregistrerAvecDetectionSilence(forceStopRef)
      if (annulerRef.current) return
      await interpreterClient(blob)
    } catch (e: any) {
      libererVerrouVocal(idInstanceRef.current)
      setEtape('erreur')
      setErreur(e?.message || 'Une erreur est survenue.')
    }
  }

  async function rechercherClient(texte: string): Promise<{ numero: string; nom: string }[]> {
    const q = texte.trim()
    if (!q) return []

    // Essai 1 : numéro dicté ("C zéro cent soixante-deux") converti en
    // chiffres ("C0162") avant recherche -- Whisper transcrit les nombres
    // en toutes lettres, jamais en chiffres, donc une recherche brute sur
    // le texte parlé ne matchait jamais un vrai numéro de tiers.
    const numeroConverti = motsVersNumeroClient(q)
    if (numeroConverti) {
      const { data: parNumero } = await supabase
        .from('ref_tiers')
        .select('numero, intitule')
        .ilike('numero', `${numeroConverti}%`)
        .limit(5)
      if (parNumero && parNumero.length > 0) {
        return parNumero.map((r: any) => ({ numero: safeText(r.numero), nom: safeText(r.intitule) }))
      }

      // La lettre de préfixe est la partie la plus fragile de la
      // reconnaissance vocale (une lettre isolée est facilement confondue
      // avec un mot -- "C" / "c'est", etc.) : si le numéro complet ne
      // matche rien, on retente sur les CHIFFRES seuls, où qu'ils soient
      // dans le numéro, en ignorant une lettre de préfixe potentiellement
      // mal transcrite.
      const chiffresSeuls = numeroConverti.replace(/[^0-9]/g, '')
      if (chiffresSeuls.length >= 2) {
        const { data: parChiffres } = await supabase
          .from('ref_tiers')
          .select('numero, intitule')
          .ilike('numero', `%${chiffresSeuls}%`)
          .limit(5)
        if (parChiffres && parChiffres.length > 0) {
          return parChiffres.map((r: any) => ({ numero: safeText(r.numero), nom: safeText(r.intitule) }))
        }
      }
    }

    // Essai 2 : numéro tel quel (au cas où le transcript contiendrait déjà
    // des chiffres, ex. dictée avec Siri/clavier vocal qui écrit "0162").
    const { data: parNumeroBrut } = await supabase
      .from('ref_tiers')
      .select('numero, intitule')
      .ilike('numero', `${q}%`)
      .limit(5)
    if (parNumeroBrut && parNumeroBrut.length > 0) {
      return parNumeroBrut.map((r: any) => ({ numero: safeText(r.numero), nom: safeText(r.intitule) }))
    }

    // Essai 3 : recherche par nom, PAR SCORE plutôt que par correspondance
    // exacte de tous les mots -- la transcription vocale d'un nom propre
    // (ex. "Cuburu") peut différer légèrement de l'orthographe réelle
    // (accents, doublons de lettres...). On récupère un lot de candidats
    // sur CHAQUE mot significatif pris séparément (OR), puis on classe
    // côté client par nombre de mots effectivement retrouvés -- le
    // meilleur candidat remonte en premier même sans correspondance
    // parfaite sur 100% des mots dictés.
    const motsSignificatifs = normaliser(q).split(/\s+/).filter((m) => m.length >= 3)
    if (motsSignificatifs.length === 0) return []

    const orFilter = motsSignificatifs.map((mot) => `intitule.ilike.%${mot}%`).join(',')
    const { data: candidats } = await supabase
      .from('ref_tiers')
      .select('numero, intitule')
      .or(orFilter)
      .limit(30)

    if (!candidats || candidats.length === 0) return []

    const scored = candidats.map((r: any) => {
      const intituleNorm = normaliser(safeText(r.intitule))
      const score = motsSignificatifs.filter((mot) => intituleNorm.includes(mot)).length
      return { numero: safeText(r.numero), nom: safeText(r.intitule), score }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 5).map(({ numero, nom }) => ({ numero, nom }))
  }

  /** Logique commune, partagée entre la reconnaissance vocale et la
   * saisie manuelle : cherche le client à partir d'un texte déjà obtenu,
   * et enchaîne sur la lecture de son dernier compte-rendu. */
  async function resoudreClientEtLire(texteEntendu: string, viaVoix: boolean) {
    const resultats = await rechercherClient(texteEntendu)
    if (annulerRef.current) return

    if (resultats.length === 0) {
      setMessageIncompris(`Je n'ai trouvé aucun client correspondant à "${texteEntendu || '...'}".`)
      if (!viaVoix) {
        // Saisie manuelle : on reste sur le formulaire, pas de redemande vocale.
        setEtape('question_client')
        return
      }
      setEtape('incompris')
      await jouerTexte("Je n'ai trouvé aucun client correspondant. Peux-tu redire le nom ou le numéro ?")
      if (annulerRef.current) return
      setEtape('ecoute_client')
      const blobRetente = await enregistrerAvecDetectionSilence(forceStopRef)
      if (annulerRef.current) return
      await interpreterClient(blobRetente)
      return
    }

    // Plusieurs clients possibles : on prend le premier (meilleur score/
    // préfixe) mais on l'annonce clairement pour que l'utilisateur puisse
    // se rendre compte d'une erreur d'aiguillage.
    await genererDernierCompteRendu(resultats[0])
  }

  async function chercherClientManuellement() {
    const texte = saisieClientTexte.trim()
    if (!texte) return
    setSaisieClientEnCours(true)
    setMessageIncompris('')
    try {
      setEtape('traitement_client')
      await resoudreClientEtLire(texte, false)
    } catch (e: any) {
      setEtape('erreur')
      setErreur(e?.message || 'Une erreur est survenue.')
    } finally {
      setSaisieClientEnCours(false)
    }
  }

  async function interpreterClient(blobBrut: Blob) {
    try {
      setEtape('traitement_client')
      const blobWav = await convertirEnWav(blobBrut)
      if (annulerRef.current) return

      const form = new FormData()
      form.append('audio', blobWav, 'audio.wav')
      const res = await fetch('/api/atelier-ai/transcribe', { method: 'POST', body: form })
      const data = await res.json()
      if (annulerRef.current) return
      if (!res.ok) throw new Error(data?.error || 'Erreur de transcription.')

      const texteEntendu = String(data.transcript || '').trim()
      await resoudreClientEtLire(texteEntendu, true)
    } catch (e: any) {
      libererVerrouVocal(idInstanceRef.current)
      setEtape('erreur')
      setErreur(e?.message || 'Une erreur est survenue.')
    }
  }

  async function genererDernierCompteRendu(client: { numero: string; nom: string }) {
    try {
      const { data, error } = await supabase
        .from('client_comptes_rendus')
        .select('resume, created_at')
        .eq('numero_tiers', client.numero)
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw error

      let resultat = ''
      if (!data || data.length === 0) {
        resultat = `Aucun compte-rendu enregistré pour ${client.nom || client.numero} (numéro ${client.numero}).`
      } else {
        const cr = data[0] as any
        const dateTexte = formatDateParlee(cr.created_at)
        resultat = `Dernier compte-rendu de ${client.nom || '(nom inconnu)'}, numéro ${client.numero}${dateTexte ? `, du ${dateTexte}` : ''} :\n${safeText(cr.resume)}`
      }

      setTexte(resultat)
      setEtape('resultat')
      libererVerrouVocal(idInstanceRef.current)
      await jouerTexte(resultat)
    } catch (e: any) {
      libererVerrouVocal(idInstanceRef.current)
      setEtape('erreur')
      setErreur(e?.message || 'Erreur inattendue.')
    }
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
          {(etape === 'question' || etape === 'traitement' || etape === 'question_client' || etape === 'traitement_client') && (
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', textAlign: 'center', padding: '20px 0' }}>
              {etape === 'question' || etape === 'question_client' ? "L'agent parle…" : 'Interprétation…'}
            </div>
          )}

          {(etape === 'ecoute' || etape === 'ecoute_client') && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '18px 0' }}>
              {messageIncompris && (
                <div style={{ fontSize: 13.5, color: '#e0a685', textAlign: 'center', lineHeight: 1.5 }}>{messageIncompris}</div>
              )}
              <button
                type="button"
                onClick={() => forceStopRef.current?.()}
                aria-label="Forcer l'arrêt de l'écoute (facultatif, ça s'arrête normalement tout seul)"
                style={{
                  width: 116, height: 116, borderRadius: '50%', border: '2px solid rgba(63,145,66,0.6)',
                  background: 'rgba(63,145,66,0.20)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 46, cursor: 'pointer', animation: 'cgcPulseSummary 1.1s ease-in-out infinite',
                }}
              >
                🎙️
              </button>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: '#8fd4a8', textAlign: 'center' }}>
                {etape === 'ecoute_client' ? "Je t'écoute… dis le nom ou le numéro du client" : "Je t'écoute… je m'arrête tout seul dès que tu as fini"}
              </div>
              <style>{`@keyframes cgcPulseSummary { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.06); opacity: 0.75; } }`}</style>
            </div>
          )}

          {erreur && (
            <div style={{ fontSize: 14, color: '#e0a685' }}>{erreur}</div>
          )}

          {modeClient && etape !== 'resultat' && etape !== 'erreur' && etape !== 'traitement_client' && (
            <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.5)' }}>
                La voix pas fiable pour un nom ou un numéro précis ? Tape-le directement :
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={saisieClientTexte}
                  onChange={(e) => setSaisieClientTexte(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void chercherClientManuellement() }}
                  placeholder="Nom ou numéro (ex. C0162)"
                  style={{ flex: 1, height: 44, borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', padding: '0 12px', fontSize: 14.5 }}
                />
                <button
                  type="button"
                  onClick={() => void chercherClientManuellement()}
                  disabled={saisieClientEnCours || !saisieClientTexte.trim()}
                  style={{ padding: '0 18px', borderRadius: 10, border: 'none', background: '#A6A181', color: '#141A26', fontSize: 14, fontWeight: 700 }}
                >
                  {saisieClientEnCours ? '…' : 'OK'}
                </button>
              </div>
            </div>
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
