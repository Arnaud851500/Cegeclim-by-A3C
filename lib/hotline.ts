// ============================================================================
// lib/hotline.ts — Hotline technique / SAV (02/11/2026)
// ----------------------------------------------------------------------------
// Types et accès base du module Hotline (écrans /hotline/*). Tout passe par les
// tables hotline_* et les RPC hotline_* (migration
// supabase/migrations/20261102_hotline_technique.sql) : rien d'autre dans
// l'application ne dépend de ce fichier.
//
// Intégration 3CX : dans la configuration CRM / « Ouvrir une URL sur appel
// entrant » du client 3CX, renseigner
//   https://cegeclim-by-a3-c.vercel.app/hotline?tel=%CallerNumber%&ligne=%CalledNumber%
// (noms de variables selon la version de 3CX). La console s'ouvre, identifie
// l'appelant et choisit la filière d'après la ligne appelée (hotline_lignes).
// ============================================================================

import { supabase } from '@/lib/supabaseClient'

export type Filiere = 'PV' | 'THERMIQUE'
export type Motif = 'MISE_EN_SERVICE' | 'EXPLOITATION'
export type Statut = 'OUVERT' | 'EN_COURS' | 'ESCALADE' | 'RESOLU' | 'CLOS'
export type TypeEtape =
  | 'OUVERTURE'
  | 'IDENTIFICATION'
  | 'QUESTION'
  | 'DOCUMENT'
  | 'COMMENTAIRE'
  | 'ESCALADE'
  | 'PRECONISATION'
  | 'RESOLUTION'
  | 'CLOTURE'
  | 'REOUVERTURE'

export const FILIERES: Array<{ value: Filiere; label: string; icon: string }> = [
  { value: 'PV', label: 'Photovoltaïque', icon: '☀️' },
  { value: 'THERMIQUE', label: 'Thermique', icon: '🔥' },
]

export const MOTIFS: Array<{ value: Motif; label: string }> = [
  { value: 'MISE_EN_SERVICE', label: 'Mise en service' },
  { value: 'EXPLOITATION', label: 'Problème en exploitation' },
]

export const STATUTS: Record<Statut, { label: string; tone: string; bg: string }> = {
  OUVERT: { label: 'Ouvert', tone: '#1E4E8C', bg: '#E6EEF9' },
  EN_COURS: { label: 'En cours', tone: '#8A5A11', bg: '#FDF2DD' },
  ESCALADE: { label: 'Escaladé', tone: '#A32C2C', bg: '#FCE9E6' },
  RESOLU: { label: 'Résolu', tone: '#2F6B3A', bg: '#E5F2E7' },
  CLOS: { label: 'Clos', tone: '#4B5563', bg: '#EEEDEA' },
}

export const ETAPE_LIBELLES: Record<TypeEtape, string> = {
  OUVERTURE: 'Ouverture',
  IDENTIFICATION: 'Identification',
  QUESTION: 'Diagnostic',
  DOCUMENT: 'Document envoyé',
  COMMENTAIRE: 'Commentaire',
  ESCALADE: 'Escalade',
  PRECONISATION: 'Préconisation',
  RESOLUTION: 'Résolution',
  CLOTURE: 'Clôture',
  REOUVERTURE: 'Réouverture',
}

export type DocumentLien = { titre: string; type?: string; url?: string }

export type Choix = {
  libelle: string
  /** Nœud suivant ; null = fin de parcours avec préconisation. */
  suivant: string | null
  preconisation?: string
  /** Fin de parcours qui propose l'escalade au niveau supérieur. */
  escalade?: boolean
}

export type Arbre = {
  id: string
  filiere: Filiere
  motif: Motif
  nom: string
  famille: string | null
  actif: boolean
  publie_extranet: boolean
  noeud_racine: string | null
  updated_at?: string
  updated_by?: string | null
}

export type Noeud = {
  id: string
  arbre_id: string
  question: string
  aide: string | null
  documents: DocumentLien[]
  choix: Choix[]
  ordre: number
}

export type Ticket = {
  id: string
  numero: string
  filiere: Filiere
  motif: Motif | null
  statut: Statut
  niveau: number
  source: string
  telephone_appelant: string | null
  ligne_appelee: string | null
  numero_tiers: string | null
  intitule_tiers: string | null
  contact_nom: string | null
  contact_email: string | null
  chantier: string | null
  numero_serie: string | null
  reference_article: string | null
  description: string | null
  preconisation: string | null
  arbre_id: string | null
  ouvert_par: string
  assigne_a: string | null
  opened_at: string
  first_action_at: string | null
  escalated_at: string | null
  resolved_at: string | null
  closed_at: string | null
  updated_at: string
}

export type Etape = {
  id: number
  ticket_id: string
  at: string
  auteur: string
  type: TypeEtape
  libelle: string
  noeud_id: string | null
  details: Record<string, unknown> | null
}

export type Appelant = {
  source: string
  numero_tiers: string | null
  intitule: string | null
  contact: string | null
  telephone: string | null
  ville: string | null
  agence: string | null
  representant: string | null
  /** (02/11/2026) Contact (carnet hotline, SAGE, BLG), sinon fiche tiers. */
  email?: string | null
}

export type TicketHistorique = Pick<
  Ticket,
  | 'id'
  | 'numero'
  | 'filiere'
  | 'motif'
  | 'statut'
  | 'niveau'
  | 'opened_at'
  | 'description'
  | 'preconisation'
  | 'chantier'
  | 'numero_serie'
  | 'contact_nom'
  | 'intitule_tiers'
  | 'numero_tiers'
>

export type DocumentVente = {
  numero_piece: string
  numero_bl: string | null
  date: string
  numero_tiers: string | null
  reference: string | null
  projet: string | null
  montant_ht: number | null
  articles: string[] | null
  series: string[] | null
}

/** (02/11/2026) Trois historiques distincts : client (code tiers), contact
 * (même numéro appelant, ou même contact chez ce client), chantier / machine
 * (même chantier ou même n° de série). */
export type Contexte = {
  ticketsClient: TicketHistorique[]
  ticketsContact: TicketHistorique[]
  ticketsChantier: TicketHistorique[]
  documents: DocumentVente[]
}

export const CONTEXTE_VIDE: Contexte = { ticketsClient: [], ticketsContact: [], ticketsChantier: [], documents: [] }

export type TiersTrouve = {
  numero_tiers: string
  intitule: string | null
  ville: string | null
  code_postal: string | null
  agence: string | null
  telephone: string | null
  email?: string | null
}

export type Ligne = { numero: string; filiere: Filiere; libelle: string; actif: boolean }

// ----------------------------------------------------------------------------
// Formatage
// ----------------------------------------------------------------------------
export function telCle(value: string | null | undefined) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-9) : ''
}

export function fmtTel(value: string | null | undefined) {
  const cle = telCle(value)
  if (!cle) return String(value || '')
  return `0${cle}`.replace(/(\d{2})(?=\d)/g, '$1 ').trim()
}

export function fmtDateHeure(value: string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function fmtHeure(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function fmtDate(value: string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR')
}

export function fmtDuree(debut: string | null | undefined, fin: string | null | undefined) {
  if (!debut || !fin) return '—'
  const ms = new Date(fin).getTime() - new Date(debut).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h ${String(min % 60).padStart(2, '0')}`
  return `${Math.round(h / 24)} j`
}

export function fmtHeures(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  const h = Number(value)
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 48) return `${h.toFixed(1).replace('.', ',')} h`
  return `${(h / 24).toFixed(1).replace('.', ',')} j`
}

export function fmtEuro(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  return Number(value).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

export function libelleFiliere(value: string | null | undefined) {
  return FILIERES.find((f) => f.value === value)?.label || String(value || '—')
}

export function libelleMotif(value: string | null | undefined) {
  return MOTIFS.find((m) => m.value === value)?.label || 'Non renseigné'
}

export function messageErreur(error: unknown) {
  const text = String((error as { message?: string })?.message || error || 'Erreur inconnue')
  if (/hotline_|does not exist|schema cache/i.test(text) && /relation|function|table|schema cache/i.test(text)) {
    return `${text} — la migration 20261102_hotline_technique.sql n’est peut-être pas encore appliquée.`
  }
  return text
}

export function normaliserNoeud(row: Record<string, unknown>): Noeud {
  const docs = Array.isArray(row.documents) ? (row.documents as DocumentLien[]) : []
  const choix = Array.isArray(row.choix) ? (row.choix as Choix[]) : []
  return {
    id: String(row.id),
    arbre_id: String(row.arbre_id),
    question: String(row.question || ''),
    aide: (row.aide as string | null) ?? null,
    documents: docs.map((d) => ({ titre: String(d?.titre || ''), type: d?.type || 'PDF', url: d?.url || '' })),
    choix: choix.map((c) => ({
      libelle: String(c?.libelle || ''),
      suivant: c?.suivant ? String(c.suivant) : null,
      preconisation: c?.preconisation || '',
      escalade: Boolean(c?.escalade),
    })),
    ordre: Number(row.ordre || 0),
  }
}

// ----------------------------------------------------------------------------
// Accès base
// ----------------------------------------------------------------------------
export async function identifierAppelant(telephone: string): Promise<Appelant[]> {
  const { data, error } = await supabase.rpc('hotline_identifier_appelant', { p_telephone: telephone })
  if (error) throw error
  return (Array.isArray(data) ? data : []) as Appelant[]
}

export async function chargerContexte(params: {
  numeroTiers?: string | null
  telephone?: string | null
  chantier?: string | null
  numeroSerie?: string | null
  contactNom?: string | null
}): Promise<Contexte> {
  const { data, error } = await supabase.rpc('hotline_contexte', {
    p_numero_tiers: params.numeroTiers || null,
    p_telephone: params.telephone || null,
    p_chantier: params.chantier || null,
    p_numero_serie: params.numeroSerie || null,
    p_contact_nom: params.contactNom || null,
  })
  if (error) throw error
  const value = (data || {}) as Record<string, unknown>
  const liste = (k: string) => (Array.isArray(value[k]) ? (value[k] as TicketHistorique[]) : [])
  return {
    ticketsClient: liste('tickets_client'),
    ticketsContact: liste('tickets_contact'),
    ticketsChantier: liste('tickets_chantier'),
    documents: Array.isArray(value.documents) ? (value.documents as DocumentVente[]) : [],
  }
}

/** (02/11/2026) Expédition retrouvée par chantier / référence produit / n° de
 * série : commande initiale (CDC), date d'expédition (BL), factures et tous
 * les produits livrés avec ce BL. RPC hotline_livraisons. */
export type LigneLivree = {
  reference_article: string | null
  designation: string | null
  quantite: number | null
  series: string[] | null
  correspond: boolean
}

export type Livraison = {
  numero_bl: string
  date_bl: string | null
  numero_cdc: string | null
  date_cdc: string | null
  factures: string[] | null
  numero_tiers: string | null
  intitule: string | null
  chantier: string | null
  projet: string | null
  depot: string | null
  collaborateur: string | null
  lignes: LigneLivree[]
}

export async function chargerLivraisons(params: {
  numeroTiers?: string | null
  chantier?: string | null
  referenceArticle?: string | null
  numeroSerie?: string | null
}): Promise<Livraison[]> {
  const { data, error } = await supabase.rpc('hotline_livraisons', {
    p_numero_tiers: params.numeroTiers || null,
    p_chantier: params.chantier || null,
    p_reference_article: params.referenceArticle || null,
    p_numero_serie: params.numeroSerie || null,
  })
  if (error) throw error
  return (Array.isArray(data) ? data : []) as Livraison[]
}

/** Aide à la saisie du client : par code tiers (début) ou par nom (contient). */
export async function rechercherTiers(q: string): Promise<TiersTrouve[]> {
  if (q.trim().length < 2) return []
  const { data, error } = await supabase.rpc('hotline_rechercher_tiers', { p_q: q.trim() })
  if (error) throw error
  return (Array.isArray(data) ? data : []) as TiersTrouve[]
}

export async function chargerLignes(): Promise<Ligne[]> {
  const { data, error } = await supabase.from('hotline_lignes').select('*').order('filiere')
  if (error) throw error
  return (data || []) as Ligne[]
}

export async function chargerArbres(options?: { actifsSeulement?: boolean }): Promise<Arbre[]> {
  let query = supabase.from('hotline_arbres').select('*').order('filiere').order('motif').order('nom')
  if (options?.actifsSeulement) query = query.eq('actif', true)
  const { data, error } = await query
  if (error) throw error
  return (data || []) as Arbre[]
}

export async function chargerNoeuds(arbreId: string): Promise<Noeud[]> {
  const { data, error } = await supabase.from('hotline_noeuds').select('*').eq('arbre_id', arbreId).order('ordre')
  if (error) throw error
  return ((data || []) as Record<string, unknown>[]).map(normaliserNoeud)
}

export async function ajouterEtape(
  ticketId: string,
  type: TypeEtape,
  libelle: string,
  extra?: { noeud_id?: string | null; details?: Record<string, unknown> | null },
) {
  const { error } = await supabase.from('hotline_ticket_etapes').insert({
    ticket_id: ticketId,
    type,
    libelle,
    noeud_id: extra?.noeud_id ?? null,
    details: extra?.details ?? null,
  })
  if (error) throw error
}

export async function chargerEtapes(ticketId: string): Promise<Etape[]> {
  const { data, error } = await supabase.from('hotline_ticket_etapes').select('*').eq('ticket_id', ticketId).order('at')
  if (error) throw error
  return (data || []) as Etape[]
}

export async function majTicket(ticketId: string, patch: Partial<Ticket>) {
  const { error } = await supabase
    .from('hotline_tickets')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', ticketId)
  if (error) throw error
}

/** Actions de cycle de vie : met à jour le ticket ET journalise l'étape (les
 * horodatages first_action / escalade / résolution / clôture sont posés par le
 * trigger hotline_etape_horodater). */
export async function escalader(ticket: Pick<Ticket, 'id' | 'niveau'>, motif: string) {
  const niveau = Math.min(3, (ticket.niveau || 1) + 1)
  await majTicket(ticket.id, { niveau, statut: 'ESCALADE' })
  await ajouterEtape(ticket.id, 'ESCALADE', `Escalade niveau ${niveau}${motif ? ` : ${motif}` : ''}`, { details: { niveau } })
  return niveau
}

export async function resoudre(ticketId: string, preconisation: string) {
  await majTicket(ticketId, { statut: 'RESOLU', preconisation: preconisation || null })
  await ajouterEtape(ticketId, 'RESOLUTION', preconisation ? `Résolu : ${preconisation}` : 'Résolu')
}

export async function clore(ticketId: string) {
  await majTicket(ticketId, { statut: 'CLOS' })
  await ajouterEtape(ticketId, 'CLOTURE', 'Ticket clos')
}

export async function rouvrir(ticketId: string) {
  await majTicket(ticketId, { statut: 'EN_COURS' })
  await ajouterEtape(ticketId, 'REOUVERTURE', 'Ticket rouvert')
}

// ----------------------------------------------------------------------------
// Envoi d'un document à l'appelant (02/11/2026)
// ----------------------------------------------------------------------------
// Un lien mailto: ne peut pas porter de pièce jointe. On génère donc un
// brouillon d'e-mail .eml (en-tête « X-Unsent: 1 ») : Outlook l'ouvre comme un
// NOUVEAU message, destinataire, objet, texte et pièce jointe déjà remplis, il
// ne reste qu'à cliquer sur Envoyer.
// Le document est téléchargé depuis son lien ; si le site qui l'héberge
// l'interdit (CORS) ou si le lien est vide, le message part avec le lien dans
// le texte à la place de la pièce jointe.
// Pour qu'Outlook s'ouvre directement : associer les fichiers .eml à Outlook
// (Mac : clic droit sur un .eml › Lire les informations › Ouvrir avec ›
// Microsoft Outlook › Tout modifier ; Windows : Ouvrir avec › Outlook ›
// Toujours).

const MIME_PAR_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  zip: 'application/zip',
  bin: 'application/octet-stream',
  hex: 'application/octet-stream',
  mp4: 'video/mp4',
}

const EXTENSION_PAR_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_PAR_EXTENSION).map(([ext, mime]) => [mime, ext]),
)

function base64Utf8(text: string) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

function base64Blob(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let bin = ''
  const pas = 0x8000
  for (let i = 0; i < bytes.length; i += pas) bin += String.fromCharCode(...bytes.subarray(i, i + pas))
  return btoa(bin)
}

/** Lignes de 76 caractères (RFC 2045). */
function plier(base64: string) {
  return base64.replace(/.{1,76}/g, '$&\r\n').trimEnd()
}

function enTeteUtf8(text: string) {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${base64Utf8(text)}?=`
}

function nomFichier(doc: DocumentLien, mime: string) {
  const depuisUrl = (() => {
    try {
      const chemin = decodeURIComponent(new URL(String(doc.url)).pathname)
      return chemin.split('/').pop() || ''
    } catch {
      return ''
    }
  })()
  const extUrl = /\.([a-z0-9]{2,5})$/i.exec(depuisUrl)?.[1]?.toLowerCase()
  const ext = extUrl || EXTENSION_PAR_MIME[mime] || (doc.type || 'pdf').toLowerCase()
  const base = (doc.titre || 'document').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'document'
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`
}

async function telechargerDocument(doc: DocumentLien) {
  if (!doc.url || !/^https?:\/\//i.test(doc.url)) return null
  try {
    const res = await fetch(doc.url, { mode: 'cors', credentials: 'omit' })
    if (!res.ok) return null
    const blob = await res.blob()
    if (blob.size > 20 * 1024 * 1024) return null // au-delà, le lien est plus raisonnable
    const mime = (blob.type || '').split(';')[0] || 'application/octet-stream'
    return { mime, contenu: base64Blob(await blob.arrayBuffer()) }
  } catch {
    return null
  }
}

/** Crée et télécharge le brouillon .eml. Renvoie si le document a pu être joint. */
export async function creerBrouillonEmail(params: {
  doc: DocumentLien
  destinataire?: string | null
  contactNom?: string | null
  ticketNumero?: string | null
  /** Objet et texte saisis dans la fenêtre d'envoi (sinon textes par défaut). */
  objet?: string | null
  texte?: string | null
}): Promise<{ joint: boolean; fichier: string }> {
  const { doc } = params
  const piece = await telechargerDocument(doc)
  const objet = params.objet || `${params.ticketNumero ? `[${params.ticketNumero}] ` : ''}${doc.titre}`
  const bonjour = params.contactNom ? `Bonjour ${params.contactNom},` : 'Bonjour,'
  const corpsBase =
    params.texte ||
    `${bonjour}\n\nComme convenu au téléphone, vous trouverez ci-joint le document « ${doc.titre} ».\n\nBien cordialement,\nLe support technique CEGECLIM`
  const corps = piece || !doc.url ? corpsBase : `${corpsBase}\n\nLien vers le document « ${doc.titre} » :\n${doc.url}`

  const frontiere = `----=_Hotline_${Date.now().toString(36)}`
  const lignes = [
    'X-Unsent: 1',
    `To: ${params.destinataire || ''}`,
    `Subject: ${enTeteUtf8(objet)}`,
    'MIME-Version: 1.0',
  ]
  if (piece) {
    const fichier = nomFichier(doc, piece.mime)
    lignes.push(
      `Content-Type: multipart/mixed; boundary="${frontiere}"`,
      '',
      `--${frontiere}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      plier(base64Utf8(corps)),
      '',
      `--${frontiere}`,
      `Content-Type: ${piece.mime}; name="${enTeteUtf8(fichier)}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${enTeteUtf8(fichier)}"; filename*=UTF-8''${encodeURIComponent(fichier)}`,
      '',
      plier(piece.contenu),
      '',
      `--${frontiere}--`,
      '',
    )
  } else {
    lignes.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', plier(base64Utf8(corps)), '')
  }

  const fichierEml = `${(objet || 'document').replace(/[\\/:*?"<>|]+/g, ' ').trim()}.eml`
  const url = URL.createObjectURL(new Blob([lignes.join('\r\n')], { type: 'message/rfc822' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fichierEml
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { joint: Boolean(piece), fichier: fichierEml }
}

// ----------------------------------------------------------------------------
// Envoi par la messagerie du poste (02/11/2026, demande d'Arnaud : pas d'envoi
// par un service tiers, le mail part du client de messagerie de l'utilisateur)
// ----------------------------------------------------------------------------
// Un navigateur ne peut pas déposer une pièce jointe dans la messagerie locale.
// - Windows : brouillon .eml (X-Unsent) → Outlook l'ouvre en NOUVEAU message,
//   document déjà joint.
// - Mac / autres : Outlook pour Mac et Apple Mail ouvrent un .eml en lecture
//   seule. On ouvre donc un nouveau message via mailto: (destinataire, objet,
//   texte) et on télécharge le document à côté, à glisser dans le message.

export function posteWindows() {
  return typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)
}

/** Télécharge le document sur le poste. Renvoie le nom du fichier, ou null si
 * le document n'est pas récupérable depuis le navigateur. */
export async function telechargerPieceJointe(doc: DocumentLien): Promise<string | null> {
  const piece = await telechargerDocument(doc)
  if (!piece) return null
  const fichier = nomFichier(doc, piece.mime)
  const octets = Uint8Array.from(atob(piece.contenu), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([octets], { type: piece.mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = fichier
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return fichier
}

/** Ouvre un nouveau message dans la messagerie par défaut du poste. */
export function ouvrirMessagerie(params: { to: string; subject: string; body: string }) {
  const enc = (v: string) => encodeURIComponent(v).replace(/%0A/g, '%0D%0A')
  window.location.href = `mailto:${encodeURIComponent(params.to.trim()).replace(/%40/g, '@')}?subject=${enc(params.subject)}&body=${enc(params.body)}`
}

export function messageEnvoiDocument(doc: DocumentLien, contactNom?: string | null) {
  const bonjour = contactNom ? `Bonjour ${contactNom},` : 'Bonjour,'
  return `${bonjour}\n\nComme convenu au téléphone, vous trouverez ci-joint le document « ${doc.titre} ».\n\nBien cordialement,\nLe support technique CEGECLIM`
}
