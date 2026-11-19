'use client'

/**
 * Écran « Tarifs fournisseurs » (Stocks & logistique, /stock/tarifs-fournisseurs).
 * ---------------------------------------------------------------------------
 * Créé le 19/11/2026 à la demande d'Arnaud — droit can_appro (contrôlé en base par tarif_peut_acceder()).
 *
 * 1. Tarif actuel (SAGE) d'un fournisseur : prix tarif, remise, prix net, paliers quantitatifs
 *    (F_TARIFQTE), prix programmé, dernier prix d'achat, coefficient et prix de vente de la fiche
 *    article, volumes de l'année glissante (ventes facturées SAGE, achats reçus BLG).
 * 2. Propositions de nouveau tarif : n'importe quel Excel / CSV / PDF déposé est lu (en-tête et
 *    colonnes détectés, paliers « quantité → prix », corrigeables), éventuellement par l'IA pour un
 *    PDF mal structuré, puis enregistré (fichier d'origine conservé) et apparié aux articles SAGE
 *    (réf. fournisseur, réf. marquée obsolète, référence article, EAN ; correction manuelle ✎).
 * 3. Comparaison immédiate : prix actuel et nouveau prix à quantité égale (unitaire ou quantité
 *    habituelle par commande), évolution %, impact € sur la masse d'achat annuelle (volume = ventes
 *    12 mois SAGE ou achats reçus 12 mois), synthèse par gamme, PV à coefficient constant et marge
 *    si le PV ne bouge pas, articles nouveaux et articles SAGE absents du fichier, export Excel.
 *
 * Données : get_tarifs_fournisseurs_liste, get_tarifs_fournisseur, save_tarif_proposition,
 * update_tarif_proposition, set_tarif_ligne_article, delete_tarif_proposition, search_tarif_articles ;
 * lecture des fichiers : lib/tarifsFournisseurs.ts ; extraction IA : /api/stock/tarifs/extraire.
 * Migration : supabase/migrations/20261119e_tarifs_fournisseurs.sql.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'
import {
  CHAMPS, LIBELLES_CHAMPS, choisirFeuille, detecterEntete, detecterMapping, devinerFournisseur, grilleAligneePdf,
  grilleBrutePdf, infosFichier, lireExcel, lireLignes, lirePdf, prixPalier, prixSage, seuilsComparaison, texte,
  textesClasseur,
  type Cellule, type Champ, type Grille, type LigneImport, type LignePdf, type Mapping, type Palier, type PalierSage,
} from '@/lib/tarifsFournisseurs'

const BUCKET = 'tarifs-fournisseurs'

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type FournisseurListe = {
  fournisseur: string; nom: string | null; sommeil: string | null; nb_articles: number; nb_actifs: number; nb_principal: number
  nb_articles_paliers: number; masse_achat_12m: number; nb_propositions: number; derniere_proposition: string | null
}
type Article = {
  reference: string; designation: string | null; famille: string | null; marque: string | null; sommeil: boolean
  du_fournisseur: boolean; principal: boolean; fournisseur_principal: string | null; ref_fournisseur: string | null; ean: string | null
  prix_tarif: number | null; remise: number | null; prix_net: number | null; prix_nouveau_sage: number | null; date_application_sage: string | null
  colisage: number | null; qte_mini: number | null; prix_achat_fiche: number | null; dernier_prix_achat: number | null
  coef: number | null; prix_vente: number | null; paliers: PalierSage[] | null
  qte_ventes_12m: number; ca_ventes_12m: number; marge_ventes_12m: number; nb_clients_12m: number
  qte_achats_12m: number; nb_lignes_cdf_12m: number; qte_moy_ligne_cdf: number | null
}
type Statut = 'a_analyser' | 'en_negociation' | 'acceptee' | 'refusee' | 'archivee'
type Resume = {
  evol_pct?: number | null; impact?: number; masse_actuelle?: number; masse_nouvelle?: number; nb_lignes?: number; nb_apparies?: number
  nb_nouveaux?: number; nb_absents?: number; nb_hausses?: number; nb_baisses?: number; base?: Base; qref?: QRef; calcule_le?: string
}
type Proposition = {
  id: number; fournisseur: string; fournisseur_nom: string | null; libelle: string | null; fichier_nom: string | null; fichier_type: string | null
  fichier_path: string | null; source_import: string | null; date_reception: string | null; date_effet: string | null; date_fin: string | null
  statut: Statut; commentaire: string | null; conditions?: string[] | null; resume: Resume | null; nb_lignes: number | null
  cree_le: string; cree_par: string | null; modifie_le: string | null; modifie_par: string | null
}
type LigneProp = {
  id: number; ligne_no: number | null; ref_fournisseur: string | null; ean: string | null; designation: string | null; marque: string | null
  gamme: string | null; unite: string | null; prix_public: number | null; colisage: number | null; qte_palette: number | null
  paliers: Palier[]; prix_base: number | null; reference_article: string | null; appariement: string | null; nb_candidats: number | null
  appariement_manuel: boolean; ignoree: boolean; commentaire: string | null
}
type Donnees = {
  fournisseur: string; nom: string | null; genere_le: string; periode_volumes: { du: string; au: string }
  articles: Article[]; propositions: Proposition[]; proposition: Proposition | null; lignes: LigneProp[]
}
type Base = 'ventes' | 'achats'
type QRef = 'unitaire' | 'habituelle'
type Vue = 'actuel' | 'propositions' | 'comparaison'

type EtatLigne = 'hausse' | 'baisse' | 'stable' | 'nouveau' | 'sans_prix' | 'doublon' | 'ignoree'
type LigneComp = {
  l: LigneProp; art: Article | null; q: number; pa: number | null; pn: number | null; evol: number | null; vol: number
  masse: number; impact: number; etat: EtatLigne; gamme: string; pvCoef: number | null; margeAct: number | null; margeNew: number | null
}

type ImportEnCours = {
  fichier: File; type: 'excel' | 'pdf'
  grilles: Grille[]; feuille: number
  pdfLignes: LignePdf[] | null; pdfTextes: string[]
  mapping: Mapping
  fournisseur: string; libelle: string; date_effet: string; date_fin: string; conditions: string[]
  lignesIA: LigneImport[] | null; progressionIA: string | null
}

// ─────────────────────────────────────────────────────────────────────────
// Formats
// ─────────────────────────────────────────────────────────────────────────

const n0 = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
function fmtNum(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtPrix(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  return `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}
function fmtEur(v: number | null | undefined, signe = false): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  const a = Math.abs(v)
  const s = signe && v > 0 ? '+' : ''
  if (a >= 1_000_000) return `${s}${(v / 1_000_000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M€`
  if (a >= 10_000) return `${s}${Math.round(v / 1000).toLocaleString('fr-FR')} k€`
  return `${s}${Math.round(v).toLocaleString('fr-FR')} €`
}
function fmtPct(v: number | null | undefined, dec = 1, signe = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const x = v * 100
  return `${signe && x > 0 ? '+' : ''}${x.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })} %`
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v.length === 10 ? `${v}T12:00:00` : v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('fr-FR')
}
function messageErreur(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as { message?: string; details?: string; hint?: string; code?: string }
    return [o.message, o.details, o.hint].filter(Boolean).join(' — ') || JSON.stringify(e)
  }
  return String(e)
}
const couleurEvol = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) || Math.abs(v) < 0.0005 ? '#8A8474' : v > 0 ? '#A3401C' : '#2F6F33'

const STATUTS: Record<Statut, { libelle: string; bg: string; fg: string }> = {
  a_analyser: { libelle: 'À analyser', bg: '#FCEFD9', fg: '#96600F' },
  en_negociation: { libelle: 'En négociation', bg: '#E4EEF8', fg: '#2D5F8C' },
  acceptee: { libelle: 'Acceptée', bg: '#E3F1E4', fg: '#2F6F33' },
  refusee: { libelle: 'Refusée', bg: '#F8E4DC', fg: '#A3401C' },
  archivee: { libelle: 'Archivée', bg: '#EFECE5', fg: '#8A8474' },
}
const ETATS: Record<EtatLigne, { libelle: string; bg: string; fg: string }> = {
  hausse: { libelle: 'Hausse', bg: '#F8E4DC', fg: '#A3401C' },
  baisse: { libelle: 'Baisse', bg: '#E3F1E4', fg: '#2F6F33' },
  stable: { libelle: 'Stable', bg: '#EFECE5', fg: '#5F5A4E' },
  nouveau: { libelle: 'Non trouvé SAGE', bg: '#E4EEF8', fg: '#2D5F8C' },
  sans_prix: { libelle: 'Sans prix SAGE', bg: '#FCEFD9', fg: '#96600F' },
  doublon: { libelle: 'Doublon', bg: '#EFECE5', fg: '#8A8474' },
  ignoree: { libelle: 'Ignorée', bg: '#EFECE5', fg: '#8A8474' },
}
const APPARIEMENTS: Record<string, string> = {
  ref_fournisseur: 'réf. fournisseur SAGE',
  ref_obsolete: 'réf. fournisseur marquée obsolète dans SAGE',
  reference: 'référence article SAGE',
  ean: 'code EAN',
  manuel: 'appariement manuel',
}

const ctl = 'h-9 rounded-lg border border-[#D9D4C7] bg-white px-2.5 text-[12.5px] outline-none focus:border-[#B4761A]'
const btn = 'h-9 rounded-lg border border-[#D9D4C7] bg-white px-3 text-[12.5px] font-bold hover:border-[#B4761A] disabled:opacity-50'
const btnFonce = 'h-9 rounded-lg bg-[#111820] px-3.5 text-[12.5px] font-bold text-white hover:bg-[#2A3440] disabled:opacity-50'

// ─────────────────────────────────────────────────────────────────────────
// Petits composants
// ─────────────────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, color, onClick, actif }: { label: string; value: string; sub?: string; color?: string; onClick?: () => void; actif?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={`min-w-0 rounded-xl border bg-white px-3 py-2 text-left ${actif ? 'border-[#111820] ring-1 ring-[#111820]' : 'border-[#E5E1D8]'} ${onClick ? 'hover:border-[#B4761A]' : 'cursor-default'}`}>
      <div className="truncate text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">{label}</div>
      <div className="text-[20px] font-bold leading-7 tracking-tight" style={{ color: color || '#111820' }}>{value}</div>
      {sub && <div className="truncate text-[11px] text-[#8A8474]">{sub}</div>}
    </button>
  )
}
function Pastille({ bg, fg, children, title }: { bg: string; fg: string; children: React.ReactNode; title?: string }) {
  return <span title={title} className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: bg, color: fg }}>{children}</span>
}
function PaliersSage({ a }: { a: Article }) {
  if (!a.paliers?.length) return <span className="text-[#8A8474]">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {a.paliers.map((p, i) => (
        <span key={i} className="whitespace-nowrap rounded bg-[#F4F3F0] px-1.5 text-[11px]" title={`De ${fmtNum(n0(p.de) + 1)} à ${fmtNum(p.a)}`}>
          {i === 0 ? '≤' : '≥'}{fmtNum(i === 0 ? p.a : n0(p.de) + 1)} : {fmtNum(p.prix, 2)}
        </span>
      ))}
    </span>
  )
}
function PaliersNouveaux({ p }: { p: Palier[] }) {
  if (!p?.length) return <span className="text-[#8A8474]">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {p.map((x, i) => (
        <span key={i} className="whitespace-nowrap rounded bg-[#F4F3F0] px-1.5 text-[11px]">≥{fmtNum(x.qte)} : {fmtNum(x.prix, 2)}</span>
      ))}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Calcul de la comparaison
// ─────────────────────────────────────────────────────────────────────────

function quantiteReference(art: Article | null, qref: QRef): number {
  if (qref === 'unitaire' || !art) return 1
  const q = n0(art.qte_moy_ligne_cdf)
  return q >= 1 ? Math.round(q) : 1
}
function volume(art: Article | null, base: Base): number {
  if (!art) return 0
  return Math.max(0, base === 'ventes' ? n0(art.qte_ventes_12m) : n0(art.qte_achats_12m))
}

function comparer(d: Donnees, base: Base, qref: QRef): { lignes: LigneComp[]; absents: Article[] } {
  const parRef = new Map(d.articles.map((a) => [a.reference, a]))
  const vus = new Set<string>()
  const lignes: LigneComp[] = d.lignes.map((l) => {
    const art = l.reference_article ? parRef.get(l.reference_article) || null : null
    const q = quantiteReference(art, qref)
    const pa = art ? prixSage(art.prix_net, art.paliers, q) : null
    const pn = prixPalier(l.paliers, q)
    const vol = volume(art, base)
    let etat: EtatLigne
    if (l.ignoree) etat = 'ignoree'
    else if (!art) etat = 'nouveau'
    else if (vus.has(art.reference)) etat = 'doublon'
    else if (pa === null || pn === null) etat = 'sans_prix'
    else {
      const ev = pn / pa - 1
      etat = Math.abs(ev) < 0.0005 ? 'stable' : ev > 0 ? 'hausse' : 'baisse'
    }
    if (art && !l.ignoree) vus.add(art.reference)
    const compte = etat === 'hausse' || etat === 'baisse' || etat === 'stable'
    const evol = pa && pn ? pn / pa - 1 : null
    const pv = art?.prix_vente ?? null
    return {
      l, art, q, pa, pn, evol, vol,
      masse: compte && pa ? pa * vol : 0,
      impact: compte && pa && pn ? (pn - pa) * vol : 0,
      etat,
      gamme: l.gamme || art?.famille || '—',
      pvCoef: pn !== null && art?.coef ? pn * art.coef : null,
      margeAct: pv && pa !== null ? (pv - pa) / pv : null,
      margeNew: pv && pn !== null ? (pv - pn) / pv : null,
    }
  })
  const absents = d.articles.filter((a) => a.du_fournisseur && !a.sommeil && !vus.has(a.reference))
  return { lignes, absents }
}

type Synthese = {
  nbLignes: number; nbApparies: number; nbNouveaux: number; nbSansPrix: number; nbHausses: number; nbBaisses: number; nbStables: number
  masse: number; impact: number; evol: number | null; evolSimple: number | null; caPv: number; margeAct: number | null; margeNew: number | null
}
function synthese(lignes: LigneComp[]): Synthese {
  const s: Synthese = { nbLignes: 0, nbApparies: 0, nbNouveaux: 0, nbSansPrix: 0, nbHausses: 0, nbBaisses: 0, nbStables: 0, masse: 0, impact: 0, evol: null, evolSimple: null, caPv: 0, margeAct: null, margeNew: null }
  let sommeEvol = 0
  let nbEvol = 0
  let pvVol = 0
  let mAct = 0
  let mNew = 0
  for (const x of lignes) {
    if (x.etat === 'ignoree') continue
    s.nbLignes++
    if (x.art) s.nbApparies++
    if (x.etat === 'nouveau') s.nbNouveaux++
    if (x.etat === 'sans_prix') s.nbSansPrix++
    if (x.etat === 'hausse') s.nbHausses++
    if (x.etat === 'baisse') s.nbBaisses++
    if (x.etat === 'stable') s.nbStables++
    if (x.etat === 'hausse' || x.etat === 'baisse' || x.etat === 'stable') {
      s.masse += x.masse
      s.impact += x.impact
      if (x.evol !== null) { sommeEvol += x.evol; nbEvol++ }
      const pv = x.art?.prix_vente
      if (pv && x.vol > 0 && x.pa !== null && x.pn !== null) {
        pvVol += pv * x.vol
        mAct += (pv - x.pa) * x.vol
        mNew += (pv - x.pn) * x.vol
      }
    }
  }
  s.evol = s.masse > 0 ? s.impact / s.masse : null
  s.evolSimple = nbEvol ? sommeEvol / nbEvol : null
  s.caPv = pvVol
  s.margeAct = pvVol > 0 ? mAct / pvVol : null
  s.margeNew = pvVol > 0 ? mNew / pvVol : null
  return s
}

// ─────────────────────────────────────────────────────────────────────────
// Export Excel
// ─────────────────────────────────────────────────────────────────────────

async function exporterExcel(d: Donnees, comp: { lignes: LigneComp[]; absents: Article[] }, base: Base, qref: QRef) {
  const p = d.proposition
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Compagnon CEGECLIM'
  const euro = '#,##0.00 "€";[Red]-#,##0.00 "€"'
  const euro0 = '#,##0 "€";[Red]-#,##0 "€"'
  const pct = '+0.0%;[Red]-0.0%;0.0%'
  const entete = (ws: ExcelJS.Worksheet) => {
    const h = ws.getRow(1)
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111820' } }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } }
  }
  const s = synthese(comp.lignes)

  const ws0 = wb.addWorksheet('Synthèse')
  ws0.columns = [{ width: 46 }, { width: 22 }]
  const lignesSyn: [string, string | number | null, string?][] = [
    ['Fournisseur', `${d.fournisseur} — ${d.nom || ''}`],
    ['Proposition', p?.libelle || p?.fichier_nom || ''],
    ['Fichier', p?.fichier_nom || ''],
    ['Date d’effet', p?.date_effet ? fmtDate(p.date_effet) : ''],
    ['Volume retenu', base === 'ventes' ? `Ventes facturées SAGE ${fmtDate(d.periode_volumes.du)} → ${fmtDate(d.periode_volumes.au)}` : `Achats reçus BLG 12 mois`],
    ['Quantité de comparaison', qref === 'unitaire' ? 'Unitaire (1er palier)' : 'Quantité habituelle par ligne de commande fournisseur'],
    ['Lignes du fichier', s.nbLignes],
    ['Appariées à un article SAGE', s.nbApparies],
    ['Non trouvées dans SAGE', s.nbNouveaux],
    ['Articles SAGE actifs absents du fichier', comp.absents.length],
    ['Hausses / baisses / stables', `${s.nbHausses} / ${s.nbBaisses} / ${s.nbStables}`],
    ['Masse d’achat annuelle actuelle', s.masse, euro0],
    ['Masse d’achat annuelle au nouveau tarif', s.masse + s.impact, euro0],
    ['Impact annuel', s.impact, euro0],
    ['Évolution pondérée par la masse', s.evol, pct],
    ['Évolution moyenne simple', s.evolSimple, pct],
    ['Marge théorique actuelle (PV fiche)', s.margeAct, '0.0%'],
    ['Marge théorique si PV inchangé', s.margeNew, '0.0%'],
  ]
  for (const [k, v, f] of lignesSyn) {
    const r = ws0.addRow([k, v])
    r.getCell(1).font = { bold: true }
    if (f) r.getCell(2).numFmt = f
  }
  ws0.addRow([])
  const parGamme = new Map<string, { masse: number; impact: number; nb: number }>()
  for (const x of comp.lignes) {
    if (!(x.etat === 'hausse' || x.etat === 'baisse' || x.etat === 'stable')) continue
    const g = parGamme.get(x.gamme) || { masse: 0, impact: 0, nb: 0 }
    g.masse += x.masse; g.impact += x.impact; g.nb++
    parGamme.set(x.gamme, g)
  }
  const hg = ws0.addRow(['Gamme', 'Articles', 'Masse actuelle', 'Impact', 'Évolution'])
  hg.font = { bold: true }
  ws0.getColumn(3).width = 16; ws0.getColumn(4).width = 14; ws0.getColumn(5).width = 12
  for (const [g, v] of [...parGamme.entries()].sort((a, b) => Math.abs(b[1].impact) - Math.abs(a[1].impact))) {
    const r = ws0.addRow([g, v.nb, v.masse, v.impact, v.masse > 0 ? v.impact / v.masse : null])
    r.getCell(3).numFmt = euro0; r.getCell(4).numFmt = euro0; r.getCell(5).numFmt = pct
  }

  const ws = wb.addWorksheet('Comparaison')
  ws.columns = [
    { header: 'Réf. fournisseur', key: 'rf', width: 16 }, { header: 'Article SAGE', key: 'ref', width: 18 },
    { header: 'Désignation', key: 'des', width: 42 }, { header: 'Gamme', key: 'gamme', width: 28 }, { header: 'État', key: 'etat', width: 14 },
    { header: 'Qté comparée', key: 'q', width: 10 }, { header: 'Prix actuel', key: 'pa', width: 12, style: { numFmt: euro } },
    { header: 'Nouveau prix', key: 'pn', width: 12, style: { numFmt: euro } }, { header: 'Évolution', key: 'ev', width: 10, style: { numFmt: pct } },
    { header: 'Paliers actuels (SAGE)', key: 'ps', width: 30 }, { header: 'Nouveaux paliers', key: 'pnv', width: 34 },
    { header: 'Volume 12 mois', key: 'vol', width: 10 }, { header: 'Masse actuelle', key: 'masse', width: 13, style: { numFmt: euro0 } },
    { header: 'Impact annuel', key: 'imp', width: 13, style: { numFmt: euro0 } }, { header: 'Coef.', key: 'coef', width: 7 },
    { header: 'PV fiche', key: 'pv', width: 11, style: { numFmt: euro } }, { header: 'PV à coef. constant', key: 'pvc', width: 13, style: { numFmt: euro } },
    { header: 'Marge actuelle', key: 'ma', width: 10, style: { numFmt: '0.0%' } }, { header: 'Marge si PV inchangé', key: 'mn', width: 12, style: { numFmt: '0.0%' } },
    { header: 'Prix public', key: 'ppub', width: 11, style: { numFmt: euro } }, { header: 'Appariement', key: 'app', width: 24 },
  ]
  for (const x of comp.lignes) {
    ws.addRow({
      rf: x.l.ref_fournisseur, ref: x.art?.reference || x.l.reference_article, des: x.l.designation || x.art?.designation,
      gamme: x.gamme, etat: ETATS[x.etat].libelle, q: x.q, pa: x.pa, pn: x.pn, ev: x.evol,
      ps: (x.art?.paliers || []).map((p, i) => `${i === 0 ? '≤' : '≥'}${i === 0 ? p.a : n0(p.de) + 1} : ${fmtNum(p.prix, 2)}`).join(' · '),
      pnv: (x.l.paliers || []).map((p) => `≥${p.qte} : ${fmtNum(p.prix, 2)}`).join(' · '),
      vol: x.vol, masse: x.masse, imp: x.impact, coef: x.art?.coef, pv: x.art?.prix_vente, pvc: x.pvCoef,
      ma: x.margeAct, mn: x.margeNew, ppub: x.l.prix_public, app: x.l.appariement ? APPARIEMENTS[x.l.appariement] || x.l.appariement : '',
    })
  }
  entete(ws)

  const wa = wb.addWorksheet('Absents du fichier')
  wa.columns = [
    { header: 'Article SAGE', key: 'ref', width: 18 }, { header: 'Désignation', key: 'des', width: 42 }, { header: 'Réf. fournisseur', key: 'rf', width: 18 },
    { header: 'Prix net actuel', key: 'pa', width: 13, style: { numFmt: euro } }, { header: 'Ventes 12 mois (qté)', key: 'qv', width: 12 },
    { header: 'Achats reçus 12 mois (qté)', key: 'qa', width: 12 }, { header: 'Masse actuelle', key: 'm', width: 13, style: { numFmt: euro0 } },
  ]
  for (const a of comp.absents.sort((x, y) => volume(y, base) * n0(y.prix_net) - volume(x, base) * n0(x.prix_net))) {
    wa.addRow({ ref: a.reference, des: a.designation, rf: a.ref_fournisseur, pa: a.prix_net, qv: a.qte_ventes_12m, qa: a.qte_achats_12m, m: volume(a, base) * n0(a.prix_net) })
  }
  entete(wa)

  const buffer = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `comparaison_tarif_${d.fournisseur}_${(p?.date_effet || new Date().toISOString()).slice(0, 10)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

async function exporterTarifActuel(d: Donnees, articles: Article[]) {
  const wb = new ExcelJS.Workbook()
  const euro = '#,##0.00 "€"'
  const ws = wb.addWorksheet('Tarif actuel SAGE')
  ws.columns = [
    { header: 'Article', key: 'ref', width: 18 }, { header: 'Désignation', key: 'des', width: 42 }, { header: 'Famille', key: 'fam', width: 14 },
    { header: 'Réf. fournisseur', key: 'rf', width: 18 }, { header: 'En sommeil', key: 'som', width: 9 }, { header: 'Prix tarif', key: 'pt', width: 11, style: { numFmt: euro } },
    { header: 'Remise %', key: 'rem', width: 9 }, { header: 'Prix net', key: 'pn', width: 11, style: { numFmt: euro } },
    { header: 'Paliers', key: 'pal', width: 34 }, { header: 'Prix programmé SAGE', key: 'pp', width: 13, style: { numFmt: euro } },
    { header: 'Date d’application', key: 'dap', width: 12 }, { header: 'Dernier prix d’achat', key: 'dpa', width: 12, style: { numFmt: euro } },
    { header: 'Coef.', key: 'coef', width: 7 }, { header: 'PV fiche', key: 'pv', width: 11, style: { numFmt: euro } },
    { header: 'Marge théorique', key: 'mt', width: 10, style: { numFmt: '0.0%' } }, { header: 'Ventes 12 mois (qté)', key: 'qv', width: 11 },
    { header: 'Achats reçus 12 mois (qté)', key: 'qa', width: 11 }, { header: 'Masse d’achat 12 mois', key: 'm', width: 13, style: { numFmt: '#,##0 "€"' } },
  ]
  for (const a of articles) {
    ws.addRow({
      ref: a.reference, des: a.designation, fam: a.famille, rf: a.ref_fournisseur, som: a.sommeil ? 'oui' : '', pt: a.prix_tarif, rem: a.remise,
      pn: a.prix_net, pal: (a.paliers || []).map((p, i) => `${i === 0 ? '≤' : '≥'}${i === 0 ? p.a : n0(p.de) + 1} : ${fmtNum(p.prix, 2)}`).join(' · '),
      pp: a.prix_nouveau_sage, dap: a.date_application_sage ? fmtDate(a.date_application_sage) : '', dpa: a.dernier_prix_achat, coef: a.coef,
      pv: a.prix_vente, mt: a.prix_vente && a.prix_net ? (a.prix_vente - a.prix_net) / a.prix_vente : null,
      qv: a.qte_ventes_12m, qa: a.qte_achats_12m, m: Math.max(0, a.qte_ventes_12m) * n0(a.prix_net),
    })
  }
  const h = ws.getRow(1)
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111820' } }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } }
  const buffer = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const el = document.createElement('a')
  el.href = url
  el.download = `tarif_actuel_${d.fournisseur}.xlsx`
  el.click()
  URL.revokeObjectURL(url)
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

function TarifsFournisseurs() {
  const router = useRouter()
  const params = useSearchParams()
  const frsUrl = (params.get('frs') || '').toUpperCase()
  const propUrl = params.get('prop') ? Number(params.get('prop')) : null
  const vueUrl = (params.get('vue') as Vue | null) || null

  const [liste, setListe] = useState<FournisseurListe[]>([])
  const [donnees, setDonnees] = useState<Donnees | null>(null)
  const [occupe, setOccupe] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [saisieFrs, setSaisieFrs] = useState('')

  const [base, setBase] = useState<Base>('ventes')
  const [qref, setQref] = useState<QRef>('unitaire')
  const [filtre, setFiltre] = useState<'tous' | EtatLigne | 'absents' | 'fortes'>('tous')
  const [seuilFort, setSeuilFort] = useState(5)
  const [recherche, setRecherche] = useState('')
  const [tri, setTri] = useState<{ col: string; sens: 1 | -1 }>({ col: 'impact', sens: -1 })
  const [voirSommeil, setVoirSommeil] = useState(false)
  const [seulementVentes, setSeulementVentes] = useState(false)
  const [fiche, setFiche] = useState<LigneComp | null>(null)
  const [imp, setImp] = useState<ImportEnCours | null>(null)
  const [glisse, setGlisse] = useState(false)

  const vue: Vue = vueUrl || (propUrl ? 'comparaison' : 'actuel')

  const naviguer = useCallback((frs: string | null, prop: number | null, v?: Vue) => {
    const q = new URLSearchParams()
    if (frs) q.set('frs', frs)
    if (prop) q.set('prop', String(prop))
    if (v) q.set('vue', v)
    router.replace(`/stock/tarifs-fournisseurs${q.toString() ? `?${q}` : ''}`)
  }, [router])

  // Liste des fournisseurs
  useEffect(() => {
    let annule = false
    ;(async () => {
      const { data, error } = await supabase.rpc('get_tarifs_fournisseurs_liste')
      if (annule) return
      if (error) setErreur(messageErreur(error))
      else setListe((data || []) as FournisseurListe[])
    })()
    return () => { annule = true }
  }, [])

  const charger = useCallback(async (frs: string, prop: number | null) => {
    setOccupe('Chargement du tarif…')
    setErreur(null)
    try {
      const { data, error } = await supabase.rpc('get_tarifs_fournisseur', { p_fournisseur: frs, p_proposition: prop })
      if (error) throw error
      setDonnees(data as Donnees)
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setOccupe(null)
    }
  }, [])

  useEffect(() => {
    if (frsUrl) void charger(frsUrl, propUrl)
    else setDonnees(null)
  }, [frsUrl, propUrl, charger])

  useEffect(() => {
    const f = liste.find((x) => x.fournisseur === frsUrl)
    setSaisieFrs(frsUrl ? `${frsUrl} — ${f?.nom || donnees?.nom || ''}` : '')
  }, [frsUrl, liste, donnees?.nom])

  // Comparaison
  const comp = useMemo(() => (donnees?.proposition ? comparer(donnees, base, qref) : null), [donnees, base, qref])
  const syn = useMemo(() => (comp ? synthese(comp.lignes) : null), [comp])

  // Mémorise la synthèse sur la proposition (liste des propositions)
  const dernierResume = useRef<string>('')
  useEffect(() => {
    if (!donnees?.proposition || !comp || !syn) return
    const r: Resume = {
      evol_pct: syn.evol, impact: Math.round(syn.impact), masse_actuelle: Math.round(syn.masse), masse_nouvelle: Math.round(syn.masse + syn.impact),
      nb_lignes: syn.nbLignes, nb_apparies: syn.nbApparies, nb_nouveaux: syn.nbNouveaux, nb_absents: comp.absents.length,
      nb_hausses: syn.nbHausses, nb_baisses: syn.nbBaisses, base, qref,
    }
    const cle = JSON.stringify(r)
    const existant = donnees.proposition.resume ? JSON.stringify({ ...donnees.proposition.resume, calcule_le: undefined }) : ''
    if (cle === dernierResume.current || cle === existant) return
    dernierResume.current = cle
    const id = donnees.proposition.id
    const t = window.setTimeout(() => {
      void supabase.rpc('update_tarif_proposition', { p_id: id, p: { resume: { ...r, calcule_le: new Date().toISOString() } } })
    }, 1200)
    return () => window.clearTimeout(t)
  }, [donnees?.proposition, comp, syn, base, qref])

  // ── Import ────────────────────────────────────────────────────────────
  async function deposer(f: File) {
    setErreur(null)
    setInfo(null)
    const nom = f.name.toLowerCase()
    const estPdf = nom.endsWith('.pdf') || f.type === 'application/pdf'
    setOccupe(`Lecture de ${f.name}…`)
    try {
      let grilles: Grille[] = []
      let pdfLignes: LignePdf[] | null = null
      let pdfTextes: string[] = []
      let feuille = 0
      let mapping: Mapping
      let textesInfo: string[]
      if (estPdf) {
        const r = await lirePdf(f)
        pdfLignes = r.lignes
        pdfTextes = r.texteParPage
        const brute = grilleBrutePdf(r.lignes)
        const idx = detecterEntete(brute)
        const alignee = grilleAligneePdf(r.lignes, idx)
        grilles = [{ feuille: 'PDF', lignes: alignee }]
        mapping = detecterMapping(alignee, idx)
        textesInfo = r.texteParPage.join('\n').split('\n').slice(0, 80).concat(r.texteParPage.join('\n').split('\n').slice(-40))
      } else {
        grilles = await lireExcel(f)
        feuille = choisirFeuille(grilles)
        mapping = detecterMapping(grilles[feuille].lignes)
        textesInfo = textesClasseur(grilles, grilles[feuille].feuille)
      }
      const infos = infosFichier(textesInfo)
      const devine = devinerFournisseur([f.name, ...textesInfo], liste)
      const frs = devine || frsUrl || ''
      const annee = infos.date_effet ? infos.date_effet.slice(0, 4) : String(new Date().getFullYear() + 1)
      setImp({
        fichier: f, type: estPdf ? 'pdf' : 'excel', grilles, feuille, pdfLignes, pdfTextes, mapping,
        fournisseur: frs, libelle: `Proposition tarif ${annee}`, date_effet: infos.date_effet || '', date_fin: infos.date_fin || '',
        conditions: infos.conditions, lignesIA: null, progressionIA: null,
      })
      if (devine && frsUrl && devine !== frsUrl) {
        setInfo(`Le fichier semble venir de ${devine} — ${liste.find((x) => x.fournisseur === devine)?.nom || ''} (fournisseur pré-sélectionné, modifiable).`)
      }
    } catch (e) {
      setErreur(`Lecture impossible : ${messageErreur(e)}`)
    } finally {
      setOccupe(null)
    }
  }

  const lignesImport = useMemo<LigneImport[]>(() => {
    if (!imp) return []
    if (imp.lignesIA) return imp.lignesIA
    const g = imp.grilles[imp.feuille]
    return g ? lireLignes(g.lignes, imp.mapping) : []
  }, [imp])

  function changerEntete(idx: number) {
    if (!imp) return
    if (imp.type === 'pdf' && imp.pdfLignes) {
      const alignee = grilleAligneePdf(imp.pdfLignes, idx)
      setImp({ ...imp, grilles: [{ feuille: 'PDF', lignes: alignee }], mapping: detecterMapping(alignee, idx), lignesIA: null })
    } else {
      setImp({ ...imp, mapping: detecterMapping(imp.grilles[imp.feuille].lignes, idx), lignesIA: null })
    }
  }

  async function extraireIA() {
    if (!imp || !imp.pdfTextes.length) return
    const lots: string[] = []
    let courant = ''
    for (const [i, t] of imp.pdfTextes.entries()) {
      const bloc = `--- Page ${i + 1} ---\n${t}\n`
      if (courant && courant.length + bloc.length > 12000) { lots.push(courant); courant = '' }
      courant += bloc
    }
    if (courant) lots.push(courant)
    const nomFrs = liste.find((x) => x.fournisseur === imp.fournisseur)?.nom || imp.fournisseur
    const toutes: LigneImport[] = []
    let effet = imp.date_effet
    let fin = imp.date_fin
    const conditions = [...imp.conditions]
    try {
      for (let i = 0; i < lots.length; i++) {
        setImp((x) => (x ? { ...x, progressionIA: `Extraction IA : lot ${i + 1} / ${lots.length}…` } : x))
        const res = await fetch('/api/stock/tarifs/extraire', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texte: lots[i], fournisseur: nomFrs }),
        })
        const j = await res.json().catch(() => null)
        if (!res.ok) throw new Error(j?.error || `Erreur ${res.status}`)
        for (const l of j.lignes || []) {
          toutes.push({
            ligne_no: toutes.length + 1, ref_fournisseur: l.ref_fournisseur, ean: l.ean, designation: l.designation, marque: l.marque,
            gamme: l.gamme, unite: null, prix_public: l.prix_public, colisage: null, qte_palette: null, paliers: l.paliers,
          })
        }
        if (!effet && j.date_effet) effet = j.date_effet
        if (!fin && j.date_fin) fin = j.date_fin
        for (const c of j.conditions || []) if (!conditions.includes(c)) conditions.push(c)
      }
      setImp((x) => (x ? { ...x, lignesIA: toutes, progressionIA: null, date_effet: effet, date_fin: fin, conditions } : x))
    } catch (e) {
      setImp((x) => (x ? { ...x, progressionIA: null } : x))
      setErreur(`Extraction IA : ${messageErreur(e)}`)
    }
  }

  async function enregistrerImport() {
    if (!imp) return
    if (!imp.fournisseur) { setErreur('Choisissez le fournisseur SAGE de cette proposition.'); return }
    if (!lignesImport.length) { setErreur('Aucune ligne de tarif lue : vérifiez la ligne d’en-tête et les colonnes « Réf. fournisseur » et « Prix ».'); return }
    setOccupe('Enregistrement et appariement aux articles SAGE…')
    setErreur(null)
    try {
      // Fichier d'origine (best effort : la comparaison n'en dépend pas)
      let chemin: string | null = null
      try {
        const propre = imp.fichier.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_')
        const p = `${imp.fournisseur}/${new Date().toISOString().replace(/[:.]/g, '-')}_${propre}`
        const { error } = await supabase.storage.from(BUCKET).upload(p, imp.fichier, { upsert: false, contentType: imp.fichier.type || undefined })
        if (!error) chemin = p
      } catch { /* fichier non conservé */ }
      const nomFrs = liste.find((x) => x.fournisseur === imp.fournisseur)?.nom || null
      const { data, error } = await supabase.rpc('save_tarif_proposition', {
        p: {
          fournisseur: imp.fournisseur, fournisseur_nom: nomFrs, libelle: imp.libelle, fichier_nom: imp.fichier.name,
          fichier_type: imp.type === 'pdf' ? 'pdf' : imp.fichier.name.toLowerCase().endsWith('.csv') ? 'csv' : 'excel',
          fichier_path: chemin, source_import: imp.lignesIA ? 'ia' : 'grille',
          date_effet: imp.date_effet || null, date_fin: imp.date_fin || null, conditions: imp.conditions,
          mapping: imp.lignesIA ? null : { feuille: imp.grilles[imp.feuille]?.feuille, ligne_entete: imp.mapping.ligneEntete + 1, colonnes: imp.mapping.colonnes },
          lignes: lignesImport.map((l) => ({ ...l, brut: undefined })),
        },
      })
      if (error) throw error
      const id = Number(data)
      setImp(null)
      setInfo(`Proposition enregistrée (${lignesImport.length} lignes)${chemin ? '' : ' — le fichier d’origine n’a pas pu être conservé'}.`)
      const { data: l2 } = await supabase.rpc('get_tarifs_fournisseurs_liste')
      if (l2) setListe(l2 as FournisseurListe[])
      if (imp.fournisseur === frsUrl && id === propUrl) await charger(frsUrl, id)
      naviguer(imp.fournisseur, id, 'comparaison')
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setOccupe(null)
    }
  }

  // ── Actions sur une proposition ──────────────────────────────────────
  async function majProposition(id: number, p: Record<string, unknown>) {
    const { error } = await supabase.rpc('update_tarif_proposition', { p_id: id, p })
    if (error) { setErreur(messageErreur(error)); return }
    setDonnees((d) => d ? {
      ...d,
      proposition: d.proposition && d.proposition.id === id ? { ...d.proposition, ...p } as Proposition : d.proposition,
      propositions: d.propositions.map((x) => (x.id === id ? ({ ...x, ...p } as Proposition) : x)),
    } : d)
  }
  async function supprimerProposition(p: Proposition) {
    if (!window.confirm(`Supprimer la proposition « ${p.libelle || p.fichier_nom} » du ${fmtDate(p.cree_le)} ?`)) return
    const { data, error } = await supabase.rpc('delete_tarif_proposition', { p_id: p.id })
    if (error) { setErreur(messageErreur(error)); return }
    if (data) await supabase.storage.from(BUCKET).remove([String(data)])
    if (propUrl === p.id) naviguer(frsUrl, null, 'propositions')
    else if (frsUrl) await charger(frsUrl, propUrl)
  }
  async function telecharger(p: Proposition) {
    if (!p.fichier_path) return
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(p.fichier_path, 300, { download: p.fichier_nom || true })
    if (error || !data?.signedUrl) { setErreur(messageErreur(error || 'Lien indisponible')); return }
    window.open(data.signedUrl, '_blank')
  }
  async function apparier(ligne: LigneProp, reference: string | null, ignoree?: boolean) {
    const { error } = await supabase.rpc('set_tarif_ligne_article', { p_ligne_id: ligne.id, p_reference: reference, p_ignoree: ignoree ?? null })
    if (error) { setErreur(messageErreur(error)); return }
    setFiche(null)
    if (frsUrl) await charger(frsUrl, propUrl)
  }

  // ── Tri / filtres ──────────────────────────────────────────────────────
  const lignesAffichees = useMemo(() => {
    if (!comp) return []
    const q = recherche.trim().toUpperCase()
    let l = comp.lignes.filter((x) => {
      if (filtre === 'fortes') { if (x.evol === null || Math.abs(x.evol) * 100 < seuilFort || x.etat === 'doublon' || x.etat === 'ignoree') return false }
      else if (filtre !== 'tous' && filtre !== 'absents' && x.etat !== filtre) return false
      if (q && ![x.l.ref_fournisseur, x.l.designation, x.art?.reference, x.art?.designation, x.gamme].some((s) => (s || '').toUpperCase().includes(q))) return false
      return true
    })
    const val = (x: LigneComp): number | string => {
      switch (tri.col) {
        case 'ref': return x.l.ref_fournisseur || ''
        case 'gamme': return x.gamme
        case 'pa': return x.pa ?? -Infinity
        case 'pn': return x.pn ?? -Infinity
        case 'evol': return x.evol ?? -Infinity
        case 'vol': return x.vol
        case 'masse': return x.masse
        case 'coef': return x.art?.coef ?? -Infinity
        case 'marge': return x.margeNew ?? -Infinity
        default: return Math.abs(x.impact) + (x.etat === 'nouveau' ? -1e-9 : 0)
      }
    }
    l = [...l].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      return (typeof va === 'string' ? va.localeCompare(String(vb)) : va - (vb as number)) * tri.sens
    })
    return l
  }, [comp, filtre, recherche, tri, seuilFort])

  const parGamme = useMemo(() => {
    if (!comp) return []
    const m = new Map<string, { masse: number; impact: number; nb: number; hausses: number; baisses: number }>()
    for (const x of comp.lignes) {
      if (!(x.etat === 'hausse' || x.etat === 'baisse' || x.etat === 'stable')) continue
      const g = m.get(x.gamme) || { masse: 0, impact: 0, nb: 0, hausses: 0, baisses: 0 }
      g.masse += x.masse; g.impact += x.impact; g.nb++
      if (x.etat === 'hausse') g.hausses++
      if (x.etat === 'baisse') g.baisses++
      m.set(x.gamme, g)
    }
    return [...m.entries()].map(([gamme, v]) => ({ gamme, ...v, evol: v.masse > 0 ? v.impact / v.masse : null }))
      .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
  }, [comp])

  const articlesActuels = useMemo(() => {
    if (!donnees) return []
    const q = recherche.trim().toUpperCase()
    return donnees.articles
      .filter((a) => a.du_fournisseur)
      .filter((a) => voirSommeil || !a.sommeil)
      .filter((a) => !seulementVentes || a.qte_ventes_12m > 0 || a.qte_achats_12m > 0)
      .filter((a) => !q || [a.reference, a.designation, a.ref_fournisseur, a.famille].some((s) => (s || '').toUpperCase().includes(q)))
      .sort((a, b) => volume(b, base) * n0(b.prix_net) - volume(a, base) * n0(a.prix_net) || a.reference.localeCompare(b.reference))
  }, [donnees, recherche, voirSommeil, seulementVentes, base])

  const synActuel = useMemo(() => {
    const s = { nb: 0, masse: 0, paliers: 0, programme: 0, pvVol: 0, paVol: 0 }
    for (const a of articlesActuels) {
      s.nb++
      const v = volume(a, base)
      s.masse += v * n0(a.prix_net)
      if (a.paliers?.length) s.paliers++
      if (a.prix_nouveau_sage) s.programme++
      if (a.prix_vente && a.prix_net) { s.pvVol += v * a.prix_vente; s.paVol += v * a.prix_net }
    }
    return s
  }, [articlesActuels, base])

  const enTeteTri = (col: string, label: string, cls = '') => (
    <th className={`cursor-pointer select-none px-2 py-1.5 ${cls}`} onClick={() => setTri((t) => ({ col, sens: t.col === col ? (t.sens === 1 ? -1 : 1) : -1 }))}>
      {label}{tri.col === col ? (tri.sens === -1 ? ' ↓' : ' ↑') : ''}
    </th>
  )

  const fournisseurCourant = liste.find((x) => x.fournisseur === frsUrl)
  const p = donnees?.proposition || null
  const libelleBase = base === 'ventes' ? 'ventes facturées SAGE 12 mois' : 'achats reçus 12 mois (CDF BLG)'

  // ─────────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}
      onDragOver={(e) => { if (frsUrl || liste.length) { e.preventDefault(); setGlisse(true) } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setGlisse(false) }}
      onDrop={(e) => { e.preventDefault(); setGlisse(false); const f = e.dataTransfer.files?.[0]; if (f) void deposer(f) }}>
      <div className="mx-auto max-w-[1900px] space-y-2.5">
        {/* En-tête */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Stocks & logistique · Appro</p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">Tarifs fournisseurs — prix d’achat et propositions</h1>
            <p className="text-[11.5px] text-[#8A8474]">
              Tarif actuel SAGE (paliers, coef., PV) et comparaison immédiate de toute proposition de tarif déposée (Excel, CSV, PDF) : évolution % et impact € sur la masse d’achat annuelle.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input list="tarifs-frs" value={saisieFrs} placeholder="Fournisseur SAGE (code ou nom)…"
              onChange={(e) => {
                setSaisieFrs(e.target.value)
                const code = e.target.value.split(' — ')[0].trim().toUpperCase()
                if (liste.some((x) => x.fournisseur === code) && code !== frsUrl) naviguer(code, null, 'actuel')
              }}
              className={`${ctl} h-10 w-[380px] font-bold`} />
            <datalist id="tarifs-frs">
              {liste.map((f) => (
                <option key={f.fournisseur} value={`${f.fournisseur} — ${f.nom || ''}`}>
                  {`${f.nb_actifs} art. actifs · ${fmtEur(f.masse_achat_12m)}/an${f.nb_propositions ? ` · ${f.nb_propositions} proposition(s)` : ''}`}
                </option>
              ))}
            </datalist>
            <label className={`${btnFonce} inline-flex h-10 cursor-pointer items-center`}>
              ⬆ Déposer une proposition
              <input type="file" accept=".xlsx,.xls,.xlsm,.csv,.pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void deposer(f); e.target.value = '' }} />
            </label>
          </div>
        </section>

        {erreur && <div className="rounded-xl border border-[#E9B9A6] bg-[#FBEDE7] px-4 py-2 text-[12.5px] text-[#A3401C]">{erreur} <button className="ml-2 underline" onClick={() => setErreur(null)}>fermer</button></div>}
        {info && <div className="rounded-xl border border-[#BFD6EA] bg-[#EEF4FA] px-4 py-2 text-[12.5px] text-[#2D5F8C]">{info} <button className="ml-2 underline" onClick={() => setInfo(null)}>fermer</button></div>}
        {occupe && <div className="rounded-xl border border-[#E5E1D8] bg-white px-4 py-2 text-[12.5px] text-[#8A8474]">⏳ {occupe}</div>}
        {glisse && <div className="pointer-events-none fixed inset-4 z-50 flex items-center justify-center rounded-3xl border-4 border-dashed border-[#B4761A] bg-white/80 text-[22px] font-bold text-[#B4761A]">Déposez le fichier de tarif (Excel, CSV ou PDF)</div>}

        {/* Panneau d'import */}
        {imp && (
          <PanneauImport imp={imp} setImp={setImp} liste={liste} lignes={lignesImport} onEntete={changerEntete}
            onIA={() => void extraireIA()} onAnnuler={() => setImp(null)} onValider={() => void enregistrerImport()} occupe={!!occupe} />
        )}

        {!frsUrl && !imp && (
          <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
            <h2 className="mb-2 text-[14px] font-bold">Choisissez un fournisseur, ou déposez directement un fichier de tarif</h2>
            <p className="mb-3 text-[12px] text-[#8A8474]">Le fournisseur est reconnu dans le fichier quand c’est possible. Fournisseurs classés par proposition la plus récente, puis par masse d’achat annuelle (ventes 12 mois × prix net SAGE).</p>
            <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-4">
              {liste.filter((f) => f.masse_achat_12m > 0 || f.nb_propositions > 0).slice(0, 40).map((f) => (
                <button key={f.fournisseur} onClick={() => naviguer(f.fournisseur, null, 'actuel')}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[#E5E1D8] px-3 py-2 text-left hover:border-[#B4761A]">
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-bold">{f.nom || f.fournisseur}</span>
                    <span className="block text-[11px] text-[#8A8474]">{f.fournisseur} · {f.nb_actifs} art. actifs{f.nb_articles_paliers ? ` · ${f.nb_articles_paliers} à paliers` : ''}{f.nb_propositions ? ` · ${f.nb_propositions} prop.` : ''}</span>
                  </span>
                  <span className="shrink-0 text-[12px] font-bold">{fmtEur(f.masse_achat_12m)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {frsUrl && donnees && (
          <>
            {/* Onglets */}
            <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-2 text-[14px] font-bold">{donnees.nom || donnees.fournisseur}</span>
                {([['actuel', 'Tarif actuel SAGE'], ['propositions', `Propositions (${donnees.propositions.length})`]] as [Vue, string][]).map(([v, l]) => (
                  <button key={v} onClick={() => naviguer(frsUrl, propUrl, v)}
                    className={`h-8 rounded-lg px-3 text-[12.5px] font-bold ${vue === v ? 'bg-[#111820] text-white' : 'border border-[#D9D4C7] bg-white hover:border-[#B4761A]'}`}>{l}</button>
                ))}
                {p && (
                  <button onClick={() => naviguer(frsUrl, propUrl, 'comparaison')}
                    className={`h-8 rounded-lg px-3 text-[12.5px] font-bold ${vue === 'comparaison' ? 'bg-[#B4761A] text-white' : 'border border-[#B4761A] bg-white text-[#B4761A]'}`}>
                    Comparaison : {p.libelle || p.fichier_nom}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="text-[#8A8474]">Volume annuel :</span>
                <select value={base} onChange={(e) => setBase(e.target.value as Base)} className={ctl}>
                  <option value="ventes">Ventes facturées 12 mois (SAGE)</option>
                  <option value="achats">Achats reçus 12 mois (CDF BLG)</option>
                </select>
                {vue === 'comparaison' && (
                  <>
                    <span className="text-[#8A8474]">Prix comparé à :</span>
                    <select value={qref} onChange={(e) => setQref(e.target.value as QRef)} className={ctl}>
                      <option value="unitaire">l’unité (1er palier)</option>
                      <option value="habituelle">la quantité habituelle par commande</option>
                    </select>
                  </>
                )}
              </div>
            </section>

            {/* ── Tarif actuel ── */}
            {vue === 'actuel' && (
              <>
                <section className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
                  <Kpi label="Articles affichés" value={fmtNum(synActuel.nb)} sub={`${fournisseurCourant?.nb_articles ?? donnees.articles.length} rattachés au fournisseur dans SAGE`} />
                  <Kpi label="Masse d’achat annuelle" value={fmtEur(synActuel.masse)} sub={libelleBase} />
                  <Kpi label="Coef. moyen pondéré" value={synActuel.paVol > 0 ? fmtNum(synActuel.pvVol / synActuel.paVol, 2) : '—'} sub="PV fiche / prix net, pondéré par le volume" />
                  <Kpi label="Marge théorique" value={synActuel.pvVol > 0 ? fmtPct((synActuel.pvVol - synActuel.paVol) / synActuel.pvVol, 1, false) : '—'} sub="au PV de la fiche article" />
                  <Kpi label="Articles à paliers" value={fmtNum(synActuel.paliers)} sub="prix par quantité dans SAGE" />
                  <Kpi label="Prix programmés" value={fmtNum(synActuel.programme)} sub="nouveau prix déjà saisi dans SAGE" color={synActuel.programme ? '#2D5F8C' : undefined} />
                </section>
                <section className="rounded-xl border border-[#E5E1D8] bg-white">
                  <div className="flex flex-wrap items-center gap-2 border-b border-[#EFECE5] px-3 py-2">
                    <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher (réf., désignation, famille)…" className={`${ctl} w-[300px]`} />
                    <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={voirSommeil} onChange={(e) => setVoirSommeil(e.target.checked)} /> articles en sommeil</label>
                    <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={seulementVentes} onChange={(e) => setSeulementVentes(e.target.checked)} /> avec ventes ou achats sur 12 mois</label>
                    <span className="flex-1" />
                    <button className={btn} onClick={() => void exporterTarifActuel(donnees, articlesActuels)}>Export Excel</button>
                  </div>
                  <div className="max-h-[70vh] overflow-auto">
                    <table className="w-full border-collapse text-[12px]">
                      <thead className="sticky top-0 z-10 bg-[#FAF9F6] text-left text-[10.5px] uppercase tracking-wide text-[#8A8474]">
                        <tr>
                          <th className="px-2 py-1.5">Article</th><th className="px-2 py-1.5">Désignation</th><th className="px-2 py-1.5">Réf. frs</th>
                          <th className="px-2 py-1.5 text-right">Prix tarif</th><th className="px-2 py-1.5 text-right">Remise</th><th className="px-2 py-1.5 text-right">Prix net</th>
                          <th className="px-2 py-1.5">Paliers SAGE</th><th className="px-2 py-1.5 text-right">Prix programmé</th>
                          <th className="px-2 py-1.5 text-right">Dernier PA</th><th className="px-2 py-1.5 text-right">Coef.</th><th className="px-2 py-1.5 text-right">PV fiche</th>
                          <th className="px-2 py-1.5 text-right">Marge th.</th><th className="px-2 py-1.5 text-right">Ventes 12 m</th><th className="px-2 py-1.5 text-right">Achats 12 m</th>
                          <th className="px-2 py-1.5 text-right">Masse 12 m</th>
                        </tr>
                      </thead>
                      <tbody>
                        {articlesActuels.map((a) => (
                          <tr key={a.reference} className={`border-t border-[#EFECE5] hover:bg-[#FAF9F6] ${a.sommeil ? 'text-[#8A8474]' : ''}`}>
                            <td className="whitespace-nowrap px-2 py-1 font-bold">{a.reference}{a.sommeil && <span className="ml-1 text-[10px] font-normal">(sommeil)</span>}{!a.principal && <span className="ml-1 text-[10px] font-normal text-[#96600F]" title={`Fournisseur principal : ${a.fournisseur_principal || '—'}`}>(secondaire)</span>}</td>
                            <td className="max-w-[320px] truncate px-2 py-1" title={a.designation || ''}>{a.designation}</td>
                            <td className="whitespace-nowrap px-2 py-1 text-[#5F5A4E]">{a.ref_fournisseur || '—'}</td>
                            <td className="px-2 py-1 text-right">{fmtPrix(a.prix_tarif)}</td>
                            <td className="px-2 py-1 text-right">{a.remise ? `${fmtNum(a.remise, 2)} %` : ''}</td>
                            <td className="px-2 py-1 text-right font-bold">{fmtPrix(a.prix_net)}</td>
                            <td className="px-2 py-1"><PaliersSage a={a} /></td>
                            <td className="px-2 py-1 text-right text-[#2D5F8C]">{a.prix_nouveau_sage ? <span title={`Applicable le ${fmtDate(a.date_application_sage)}`}>{fmtPrix(a.prix_nouveau_sage)}</span> : ''}</td>
                            <td className="px-2 py-1 text-right">{fmtPrix(a.dernier_prix_achat)}</td>
                            <td className="px-2 py-1 text-right">{a.coef ? fmtNum(a.coef, 2) : '—'}</td>
                            <td className="px-2 py-1 text-right">{fmtPrix(a.prix_vente)}</td>
                            <td className="px-2 py-1 text-right">{a.prix_vente && a.prix_net ? fmtPct((a.prix_vente - a.prix_net) / a.prix_vente, 0, false) : '—'}</td>
                            <td className="px-2 py-1 text-right">{fmtNum(a.qte_ventes_12m)}</td>
                            <td className="px-2 py-1 text-right" title={a.nb_lignes_cdf_12m ? `${a.nb_lignes_cdf_12m} ligne(s) de CDF, ${fmtNum(a.qte_moy_ligne_cdf, 1)} en moyenne` : ''}>{fmtNum(a.qte_achats_12m)}</td>
                            <td className="px-2 py-1 text-right font-bold">{fmtEur(volume(a, base) * n0(a.prix_net))}</td>
                          </tr>
                        ))}
                        {!articlesActuels.length && <tr><td colSpan={15} className="px-3 py-6 text-center text-[#8A8474]">Aucun article.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}

            {/* ── Propositions ── */}
            {vue === 'propositions' && (
              <section className="rounded-xl border border-[#E5E1D8] bg-white">
                <div className="flex items-center justify-between border-b border-[#EFECE5] px-3 py-2">
                  <h2 className="text-[13px] font-bold">Propositions de tarif reçues de {donnees.nom || donnees.fournisseur}</h2>
                  <span className="text-[11.5px] text-[#8A8474]">Glissez un fichier n’importe où sur la page pour en ajouter une.</span>
                </div>
                <table className="w-full border-collapse text-[12.5px]">
                  <thead className="bg-[#FAF9F6] text-left text-[10.5px] uppercase tracking-wide text-[#8A8474]">
                    <tr>
                      <th className="px-3 py-1.5">Déposée le</th><th className="px-3 py-1.5">Proposition</th><th className="px-3 py-1.5">Fichier</th>
                      <th className="px-3 py-1.5">Effet</th><th className="px-3 py-1.5">Statut</th><th className="px-3 py-1.5 text-right">Lignes</th>
                      <th className="px-3 py-1.5 text-right">Évolution</th><th className="px-3 py-1.5 text-right">Impact annuel</th><th className="px-3 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {donnees.propositions.map((x) => (
                      <tr key={x.id} className={`border-t border-[#EFECE5] ${x.id === propUrl ? 'bg-[#FDF6EA]' : 'hover:bg-[#FAF9F6]'}`}>
                        <td className="whitespace-nowrap px-3 py-1.5">{fmtDate(x.cree_le)}<div className="text-[10.5px] text-[#8A8474]">{x.cree_par}</div></td>
                        <td className="px-3 py-1.5 font-bold">{x.libelle || '—'}{x.source_import === 'ia' && <span className="ml-1.5 text-[10.5px] font-normal text-[#7A5EA8]">extraction IA</span>}</td>
                        <td className="px-3 py-1.5">{x.fichier_path ? <button className="text-[#2D5F8C] underline" onClick={() => void telecharger(x)}>{x.fichier_nom}</button> : (x.fichier_nom || '—')}</td>
                        <td className="whitespace-nowrap px-3 py-1.5">{fmtDate(x.date_effet)}</td>
                        <td className="px-3 py-1.5">
                          <select value={x.statut} onChange={(e) => void majProposition(x.id, { statut: e.target.value })} className={`${ctl} h-7`}
                            style={{ background: STATUTS[x.statut].bg, color: STATUTS[x.statut].fg }}>
                            {(Object.keys(STATUTS) as Statut[]).map((s) => <option key={s} value={s}>{STATUTS[s].libelle}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-1.5 text-right">{fmtNum(x.nb_lignes)}{x.resume?.nb_apparies !== undefined && <div className="text-[10.5px] text-[#8A8474]">{fmtNum(x.resume.nb_apparies)} appariées</div>}</td>
                        <td className="px-3 py-1.5 text-right font-bold" style={{ color: couleurEvol(x.resume?.evol_pct) }}>{fmtPct(x.resume?.evol_pct)}</td>
                        <td className="px-3 py-1.5 text-right font-bold" style={{ color: couleurEvol(x.resume?.impact) }}>{x.resume?.impact !== undefined ? fmtEur(x.resume.impact, true) : '—'}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">
                          <button className={`${btnFonce} h-7`} onClick={() => naviguer(frsUrl, x.id, 'comparaison')}>Comparer</button>
                          <button className="ml-2 text-[11.5px] text-[#A3401C] underline" onClick={() => void supprimerProposition(x)}>supprimer</button>
                        </td>
                      </tr>
                    ))}
                    {!donnees.propositions.length && <tr><td colSpan={9} className="px-3 py-8 text-center text-[#8A8474]">Aucune proposition pour ce fournisseur. Déposez un fichier Excel, CSV ou PDF.</td></tr>}
                  </tbody>
                </table>
              </section>
            )}

            {/* ── Comparaison ── */}
            {vue === 'comparaison' && p && comp && syn && (
              <>
                <section className="flex flex-wrap items-start gap-3 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2.5">
                  <div className="min-w-[260px] flex-1">
                    <input defaultValue={p.libelle || ''} key={`lib-${p.id}`} onBlur={(e) => { if (e.target.value !== (p.libelle || '')) void majProposition(p.id, { libelle: e.target.value }) }}
                      className="w-full border-b border-transparent bg-transparent text-[15px] font-bold outline-none hover:border-[#D9D4C7] focus:border-[#B4761A]" />
                    <div className="mt-0.5 text-[11.5px] text-[#8A8474]">
                      Déposée le {fmtDate(p.cree_le)} par {p.cree_par || '—'} · {p.fichier_path ? <button className="text-[#2D5F8C] underline" onClick={() => void telecharger(p)}>{p.fichier_nom}</button> : p.fichier_nom}
                      {p.source_import === 'ia' && ' · lignes extraites par l’IA'}
                    </div>
                    {!!p.conditions?.length && <div className="mt-1 text-[11.5px] text-[#5F5A4E]">{p.conditions.join(' · ')}</div>}
                  </div>
                  <label className="text-[11px] text-[#8A8474]">Effet<br />
                    <input type="date" defaultValue={p.date_effet || ''} key={`de-${p.id}`} onBlur={(e) => { if (e.target.value !== (p.date_effet || '')) void majProposition(p.id, { date_effet: e.target.value }) }} className={ctl} />
                  </label>
                  <label className="text-[11px] text-[#8A8474]">Fin<br />
                    <input type="date" defaultValue={p.date_fin || ''} key={`df-${p.id}`} onBlur={(e) => { if (e.target.value !== (p.date_fin || '')) void majProposition(p.id, { date_fin: e.target.value }) }} className={ctl} />
                  </label>
                  <label className="text-[11px] text-[#8A8474]">Statut<br />
                    <select value={p.statut} onChange={(e) => void majProposition(p.id, { statut: e.target.value })} className={ctl}
                      style={{ background: STATUTS[p.statut].bg, color: STATUTS[p.statut].fg }}>
                      {(Object.keys(STATUTS) as Statut[]).map((s) => <option key={s} value={s}>{STATUTS[s].libelle}</option>)}
                    </select>
                  </label>
                  <label className="min-w-[260px] flex-1 text-[11px] text-[#8A8474]">Commentaire / négociation<br />
                    <textarea defaultValue={p.commentaire || ''} key={`com-${p.id}`} rows={2} onBlur={(e) => { if (e.target.value !== (p.commentaire || '')) void majProposition(p.id, { commentaire: e.target.value }) }}
                      className="w-full rounded-lg border border-[#D9D4C7] px-2 py-1 text-[12.5px] text-[#111820] outline-none focus:border-[#B4761A]" />
                  </label>
                  <div className="flex flex-col gap-1.5 pt-3.5">
                    <button className={btn} onClick={() => void exporterExcel(donnees, comp, base, qref)}>Export Excel</button>
                  </div>
                </section>

                <section className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
                  <Kpi label="Évolution pondérée" value={fmtPct(syn.evol)} color={couleurEvol(syn.evol)} sub={`moyenne simple ${fmtPct(syn.evolSimple)}`} />
                  <Kpi label="Impact annuel" value={fmtEur(syn.impact, true)} color={couleurEvol(syn.impact)} sub={libelleBase} />
                  <Kpi label="Masse d’achat" value={fmtEur(syn.masse)} sub={`→ ${fmtEur(syn.masse + syn.impact)} au nouveau tarif`} />
                  <Kpi label="Marge si PV inchangé" value={syn.margeNew !== null ? fmtPct(syn.margeNew, 1, false) : '—'}
                    sub={syn.margeAct !== null && syn.margeNew !== null ? `contre ${fmtPct(syn.margeAct, 1, false)} (${fmtNum((syn.margeNew - syn.margeAct) * 100, 1)} pt)` : 'PV fiche article'} />
                  <Kpi label="Hausses" value={fmtNum(syn.nbHausses)} color="#A3401C" onClick={() => setFiltre(filtre === 'hausse' ? 'tous' : 'hausse')} actif={filtre === 'hausse'} sub={`${fmtNum(syn.nbStables)} stables`} />
                  <Kpi label="Baisses" value={fmtNum(syn.nbBaisses)} color="#2F6F33" onClick={() => setFiltre(filtre === 'baisse' ? 'tous' : 'baisse')} actif={filtre === 'baisse'} />
                  <Kpi label="Non trouvées dans SAGE" value={fmtNum(syn.nbNouveaux)} color={syn.nbNouveaux ? '#2D5F8C' : undefined}
                    sub={`${fmtNum(syn.nbApparies)} / ${fmtNum(syn.nbLignes)} lignes appariées`} onClick={() => setFiltre(filtre === 'nouveau' ? 'tous' : 'nouveau')} actif={filtre === 'nouveau'} />
                  <Kpi label="Absents du fichier" value={fmtNum(comp.absents.length)} color={comp.absents.length ? '#96600F' : undefined}
                    sub={`articles SAGE actifs · ${fmtEur(comp.absents.reduce((s, a) => s + volume(a, base) * n0(a.prix_net), 0))}/an`}
                    onClick={() => setFiltre(filtre === 'absents' ? 'tous' : 'absents')} actif={filtre === 'absents'} />
                </section>

                {parGamme.length > 1 && (
                  <section className="rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
                    <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Par gamme (cliquer pour filtrer)</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {parGamme.slice(0, 30).map((g) => (
                        <button key={g.gamme} onClick={() => setRecherche(recherche === g.gamme ? '' : g.gamme)}
                          className={`rounded-lg border px-2.5 py-1 text-left text-[11.5px] ${recherche === g.gamme ? 'border-[#111820] ring-1 ring-[#111820]' : 'border-[#E5E1D8] hover:border-[#B4761A]'}`}>
                          <span className="block max-w-[260px] truncate font-bold">{g.gamme}</span>
                          <span className="text-[#8A8474]">{g.nb} art. · </span>
                          <span className="font-bold" style={{ color: couleurEvol(g.evol) }}>{fmtPct(g.evol)}</span>
                          <span className="text-[#8A8474]"> · </span>
                          <span className="font-bold" style={{ color: couleurEvol(g.impact) }}>{fmtEur(g.impact, true)}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                <section className="rounded-xl border border-[#E5E1D8] bg-white">
                  <div className="flex flex-wrap items-center gap-2 border-b border-[#EFECE5] px-3 py-2">
                    <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher (réf., désignation, gamme)…" className={`${ctl} w-[300px]`} />
                    <select value={filtre} onChange={(e) => setFiltre(e.target.value as typeof filtre)} className={ctl}>
                      <option value="tous">Toutes les lignes</option>
                      <option value="hausse">Hausses</option>
                      <option value="baisse">Baisses</option>
                      <option value="stable">Stables</option>
                      <option value="fortes">Écart supérieur à…</option>
                      <option value="nouveau">Non trouvées dans SAGE</option>
                      <option value="sans_prix">Sans prix SAGE</option>
                      <option value="doublon">Doublons</option>
                      <option value="ignoree">Ignorées</option>
                      <option value="absents">Articles SAGE absents du fichier</option>
                    </select>
                    {filtre === 'fortes' && <label className="flex items-center gap-1 text-[12px]">±<input type="number" value={seuilFort} min={0} step={1} onChange={(e) => setSeuilFort(Number(e.target.value) || 0)} className={`${ctl} w-16`} /> %</label>}
                    <span className="text-[11.5px] text-[#8A8474]">{filtre === 'absents' ? comp.absents.length : lignesAffichees.length} ligne(s)</span>
                    <span className="flex-1" />
                    <span className="text-[11px] text-[#8A8474]">Prix actuel = prix SAGE à la même quantité (palier SAGE, sinon prix net fournisseur). Cliquez une ligne pour le détail des paliers et l’appariement.</span>
                  </div>
                  <div className="max-h-[68vh] overflow-auto">
                    {filtre === 'absents' ? (
                      <table className="w-full border-collapse text-[12px]">
                        <thead className="sticky top-0 z-10 bg-[#FAF9F6] text-left text-[10.5px] uppercase tracking-wide text-[#8A8474]">
                          <tr><th className="px-2 py-1.5">Article SAGE</th><th className="px-2 py-1.5">Désignation</th><th className="px-2 py-1.5">Réf. frs SAGE</th><th className="px-2 py-1.5 text-right">Prix net</th><th className="px-2 py-1.5 text-right">Ventes 12 m</th><th className="px-2 py-1.5 text-right">Achats 12 m</th><th className="px-2 py-1.5 text-right">Masse 12 m</th></tr>
                        </thead>
                        <tbody>
                          {[...comp.absents].sort((a, b) => volume(b, base) * n0(b.prix_net) - volume(a, base) * n0(a.prix_net)).map((a) => (
                            <tr key={a.reference} className="border-t border-[#EFECE5]">
                              <td className="px-2 py-1 font-bold">{a.reference}</td><td className="px-2 py-1">{a.designation}</td><td className="px-2 py-1 text-[#5F5A4E]">{a.ref_fournisseur || '—'}</td>
                              <td className="px-2 py-1 text-right">{fmtPrix(a.prix_net)}</td><td className="px-2 py-1 text-right">{fmtNum(a.qte_ventes_12m)}</td><td className="px-2 py-1 text-right">{fmtNum(a.qte_achats_12m)}</td>
                              <td className="px-2 py-1 text-right font-bold">{fmtEur(volume(a, base) * n0(a.prix_net))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <table className="w-full border-collapse text-[12px]">
                        <thead className="sticky top-0 z-10 bg-[#FAF9F6] text-left text-[10.5px] uppercase tracking-wide text-[#8A8474]">
                          <tr>
                            {enTeteTri('ref', 'Réf. frs')}<th className="px-2 py-1.5">Article SAGE</th><th className="px-2 py-1.5">Désignation</th>{enTeteTri('gamme', 'Gamme')}
                            <th className="px-2 py-1.5">État</th><th className="px-2 py-1.5 text-right">Qté</th>
                            {enTeteTri('pa', 'Prix actuel', 'text-right')}{enTeteTri('pn', 'Nouveau', 'text-right')}{enTeteTri('evol', 'Évol.', 'text-right')}
                            <th className="px-2 py-1.5">Nouveaux paliers</th>
                            {enTeteTri('vol', 'Volume', 'text-right')}{enTeteTri('masse', 'Masse act.', 'text-right')}{enTeteTri('impact', 'Impact €/an', 'text-right')}
                            {enTeteTri('coef', 'Coef.', 'text-right')}<th className="px-2 py-1.5 text-right">PV fiche</th><th className="px-2 py-1.5 text-right">PV coef. cst</th>
                            {enTeteTri('marge', 'Marge (PV inch.)', 'text-right')}
                          </tr>
                        </thead>
                        <tbody>
                          {lignesAffichees.slice(0, 1500).map((x) => (
                            <tr key={x.l.id} onClick={() => setFiche(x)} className={`cursor-pointer border-t border-[#EFECE5] hover:bg-[#FAF9F6] ${x.etat === 'ignoree' || x.etat === 'doublon' ? 'text-[#8A8474]' : ''}`}>
                              <td className="whitespace-nowrap px-2 py-1 font-bold">{x.l.ref_fournisseur || x.l.ean}</td>
                              <td className="whitespace-nowrap px-2 py-1">{x.art ? <>{x.art.reference}{x.art.sommeil && <span className="ml-1 text-[10px] text-[#96600F]">sommeil</span>}{x.l.appariement && x.l.appariement !== 'ref_fournisseur' && <span className="ml-1 text-[10px] text-[#2D5F8C]" title={APPARIEMENTS[x.l.appariement]}>{x.l.appariement === 'manuel' ? '✎' : '≈'}</span>}{n0(x.l.nb_candidats) > 1 && <span className="ml-1 text-[10px] text-[#96600F]" title={`${x.l.nb_candidats} articles SAGE possibles`}>×{x.l.nb_candidats}</span>}</> : <span className="text-[#8A8474]">—</span>}</td>
                              <td className="max-w-[300px] truncate px-2 py-1" title={x.l.designation || x.art?.designation || ''}>{x.l.designation || x.art?.designation}</td>
                              <td className="max-w-[180px] truncate px-2 py-1 text-[#5F5A4E]" title={x.gamme}>{x.gamme}</td>
                              <td className="px-2 py-1"><Pastille {...ETATS[x.etat]}>{ETATS[x.etat].libelle}</Pastille></td>
                              <td className="px-2 py-1 text-right text-[#5F5A4E]">{fmtNum(x.q)}</td>
                              <td className="px-2 py-1 text-right">{fmtPrix(x.pa)}</td>
                              <td className="px-2 py-1 text-right font-bold">{fmtPrix(x.pn)}</td>
                              <td className="px-2 py-1 text-right font-bold" style={{ color: couleurEvol(x.evol) }}>{fmtPct(x.evol)}</td>
                              <td className="px-2 py-1"><PaliersNouveaux p={x.l.paliers} /></td>
                              <td className="px-2 py-1 text-right">{x.art ? fmtNum(x.vol) : '—'}</td>
                              <td className="px-2 py-1 text-right">{x.masse ? fmtEur(x.masse) : '—'}</td>
                              <td className="px-2 py-1 text-right font-bold" style={{ color: couleurEvol(x.impact) }}>{x.impact ? fmtEur(x.impact, true) : '—'}</td>
                              <td className="px-2 py-1 text-right">{x.art?.coef ? fmtNum(x.art.coef, 2) : '—'}</td>
                              <td className="px-2 py-1 text-right">{fmtPrix(x.art?.prix_vente)}</td>
                              <td className="px-2 py-1 text-right text-[#5F5A4E]">{fmtPrix(x.pvCoef)}</td>
                              <td className="whitespace-nowrap px-2 py-1 text-right">
                                {x.margeNew !== null ? <><span className="text-[#8A8474]">{fmtPct(x.margeAct, 0, false)} → </span><span className="font-bold" style={{ color: x.margeAct !== null && x.margeNew < x.margeAct - 0.0005 ? '#A3401C' : '#111820' }}>{fmtPct(x.margeNew, 0, false)}</span></> : '—'}
                              </td>
                            </tr>
                          ))}
                          {!lignesAffichees.length && <tr><td colSpan={17} className="px-3 py-6 text-center text-[#8A8474]">Aucune ligne.</td></tr>}
                          {lignesAffichees.length > 1500 && <tr><td colSpan={17} className="px-3 py-2 text-center text-[#8A8474]">1 500 premières lignes affichées — affinez la recherche ou utilisez l’export Excel.</td></tr>}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>
              </>
            )}
            {vue === 'comparaison' && !p && (
              <section className="rounded-xl border border-[#E5E1D8] bg-white px-4 py-6 text-center text-[13px] text-[#8A8474]">
                Ouvrez une proposition depuis l’onglet « Propositions » ou déposez un fichier de tarif.
              </section>
            )}
          </>
        )}
      </div>

      {fiche && <FicheLigne x={fiche} onFermer={() => setFiche(null)} onApparier={(ref, ign) => void apparier(fiche.l, ref, ign)} />}
    </main>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Panneau d'import (lecture, colonnes, aperçu)
// ─────────────────────────────────────────────────────────────────────────

function PanneauImport({ imp, setImp, liste, lignes, onEntete, onIA, onAnnuler, onValider, occupe }: {
  imp: ImportEnCours; setImp: React.Dispatch<React.SetStateAction<ImportEnCours | null>>; liste: FournisseurListe[]; lignes: LigneImport[]
  onEntete: (i: number) => void; onIA: () => void; onAnnuler: () => void; onValider: () => void; occupe: boolean
}) {
  const g = imp.grilles[imp.feuille]
  const entete = g?.lignes[imp.mapping.ligneEntete] || []
  const echantillon = (g?.lignes || []).slice(imp.mapping.ligneEntete + 1, imp.mapping.ligneEntete + 4)
  const nbPaliersMax = lignes.reduce((m, l) => Math.max(m, l.paliers.length), 0)
  const [saisieFrs, setSaisieFrs] = useState(() => {
    const f = liste.find((x) => x.fournisseur === imp.fournisseur)
    return imp.fournisseur ? `${imp.fournisseur} — ${f?.nom || ''}` : ''
  })

  return (
    <section className="rounded-xl border-2 border-[#B4761A] bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-bold">Nouvelle proposition — {imp.fichier.name}</h2>
        <div className="flex gap-2">
          <button className={btn} onClick={onAnnuler}>Annuler</button>
          <button className={btnFonce} disabled={occupe || !lignes.length || !imp.fournisseur} onClick={onValider}>
            Enregistrer et comparer ({fmtNum(lignes.length)} lignes)
          </button>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
        <label className="text-[11px] text-[#8A8474] xl:col-span-2">Fournisseur SAGE<br />
          <input list="tarifs-frs-import" value={saisieFrs} className={`${ctl} w-full font-bold`}
            onChange={(e) => {
              setSaisieFrs(e.target.value)
              const code = e.target.value.split(' — ')[0].trim().toUpperCase()
              setImp((x) => (x ? { ...x, fournisseur: liste.some((f) => f.fournisseur === code) ? code : '' } : x))
            }} />
          <datalist id="tarifs-frs-import">{liste.map((f) => <option key={f.fournisseur} value={`${f.fournisseur} — ${f.nom || ''}`} />)}</datalist>
          {!imp.fournisseur && <span className="text-[#A3401C]">À choisir dans la liste</span>}
        </label>
        <label className="text-[11px] text-[#8A8474]">Libellé<br />
          <input value={imp.libelle} onChange={(e) => setImp((x) => (x ? { ...x, libelle: e.target.value } : x))} className={`${ctl} w-full`} />
        </label>
        <label className="text-[11px] text-[#8A8474]">Date d’effet<br />
          <input type="date" value={imp.date_effet} onChange={(e) => setImp((x) => (x ? { ...x, date_effet: e.target.value } : x))} className={`${ctl} w-full`} />
        </label>
        <label className="text-[11px] text-[#8A8474]">Fin de validité<br />
          <input type="date" value={imp.date_fin} onChange={(e) => setImp((x) => (x ? { ...x, date_fin: e.target.value } : x))} className={`${ctl} w-full`} />
        </label>
      </div>
      {!!imp.conditions.length && <p className="mb-2 text-[11.5px] text-[#5F5A4E]"><b>Conditions lues :</b> {imp.conditions.join(' · ')}</p>}

      {imp.lignesIA ? (
        <div className="mb-2 flex items-center gap-3 rounded-lg bg-[#F1ECF7] px-3 py-2 text-[12px] text-[#7A5EA8]">
          <span>{fmtNum(imp.lignesIA.length)} lignes extraites par l’IA (à vérifier sur l’aperçu ci-dessous).</span>
          <button className="underline" onClick={() => setImp((x) => (x ? { ...x, lignesIA: null } : x))}>revenir à la lecture par colonnes</button>
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
            {imp.type === 'excel' && imp.grilles.length > 1 && (
              <label className="flex items-center gap-1.5">Feuille
                <select value={imp.feuille} className={ctl}
                  onChange={(e) => {
                    const f = Number(e.target.value)
                    setImp((x) => (x ? { ...x, feuille: f, mapping: detecterMapping(x.grilles[f].lignes), lignesIA: null } : x))
                  }}>
                  {imp.grilles.map((gg, i) => <option key={i} value={i}>{gg.feuille}</option>)}
                </select>
              </label>
            )}
            <label className="flex items-center gap-1.5">Ligne d’en-tête
              <input type="number" min={1} value={imp.mapping.ligneEntete + 1} onChange={(e) => onEntete(Math.max(0, (Number(e.target.value) || 1) - 1))} className={`${ctl} w-20`} />
            </label>
            <span className="text-[#8A8474]">Rôle de chaque colonne (détecté automatiquement, à corriger si besoin) — les paliers sont lus par paires « Qté de palier → Prix ».</span>
            {imp.type === 'pdf' && (
              <button className="ml-auto h-8 rounded-lg border border-[#7A5EA8] px-3 font-bold text-[#7A5EA8] hover:bg-[#F1ECF7] disabled:opacity-50" disabled={!!imp.progressionIA} onClick={onIA}>
                {imp.progressionIA || '✦ Extraire les lignes par l’IA (PDF mal structuré)'}
              </button>
            )}
          </div>
          <div className="mb-3 overflow-x-auto rounded-lg border border-[#EFECE5]">
            <table className="border-collapse text-[11.5px]">
              <tbody>
                <tr className="bg-[#FAF9F6]">
                  {imp.mapping.colonnes.map((c, i) => (
                    <td key={i} className="min-w-[110px] border-r border-[#EFECE5] px-1.5 py-1 align-top">
                      <select value={c} className={`h-7 w-full rounded border px-1 text-[11.5px] ${c === 'ignorer' ? 'border-[#E5E1D8] text-[#8A8474]' : 'border-[#B4761A] font-bold'}`}
                        onChange={(e) => setImp((x) => {
                          if (!x) return x
                          const cols = [...x.mapping.colonnes]
                          cols[i] = e.target.value as Champ
                          return { ...x, mapping: { ...x.mapping, colonnes: cols }, lignesIA: null }
                        })}>
                        {CHAMPS.map((ch) => <option key={ch} value={ch}>{LIBELLES_CHAMPS[ch]}</option>)}
                      </select>
                    </td>
                  ))}
                </tr>
                <tr className="bg-[#FAF9F6] font-bold">
                  {imp.mapping.colonnes.map((_, i) => <td key={i} className="max-w-[160px] truncate border-r border-t border-[#EFECE5] px-1.5 py-1" title={texte(entete[i])}>{texte(entete[i]) || `col. ${i + 1}`}</td>)}
                </tr>
                {echantillon.map((l: Cellule[], k: number) => (
                  <tr key={k}>
                    {imp.mapping.colonnes.map((_, i) => <td key={i} className="max-w-[160px] truncate border-r border-t border-[#EFECE5] px-1.5 py-0.5 text-[#5F5A4E]">{texte(l[i])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
        Aperçu : {fmtNum(lignes.length)} lignes lues{nbPaliersMax > 1 ? ` · jusqu’à ${nbPaliersMax} paliers` : ''}{lignes.length ? '' : ' — vérifiez la ligne d’en-tête, la colonne « Réf. fournisseur » et au moins une colonne « Prix »'}
      </h3>
      <div className="max-h-[260px] overflow-auto rounded-lg border border-[#EFECE5]">
        <table className="w-full border-collapse text-[11.5px]">
          <thead className="sticky top-0 bg-[#FAF9F6] text-left text-[10.5px] uppercase text-[#8A8474]">
            <tr><th className="px-2 py-1">Réf. frs</th><th className="px-2 py-1">EAN</th><th className="px-2 py-1">Désignation</th><th className="px-2 py-1">Gamme</th><th className="px-2 py-1 text-right">Prix public</th><th className="px-2 py-1">Paliers (qté ≥ : prix)</th></tr>
          </thead>
          <tbody>
            {lignes.slice(0, 60).map((l, i) => (
              <tr key={i} className="border-t border-[#EFECE5]">
                <td className="px-2 py-0.5 font-bold">{l.ref_fournisseur}</td><td className="px-2 py-0.5">{l.ean}</td>
                <td className="max-w-[320px] truncate px-2 py-0.5">{l.designation}</td><td className="max-w-[220px] truncate px-2 py-0.5">{[l.marque, l.gamme].filter(Boolean).join(' · ')}</td>
                <td className="px-2 py-0.5 text-right">{fmtPrix(l.prix_public)}</td><td className="px-2 py-0.5"><PaliersNouveaux p={l.paliers} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Fiche d'une ligne : paliers comparés et appariement
// ─────────────────────────────────────────────────────────────────────────

type ResultatRecherche = { reference: string; designation: string | null; fournisseur_principal: string | null; sommeil: boolean }

function FicheLigne({ x, onFermer, onApparier }: { x: LigneComp; onFermer: () => void; onApparier: (ref: string | null, ignoree?: boolean) => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<ResultatRecherche[]>([])
  useEffect(() => {
    if (q.trim().length < 2) return
    const t = window.setTimeout(async () => {
      const { data } = await supabase.rpc('search_tarif_articles', { p_q: q.trim() })
      setRes((data || []) as ResultatRecherche[])
    }, 250)
    return () => window.clearTimeout(t)
  }, [q])

  const a = x.art
  const seuils = seuilsComparaison(x.l.paliers, a?.paliers)
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onFermer}>
      <aside className="h-full w-full max-w-[640px] overflow-y-auto bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">Ligne {x.l.ligne_no ?? ''} du fichier</p>
            <h2 className="text-[17px] font-bold">{x.l.ref_fournisseur || x.l.ean}</h2>
            <p className="text-[12.5px] text-[#5F5A4E]">{x.l.designation}</p>
            <p className="text-[11.5px] text-[#8A8474]">{[x.l.marque, x.l.gamme].filter(Boolean).join(' · ')}{x.l.ean ? ` · EAN ${x.l.ean}` : ''}{x.l.prix_public ? ` · prix public ${fmtPrix(x.l.prix_public)}` : ''}{x.l.colisage ? ` · boîte de ${fmtNum(x.l.colisage)}` : ''}</p>
          </div>
          <button className={btn} onClick={onFermer}>Fermer</button>
        </div>

        <div className="mb-3 rounded-lg border border-[#E5E1D8] p-3">
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Article SAGE</h3>
          {a ? (
            <div className="text-[12.5px]">
              <div className="font-bold">{a.reference} — {a.designation}</div>
              <div className="text-[#5F5A4E]">
                Réf. fournisseur SAGE : {a.ref_fournisseur || '—'} · famille {a.famille || '—'}{a.sommeil ? ' · en sommeil' : ''}
                {x.l.appariement ? ` · trouvé par ${APPARIEMENTS[x.l.appariement] || x.l.appariement}` : ''}{n0(x.l.nb_candidats) > 1 ? ` (${x.l.nb_candidats} articles possibles, actif / principal retenu)` : ''}
              </div>
              <div className="mt-1 grid grid-cols-3 gap-2 text-[12px]">
                <div><span className="text-[#8A8474]">Coef. </span><b>{a.coef ? fmtNum(a.coef, 2) : '—'}</b></div>
                <div><span className="text-[#8A8474]">PV fiche </span><b>{fmtPrix(a.prix_vente)}</b></div>
                <div><span className="text-[#8A8474]">Dernier PA </span><b>{fmtPrix(a.dernier_prix_achat)}</b></div>
                <div><span className="text-[#8A8474]">Ventes 12 m </span><b>{fmtNum(a.qte_ventes_12m)}</b> <span className="text-[#8A8474]">({a.nb_clients_12m} clients)</span></div>
                <div><span className="text-[#8A8474]">Achats 12 m </span><b>{fmtNum(a.qte_achats_12m)}</b></div>
                <div><span className="text-[#8A8474]">Qté moy. / CDF </span><b>{fmtNum(a.qte_moy_ligne_cdf, 1)}</b></div>
              </div>
              {a.prix_nouveau_sage && <div className="mt-1 text-[12px] text-[#2D5F8C]">Prix déjà programmé dans SAGE : {fmtPrix(a.prix_nouveau_sage)} au {fmtDate(a.date_application_sage)}</div>}
            </div>
          ) : <p className="text-[12.5px] text-[#2D5F8C]">Aucun article SAGE trouvé pour cette référence : nouvel article, ou référence fournisseur à corriger dans SAGE.</p>}
        </div>

        <div className="mb-3 rounded-lg border border-[#E5E1D8] p-3">
          <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Prix par quantité commandée</h3>
          <table className="w-full border-collapse text-[12.5px]">
            <thead className="text-left text-[10.5px] uppercase text-[#8A8474]">
              <tr><th className="py-1">Quantité</th><th className="py-1 text-right">Prix actuel SAGE</th><th className="py-1 text-right">Nouveau prix</th><th className="py-1 text-right">Évolution</th>{a?.coef ? <th className="py-1 text-right">PV à coef. {fmtNum(a.coef, 2)}</th> : null}</tr>
            </thead>
            <tbody>
              {seuils.map((s) => {
                const pa = a ? prixSage(a.prix_net, a.paliers, s) : null
                const pn = prixPalier(x.l.paliers, s)
                const ev = pa && pn ? pn / pa - 1 : null
                return (
                  <tr key={s} className={`border-t border-[#EFECE5] ${s === x.q ? 'bg-[#FDF6EA]' : ''}`}>
                    <td className="py-1">{fmtNum(s)}{s === x.q && <span className="ml-1 text-[10.5px] text-[#B4761A]">(comparée)</span>}</td>
                    <td className="py-1 text-right">{fmtPrix(pa)}</td>
                    <td className="py-1 text-right font-bold">{fmtPrix(pn)}</td>
                    <td className="py-1 text-right font-bold" style={{ color: couleurEvol(ev) }}>{fmtPct(ev)}</td>
                    {a?.coef ? <td className="py-1 text-right">{fmtPrix(pn !== null ? pn * a.coef : null)}</td> : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {x.art && <p className="mt-2 text-[11.5px] text-[#5F5A4E]">Sur le volume annuel ({fmtNum(x.vol)}) : masse {fmtEur(x.masse)} → impact <b style={{ color: couleurEvol(x.impact) }}>{fmtEur(x.impact, true)}</b>.</p>}
        </div>

        <div className="rounded-lg border border-[#E5E1D8] p-3">
          <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Corriger l’appariement</h3>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un article SAGE (référence ou désignation)…" className={`${ctl} w-full`} />
          {q.trim().length >= 2 && !!res.length && (
            <ul className="mt-1 max-h-[220px] overflow-y-auto rounded-lg border border-[#EFECE5]">
              {res.map((r) => (
                <li key={r.reference}>
                  <button className="w-full border-t border-[#EFECE5] px-2 py-1 text-left text-[12px] hover:bg-[#FAF9F6]" onClick={() => onApparier(r.reference)}>
                    <b>{r.reference}</b> — {r.designation} <span className="text-[#8A8474]">({r.fournisseur_principal || '—'}{r.sommeil ? ', sommeil' : ''})</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {x.l.appariement_manuel && <button className={btn} onClick={() => onApparier('')}>Revenir à l’appariement automatique</button>}
            <button className={btn} onClick={() => onApparier(null, !x.l.ignoree)}>{x.l.ignoree ? 'Réintégrer la ligne' : 'Ignorer cette ligne'}</button>
          </div>
        </div>
      </aside>
    </div>
  )
}

export default function TarifsFournisseursPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>}>
      <TarifsFournisseurs />
    </Suspense>
  )
}
