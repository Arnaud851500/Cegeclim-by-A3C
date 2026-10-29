'use client'

// ============================================================================
// app/controle-sage-blg/activite-sage-blg/page.tsx
// Écran « Activité SAGE ↔ statuts BLG » (Projet BLG) — 29/10/2026
// ----------------------------------------------------------------------------
// Part de l'activité SAGE en cours (CDC, PL, BL, BR non facturés —
// public.activite_lignes) et range chaque pièce selon le statut BLG de la
// commande correspondante, regroupé comme le panneau gauche de la liste des
// ventes BLG (Devis, Devis validé, Commande validée, En cours, À facturer,
// Terminée, Archives) + « CDC absente de BLG » et « Sans CDC (non rattaché) ».
//
//  - Matrice : une ligne par type SAGE (sous-total) et, sous chaque type, les
//    pièces rattachées à une CDC / non rattachées ; une colonne par groupe BLG.
//    Chaque cellule et chaque sous-total est cliquable.
//  - Liste : pièces SAGE de la sélection (n°, client, agence, nb lignes,
//    valeur, état SAGE, commentaire, dates…) et leur pendant BLG (CDC BLG,
//    statut, livraison / facturation, nb lignes, montant, BL BLG, client).
//
// SQL : supabase/migrations/20261029_activite_sage_blg_statuts.sql
//   get_activite_sage_blg_matrice(p_date_from, p_date_to, p_agence)
//   get_activite_sage_blg_liste(p_type, p_rattache, p_groupe_code, p_date_from, p_date_to, p_agence)
//   public.blg_statut_vente = libellés des status_fk BLG (éditable).
// URL : ?type=PL&rattache=0&groupe=SANS_CDC&agence=PAU&du=2026-10-01&au=2026-10-31
// À déclarer dans lib/navigation.ts (bloc Projet BLG, droit can_projetblg).
// ============================================================================

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'
import { themed, tc } from '@/lib/theme'

// ── Types ────────────────────────────────────────────────────────────────────
type TypeCode = 'CDC' | 'PL' | 'BL' | 'BR'

type MatriceRow = {
  type_code: TypeCode
  type_ordre: number
  rattache_cdc: boolean
  blg_groupe_code: string
  blg_groupe_libelle: string
  blg_groupe_ordre: number
  nb_docs: number
  nb_lignes: number
  montant_ht: number
}

type MatricePayload = {
  imported_at: string | null
  rows: MatriceRow[]
  agences: string[]
  /** Sous-totaux en pièces distinctes, clé type|rattache|groupe ('*' = tous). */
  totaux: { cle: string; nb_docs: number }[]
  statuts: { status_fk: number; libelle: string; ordre: number; a_qualifier: boolean }[]
}

type ListeRow = {
  type_code: TypeCode
  numero_piece: string
  cdc_reference: string | null
  rattache_cdc: boolean
  numero_tiers: string | null
  intitule_tiers: string | null
  agence: string | null
  collaborateur: string | null
  date_piece: string | null
  date_livraison: string | null
  depot: string | null
  nb_lignes: number
  quantite: number | null
  montant_ht: number | null
  etat_sage: string | null
  etat_sage_libelle: string | null
  reference_client: string | null
  commentaire: string | null
  expedition: string | null
  lieu_livraison: string | null
  blg_id: number | null
  blg_document_id: string | null
  blg_reference: string | null
  blg_groupe_code: string
  blg_groupe_libelle: string
  blg_delivery_status: string | null
  blg_invoice_status: string | null
  blg_order_date: string | null
  blg_created_at: string | null
  blg_date_livraison: string | null
  blg_montant_ht: number | null
  blg_nb_lignes: number | null
  blg_nb_lignes_a_livrer: number | null
  blg_quantite: number | null
  blg_client_ok: boolean | null
  blg_bl_reference: string | null
  blg_bl_date: string | null
}

type Selection = {
  type: TypeCode | null
  rattache: boolean | null
  groupe: string | null
}

type Metric = 'docs' | 'lignes' | 'montant'

type SortKey =
  | 'numero_piece' | 'date_piece' | 'date_livraison' | 'intitule_tiers' | 'agence'
  | 'nb_lignes' | 'montant_ht' | 'blg_groupe_libelle' | 'ecart_montant' | 'cdc_reference'

// ── Constantes ───────────────────────────────────────────────────────────────
const TYPES: { code: TypeCode; label: string; long: string }[] = [
  { code: 'CDC', label: 'CDC', long: 'Bons de commande' },
  { code: 'PL', label: 'PL', long: 'Préparations de livraison' },
  { code: 'BL', label: 'BL', long: 'Bons de livraison (non facturés)' },
  { code: 'BR', label: 'BR', long: 'Bons de retour' },
]

const GROUPE_COLORS: Record<string, string> = {
  S56: '#8C93A8', // Devis
  S40: '#7FB7CB', // Devis validé
  S48: '#7A5EA8', // Commande validée
  S43: '#A6A181', // Commande en cours
  S45: '#D69A4A', // Commande à facturer
  S42: '#4E9A6B', // Commande terminée
  ARCHIVE: '#6B7280',
  ABSENT: '#C1683C',
  SANS_CDC: '#E07A4E',
}

const LIVRAISON_LABELS: Record<string, string> = {
  notDelivered: 'Non livré',
  partiallyDelivered: 'Part. livré',
  delivered: 'Livré',
  notConcerned: 'Non concerné',
}

const FACTURATION_LABELS: Record<string, string> = {
  notInvoiced: 'Non facturé',
  partiallyInvoiced: 'Part. facturé',
  invoiced: 'Facturé',
}

// ── Utilitaires ──────────────────────────────────────────────────────────────
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const nfEur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const nfEur2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v)
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1900) return '—'
  return d.toLocaleDateString('fr-FR')
}

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function groupeColor(code: string): string {
  return GROUPE_COLORS[code] || '#9AA3B5'
}

function selectionLabel(sel: Selection, groupes: Map<string, string>): string {
  const parts: string[] = []
  parts.push(sel.type ? (TYPES.find((t) => t.code === sel.type)?.long ?? sel.type) : 'Toutes les pièces')
  if (sel.rattache === true) parts.push('rattachées à une CDC')
  if (sel.rattache === false) parts.push('non rattachées à une CDC')
  if (sel.groupe) parts.push(`BLG : ${groupes.get(sel.groupe) ?? sel.groupe}`)
  return parts.join(' · ')
}

function ecartMontant(r: ListeRow): number | null {
  // Montant comparable seulement quand la pièce SAGE est la CDC elle-même.
  if (r.type_code !== 'CDC' || r.blg_montant_ht == null || r.montant_ht == null) return null
  return Math.round((num(r.montant_ht) - num(r.blg_montant_ht)) * 100) / 100
}

function parseBoolParam(v: string | null): boolean | null {
  if (v === '1' || v === 'true') return true
  if (v === '0' || v === 'false') return false
  return null
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = themed({
  page: { padding: '20px 24px 48px', color: '#F5F3EC', fontFamily: '"IBM Plex Sans", system-ui, sans-serif', minHeight: '100vh', background: '#0B1220' },
  header: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18 },
  title: { margin: 0, fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 26, fontWeight: 700, letterSpacing: -0.3, color: '#ffffff' },
  subtitle: { margin: '6px 0 0', fontSize: 13, color: 'rgba(245,243,236,0.62)', maxWidth: 900, lineHeight: 1.5 },
  fresh: { fontSize: 12, color: 'rgba(245,243,236,0.55)', fontFamily: '"IBM Plex Mono", monospace' },
  toolbar: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', margin: '0 0 16px', padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' },
  label: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: 'rgba(245,243,236,0.55)', marginRight: 4 },
  input: { background: 'rgba(11,18,32,0.9)', color: '#F5F3EC', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, padding: '7px 10px', fontSize: 13 },
  btn: { background: 'rgba(255,255,255,0.08)', color: '#F5F3EC', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer' },
  btnPrimary: { background: '#A6A181', color: '#0B1220', border: '1px solid #A6A181', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  seg: { display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.16)' },
  segBtn: { background: 'transparent', color: 'rgba(245,243,236,0.75)', border: 'none', padding: '7px 11px', fontSize: 12, cursor: 'pointer' },
  segBtnOn: { background: 'rgba(166,161,129,0.28)', color: '#ffffff', border: 'none', padding: '7px 11px', fontSize: 12, cursor: 'pointer', fontWeight: 600 },
  card: { borderRadius: 14, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' },
  cardHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  cardTitle: { margin: 0, fontSize: 15, fontWeight: 600, color: '#ffffff', fontFamily: '"Space Grotesk", system-ui, sans-serif' },
  scroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { position: 'sticky', top: 0, background: '#101A2E', color: 'rgba(245,243,236,0.7)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, padding: '9px 10px', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' },
  thNum: { position: 'sticky', top: 0, background: '#101A2E', color: 'rgba(245,243,236,0.7)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, padding: '9px 10px', textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', verticalAlign: 'top' },
  tdNum: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', verticalAlign: 'top' },
  mono: { fontFamily: '"IBM Plex Mono", monospace', fontSize: 12 },
  muted: { color: 'rgba(245,243,236,0.5)', fontSize: 12 },
  cell: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'right', cursor: 'pointer', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  cellOn: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'right', cursor: 'pointer', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', background: 'rgba(166,161,129,0.22)', boxShadow: 'inset 0 0 0 1px #A6A181' },
  cellEmpty: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'right', color: 'rgba(245,243,236,0.2)' },
  rowType: { background: 'rgba(255,255,255,0.05)' },
  rowLabel: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', whiteSpace: 'nowrap' },
  rowLabelOn: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', whiteSpace: 'nowrap', background: 'rgba(166,161,129,0.22)', boxShadow: 'inset 0 0 0 1px #A6A181' },
  big: { fontSize: 15, fontWeight: 600, color: '#ffffff' },
  small: { display: 'block', fontSize: 11, color: 'rgba(245,243,236,0.5)', marginTop: 2 },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' },
  tag: { display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 11, background: 'rgba(255,255,255,0.08)', color: 'rgba(245,243,236,0.8)', marginRight: 4, whiteSpace: 'nowrap' },
  ok: { color: '#7FC79A', fontWeight: 600 },
  ko: { color: '#E07A4E', fontWeight: 600 },
  warn: { color: '#E0A961', fontWeight: 600 },
  error: { padding: '12px 14px', borderRadius: 10, background: 'rgba(193,104,60,0.15)', border: '1px solid rgba(193,104,60,0.5)', color: '#E07A4E', marginBottom: 16, fontSize: 13 },
  note: { fontSize: 12, color: 'rgba(245,243,236,0.55)', padding: '10px 16px', lineHeight: 1.5 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 16 },
  kpi: { padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' },
  kpiOn: { padding: '12px 14px', borderRadius: 12, background: 'rgba(166,161,129,0.18)', border: '1px solid #A6A181', cursor: 'pointer' },
  kpiLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'rgba(245,243,236,0.6)' },
  kpiValue: { fontSize: 22, fontWeight: 700, color: '#ffffff', fontFamily: '"Space Grotesk", system-ui, sans-serif', marginTop: 4 },
  kpiSub: { fontSize: 12, color: 'rgba(245,243,236,0.55)', marginTop: 2 },
  sortable: { cursor: 'pointer', userSelect: 'none' },
})

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ActiviteSageBlgPage() {
  return (
    <Suspense fallback={<div style={s.page}>Chargement…</div>}>
      <ActiviteSageBlgContent />
    </Suspense>
  )
}

function ActiviteSageBlgContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Filtres (initialisés depuis l'URL)
  const [agence, setAgence] = useState<string>(searchParams.get('agence') ?? '')
  const [dateFrom, setDateFrom] = useState<string>(searchParams.get('du') ?? '')
  const [dateTo, setDateTo] = useState<string>(searchParams.get('au') ?? '')
  const [metric, setMetric] = useState<Metric>('docs')

  const [selection, setSelection] = useState<Selection>(() => {
    const t = searchParams.get('type')
    return {
      type: t && ['CDC', 'PL', 'BL', 'BR'].includes(t) ? (t as TypeCode) : null,
      rattache: parseBoolParam(searchParams.get('rattache')),
      groupe: searchParams.get('groupe'),
    }
  })
  const hasSelection = selection.type !== null || selection.rattache !== null || selection.groupe !== null

  // Données : chaque réponse est mémorisée avec la clé de requête qui l'a
  // produite ; « en chargement » = la clé courante n'a pas encore de réponse.
  const [refreshTick, setRefreshTick] = useState(0)
  const matriceKey = JSON.stringify([agence, dateFrom, dateTo, refreshTick])
  const listeKey = JSON.stringify([selection, agence, dateFrom, dateTo, refreshTick])
  const [matriceState, setMatriceState] = useState<{ key: string; data: MatricePayload | null; error: string | null } | null>(null)
  const [listeState, setListeState] = useState<{ key: string; rows: ListeRow[]; error: string | null } | null>(null)
  const matrice = matriceState?.data ?? null
  const loadingMatrice = matriceState?.key !== matriceKey
  const rows = useMemo(() => (hasSelection ? listeState?.rows ?? [] : []), [hasSelection, listeState])
  const loadingListe = hasSelection && listeState?.key !== listeKey
  const error = matriceState?.error ?? (hasSelection ? listeState?.error : null) ?? null

  // Liste : recherche + tri + filtres d'écart
  const [search, setSearch] = useState('')
  const [onlyEcart, setOnlyEcart] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('date_piece')
  const [sortAsc, setSortAsc] = useState(false)
  const [limit, setLimit] = useState(300)

  // ── Synchronisation de l'URL ──────────────────────────────────────────────
  useEffect(() => {
    const p = new URLSearchParams()
    if (selection.type) p.set('type', selection.type)
    if (selection.rattache !== null) p.set('rattache', selection.rattache ? '1' : '0')
    if (selection.groupe) p.set('groupe', selection.groupe)
    if (agence) p.set('agence', agence)
    if (dateFrom) p.set('du', dateFrom)
    if (dateTo) p.set('au', dateTo)
    const qs = p.toString()
    router.replace(qs ? `?${qs}` : '?', { scroll: false })
  }, [selection, agence, dateFrom, dateTo, router])

  // ── Chargement de la matrice ──────────────────────────────────────────────
  useEffect(() => {
    let active = true
    const key = matriceKey
    supabase
      .rpc('get_activite_sage_blg_matrice', {
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_agence: agence || null,
      })
      .then(({ data, error: err }) => {
        if (!active) return
        if (err) {
          setMatriceState({ key, data: null, error: `Matrice : ${err.message}` })
          return
        }
        const payload = (data ?? {}) as Partial<MatricePayload>
        setMatriceState({
          key,
          error: null,
          data: {
            imported_at: payload.imported_at ?? null,
            rows: (payload.rows ?? []).map((r) => ({
              ...r,
              nb_docs: num(r.nb_docs),
              nb_lignes: num(r.nb_lignes),
              montant_ht: num(r.montant_ht),
            })),
            agences: payload.agences ?? [],
            totaux: (payload.totaux ?? []).map((t) => ({ cle: t.cle, nb_docs: num(t.nb_docs) })),
            statuts: payload.statuts ?? [],
          },
        })
      })
    return () => {
      active = false
    }
  }, [matriceKey, agence, dateFrom, dateTo])

  // ── Chargement de la liste ────────────────────────────────────────────────
  useEffect(() => {
    if (!hasSelection) return
    let active = true
    const key = listeKey
    supabase
      .rpc('get_activite_sage_blg_liste', {
        p_type: selection.type,
        p_rattache: selection.rattache,
        p_groupe_code: selection.groupe,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_agence: agence || null,
      })
      .then(({ data, error: err }) => {
        if (!active) return
        if (err) {
          setListeState({ key, rows: [], error: `Liste : ${err.message}` })
          return
        }
        const payload = (data ?? {}) as { rows?: ListeRow[] }
        setListeState({ key, rows: payload.rows ?? [], error: null })
      })
    return () => {
      active = false
    }
  }, [listeKey, hasSelection, selection, agence, dateFrom, dateTo])

  // ── Colonnes BLG de la matrice ────────────────────────────────────────────
  const groupes = useMemo(() => {
    const m = new Map<string, { code: string; libelle: string; ordre: number }>()
    for (const r of matrice?.rows ?? []) {
      if (!m.has(r.blg_groupe_code)) m.set(r.blg_groupe_code, { code: r.blg_groupe_code, libelle: r.blg_groupe_libelle, ordre: r.blg_groupe_ordre })
    }
    return Array.from(m.values()).sort((a, b) => a.ordre - b.ordre)
  }, [matrice])

  const groupeLibelles = useMemo(() => new Map(groupes.map((g) => [g.code, g.libelle])), [groupes])

  const aQualifier = useMemo(() => {
    const set = new Set<string>()
    for (const st of matrice?.statuts ?? []) if (st.a_qualifier) set.add(`S${st.status_fk}`)
    return set
  }, [matrice])

  // Agrégats : clé type|rattache|groupe (rattache/groupe '*' = sous-total)
  const agg = useMemo(() => {
    const m = new Map<string, { docs: number; lignes: number; montant: number }>()
    const add = (key: string, r: MatriceRow) => {
      const cur = m.get(key) ?? { docs: 0, lignes: 0, montant: 0 }
      cur.docs += r.nb_docs
      cur.lignes += r.nb_lignes
      cur.montant += r.montant_ht
      m.set(key, cur)
    }
    for (const r of matrice?.rows ?? []) {
      const rat = r.rattache_cdc ? '1' : '0'
      add(`${r.type_code}|${rat}|${r.blg_groupe_code}`, r)
      add(`${r.type_code}|${rat}|*`, r)
      add(`${r.type_code}|*|${r.blg_groupe_code}`, r)
      add(`${r.type_code}|*|*`, r)
      add(`*|*|${r.blg_groupe_code}`, r)
      add(`*|*|*`, r)
    }
    // Une pièce mixte (lignes avec et sans CDC, ou plusieurs CDC) apparaît
    // dans plusieurs cellules : les sous-totaux en pièces viennent du SQL
    // (pièces distinctes) ; lignes et montants s'additionnent sans doublon.
    for (const t of matrice?.totaux ?? []) {
      const cur = m.get(t.cle)
      if (cur) cur.docs = t.nb_docs
    }
    return m
  }, [matrice])

  const typesPresents = useMemo(() => {
    const set = new Set((matrice?.rows ?? []).map((r) => r.type_code))
    return TYPES.filter((t) => set.has(t.code))
  }, [matrice])

  const rattachePresent = useCallback(
    (type: TypeCode, rat: boolean) => (matrice?.rows ?? []).some((r) => r.type_code === type && r.rattache_cdc === rat),
    [matrice],
  )

  // ── Liste filtrée / triée ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = rows
    if (q) {
      out = out.filter((r) =>
        [r.numero_piece, r.cdc_reference, r.numero_tiers, r.intitule_tiers, r.agence, r.collaborateur, r.reference_client, r.commentaire, r.depot, r.blg_reference]
          .some((v) => (v ?? '').toLowerCase().includes(q)),
      )
    }
    if (onlyEcart) {
      out = out.filter((r) => {
        const e = ecartMontant(r)
        return (e !== null && Math.abs(e) >= 1) || r.blg_client_ok === false || (r.type_code === 'BL' && !r.blg_bl_reference) || r.blg_groupe_code === 'ABSENT'
      })
    }
    const dir = sortAsc ? 1 : -1
    const val = (r: ListeRow): string | number => {
      switch (sortKey) {
        case 'nb_lignes': return num(r.nb_lignes)
        case 'montant_ht': return num(r.montant_ht)
        case 'ecart_montant': return Math.abs(ecartMontant(r) ?? 0)
        default: return ((r[sortKey as keyof ListeRow] as string | null) ?? '').toString()
      }
    }
    return [...out].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'fr') * dir
    })
  }, [rows, search, onlyEcart, sortKey, sortAsc])

  const listeTotaux = useMemo(() => {
    const docs = new Set(filtered.map((r) => r.numero_piece)).size
    const lignes = filtered.reduce((a, r) => a + num(r.nb_lignes), 0)
    const montant = filtered.reduce((a, r) => a + num(r.montant_ht), 0)
    return { docs, lignes, montant }
  }, [filtered])

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortAsc((v) => !v)
    else {
      setSortKey(k)
      setSortAsc(k === 'intitule_tiers' || k === 'agence' || k === 'numero_piece' || k === 'cdc_reference' || k === 'blg_groupe_libelle')
    }
  }

  const selectCell = (sel: Selection) => {
    const same = sel.type === selection.type && sel.rattache === selection.rattache && sel.groupe === selection.groupe
    setSelection(same ? { type: null, rattache: null, groupe: null } : sel)
    setLimit(300)
  }

  const isSelected = (sel: Selection) =>
    sel.type === selection.type && sel.rattache === selection.rattache && sel.groupe === selection.groupe

  // ── Export Excel ──────────────────────────────────────────────────────────
  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook()
    wb.creator = 'CEGECLIM by A3C'

    // Onglet matrice
    const wsM = wb.addWorksheet('Matrice')
    wsM.addRow(['Activité SAGE ↔ statuts BLG', `Import SAGE : ${fmtDateTime(matrice?.imported_at)}`, agence ? `Agence : ${agence}` : 'Toutes agences'])
    wsM.addRow([])
    const head = ['Type SAGE', 'Rattachement', ...groupes.map((g) => g.libelle), 'Total']
    const metricLabel = metric === 'docs' ? 'pièces' : metric === 'lignes' ? 'lignes' : 'montant HT'
    wsM.addRow([`Valeurs : ${metricLabel}`])
    const hr = wsM.addRow(head)
    hr.font = { bold: true }
    const pick = (a?: { docs: number; lignes: number; montant: number }) =>
      !a ? null : metric === 'docs' ? a.docs : metric === 'lignes' ? a.lignes : Math.round(a.montant * 100) / 100
    for (const t of typesPresents) {
      const r = wsM.addRow([t.long, 'Total', ...groupes.map((g) => pick(agg.get(`${t.code}|*|${g.code}`))), pick(agg.get(`${t.code}|*|*`))])
      r.font = { bold: true }
      for (const rat of [true, false]) {
        if (!rattachePresent(t.code, rat)) continue
        const k = rat ? '1' : '0'
        wsM.addRow(['', rat ? 'Rattachées à une CDC' : 'Non rattachées', ...groupes.map((g) => pick(agg.get(`${t.code}|${k}|${g.code}`))), pick(agg.get(`${t.code}|${k}|*`))])
      }
    }
    wsM.columns.forEach((c, i) => { c.width = i < 2 ? 26 : 18 })

    // Onglet liste
    if (filtered.length) {
      const ws = wb.addWorksheet('Liste')
      const cols: [string, (r: ListeRow) => unknown][] = [
        ['Type', (r) => r.type_code],
        ['Pièce SAGE', (r) => r.numero_piece],
        ['CDC rattachée', (r) => r.cdc_reference ?? ''],
        ['État SAGE', (r) => r.etat_sage_libelle ?? ''],
        ['Date pièce', (r) => fmtDate(r.date_piece)],
        ['Date livraison', (r) => fmtDate(r.date_livraison)],
        ['N° tiers', (r) => r.numero_tiers ?? ''],
        ['Client', (r) => r.intitule_tiers ?? ''],
        ['Agence', (r) => r.agence ?? ''],
        ['Collaborateur', (r) => r.collaborateur ?? ''],
        ['Réf. client', (r) => r.reference_client ?? ''],
        ['Commentaire', (r) => r.commentaire ?? ''],
        ['Dépôt', (r) => r.depot ?? ''],
        ['Expédition', (r) => r.expedition ?? ''],
        ['Nb lignes SAGE', (r) => num(r.nb_lignes)],
        ['Montant HT SAGE', (r) => num(r.montant_ht)],
        ['CDC BLG', (r) => r.blg_reference ?? ''],
        ['Statut BLG', (r) => r.blg_groupe_libelle],
        ['Livraison BLG', (r) => LIVRAISON_LABELS[r.blg_delivery_status ?? ''] ?? r.blg_delivery_status ?? ''],
        ['Facturation BLG', (r) => FACTURATION_LABELS[r.blg_invoice_status ?? ''] ?? r.blg_invoice_status ?? ''],
        ['Date cde BLG', (r) => fmtDate(r.blg_order_date)],
        ['Nb lignes BLG', (r) => (r.blg_nb_lignes == null ? '' : num(r.blg_nb_lignes))],
        ['Lignes BLG à livrer', (r) => (r.blg_nb_lignes_a_livrer == null ? '' : num(r.blg_nb_lignes_a_livrer))],
        ['Montant HT BLG', (r) => (r.blg_montant_ht == null ? '' : num(r.blg_montant_ht))],
        ['Écart montant (CDC)', (r) => ecartMontant(r) ?? ''],
        ['BL BLG', (r) => r.blg_bl_reference ?? ''],
        ['Client BLG = SAGE', (r) => (r.blg_client_ok == null ? '' : r.blg_client_ok ? 'Oui' : 'Non')],
      ]
      ws.addRow([selectionLabel(selection, groupeLibelles)])
      const h = ws.addRow(cols.map((c) => c[0]))
      h.font = { bold: true }
      for (const r of filtered) ws.addRow(cols.map((c) => c[1](r)))
      ws.columns.forEach((c) => { c.width = 16 })
      ws.views = [{ state: 'frozen', ySplit: 2 }]
    }

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `activite_sage_blg_${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Rendu d'une cellule de matrice ────────────────────────────────────────
  const renderValue = (a?: { docs: number; lignes: number; montant: number }) => {
    if (!a) return null
    const main = metric === 'docs' ? nf0.format(a.docs) : metric === 'lignes' ? nf0.format(a.lignes) : nfEur.format(a.montant)
    const sub =
      metric === 'docs'
        ? `${nf0.format(a.lignes)} l. · ${nfEur.format(a.montant)}`
        : metric === 'lignes'
          ? `${nf0.format(a.docs)} pc · ${nfEur.format(a.montant)}`
          : `${nf0.format(a.docs)} pc · ${nf0.format(a.lignes)} l.`
    return (
      <>
        <span style={s.big}>{main}</span>
        <span style={s.small}>{sub}</span>
      </>
    )
  }

  const Cell = ({ sel, aggKey }: { sel: Selection; aggKey: string }) => {
    const a = agg.get(aggKey)
    if (!a) return <td style={s.cellEmpty}>·</td>
    return (
      <td style={isSelected(sel) ? s.cellOn : s.cell} onClick={() => selectCell(sel)} title="Voir la liste des pièces">
        {renderValue(a)}
      </td>
    )
  }

  const totalAll = agg.get('*|*|*')

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Activité SAGE ↔ statuts BLG</h1>
          <p style={s.subtitle}>
            Pièces SAGE en cours (CDC, PL, BL non facturés, BR) rangées selon le statut BLG de la commande correspondante, comme le
            panneau gauche de la liste des ventes BLG. Cliquez sur une cellule ou un sous-total pour afficher les pièces et leur pendant BLG.
          </p>
        </div>
        <div style={s.fresh}>
          Import SAGE : {fmtDateTime(matrice?.imported_at)}
          {loadingMatrice ? ' · chargement…' : ''}
        </div>
      </div>

      {error && <div style={s.error}>{error}</div>}

      {/* Filtres */}
      <div style={s.toolbar}>
        <span style={s.label}>Agence</span>
        <select style={s.input} value={agence} onChange={(e) => setAgence(e.target.value)}>
          <option value="">Toutes</option>
          {(matrice?.agences ?? []).map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <span style={{ ...s.label, marginLeft: 8 }}>Date pièce du</span>
        <input type="date" style={s.input} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <span style={s.label}>au</span>
        <input type="date" style={s.input} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <span style={{ ...s.label, marginLeft: 8 }}>Afficher</span>
        <div style={s.seg}>
          {([['docs', 'Pièces'], ['lignes', 'Lignes'], ['montant', 'Montant HT']] as [Metric, string][]).map(([k, l]) => (
            <button key={k} type="button" style={metric === k ? s.segBtnOn : s.segBtn} onClick={() => setMetric(k)}>{l}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" style={s.btn} onClick={() => setRefreshTick((n) => n + 1)}>Actualiser</button>
        <button type="button" style={s.btnPrimary} onClick={() => void exportExcel()} disabled={!matrice}>Export Excel</button>
      </div>

      {/* KPI par type */}
      <div style={s.kpis}>
        {TYPES.map((t) => {
          const a = agg.get(`${t.code}|*|*`)
          const sel: Selection = { type: t.code, rattache: null, groupe: null }
          const sansCdc = agg.get(`${t.code}|0|*`)
          return (
            <div key={t.code} style={isSelected(sel) ? s.kpiOn : s.kpi} onClick={() => a && selectCell(sel)}>
              <div style={s.kpiLabel}>{t.long}</div>
              <div style={s.kpiValue}>{a ? nf0.format(a.docs) : '0'}</div>
              <div style={s.kpiSub}>
                {a ? `${nf0.format(a.lignes)} lignes · ${nfEur.format(a.montant)}` : '—'}
                {t.code !== 'CDC' && sansCdc ? ` · ${nf0.format(sansCdc.docs)} sans CDC` : ''}
              </div>
            </div>
          )
        })}
      </div>

      {/* Matrice */}
      <div style={{ ...s.card, marginBottom: 18 }}>
        <div style={s.cardHead}>
          <h2 style={s.cardTitle}>Où se retrouvent les pièces SAGE dans BLG</h2>
          {hasSelection && (
            <button type="button" style={s.btn} onClick={() => setSelection({ type: null, rattache: null, groupe: null })}>Effacer la sélection</button>
          )}
        </div>
        <div style={s.scroll}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Pièce SAGE</th>
                {groupes.map((g) => (
                  <th key={g.code} style={s.thNum} title={aQualifier.has(g.code) ? 'Libellé déduit des données BLG, à confirmer (table blg_statut_vente)' : undefined}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: groupeColor(g.code), marginRight: 6 }} />
                    {g.libelle}
                    {aQualifier.has(g.code) ? ' *' : ''}
                  </th>
                ))}
                <th style={s.thNum}>Total</th>
              </tr>
            </thead>
            <tbody>
              {typesPresents.map((t) => (
                <React.Fragment key={t.code}>
                  <tr style={s.rowType}>
                    <td
                      style={isSelected({ type: t.code, rattache: null, groupe: null }) ? s.rowLabelOn : s.rowLabel}
                      onClick={() => selectCell({ type: t.code, rattache: null, groupe: null })}
                    >
                      <strong style={{ color: tc('#ffffff') }}>{t.label}</strong>
                      <span style={{ ...s.muted, marginLeft: 8 }}>{t.long}</span>
                    </td>
                    {groupes.map((g) => (
                      <Cell key={g.code} sel={{ type: t.code, rattache: null, groupe: g.code }} aggKey={`${t.code}|*|${g.code}`} />
                    ))}
                    <Cell sel={{ type: t.code, rattache: null, groupe: null }} aggKey={`${t.code}|*|*`} />
                  </tr>
                  {t.code !== 'CDC' &&
                    [true, false].filter((rat) => rattachePresent(t.code, rat)).map((rat) => {
                      const k = rat ? '1' : '0'
                      const selRow: Selection = { type: t.code, rattache: rat, groupe: null }
                      return (
                        <tr key={k}>
                          <td style={isSelected(selRow) ? s.rowLabelOn : s.rowLabel} onClick={() => selectCell(selRow)}>
                            <span style={{ paddingLeft: 18, color: tc('rgba(245,243,236,0.8)') }}>
                              {rat ? '↳ rattachées à une CDC' : '↳ non rattachées à une CDC'}
                            </span>
                          </td>
                          {groupes.map((g) => (
                            <Cell key={g.code} sel={{ type: t.code, rattache: rat, groupe: g.code }} aggKey={`${t.code}|${k}|${g.code}`} />
                          ))}
                          <Cell sel={selRow} aggKey={`${t.code}|${k}|*`} />
                        </tr>
                      )
                    })}
                </React.Fragment>
              ))}
              {typesPresents.length > 0 && (
                <tr>
                  <td style={{ ...s.rowLabel, cursor: 'default', fontWeight: 600 }}>Total</td>
                  {groupes.map((g) => (
                    <Cell key={g.code} sel={{ type: null, rattache: null, groupe: g.code }} aggKey={`*|*|${g.code}`} />
                  ))}
                  <td style={s.cell}>{renderValue(totalAll)}</td>
                </tr>
              )}
              {!loadingMatrice && typesPresents.length === 0 && (
                <tr>
                  <td style={s.td} colSpan={groupes.length + 2}>Aucune pièce SAGE en cours sur ce périmètre.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={s.note}>
          Périmètre : activité SAGE du dernier import (pièces non facturées), lignes d’information REF / FEDEX exclues. Rattachement = n° de
          BC porté par les lignes PL / BL / BR ; une pièce dont une partie des lignes n’a pas de CDC apparaît dans les deux sous-lignes.
          Statut BLG = statut de la commande BLG de même référence (Archives si archivée). * = libellé déduit des données BLG, à confirmer.
        </div>
      </div>

      {/* Liste */}
      {hasSelection && (
        <div style={s.card}>
          <div style={s.cardHead}>
            <div>
              <h2 style={s.cardTitle}>{selectionLabel(selection, groupeLibelles)}</h2>
              <div style={{ ...s.muted, marginTop: 4 }}>
                {loadingListe
                  ? 'Chargement…'
                  : `${nf0.format(listeTotaux.docs)} pièces · ${nf0.format(listeTotaux.lignes)} lignes · ${nfEur.format(listeTotaux.montant)}${filtered.length !== rows.length ? ` (sur ${nf0.format(rows.length)} affichables)` : ''}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                style={{ ...s.input, minWidth: 260 }}
                placeholder="Rechercher : pièce, client, CDC, commentaire…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={onlyEcart} onChange={(e) => setOnlyEcart(e.target.checked)} />
                Écarts uniquement
              </label>
            </div>
          </div>
          <div style={{ ...s.scroll, maxHeight: '70vh', overflowY: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={{ ...s.th, ...s.sortable }} onClick={() => toggleSort('numero_piece')}>Pièce SAGE</th>
                  <th style={{ ...s.th, ...s.sortable }} onClick={() => toggleSort('date_piece')}>Date</th>
                  <th style={{ ...s.th, ...s.sortable }} onClick={() => toggleSort('date_livraison')}>Livraison</th>
                  <th style={{ ...s.th, ...s.sortable }} onClick={() => toggleSort('intitule_tiers')}>Client</th>
                  <th style={{ ...s.th, ...s.sortable }} onClick={() => toggleSort('agence')}>Agence</th>
                  <th style={s.th}>Réf. client · commentaire</th>
                  <th style={{ ...s.thNum, ...s.sortable }} onClick={() => toggleSort('nb_lignes')}>Lignes</th>
                  <th style={{ ...s.thNum, ...s.sortable }} onClick={() => toggleSort('montant_ht')}>Montant HT</th>
                  <th style={{ ...s.th, ...s.sortable, borderLeft: '2px solid rgba(166,161,129,0.5)' }} onClick={() => toggleSort('cdc_reference')}>CDC</th>
                  <th style={{ ...s.th, ...s.sortable }} onClick={() => toggleSort('blg_groupe_libelle')}>Statut BLG</th>
                  <th style={s.th}>Livr. / fact. BLG</th>
                  <th style={s.thNum}>Lignes BLG</th>
                  <th style={s.thNum}>Montant BLG</th>
                  <th style={{ ...s.thNum, ...s.sortable }} onClick={() => toggleSort('ecart_montant')}>Écart</th>
                  <th style={s.th}>BL BLG · client</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((r) => {
                  const ecart = ecartMontant(r)
                  const color = groupeColor(r.blg_groupe_code)
                  return (
                    <tr key={`${r.numero_piece}|${r.cdc_reference ?? ''}`}>
                      <td style={s.td}>
                        <span style={s.tag}>{r.type_code}</span>
                        <span style={s.mono}>{r.numero_piece}</span>
                        <span style={s.small}>{r.etat_sage_libelle ?? '—'}{r.depot ? ` · ${r.depot}` : ''}</span>
                      </td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{fmtDate(r.date_piece)}</td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{fmtDate(r.date_livraison)}</td>
                      <td style={s.td}>
                        <span>{r.intitule_tiers ?? '—'}</span>
                        <span style={s.small}>{r.numero_tiers ?? ''}{r.collaborateur ? ` · ${r.collaborateur}` : ''}</span>
                      </td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{r.agence ?? '—'}</td>
                      <td style={{ ...s.td, maxWidth: 280 }}>
                        {r.reference_client ? <span>{r.reference_client}</span> : <span style={s.muted}>—</span>}
                        {r.commentaire && <span style={s.small}>{r.commentaire}</span>}
                        {r.expedition && <span style={s.small}>Expédition : {r.expedition}</span>}
                      </td>
                      <td style={s.tdNum}>{nf0.format(num(r.nb_lignes))}</td>
                      <td style={s.tdNum}>{nfEur2.format(num(r.montant_ht))}</td>
                      <td style={{ ...s.td, borderLeft: '2px solid rgba(166,161,129,0.35)', whiteSpace: 'nowrap' }}>
                        {r.cdc_reference ? <span style={s.mono}>{r.cdc_reference}</span> : <span style={s.ko}>Aucune</span>}
                        {r.blg_reference && r.blg_reference !== r.cdc_reference && <span style={s.small}>BLG : {r.blg_reference}</span>}
                      </td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, background: `${color}33`, color, border: `1px solid ${color}88` }}>{r.blg_groupe_libelle}</span>
                        {r.blg_order_date && <span style={s.small}>Cde BLG : {fmtDate(r.blg_order_date)}</span>}
                      </td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                        {r.blg_id ? (
                          <>
                            <span>{LIVRAISON_LABELS[r.blg_delivery_status ?? ''] ?? r.blg_delivery_status ?? '—'}</span>
                            <span style={s.small}>{FACTURATION_LABELS[r.blg_invoice_status ?? ''] ?? r.blg_invoice_status ?? '—'}</span>
                          </>
                        ) : <span style={s.muted}>—</span>}
                      </td>
                      <td style={s.tdNum}>
                        {r.blg_nb_lignes == null ? <span style={s.muted}>—</span> : (
                          <>
                            {nf0.format(num(r.blg_nb_lignes))}
                            <span style={s.small}>{nf0.format(num(r.blg_nb_lignes_a_livrer))} à livrer</span>
                          </>
                        )}
                      </td>
                      <td style={s.tdNum}>{r.blg_montant_ht == null ? <span style={s.muted}>—</span> : nfEur2.format(num(r.blg_montant_ht))}</td>
                      <td style={s.tdNum}>
                        {ecart === null ? <span style={s.muted}>—</span> : Math.abs(ecart) < 1 ? <span style={s.ok}>=</span> : <span style={s.warn}>{nfEur2.format(ecart)}</span>}
                      </td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                        {r.type_code === 'BL' || r.type_code === 'BR' ? (
                          r.blg_bl_reference ? <span style={s.ok}>✓ {fmtDate(r.blg_bl_date)}</span> : <span style={s.ko}>Absent</span>
                        ) : <span style={s.muted}>—</span>}
                        {r.blg_client_ok === false && r.blg_id && <span style={{ ...s.small, ...s.ko }}>Client BLG ≠ SAGE</span>}
                      </td>
                    </tr>
                  )
                })}
                {!loadingListe && filtered.length === 0 && (
                  <tr>
                    <td style={s.td} colSpan={15}>Aucune pièce.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {filtered.length > limit && (
            <div style={{ padding: 12, textAlign: 'center' }}>
              <button type="button" style={s.btn} onClick={() => setLimit((l) => l + 500)}>
                Afficher plus ({nf0.format(filtered.length - limit)} restantes)
              </button>
            </div>
          )}
          <div style={s.note}>
            Écart = montant HT SAGE − montant HT BLG, calculé pour les CDC uniquement. « Écarts uniquement » garde les écarts de montant ≥ 1 €,
            les BL absents de BLG, les CDC absentes de BLG et les clients BLG différents de la fiche SAGE.
          </div>
        </div>
      )}
    </div>
  )
}
