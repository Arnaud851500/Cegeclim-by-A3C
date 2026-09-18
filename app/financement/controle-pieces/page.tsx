'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'

// Relecteur de pièces CEE : reprend l'outil autonome (Artifact HTML
// "Relecteur de pièces CEE") sous forme de page intégrée à l'application,
// réservée aux personnes ayant can_financement. La checklist par type de
// pièce est partagée (table cee_controle_checklists, éditable via "Modifier
// la checklist") ; la relecture par IA et la rédaction du mail passent par
// /api/financement/controle-pieces/* (clé OpenAI côté serveur uniquement).
//
// Le contrôle peut être rattaché à un dossier CEE ouvert (appairage
// automatique sur le nom du bénéficiaire, liste déroulante en secours) puis
// capitalisé : ligne dans cee_controles, statut de la pièce dans
// cee_dossier_pieces, note dans cee_notes_dimensionnement le cas échéant,
// état / points bloquants du dossier mis à jour. L'avancement d'étape reste
// une décision humaine sur la fiche dossier.

type TypePieceId = 'avis_imposition' | 'note_dimensionnement' | 'devis' | 'facture'

type TypeMeta = { id: TypePieceId; label: string; code: string; art: string; the: string; of: string }

const TYPES: TypeMeta[] = [
  { id: 'avis_imposition', label: "Avis d'imposition", code: 'AVIS', art: "un avis d'imposition", the: "L'avis d'imposition", of: "de l'avis d'imposition" },
  { id: 'note_dimensionnement', label: 'Note de dimensionnement', code: 'NOTE', art: 'une note de dimensionnement', the: 'La note de dimensionnement', of: 'de la note de dimensionnement' },
  { id: 'devis', label: 'Devis', code: 'DEVIS', art: 'un devis', the: 'Le devis', of: 'du devis' },
  { id: 'facture', label: 'Facture', code: 'FACT', art: 'une facture', the: 'La facture', of: 'de la facture' },
]

const STATUS_LABEL: Record<'c' | 'nc' | 'na', string> = { c: 'Conforme', nc: 'Non conforme', na: 'N/A' }

// Étape du dossier à laquelle se rattache chaque type de pièce, utilisée si
// aucune ligne de cee_pieces_types ne correspond (voir pieceTypeFor).
const ETAPE_PAR_TYPE: Record<TypePieceId, string> = {
  avis_imposition: 'pieces_obligatoires',
  note_dimensionnement: 'note_dimensionnement',
  devis: 'demande_deposee',
  facture: 'preuves_chantier',
}

// Mots-clés pour retrouver la ligne de cee_pieces_types (code ou libellé)
// correspondant au type de pièce contrôlé.
const MOTS_CLES_PIECE: Record<TypePieceId, string[][]> = {
  avis_imposition: [['avis', 'imposition'], ['avis']],
  note_dimensionnement: [['dimensionnement']],
  devis: [['devis']],
  facture: [['facture']],
}

const ETAT_LABEL: Record<string, string> = { pret: 'Prêt', a_corriger: 'À corriger', bloque: 'Bloqué' }

type ChecklistItem = { id: string; label: string; hint?: string }

// Texte intégral de la mention CEE Drapo attendue sur les devis (transmis à
// l'IA via la précision du point « Encadré mention CEE »).
const MENTION_CEE_DRAPO =
  'En acceptant le présent document, j’atteste sur l’honneur avoir reçu du professionnel partenaire de DRAPO (810 694 398), les conseils adaptés à mes besoins d’économies d’énergie et délègue l’exclusivité de l’obtention des Certificats d’Économies d’Énergie à DRAPO en contrepartie d’une Prime Bénéficiaire dont le montant est indiqué sur ce document. Le montant de la Prime Bénéficiaire est déduit du montant total TTC. J’atteste également que le professionnel a réalisé une visite préalable du bâtiment et avoir reçu le document Cadre Contribution signé par le professionnel.'

// Checklists par défaut : utilisées tant que personne n'a personnalisé la
// checklist partagée pour ce type de pièce, et comme base de pré-remplissage
// à l'ouverture de l'éditeur. Jamais écrites automatiquement en base : elles
// ne deviennent la checklist "officielle" que si un humain clique sur
// Enregistrer.
const DEFAULT_CHECKLISTS: Record<TypePieceId, { items: ChecklistItem[]; exempleMail: string }> = {
  avis_imposition: {
    items: [
      { id: 'identite_foyer', label: 'Identité et adresse du foyer fiscal', hint: 'Doit correspondre au bénéficiaire du dossier (nom, prénom, adresse).' },
      { id: 'annee_revenus', label: "Année des revenus / de l'avis", hint: "Avis le plus récent disponible (en général n-2 par rapport à la date de la demande, n-1 en fin d'année)." },
      { id: 'rfr', label: 'Revenu fiscal de référence (RFR)', hint: 'Valeur chiffrée et lisible ; sert à déterminer le classement précarité / grande précarité / classique.' },
      { id: 'nombre_parts', label: 'Nombre de parts du foyer fiscal', hint: 'Nécessaire avec le RFR pour vérifier le classement selon le barème en vigueur.' },
      { id: 'reference_avis', label: "Référence / numéro fiscal de l'avis", hint: "Permet de vérifier l'authenticité du document." },
      { id: 'composition_foyer', label: 'Composition du foyer cohérente', hint: 'Les personnes à charge et la situation familiale doivent correspondre au dossier.' },
    ],
    exempleMail: '',
  },
  note_dimensionnement: {
    items: [
      { id: 'identification_logement', label: 'Identification du logement', hint: 'Adresse du chantier, type de logement, surface, année de construction.' },
      { id: 'calcul_deperditions', label: 'Calcul chiffré (déperditions / puissance)', hint: "Méthode de calcul reconnue avec un résultat chiffré (kW, W) : une conclusion sans calcul n'est pas suffisante." },
      { id: 'coherence_equipement', label: "Préconisation cohérente avec l'équipement posé", hint: 'La puissance / le modèle préconisé doit correspondre à celui du devis et de la facture du dossier.' },
      { id: 'qualification_auteur', label: "Identité et qualification de l'auteur", hint: "Bureau d'études ou professionnel identifié, avec ses coordonnées." },
      { id: 'date_anteriorite', label: 'Date antérieure aux travaux', hint: 'La note doit être établie avant la signature du devis ou le début des travaux.' },
      { id: 'signature_note', label: "Signature / cachet de l'auteur", hint: '' },
    ],
    exempleMail: '',
  },
  devis: {
    items: [
      // Installateur
      { id: 'inst_raison_sociale', label: "Installateur · Nom / raison sociale", hint: "Nom ou raison sociale de l'installateur présent sur le devis." },
      { id: 'inst_adresse', label: 'Installateur · Adresse', hint: "Adresse complète de l'installateur." },
      { id: 'inst_capital', label: 'Installateur · Capital social', hint: "Montant du capital social de l'installateur indiqué sur le devis." },
      { id: 'inst_siret', label: 'Installateur · SIRET', hint: 'Numéro SIRET à 14 chiffres.' },
      {
        id: 'inst_rge',
        label: 'Installateur · RGE en cours de validité pour le poste de travaux',
        hint: "Qualification RGE valide à la date du devis, pour le poste de travaux concerné, de l'entreprise qui réalise les travaux (celle du sous-traitant s'il y en a un).",
      },
      {
        id: 'inst_sous_traitant',
        label: 'Installateur · Sous-traitant (si sous-traitance)',
        hint: "Si les travaux sont sous-traités : raison sociale, SIRET, nom et prénom du gérant du sous-traitant. N/A s'il n'y a pas de sous-traitant.",
      },

      // Bénéficiaire
      { id: 'benef_civilite', label: 'Bénéficiaire · Civilité', hint: 'M. / Mme indiqué sur le devis.' },
      { id: 'benef_nom', label: 'Bénéficiaire · Nom', hint: 'Cohérent avec le reste du dossier.' },
      { id: 'benef_prenom', label: 'Bénéficiaire · Prénom', hint: 'Cohérent avec le reste du dossier.' },
      { id: 'benef_adresse', label: 'Bénéficiaire · Adresse du client final', hint: 'Adresse complète du client final.' },
      { id: 'benef_adresse_travaux', label: 'Bénéficiaire · Adresse des travaux si différente', hint: "À indiquer si elle diffère de l'adresse du client final. N/A si identique." },

      // Dates du devis
      { id: 'date_visite', label: 'Dates · Date de visite préalable', hint: 'La date de la visite préalable doit figurer sur le devis.' },
      { id: 'date_edition', label: "Dates · Date d'édition du devis", hint: 'Égale ou postérieure à la date de visite préalable.' },
      { id: 'date_signature', label: 'Dates · Date de signature', hint: 'Postérieure à la date du cadre de contribution.' },

      // Corps du devis : mentions techniques PAC air/eau (BAR-TH-171)
      {
        id: 'pac_mise_en_place',
        label: "PAC (BAR-TH-171) · Mise en place d'une pompe à chaleur",
        hint: "Le devis doit mentionner « la mise en place d'une pompe à chaleur » de type air/eau, eau/eau ou sol/eau.",
      },
      {
        id: 'pac_marque_ref',
        label: 'PAC (BAR-TH-171) · Marque et référence de la pompe à chaleur',
        hint: 'Telles qu’indiquées dans la fiche EPREL (https://eprel.ec.europa.eu/screen/product/spaceheaters).',
      },
      {
        id: 'pac_usage',
        label: 'PAC (BAR-TH-171) · Usage de la pompe à chaleur',
        hint: '« Chauffage » ou « Chauffage et eau chaude sanitaire », écrit en toutes lettres.',
      },
      { id: 'pac_surface', label: 'PAC (BAR-TH-171) · Surface chauffée par la PAC', hint: 'Surface chauffée en m².' },
      { id: 'pac_temperature', label: 'PAC (BAR-TH-171) · Température', hint: 'Basse, moyenne ou haute température.' },
      {
        id: 'pac_etas',
        label: 'PAC (BAR-TH-171) · ETAS avec mention réglementaire',
        hint: "ETAS accompagné de la mention « calculé selon le règlement (EU) n°813/2013 de la commission du 2 août 2013 ». Relever la valeur de l'ETAS : elle est à vérifier selon la grille des seuils.",
      },
      { id: 'regul_marque_ref', label: 'PAC (BAR-TH-171) · Marque et référence du régulateur', hint: '' },
      { id: 'regul_classe', label: 'PAC (BAR-TH-171) · Classe du régulateur', hint: 'Classe du régulateur (IV à VIII) indiquée sur le devis.' },
      {
        id: 'depose_chaudiere',
        label: "PAC (BAR-TH-171) · Dépose de l'ancienne chaudière",
        hint: "Le devis doit mentionner la dépose de l'ancienne chaudière fonctionnant au gaz, au fioul ou au charbon.",
      },

      // Prime et montants
      { id: 'total_ht', label: 'Prime · Total HT', hint: '' },
      { id: 'tva', label: 'Prime · TVA', hint: 'Taux et montant de TVA.' },
      { id: 'total_ttc', label: 'Prime · Total TTC', hint: '' },
      { id: 'prime_cee', label: 'Prime · Prime CEE', hint: 'Montant de la prime CEE indiqué sur le devis.' },
      { id: 'reste_a_charge', label: 'Prime · Reste à charge', hint: 'Total TTC moins la prime CEE.' },
      {
        id: 'mention_cee',
        label: 'Prime · Encadré mention CEE Drapo',
        hint:
          'La mention doit être dactylographiée INTÉGRALEMENT, dans la même taille de caractères que le corps du devis. Texte attendu : « ' +
          MENTION_CEE_DRAPO +
          ' »',
      },
    ],
    exempleMail: '',
  },
  facture: {
    items: [
      { id: 'coherence_devis', label: 'Concordance avec le devis', hint: 'Même artisan, même bénéficiaire, mêmes travaux/équipement que le devis du dossier.' },
      { id: 'numero_date_facture', label: 'Numéro et date de la facture', hint: 'Date postérieure à la fin des travaux.' },
      { id: 'mentions_legales', label: 'Mentions légales obligatoires', hint: 'SIRET, numéro de TVA intracommunautaire, qualification RGE.' },
      { id: 'description_realise', label: 'Description des travaux réellement réalisés', hint: "Doit correspondre à l'équipement installé (marque/référence), pas seulement recopier le devis." },
      { id: 'montant_ttc', label: 'Montant TTC cohérent avec le devis', hint: 'Tout écart doit être justifié (avenant, remise, aide déduite).' },
      { id: 'solde_paiement', label: 'Mention du solde / du paiement', hint: "La facture doit indiquer qu'elle est soldée ou préciser les modalités de paiement restantes." },
    ],
    exempleMail: '',
  },
}

const PDF_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
const PDF_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
const MAX_LOCAL_PAGES = 20
const MAX_IMAGES_REVIEW = 4
const MAX_IMAGES_BENEF = 2
const TEXT_BUDGET = 48000

type ItemResult = { status?: 'c' | 'nc' | 'na' | null; value?: string; comment?: string; origin?: 'claude' | 'human'; touchedAfterClaude?: boolean }
type PageImage = { blob: Blob; url: string }
type FileEntry = { uid: string; name: string; status: 'loading' | 'ready' | 'error'; error?: string; text?: string; pages: PageImage[] }
type DocCheck = { ok: boolean; remark: string } | null
type SessionState = { files: FileEntry[]; results: Record<string, ItemResult>; docCheck: DocCheck; mail: string; mailBusy: boolean }

type DossierLite = {
  id: string
  reference: string
  pro_raison_sociale: string
  numero_tiers: string | null
  beneficiaire_nom: string | null
  chantier_nom: string
  statut: string
  etat: string
}
type EtapeLite = { code: string; ordre: number; libelle: string }
type PieceTypeLite = { code: string; libelle: string; etape_code: string }
type LinkState = { dossierId: string | null; mode: 'auto' | 'manuel' | null; candidats: string[] }
type SaveState = { busy: boolean; note: string; tone: 'info' | 'err'; savedDossierId: string | null }

function emptySession(): SessionState {
  return { files: [], results: {}, docCheck: null, mail: '', mailBusy: false }
}
function emptyLink(): LinkState {
  return { dossierId: null, mode: null, candidats: [] }
}
function emptySave(): SaveState {
  return { busy: false, note: '', tone: 'info', savedDossierId: null }
}

function newId(): string {
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Lecture du fichier impossible.'))
    reader.readAsDataURL(blob)
  })
}

function computeCounts(list: ChecklistItem[], results: Record<string, ItemResult>) {
  const c = { c: 0, nc: 0, na: 0, todo: 0 }
  for (const it of list) {
    const st = results[it.id]?.status
    if (st) c[st]++
    else c.todo++
  }
  return c
}

function errCopy(code?: string, fallback?: string): string {
  switch (code) {
    case 'not_configured':
      return "La relecture automatique n'est pas configurée sur ce serveur."
    case 'quota':
      return "Le compte IA utilisé par cette application n'a plus de quota. Contactez l'administrateur."
    case 'rate_limited':
      return "Limite d'utilisation atteinte. Réessayez dans quelques minutes."
    case 'forbidden':
      return 'Accès non autorisé.'
    default:
      return fallback || 'La relecture a échoué (problème de connexion). Réessayez.'
  }
}

// Normalisation pour l'appairage sur le nom (accents, casse, ponctuation).
function norm(s: string | null | undefined): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function nomsCorrespondent(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  if (na.includes(nb) || nb.includes(na)) return true
  const ta = na.split(' ').filter((x) => x.length > 2)
  const tb = new Set(nb.split(' ').filter((x) => x.length > 2))
  const communs = ta.filter((x) => tb.has(x))
  return communs.length >= 2 || (communs.length === 1 && (ta.length === 1 || tb.size === 1))
}

// Attente du chargement de pdf.js (le script est injecté après l'hydratation :
// un PDF déposé dans la seconde qui suit l'affichage échouait auparavant).
async function waitPdfJs(): Promise<any> {
  for (let i = 0; i < 60; i++) {
    const lib = (window as any).pdfjsLib
    if (lib) {
      if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL
      return lib
    }
    await new Promise((r) => window.setTimeout(r, 250))
  }
  throw new Error('Lecteur PDF indisponible (rechargez la page).')
}

export default function ControlePiecesCeePage() {
  const router = useRouter()
  const { rights, email, loading: accessLoading } = useAccess()

  useEffect(() => {
    if (accessLoading) return
    if (!rights.can_financement) router.replace('/unauthorized')
  }, [accessLoading, rights.can_financement, router])

  const [pdfReady, setPdfReady] = useState(false)
  const [current, setCurrent] = useState<TypePieceId>('note_dimensionnement')
  const [checklists, setChecklists] = useState<Partial<Record<TypePieceId, { items: ChecklistItem[]; exempleMail: string }>>>({})
  const [checklistsError, setChecklistsError] = useState(false)
  const [sessions, setSessions] = useState<Record<TypePieceId, SessionState>>(() => ({
    avis_imposition: emptySession(),
    note_dimensionnement: emptySession(),
    devis: emptySession(),
    facture: emptySession(),
  }))
  const [benef, setBenef] = useState('')
  const [benefAuto, setBenefAuto] = useState(false)
  const [benefBusy, setBenefBusy] = useState(false)
  const [benefMsg, setBenefMsg] = useState<{ text: string; suggestion?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [runNote, setRunNote] = useState('')
  const [runNoteTone, setRunNoteTone] = useState<'info' | 'warn' | 'err'>('info')
  const [toastMsg, setToastMsg] = useState('')
  const [dragging, setDragging] = useState(false)
  const [dropDebug, setDropDebug] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [draftItems, setDraftItems] = useState<ChecklistItem[]>([])
  const [draftExample, setDraftExample] = useState('')
  const [editorSaving, setEditorSaving] = useState(false)
  const [editorError, setEditorError] = useState('')

  // Rattachement au dossier
  const [dossiers, setDossiers] = useState<DossierLite[]>([])
  const [dossiersError, setDossiersError] = useState('')
  const [etapes, setEtapes] = useState<EtapeLite[]>([])
  const [pieceTypes, setPieceTypes] = useState<PieceTypeLite[]>([])
  const [links, setLinks] = useState<Record<TypePieceId, LinkState>>(() => ({
    avis_imposition: emptyLink(),
    note_dimensionnement: emptyLink(),
    devis: emptyLink(),
    facture: emptyLink(),
  }))
  const [saves, setSaves] = useState<Record<TypePieceId, SaveState>>(() => ({
    avis_imposition: emptySave(),
    note_dimensionnement: emptySave(),
    devis: emptySave(),
    facture: emptySave(),
  }))

  const benefKeyRef = useRef<Partial<Record<TypePieceId, string>>>({})
  const benefRef = useRef('')
  const benefAutoRef = useRef(false)
  const toastTimerRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    benefRef.current = benef
  }, [benef])

  // Empêche le navigateur d'ouvrir le fichier si le dépôt tombe hors de la zone.
  useEffect(() => {
    const block = (e: DragEvent) => {
      e.preventDefault()
    }
    document.addEventListener('dragover', block)
    document.addEventListener('drop', block)
    return () => {
      document.removeEventListener('dragover', block)
      document.removeEventListener('drop', block)
    }
  }, [])
  useEffect(() => {
    benefAutoRef.current = benefAuto
  }, [benefAuto])

  function customItems(t: TypePieceId): ChecklistItem[] {
    return checklists[t]?.items || []
  }
  function usingDefaults(t: TypePieceId): boolean {
    return customItems(t).length === 0
  }
  function items(t: TypePieceId): ChecklistItem[] {
    const c = customItems(t)
    return c.length ? c : DEFAULT_CHECKLISTS[t].items
  }
  function typeOf(t: TypePieceId): TypeMeta {
    return TYPES.find((x) => x.id === t)!
  }
  function sess(t: TypePieceId): SessionState {
    return sessions[t] || emptySession()
  }

  function updateSession(t: TypePieceId, updater: (s: SessionState) => SessionState) {
    setSessions((prev) => ({ ...prev, [t]: updater(prev[t] || emptySession()) }))
  }
  function updateLink(t: TypePieceId, updater: (l: LinkState) => LinkState) {
    setLinks((prev) => ({ ...prev, [t]: updater(prev[t] || emptyLink()) }))
  }
  function updateSave(t: TypePieceId, updater: (s: SaveState) => SaveState) {
    setSaves((prev) => ({ ...prev, [t]: updater(prev[t] || emptySave()) }))
  }

  function toast(msg: string) {
    setToastMsg(msg)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToastMsg(''), 2200)
  }

  // Chargement de la checklist partagée (table cee_controle_checklists,
  // protégée par la même RLS peut_acceder_financement() que le reste du
  // module CEE). Si la lecture échoue, l'outil reste utilisable avec les
  // checklists par défaut définies plus haut.
  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase.from('cee_controle_checklists').select('type_piece, items, exemple_mail')
      if (cancelled) return
      if (error) {
        setChecklistsError(true)
        return
      }
      const map: Partial<Record<TypePieceId, { items: ChecklistItem[]; exempleMail: string }>> = {}
      for (const row of data || []) {
        const t = row.type_piece as TypePieceId
        if (!TYPES.some((x) => x.id === t)) continue
        const rawItems = Array.isArray(row.items) ? row.items : []
        map[t] = {
          items: rawItems
            .filter((x: any) => x && x.id && x.label)
            .map((x: any) => ({ id: String(x.id), label: String(x.label), hint: x.hint ? String(x.hint) : '' })),
          exempleMail: String(row.exemple_mail || ''),
        }
      }
      setChecklists(map)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // Dossiers ouverts, étapes et types de pièces (pour le rattachement).
  async function chargerDossiers() {
    const [{ data: dData, error: dErr }, { data: eData }, { data: pData }] = await Promise.all([
      supabase
        .from('cee_dossiers')
        .select('id, reference, pro_raison_sociale, numero_tiers, beneficiaire_nom, chantier_nom, statut, etat')
        .eq('cloture', false)
        .order('modifie_le', { ascending: false }),
      supabase.from('cee_etapes').select('code, ordre, libelle').order('ordre', { ascending: true }),
      supabase.from('cee_pieces_types').select('code, libelle, etape_code'),
    ])
    if (dErr) setDossiersError(dErr.message)
    else setDossiersError('')
    setDossiers((dData || []) as DossierLite[])
    setEtapes((eData || []) as EtapeLite[])
    setPieceTypes((pData || []) as PieceTypeLite[])
  }
  useEffect(() => {
    void chargerDossiers()
  }, [])

  function etapeLibelle(code: string): string {
    return etapes.find((e) => e.code === code)?.libelle || code
  }
  function pieceTypeFor(t: TypePieceId): PieceTypeLite | undefined {
    for (const groupe of MOTS_CLES_PIECE[t]) {
      const found = pieceTypes.find((p) => {
        const hay = norm(p.code) + ' ' + norm(p.libelle)
        return groupe.every((k) => hay.includes(k))
      })
      if (found) return found
    }
    return undefined
  }
  function etapeFor(t: TypePieceId): string {
    return pieceTypeFor(t)?.etape_code || ETAPE_PAR_TYPE[t]
  }

  // Appairage automatique : dès qu'un nom de bénéficiaire est connu (lu ou
  // saisi) et qu'aucun dossier n'a été choisi à la main, on cherche un
  // dossier ouvert dont le bénéficiaire ou le chantier correspond.
  useEffect(() => {
    const t = current
    const l = links[t]
    if (l.mode === 'manuel') return
    const name = benef.trim()
    if (!name || !dossiers.length) {
      if (l.dossierId || l.candidats.length) updateLink(t, () => emptyLink())
      return
    }
    const matches = dossiers.filter((d) => nomsCorrespondent(d.beneficiaire_nom, name) || nomsCorrespondent(d.chantier_nom, name))
    const etape = etapeFor(t)
    const surEtape = matches.filter((d) => d.statut === etape)
    const retenu = matches.length === 1 ? matches[0] : surEtape.length === 1 ? surEtape[0] : null
    const nextIds = matches.map((d) => d.id)
    const same = l.dossierId === (retenu?.id || null) && l.candidats.join('|') === nextIds.join('|')
    if (same) return
    updateLink(t, () => ({ dossierId: retenu?.id || null, mode: retenu ? 'auto' : null, candidats: nextIds }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benef, dossiers, pieceTypes, current])

  // --- Fichiers -----------------------------------------------------------

  async function preparePdf(file: File): Promise<{ text: string; pages: PageImage[] }> {
    const pdfjsLib = await waitPdfJs()
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    const texts: string[] = []
    const pages: PageImage[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const tc = await page.getTextContent()
      texts.push(`--- Page ${i} ---\n` + tc.items.map((it: any) => it.str + (it.hasEOL ? '\n' : ' ')).join(''))
      if (pages.length < MAX_LOCAL_PAGES) {
        const vp1 = page.getViewport({ scale: 1 })
        const scale = Math.min(2.2, 1500 / vp1.width)
        const vp = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(vp.width)
        canvas.height = Math.round(vp.height)
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvasContext: ctx, viewport: vp }).promise
        const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b as Blob), 'image/jpeg', 0.82))
        pages.push({ blob, url: URL.createObjectURL(blob) })
      }
    }
    let text = texts.join('\n').replace(/[ \t]+/g, ' ').trim()
    if (text.replace(/--- Page \d+ ---/g, '').trim().length < 20) text = ''
    return { text, pages }
  }

  async function prepareImage(file: File): Promise<{ text: string; pages: PageImage[] }> {
    if (!/^image\//.test(file.type)) throw new Error('Format non pris en charge (PDF, JPG ou PNG).')
    return { text: '', pages: [{ blob: file, url: URL.createObjectURL(file) }] }
  }

  function addFiles(list: FileList | File[] | null, source: 'clic' | 'dépôt') {
    const files = list ? Array.from(list) : []
    if (!files.length) {
      setDropDebug(`${source} : aucun fichier reçu.`)
      return
    }
    setDropDebug(`${source} : ${files.length} fichier${files.length > 1 ? 's' : ''} reçu${files.length > 1 ? 's' : ''} (${files.map((f) => f.name).join(', ')}).`)
    const t = current
    const entries: FileEntry[] = files.map((f) => ({ uid: newId(), name: f.name, status: 'loading', pages: [] }))
    updateSession(t, (s) => ({ ...s, files: [...s.files, ...entries] }))
    setRunNote('')

    files.forEach((file, idx) => {
      const uid = entries[idx].uid
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
      const job = isPdf ? preparePdf(file) : prepareImage(file)
      job
        .then(({ text, pages }) => {
          updateSession(t, (s) => ({ ...s, files: s.files.map((f) => (f.uid === uid ? { ...f, status: 'ready' as const, text, pages } : f)) }))
        })
        .catch((err: any) => {
          updateSession(t, (s) => ({ ...s, files: s.files.map((f) => (f.uid === uid ? { ...f, status: 'error' as const, error: err?.message || 'Fichier illisible' } : f)) }))
        })
    })
  }

  function removeFile(t: TypePieceId, index: number) {
    updateSession(t, (s) => {
      const f = s.files[index]
      f?.pages.forEach((p) => URL.revokeObjectURL(p.url))
      const files = s.files.slice()
      files.splice(index, 1)
      return { ...s, files }
    })
  }

  function allPages(t: TypePieceId): PageImage[] {
    return sess(t).files.flatMap((f) => f.pages)
  }
  function filesReady(t: TypePieceId): boolean {
    const s = sess(t)
    return s.files.length > 0 && s.files.every((f) => f.status === 'ready') && allPages(t).length > 0
  }

  // --- Bénéficiaire ---------------------------------------------------------
  // Déclenchement automatique dès que les fichiers du type actif sont prêts
  // (sauf si l'utilisateur a déjà saisi un nom à la main) ; la clé de garde
  // évite de relancer l'appel pour un même jeu de fichiers.

  useEffect(() => {
    const t = current
    const s = sessions[t]
    if (!s || benefBusy || busy) return
    if (!(s.files.length > 0 && s.files.every((f) => f.status === 'ready') && s.files.some((f) => f.pages.length > 0))) return
    if (benef.trim() && !benefAuto) return
    const key = s.files.map((f) => f.name + ':' + f.pages.length).join('|')
    if (benefKeyRef.current[t] === key) return
    benefKeyRef.current[t] = key
    void detectBenef(t, s)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, sessions, benef, benefAuto, busy, benefBusy])

  async function detectBenef(t: TypePieceId, s: SessionState) {
    setBenefBusy(true)
    setBenefMsg({ text: 'Recherche du nom dans le document…' })
    try {
      const images = await Promise.all(allPages(t).slice(0, MAX_IMAGES_BENEF).map((p) => blobToDataURL(p.blob)))
      const text = s.files.map((f) => f.text).filter(Boolean).join('\n').slice(0, 6000)
      const res = await fetch('/api/financement/controle-pieces/detect-benef', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, typePiece: t, text, images }),
      })
      const out = await res.json().catch(() => null)
      if (!res.ok) throw new Error(errCopy(out?.code, out?.error))
      const name = String(out?.beneficiaire || '').trim()
      if (!name) {
        setBenefMsg({ text: 'Aucun nom de bénéficiaire trouvé dans le document.' })
        return
      }
      const currentBenef = benefRef.current.trim()
      if (currentBenef && !benefAutoRef.current) {
        if (currentBenef.toLowerCase() !== name.toLowerCase()) setBenefMsg({ text: `Le document indique « ${name} ».`, suggestion: name })
        else setBenefMsg(null)
        return
      }
      setBenef(name)
      setBenefAuto(true)
      setBenefMsg({ text: out?.confiance === 'basse' ? 'Lecture incertaine : vérifiez le nom.' : 'Lu dans le document — vérifiez-le si besoin.' })
    } catch {
      setBenefMsg({ text: 'Nom non détecté : saisissez-le à la main.' })
    } finally {
      setBenefBusy(false)
    }
  }

  // --- Relecture par IA -------------------------------------------------

  async function runReview() {
    if (busy) return
    const t = current
    const list = items(t)
    if (!list.length) return
    setBusy(true)
    setRunNote("L'IA lit le document point par point…")
    setRunNoteTone('info')
    abortRef.current = new AbortController()
    try {
      const s = sess(t)
      const images = await Promise.all(allPages(t).slice(0, MAX_IMAGES_REVIEW).map((p) => blobToDataURL(p.blob)))
      let text = s.files.map((f) => (f.text ? `### ${f.name}\n${f.text}` : '')).filter(Boolean).join('\n\n')
      if (text.length > TEXT_BUDGET) text = text.slice(0, TEXT_BUDGET) + '\n[… texte tronqué]'

      const res = await fetch('/api/financement/controle-pieces/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({ email, typePiece: t, beneficiaire: benef.trim(), items: list, text, images }),
      })
      const out = await res.json().catch(() => null)
      if (!res.ok) throw new Error(errCopy(out?.code, out?.error))

      const known = new Set(list.map((i) => i.id))
      let n = 0
      const results: Record<string, ItemResult> = { ...sess(t).results }
      for (const p of out.points || []) {
        if (!known.has(p.id)) continue
        results[p.id] = { status: p.statut || null, value: p.valeur || '', comment: p.commentaire || '', origin: 'claude' }
        n++
      }
      updateSession(t, (prev) => ({ ...prev, results, docCheck: { ok: out.document_correspond !== false, remark: out.remarque_document || '' }, mail: '' }))
      updateSave(t, () => emptySave())

      const aiBenef = String(out.beneficiaire || '').trim()
      if (aiBenef && (!benefRef.current.trim() || benefAutoRef.current)) {
        setBenef(aiBenef)
        setBenefAuto(true)
      }

      setRunNote(
        n
          ? `Relecture terminée : ${n} point${n > 1 ? 's' : ''} pré-rempli${n > 1 ? 's' : ''}. Vérifiez et corrigez si besoin.`
          : "L'IA n'a renvoyé aucun point exploitable. Réessayez ou remplissez à la main."
      )
      setRunNoteTone(n ? 'info' : 'warn')
    } catch (e: any) {
      const cancelled = e?.name === 'AbortError'
      setRunNote(cancelled ? 'Relecture arrêtée.' : e?.message || 'La relecture a échoué (problème de connexion). Réessayez.')
      setRunNoteTone(cancelled ? 'info' : 'err')
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  function stopReview() {
    abortRef.current?.abort()
  }

  function setItemStatus(t: TypePieceId, id: string, v: 'c' | 'nc' | 'na') {
    updateSession(t, (s) => {
      const prevR = s.results[id] || {}
      const wasClaude = prevR.origin === 'claude' || prevR.touchedAfterClaude
      const nextStatus = prevR.status === v ? null : v
      const next: ItemResult = { ...prevR, status: nextStatus, origin: 'human', touchedAfterClaude: wasClaude ? true : prevR.touchedAfterClaude }
      return { ...s, results: { ...s.results, [id]: next } }
    })
    updateSave(t, (sv) => (sv.savedDossierId ? emptySave() : sv))
  }

  function setItemComment(t: TypePieceId, id: string, comment: string) {
    updateSession(t, (s) => {
      const prevR = s.results[id] || {}
      const wasClaude = prevR.origin === 'claude'
      const next: ItemResult = { ...prevR, comment, origin: wasClaude ? 'human' : prevR.origin, touchedAfterClaude: wasClaude ? true : prevR.touchedAfterClaude }
      return { ...s, results: { ...s.results, [id]: next } }
    })
  }

  // --- Mail ---------------------------------------------------------------

  function fallbackMail(t: TypePieceId): string {
    const meta = typeOf(t)
    const r = sess(t).results
    const nc = items(t).filter((it) => r[it.id]?.status === 'nc')
    const dossier = benef.trim() ? ` du dossier ${benef.trim()}` : ''
    if (!nc.length) return `Bonjour,\n\n${meta.the}${dossier} est conforme, merci.\n\nBien cordialement`
    const lines = nc.map((it) => `- ${r[it.id]?.comment || `Il manque : ${it.label}`}`).join('\n')
    return `Bonjour,\n\n${meta.the}${dossier} contient les erreurs suivantes :\n\n${lines}\n\nPouvez-vous nous renvoyer la version corrigée ${meta.of} afin que l'on puisse finaliser l'envoi du dossier ?\n\nMerci d'avance.\n\nBien cordialement`
  }

  async function generateMail() {
    const t = current
    const list = items(t)
    if (!list.length) return
    updateSession(t, (s) => ({ ...s, mailBusy: true }))
    try {
      const r = sess(t).results
      const nonConformes = list.filter((it) => r[it.id]?.status === 'nc').map((it) => ({ label: it.label, valeur: r[it.id]?.value, commentaire: r[it.id]?.comment }))
      const conformes = list.filter((it) => r[it.id]?.status === 'c').map((it) => ({ label: it.label }))
      const res = await fetch('/api/financement/controle-pieces/mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          typePiece: t,
          beneficiaire: benef.trim(),
          nonConformes,
          conformes,
          exempleMail: checklists[t]?.exempleMail || '',
          docCheck: sess(t).docCheck,
        }),
      })
      const out = await res.json().catch(() => null)
      if (!res.ok || !out?.mail) throw new Error('échec')
      updateSession(t, (s) => ({ ...s, mail: out.mail, mailBusy: false }))
    } catch {
      updateSession(t, (s) => ({ ...s, mail: fallbackMail(t), mailBusy: false }))
    }
  }

  async function copyMail() {
    try {
      await navigator.clipboard.writeText(sess(current).mail)
      toast('Texte copié')
    } catch {
      toast('Impossible de copier automatiquement')
    }
  }

  // --- Capitalisation du contrôle dans le dossier -------------------------

  async function enregistrerControle() {
    const t = current
    const link = links[t]
    const dossierId = link.dossierId
    if (!dossierId || saves[t].busy) return
    const meta = typeOf(t)
    const list = items(t)
    const s = sess(t)
    const r = s.results
    const counts = computeCounts(list, r)
    if (counts.todo === list.length) {
      updateSave(t, (sv) => ({ ...sv, note: 'Renseignez au moins un point avant d’enregistrer le contrôle.', tone: 'err' }))
      return
    }
    updateSave(t, () => ({ busy: true, note: 'Enregistrement du contrôle…', tone: 'info', savedDossierId: null }))

    const now = new Date().toISOString()
    const verdict: 'conforme' | 'non_conforme' | 'incomplet' = counts.nc > 0 ? 'non_conforme' : counts.todo > 0 ? 'incomplet' : 'conforme'
    const nc = list.filter((it) => r[it.id]?.status === 'nc')
    const resultats = list.map((it) => ({
      id: it.id,
      label: it.label,
      statut: r[it.id]?.status || null,
      valeur: r[it.id]?.value || '',
      commentaire: r[it.id]?.comment || '',
      origine: r[it.id]?.origin || null,
    }))
    const pointsNc = nc.map((it) => `${it.label}${r[it.id]?.comment ? ` — ${r[it.id]?.comment}` : ''}`)
    const pieceType = pieceTypeFor(t)

    try {
      // 1. Trace du contrôle
      const { error: ctrlErr } = await supabase.from('cee_controles').insert({
        dossier_id: dossierId,
        type_piece: t,
        etape_code: etapeFor(t),
        beneficiaire: benef.trim() || null,
        fichiers: s.files.map((f) => f.name),
        resultats,
        document_correspond: s.docCheck ? s.docCheck.ok : null,
        remarque_document: s.docCheck?.remark || null,
        nb_conformes: counts.c,
        nb_non_conformes: counts.nc,
        nb_na: counts.na,
        nb_sans_statut: counts.todo,
        verdict,
        mail: s.mail || null,
        appairage_mode: link.mode,
        controle_le: now,
        controle_par: email || null,
      })
      if (ctrlErr) throw new Error(`cee_controles : ${ctrlErr.message}`)

      // 2. Statut de la pièce dans le dossier
      if (pieceType) {
        const { data: existante } = await supabase
          .from('cee_dossier_pieces')
          .select('recue_le, validee_le')
          .eq('dossier_id', dossierId)
          .eq('type_piece', pieceType.code)
          .maybeSingle()
        const statutPiece = verdict === 'conforme' ? 'validee' : verdict === 'non_conforme' ? 'refusee' : 'recue'
        const { error: pieceErr } = await supabase.from('cee_dossier_pieces').upsert(
          {
            dossier_id: dossierId,
            type_piece: pieceType.code,
            statut: statutPiece,
            recue_le: existante?.recue_le || now,
            validee_le: statutPiece === 'validee' ? now : null,
            commentaire: pointsNc.length ? pointsNc.join('\n') : null,
            modifie_le: now,
            modifie_par: email || null,
          },
          { onConflict: 'dossier_id,type_piece' }
        )
        if (pieceErr) throw new Error(`cee_dossier_pieces : ${pieceErr.message}`)
      }

      // 3. Note de dimensionnement : historique dédié
      if (t === 'note_dimensionnement') {
        const contenu = list
          .map((it) => `${it.label} : ${r[it.id]?.status ? STATUS_LABEL[r[it.id]!.status!] : 'non renseigné'}${r[it.id]?.value ? ` (${r[it.id]?.value})` : ''}`)
          .join('\n')
        const { error: noteErr } = await supabase.from('cee_notes_dimensionnement').insert({
          dossier_id: dossierId,
          contenu,
          verdict: verdict === 'non_conforme' ? 'ko' : verdict === 'conforme' ? 'ok' : 'incomplet',
          points_ko: pointsNc,
          mail_correction: s.mail || null,
          fournisseur_ia: 'openai',
          verifie_le: now,
          verifie_par: email || null,
        })
        if (noteErr) console.warn('[controle-pieces] note de dimensionnement non journalisée :', noteErr.message)
      }

      // 4. État et points bloquants du dossier (les points de ce type de pièce
      //    sont remplacés, les autres conservés)
      const { data: d, error: dErr } = await supabase.from('cee_dossiers').select('etat, points_bloquants').eq('id', dossierId).maybeSingle()
      if (dErr || !d) throw new Error(`cee_dossiers : ${dErr?.message || 'dossier introuvable'}`)
      const tag = `[${meta.code}]`
      const anciens = ((d.points_bloquants as string[] | null) || []).filter((p) => !p.startsWith(tag))
      const nouveaux = [...anciens, ...pointsNc.map((p) => `${tag} ${p}`)]
      let etat = d.etat as string
      if (pointsNc.length) etat = 'a_corriger'
      else if (!nouveaux.length && etat === 'a_corriger') etat = 'pret'
      const { error: updErr } = await supabase
        .from('cee_dossiers')
        .update({ points_bloquants: nouveaux, etat, modifie_le: now, modifie_par: email || null })
        .eq('id', dossierId)
      if (updErr) throw new Error(`cee_dossiers : ${updErr.message}`)

      const ref = dossiers.find((x) => x.id === dossierId)?.reference || 'le dossier'
      updateSave(t, () => ({
        busy: false,
        tone: 'info',
        savedDossierId: dossierId,
        note:
          verdict === 'conforme'
            ? `Contrôle enregistré sur ${ref} : pièce validée.`
            : verdict === 'non_conforme'
            ? `Contrôle enregistré sur ${ref} : ${pointsNc.length} point${pointsNc.length > 1 ? 's' : ''} bloquant${pointsNc.length > 1 ? 's' : ''}, dossier passé « À corriger ».`
            : `Contrôle enregistré sur ${ref} (incomplet : ${counts.todo} point${counts.todo > 1 ? 's' : ''} sans statut).`,
      }))
      toast('Contrôle enregistré')
      void chargerDossiers()
    } catch (e: any) {
      updateSave(t, (sv) => ({ ...sv, busy: false, tone: 'err', note: `Enregistrement impossible — ${e?.message || 'erreur inconnue'}` }))
    }
  }

  // --- Éditeur de checklist -------------------------------------------

  function openEditor() {
    const base = items(current).map((i) => ({ ...i }))
    setDraftItems(base.length ? base : [{ id: newId(), label: '', hint: '' }])
    setDraftExample(checklists[current]?.exempleMail || '')
    setEditorError('')
    setEditorOpen(true)
  }

  async function saveChecklist() {
    const clean = draftItems.map((d) => ({ id: d.id, label: d.label.trim(), hint: (d.hint || '').trim() })).filter((d) => d.label)
    setEditorSaving(true)
    setEditorError('')
    const { error } = await supabase
      .from('cee_controle_checklists')
      .upsert({ type_piece: current, items: clean, exemple_mail: draftExample.trim(), modifie_le: new Date().toISOString(), modifie_par: email || null }, { onConflict: 'type_piece' })
    setEditorSaving(false)
    if (error) {
      setEditorError(`L'enregistrement a échoué : ${error.message}`)
      return
    }
    setChecklists((prev) => ({ ...prev, [current]: { items: clean, exempleMail: draftExample.trim() } }))
    setEditorOpen(false)
    toast('Checklist enregistrée')
  }

  // --- Rendu ----------------------------------------------------------------

  const etapeCourante = useMemo(() => etapeFor(current), [current, pieceTypes]) // eslint-disable-line react-hooks/exhaustive-deps
  const link = links[current]
  const save = saves[current]
  const dossierLie = link.dossierId ? dossiers.find((d) => d.id === link.dossierId) || null : null
  const candidats = dossiers.filter((d) => link.candidats.includes(d.id))
  const surEtape = dossiers.filter((d) => d.statut === etapeCourante && !link.candidats.includes(d.id))
  const autres = dossiers.filter((d) => d.statut !== etapeCourante && !link.candidats.includes(d.id))

  function optionLabel(d: DossierLite): string {
    return `${d.reference} · ${d.pro_raison_sociale}${d.numero_tiers ? ` (${d.numero_tiers})` : ''} · ${etapeLibelle(d.statut)} · ${ETAT_LABEL[d.etat] || d.etat}`
  }

  if (accessLoading || !rights.can_financement) {
    return <div className="min-h-screen bg-[#F4F3F0]" />
  }

  const meta = typeOf(current)
  const list = items(current)
  const s = sess(current)
  const docCheck = s.docCheck
  const counts = computeCounts(list, s.results)
  const canRun = !busy && filesReady(current) && list.length > 0
  const canSave = !!link.dossierId && !save.busy && list.length > 0 && counts.todo < list.length

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      <Script
        src={PDF_JS_URL}
        strategy="afterInteractive"
        onLoad={() => {
          const lib = (window as any).pdfjsLib
          if (lib) lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL
          setPdfReady(true)
        }}
      />

      <header className="border-b border-[#1E2833] bg-[#111820]">
        <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-4 px-4 py-6 md:flex-row md:items-end md:justify-between md:px-8">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#9EAD43]">Financement CEE · Contrôle qualité</div>
            <h1 className="mt-2 text-[26px] font-bold leading-tight text-white md:text-[30px]">Relecteur de pièces CEE</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
              Déposez la pièce, laissez l&apos;IA faire une première lecture, corrigez ses suggestions, générez le texte du retour à l&apos;artisan, puis enregistrez le contrôle dans le dossier.
            </p>
          </div>
          <button
            type="button"
            onClick={openEditor}
            className="h-10 shrink-0 rounded-xl border border-[#394652] bg-transparent px-4 text-sm font-medium text-slate-200 hover:border-[#9EAD43] hover:text-white"
          >
            Modifier la checklist
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1760px] px-4 py-6 md:px-8">
        <div className="grid grid-cols-2 gap-0 overflow-hidden rounded-2xl border border-[#E2DFD8] bg-white md:grid-cols-4">
          {TYPES.map((t) => {
            const active = t.id === current
            const n = items(t.id).length
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setCurrent(t.id)}
                className={`border-b border-[#E2DFD8] px-4 py-3 text-left last:border-0 md:border-b-0 md:border-r ${active ? 'bg-[#FAF7EE]' : 'hover:bg-[#FAF9F7]'}`}
              >
                <div className={`font-mono text-[11px] tracking-[0.1em] ${active ? 'text-[#B4761A]' : 'text-slate-400'}`}>{t.code}</div>
                <div className="text-[15px] font-semibold text-slate-900">{t.label}</div>
                <div className="text-xs text-slate-500">{n ? `${n} point${n > 1 ? 's' : ''}` : 'à définir'}</div>
              </button>
            )
          })}
        </div>

        <div className="mt-6 grid grid-cols-1 items-start gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="grid gap-4">
            <section className="rounded-2xl border border-[#E2DFD8] bg-white">
              <div className="flex items-center justify-between border-b border-[#E2DFD8] px-4 py-3">
                <h2 className="text-[15px] font-semibold text-slate-900">Pièce à contrôler</h2>
                <span className="font-mono text-[11px] text-slate-400">{meta.code}</span>
              </div>
              <div className="grid gap-4 p-4">
                <div className="relative">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        fileInputRef.current?.click()
                      }
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDragging(true)
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      e.dataTransfer.dropEffect = 'copy'
                      if (!dragging) setDragging(true)
                    }}
                    onDragLeave={(e) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                      setDragging(false)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDragging(false)
                      const dt = e.dataTransfer
                      let files: File[] = Array.from(dt.files || [])
                      if (!files.length && dt.items) {
                        files = Array.from(dt.items)
                          .filter((it) => it.kind === 'file')
                          .map((it) => it.getAsFile())
                          .filter((f): f is File => !!f)
                      }
                      addFiles(files, 'dépôt')
                    }}
                    className={`grid cursor-pointer justify-items-center gap-1 rounded-xl border-2 border-dashed p-6 text-center transition ${
                      dragging ? 'border-[#B4761A] bg-[#FAF7EE]' : 'border-[#D8D3C8] hover:border-[#B4761A] hover:bg-[#FAF7EE]'
                    }`}
                  >
                    <span className="pointer-events-none text-sm font-semibold text-slate-900">{dragging ? 'Relâchez pour ajouter' : 'Déposer le document'}</span>
                    <span className="pointer-events-none text-xs text-slate-500">Glissez-déposez ou cliquez · PDF, JPG ou PNG · plusieurs fichiers possibles</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden', pointerEvents: 'none' }}
                    tabIndex={-1}
                    onChange={(e) => {
                      addFiles(e.target.files, 'clic')
                      e.target.value = ''
                    }}
                  />
                  {dropDebug && <div className="mt-1.5 font-mono text-[11px] text-slate-500">{dropDebug}</div>}
                </div>

                {s.files.length > 0 && (
                  <div className="grid gap-2">
                    {s.files.map((f, i) => (
                      <div key={f.uid} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-[#FAF9F7] px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-slate-800">{f.name}</div>
                          <div className={`font-mono text-[11px] ${f.status === 'error' ? 'text-[#A32C2C]' : 'text-slate-500'}`}>
                            {f.status === 'loading' ? 'Préparation…' : f.status === 'error' ? f.error : `${f.pages.length} page${f.pages.length > 1 ? 's' : ''}${f.text ? ' · texte extrait' : ''}`}
                          </div>
                        </div>
                        <button type="button" onClick={() => removeFile(current, i)} className="rounded px-2 py-1 text-slate-400 hover:text-[#A32C2C]" aria-label={`Retirer ${f.name}`}>
                          ✕
                        </button>
                        {f.pages.length > 0 && (
                          <div className="col-span-2 flex flex-wrap gap-1.5">
                            {f.pages.slice(0, 6).map((p, pi) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={pi} src={p.url} alt="" className="h-14 w-11 rounded border border-[#E2DFD8] bg-white object-cover object-top" />
                            ))}
                            {f.pages.length > 6 && <span className="self-end text-[11px] text-slate-500">+{f.pages.length - 6}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid gap-1.5">
                  <label htmlFor="benef" className="text-xs font-medium text-slate-500">
                    Nom du bénéficiaire
                  </label>
                  <input
                    id="benef"
                    type="text"
                    value={benef}
                    onChange={(e) => {
                      setBenef(e.target.value)
                      setBenefAuto(false)
                      setBenefMsg(null)
                    }}
                    placeholder="Rempli à partir du document chargé"
                    className={`h-10 rounded-xl border px-3 text-sm outline-none focus:border-[#B4761A] ${benefAuto ? 'border-[#B4CFE0] bg-[#F5FAFD]' : 'border-[#D8D3C8] bg-white'}`}
                  />
                  {benefMsg && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{benefMsg.text}</span>
                      {benefMsg.suggestion && (
                        <button
                          type="button"
                          className="text-[#B4761A] underline underline-offset-2"
                          onClick={() => {
                            setBenefAuto(true)
                            setBenef(benefMsg.suggestion!)
                            setBenefMsg(null)
                          }}
                        >
                          Utiliser ce nom
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid gap-2">
                  <button
                    type="button"
                    disabled={!canRun}
                    onClick={runReview}
                    className="h-11 rounded-xl bg-[#111820] text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-[#1E2833]"
                  >
                    {busy ? 'Relecture en cours…' : 'Lancer la relecture par IA'}
                  </button>
                  {busy && (
                    <button type="button" onClick={stopReview} className="h-9 rounded-xl border border-[#D8D3C8] text-xs font-medium text-slate-600 hover:border-[#B4761A]">
                      Arrêter
                    </button>
                  )}
                  <div className={`text-xs ${runNoteTone === 'err' ? 'text-[#A32C2C]' : runNoteTone === 'warn' ? 'text-[#93600F]' : 'text-slate-500'}`}>
                    {runNote || (!s.files.length ? 'Ajoutez un document pour lancer la relecture.' : !pdfReady ? 'Préparation du lecteur de documents…' : '')}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-[#E2DFD8] bg-white">
              <div className="flex items-center justify-between border-b border-[#E2DFD8] px-4 py-3">
                <h2 className="text-[15px] font-semibold text-slate-900">Dossier CEE</h2>
                {link.mode && (
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${link.mode === 'auto' ? 'bg-[#EEF5FA] text-[#2E5E80]' : 'bg-[#FDF1DE] text-[#93600F]'}`}>
                    {link.mode === 'auto' ? 'Appairage auto' : 'Choix manuel'}
                  </span>
                )}
              </div>
              <div className="grid gap-3 p-4">
                {dossiersError && <div className="text-xs text-[#A32C2C]">Dossiers indisponibles : {dossiersError}</div>}
                <div className="text-xs text-slate-500">
                  Étape de contrôle : <b className="font-medium text-slate-700">{etapeLibelle(etapeCourante)}</b>
                  {dossiers.length ? ` · ${dossiers.length} dossier${dossiers.length > 1 ? 's' : ''} ouvert${dossiers.length > 1 ? 's' : ''}` : ''}
                </div>
                <select
                  value={link.dossierId || ''}
                  onChange={(e) => {
                    const id = e.target.value
                    updateLink(current, (l) => ({ ...l, dossierId: id || null, mode: id ? 'manuel' : null }))
                    updateSave(current, () => emptySave())
                  }}
                  className="h-10 w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm focus:border-[#B4761A] focus:outline-none"
                >
                  <option value="">— Aucun dossier rattaché —</option>
                  {candidats.length > 0 && (
                    <optgroup label={`Correspondances sur « ${benef.trim()} »`}>
                      {candidats.map((d) => (
                        <option key={d.id} value={d.id}>
                          {optionLabel(d)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {surEtape.length > 0 && (
                    <optgroup label={`Dossiers à l'étape « ${etapeLibelle(etapeCourante)} »`}>
                      {surEtape.map((d) => (
                        <option key={d.id} value={d.id}>
                          {optionLabel(d)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {autres.length > 0 && (
                    <optgroup label="Autres dossiers ouverts">
                      {autres.map((d) => (
                        <option key={d.id} value={d.id}>
                          {optionLabel(d)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>

                {dossierLie ? (
                  <div className="rounded-xl bg-[#FAF9F7] px-3 py-2 text-xs text-slate-600">
                    <div className="text-sm font-semibold text-slate-900">{dossierLie.reference}</div>
                    <div>
                      {dossierLie.pro_raison_sociale}
                      {dossierLie.numero_tiers ? ` · n° ${dossierLie.numero_tiers}` : ''}
                    </div>
                    <div>
                      {dossierLie.beneficiaire_nom || dossierLie.chantier_nom} · {etapeLibelle(dossierLie.statut)} · {ETAT_LABEL[dossierLie.etat] || dossierLie.etat}
                    </div>
                    {dossierLie.statut !== etapeCourante && (
                      <div className="mt-1 text-[#93600F]">Ce dossier n&apos;est pas à l&apos;étape « {etapeLibelle(etapeCourante)} » : vérifiez qu&apos;il s&apos;agit du bon.</div>
                    )}
                  </div>
                ) : benef.trim() ? (
                  <div className="text-xs text-slate-500">
                    {link.candidats.length > 1
                      ? `${link.candidats.length} dossiers correspondent à ce nom : choisissez-le dans la liste.`
                      : 'Aucun dossier ouvert ne correspond à ce nom : choisissez-le dans la liste ou créez-le.'}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">Le dossier sera proposé automatiquement à partir du nom du bénéficiaire.</div>
                )}

                <button
                  type="button"
                  disabled={!canSave}
                  onClick={enregistrerControle}
                  className="h-11 rounded-xl border-2 border-[#111820] bg-white text-sm font-semibold text-[#111820] transition disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-[#111820] hover:enabled:text-white"
                >
                  {save.busy ? 'Enregistrement…' : 'Enregistrer le contrôle dans le dossier'}
                </button>
                {save.note && (
                  <div className={`text-xs ${save.tone === 'err' ? 'text-[#A32C2C]' : 'text-[#2E6B3E]'}`}>
                    {save.note}
                    {save.savedDossierId && (
                      <>
                        {' '}
                        <button type="button" onClick={() => router.push(`/financement/dossiers/${save.savedDossierId}`)} className="text-[#B4761A] underline underline-offset-2">
                          Ouvrir le dossier
                        </button>
                      </>
                    )}
                  </div>
                )}
                {!save.note && (
                  <div className="text-xs text-slate-400">
                    Enregistre la pièce sur le dossier, ses points bloquants et l&apos;état du dossier. Le passage à l&apos;étape suivante se fait sur la fiche du dossier.
                  </div>
                )}
                <button type="button" onClick={() => router.push('/financement/dossiers/nouveau')} className="w-fit text-xs text-[#B4761A] underline underline-offset-2">
                  Créer un nouveau dossier
                </button>
              </div>
            </section>
          </aside>

          <div className="grid gap-5">
            <section className="rounded-2xl border border-[#E2DFD8] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2DFD8] px-4 py-3">
                <h2 className="text-[15px] font-semibold text-slate-900">Checklist · {meta.label}</h2>
                <div className="flex flex-wrap gap-1.5">
                  {counts.c > 0 && <Pill label={`${counts.c} conforme${counts.c > 1 ? 's' : ''}`} bg="#EAF3E8" fg="#2E6B3E" />}
                  {counts.nc > 0 && <Pill label={`${counts.nc} non conforme${counts.nc > 1 ? 's' : ''}`} bg="#FBE9E9" fg="#A32C2C" />}
                  {counts.na > 0 && <Pill label={`${counts.na} N/A`} bg="#EFEDE8" fg="#6B7580" />}
                  {counts.todo > 0 && <Pill label={`${counts.todo} à vérifier`} bg="#FDF1DE" fg="#93600F" />}
                </div>
              </div>

              {usingDefaults(current) && list.length > 0 && (
                <div className="mx-4 mt-3 rounded-xl bg-[#EEF5FA] px-3 py-2 text-xs text-[#2E5E80]">
                  Checklist suggérée par défaut pour {meta.art}
                  {!checklistsError ? ' — personnalisable via « Modifier la checklist ».' : ' — la checklist partagée est indisponible (table cee_controle_checklists).'}
                </div>
              )}

              {docCheck && docCheck.ok === false && (
                <div className="mx-4 mt-3 rounded-xl bg-[#FDF1DE] px-3 py-2 text-xs text-[#93600F]">
                  <strong>Type de document à vérifier :</strong> {docCheck.remark || `le document ne semble pas être ${meta.art}.`}
                </div>
              )}

              {list.length === 0 ? (
                <div className="grid gap-2 p-6 text-sm text-slate-500">
                  <span>Aucun point n&apos;est encore défini pour {meta.art}.</span>
                  <button type="button" onClick={openEditor} className="w-fit rounded-lg border border-[#D8D3C8] px-3 py-1.5 text-xs font-medium hover:border-[#B4761A]">
                    Définir la checklist
                  </button>
                </div>
              ) : (
                <ul className="divide-y divide-[#EFEDE8]">
                  {list.map((it) => {
                    const r = s.results[it.id] || {}
                    return (
                      <li key={it.id} className="grid gap-2 px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900">{it.label}</div>
                            {it.hint && <div className="mt-0.5 text-xs text-slate-500">{it.hint}</div>}
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              {r.value && (
                                <span className="rounded bg-[#F4F3F0] px-2 py-0.5 font-mono text-[11px] text-slate-700">
                                  <b className="mr-1.5 font-normal text-slate-400">relevé</b>
                                  {r.value}
                                </span>
                              )}
                              {r.origin === 'claude' && <span className="rounded bg-[#EEF5FA] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#2E5E80]">Suggestion IA</span>}
                              {r.origin === 'human' && r.touchedAfterClaude && (
                                <span className="rounded bg-[#FDF1DE] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#93600F]">Corrigé</span>
                              )}
                            </div>
                          </div>
                          <div className="inline-flex overflow-hidden rounded-lg border border-[#D8D3C8]">
                            {(['c', 'nc', 'na'] as const).map((v) => {
                              const on = r.status === v
                              const tone = v === 'c' ? { bg: '#EAF3E8', fg: '#2E6B3E' } : v === 'nc' ? { bg: '#FBE9E9', fg: '#A32C2C' } : { bg: '#EFEDE8', fg: '#44494E' }
                              return (
                                <button
                                  key={v}
                                  type="button"
                                  onClick={() => setItemStatus(current, it.id, v)}
                                  className="border-r border-[#D8D3C8] px-2.5 py-1.5 text-xs font-medium last:border-0"
                                  style={on ? { background: tone.bg, color: tone.fg } : { color: '#8A8F94' }}
                                >
                                  {STATUS_LABEL[v]}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                        <textarea
                          value={r.comment || ''}
                          onChange={(e) => setItemComment(current, it.id, e.target.value)}
                          placeholder="Ajouter un commentaire…"
                          rows={1}
                          className="w-full resize-none rounded-lg border border-transparent bg-transparent px-1 py-1 text-sm text-slate-700 hover:border-[#E2DFD8] focus:border-[#B4761A] focus:bg-[#FAF9F7] focus:outline-none"
                        />
                      </li>
                    )
                  })}
                </ul>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2DFD8] px-4 py-3">
                <span className="text-xs text-slate-500">
                  {list.length === 0
                    ? ''
                    : counts.todo
                    ? `${counts.todo} point${counts.todo > 1 ? 's' : ''} sans statut : ils ne seront pas mentionnés dans le mail.`
                    : counts.nc
                    ? 'Revue terminée. Le mail listera les points non conformes.'
                    : 'Revue terminée. Tous les points applicables sont conformes.'}
                </span>
                <button type="button" disabled={list.length === 0} onClick={generateMail} className="h-9 rounded-xl bg-[#111820] px-4 text-sm font-semibold text-white disabled:opacity-40">
                  Générer le texte du mail
                </button>
              </div>
            </section>

            {(s.mail || s.mailBusy) && (
              <section className="rounded-2xl border border-[#E2DFD8] bg-white">
                <div className="flex items-center justify-between border-b border-[#E2DFD8] px-4 py-3">
                  <h2 className="text-[15px] font-semibold text-slate-900">Texte pour l&apos;artisan</h2>
                  <div className="flex gap-2">
                    <button type="button" onClick={generateMail} className="rounded-lg border border-[#D8D3C8] px-3 py-1.5 text-xs font-medium hover:border-[#B4761A]">
                      Régénérer
                    </button>
                    <button type="button" onClick={copyMail} className="rounded-lg bg-[#111820] px-3 py-1.5 text-xs font-semibold text-white">
                      Copier le texte
                    </button>
                  </div>
                </div>
                <div className="p-4">
                  <textarea
                    value={s.mailBusy ? 'Rédaction…' : s.mail}
                    onChange={(e) => updateSession(current, (prev) => ({ ...prev, mail: e.target.value }))}
                    className="h-56 w-full resize-y rounded-xl border border-[#D8D3C8] bg-[#FAF9F7] p-3 text-sm leading-relaxed text-slate-800 focus:border-[#B4761A] focus:outline-none"
                  />
                </div>
              </section>
            )}
          </div>
        </div>
      </main>

      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl border border-[#D8D3C8] bg-white px-4 py-2 text-sm text-slate-800 shadow-lg">{toastMsg}</div>
      )}

      {editorOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setEditorOpen(false)}>
          <div
            className="grid max-h-[calc(100vh-48px)] w-full max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#E2DFD8] px-5 py-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Checklist partagée</div>
                <h2 className="text-lg font-semibold text-slate-900">{meta.label}</h2>
              </div>
              <button type="button" onClick={() => setEditorOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-[#F4F3F0]">
                Fermer
              </button>
            </div>
            <div className="grid gap-4 overflow-auto p-5">
              <div className="grid gap-2">
                <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_90px] gap-2 text-xs font-medium text-slate-500">
                  <span>Point à vérifier</span>
                  <span>Précision pour la relecture (facultatif)</span>
                  <span />
                </div>
                {draftItems.map((d, i) => (
                  <div key={d.id} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] items-center gap-2">
                    <input
                      value={d.label}
                      onChange={(e) => setDraftItems((prev) => prev.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)))}
                      placeholder="ex. Altitude (en m)"
                      className="h-9 rounded-lg border border-[#D8D3C8] px-2.5 text-sm focus:border-[#B4761A] focus:outline-none"
                    />
                    <input
                      value={d.hint || ''}
                      onChange={(e) => setDraftItems((prev) => prev.map((x, xi) => (xi === i ? { ...x, hint: e.target.value } : x)))}
                      placeholder="Précision"
                      className="h-9 rounded-lg border border-[#D8D3C8] px-2.5 text-sm focus:border-[#B4761A] focus:outline-none"
                    />
                    <div className="flex gap-1">
                      <button
                        type="button"
                        disabled={i === 0}
                        onClick={() =>
                          setDraftItems((prev) => {
                            const next = prev.slice()
                            ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
                            return next
                          })
                        }
                        className="h-9 w-8 rounded-lg text-slate-500 hover:bg-[#F4F3F0] disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={i === draftItems.length - 1}
                        onClick={() =>
                          setDraftItems((prev) => {
                            const next = prev.slice()
                            ;[next[i + 1], next[i]] = [next[i], next[i + 1]]
                            return next
                          })
                        }
                        className="h-9 w-8 rounded-lg text-slate-500 hover:bg-[#F4F3F0] disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button type="button" onClick={() => setDraftItems((prev) => prev.filter((_, xi) => xi !== i))} className="h-9 w-8 rounded-lg text-slate-500 hover:bg-[#FBE9E9] hover:text-[#A32C2C]">
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setDraftItems((prev) => [...prev, { id: newId(), label: '', hint: '' }])}
                  className="w-fit rounded-lg border border-[#D8D3C8] px-3 py-1.5 text-xs font-medium hover:border-[#B4761A]"
                >
                  + Ajouter un point
                </button>
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-slate-500">Exemple de mail de retour pour ce type de pièce</label>
                <textarea
                  value={draftExample}
                  onChange={(e) => setDraftExample(e.target.value)}
                  placeholder="Collez ici un exemple type de mail. L'IA s'en inspirera (ton, formules, structure) pour rédiger le texte."
                  className="min-h-[140px] resize-y rounded-xl border border-[#D8D3C8] p-3 text-sm focus:border-[#B4761A] focus:outline-none"
                />
              </div>
              <p className="text-xs text-slate-400">Les modifications sont enregistrées pour toutes les personnes qui utilisent cette page.</p>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-[#E2DFD8] px-5 py-4">
              <span className="text-xs text-[#A32C2C]">{editorError}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditorOpen(false)} className="h-9 rounded-xl border border-[#D8D3C8] px-4 text-sm font-medium hover:border-[#B4761A]">
                  Annuler
                </button>
                <button type="button" disabled={editorSaving} onClick={saveChecklist} className="h-9 rounded-xl bg-[#111820] px-4 text-sm font-semibold text-white disabled:opacity-50">
                  {editorSaving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Pill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: bg, color: fg }}>
      {label}
    </span>
  )
}
