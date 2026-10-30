'use client'

// ============================================================================
// app/controle-sage-blg/portefeuille-blg-sage/page.tsx
// Écran « Portefeuille BLG ↔ SAGE » (Projet BLG) — 30/10/2026
// ----------------------------------------------------------------------------
// Sens inverse de l'écran « Activité SAGE ↔ statuts BLG » : on part des
// commandes BLG ouvertes (validée / en cours / à facturer) et des commandes
// archivées, et on regarde où elles se trouvent dans SAGE.
//  - lignes   = statut BLG (comme le panneau gauche des ventes BLG)
//  - colonnes = situation dans SAGE : CDC à livrer, en préparation (PL),
//               BL non facturé, soldée et facturée, soldée sans facture,
//               absente de SAGE
//  - chaque case porte un verdict : OK, décalage normal (BL pas encore
//    facturé), à analyser, à corriger dans BLG.
// Objectif : chaque matin, les cases « à corriger » listent les commandes à
// solder / archiver / supprimer dans BLG pour que le portefeuille BLG colle au
// portefeuille SAGE (suppressions de lignes ou de pièces non reportées…).
//
// SQL (migration 20261029d_portefeuille_blg_sage.sql, appliquée en prod) :
//   table portefeuille_blg_sage_cache, rafraîchie par pg_cron
//   « portefeuille-blg-sage-hourly » (h+42) et par refresh_portefeuille_blg_sage()
//   get_portefeuille_blg_sage_matrice(p_agence)
//   get_portefeuille_blg_sage_liste(p_statut, p_situation, p_verdict, p_agence)
// 30/10/2026 : ligne « Absente de BLG » (statut ABSENT_BLG) = CDC du portefeuille SAGE
// sans commande BLG ; migration 20261030_portefeuille_absentes_blg.sql.
// 30/10/2026 (b) : volet Achats (?domaine=achat) — commandes d'achat BLG × CDF / BLF / FAF SAGE
// (sage.bdcf) ; migration 20261030b_portefeuille_achats_blg_sage.sql.
// URL : ?statut=S43&situation=FACTUREE&verdict=A_CORRIGER&agence=PAU
// ============================================================================

import React, { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'
import { themed, tc } from '@/lib/theme'

// ── Types ────────────────────────────────────────────────────────────────────
type Verdict = 'OK' | 'DECALAGE' | 'A_ANALYSER' | 'A_CORRIGER'

type MatriceRow = {
  statut_code: string
  statut_libelle: string
  statut_ordre: number
  situation_code: string
  situation_libelle: string
  situation_ordre: number
  verdict: Verdict
  nb: number
  nb_recent: number
  blg_montant_ht: number
  blg_reste_ht: number
  sage_montant_en_cours: number
  sage_montant_facture: number
}

type MatricePayload = {
  refreshed_at: string | null
  blg_synchro: string | null
  sage_import: string | null
  agences: string[]
  statuts_a_qualifier: string[]
  rows: MatriceRow[]
}

type ListeRow = {
  blg_id: number | null
  blg_document_id: string | null
  reference: string
  statut_code: string
  statut_libelle: string
  archivee: boolean
  archive_motif: string | null
  blg_delivery_status: string | null
  blg_invoice_status: string | null
  blg_order_date: string | null
  blg_last_update: string | null
  blg_montant_ht: number | null
  blg_reste_ht: number | null
  blg_nb_lignes: number | null
  blg_nb_lignes_a_livrer: number | null
  numero_tiers: string | null
  intitule_tiers: string | null
  agence: string | null
  collaborateur: string | null
  situation_code: string
  situation_libelle: string
  verdict: Verdict
  sage_montant_en_cours: number | null
  sage_nb_lignes_en_cours: number | null
  sage_pieces_en_cours: string | null
  sage_date_creation: string | null
  sage_date_livraison: string | null
  sage_montant_facture: number | null
  sage_nb_factures: number | null
  sage_factures: string | null
  sage_derniere_facture: string | null
  facture_recente: boolean
  lien_blg: string | null
}

type Selection = { statut: string | null; situation: string | null; verdict: Verdict | null }
type Domaine = 'VENTE' | 'ACHAT'
type Metric = 'nb' | 'reste' | 'sage' | 'facture'
type SortKey = 'reference' | 'intitule_tiers' | 'agence' | 'blg_order_date' | 'blg_reste_ht' | 'blg_montant_ht' | 'sage_montant_facture' | 'sage_derniere_facture'
type Agg = { nb: number; nb_recent: number; reste: number; blg: number; sage: number; facture: number; verdicts: Set<Verdict> }

// ── Constantes ───────────────────────────────────────────────────────────────
const SITUATIONS_VENTE: { code: string; label: string; hint: string }[] = [
  { code: 'A_LIVRER', label: 'CDC à livrer', hint: 'La CDC a encore des lignes à livrer dans SAGE' },
  { code: 'PL', label: 'En préparation (PL)', hint: 'Lignes en préparation de livraison dans SAGE' },
  { code: 'BL', label: 'BL non facturé', hint: 'Lignes livrées, BL pas encore facturé dans SAGE' },
  { code: 'FACTUREE', label: 'Soldée, facturée', hint: 'Plus rien en cours dans SAGE ; au moins une facture rattachée à la CDC' },
  { code: 'SOLDEE', label: 'Soldée, sans facture', hint: 'En-tête SAGE connu, plus aucune ligne en cours ni facturée (lignes supprimées / soldées)' },
  { code: 'ABSENTE', label: 'Absente de SAGE', hint: 'Aucune trace de la CDC dans l’activité ni dans les factures SAGE' },
]

const SITUATIONS_ACHAT: { code: string; label: string; hint: string }[] = [
  { code: 'A_RECEVOIR', label: 'CDF à recevoir', hint: 'La CDF a encore des lignes à recevoir dans SAGE' },
  { code: 'BLF', label: 'BLF non facturé', hint: 'Réception SAGE (BLF) pas encore facturée, rattachée à la CDF' },
  { code: 'FAF', label: 'Facturée récemment', hint: 'Plus rien à recevoir ; facture fournisseur (FAF) récente rattachée à la CDF' },
  { code: 'SORTIE', label: 'Sortie du portefeuille SAGE', hint: 'Plus rien en cours dans SAGE : réceptionnée et facturée, ou lignes / pièce supprimées' },
]

const TEXTES: Record<Domaine, {
  titre: string; sousTitre: string; tiers: string; lieu: string; reste: string; resteCourt: string
  piecesSage: string; facturesSage: string; note: string; noteListe: string
}> = {
  VENTE: {
    titre: 'Portefeuille BLG ↔ SAGE — Ventes',
    sousTitre: 'Commandes clients BLG ouvertes (validée, en cours, à facturer) et archivées, plus les CDC SAGE absentes de BLG, rangées selon leur situation dans SAGE. Les cases « À corriger dans BLG » sont la liste de travail quotidienne.',
    tiers: 'Client', lieu: 'Agence', reste: 'Reste à livrer BLG', resteCourt: 'Reste BLG',
    piecesSage: 'Pièces SAGE en cours', facturesSage: 'Factures SAGE',
    note: 'Périmètre BLG : ventes CDC (hors service) au statut Commande validée, en cours, à facturer (et statut 21), plus les commandes archivées. Ligne « Absente de BLG » : CDC du portefeuille SAGE sans commande BLG — décalage normal si créée aujourd’hui (interface de la nuit), à corriger sinon. Situation SAGE lue dans l’activité du dernier import (CDC à livrer, PL, BL non facturés) puis dans les factures rattachées à la CDC. Reste à livrer BLG = quantité non livrée × prix net des lignes BLG. Calcul mis à jour chaque heure (h+42) ou avec « Recalculer ».',
    noteListe: '« Facture récente » : la CDC a été facturée dans SAGE il y a 2 jours ou moins ; BLG ne l’a peut-être pas encore reçue (synchro de nuit), ce n’est pas forcément un écart. Le lien ↗ ouvre la commande dans BLG.',
  },
  ACHAT: {
    titre: 'Portefeuille BLG ↔ SAGE — Achats',
    sousTitre: 'Commandes d’achat BLG ouvertes (en cours, réception partielle, à facturer, facturée partiellement), terminées encore ouvertes dans SAGE, archivées, plus les CDF SAGE absentes de BLG, rangées selon leur situation dans SAGE (CDF à recevoir, BLF non facturé, facture récente). Les cases « À corriger dans BLG » sont la liste de travail quotidienne.',
    tiers: 'Fournisseur', lieu: 'Lieu de livraison', reste: 'Reste à recevoir BLG', resteCourt: 'Reste BLG',
    piecesSage: 'BLF SAGE non facturés', facturesSage: 'Factures fournisseur (FAF)',
    note: 'Périmètre BLG : commandes d’achat CDF aux statuts ouverts, archivées, et terminées seulement si la CDF est encore ouverte dans SAGE. Situation SAGE lue dans le portefeuille achats SAGE (CDF non réceptionnées, BLF non facturés, factures fournisseur récentes) ; « Sortie du portefeuille SAGE » = réceptionnée et facturée, ou supprimée. Ligne « Absente de BLG » : CDF SAGE sans commande d’achat BLG — décalage normal si datée du jour, à corriger sinon. Reste à recevoir BLG = quantité non reçue × prix d’achat des lignes BLG. Libellés des statuts d’achat BLG déduits des données (*). Calcul mis à jour chaque heure (h+42) ou avec « Recalculer ».',
    noteListe: '« FAF récente » : une facture fournisseur rattachée à la CDF est encore dans le portefeuille SAGE ; BLG ne l’a peut-être pas encore reçue. Le lien ↗ ouvre la commande d’achat dans BLG.',
  },
}

const VERDICTS: Record<Verdict, { label: string; color: string; bg: string; hint: string }> = {
  A_CORRIGER: { label: 'À corriger dans BLG', color: '#E07A4E', bg: 'rgba(224,122,78,0.16)', hint: 'Commande ouverte dans BLG mais sortie du portefeuille SAGE (ou archivée à tort) : solder, archiver ou désarchiver dans BLG.' },
  A_ANALYSER: { label: 'À analyser', color: '#E0A961', bg: 'rgba(224,169,97,0.14)', hint: 'Statut BLG et situation SAGE peu compatibles, à regarder au cas par cas.' },
  DECALAGE: { label: 'Décalage normal', color: '#8FC7DA', bg: 'rgba(143,199,218,0.12)', hint: 'BL SAGE pas encore facturé (se résorbe à la facturation), ou CDC créée aujourd’hui dans SAGE qui attend l’interface SAGE → BLG de la nuit.' },
  OK: { label: 'Cohérent', color: '#7FC79A', bg: 'rgba(127,199,154,0.08)', hint: 'Statut BLG cohérent avec la situation SAGE.' },
}
const VERDICT_ORDRE: Verdict[] = ['A_CORRIGER', 'A_ANALYSER', 'DECALAGE', 'OK']

const LIVRAISON_LABELS: Record<string, string> = {
  notDelivered: 'Non livré', partiallyDelivered: 'Part. livré', delivered: 'Livré', notConcerned: 'Non concerné',
}
const FACTURATION_LABELS: Record<string, string> = {
  notInvoiced: 'Non facturé', partiallyInvoiced: 'Part. facturé', invoiced: 'Facturé',
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

function emptyAgg(): Agg {
  return { nb: 0, nb_recent: 0, reste: 0, blg: 0, sage: 0, facture: 0, verdicts: new Set() }
}

function isVerdict(v: string | null): v is Verdict {
  return v === 'OK' || v === 'DECALAGE' || v === 'A_ANALYSER' || v === 'A_CORRIGER'
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = themed({
  page: { padding: '20px 24px 48px', color: '#F5F3EC', fontFamily: '"IBM Plex Sans", system-ui, sans-serif', minHeight: '100vh', background: '#0B1220' },
  header: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18 },
  title: { margin: 0, fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 26, fontWeight: 700, letterSpacing: -0.3, color: '#ffffff' },
  subtitle: { margin: '6px 0 0', fontSize: 13, color: 'rgba(245,243,236,0.62)', maxWidth: 920, lineHeight: 1.5 },
  fresh: { fontSize: 12, color: 'rgba(245,243,236,0.55)', fontFamily: '"IBM Plex Mono", monospace', textAlign: 'right', lineHeight: 1.6 },
  toolbar: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', margin: '0 0 16px', padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' },
  label: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: 'rgba(245,243,236,0.55)', marginRight: 4 },
  input: { background: 'rgba(11,18,32,0.9)', color: '#F5F3EC', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, padding: '7px 10px', fontSize: 13 },
  btn: { background: 'rgba(255,255,255,0.08)', color: '#F5F3EC', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer' },
  btnPrimary: { background: '#A6A181', color: '#0B1220', border: '1px solid #A6A181', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  seg: { display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.16)' },
  segBtn: { background: 'transparent', color: 'rgba(245,243,236,0.75)', border: 'none', padding: '7px 11px', fontSize: 12, cursor: 'pointer' },
  segBtnOn: { background: 'rgba(166,161,129,0.28)', color: '#ffffff', border: 'none', padding: '7px 11px', fontSize: 12, cursor: 'pointer', fontWeight: 600 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 16 },
  kpi: { padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' },
  kpiLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  kpiValue: { fontSize: 22, fontWeight: 700, color: '#ffffff', fontFamily: '"Space Grotesk", system-ui, sans-serif', marginTop: 4 },
  kpiSub: { fontSize: 12, color: 'rgba(245,243,236,0.55)', marginTop: 2 },
  card: { borderRadius: 14, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' },
  cardHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  cardTitle: { margin: 0, fontSize: 15, fontWeight: 600, color: '#ffffff', fontFamily: '"Space Grotesk", system-ui, sans-serif' },
  scroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { position: 'sticky', top: 0, background: '#101A2E', color: 'rgba(245,243,236,0.7)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, padding: '9px 10px', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' },
  thNum: { position: 'sticky', top: 0, background: '#101A2E', color: 'rgba(245,243,236,0.7)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, padding: '9px 10px', textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', verticalAlign: 'top' },
  tdNum: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', verticalAlign: 'top' },
  rowLabel: { padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 600, color: '#ffffff' },
  cellEmpty: { padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'right', color: 'rgba(245,243,236,0.2)' },
  big: { fontSize: 15, fontWeight: 600, color: '#ffffff' },
  small: { display: 'block', fontSize: 11, color: 'rgba(245,243,236,0.55)', marginTop: 2 },
  mono: { fontFamily: '"IBM Plex Mono", monospace', fontSize: 12 },
  muted: { color: 'rgba(245,243,236,0.5)', fontSize: 12 },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' },
  link: { color: '#8FC7DA', textDecoration: 'none' },
  error: { padding: '12px 14px', borderRadius: 10, background: 'rgba(193,104,60,0.15)', border: '1px solid rgba(193,104,60,0.5)', color: '#E07A4E', marginBottom: 16, fontSize: 13 },
  info: { padding: '10px 14px', borderRadius: 10, background: 'rgba(143,199,218,0.10)', border: '1px solid rgba(143,199,218,0.35)', color: '#8FC7DA', marginBottom: 16, fontSize: 13 },
  note: { fontSize: 12, color: 'rgba(245,243,236,0.55)', padding: '10px 16px', lineHeight: 1.5 },
  sortable: { cursor: 'pointer', userSelect: 'none' },
})

// ── Page ─────────────────────────────────────────────────────────────────────
export default function PortefeuilleBlgSagePage() {
  return (
    <Suspense fallback={<div style={s.page}>Chargement…</div>}>
      <PortefeuilleBlgSageContent />
    </Suspense>
  )
}

function PortefeuilleBlgSageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [domaine, setDomaine] = useState<Domaine>(searchParams.get('domaine') === 'achat' ? 'ACHAT' : 'VENTE')
  const SITUATIONS = domaine === 'ACHAT' ? SITUATIONS_ACHAT : SITUATIONS_VENTE
  const T = TEXTES[domaine]
  const [agence, setAgence] = useState<string>(searchParams.get('agence') ?? '')
  const [metric, setMetric] = useState<Metric>('nb')
  const [selection, setSelection] = useState<Selection>(() => {
    const v = searchParams.get('verdict')
    return { statut: searchParams.get('statut'), situation: searchParams.get('situation'), verdict: isVerdict(v) ? v : null }
  })
  const hasSelection = selection.statut !== null || selection.situation !== null || selection.verdict !== null

  // Données : réponse mémorisée avec la clé de requête qui l'a produite.
  const [refreshTick, setRefreshTick] = useState(0)
  const matriceKey = JSON.stringify([domaine, agence, refreshTick])
  const listeKey = JSON.stringify([domaine, selection, agence, refreshTick])
  const [matriceState, setMatriceState] = useState<{ key: string; data: MatricePayload | null; error: string | null } | null>(null)
  const [listeState, setListeState] = useState<{ key: string; rows: ListeRow[]; error: string | null } | null>(null)
  const matrice = matriceState?.data ?? null
  const loadingMatrice = matriceState?.key !== matriceKey
  const rows = useMemo(() => (hasSelection ? listeState?.rows ?? [] : []), [hasSelection, listeState])
  const loadingListe = hasSelection && listeState?.key !== listeKey
  const [recalcul, setRecalcul] = useState<{ running: boolean; message: string | null; error: string | null }>({ running: false, message: null, error: null })
  const error = recalcul.error ?? matriceState?.error ?? (hasSelection ? listeState?.error : null) ?? null

  const [search, setSearch] = useState('')
  const [masquerRecentes, setMasquerRecentes] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('blg_reste_ht')
  const [sortAsc, setSortAsc] = useState(false)
  const [limit, setLimit] = useState(300)

  // URL
  useEffect(() => {
    const p = new URLSearchParams()
    if (selection.statut) p.set('statut', selection.statut)
    if (selection.situation) p.set('situation', selection.situation)
    if (selection.verdict) p.set('verdict', selection.verdict)
    if (agence) p.set('agence', agence)
    if (domaine === 'ACHAT') p.set('domaine', 'achat')
    const qs = p.toString()
    router.replace(qs ? `?${qs}` : '?', { scroll: false })
  }, [selection, agence, domaine, router])

  // Matrice
  useEffect(() => {
    let active = true
    const key = matriceKey
    supabase.rpc('get_portefeuille_blg_sage_matrice', { p_agence: agence || null, p_domaine: domaine }).then(({ data, error: err }) => {
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
          refreshed_at: payload.refreshed_at ?? null,
          blg_synchro: payload.blg_synchro ?? null,
          sage_import: payload.sage_import ?? null,
          agences: payload.agences ?? [],
          statuts_a_qualifier: payload.statuts_a_qualifier ?? [],
          rows: (payload.rows ?? []).map((r) => ({
            ...r,
            nb: num(r.nb),
            nb_recent: num(r.nb_recent),
            blg_montant_ht: num(r.blg_montant_ht),
            blg_reste_ht: num(r.blg_reste_ht),
            sage_montant_en_cours: num(r.sage_montant_en_cours),
            sage_montant_facture: num(r.sage_montant_facture),
          })),
        },
      })
    })
    return () => {
      active = false
    }
  }, [matriceKey, agence, domaine])

  // Liste
  useEffect(() => {
    if (!hasSelection) return
    let active = true
    const key = listeKey
    supabase
      .rpc('get_portefeuille_blg_sage_liste', {
        p_statut: selection.statut,
        p_situation: selection.situation,
        p_verdict: selection.verdict,
        p_agence: agence || null,
        p_domaine: domaine,
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
  }, [listeKey, hasSelection, selection, agence, domaine])

  // ── Agrégats ──────────────────────────────────────────────────────────────
  const statuts = useMemo(() => {
    const m = new Map<string, { code: string; libelle: string; ordre: number }>()
    for (const r of matrice?.rows ?? []) if (!m.has(r.statut_code)) m.set(r.statut_code, { code: r.statut_code, libelle: r.statut_libelle, ordre: r.statut_ordre })
    return Array.from(m.values()).sort((a, b) => a.ordre - b.ordre)
  }, [matrice])

  const agg = useMemo(() => {
    const m = new Map<string, Agg>()
    const add = (key: string, r: MatriceRow) => {
      const cur = m.get(key) ?? emptyAgg()
      cur.nb += r.nb
      cur.nb_recent += r.nb_recent
      cur.reste += r.blg_reste_ht
      cur.blg += r.blg_montant_ht
      cur.sage += r.sage_montant_en_cours
      cur.facture += r.sage_montant_facture
      cur.verdicts.add(r.verdict)
      m.set(key, cur)
    }
    for (const r of matrice?.rows ?? []) {
      add(`${r.statut_code}|${r.situation_code}`, r)
      add(`${r.statut_code}|*`, r)
      add(`*|${r.situation_code}`, r)
      add('*|*', r)
      add(`V|${r.verdict}`, r)
    }
    return m
  }, [matrice])

  // Une case peut mêler plusieurs verdicts (ex. Absente de BLG : du jour / plus ancienne) : on affiche le plus grave.
  const cellVerdict = (statut: string, situation: string): Verdict | null => {
    const vs = agg.get(`${statut}|${situation}`)?.verdicts
    return vs ? VERDICT_ORDRE.find((v) => vs.has(v)) ?? null : null
  }
  const aQualifier = new Set(matrice?.statuts_a_qualifier ?? [])

  // ── Liste filtrée / triée ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = rows
    if (q) {
      out = out.filter((r) =>
        [r.reference, r.numero_tiers, r.intitule_tiers, r.agence, r.collaborateur, r.sage_pieces_en_cours, r.sage_factures, r.archive_motif]
          .some((v) => (v ?? '').toLowerCase().includes(q)),
      )
    }
    if (masquerRecentes) out = out.filter((r) => !r.facture_recente)
    const dir = sortAsc ? 1 : -1
    const val = (r: ListeRow): string | number => {
      switch (sortKey) {
        case 'blg_reste_ht': return num(r.blg_reste_ht)
        case 'blg_montant_ht': return num(r.blg_montant_ht)
        case 'sage_montant_facture': return num(r.sage_montant_facture)
        default: return ((r[sortKey] as string | null) ?? '').toString()
      }
    }
    return [...out].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'fr') * dir
    })
  }, [rows, search, masquerRecentes, sortKey, sortAsc])

  const listeTotaux = useMemo(
    () => ({
      nb: filtered.length,
      reste: filtered.reduce((a, r) => a + num(r.blg_reste_ht), 0),
      blg: filtered.reduce((a, r) => a + num(r.blg_montant_ht), 0),
      recentes: rows.filter((r) => r.facture_recente).length,
    }),
    [filtered, rows],
  )

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortAsc((v) => !v)
    else {
      setSortKey(k)
      setSortAsc(k === 'reference' || k === 'intitule_tiers' || k === 'agence')
    }
  }

  const select = (sel: Selection) => {
    const same = sel.statut === selection.statut && sel.situation === selection.situation && sel.verdict === selection.verdict
    setSelection(same ? { statut: null, situation: null, verdict: null } : sel)
    setLimit(300)
  }
  const isSelected = (sel: Selection) =>
    sel.statut === selection.statut && sel.situation === selection.situation && sel.verdict === selection.verdict

  const selectionLabel = useMemo(() => {
    const parts: string[] = []
    if (selection.verdict) parts.push(VERDICTS[selection.verdict].label)
    if (selection.statut) parts.push(`BLG : ${statuts.find((x) => x.code === selection.statut)?.libelle ?? selection.statut}`)
    if (selection.situation) parts.push(`SAGE : ${SITUATIONS.find((x) => x.code === selection.situation)?.label ?? selection.situation}`)
    return parts.join(' · ') || 'Toutes les commandes'
  }, [selection, statuts, SITUATIONS])

  // ── Recalcul ──────────────────────────────────────────────────────────────
  const recalculer = async () => {
    setRecalcul({ running: true, message: 'Recalcul en cours (≈ 20 s)…', error: null })
    const { data, error: err } = await supabase.rpc('refresh_portefeuille_blg_sage')
    if (err) {
      setRecalcul({ running: false, message: null, error: `Le recalcul a échoué : ${err.message}` })
      return
    }
    const res = (data ?? {}) as { rows?: number; skipped?: boolean }
    setRecalcul({
      running: false,
      error: null,
      message: res.skipped ? 'Un recalcul était déjà en cours : résultat affiché dans quelques secondes.' : `Recalcul terminé : ${nf0.format(num(res.rows))} commandes.`,
    })
    setRefreshTick((n) => n + 1)
  }

  // ── Export Excel ──────────────────────────────────────────────────────────
  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook()
    wb.creator = 'CEGECLIM by A3C'
    const wsM = wb.addWorksheet('Matrice')
    wsM.addRow([T.titre, `Calcul : ${fmtDateTime(matrice?.refreshed_at)}`, agence ? `${T.lieu} : ${agence}` : 'Tous'])
    wsM.addRow([])
    const h = wsM.addRow(['Statut BLG', ...SITUATIONS.flatMap((x) => [`${x.label} (nb)`, `${x.label} (${T.resteCourt} HT)`]), 'Total (nb)', `Total (${T.resteCourt} HT)`])
    h.font = { bold: true }
    for (const st of statuts) {
      const cells = SITUATIONS.flatMap((x) => {
        const a = agg.get(`${st.code}|${x.code}`)
        return a ? [a.nb, Math.round(a.reste * 100) / 100] : [null, null]
      })
      const t = agg.get(`${st.code}|*`)
      wsM.addRow([st.libelle, ...cells, t?.nb ?? 0, Math.round((t?.reste ?? 0) * 100) / 100])
    }
    wsM.addRow([])
    const hv = wsM.addRow(['Verdict', 'Commandes', `${T.reste} HT`])
    hv.font = { bold: true }
    for (const v of VERDICT_ORDRE) {
      const a = agg.get(`V|${v}`)
      wsM.addRow([VERDICTS[v].label, a?.nb ?? 0, Math.round((a?.reste ?? 0) * 100) / 100])
    }
    wsM.columns.forEach((c, i) => { c.width = i === 0 ? 26 : 16 })

    if (filtered.length) {
      const ws = wb.addWorksheet('Liste')
      const cols: [string, (r: ListeRow) => unknown][] = [
        ['Verdict', (r) => VERDICTS[r.verdict]?.label ?? r.verdict],
        ['CDC', (r) => r.reference],
        ['Lien BLG', (r) => (r.lien_blg ? { text: 'Ouvrir', hyperlink: r.lien_blg } : '')],
        ['Statut BLG', (r) => r.statut_libelle],
        ['Motif archivage', (r) => r.archive_motif ?? ''],
        ['Livraison BLG', (r) => LIVRAISON_LABELS[r.blg_delivery_status ?? ''] ?? r.blg_delivery_status ?? ''],
        ['Facturation BLG', (r) => FACTURATION_LABELS[r.blg_invoice_status ?? ''] ?? r.blg_invoice_status ?? ''],
        ['Date cde BLG', (r) => fmtDate(r.blg_order_date)],
        ['Dernière modif BLG', (r) => fmtDate(r.blg_last_update)],
        ['N° tiers', (r) => r.numero_tiers ?? ''],
        [T.tiers, (r) => r.intitule_tiers ?? ''],
        [T.lieu, (r) => r.agence ?? ''],
        ['Collaborateur', (r) => r.collaborateur ?? ''],
        ['Lignes BLG', (r) => num(r.blg_nb_lignes)],
        ['Lignes BLG à livrer', (r) => num(r.blg_nb_lignes_a_livrer)],
        ['Montant BLG HT', (r) => num(r.blg_montant_ht)],
        [`${T.reste} HT`, (r) => num(r.blg_reste_ht)],
        ['Situation SAGE', (r) => r.situation_libelle],
        [T.piecesSage, (r) => r.sage_pieces_en_cours ?? ''],
        ['Montant SAGE en cours HT', (r) => num(r.sage_montant_en_cours)],
        [T.facturesSage, (r) => r.sage_factures ?? ''],
        ['Montant facturé HT', (r) => num(r.sage_montant_facture)],
        ['Dernière facture', (r) => fmtDate(r.sage_derniere_facture)],
        ['Facture récente (≤ 2 j)', (r) => (r.facture_recente ? 'Oui' : '')],
      ]
      ws.addRow([selectionLabel])
      const hr = ws.addRow(cols.map((c) => c[0]))
      hr.font = { bold: true }
      for (const r of filtered) ws.addRow(cols.map((c) => c[1](r)))
      ws.columns.forEach((c) => { c.width = 16 })
      ws.views = [{ state: 'frozen', ySplit: 2 }]
    }

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `portefeuille_blg_sage_${domaine.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Rendu d'une case ──────────────────────────────────────────────────────
  const renderValue = (a?: Agg) => {
    if (!a) return null
    const main =
      metric === 'nb' ? nf0.format(a.nb) : metric === 'reste' ? nfEur.format(a.reste) : metric === 'sage' ? nfEur.format(a.sage) : nfEur.format(a.facture)
    const sub = metric === 'nb' ? `reste BLG ${nfEur.format(a.reste)}` : `${nf0.format(a.nb)} cde`
    return (
      <>
        <span style={s.big}>{main}</span>
        <span style={s.small}>{sub}</span>
      </>
    )
  }

  const cellStyle = (verdict: Verdict | null, selected: boolean): React.CSSProperties => {
    const v = verdict ? VERDICTS[verdict] : null
    return {
      padding: '10px 12px',
      borderBottom: tc('1px solid rgba(255,255,255,0.06)'),
      textAlign: 'right',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums',
      background: v ? tc(v.bg) : undefined,
      borderLeft: v ? `3px solid ${tc(v.color)}` : undefined,
      boxShadow: selected ? `inset 0 0 0 2px ${tc('#A6A181')}` : undefined,
    }
  }

  const total = agg.get('*|*')

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>{T.titre}</h1>
          <p style={s.subtitle}>{T.sousTitre}</p>
        </div>
        <div style={s.fresh}>
          Calcul : {fmtDateTime(matrice?.refreshed_at)}
          {loadingMatrice ? ' · chargement…' : ''}
          <br />
          Synchro BLG : {fmtDateTime(matrice?.blg_synchro)} · Import SAGE : {fmtDateTime(matrice?.sage_import)}
        </div>
      </div>

      {error && <div style={s.error}>{error}</div>}
      {recalcul.message && <div style={s.info}>{recalcul.message}</div>}

      <div style={s.toolbar}>
        <div style={s.seg}>
          {([['VENTE', 'Ventes (CDC)'], ['ACHAT', 'Achats (CDF)']] as [Domaine, string][]).map(([k, l]) => (
            <button
              key={k}
              type="button"
              style={domaine === k ? s.segBtnOn : s.segBtn}
              onClick={() => {
                if (k === domaine) return
                setDomaine(k)
                setAgence('')
                setSelection({ statut: null, situation: null, verdict: null })
                setSearch('')
                setLimit(300)
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <span style={{ ...s.label, marginLeft: 8 }}>{T.lieu}</span>
        <select style={s.input} value={agence} onChange={(e) => { setAgence(e.target.value); setLimit(300) }}>
          <option value="">Toutes</option>
          {(matrice?.agences ?? []).map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <span style={{ ...s.label, marginLeft: 8 }}>Afficher</span>
        <div style={s.seg}>
          {([['nb', 'Commandes'], ['reste', T.reste], ['sage', 'En cours SAGE'], ['facture', 'Facturé SAGE']] as [Metric, string][]).map(([k, l]) => (
            <button key={k} type="button" style={metric === k ? s.segBtnOn : s.segBtn} onClick={() => setMetric(k)}>{l}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" style={s.btn} onClick={() => void recalculer()} disabled={recalcul.running}>
          {recalcul.running ? 'Recalcul…' : 'Recalculer'}
        </button>
        <button type="button" style={s.btnPrimary} onClick={() => void exportExcel()} disabled={!matrice}>Export Excel</button>
      </div>

      {/* Verdicts */}
      <div style={s.kpis}>
        {VERDICT_ORDRE.map((v) => {
          const a = agg.get(`V|${v}`)
          const sel: Selection = { statut: null, situation: null, verdict: v }
          const meta = VERDICTS[v]
          return (
            <div
              key={v}
              style={{ ...s.kpi, borderLeft: `4px solid ${tc(meta.color)}`, ...(isSelected(sel) ? { background: tc(meta.bg), borderColor: tc(meta.color) } : {}) }}
              onClick={() => a && select(sel)}
              title={meta.hint}
            >
              <div style={{ ...s.kpiLabel, color: tc(meta.color) }}>{meta.label}</div>
              <div style={s.kpiValue}>{nf0.format(a?.nb ?? 0)}</div>
              <div style={s.kpiSub}>{(T.reste.charAt(0).toLowerCase() + T.reste.slice(1))} {nfEur.format(a?.reste ?? 0)}</div>
            </div>
          )
        })}
      </div>

      {/* Matrice */}
      <div style={{ ...s.card, marginBottom: 18 }}>
        <div style={s.cardHead}>
          <h2 style={s.cardTitle}>Statut BLG × situation dans SAGE</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {VERDICT_ORDRE.map((v) => (
              <span key={v} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: tc(VERDICTS[v].color) }} />
                {VERDICTS[v].label}
              </span>
            ))}
            {hasSelection && (
              <button type="button" style={s.btn} onClick={() => setSelection({ statut: null, situation: null, verdict: null })}>Effacer la sélection</button>
            )}
          </div>
        </div>
        <div style={s.scroll}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Statut BLG ↓ / SAGE →</th>
                {SITUATIONS.map((x) => (
                  <th key={x.code} style={{ ...s.thNum, cursor: 'pointer' }} title={x.hint} onClick={() => select({ statut: null, situation: x.code, verdict: null })}>
                    {x.label}
                  </th>
                ))}
                <th style={s.thNum}>Total</th>
              </tr>
            </thead>
            <tbody>
              {statuts.map((st) => (
                <tr key={st.code}>
                  <td
                    style={{ ...s.rowLabel, ...(isSelected({ statut: st.code, situation: null, verdict: null }) ? { boxShadow: `inset 0 0 0 2px ${tc('#A6A181')}` } : {}) }}
                    onClick={() => select({ statut: st.code, situation: null, verdict: null })}
                  >
                    {st.libelle}
                    {aQualifier.has(st.code) && <span title="Libellé déduit des données BLG, à confirmer" style={s.muted}> *</span>}
                  </td>
                  {SITUATIONS.map((x) => {
                    const a = agg.get(`${st.code}|${x.code}`)
                    if (!a) return <td key={x.code} style={s.cellEmpty}>·</td>
                    const sel: Selection = { statut: st.code, situation: x.code, verdict: null }
                    const v = cellVerdict(st.code, x.code)
                    return (
                      <td key={x.code} style={cellStyle(v, isSelected(sel))} onClick={() => select(sel)} title={v ? `${VERDICTS[v].label} — ${VERDICTS[v].hint}` : undefined}>
                        {renderValue(a)}
                      </td>
                    )
                  })}
                  <td style={{ ...cellStyle(null, isSelected({ statut: st.code, situation: null, verdict: null })) }} onClick={() => select({ statut: st.code, situation: null, verdict: null })}>
                    {renderValue(agg.get(`${st.code}|*`))}
                  </td>
                </tr>
              ))}
              {statuts.length > 0 && (
                <tr>
                  <td style={{ ...s.rowLabel, cursor: 'default' }}>Total</td>
                  {SITUATIONS.map((x) => {
                    const a = agg.get(`*|${x.code}`)
                    if (!a) return <td key={x.code} style={s.cellEmpty}>·</td>
                    const sel: Selection = { statut: null, situation: x.code, verdict: null }
                    return (
                      <td key={x.code} style={cellStyle(null, isSelected(sel))} onClick={() => select(sel)}>
                        {renderValue(a)}
                      </td>
                    )
                  })}
                  <td style={{ ...cellStyle(null, false), cursor: 'default' }}>{renderValue(total)}</td>
                </tr>
              )}
              {!loadingMatrice && statuts.length === 0 && (
                <tr>
                  <td style={s.td} colSpan={SITUATIONS.length + 2}>Aucune commande sur ce périmètre.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={s.note}>{T.note}</div>
      </div>

      {/* Liste */}
      {hasSelection && (
        <div style={s.card}>
          <div style={s.cardHead}>
            <div>
              <h2 style={s.cardTitle}>{selectionLabel}</h2>
              <div style={{ ...s.muted, marginTop: 4 }}>
                {loadingListe
                  ? 'Chargement…'
                  : `${nf0.format(listeTotaux.nb)} commandes · montant BLG ${nfEur.format(listeTotaux.blg)} · ${(T.reste.charAt(0).toLowerCase() + T.reste.slice(1))} ${nfEur.format(listeTotaux.reste)}${listeTotaux.recentes ? ` · ${nf0.format(listeTotaux.recentes)} facturée(s) depuis ≤ 2 j` : ''}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input style={{ ...s.input, minWidth: 260 }} placeholder={domaine === 'ACHAT' ? 'Rechercher : CDF, fournisseur, BLF, FAF…' : 'Rechercher : CDC, client, facture…'} value={search} onChange={(e) => setSearch(e.target.value)} />
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} title="Commandes facturées dans SAGE depuis 2 jours ou moins : BLG n'a peut-être pas encore reçu la facture.">
                <input type="checkbox" checked={masquerRecentes} onChange={(e) => setMasquerRecentes(e.target.checked)} />
                {domaine === 'ACHAT' ? 'Masquer les FAF récentes' : 'Masquer les factures récentes (≤ 2 j)'}
              </label>
            </div>
          </div>
          <div style={{ ...s.scroll, maxHeight: '70vh', overflowY: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={{ ...s.th, ...s.sortable }} onClick={() => toggleSort('reference')}>{domaine === 'ACHAT' ? 'CDF BLG' : 'CDC BLG'}</th>
                  <th style={s.th}>Statut BLG</th>
                  <th style={{ ...s.th, ...s.sortable }} onClick={() => toggleSort('blg_order_date')}>Cde BLG</th>
                  <th style={{ ...s.th, ...s.sortable }} onClick={() => toggleSort('intitule_tiers')}>{T.tiers}</th>
                  <th style={{ ...s.th, ...s.sortable }} onClick={() => toggleSort('agence')}>{T.lieu}</th>
                  <th style={s.thNum}>Lignes BLG</th>
                  <th style={{ ...s.thNum, ...s.sortable }} onClick={() => toggleSort('blg_montant_ht')}>Montant BLG</th>
                  <th style={{ ...s.thNum, ...s.sortable }} onClick={() => toggleSort('blg_reste_ht')}>{T.resteCourt}</th>
                  <th style={{ ...s.th, borderLeft: '2px solid rgba(166,161,129,0.5)' }}>Situation SAGE</th>
                  <th style={s.th}>{T.piecesSage}</th>
                  <th style={s.th}>{T.facturesSage}</th>
                  <th style={{ ...s.thNum, ...s.sortable }} onClick={() => toggleSort('sage_montant_facture')}>Facturé SAGE</th>
                  <th style={{ ...s.th, ...s.sortable }} onClick={() => toggleSort('sage_derniere_facture')}>Dernière fact.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((r) => {
                  const v = VERDICTS[r.verdict]
                  return (
                    <tr key={r.reference}>
                      <td style={{ ...s.td, whiteSpace: 'nowrap', borderLeft: `3px solid ${tc(v?.color ?? '#9AA3B5')}` }}>
                        {r.lien_blg ? (
                          <a href={r.lien_blg} target="_blank" rel="noreferrer" style={{ ...s.mono, ...s.link }} title="Ouvrir la commande dans BLG">
                            {r.reference} ↗
                          </a>
                        ) : (
                          <span style={s.mono}>{r.reference}</span>
                        )}
                        <span style={{ ...s.small, color: tc(v?.color ?? '#9AA3B5') }}>{v?.label ?? r.verdict}</span>
                      </td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                        <span>{r.statut_libelle}</span>
                        <span style={s.small}>
                          {LIVRAISON_LABELS[r.blg_delivery_status ?? ''] ?? r.blg_delivery_status ?? '—'} · {FACTURATION_LABELS[r.blg_invoice_status ?? ''] ?? r.blg_invoice_status ?? '—'}
                        </span>
                        {r.archivee && <span style={s.small}>Motif : {r.archive_motif ?? 'Sans motif'}</span>}
                      </td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                        {fmtDate(r.blg_order_date)}
                        <span style={s.small}>modif. {fmtDate(r.blg_last_update)}</span>
                      </td>
                      <td style={s.td}>
                        <span>{r.intitule_tiers ?? '—'}</span>
                        <span style={s.small}>{r.numero_tiers ?? ''}{r.collaborateur ? ` · ${r.collaborateur}` : ''}</span>
                      </td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{r.agence ?? '—'}</td>
                      <td style={s.tdNum}>
                        {nf0.format(num(r.blg_nb_lignes))}
                        <span style={s.small}>{nf0.format(num(r.blg_nb_lignes_a_livrer))} {domaine === 'ACHAT' ? 'à recevoir' : 'à livrer'}</span>
                      </td>
                      <td style={s.tdNum}>{nfEur2.format(num(r.blg_montant_ht))}</td>
                      <td style={s.tdNum}>{num(r.blg_reste_ht) ? nfEur2.format(num(r.blg_reste_ht)) : <span style={s.muted}>0</span>}</td>
                      <td style={{ ...s.td, borderLeft: '2px solid rgba(166,161,129,0.35)', whiteSpace: 'nowrap' }}>
                        {r.situation_libelle}
                        {num(r.sage_montant_en_cours) !== 0 && (
                          <span style={s.small}>{nfEur2.format(num(r.sage_montant_en_cours))} · {nf0.format(num(r.sage_nb_lignes_en_cours))} l.</span>
                        )}
                        {r.sage_date_livraison && <span style={s.small}>{domaine === 'ACHAT' ? 'Récept. prévue' : 'Livr. prévue'} {fmtDate(r.sage_date_livraison)}</span>}
                      </td>
                      <td style={{ ...s.td, maxWidth: 200 }}>
                        {r.sage_pieces_en_cours ? <span style={s.mono}>{r.sage_pieces_en_cours}</span> : <span style={s.muted}>—</span>}
                      </td>
                      <td style={{ ...s.td, maxWidth: 200 }}>
                        {r.sage_factures ? <span style={s.mono}>{r.sage_factures}</span> : <span style={s.muted}>—</span>}
                        {num(r.sage_nb_factures) > 1 && <span style={s.small}>{nf0.format(num(r.sage_nb_factures))} factures</span>}
                      </td>
                      <td style={s.tdNum}>{num(r.sage_montant_facture) ? nfEur2.format(num(r.sage_montant_facture)) : <span style={s.muted}>—</span>}</td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                        {fmtDate(r.sage_derniere_facture)}
                        {r.facture_recente && <span style={{ ...s.small, color: tc('#8FC7DA') }}>{domaine === 'ACHAT' ? 'FAF récente' : 'récente : synchro BLG ?'}</span>}
                      </td>
                    </tr>
                  )
                })}
                {!loadingListe && filtered.length === 0 && (
                  <tr>
                    <td style={s.td} colSpan={13}>Aucune commande.</td>
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
          <div style={s.note}>{T.noteListe}</div>
        </div>
      )}
    </div>
  )
}
