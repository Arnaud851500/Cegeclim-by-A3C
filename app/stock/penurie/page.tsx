'use client'

/**
 * Écran « Références en pénurie » (menu Stocks & logistique, /stock/penurie).
 * ---------------------------------------------------------------------------
 * Créé le 07/10/2026.
 *
 * Objectif : éviter les promesses de livraison intenables. Pour chaque référence
 * sans quantité promettable aujourd'hui, l'écran donne la date de prochaine
 * disponibilité pour une NOUVELLE commande client.
 *
 * Règle (identique côté SQL et dans le simulateur de la fenêtre article) :
 *  - stock projeté = stock dispo SAGE tous dépôts (réel − préparé)
 *      + CDF SAGE en cours (à leur date ; en retard / sans date = demain)
 *      − CDC à livrer (à leur date ; CDC en retard = aujourd'hui) ;
 *  - période figée = d'aujourd'hui jusqu'à aujourd'hui + délai d'appro de la
 *    référence (référence > calcul de besoin > fournisseur > défaut) : un appro
 *    lancé aujourd'hui n'arrive pas avant ;
 *  - quantité promettable à une date D = point bas du stock projeté entre D et
 *    la fin de la période figée. Au-delà, un nouvel appro peut couvrir : aucune
 *    alerte sur la commande client (statut A_COUVRIR_PAR_APPRO côté portefeuille) ;
 *  - référence en arrêt appro (arrêt manuel ou « Blocage appro » SAGE) : pas de
 *    nouvel appro, seules les CDF en cours comptent (sinon « jamais »).
 *
 * Deux usages :
 *  - commerciaux / ADV : « Vue commandes clients » → date à proposer au client ;
 *  - appro : « Vue appro » → cause (aucune CDF, CDF insuffisante, CDF trop tardive,
 *    arrêt appro), CDF en cours, manque sur la période figée.
 *
 * Sources : RPC get_references_penurie (SQL 20261007_references_penurie.sql),
 * vues v_couverture_stock_besoins (CDC, clients masqués hors périmètre) et
 * v_couverture_stock_receptions (CDF) pour la fenêtre article.
 * URL : ?ref=XXXX ouvre la fenêtre article, ?vue=appro ouvre la vue appro.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type DispoPar = 'STOCK' | 'APPRO_EN_COURS' | 'NOUVEL_APPRO' | 'JAMAIS'
type Cause = 'DISPONIBLE' | 'ARRET_APPRO' | 'AUCUNE_CDF' | 'CDF_INSUFFISANTE' | 'CDF_TARDIVE'
type Vue = 'commerce' | 'appro'

type Ligne = {
  reference_article: string
  designation: string | null
  famille: string | null
  famille_macro: string | null
  sommeil: boolean
  fournisseur_principal: string | null
  nom_fournisseur: string | null
  strategie_appro: string | null
  stock_reel: number | null
  stock_reserve: number | null
  stock_disponible: number | null
  conso_moy_mensuelle: number | null
  delai_appro_jours: number
  delai_source: string
  arret_appro: boolean
  blocage_appro_sage: boolean
  date_appro_au_plus_tot: string | null
  qte_dispo_aujourdhui: number
  en_penurie: boolean
  date_prochaine_dispo: string | null
  qte_prochaine_dispo: number | null
  dispo_par: DispoPar
  date_dispo_appros_en_cours: string | null
  date_rupture: string | null
  manque_periode_figee: number
  besoin_periode_figee: number
  receptions_periode_figee: number
  besoin_cdc_total: number
  nb_cdc: number
  nb_cdc_periode_figee: number
  receptions_total: number
  nb_cdf: number
  prochaine_reception_date: string | null
  prochaine_reception_qte: number | null
  numeros_cdf: string | null
  cdf_en_retard: boolean
  solde_final: number | null
  cause: Cause
}

type Besoin = {
  id: string; numero_document: string | null; numero_tiers: string | null; nom_tiers: string | null
  representant: string | null; agence: string | null; date_creation_document: string | null; date_livraison: string | null
  quantite: number | null; statut_couverture: string | null; date_couverture_estimee: string | null; visible: boolean | null
}
type Reception = {
  numero_cdf: string | null; nom_fournisseur: string | null; numero_fournisseur: string | null; depot_reception: string | null
  date_commande: string | null; date_livraison_sage: string | null; quantite_attendue: number | null
  hypothese_reception: string | null; date_reception_retenue: string | null
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const n0 = (v: number | null | undefined) => Number(v ?? 0)
function fmtNum(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(String(v).length === 10 ? `${v}T12:00:00` : v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR')
}
function isoAujourdhui(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function ajouterJours(iso: string, j: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + j)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function joursEntre(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000)
}
function messageErreur(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as { message?: string; details?: string; hint?: string; code?: string }
    return [o.message, o.details, o.hint, o.code ? `(${o.code})` : null].filter(Boolean).join(' — ') || JSON.stringify(e)
  }
  return String(e)
}
function normaliser(v: unknown): string {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
}

const DISPO_STYLE: Record<DispoPar, { label: string; cls: string; title: string }> = {
  STOCK: { label: 'Stock', cls: 'bg-emerald-50 text-emerald-700', title: 'Disponible aujourd’hui' },
  APPRO_EN_COURS: { label: 'CDF en cours', cls: 'bg-sky-50 text-sky-800', title: 'La quantité redevient promettable grâce aux commandes fournisseurs déjà passées' },
  NOUVEL_APPRO: { label: 'Nouvel appro', cls: 'bg-[#B4761A]/[0.14] text-[#8A5A08]', title: 'Les CDF en cours ne suffisent pas : la première date possible est celle d’un appro lancé aujourd’hui (aujourd’hui + délai d’appro)' },
  JAMAIS: { label: 'Jamais', cls: 'bg-violet-100 text-violet-900', title: 'Arrêt appro : aucun réapprovisionnement ne viendra compléter la référence' },
}
const CAUSE_STYLE: Record<Cause, { label: string; cls: string; title: string }> = {
  DISPONIBLE: { label: 'Disponible', cls: 'bg-emerald-50 text-emerald-700', title: '' },
  ARRET_APPRO: { label: 'Arrêt appro', cls: 'bg-violet-100 text-violet-900', title: 'Référence en arrêt appro (manuel ou « Blocage appro » SAGE)' },
  AUCUNE_CDF: { label: 'Aucune CDF', cls: 'bg-red-600 text-white', title: 'Aucune commande fournisseur en cours : l’appro n’est pas lancé' },
  CDF_INSUFFISANTE: { label: 'CDF insuffisante', cls: 'bg-red-50 text-red-700', title: 'Les commandes fournisseurs en cours ne couvrent pas toutes les commandes clients' },
  CDF_TARDIVE: { label: 'CDF trop tardive', cls: 'bg-orange-100 text-orange-800', title: 'La quantité commandée suffit, mais elle arrive après le besoin des commandes clients' },
}
const DELAI_SOURCE: Record<string, string> = {
  REFERENCE: 'délai saisi sur la référence',
  CALCUL_BESOIN: 'délai du calcul de besoin',
  FOURNISSEUR: 'délai fournisseur',
  DEFAUT: 'délai par défaut',
}

/** Première date où une quantité Q est promettable sans retarder une CDC déjà prise
 * dans la période figée (même règle que get_references_penurie). */
function datePromettable(
  q: number, s0: number, besoins: Besoin[], receptions: Reception[], delai: number, arret: boolean,
): { date: string | null; par: DispoPar } {
  const auj = isoAujourdhui()
  const finFenetre = ajouterJours(auj, delai)
  const flux = new Map<string, number>()
  flux.set(auj, 0)
  besoins.forEach((b) => {
    const d = b.date_livraison && b.date_livraison > auj ? b.date_livraison.slice(0, 10) : auj
    flux.set(d, (flux.get(d) || 0) - n0(b.quantite))
  })
  receptions.forEach((r) => {
    const d = r.date_reception_retenue && r.date_reception_retenue > auj ? r.date_reception_retenue.slice(0, 10) : auj
    flux.set(d, (flux.get(d) || 0) + n0(r.quantite_attendue))
  })
  const jours = Array.from(flux.keys()).sort()
  let cumul = s0
  const soldes = jours.map((d) => { cumul += flux.get(d) || 0; return { d, solde: cumul, fen: arret || d < finFenetre } })
  // point bas « à partir de » chaque jour, limité à la période figée
  let minFen = Infinity
  const atp: { d: string; v: number }[] = []
  for (let i = soldes.length - 1; i >= 0; i -= 1) {
    if (soldes[i].fen) { minFen = Math.min(minFen, soldes[i].solde); atp.unshift({ d: soldes[i].d, v: minFen }) }
  }
  const trouve = atp.find((a) => a.v >= q)
  if (trouve) return { date: trouve.d, par: trouve.d === auj ? 'STOCK' : 'APPRO_EN_COURS' }
  if (!arret) return { date: finFenetre, par: 'NOUVEL_APPRO' }
  return { date: null, par: 'JAMAIS' }
}

// ─────────────────────────────────────────────────────────────────────────
// Petits composants
// ─────────────────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, tone, onClick, actif, title }: {
  label: string; value: string; sub?: string; tone?: 'alerte' | 'warn' | 'ok' | 'violet'; onClick?: () => void; actif?: boolean; title?: string
}) {
  const color = tone === 'alerte' ? '#B42318' : tone === 'warn' ? '#B4761A' : tone === 'ok' ? '#3F9142' : tone === 'violet' ? '#7A5EA8' : '#111820'
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} title={title}
      className={`min-w-0 rounded-xl border px-3 py-2 text-left ${actif ? 'border-[#B4761A] bg-[#B4761A]/[0.08]' : 'border-[#E5E1D8] bg-white'} ${onClick ? 'hover:border-[#B4761A]' : ''}`}>
      <div className="truncate text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">{label}</div>
      <div className="text-[20px] font-bold leading-7 tracking-tight" style={{ color }}>{value}</div>
      {sub && <div className="truncate text-[11px] text-[#8A8474]">{sub}</div>}
    </Tag>
  )
}

function Badge({ cls, children, title }: { cls: string; children: React.ReactNode; title?: string }) {
  return <span title={title} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-bold ${cls}`}>{children}</span>
}

// ─────────────────────────────────────────────────────────────────────────
// Fenêtre article : projection, CDC, CDF, simulateur
// ─────────────────────────────────────────────────────────────────────────

const STATUT_CDC: Record<string, { label: string; cls: string }> = {
  COUVERT: { label: 'Couvert (stock)', cls: 'bg-emerald-50 text-emerald-700' },
  COUVERT_PAR_RECEPTION: { label: 'Couvert par réception', cls: 'bg-sky-50 text-sky-800' },
  RECEPTION_TARDIVE: { label: 'Réception tardive', cls: 'bg-orange-100 text-orange-800' },
  RUPTURE: { label: 'Rupture', cls: 'bg-red-50 text-red-700' },
  A_COUVRIR_PAR_APPRO: { label: 'À couvrir par appro', cls: 'bg-[#B4761A]/[0.14] text-[#8A5A08]' },
}

function ArticleModal({ ligne, position, onPrev, onNext, onClose }: {
  ligne: Ligne; position: string | null; onPrev?: () => void; onNext?: () => void; onClose: () => void
}) {
  const [besoins, setBesoins] = useState<Besoin[]>([])
  const [receptions, setReceptions] = useState<Reception[]>([])
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [qteSimu, setQteSimu] = useState('1')

  useEffect(() => {
    // état initial « chargement » : la fenêtre est remontée (key) à chaque référence
    let annule = false
    Promise.all([
      supabase.from('v_couverture_stock_besoins')
        .select('id,numero_document,numero_tiers,nom_tiers,representant,agence,date_creation_document,date_livraison,quantite,statut_couverture,date_couverture_estimee,visible')
        .eq('reference_article', ligne.reference_article)
        .order('date_livraison', { ascending: true, nullsFirst: true }),
      supabase.from('v_couverture_stock_receptions')
        .select('numero_cdf,nom_fournisseur,numero_fournisseur,depot_reception,date_commande,date_livraison_sage,quantite_attendue,hypothese_reception,date_reception_retenue')
        .eq('reference_article', ligne.reference_article)
        .order('date_reception_retenue', { ascending: true }),
    ]).then(([b, r]) => {
      if (annule) return
      if (b.error) setErreur(messageErreur(b.error))
      else if (r.error) setErreur(messageErreur(r.error))
      setBesoins((b.data || []) as Besoin[])
      setReceptions((r.data || []) as Reception[])
      setLoading(false)
    })
    return () => { annule = true }
  }, [ligne.reference_article])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && onPrev) onPrev()
      if (e.key === 'ArrowRight' && onNext) onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  const auj = isoAujourdhui()
  const finFenetre = ligne.date_appro_au_plus_tot

  // Courbe du stock projeté (escalier, fin de journée)
  const serie = useMemo(() => {
    const flux = new Map<string, { q: number; cdc: number; cdf: number }>()
    flux.set(auj, { q: 0, cdc: 0, cdf: 0 })
    besoins.forEach((b) => {
      const d = b.date_livraison && b.date_livraison > auj ? b.date_livraison.slice(0, 10) : auj
      const f = flux.get(d) || { q: 0, cdc: 0, cdf: 0 }
      f.q -= n0(b.quantite); f.cdc += n0(b.quantite); flux.set(d, f)
    })
    receptions.forEach((r) => {
      const d = r.date_reception_retenue && r.date_reception_retenue > auj ? r.date_reception_retenue.slice(0, 10) : auj
      const f = flux.get(d) || { q: 0, cdc: 0, cdf: 0 }
      f.q += n0(r.quantite_attendue); f.cdf += n0(r.quantite_attendue); flux.set(d, f)
    })
    if (finFenetre) flux.set(finFenetre, flux.get(finFenetre) || { q: 0, cdc: 0, cdf: 0 })
    const out: { d: string; label: string; solde: number; cdc: number; cdf: number }[] = []
    let cumul = n0(ligne.stock_disponible)
    for (const d of Array.from(flux.keys()).sort()) {
      const f = flux.get(d)!
      cumul += f.q
      out.push({ d, label: fmtDate(d), solde: cumul, cdc: f.cdc, cdf: f.cdf })
    }
    return out
  }, [besoins, receptions, ligne.stock_disponible, auj, finFenetre])

  const simu = useMemo(() => {
    const q = Number(String(qteSimu).replace(',', '.'))
    if (!Number.isFinite(q) || q <= 0 || loading) return null
    return datePromettable(q, n0(ligne.stock_disponible), besoins, receptions, ligne.delai_appro_jours, ligne.arret_appro)
  }, [qteSimu, besoins, receptions, ligne, loading])

  const cdcFenetre = besoins.filter((b) => ligne.arret_appro || !finFenetre || (b.date_livraison || auj) < finFenetre)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-[1300px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E1D8] px-5 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[18px] font-bold tracking-tight">{ligne.reference_article}</span>
              <Badge cls={DISPO_STYLE[ligne.dispo_par].cls} title={DISPO_STYLE[ligne.dispo_par].title}>{DISPO_STYLE[ligne.dispo_par].label}</Badge>
              {ligne.en_penurie && <Badge cls={CAUSE_STYLE[ligne.cause].cls} title={CAUSE_STYLE[ligne.cause].title}>{CAUSE_STYLE[ligne.cause].label}</Badge>}
              {ligne.cdf_en_retard && <Badge cls="bg-amber-100 text-amber-900" title="Au moins une CDF est en retard ou sans date : supposée reçue demain">CDF en retard / sans date</Badge>}
            </div>
            <div className="truncate text-[12.5px] text-[#5E5A50]">{ligne.designation || '—'} · {ligne.famille_macro} · {ligne.nom_fournisseur || ligne.fournisseur_principal || 'Fournisseur inconnu'}{ligne.strategie_appro ? ` · ${ligne.strategie_appro}` : ''}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {position && <span className="mr-1 text-[11px] text-[#8A8474]">{position}</span>}
            <button type="button" onClick={onPrev} disabled={!onPrev} className="h-8 w-8 rounded-md border border-[#E5E1D8] text-[14px] disabled:opacity-30">‹</button>
            <button type="button" onClick={onNext} disabled={!onNext} className="h-8 w-8 rounded-md border border-[#E5E1D8] text-[14px] disabled:opacity-30">›</button>
            <button type="button" onClick={onClose} className="ml-1 h-8 rounded-md bg-[#111820] px-3 text-[12px] font-bold text-white">Fermer</button>
          </div>
        </div>

        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <Kpi label="Prochaine dispo (nouvelle CDC)" value={ligne.date_prochaine_dispo ? fmtDate(ligne.date_prochaine_dispo) : 'Jamais'} sub={ligne.qte_prochaine_dispo !== null ? `${fmtNum(ligne.qte_prochaine_dispo)} promettable(s) à cette date` : DISPO_STYLE[ligne.dispo_par].label} tone={ligne.dispo_par === 'JAMAIS' ? 'violet' : 'warn'} />
            <Kpi label="Fin de période figée" value={finFenetre ? fmtDate(finFenetre) : '—'} sub={`délai ${fmtNum(ligne.delai_appro_jours)} j · ${DELAI_SOURCE[ligne.delai_source] || ligne.delai_source}`} />
            <Kpi label="Stock dispo SAGE" value={fmtNum(ligne.stock_disponible)} sub={`réel ${fmtNum(ligne.stock_reel)} · réservé ${fmtNum(ligne.stock_reserve)}`} />
            <Kpi label="CDC période figée" value={fmtNum(ligne.besoin_periode_figee)} sub={`${fmtNum(ligne.nb_cdc_periode_figee)} CDC · ${fmtNum(ligne.besoin_cdc_total)} p. au total`} />
            <Kpi label="CDF en cours" value={fmtNum(ligne.receptions_total)} sub={`${fmtNum(ligne.nb_cdf)} CDF · ${fmtNum(ligne.receptions_periode_figee)} p. dans la période figée`} />
            <Kpi label="Manque période figée" value={fmtNum(ligne.manque_periode_figee)} sub={ligne.date_rupture ? `rupture le ${fmtDate(ligne.date_rupture)}` : 'pas de rupture projetée'} tone={ligne.manque_periode_figee > 0 ? 'alerte' : 'ok'} />
          </div>

          <div className="rounded-xl border border-[#E5E1D8] bg-[#FAF8F3] p-3">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="font-bold text-[#3A362E]">Simulateur — nouvelle commande de</span>
              <input value={qteSimu} onChange={(e) => setQteSimu(e.target.value)} inputMode="decimal" className="h-8 w-20 rounded-md border border-[#E5E1D8] bg-white px-2 text-right font-bold" />
              <span className="font-bold text-[#3A362E]">pièce(s) :</span>
              {loading ? <span className="text-[#8A8474]">calcul…</span> : simu ? (
                simu.date
                  ? <span>date de livraison au plus tôt <b className="text-[15px] text-[#8A5A08]">{fmtDate(simu.date)}</b> <Badge cls={DISPO_STYLE[simu.par].cls}>{DISPO_STYLE[simu.par].label}</Badge>{simu.date > isoAujourdhui() && <span className="text-[#8A8474]"> · soit J+{joursEntre(isoAujourdhui(), simu.date)}</span>}</span>
                  : <b className="text-violet-800">aucune date possible (arrêt appro, CDF en cours insuffisantes)</b>
              ) : <span className="text-[#8A8474]">saisir une quantité</span>}
            </div>
            <p className="mt-1 text-[11px] text-[#8A8474]">Date à partir de laquelle la quantité peut être promise sans retarder une commande client déjà en portefeuille livrable dans la période figée. Au-delà du {finFenetre ? fmtDate(finFenetre) : '—'}, un appro lancé aujourd’hui peut couvrir la commande.</p>
          </div>

          {erreur && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-800">{erreur}</div>}

          <div className="rounded-xl border border-[#E5E1D8] p-3">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Stock projeté (fin de journée) — zone ocre = période figée</div>
            <div className="h-[230px]">
              {loading ? <div className="flex h-full items-center justify-center text-[12px] text-[#8A8474]">Chargement…</div> : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={serie} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EDEAE1" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 10 }} width={44} />
                    <Tooltip formatter={(v) => [fmtNum(Number(v)), 'Stock projeté']}
                      labelFormatter={(l, p) => {
                        const x = (p as ReadonlyArray<{ payload?: { cdc: number; cdf: number } }> | undefined)?.[0]?.payload
                        return `${String(l)}${x ? ` — CDC ${fmtNum(x.cdc)} · CDF ${fmtNum(x.cdf)}` : ''}`
                      }} />
                    {finFenetre && serie.length > 0 && <ReferenceArea x1={serie[0].label} x2={fmtDate(finFenetre)} fill="#B4761A" fillOpacity={0.08} />}
                    <ReferenceLine y={0} stroke="#B42318" strokeDasharray="4 3" />
                    {finFenetre && <ReferenceLine x={fmtDate(finFenetre)} stroke="#B4761A" label={{ value: 'appro au plus tôt', fontSize: 10, fill: '#8A5A08', position: 'insideTopRight' }} />}
                    <Line type="stepAfter" dataKey="solde" stroke="#0B1220" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="rounded-xl border border-[#E5E1D8]">
              <div className="border-b border-[#E5E1D8] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
                Commandes clients à livrer ({fmtNum(besoins.length)} lignes · {fmtNum(cdcFenetre.length)} dans la période figée)
              </div>
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full text-[11.5px]">
                  <thead className="sticky top-0 bg-[#F4F3F0] text-left text-[10.5px] uppercase text-[#8A8474]">
                    <tr><th className="px-2 py-1.5">Liv. client</th><th className="px-2 py-1.5">CDC</th><th className="px-2 py-1.5">Client</th><th className="px-2 py-1.5">Agence</th><th className="px-2 py-1.5 text-right">Qté</th><th className="px-2 py-1.5">Statut</th></tr>
                  </thead>
                  <tbody>
                    {besoins.map((b) => {
                      const st = STATUT_CDC[b.statut_couverture || ''] || { label: b.statut_couverture || '—', cls: 'bg-[#F4F3F0] text-[#8A8474]' }
                      const dansFenetre = ligne.arret_appro || !finFenetre || (b.date_livraison || auj) < finFenetre
                      return (
                        <tr key={b.id} className={`border-t border-[#F0EDE6] ${dansFenetre ? '' : 'text-[#8A8474]'}`}>
                          <td className="whitespace-nowrap px-2 py-1">{fmtDate(b.date_livraison)}{b.date_livraison && b.date_livraison < auj ? ' ⚠' : ''}</td>
                          <td className="whitespace-nowrap px-2 py-1 font-semibold">{b.numero_document}</td>
                          <td className="max-w-[240px] truncate px-2 py-1" title={b.nom_tiers || ''}>{b.nom_tiers}</td>
                          <td className="whitespace-nowrap px-2 py-1">{b.agence}</td>
                          <td className="px-2 py-1 text-right font-semibold">{fmtNum(b.quantite)}</td>
                          <td className="px-2 py-1"><Badge cls={st.cls}>{st.label}</Badge></td>
                        </tr>
                      )
                    })}
                    {!loading && besoins.length === 0 && <tr><td colSpan={6} className="px-2 py-4 text-center text-[#8A8474]">Aucune commande client à livrer.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="rounded-xl border border-[#E5E1D8]">
              <div className="border-b border-[#E5E1D8] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Commandes fournisseurs en cours ({fmtNum(receptions.length)})</div>
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full text-[11.5px]">
                  <thead className="sticky top-0 bg-[#F4F3F0] text-left text-[10.5px] uppercase text-[#8A8474]">
                    <tr><th className="px-2 py-1.5">Réception retenue</th><th className="px-2 py-1.5">CDF</th><th className="px-2 py-1.5">Commandée le</th><th className="px-2 py-1.5 text-right">Qté</th></tr>
                  </thead>
                  <tbody>
                    {receptions.map((r, i) => (
                      <tr key={`${r.numero_cdf}-${i}`} className="border-t border-[#F0EDE6]">
                        <td className="whitespace-nowrap px-2 py-1">
                          {fmtDate(r.date_reception_retenue)}
                          {r.hypothese_reception && r.hypothese_reception !== 'PREVUE' && <span className="ml-1 text-[10px] font-bold text-amber-800" title={`Date SAGE : ${fmtDate(r.date_livraison_sage)} — supposée reçue demain`}>{r.hypothese_reception === 'RETARD' ? 'retard' : 'sans date'}</span>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 font-semibold">{r.numero_cdf}</td>
                        <td className="whitespace-nowrap px-2 py-1">{fmtDate(r.date_commande)}</td>
                        <td className="px-2 py-1 text-right font-semibold">{fmtNum(r.quantite_attendue)}</td>
                      </tr>
                    ))}
                    {!loading && receptions.length === 0 && <tr><td colSpan={4} className="px-2 py-4 text-center font-semibold text-red-700">Aucune commande fournisseur en cours.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

type CleTri = 'reference_article' | 'designation' | 'famille_macro' | 'fournisseur' | 'stock_disponible' | 'date_prochaine_dispo'
  | 'attente' | 'manque_periode_figee' | 'besoin_periode_figee' | 'nb_cdc_periode_figee' | 'prochaine_reception_date'
  | 'receptions_total' | 'delai_appro_jours' | 'cause' | 'date_rupture'

function ReferencesPenurie() {
  const router = useRouter()
  const params = useSearchParams()
  const [rows, setRows] = useState<Ligne[]>([])
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargeLe, setChargeLe] = useState<Date | null>(null)
  const [vue, setVue] = useState<Vue>(params.get('vue') === 'appro' ? 'appro' : 'commerce')
  const [search, setSearch] = useState('')
  const [familleF, setFamilleF] = useState('')
  const [fournF, setFournF] = useState('')
  const [dispoF, setDispoF] = useState<'' | DispoPar>('')
  const [causeF, setCauseF] = useState<'' | Cause>('')
  const [avecCdcF, setAvecCdcF] = useState<'tous' | 'avec' | 'sans'>('tous')
  const [sommeilF, setSommeilF] = useState<'actives' | 'tous'>('actives')
  const [tri, setTri] = useState<{ k: CleTri; dir: 1 | -1 }>({ k: 'date_prochaine_dispo', dir: -1 })
  const [nbAffichees, setNbAffichees] = useState(300)
  const [exportEnCours, setExportEnCours] = useState(false)
  const refOuverte = params.get('ref')

  const charger = useCallback(async () => {
    setLoading(true); setErreur(null)
    const { data, error } = await supabase.rpc('get_references_penurie', { p_seulement_penurie: true })
    if (error) { setErreur(messageErreur(error)); setRows([]) }
    else { setRows((data || []) as Ligne[]); setChargeLe(new Date()) }
    setLoading(false)
  }, [])
  useEffect(() => { void charger() }, [charger])

  function setUrl(next: { ref?: string | null; vue?: Vue }) {
    const sp = new URLSearchParams(params.toString())
    if (next.ref !== undefined) { if (next.ref) sp.set('ref', next.ref); else sp.delete('ref') }
    if (next.vue !== undefined) { if (next.vue === 'appro') sp.set('vue', 'appro'); else sp.delete('vue') }
    const qs = sp.toString()
    router.replace(qs ? `/stock/penurie?${qs}` : '/stock/penurie', { scroll: false })
  }
  function changerVue(v: Vue) {
    setVue(v); setUrl({ vue: v })
    setTri(v === 'appro' ? { k: 'manque_periode_figee', dir: -1 } : { k: 'date_prochaine_dispo', dir: -1 })
  }

  const auj = isoAujourdhui()
  const attente = (r: Ligne) => (r.date_prochaine_dispo ? joursEntre(auj, r.date_prochaine_dispo) : 99999)

  const familles = useMemo(() => Array.from(new Set(rows.map((r) => r.famille_macro || 'Sans famille macro'))).sort((a, b) => a.localeCompare(b, 'fr')), [rows])
  const fournisseurs = useMemo(() => {
    const m = new Map<string, string>()
    rows.forEach((r) => { if (r.fournisseur_principal) m.set(r.fournisseur_principal, r.nom_fournisseur || r.fournisseur_principal) })
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1], 'fr'))
  }, [rows])

  const base = useMemo(() => rows.filter((r) => sommeilF === 'tous' || !r.sommeil), [rows, sommeilF])

  const filtres = useMemo(() => {
    const s = normaliser(search.trim())
    const termes = s.split(/[\s,;]+/).filter(Boolean)
    const list = base.filter((r) => {
      if (familleF && (r.famille_macro || 'Sans famille macro') !== familleF) return false
      if (fournF && r.fournisseur_principal !== fournF) return false
      if (dispoF && r.dispo_par !== dispoF) return false
      if (causeF && r.cause !== causeF) return false
      if (avecCdcF === 'avec' && r.nb_cdc_periode_figee <= 0) return false
      if (avecCdcF === 'sans' && r.nb_cdc_periode_figee > 0) return false
      if (termes.length) {
        const hay = normaliser(`${r.reference_article} ${r.designation} ${r.famille} ${r.famille_macro} ${r.nom_fournisseur} ${r.fournisseur_principal} ${r.numeros_cdf}`)
        // plusieurs références collées : correspondance sur l'une d'elles ; sinon tous les mots
        const refs = termes.filter((t) => rows.some((x) => normaliser(x.reference_article) === t))
        if (refs.length > 1) return refs.includes(normaliser(r.reference_article))
        if (!termes.every((t) => hay.includes(t))) return false
      }
      return true
    })
    const val = (r: Ligne): string | number | null => {
      switch (tri.k) {
        case 'fournisseur': return r.nom_fournisseur || r.fournisseur_principal
        case 'attente': return attente(r)
        case 'date_prochaine_dispo': return attente(r)
        case 'cause': return r.cause
        default: return (r[tri.k] as string | number | null) ?? null
      }
    }
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va === null || va === '') return 1
      if (vb === null || vb === '') return -1
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr', { numeric: true })
      return c * tri.dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, rows, search, familleF, fournF, dispoF, causeF, avecCdcF, tri])
  useEffect(() => { setNbAffichees(300) }, [filtres.length, tri])

  const kpis = useMemo(() => {
    const k = { total: 0, avecCdc: 0, cdcFenetre: 0, appro: 0, nouvel: 0, jamais: 0, aucuneCdf: 0, insuffisante: 0, tardive: 0, retardCdf: 0, attenteMoy: 0 }
    let somme = 0, n = 0
    base.forEach((r) => {
      k.total += 1
      if (r.nb_cdc_periode_figee > 0) { k.avecCdc += 1; k.cdcFenetre += r.nb_cdc_periode_figee }
      if (r.dispo_par === 'APPRO_EN_COURS') k.appro += 1
      if (r.dispo_par === 'NOUVEL_APPRO') k.nouvel += 1
      if (r.dispo_par === 'JAMAIS') k.jamais += 1
      if (r.cause === 'AUCUNE_CDF') k.aucuneCdf += 1
      if (r.cause === 'CDF_INSUFFISANTE') k.insuffisante += 1
      if (r.cause === 'CDF_TARDIVE') k.tardive += 1
      if (r.cdf_en_retard) k.retardCdf += 1
      if (r.date_prochaine_dispo) { somme += joursEntre(auj, r.date_prochaine_dispo); n += 1 }
    })
    k.attenteMoy = n ? Math.round(somme / n) : 0
    return k
  }, [base, auj])

  const indexOuvert = refOuverte ? filtres.findIndex((r) => r.reference_article === refOuverte) : -1
  const ligneOuverte = refOuverte ? rows.find((r) => r.reference_article === refOuverte) : undefined

  function basculerTri(k: CleTri) {
    setTri((t) => (t.k === k ? { k, dir: t.dir === 1 ? -1 : 1 } : { k, dir: ['reference_article', 'designation', 'famille_macro', 'fournisseur', 'cause', 'date_rupture', 'prochaine_reception_date'].includes(k) ? 1 : -1 }))
  }
  function Th({ k, children, right, title }: { k: CleTri; children: React.ReactNode; right?: boolean; title?: string }) {
    const actif = tri.k === k
    return (
      <th title={title} onClick={() => basculerTri(k)} className={`sticky top-0 z-10 cursor-pointer select-none whitespace-nowrap bg-[#F4F3F0] px-2 py-2 font-bold hover:bg-[#EDEAE1] ${right ? 'text-right' : 'text-left'} ${actif ? 'text-[#111820]' : ''}`}>
        {children}<span className={`ml-1 text-[10px] ${actif ? 'text-[#B4761A]' : 'text-[#C9C4B8]'}`}>{actif ? (tri.dir === 1 ? '▲' : '▼') : '↕'}</span>
      </th>
    )
  }

  async function exporterExcel() {
    setExportEnCours(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Références en pénurie')
      const cols: { h: string; f: (r: Ligne) => unknown; w?: number }[] = [
        { h: 'Référence', f: (r) => r.reference_article, w: 18 }, { h: 'Désignation', f: (r) => r.designation, w: 40 },
        { h: 'Famille', f: (r) => r.famille }, { h: 'Famille macro', f: (r) => r.famille_macro },
        { h: 'Fournisseur', f: (r) => r.fournisseur_principal }, { h: 'Nom fournisseur', f: (r) => r.nom_fournisseur, w: 28 }, { h: 'Stratégie appro', f: (r) => r.strategie_appro },
        { h: 'Prochaine dispo (nouvelle CDC)', f: (r) => (r.date_prochaine_dispo ? fmtDate(r.date_prochaine_dispo) : 'Jamais'), w: 16 },
        { h: 'Attente (j)', f: (r) => (r.date_prochaine_dispo ? joursEntre(auj, r.date_prochaine_dispo) : '') },
        { h: 'Qté promettable à cette date', f: (r) => r.qte_prochaine_dispo ?? (r.dispo_par === 'NOUVEL_APPRO' ? 'selon appro' : '') },
        { h: 'Dispo par', f: (r) => DISPO_STYLE[r.dispo_par].label },
        { h: 'Délai appro (j)', f: (r) => r.delai_appro_jours }, { h: 'Source délai', f: (r) => DELAI_SOURCE[r.delai_source] || r.delai_source },
        { h: 'Appro au plus tôt', f: (r) => fmtDate(r.date_appro_au_plus_tot) },
        { h: 'Arrêt appro', f: (r) => (r.arret_appro ? (r.blocage_appro_sage ? 'Blocage SAGE' : 'Oui') : '') },
        { h: 'Stock réel', f: (r) => r.stock_reel }, { h: 'Stock réservé', f: (r) => r.stock_reserve }, { h: 'Stock dispo', f: (r) => r.stock_disponible },
        { h: 'Conso moy. mensuelle', f: (r) => r.conso_moy_mensuelle },
        { h: 'Date rupture projetée', f: (r) => fmtDate(r.date_rupture) },
        { h: 'CDC période figée (qté)', f: (r) => r.besoin_periode_figee }, { h: 'CDC période figée (nb)', f: (r) => r.nb_cdc_periode_figee },
        { h: 'CDC total (qté)', f: (r) => r.besoin_cdc_total }, { h: 'CDC total (nb)', f: (r) => r.nb_cdc },
        { h: 'Manque période figée', f: (r) => r.manque_periode_figee },
        { h: 'CDF en cours (qté)', f: (r) => r.receptions_total }, { h: 'CDF en cours (nb)', f: (r) => r.nb_cdf }, { h: 'CDF dans période figée', f: (r) => r.receptions_periode_figee },
        { h: 'Prochaine réception', f: (r) => fmtDate(r.prochaine_reception_date) }, { h: 'Qté prochaine réception', f: (r) => r.prochaine_reception_qte },
        { h: 'N° CDF', f: (r) => r.numeros_cdf, w: 30 }, { h: 'CDF en retard / sans date', f: (r) => (r.cdf_en_retard ? 'Oui' : '') },
        { h: 'Dispo via CDF en cours seules', f: (r) => fmtDate(r.date_dispo_appros_en_cours) },
        { h: 'Stock projeté final', f: (r) => r.solde_final },
        { h: 'Cause', f: (r) => CAUSE_STYLE[r.cause].label },
      ]
      ws.addRow(cols.map((c) => c.h)).font = { bold: true }
      filtres.forEach((r) => ws.addRow(cols.map((c) => { const v = c.f(r); return v === null || v === undefined ? '' : v })))
      cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w || 13 })
      ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = `references_penurie_${auj}.xlsx`; a.click(); URL.revokeObjectURL(url)
    } catch (e) { setErreur('Export Excel : ' + messageErreur(e)) } finally { setExportEnCours(false) }
  }

  const ctl = 'h-8 min-w-0 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const nbFiltres = [search.trim(), familleF, fournF, dispoF, causeF].filter(Boolean).length + (avecCdcF !== 'tous' ? 1 : 0)
  function reinitialiser() { setSearch(''); setFamilleF(''); setFournF(''); setDispoF(''); setCauseF(''); setAvecCdcF('tous') }

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1900px] space-y-2.5">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Stocks & logistique</p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">Références en pénurie</h1>
            <p className="text-[11.5px] text-[#8A8474]">
              Références sans quantité promettable aujourd’hui pour une nouvelle commande client · date de prochaine dispo à respecter dans la date de livraison
              {chargeLe && <> · calculé à {chargeLe.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] p-0.5 text-[12.5px] font-bold">
              <button type="button" onClick={() => changerVue('commerce')} className={`rounded-md px-3 py-1.5 ${vue === 'commerce' ? 'bg-white text-[#111820] shadow-sm' : 'text-[#8A8474]'}`}>Vue commandes clients</button>
              <button type="button" onClick={() => changerVue('appro')} className={`rounded-md px-3 py-1.5 ${vue === 'appro' ? 'bg-white text-[#111820] shadow-sm' : 'text-[#8A8474]'}`}>Vue appro</button>
            </div>
            <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || loading || filtres.length === 0} className="h-10 rounded-lg bg-[#111820] px-3 text-[13px] font-bold text-white disabled:opacity-50">
              {exportEnCours ? 'Export…' : `⬇ Excel (${fmtNum(filtres.length)})`}
            </button>
            <button type="button" onClick={() => void charger()} disabled={loading} title="Recalculer" className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[14px] font-bold disabled:opacity-50">{loading ? '…' : '↻'}</button>
          </div>
        </section>

        {erreur && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-800">
            {erreur}{/get_references_penurie/.test(erreur) ? ' — la migration 20261007_references_penurie.sql (fonction get_references_penurie) est-elle appliquée ?' : ''}
          </div>
        )}

        {vue === 'commerce' ? (
          <section className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <Kpi label="Références en pénurie" value={loading ? '…' : fmtNum(kpis.total)} sub={`attente moyenne ${fmtNum(kpis.attenteMoy)} j`} tone="alerte" onClick={reinitialiser} actif={nbFiltres === 0} title="Réinitialiser les filtres" />
            <Kpi label="Dispo via CDF en cours" value={loading ? '…' : fmtNum(kpis.appro)} sub="avant la fin de la période figée" tone="warn" onClick={() => setDispoF((v) => (v === 'APPRO_EN_COURS' ? '' : 'APPRO_EN_COURS'))} actif={dispoF === 'APPRO_EN_COURS'} />
            <Kpi label="Dispo par nouvel appro" value={loading ? '…' : fmtNum(kpis.nouvel)} sub="date = aujourd’hui + délai d’appro" tone="warn" onClick={() => setDispoF((v) => (v === 'NOUVEL_APPRO' ? '' : 'NOUVEL_APPRO'))} actif={dispoF === 'NOUVEL_APPRO'} />
            <Kpi label="Jamais (arrêt appro)" value={loading ? '…' : fmtNum(kpis.jamais)} sub="proposer une substitution" tone="violet" onClick={() => setDispoF((v) => (v === 'JAMAIS' ? '' : 'JAMAIS'))} actif={dispoF === 'JAMAIS'} />
          </section>
        ) : (
          <section className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <Kpi label="Références en pénurie" value={loading ? '…' : fmtNum(kpis.total)} sub={`${fmtNum(kpis.avecCdc)} avec CDC en période figée`} tone="alerte" onClick={reinitialiser} actif={nbFiltres === 0} title="Réinitialiser les filtres" />
            <Kpi label="Aucune CDF en cours" value={loading ? '…' : fmtNum(kpis.aucuneCdf)} sub="appro non lancé" tone="alerte" onClick={() => setCauseF((v) => (v === 'AUCUNE_CDF' ? '' : 'AUCUNE_CDF'))} actif={causeF === 'AUCUNE_CDF'} title={CAUSE_STYLE.AUCUNE_CDF.title} />
            <Kpi label="CDF insuffisante" value={loading ? '…' : fmtNum(kpis.insuffisante)} sub="quantité commandée < besoins" tone="alerte" onClick={() => setCauseF((v) => (v === 'CDF_INSUFFISANTE' ? '' : 'CDF_INSUFFISANTE'))} actif={causeF === 'CDF_INSUFFISANTE'} title={CAUSE_STYLE.CDF_INSUFFISANTE.title} />
            <Kpi label="CDF trop tardive" value={loading ? '…' : fmtNum(kpis.tardive)} sub="arrive après le besoin" tone="warn" onClick={() => setCauseF((v) => (v === 'CDF_TARDIVE' ? '' : 'CDF_TARDIVE'))} actif={causeF === 'CDF_TARDIVE'} title={CAUSE_STYLE.CDF_TARDIVE.title} />
            <Kpi label="Arrêt appro" value={loading ? '…' : fmtNum(kpis.jamais)} sub="manuel ou Blocage SAGE" tone="violet" onClick={() => setCauseF((v) => (v === 'ARRET_APPRO' ? '' : 'ARRET_APPRO'))} actif={causeF === 'ARRET_APPRO'} />
            <Kpi label="CDF en retard / sans date" value={loading ? '…' : fmtNum(kpis.retardCdf)} sub="supposées reçues demain" tone="warn" />
          </section>
        )}

        <section className="rounded-xl border border-[#E5E1D8] bg-white px-3 py-2 text-[11.5px] leading-relaxed text-[#3A362E]">
          {vue === 'commerce' ? (
            <p>
              <b>À la saisie d’une commande client</b> : si la référence figure ici, la date de livraison ne doit pas être antérieure à la <b>prochaine dispo</b>.
              Cette date tient compte du stock, des commandes clients déjà prises et des commandes fournisseurs en cours. Pour une quantité précise, ouvrir la référence et utiliser le simulateur.
              Une date de livraison au-delà de l’<b>appro au plus tôt</b> (aujourd’hui + délai d’appro) peut toujours être tenue : l’appro sera lancé à temps, et la commande ne remonte pas en alerte.
            </p>
          ) : (
            <p>
              <b>Période figée</b> = d’aujourd’hui à aujourd’hui + délai d’appro : un appro lancé aujourd’hui n’arrivera pas avant. Le <b>manque</b> est le point bas négatif du stock projeté sur cette période.
              <b> Cause</b> : aucune CDF (appro non lancé), CDF insuffisante (stock projeté final négatif), CDF trop tardive (la quantité suffit mais arrive après les commandes clients), arrêt appro.
              Les commandes clients livrables après la période figée ne sont plus en alerte : elles sont à couvrir par l’appro (calcul de besoin).
            </p>
          )}
        </section>

        <section className="rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'minmax(220px, 2fr) repeat(6, minmax(0, 1fr))' }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Référence(s), désignation, fournisseur, n° CDF…" className={`${ctl} font-medium`} />
            <select value={familleF} onChange={(e) => setFamilleF(e.target.value)} className={ctl}>
              <option value="">Famille macro : toutes</option>
              {familles.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={fournF} onChange={(e) => setFournF(e.target.value)} className={ctl}>
              <option value="">Fournisseur : tous</option>
              {fournisseurs.map(([code, nom]) => <option key={code} value={code}>{nom}</option>)}
            </select>
            <select value={dispoF} onChange={(e) => setDispoF(e.target.value as '' | DispoPar)} className={ctl}>
              <option value="">Dispo par : tout</option>
              <option value="APPRO_EN_COURS">CDF en cours</option>
              <option value="NOUVEL_APPRO">Nouvel appro</option>
              <option value="JAMAIS">Jamais (arrêt appro)</option>
            </select>
            <select value={causeF} onChange={(e) => setCauseF(e.target.value as '' | Cause)} className={ctl}>
              <option value="">Cause : toutes</option>
              {(['AUCUNE_CDF', 'CDF_INSUFFISANTE', 'CDF_TARDIVE', 'ARRET_APPRO'] as Cause[]).map((c) => <option key={c} value={c}>{CAUSE_STYLE[c].label}</option>)}
            </select>
            <select value={avecCdcF} onChange={(e) => setAvecCdcF(e.target.value as 'tous' | 'avec' | 'sans')} className={ctl}>
              <option value="tous">CDC en période figée : toutes réf.</option>
              <option value="avec">Avec CDC en période figée</option>
              <option value="sans">Sans CDC (stock nul)</option>
            </select>
            <select value={sommeilF} onChange={(e) => setSommeilF(e.target.value as 'actives' | 'tous')} className={ctl}>
              <option value="actives">Articles actifs</option>
              <option value="tous">Y compris en sommeil</option>
            </select>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-[#8A8474]">
            <span>{fmtNum(filtres.length)} référence(s) affichée(s) sur {fmtNum(base.length)}</span>
            {nbFiltres > 0 && <button type="button" onClick={reinitialiser} className="font-bold text-[#B4761A] hover:underline">✕ effacer les filtres ({nbFiltres})</button>}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-[#E5E1D8] bg-white">
          <div className="max-h-[calc(100vh-330px)] min-h-[300px] overflow-auto">
            <table className="w-full text-[12px]">
              <thead className="text-[10.5px] uppercase text-[#8A8474]">
                <tr>
                  <Th k="reference_article">Référence</Th>
                  <Th k="designation">Désignation</Th>
                  <Th k="famille_macro">Famille macro</Th>
                  <Th k="date_prochaine_dispo" title="Première date de livraison possible pour une nouvelle commande client">Prochaine dispo</Th>
                  <Th k="attente" right title="Jours entre aujourd'hui et la prochaine dispo">Attente</Th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-[#F4F3F0] px-2 py-2 text-right font-bold" title="Quantité promettable à la date de prochaine dispo (CDF en cours) — au-delà, selon l'appro lancé">Qté à cette date</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-[#F4F3F0] px-2 py-2 text-left font-bold">Dispo par</th>
                  <Th k="stock_disponible" right title="Stock SAGE tous dépôts, réel − préparé">Stock dispo</Th>
                  <Th k="nb_cdc_periode_figee" right title="Commandes clients livrables dans la période figée">CDC pér. figée</Th>
                  {vue === 'appro' && (
                    <>
                      <Th k="fournisseur">Fournisseur</Th>
                      <Th k="delai_appro_jours" right title="Délai d'appro retenu (jours calendaires)">Délai</Th>
                      <Th k="besoin_periode_figee" right title="Quantité des CDC livrables dans la période figée">Besoin pér. figée</Th>
                      <Th k="manque_periode_figee" right title="Point bas négatif du stock projeté sur la période figée">Manque</Th>
                      <Th k="date_rupture" title="Premier jour de stock projeté négatif">Rupture</Th>
                      <Th k="receptions_total" right title="Quantité des CDF en cours">CDF en cours</Th>
                      <Th k="prochaine_reception_date">Prochaine réception</Th>
                      <Th k="cause">Cause</Th>
                    </>
                  )}
                  {vue === 'commerce' && <Th k="prochaine_reception_date">Prochaine réception</Th>}
                </tr>
              </thead>
              <tbody>
                {filtres.slice(0, nbAffichees).map((r) => {
                  const att = r.date_prochaine_dispo ? joursEntre(auj, r.date_prochaine_dispo) : null
                  return (
                    <tr key={r.reference_article} onClick={() => setUrl({ ref: r.reference_article })} className="cursor-pointer border-t border-[#F0EDE6] hover:bg-[#FAF8F3]">
                      <td className="whitespace-nowrap px-2 py-1.5 font-bold">
                        {r.reference_article}
                        {r.sommeil && <span className="ml-1 text-[10px] font-semibold text-[#8A8474]">sommeil</span>}
                      </td>
                      <td className="max-w-[320px] truncate px-2 py-1.5" title={r.designation || ''}>{r.designation}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-[#5E5A50]">{r.famille_macro}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-[13px] font-bold text-[#8A5A08]">{r.date_prochaine_dispo ? fmtDate(r.date_prochaine_dispo) : <span className="text-violet-800">Jamais</span>}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">{att !== null ? `J+${fmtNum(att)}` : '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">{r.qte_prochaine_dispo !== null ? fmtNum(r.qte_prochaine_dispo) : r.dispo_par === 'NOUVEL_APPRO' ? <span className="text-[#8A8474]">selon appro</span> : '—'}</td>
                      <td className="px-2 py-1.5">
                        <Badge cls={DISPO_STYLE[r.dispo_par].cls} title={DISPO_STYLE[r.dispo_par].title}>{DISPO_STYLE[r.dispo_par].label}</Badge>
                      </td>
                      <td className={`whitespace-nowrap px-2 py-1.5 text-right ${n0(r.stock_disponible) <= 0 ? 'text-red-700' : ''}`}>{fmtNum(r.stock_disponible)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">{r.nb_cdc_periode_figee > 0 ? fmtNum(r.nb_cdc_periode_figee) : <span className="text-[#C9C4B8]">0</span>}</td>
                      {vue === 'appro' && (
                        <>
                          <td className="max-w-[200px] truncate px-2 py-1.5" title={`${r.fournisseur_principal || ''} ${r.strategie_appro ? `· ${r.strategie_appro}` : ''}`}>{r.nom_fournisseur || r.fournisseur_principal || '—'}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right" title={DELAI_SOURCE[r.delai_source] || r.delai_source}>{fmtNum(r.delai_appro_jours)} j{r.delai_source === 'DEFAUT' ? '*' : ''}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right">{fmtNum(r.besoin_periode_figee)}</td>
                          <td className={`whitespace-nowrap px-2 py-1.5 text-right font-bold ${r.manque_periode_figee > 0 ? 'text-red-700' : 'text-[#C9C4B8]'}`}>{fmtNum(r.manque_periode_figee)}</td>
                          <td className="whitespace-nowrap px-2 py-1.5">{fmtDate(r.date_rupture)}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right">{r.nb_cdf > 0 ? <span title={r.numeros_cdf || ''}>{fmtNum(r.receptions_total)} <span className="text-[10.5px] text-[#8A8474]">({r.nb_cdf})</span></span> : <span className="text-[#C9C4B8]">0</span>}</td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {r.prochaine_reception_date ? <>{fmtDate(r.prochaine_reception_date)} <span className="text-[10.5px] text-[#8A8474]">· {fmtNum(r.prochaine_reception_qte)}</span></> : '—'}
                            {r.cdf_en_retard && <span className="ml-1 text-[10px] font-bold text-amber-800" title="CDF en retard ou sans date : supposée reçue demain">⚠</span>}
                          </td>
                          <td className="px-2 py-1.5"><Badge cls={CAUSE_STYLE[r.cause].cls} title={CAUSE_STYLE[r.cause].title}>{CAUSE_STYLE[r.cause].label}</Badge></td>
                        </>
                      )}
                      {vue === 'commerce' && (
                        <td className="whitespace-nowrap px-2 py-1.5">{r.prochaine_reception_date ? <>{fmtDate(r.prochaine_reception_date)} <span className="text-[10.5px] text-[#8A8474]">· {fmtNum(r.prochaine_reception_qte)}</span></> : '—'}</td>
                      )}
                    </tr>
                  )
                })}
                {!loading && filtres.length === 0 && (
                  <tr><td colSpan={vue === 'appro' ? 17 : 10} className="px-4 py-10 text-center text-[#8A8474]">{rows.length === 0 && !erreur ? 'Aucune référence en pénurie.' : 'Aucune référence avec ces filtres.'}</td></tr>
                )}
                {loading && <tr><td colSpan={vue === 'appro' ? 17 : 10} className="px-4 py-10 text-center text-[#8A8474]">Calcul en cours…</td></tr>}
              </tbody>
            </table>
          </div>
          {filtres.length > nbAffichees && (
            <div className="border-t border-[#E5E1D8] px-3 py-2 text-center">
              <button type="button" onClick={() => setNbAffichees((n) => n + 300)} className="text-[12px] font-bold text-[#B4761A] hover:underline">Afficher 300 de plus ({fmtNum(filtres.length - nbAffichees)} restantes)</button>
            </div>
          )}
        </section>
        {vue === 'appro' && <p className="px-1 text-[10.5px] text-[#8A8474]">* délai par défaut (aucun délai renseigné sur la référence ni sur le fournisseur).</p>}
      </div>

      {ligneOuverte && (
        <ArticleModal key={ligneOuverte.reference_article} ligne={ligneOuverte}
          position={indexOuvert >= 0 ? `${indexOuvert + 1} / ${filtres.length}` : null}
          onPrev={indexOuvert > 0 ? () => setUrl({ ref: filtres[indexOuvert - 1].reference_article }) : undefined}
          onNext={indexOuvert >= 0 && indexOuvert < filtres.length - 1 ? () => setUrl({ ref: filtres[indexOuvert + 1].reference_article }) : undefined}
          onClose={() => setUrl({ ref: null })} />
      )}
    </main>
  )
}

export default function ReferencesPenuriePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>}>
      <ReferencesPenurie />
    </Suspense>
  )
}
