// ============================================================================
// lib/hiparts.ts — Catalogue Hitachi Hi-Parts côté navigateur (12/11/2026)
// ----------------------------------------------------------------------------
// Copie locale alimentée par /api/hiparts/sync (lib/server/hiparts.ts), tables
// hiparts_* (migration 20261112e_hiparts_catalogue.sql). Utilisé par la console
// hotline (Thermie) : vue éclatée du modèle GE / UI, choix de la pièce, report de
// sa référence et de son prix HT dans le ticket.
// Les images restent hébergées par Hi-Parts (accessibles sans connexion).
// ============================================================================

import { supabase } from '@/lib/supabaseClient'

export const HIPARTS_BASE = 'https://hitachi.spelog.com'

export type HiPartsProduit = {
  idgam: number
  idfam: number
  nom: string
  chemin: string | null
  type_unite: 'GE' | 'UI' | 'AUTRE'
  nb_schemas: number
  exact: boolean
}

export type HiPartsSchema = {
  idscg: number
  idgam: number
  idrub: number | null
  rubrique: string | null
  code: string | null
  libelle: string | null
  image_path: string | null
  ordre: number
  nb_pieces: number | null
}

export type HiPartsPiece = {
  ligne: number
  repere: string | null
  reference: string | null
  designation: string | null
  positions: number[][]
  prix_ht: number | null
  ref_remplacement: string | null
  stock_info: string | null
  prix_maj_le: string | null
}

export type HiPartsAvancement = {
  produits: number
  schemas: number
  pieces: number
  prix: number
  a_faire: number
  erreurs: number
  derniere_relance: string | null
  dernier_passage: string | null
  dernier_message: string | null
}

export async function chercherModelesHiParts(q: string, limite = 15): Promise<HiPartsProduit[]> {
  if (q.replace(/[^A-Za-z0-9]/g, '').length < 3) return []
  const { data, error } = await supabase.rpc('hiparts_chercher_modele', { p_q: q, p_limite: limite })
  if (error) throw error
  return (data || []) as HiPartsProduit[]
}

export async function chargerSchemasHiParts(idgam: number): Promise<HiPartsSchema[]> {
  const { data, error } = await supabase.from('hiparts_schemas').select('*').eq('idgam', idgam).order('ordre')
  if (error) throw error
  return (data || []) as HiPartsSchema[]
}

export async function chargerSchemaHiParts(idscg: number): Promise<HiPartsPiece[]> {
  const { data, error } = await supabase.rpc('hiparts_schema', { p_idscg: idscg })
  if (error) throw error
  const pieces = ((data as { pieces?: HiPartsPiece[] } | null)?.pieces || []) as HiPartsPiece[]
  return pieces.map((p) => ({ ...p, prix_ht: p.prix_ht === null || p.prix_ht === undefined ? null : Number(p.prix_ht), positions: Array.isArray(p.positions) ? p.positions : [] }))
}

export async function avancementHiParts(): Promise<HiPartsAvancement | null> {
  const { data, error } = await supabase.rpc('hiparts_avancement')
  if (error) throw error
  return (data || null) as HiPartsAvancement | null
}

export function imageHiParts(chemin: string | null | undefined): string | null {
  if (!chemin) return null
  if (/^https?:\/\//i.test(chemin)) return chemin
  return `${HIPARTS_BASE}${chemin.startsWith('/') ? '' : '/'}${chemin.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/')}`
}

export function lienSchemaHiParts(idscg: number) {
  return `${HIPARTS_BASE}/FicheSchema.aspx?IDSCG=${idscg}`
}

export function lienProduitHiParts(p: { idgam: number; idfam: number }) {
  return `${HIPARTS_BASE}/FicheProduit.aspx?IDGAM=${p.idgam}&IDFAM=${p.idfam}`
}

function euro(v: number | null) {
  return v === null ? 'prix non disponible' : `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € HT`
}

/** Ligne reportée dans le corps du ticket. */
export function ligneTicketHiParts(d: { piece: HiPartsPiece; produit: string; schema: HiPartsSchema | null; quantite: number }) {
  const { piece, produit, schema, quantite } = d
  const vue = schema ? schema.rubrique || schema.libelle || schema.code : null
  const total = piece.prix_ht !== null && quantite > 1 ? ` (total ${euro(Math.round(piece.prix_ht * quantite * 100) / 100)})` : ''
  return [
    `Pièce Hi-Parts : ${piece.reference || 'réf. ?'} — ${piece.designation || ''}`.trim(),
    `repère ${piece.repere || '?'} · ${produit}${vue ? ` (${vue})` : ''}`,
    `qté ${quantite} · prix unitaire ${euro(piece.prix_ht)}${total}`,
    piece.ref_remplacement ? `remplacée par ${piece.ref_remplacement}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}
