'use client'

// ============================================================================
// lib/actualites.ts — Fil d'actualité et nouveautés du compagnon (13/10/2026)
// ----------------------------------------------------------------------------
// Données : tables public.actualites / actualites_lectures /
// actualites_redacteurs, RPC get_actualites_flux et actualites_marquer,
// bucket privé « actualites » pour les impressions d'écran
// (supabase/sql/20261013_fil_actualite_nouveautes.sql).
//
// Contenu d'une publication = liste de blocs (pas de HTML stocké) rendue par
// components/actualites/ActualiteContent.tsx.
//
// ÉVOLUTION (2026-10-14) : publications ciblées par plateforme (colonne
// plateformes = 'pc' et/ou 'mobile', supabase/sql/20261014_actualites_
// plateformes.sql). Le PC lit fetchFlux({ plateforme: 'pc' }), le Compagnon
// mobile fetchFlux({ plateforme: 'mobile' }). Tant que le script n'est pas
// exécuté, l'ancienne fonction à deux paramètres est utilisée et tout
// s'affiche partout.
//
// ÉVOLUTION (2026-10-15) : bloc « Tableau stock en direct » (type 'stock') —
// une liste de références (+ remarque libre par ligne) dont les chiffres
// (dispo, stock, réservé, en commande, arrivages) sont lus dans SAGE à
// l'affichage par la RPC get_stock_actualite : la publication reste à jour
// sans être modifiée. Son titre ouvre l'écran Stock sur le groupe d'articles
// correspondant (stockGroupeUrl), groupe créé automatiquement à la
// publication (trigger actualites_sync_groupes_stock,
// supabase/sql/20261015_actualites_blocs_stock.sql).
// ============================================================================

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { ThemeMode } from '@/lib/theme'

export type ActualiteType = 'actualite' | 'nouveaute'
export type ActualiteStatut = 'brouillon' | 'publie' | 'archive'
export type Plateforme = 'pc' | 'mobile'
export const PLATEFORMES_DEFAUT: Plateforme[] = ['pc', 'mobile']

export type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'list'; ordered?: boolean; items: string[] }
  | { type: 'table'; rows: string[][]; header?: boolean }
  /** pleineLargeur (26/10/2026) : pas de hauteur maximale — pour une infographie haute à lire en entier. */
  | { type: 'image'; path: string; caption?: string; pleineLargeur?: boolean }
  | { type: 'callout'; title?: string; text: string; tone?: 'info' | 'alerte' }
  | { type: 'link'; label: string; url: string }
  | StockBlock

export type BlockType = Block['type']

// ── Bloc « Tableau stock en direct » ─────────────────────────────────────────
/** Colonnes facultatives (Référence, Dispo et Désignation sont toujours affichées). */
export type StockColonne = 'stock' | 'reserve' | 'commande' | 'arrivages'
export const STOCK_COLONNES: Array<{ key: StockColonne; label: string }> = [
  { key: 'stock', label: 'Stock' },
  { key: 'reserve', label: 'Réservé (CDC + PL)' },
  { key: 'commande', label: 'En commande' },
  { key: 'arrivages', label: 'Arrivages (dates SAGE)' },
]
export const STOCK_COLONNES_DEFAUT: StockColonne[] = ['stock', 'reserve', 'commande', 'arrivages']

export type StockBlock = {
  type: 'stock'
  /** Titre affiché (cliquable vers l'écran Stock). */
  titre: string
  /** Nom du groupe d'articles ; à défaut, le titre. */
  groupe?: string
  /** Une ligne par référence, avec une remarque libre (« bonne affaire », « allocation »…). */
  lignes: Array<{ ref: string; note?: string }>
  colonnes?: StockColonne[]
}

export type StockLigneDirect = {
  reference_article: string
  designation: string | null
  stock: number
  reserve: number
  dispo: number
  en_commande: number
  arrivages: Array<{ date: string | null; q: number; statut: string }>
  maj: string | null
}

export function stockBlockRefs(block: Pick<StockBlock, 'lignes'>) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const ligne of block.lignes || []) {
    const ref = String(ligne?.ref || '').trim().toUpperCase()
    if (ref && !seen.has(ref)) {
      seen.add(ref)
      out.push(ref)
    }
  }
  return out
}

export function stockBlockGroupe(block: Pick<StockBlock, 'groupe' | 'titre'>) {
  return (String(block.groupe || '').trim() || String(block.titre || '').trim()).slice(0, 120)
}

/** Lien vers l'écran Stock, sélection du groupe (références en secours si le groupe n'existe pas encore). */
export function stockGroupeUrl(groupe: string, refs: string[]) {
  const params = new URLSearchParams()
  if (groupe) params.set('groupe', groupe)
  if (refs.length) params.set('refs', refs.join(','))
  return `/stock?${params.toString()}`
}

// Ouverture de l'écran Stock depuis une publication lue dans le Compagnon
// mobile : MobileShell (quand il est monté) empile son écran Stock avec la
// sélection au lieu de quitter le Compagnon.
export const MOBILE_OPEN_STOCK_EVENT = 'cegeclim:mobile-open-stock'
export type MobileOpenStockDetail = { groupe?: string; refs?: string[]; ref?: string }

declare global {
  interface Window {
    /** Posé par MobileShell quand il est monté : il prend en charge l'ouverture du stock. */
    __cgcMobileShellStock?: boolean
  }
}

/** Ouvre l'écran Stock (groupe, liste ou référence) : dans le Compagnon si possible, sinon par l'adresse. */
export function ouvrirStock(detail: MobileOpenStockDetail, push: (href: string) => void) {
  if (typeof window !== 'undefined' && window.__cgcMobileShellStock) {
    window.dispatchEvent(new CustomEvent<MobileOpenStockDetail>(MOBILE_OPEN_STOCK_EVENT, { detail }))
    return
  }
  if (detail.ref) {
    push(`/stock?ref=${encodeURIComponent(detail.ref)}`)
    return
  }
  push(stockGroupeUrl(detail.groupe || '', detail.refs || []))
}

let stockRpcAbsente = false

/** Chiffres SAGE en direct des références d'un bloc stock (null = RPC pas encore installée). */
export async function fetchStockDirect(refs: string[]): Promise<StockLigneDirect[] | null> {
  if (refs.length === 0 || stockRpcAbsente) return stockRpcAbsente ? null : []
  const { data, error } = await supabase.rpc('get_stock_actualite', { p_references: refs })
  if (error) {
    if (/get_stock_actualite|function|schema cache|PGRST202/i.test(`${error.message} ${error.code || ''}`)) {
      stockRpcAbsente = true
      return null
    }
    throw error
  }
  return ((data || []) as Record<string, unknown>[]).map((row) => ({
    reference_article: String(row.reference_article || ''),
    designation: (row.designation as string | null) ?? null,
    stock: Number(row.stock) || 0,
    reserve: Number(row.reserve) || 0,
    dispo: Number(row.dispo) || 0,
    en_commande: Number(row.en_commande) || 0,
    arrivages: Array.isArray(row.arrivages)
      ? (row.arrivages as Array<Record<string, unknown>>).map((a) => ({
          date: a.date ? String(a.date).slice(0, 10) : null,
          q: Number(a.q) || 0,
          statut: String(a.statut || ''),
        }))
      : [],
    maj: (row.maj as string | null) ?? null,
  }))
}

export type Actualite = {
  id: string
  type: ActualiteType
  titre: string
  categorie: string | null
  resume: string | null
  contenu: Block[]
  statut: ActualiteStatut
  date_diffusion: string
  afficher_bandeau: boolean
  bandeau_jusquau: string | null
  epingle: boolean
  cible_agences: string[]
  /** Équipes destinataires (todo_teams.id). Vide = pas de restriction par équipe. */
  cible_equipes: string[]
  plateformes: Plateforme[]
  auteur_email: string
  auteur_nom: string | null
  updated_at: string
  lu: boolean
  masque_bandeau: boolean
  dans_bandeau: boolean
}

/** Événement envoyé quand une publication change (publiée, masquée, lue…) :
 * le bandeau et l'icône Nouveautés se rechargent. */
export const ACTUALITES_CHANGED_EVENT = 'cegeclim:actualites-changed'

export function notifyActualitesChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ACTUALITES_CHANGED_EVENT))
}

export const ACTUALITES_PATH = '/actualites'
export const ACTUALITES_EDIT_PATH = '/actualites/editer'
export const ACTUALITES_BUCKET = 'actualites'

// ── Catégories ───────────────────────────────────────────────────────────────
type CategoryTone = { dark: { bg: string; fg: string }; light: { bg: string; fg: string } }

const CATEGORY_TONES: Record<string, CategoryTone> = {
  'Dispo': { dark: { bg: '#7EE0A6', fg: '#06301A' }, light: { bg: '#DDF3E5', fg: '#17673A' } },
  'Pénurie': { dark: { bg: '#FF9B9B', fg: '#2A0D0D' }, light: { bg: '#FBE4E3', fg: '#8F1D14' } },
  'Opération': { dark: { bg: '#9CC3FF', fg: '#0B1A33' }, light: { bg: '#DCE7FA', fg: '#1B3F8A' } },
  'Produit': { dark: { bg: '#C8B8FF', fg: '#1E1240' }, light: { bg: '#ECE6FB', fg: '#4B2E9A' } },
  'Tarifs': { dark: { bg: '#F5C77A', fg: '#2E1E00' }, light: { bg: '#FBEBCB', fg: '#7A4F08' } },
  'Logistique': { dark: { bg: '#F2D27A', fg: '#2B2200' }, light: { bg: '#F8EDCB', fg: '#6A4E08' } },
  'Outil': { dark: { bg: '#B9E6A8', fg: '#112A08' }, light: { bg: '#E2F2DA', fg: '#2F5A1E' } },
  'Nouveauté': { dark: { bg: '#F0B08F', fg: '#2E1205' }, light: { bg: '#F6E3DA', fg: '#8C3F26' } },
  'Info': { dark: { bg: '#C9CFDA', fg: '#141A26' }, light: { bg: '#E8EAEF', fg: '#3A4252' } },
}

export const ACTUALITE_CATEGORIES = ['Dispo', 'Pénurie', 'Opération', 'Produit', 'Tarifs', 'Logistique', 'Outil', 'Info']

export function categoryTone(categorie: string | null | undefined, theme: ThemeMode) {
  const tone = CATEGORY_TONES[String(categorie || '').trim()] || CATEGORY_TONES.Info
  return theme === 'light' ? tone.light : tone.dark
}

// ── Dates ────────────────────────────────────────────────────────────────────
export function formatDateCourte(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' })
}

export function formatDateDiffusion(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' })
}

export function formatDateLongue(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })
}

/** Temps de lecture estimé (≈ 220 mots / minute). */
export function tempsLecture(actu: Pick<Actualite, 'titre' | 'contenu'>) {
  const words = blocksPlainText(actu.contenu).split(/\s+/).filter(Boolean).length
  const minutes = Math.max(1, Math.round(words / 220))
  return `${minutes} min`
}

export function blocksPlainText(blocks: Block[] | null | undefined): string {
  return (blocks || [])
    .map((b) => {
      switch (b.type) {
        case 'paragraph':
        case 'heading':
          return b.text
        case 'list':
          return b.items.join(' ')
        case 'table':
          return b.rows.map((r) => r.join(' ')).join(' ')
        case 'callout':
          return `${b.title || ''} ${b.text}`
        case 'link':
          return b.label
        case 'image':
          return b.caption || ''
        case 'stock':
          return `${b.titre || ''} ${(b.lignes || []).map((l) => `${l.ref} ${l.note || ''}`).join(' ')}`
        default:
          return ''
      }
    })
    .join(' ')
    .replace(/\*\*|\*|\[([^\]]*)\]\([^)]*\)/g, '$1')
}

/** Résumé saisi, sinon début du premier paragraphe. */
export function resumeOf(actu: Pick<Actualite, 'resume' | 'contenu'>, max = 160) {
  const text = (actu.resume || '').trim() || blocksPlainText(actu.contenu).trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function normalizeBlocks(value: unknown): Block[] {
  return Array.isArray(value) ? (value as Block[]).filter((b) => b && typeof b === 'object' && 'type' in b) : []
}

function normalizeRow(row: Record<string, unknown>): Actualite {
  return {
    ...(row as unknown as Actualite),
    contenu: normalizeBlocks(row.contenu),
    cible_agences: Array.isArray(row.cible_agences) ? (row.cible_agences as string[]) : [],
    cible_equipes: Array.isArray(row.cible_equipes) ? (row.cible_equipes as string[]) : [],
    plateformes:
      Array.isArray(row.plateformes) && row.plateformes.length > 0
        ? (row.plateformes as Plateforme[])
        : [...PLATEFORMES_DEFAUT],
  }
}

// ── Lecture / écriture ───────────────────────────────────────────────────────
let plateformeRpcDisponible = true

export async function fetchFlux(
  options: { type?: ActualiteType | null; publieesSeulement?: boolean; plateforme?: Plateforme | null } = {}
) {
  const base = {
    p_type: options.type ?? null,
    p_publiees_seulement: options.publieesSeulement ?? true,
  }
  const plateforme = options.plateforme ?? null

  if (plateforme && plateformeRpcDisponible) {
    const { data, error } = await supabase.rpc('get_actualites_flux', { ...base, p_plateforme: plateforme })
    if (!error) return ((data || []) as Record<string, unknown>[]).map(normalizeRow)
    // Script 20261014 pas encore exécuté : la fonction n'a que deux paramètres.
    if (!/p_plateforme|function|schema cache|PGRST202/i.test(`${error.message} ${error.code || ''}`)) throw error
    plateformeRpcDisponible = false
  }

  const { data, error } = await supabase.rpc('get_actualites_flux', base)
  if (error) throw error
  const rows = ((data || []) as Record<string, unknown>[]).map(normalizeRow)
  return plateforme ? rows.filter((row) => row.plateformes.includes(plateforme)) : rows
}

export type EquipeActualite = { id: string; name: string; color: string }

/** Équipes actives (paramétrage des tâches) utilisables comme destinataires. */
export async function fetchEquipesActualite(): Promise<EquipeActualite[]> {
  const { data, error } = await supabase
    .from('todo_teams')
    .select('id, name, color, is_active, sort_order')
    .order('sort_order')
  if (error) return []
  return ((data || []) as { id: string; name: string; color: string | null; is_active: boolean | null }[])
    .filter((t) => t.is_active !== false)
    .map((t) => ({ id: t.id, name: t.name, color: t.color || '#2C6F88' }))
}

/** Libellé des destinataires : « Tous », « Agences : … », « Équipes : … ». */
export function libelleDestinataires(actu: Pick<Actualite, 'cible_agences' | 'cible_equipes'>, equipes: EquipeActualite[]) {
  const parts: string[] = []
  if (actu.cible_equipes.length > 0) {
    const noms = actu.cible_equipes.map((id) => equipes.find((e) => e.id === id)?.name || 'équipe supprimée')
    parts.push(`équipes : ${noms.join(', ')}`)
  }
  if (actu.cible_agences.length > 0) parts.push(`agences : ${actu.cible_agences.join(', ')}`)
  return parts.join(' · ')
}

export function libellePlateformes(plateformes: Plateforme[]) {
  if (plateformes.includes('pc') && plateformes.includes('mobile')) return 'PC et mobile'
  return plateformes.includes('mobile') ? 'Mobile uniquement' : 'PC uniquement'
}

export async function marquerActualites(ids: string[], options: { lu?: boolean | null; masque?: boolean | null }) {
  if (ids.length === 0) return
  const { error } = await supabase.rpc('actualites_marquer', {
    p_ids: ids,
    p_lu: options.lu === undefined ? null : options.lu,
    p_masque: options.masque === undefined ? null : options.masque,
  })
  if (error) throw error
  notifyActualitesChanged()
}

export async function fetchActualite(id: string) {
  const { data, error } = await supabase.from('actualites').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data ? normalizeRow(data as Record<string, unknown>) : null
}

/** Droit de publier (administrateur ou rédacteur déclaré). */
export function usePeutPublier() {
  const [peutPublier, setPeutPublier] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [pub, adm] = await Promise.all([
        supabase.rpc('actualites_peut_publier'),
        supabase.rpc('todo_is_admin'),
      ])
      if (cancelled) return
      setPeutPublier(Boolean(pub.data) && !pub.error)
      setIsAdmin(Boolean(adm.data) && !adm.error)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { peutPublier, isAdmin, loading }
}

// ── Images ───────────────────────────────────────────────────────────────────
export async function uploadActualiteImage(file: File | Blob, fileName?: string) {
  const mime = file.type || 'image/png'
  const ext = (fileName?.split('.').pop() || mime.split('/')[1] || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const now = new Date()
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${now.getTime()}-${Math.random().toString(16).slice(2)}`
  const path = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${id}.${ext}`
  const { error } = await supabase.storage.from(ACTUALITES_BUCKET).upload(path, file, { contentType: mime, upsert: false })
  if (error) throw error
  return path
}

const signedCache = new Map<string, { url: string; expires: number }>()
const SIGNED_TTL_SECONDS = 3600

/** URLs signées (1 h) des images d'une publication, mises en cache. */
export function useSignedImages(paths: string[]) {
  const key = paths.slice().sort().join('|')
  const [urls, setUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    const now = Date.now()
    const missing = paths.filter((p) => {
      const hit = signedCache.get(p)
      return !hit || hit.expires < now + 60_000
    })

    const fromCache = () => {
      const out: Record<string, string> = {}
      for (const p of paths) {
        const hit = signedCache.get(p)
        if (hit) out[p] = hit.url
      }
      return out
    }

    if (missing.length === 0) {
      setUrls(fromCache())
      return
    }

    void (async () => {
      const { data } = await supabase.storage.from(ACTUALITES_BUCKET).createSignedUrls(missing, SIGNED_TTL_SECONDS)
      for (const item of data || []) {
        if (item.path && item.signedUrl) signedCache.set(item.path, { url: item.signedUrl, expires: now + SIGNED_TTL_SECONDS * 1000 })
      }
      if (!cancelled) setUrls(fromCache())
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return urls
}

// ── Liens sûrs ───────────────────────────────────────────────────────────────
/** Seuls http(s), mailto et les chemins internes (« /stock/penurie ») sont acceptés. */
export function safeUrl(url: string | null | undefined): string | null {
  const value = String(url || '').trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value) || /^mailto:/i.test(value)) return value
  if (value.startsWith('/') && !value.startsWith('//')) return value
  if (/^www\./i.test(value)) return `https://${value}`
  return null
}

export function isInternalUrl(url: string) {
  return url.startsWith('/') && !url.startsWith('//')
}
