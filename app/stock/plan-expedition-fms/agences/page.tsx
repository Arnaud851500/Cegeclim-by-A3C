'use client'

/**
 * Plan d'expédition FMS — vue « frise » par agence (/stock/plan-expedition-fms/agences).
 * ---------------------------------------------------------------------------
 * Créé le 05/11/2026 à la demande d'Arnaud : un écran léger par agence, pour y voir clair
 * et décider des départs.
 *
 *  - Agence = agence du commercial rattaché à la commande.
 *  - Les commandes sont rangées par DÉPÔT DE DÉPART : d'abord les dépôts agence (palette
 *    préparée en agence), puis FMS (autre couleur). Une ligne par client, ▸ pour voir ses
 *    commandes.
 *  - Frise chronologique : une pastille sous la date de livraison attendue (client = regroupement
 *    des commandes de même date ; commande quand on déplie le client). Chaque pastille donne
 *    groupes extérieurs (GE), unités intérieures (UI), palettes, R/O · R/R…, une ★ quand il manque
 *    de la marchandise à cette date, 🚚 quand une commande départ agence a besoin de stock FMS.
 *    Une pastille en pointillés (reliée par des pointillés) montre la date où la commande sera complète.
 *  - Glisser-déposer une pastille : vers une autre date (nouvelle date de livraison) et/ou vers un
 *    autre dépôt (changement de dépôt de départ). ✂ Scinder : envoi 1 du dispo (depuis l'agence ou
 *    FMS), envoi 2 du reliquat à complétude.
 *  - Ces décisions ne modifient pas SAGE : elles sont enregistrées (appro_plan_exp_actions), simulées
 *    dans la frise et listées « à reporter dans SAGE » jusqu'à ce qu'on les marque reportées.
 *
 * Données : calcul matérialisé du plan d'expédition FMS (refresh_plan_expedition_fms) lu par
 * get_plan_exp_agences / get_plan_exp_agence. Migration : supabase/sql/20261105_plan_expedition_fms_vue_agence.sql.
 * Accès : réservé à Arnaud (page + plan_exp_autorise() côté base).
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'

const COMPTES_AUTORISES = ['a.valanchauskas@cegeclim-energies.com', 'valancha@gmail.com']
const VOL_PALETTE = 1.3          // m³ utiles par palette (repère : 18 murales RAK-VJ18)
const LARGEUR_GAUCHE = 290       // colonne client
const LARGEUR_RETARD = 120       // colonne « en retard »
const LARGEUR_PLUS_TARD = 120    // colonne « plus tard »

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type Ligne = {
  id: string; doc: string; tiers: string | null; client: string | null; rep: string | null
  depot: string; liv: string | null; crea: string | null
  ref: string; des: string | null; fam: string | null; macro: string | null; role: string | null
  qte: number; mt: number | null; q_ag: number; q_fms: number; q_att: number
  cdf: string | null; cont: string | null; dispo: string | null; sim: boolean; sans_rec: boolean
  vol: number | null; p_d: number; p_a: number; statut: string
}
type Action = {
  id: number; type_action: 'DEPOT' | 'DATE' | 'SPLIT'; numero_document: string; numero_tiers: string | null; nom_tiers: string | null
  agence: string | null; depot_avant: string | null; depot_apres: string | null; date_avant: string | null; date_apres: string | null
  split_depot: string | null; split_date_1: string | null; split_date_2: string | null; commentaire: string | null
  statut: string; created_at: string; created_by: string | null
}
type Meta = { genere_le: string; debut: string; fin_horizon: string; simuler_rdv: boolean; parametres: { horizon_jours: number } }
type AgenceResume = {
  agence: string; nb_clients: number; nb_cdc: number; nb_cdc_fms: number; nb_cdc_depot: number
  nb_cdc_incompletes: number; nb_ge: number; palettes: number; nb_actions: number
}
type Metriques = { ge: number; ui: number; pal: number; macros: string[]; lignes: number }

/** Une commande (CDC × dépôt d'origine) avec ses valeurs effectives (après décisions). */
type Commande = {
  cle: string; doc: string; tiers: string; client: string; rep: string | null
  depotOrigine: string; depot: string; livOrigine: string | null; liv: string | null
  lignes: Ligne[]
  complete: string | null          // date de complétude (aujourd'hui si complet)
  completeInconnue: boolean
  manque: boolean                  // il manque de la marchandise à la date de livraison
  transfert: boolean               // départ agence mais besoin de stock FMS
  splitInteressant: boolean
  split: Action | null
  modifDepot: Action | null
  modifDate: Action | null
  tout: Metriques; dispo: Metriques; reliquat: Metriques
  montant: number
}

// ─────────────────────────────────────────────────────────────────────────
// Dates & formats
// ─────────────────────────────────────────────────────────────────────────

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function versDate(s: string): Date { return new Date(`${s}T12:00:00`) }
function ajoute(s: string, n: number): string { const d = versDate(s); d.setDate(d.getDate() + n); return iso(d) }
function ecart(a: string, b: string): number { return Math.round((versDate(b).getTime() - versDate(a).getTime()) / 86400000) }
function jourOuvreSuivant(s: string): string {
  let d = ajoute(s, 1)
  while ([0, 6].includes(versDate(d).getDay())) d = ajoute(d, 1)
  return d
}
function fmtJ(s: string | null | undefined): string {
  if (!s) return '—'
  return versDate(s).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}
function fmtD(s: string | null | undefined): string { return s ? versDate(s).toLocaleDateString('fr-FR') : '—' }
function fmtN(v: number, dec = 0): string { return Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) }
function messageErreur(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') { const o = e as { message?: string; details?: string }; return [o.message, o.details].filter(Boolean).join(' — ') || JSON.stringify(e) }
  return String(e)
}
function libDepot(d: string): string { return d === 'FMS' ? 'FMS' : d.replace(/\s*CEGECLIM\s*$/i, '').trim() }

// ─────────────────────────────────────────────────────────────────────────
// Modèle
// ─────────────────────────────────────────────────────────────────────────

const estUI = (l: Ligne) => /UI$/i.test(l.fam || '')
const MACROS_AFFICHEES = ['R/O', 'R/R', 'DRV', 'ECS', 'PV']
const COULEUR_MACRO: Record<string, string> = { 'R/O': '#1D5C86', 'R/R': '#2F7D5B', DRV: '#7A5EA8', ECS: '#B4761A', PV: '#C1683C' }

function metriques(lignes: Ligne[], qte: (l: Ligne) => number): Metriques {
  const m: Metriques = { ge: 0, ui: 0, pal: 0, macros: [], lignes: 0 }
  const mac = new Map<string, number>()
  for (const l of lignes) {
    const q = qte(l)
    if (q <= 0) continue
    m.lignes += 1
    if (l.role === 'GROUPE_EXT') m.ge += q
    if (estUI(l)) m.ui += q
    m.pal += ((l.vol || 0) * q) / VOL_PALETTE
    if (l.macro && MACROS_AFFICHEES.includes(l.macro)) mac.set(l.macro, (mac.get(l.macro) || 0) + q)
  }
  m.macros = Array.from(mac.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k)
  return m
}
function somme(ms: Metriques[]): Metriques {
  const r: Metriques = { ge: 0, ui: 0, pal: 0, macros: [], lignes: 0 }
  const mac = new Set<string>()
  ms.forEach((m) => { r.ge += m.ge; r.ui += m.ui; r.pal += m.pal; r.lignes += m.lignes; m.macros.forEach((x) => mac.add(x)) })
  r.macros = MACROS_AFFICHEES.filter((x) => mac.has(x))
  return r
}

function construireCommandes(lignes: Ligne[], actions: Action[], auj: string): Commande[] {
  const derniere = (doc: string, type: Action['type_action']) => {
    const l = actions.filter((a) => a.numero_document === doc && a.type_action === type)
    return l.length ? l[l.length - 1] : null
  }
  const m = new Map<string, Ligne[]>()
  for (const l of lignes) {
    const k = `${l.doc}|${l.depot}`
    const a = m.get(k); if (a) a.push(l); else m.set(k, [l])
  }
  const res: Commande[] = []
  m.forEach((ls, cle) => {
    const l0 = ls[0]
    const livs = ls.map((l) => l.liv).filter(Boolean) as string[]
    const livOrigine = livs.length ? livs.sort()[0] : null
    const modifDepot = derniere(l0.doc, 'DEPOT'); const modifDate = derniere(l0.doc, 'DATE'); const split = derniere(l0.doc, 'SPLIT')
    const depot = modifDepot?.depot_apres || l0.depot
    const liv = modifDate?.date_apres || livOrigine
    const attente = ls.filter((l) => l.q_att > 0)
    const inconnue = attente.some((l) => !l.dispo || l.sans_rec)
    const complete = attente.length === 0 ? auj : inconnue ? null : attente.map((l) => l.dispo as string).sort().slice(-1)[0]
    // Une commande basculée sur FMS n'a plus de stock agence : ce qui venait de l'agence doit venir de FMS
    const versFms = depot === 'FMS' && l0.depot !== 'FMS'
    const qDispo = (l: Ligne) => (versFms ? l.q_fms : l.q_ag + l.q_fms)
    const tout = metriques(ls, (l) => l.qte)
    const dispo = metriques(ls, qDispo)
    const reliquat = metriques(ls, (l) => l.qte - qDispo(l))
    const manque = attente.length > 0 && (inconnue || (!!liv && !!complete && complete > liv))
    res.push({
      cle, doc: l0.doc, tiers: l0.tiers || '?', client: l0.client || l0.tiers || '?', rep: l0.rep,
      depotOrigine: l0.depot, depot, livOrigine, liv, lignes: ls,
      complete, completeInconnue: attente.length > 0 && inconnue, manque,
      transfert: depot !== 'FMS' && ls.some((l) => l.q_fms > 0 || l.q_att > 0),
      splitInteressant: attente.length > 0 && dispo.lignes > 0 && (dispo.ge > 0 || dispo.pal >= 1),
      split, modifDepot, modifDate, tout, dispo, reliquat,
      montant: ls.reduce((s, l) => s + (l.mt || 0), 0),
    })
  })
  return res
}

// ─────────────────────────────────────────────────────────────────────────
// Échelle de la frise
// ─────────────────────────────────────────────────────────────────────────

type Echelle = { debut: string; fin: string; px: number; largeur: number; x: (d: string | null) => number; dateDepuisX: (x: number) => string | null }

function echelle(auj: string, fin: string, px: number): Echelle {
  const nbJours = Math.max(ecart(auj, fin), 1) + 1
  const largeur = LARGEUR_RETARD + nbJours * px + LARGEUR_PLUS_TARD
  const x = (d: string | null) => {
    if (!d) return largeur - LARGEUR_PLUS_TARD / 2
    if (d < auj) return LARGEUR_RETARD / 2
    if (d > fin) return largeur - LARGEUR_PLUS_TARD / 2
    return LARGEUR_RETARD + ecart(auj, d) * px + px / 2
  }
  const dateDepuisX = (xx: number) => {
    if (xx < LARGEUR_RETARD) return null
    const j = Math.floor((xx - LARGEUR_RETARD) / px)
    if (j >= nbJours) return null
    return ajoute(auj, j)
  }
  return { debut: auj, fin, px, largeur, x, dateDepuisX }
}

// ─────────────────────────────────────────────────────────────────────────
// Pastille
// ─────────────────────────────────────────────────────────────────────────

type Glisse = { docs: string[]; depot: string; libelle: string }

function Pastille({ m, titre, manque, transfert, fantome, split, couleur, onDragStart, petit }: {
  m: Metriques; titre: string; manque?: boolean; transfert?: boolean; fantome?: boolean; split?: 1 | 2
  couleur: string; onDragStart?: (e: React.DragEvent) => void; petit?: boolean
}) {
  const macro = m.macros[0]
  return (
    <div
      draggable={!!onDragStart && !fantome}
      onDragStart={onDragStart}
      title={titre}
      className={`relative select-none whitespace-nowrap rounded-full px-2 py-[3px] leading-[1.05] shadow-sm transition-transform hover:z-20 hover:scale-110
        ${fantome ? 'border-2 border-dashed bg-white/80 opacity-80' : 'border bg-white'} ${onDragStart && !fantome ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{ borderColor: fantome ? '#8A8474' : couleur, fontSize: petit ? 9.5 : 10.5 }}
    >
      {manque && !fantome && <span className="absolute -right-1.5 -top-2 text-[13px] text-[#C1683C]" title="Il manque de la marchandise à cette date">★</span>}
      {transfert && !fantome && <span className="absolute -left-2 -top-2 text-[11px]" title="Départ agence : besoin de stock FMS (transfert)">🚚</span>}
      {split && <span className="mr-1 rounded bg-[#111820] px-1 text-[8.5px] font-bold text-white">{split === 1 ? 'Env. 1' : 'Env. 2'}</span>}
      <span className="font-bold text-[#111820]">{m.ge > 0 ? `${fmtN(m.ge)} GE` : ''}{m.ge > 0 && m.ui > 0 ? ' · ' : ''}{m.ui > 0 ? `${fmtN(m.ui)} UI` : ''}{m.ge === 0 && m.ui === 0 ? `${m.lignes} l.` : ''}</span>
      <span className="ml-1 text-[#5E5A44]">{fmtN(m.pal, m.pal < 10 ? 1 : 0)} p</span>
      {macro && <span className="ml-1 rounded px-1 text-[8.5px] font-bold text-white" style={{ background: COULEUR_MACRO[macro] || '#8A8474' }}>{m.macros.slice(0, 2).join('+')}</span>}
    </div>
  )
}

/** Pastille (+ pointillés jusqu'à la date de complétude, ou deux envois si scindé) placée sur la frise. */
function Jalon({ e, liv, complete, completeInconnue, m, mDispo, mReliquat, split, manque, transfert, titre, couleur, glisse, onDragStart, petit }: {
  e: Echelle; liv: string | null; complete: string | null; completeInconnue: boolean
  m: Metriques; mDispo: Metriques; mReliquat: Metriques; split: Action | null
  manque: boolean; transfert: boolean; titre: string; couleur: string; glisse: Glisse; onDragStart: (g: Glisse, e: React.DragEvent) => void; petit?: boolean
}) {
  const drag = (ev: React.DragEvent) => onDragStart(glisse, ev)
  if (split?.split_date_1) {
    const x1 = e.x(split.split_date_1); const x2 = e.x(split.split_date_2)
    return (
      <>
        <div className="pointer-events-none absolute top-1/2 h-0 border-t-2 border-dotted border-[#8A8474]" style={{ left: Math.min(x1, x2), width: Math.abs(x2 - x1) }} />
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: x1 }}>
          <Pastille m={mDispo} split={1} couleur={couleur} titre={`${titre}\nEnvoi 1 (dispo) le ${fmtD(split.split_date_1)} depuis ${libDepot(split.split_depot || '')}`} onDragStart={drag} petit={petit} />
        </div>
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: x2 }}>
          <Pastille m={mReliquat} split={2} fantome couleur={couleur} titre={`Envoi 2 (reliquat) le ${fmtD(split.split_date_2)}`} petit={petit} />
        </div>
      </>
    )
  }
  const x = e.x(liv)
  const montrerComplete = manque && (completeInconnue || (complete && liv && complete > liv))
  const xc = completeInconnue ? e.largeur - LARGEUR_PLUS_TARD / 2 : e.x(complete)
  return (
    <>
      {montrerComplete && (
        <>
          <div className="pointer-events-none absolute top-1/2 h-0 border-t-2 border-dotted border-[#C1683C]/70" style={{ left: x, width: Math.max(xc - x, 0) }} />
          <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: xc }}>
            <div title={completeInconnue ? 'Date de complétude inconnue (RDV container à saisir ou aucune commande fournisseur)' : `Complète le ${fmtD(complete)}`}
              className="whitespace-nowrap rounded-full border-2 border-dashed border-[#C1683C]/70 bg-white/80 px-2 py-[2px] text-[10px] font-bold text-[#8A3F1E]">
              {completeInconnue ? 'complète ?' : `complète ${fmtJ(complete)}`}
            </div>
          </div>
        </>
      )}
      <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: x }}>
        <Pastille m={m} manque={manque} transfert={transfert} couleur={couleur} titre={titre} onDragStart={drag} petit={petit} />
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Fenêtres : confirmation d'un déplacement, scission
// ─────────────────────────────────────────────────────────────────────────

type Deplacement = { glisse: Glisse; depot: string; date: string | null }

function FenetreDeplacement({ d, commandes, onAnnule, onValide }: {
  d: Deplacement; commandes: Commande[]; onAnnule: () => void; onValide: (comm: string) => Promise<void>
}) {
  const [comm, setComm] = useState('')
  const [saving, setSaving] = useState(false)
  const cmds = commandes.filter((c) => d.glisse.docs.includes(c.doc))
  const changeDepot = d.depot !== d.glisse.depot
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onAnnule}>
      <div className="w-full max-w-[560px] rounded-xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-[16px] font-bold">Déplacer {d.glisse.libelle}</div>
        <ul className="mt-2 space-y-1 text-[13px]">
          {changeDepot && <li>📦 Dépôt de départ : <b>{libDepot(d.glisse.depot)}</b> → <b className="text-[#5B4385]">{libDepot(d.depot)}</b></li>}
          {d.date && <li>📅 Nouvelle date de livraison : <b className="text-[#5B4385]">{fmtD(d.date)}</b></li>}
        </ul>
        <div className="mt-2 max-h-[160px] overflow-auto rounded border border-[#E5E1D8] text-[12px]">
          {cmds.map((c) => (
            <div key={c.cle} className="flex justify-between border-b border-[#F0EDE6] px-2 py-1 last:border-0">
              <span><b>{c.doc}</b> · {c.client}</span>
              <span className="text-[#8A8474]">liv. {fmtD(c.liv)}{c.complete && c.manque ? ` · complète ${fmtD(c.complete)}` : ''}</span>
            </div>
          ))}
        </div>
        {d.date && cmds.some((c) => c.manque && c.complete && d.date! < c.complete) && (
          <div className="mt-2 rounded bg-[#C1683C]/10 px-2 py-1 text-[12px] font-semibold text-[#8A3F1E]">★ Attention : à cette date, au moins une commande ne sera pas encore complète.</div>
        )}
        <textarea value={comm} onChange={(e) => setComm(e.target.value)} placeholder="Commentaire (facultatif) : motif, accord client…" className="mt-3 h-16 w-full rounded border border-[#E5E1D8] p-2 text-[12.5px]" />
        <p className="mt-1 text-[11px] text-[#8A8474]">Rien n’est modifié dans SAGE : la décision est simulée ici et ajoutée à la liste « à reporter dans SAGE ».</p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onAnnule} className="h-9 rounded-lg border border-[#E5E1D8] px-3 text-[13px] font-bold">Annuler</button>
          <button type="button" disabled={saving} onClick={async () => { setSaving(true); await onValide(comm); setSaving(false) }} className="h-9 rounded-lg bg-[#7A5EA8] px-4 text-[13px] font-bold text-white disabled:opacity-50">
            {saving ? '…' : 'Valider'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FenetreSplit({ cmds, depotAgence, auj, onAnnule, onValide }: {
  cmds: Commande[]; depotAgence: string | null; auj: string; onAnnule: () => void
  onValide: (p: { depot: string; d1: string; d2: string; comm: string; docs: string[] }) => Promise<void>
}) {
  const candidates = cmds.filter((c) => c.reliquat.lignes > 0 && c.dispo.lignes > 0)
  const complete = candidates.map((c) => c.complete).filter(Boolean).sort().slice(-1)[0] || ajoute(auj, 21)
  const depots = Array.from(new Set(['FMS', ...(depotAgence ? [depotAgence] : []), ...cmds.map((c) => c.depot)]))
  const [depot, setDepot] = useState(cmds[0]?.depot || 'FMS')
  const [d1, setD1] = useState(jourOuvreSuivant(auj))
  const [d2, setD2] = useState(complete)
  const [docs, setDocs] = useState<string[]>(candidates.map((c) => c.doc))
  const [comm, setComm] = useState('')
  const [saving, setSaving] = useState(false)
  const sel = candidates.filter((c) => docs.includes(c.doc))
  const m1 = somme(sel.map((c) => c.dispo)); const m2 = somme(sel.map((c) => c.reliquat))
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onAnnule}>
      <div className="w-full max-w-[640px] rounded-xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-[16px] font-bold">✂ Scinder l’expédition — {cmds[0]?.client}</div>
        {candidates.length === 0 ? <p className="mt-2 text-[13px] text-[#5E5A44]">Rien à scinder : ces commandes sont soit complètes, soit sans aucun article dispo.</p> : (
          <>
            <div className="mt-2 max-h-[150px] overflow-auto rounded border border-[#E5E1D8] text-[12px]">
              {candidates.map((c) => (
                <label key={c.cle} className="flex items-center gap-2 border-b border-[#F0EDE6] px-2 py-1 last:border-0">
                  <input type="checkbox" checked={docs.includes(c.doc)} onChange={(e) => setDocs((v) => (e.target.checked ? [...v, c.doc] : v.filter((x) => x !== c.doc)))} />
                  <b>{c.doc}</b> <span className="text-[#8A8474]">liv. {fmtD(c.liv)} · dispo {fmtN(c.dispo.ge)} GE / {fmtN(c.dispo.pal, 1)} p · reliquat {fmtN(c.reliquat.ge)} GE / {fmtN(c.reliquat.pal, 1)} p</span>
                </label>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-[12.5px]">
              <div className="rounded-lg border border-[#7A5EA8]/40 bg-[#7A5EA8]/[0.05] p-2">
                <div className="font-bold">Envoi 1 — le dispo</div>
                <div className="mt-1 text-[#5E5A44]">{fmtN(m1.ge)} GE · {fmtN(m1.ui)} UI · {fmtN(m1.pal, 1)} palettes</div>
                <label className="mt-2 block">Départ
                  <select value={depot} onChange={(e) => setDepot(e.target.value)} className="ml-2 h-7 rounded border border-[#E5E1D8] px-1">
                    {depots.map((d) => <option key={d} value={d}>{libDepot(d)}</option>)}
                  </select>
                </label>
                <label className="mt-1 block">Le <input type="date" value={d1} onChange={(e) => setD1(e.target.value)} className="ml-2 h-7 rounded border border-[#E5E1D8] px-1" /></label>
              </div>
              <div className="rounded-lg border border-dashed border-[#8A8474] p-2">
                <div className="font-bold">Envoi 2 — le reliquat</div>
                <div className="mt-1 text-[#5E5A44]">{fmtN(m2.ge)} GE · {fmtN(m2.ui)} UI · {fmtN(m2.pal, 1)} palettes</div>
                <label className="mt-2 block">À complétude, le <input type="date" value={d2} onChange={(e) => setD2(e.target.value)} className="ml-2 h-7 rounded border border-[#E5E1D8] px-1" /></label>
                <p className="mt-1 text-[11px] text-[#8A8474]">Date de complétude estimée : {fmtD(complete)}</p>
              </div>
            </div>
            <textarea value={comm} onChange={(e) => setComm(e.target.value)} placeholder="Commentaire (facultatif)" className="mt-3 h-14 w-full rounded border border-[#E5E1D8] p-2 text-[12.5px]" />
          </>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onAnnule} className="h-9 rounded-lg border border-[#E5E1D8] px-3 text-[13px] font-bold">Annuler</button>
          {candidates.length > 0 && (
            <button type="button" disabled={saving || docs.length === 0 || !d1 || !d2} onClick={async () => { setSaving(true); await onValide({ depot, d1, d2, comm, docs }); setSaving(false) }} className="h-9 rounded-lg bg-[#7A5EA8] px-4 text-[13px] font-bold text-white disabled:opacity-50">
              {saving ? '…' : `Scinder ${docs.length} commande(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Choix de l'agence (tuiles)
// ─────────────────────────────────────────────────────────────────────────

function ChoixAgence({ agences, onChoix }: { agences: AgenceResume[]; onChoix: (a: string) => void }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
      {agences.slice().sort((a, b) => b.nb_cdc - a.nb_cdc).map((a) => (
        <button key={a.agence} type="button" onClick={() => onChoix(a.agence)}
          className="group rounded-2xl border border-[#E5E1D8] bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#7A5EA8] hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-[17px] font-bold tracking-tight">{a.agence}</span>
            {a.nb_actions > 0 && <span className="rounded-full bg-[#7A5EA8] px-2 py-0.5 text-[10.5px] font-bold text-white" title="Modifications à reporter dans SAGE">{a.nb_actions} à reporter</span>}
          </div>
          <div className="mt-1 text-[12px] text-[#5E5A44]">{a.nb_clients} clients · {a.nb_cdc} CDC</div>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-[#F4F3F0]" title={`${a.nb_cdc_depot} CDC départ dépôt agence · ${a.nb_cdc_fms} CDC départ FMS`}>
            <div className="bg-[#A6A181]" style={{ width: `${(a.nb_cdc_depot / Math.max(a.nb_cdc, 1)) * 100}%` }} />
            <div className="bg-[#7A5EA8]" style={{ width: `${(a.nb_cdc_fms / Math.max(a.nb_cdc, 1)) * 100}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[10.5px] text-[#8A8474]"><span>dépôt agence {a.nb_cdc_depot}</span><span>FMS {a.nb_cdc_fms}</span></div>
          <div className="mt-3 flex gap-3 text-[12px]">
            <span><b>{fmtN(a.nb_ge)}</b> GE</span>
            <span><b>{fmtN(a.palettes)}</b> pal.</span>
            <span className="text-[#8A3F1E]" title="CDC dont au moins une ligne attend une réception fournisseur"><b>{a.nb_cdc_incompletes}</b> CDC en attente</span>
          </div>
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

function VueAgence() {
  const { loading: accessLoading, email } = useAccess()
  const autorise = COMPTES_AUTORISES.includes((email || '').trim().toLowerCase())
  const router = useRouter()
  const params = useSearchParams()
  const agence = params.get('agence') || ''
  const auj = iso(new Date())

  const [agences, setAgences] = useState<AgenceResume[] | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [lignes, setLignes] = useState<Ligne[] | null>(null)
  const [actions, setActions] = useState<Action[]>([])
  const [erreur, setErreur] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [calcul, setCalcul] = useState(false)
  const [horizon, setHorizon] = useState(21)

  const [px, setPx] = useState(30)
  const [ouverts, setOuverts] = useState<Set<string>>(new Set())
  const [replies, setReplies] = useState<Set<string>>(new Set())
  const [filtre, setFiltre] = useState<'tous' | 'manque' | 'split' | 'modifs'>('tous')
  const [recherche, setRecherche] = useState('')
  const [deplacement, setDeplacement] = useState<Deplacement | null>(null)
  const [splitCmds, setSplitCmds] = useState<Commande[] | null>(null)
  const [panneau, setPanneau] = useState(false)
  const [survol, setSurvol] = useState<{ depot: string; date: string | null } | null>(null)
  const glisseRef = useRef<Glisse | null>(null)

  const chargerAgences = useCallback(async () => {
    setLoading(true); setErreur(null)
    const { data, error } = await supabase.rpc('get_plan_exp_agences')
    setLoading(false)
    if (error) { setErreur(messageErreur(error)); return }
    const d = data as { meta: Meta | null; agences: AgenceResume[] }
    setAgences(d.agences); setMeta(d.meta)
    if (d.meta) setHorizon(d.meta.parametres.horizon_jours)
  }, [])

  const chargerAgence = useCallback(async (a: string) => {
    setLoading(true); setErreur(null)
    const { data, error } = await supabase.rpc('get_plan_exp_agence', { p_agence: a })
    setLoading(false)
    if (error) { setErreur(messageErreur(error)); return }
    const d = data as { meta: Meta | null; lignes: Ligne[]; actions: Action[] }
    setLignes(d.lignes); setActions(d.actions); setMeta(d.meta)
    if (d.meta) setHorizon(d.meta.parametres.horizon_jours)
  }, [])

  useEffect(() => {
    if (accessLoading || !autorise) return
    const t = window.setTimeout(() => { if (agence) void chargerAgence(agence); else void chargerAgences() }, 0)
    return () => window.clearTimeout(t)
  }, [accessLoading, autorise, agence, chargerAgence, chargerAgences])

  async function recalculer() {
    setCalcul(true); setErreur(null)
    const { error } = await supabase.rpc('refresh_plan_expedition_fms', { p_debut: null, p_horizon_jours: horizon, p_simuler_rdv: meta?.simuler_rdv ?? true })
    setCalcul(false)
    if (error) { setErreur(messageErreur(error)); return }
    if (agence) await chargerAgence(agence); else await chargerAgences()
  }

  const commandes = useMemo(() => (lignes ? construireCommandes(lignes, actions, auj) : []), [lignes, actions, auj])

  const depotAgence = useMemo(() => {
    // dépôt « maison » de l'agence : celui qui porte le plus de commandes hors FMS
    const n = new Map<string, number>()
    commandes.filter((c) => c.depotOrigine !== 'FMS').forEach((c) => n.set(c.depotOrigine, (n.get(c.depotOrigine) || 0) + 1))
    return Array.from(n.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  }, [commandes])

  const filtrees = useMemo(() => {
    const q = recherche.trim().toUpperCase()
    return commandes.filter((c) => {
      if (filtre === 'manque' && !c.manque) return false
      if (filtre === 'split' && !(c.splitInteressant || c.split)) return false
      if (filtre === 'modifs' && !(c.split || c.modifDate || c.modifDepot)) return false
      if (q && !`${c.client} ${c.tiers} ${c.doc} ${c.rep || ''}`.toUpperCase().includes(q)) return false
      return true
    })
  }, [commandes, filtre, recherche])

  /** Sections par dépôt : dépôts agence d'abord, FMS en dernier. */
  const sections = useMemo(() => {
    const m = new Map<string, Map<string, Commande[]>>()
    for (const c of filtrees) {
      const s = m.get(c.depot) || new Map<string, Commande[]>()
      const l = s.get(c.tiers); if (l) l.push(c); else s.set(c.tiers, [c])
      m.set(c.depot, s)
    }
    const ordre = Array.from(m.keys()).sort((a, b) => {
      if (a === 'FMS') return 1; if (b === 'FMS') return -1
      if (a === depotAgence) return -1; if (b === depotAgence) return 1
      return a.localeCompare(b)
    })
    if (!ordre.includes('FMS') && commandes.length) ordre.push('FMS')
    if (depotAgence && !ordre.includes(depotAgence)) ordre.unshift(depotAgence)
    return ordre.map((depot) => {
      const clients = Array.from((m.get(depot) || new Map<string, Commande[]>()).entries()).map(([tiers, cmds]) => ({
        tiers, client: cmds[0].client, cmds: cmds.sort((a, b) => String(a.liv).localeCompare(String(b.liv))),
        premiere: cmds.map((c) => c.split?.split_date_1 || c.liv || '9999').sort()[0],
      })).sort((a, b) => a.premiere.localeCompare(b.premiere) || a.client.localeCompare(b.client))
      return { depot, clients }
    })
  }, [filtrees, depotAgence, commandes.length])

  const fin = useMemo(() => {
    let f = ajoute(auj, 35)
    for (const c of commandes) {
      for (const d of [c.liv, c.complete, c.split?.split_date_2]) if (d && d > f) f = d
    }
    const max = ajoute(auj, 120)
    return f > max ? max : ajoute(f, 3)
  }, [commandes, auj])
  const e = useMemo(() => echelle(auj, fin, px), [auj, fin, px])

  const jours = useMemo(() => {
    const r: string[] = []
    for (let d = auj; d <= fin; d = ajoute(d, 1)) r.push(d)
    return r
  }, [auj, fin])

  // ── Glisser-déposer ────────────────────────────────────────────────────
  const debutGlisse = (g: Glisse, ev: React.DragEvent) => {
    glisseRef.current = g
    ev.dataTransfer.effectAllowed = 'move'
    try { ev.dataTransfer.setData('text/plain', g.docs.join(',')) } catch { /* certains navigateurs refusent */ }
  }
  const dateSous = (ev: React.DragEvent, el: HTMLElement) => e.dateDepuisX(ev.clientX - el.getBoundingClientRect().left)
  const survolFrise = (depot: string) => (ev: React.DragEvent<HTMLDivElement>) => {
    if (!glisseRef.current) return
    ev.preventDefault()
    const date = dateSous(ev, ev.currentTarget)
    if (!survol || survol.depot !== depot || survol.date !== date) setSurvol({ depot, date })
  }
  const deposerFrise = (depot: string) => (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    const g = glisseRef.current; glisseRef.current = null; setSurvol(null)
    if (!g) return
    const date = dateSous(ev, ev.currentTarget)
    const cmds = commandes.filter((c) => g.docs.includes(c.doc))
    const memeDate = !date || cmds.every((c) => c.liv === date)
    if (depot === g.depot && memeDate) return
    setDeplacement({ glisse: g, depot, date: memeDate ? null : date })
  }
  const deposerEntete = (depot: string) => (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    const g = glisseRef.current; glisseRef.current = null; setSurvol(null)
    if (!g || depot === g.depot) return
    setDeplacement({ glisse: g, depot, date: null })
  }

  async function enregistrer(rows: Partial<Action>[]) {
    const { error } = await supabase.from('appro_plan_exp_actions').insert(rows)
    if (error) { setErreur(messageErreur(error)); return false }
    await chargerAgence(agence)
    return true
  }

  async function validerDeplacement(comm: string) {
    if (!deplacement) return
    const cmds = commandes.filter((c) => deplacement.glisse.docs.includes(c.doc))
    const docsVus = new Set<string>()
    const rows: Partial<Action>[] = []
    for (const c of cmds) {
      if (docsVus.has(c.doc)) continue
      docsVus.add(c.doc)
      const base = { numero_document: c.doc, numero_tiers: c.tiers, nom_tiers: c.client, agence, commentaire: comm || null }
      if (deplacement.depot !== c.depot) rows.push({ ...base, type_action: 'DEPOT', depot_avant: c.depot, depot_apres: deplacement.depot })
      if (deplacement.date && deplacement.date !== c.liv) rows.push({ ...base, type_action: 'DATE', date_avant: c.liv, date_apres: deplacement.date })
    }
    if (rows.length && (await enregistrer(rows))) setDeplacement(null)
    else if (!rows.length) setDeplacement(null)
  }

  async function validerSplit(p: { depot: string; d1: string; d2: string; comm: string; docs: string[] }) {
    const cmds = (splitCmds || []).filter((c) => p.docs.includes(c.doc))
    const rows: Partial<Action>[] = cmds.map((c) => ({
      type_action: 'SPLIT', numero_document: c.doc, numero_tiers: c.tiers, nom_tiers: c.client, agence,
      depot_avant: c.depot, split_depot: p.depot, date_avant: c.liv, split_date_1: p.d1, split_date_2: p.d2, commentaire: p.comm || null,
    }))
    if (await enregistrer(rows)) setSplitCmds(null)
  }

  async function traiter(a: Action, statut: 'REPORTE' | 'ANNULE') {
    const { error } = await supabase.from('appro_plan_exp_actions').update({ statut, traite_le: new Date().toISOString(), traite_par: email }).eq('id', a.id)
    if (error) { setErreur(messageErreur(error)); return }
    await chargerAgence(agence)
  }

  async function exporterActions() {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('À reporter dans SAGE')
    ws.addRow(['Type', 'CDC', 'N° tiers', 'Client', 'Agence', 'Avant', 'Après', 'Envoi 1 (dispo)', 'Départ envoi 1', 'Envoi 2 (reliquat)', 'Commentaire', 'Décidé le', 'Par']).font = { bold: true }
    actions.forEach((a) => ws.addRow([
      a.type_action === 'DEPOT' ? 'Changement de dépôt' : a.type_action === 'DATE' ? 'Nouvelle date de livraison' : 'Expédition scindée',
      a.numero_document, a.numero_tiers, a.nom_tiers, a.agence,
      a.type_action === 'DEPOT' ? libDepot(a.depot_avant || '') : fmtD(a.date_avant),
      a.type_action === 'DEPOT' ? libDepot(a.depot_apres || '') : a.type_action === 'DATE' ? fmtD(a.date_apres) : '',
      a.type_action === 'SPLIT' ? fmtD(a.split_date_1) : '', a.type_action === 'SPLIT' ? libDepot(a.split_depot || '') : '',
      a.type_action === 'SPLIT' ? fmtD(a.split_date_2) : '', a.commentaire || '', new Date(a.created_at).toLocaleString('fr-FR'), a.created_by || '',
    ]))
    ws.columns.forEach((c, i) => { c.width = [24, 12, 10, 30, 12, 14, 14, 14, 14, 14, 40, 18, 28][i] })
    const buf = await wb.xlsx.writeBuffer()
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const lien = document.createElement('a'); lien.href = url; lien.download = `plan_expedition_${agence.toLowerCase()}_a_reporter_${auj}.xlsx`; lien.click(); URL.revokeObjectURL(url)
  }

  // ── Rendu ──────────────────────────────────────────────────────────────
  if (accessLoading) return <main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>
  if (!autorise) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F4F3F0] p-6 text-center">
        <div className="rounded-xl border border-[#E5E1D8] bg-white px-6 py-5">
          <div className="text-[17px] font-bold">Accès réservé</div>
          <p className="mt-1 text-[13px] text-[#5E5A44]">La vue agence du plan d’expédition est en préparation.</p>
        </div>
      </main>
    )
  }

  const choisir = (a: string | null) => router.replace(a ? `/stock/plan-expedition-fms/agences?agence=${encodeURIComponent(a)}` : '/stock/plan-expedition-fms/agences', { scroll: false })
  const nbManque = commandes.filter((c) => c.manque).length
  const nbSplit = commandes.filter((c) => c.splitInteressant && !c.split).length
  const nbModifs = commandes.filter((c) => c.split || c.modifDate || c.modifDepot).length

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}
      onDragEnd={() => { glisseRef.current = null; setSurvol(null) }}>
      <div className="mx-auto max-w-[1900px] space-y-2.5">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">
              <Link href="/stock/plan-expedition-fms" className="hover:underline">Plan d’expédition FMS</Link> · vue agence · accès réservé
            </p>
            <h1 className="flex items-center gap-2 text-[20px] font-bold leading-tight tracking-tight">
              {agence ? <><button type="button" onClick={() => choisir(null)} className="rounded-md border border-[#E5E1D8] px-2 text-[14px]" title="Toutes les agences">←</button> {agence}</> : 'Choisir une agence'}
            </h1>
            <p className="text-[11.5px] text-[#8A8474]">
              Agence = agence du commercial de la commande
              {meta && <> · calcul du {new Date(meta.genere_le).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · CDC à livrer jusqu’au {fmtD(meta.fin_horizon)}{meta.simuler_rdv ? ' · RDV containers manquants simulés' : ''}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[11.5px] font-semibold text-[#5E5A44]">CDC à livrer sous
              <select value={horizon} onChange={(ev) => setHorizon(Number(ev.target.value))} className="h-8 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold">
                {[14, 21, 30, 45, 60, 90].map((h) => <option key={h} value={h}>{h} j</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void recalculer()} disabled={calcul} className="h-9 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[12.5px] font-bold disabled:opacity-50">{calcul ? 'Calcul… (~15 s)' : '↻ Recalculer'}</button>
            {agence && (
              <>
                <label className="flex items-center gap-1 text-[11.5px] font-semibold text-[#5E5A44]">Zoom
                  <input type="range" min={14} max={60} value={px} onChange={(ev) => setPx(Number(ev.target.value))} />
                </label>
                <button type="button" onClick={() => setPanneau(true)} className="h-9 rounded-lg bg-[#7A5EA8] px-3 text-[12.5px] font-bold text-white">
                  À reporter dans SAGE ({actions.length})
                </button>
              </>
            )}
          </div>
        </section>

        {erreur && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-800">{erreur}{/does not exist|could not find/i.test(erreur) ? ' — la migration 20261105_plan_expedition_fms_vue_agence.sql est-elle appliquée ?' : ''}</div>}
        {loading && <div className="rounded-lg border border-[#E5E1D8] bg-white px-3 py-6 text-center text-[13px] text-[#8A8474]">Chargement…</div>}

        {!agence && agences && !loading && <ChoixAgence agences={agences} onChoix={choisir} />}

        {agence && lignes && !loading && (
          <>
            {/* Filtres & légende */}
            <section className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
              {([['tous', `Toutes (${commandes.length})`], ['manque', `★ Il manque (${nbManque})`], ['split', `✂ À scinder (${nbSplit})`], ['modifs', `Modifiées (${nbModifs})`]] as ['tous' | 'manque' | 'split' | 'modifs', string][]).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setFiltre(k)} className={`rounded-full px-3 py-1 text-[12px] font-bold ${filtre === k ? 'bg-[#111820] text-white' : 'bg-[#F4F3F0] text-[#5E5A44]'}`}>{l}</button>
              ))}
              <input value={recherche} onChange={(ev) => setRecherche(ev.target.value)} placeholder="Client, n° tiers, CDC, commercial…" className="h-8 w-[240px] rounded-md border border-[#E5E1D8] px-2 text-[12px]" />
              <span className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-[#5E5A44]">
                <span><b>GE</b> groupes ext. · <b>UI</b> unités int. · <b>p</b> palettes</span>
                <span className="text-[#C1683C]">★ manque à la date</span>
                <span>🚚 besoin de stock FMS</span>
                <span className="rounded-full border-2 border-dashed border-[#C1683C]/70 px-1.5">complète le</span>
                <span>glisser une pastille : date / dépôt</span>
              </span>
            </section>

            {/* Frise */}
            <section className="overflow-auto rounded-xl border border-[#E5E1D8] bg-white" style={{ maxHeight: 'calc(100vh - 230px)' }}>
              <div style={{ width: LARGEUR_GAUCHE + e.largeur }} className="relative">
                {/* En-tête des dates */}
                <div className="sticky top-0 z-30 flex border-b border-[#E5E1D8] bg-[#FAF9F6]">
                  <div className="sticky left-0 z-40 shrink-0 border-r border-[#E5E1D8] bg-[#FAF9F6] px-3 py-1 text-[10.5px] font-bold uppercase text-[#8A8474]" style={{ width: LARGEUR_GAUCHE }}>Client · commandes</div>
                  <div className="relative h-[38px]" style={{ width: e.largeur }}>
                    <div className="absolute inset-y-0 left-0 flex items-center justify-center border-r border-[#E5E1D8] bg-[#C1683C]/10 text-[10px] font-bold text-[#8A3F1E]" style={{ width: LARGEUR_RETARD }}>en retard</div>
                    {jours.map((d) => {
                      const dt = versDate(d); const we = [0, 6].includes(dt.getDay()); const lundi = dt.getDay() === 1
                      return (
                        <div key={d} className={`absolute inset-y-0 border-r ${lundi ? 'border-[#D8D3C7]' : 'border-[#F0EDE6]'} ${we ? 'bg-[#F0EDE6]' : ''} ${d === auj ? 'bg-[#7A5EA8]/15' : ''}`} style={{ left: e.x(d) - px / 2, width: px }}>
                          {(lundi || d === auj || dt.getDate() === 1) && <div className="absolute left-0.5 top-0.5 whitespace-nowrap text-[9.5px] font-bold text-[#5E5A44]">{dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</div>}
                          {px >= 22 && <div className="absolute bottom-0.5 w-full text-center text-[9px] text-[#8A8474]">{dt.toLocaleDateString('fr-FR', { weekday: 'narrow' })}{dt.getDate()}</div>}
                        </div>
                      )
                    })}
                    <div className="absolute inset-y-0 right-0 flex items-center justify-center border-l border-[#E5E1D8] text-[10px] font-bold text-[#8A8474]" style={{ width: LARGEUR_PLUS_TARD }}>plus tard / ?</div>
                  </div>
                </div>

                {sections.map(({ depot, clients }) => {
                  const fms = depot === 'FMS'
                  const couleur = fms ? '#7A5EA8' : '#8B8767'
                  const replie = replies.has(depot)
                  const nbCdc = clients.reduce((s, c) => s + c.cmds.length, 0)
                  const mSec = somme(clients.flatMap((c) => c.cmds.map((x) => x.tout)))
                  return (
                    <div key={depot}>
                      {/* En-tête de section (zone de dépôt : changer de dépôt) */}
                      <div onDragOver={(ev) => { if (glisseRef.current) { ev.preventDefault(); setSurvol({ depot, date: null }) } }} onDrop={deposerEntete(depot)}
                        className={`sticky top-[38px] z-20 flex items-center border-b border-t ${survol?.depot === depot && !survol.date ? 'ring-2 ring-inset ring-[#7A5EA8]' : ''}`}
                        style={{ background: fms ? '#EEE9F6' : '#EFEDE3', borderColor: couleur + '55' }}>
                        <button type="button" onClick={() => setReplies((s) => { const n = new Set(s); if (n.has(depot)) n.delete(depot); else n.add(depot); return n })}
                          className="sticky left-0 flex shrink-0 items-center gap-2 px-3 py-1.5 text-left" style={{ width: LARGEUR_GAUCHE, background: fms ? '#EEE9F6' : '#EFEDE3' }}>
                          <span className="text-[12px]">{replie ? '▸' : '▾'}</span>
                          <span className="text-[13px] font-bold" style={{ color: fms ? '#5B4385' : '#5E5A44' }}>{fms ? '🏭 Départ FMS' : `🏪 Départ dépôt ${libDepot(depot)}`}</span>
                        </button>
                        <span className="text-[11.5px] text-[#5E5A44]">{clients.length} client(s) · {nbCdc} CDC · {fmtN(mSec.ge)} GE · {fmtN(mSec.ui)} UI · {fmtN(mSec.pal)} pal.{survol ? ' — déposer ici pour changer de dépôt' : ''}</span>
                      </div>

                      {!replie && clients.length === 0 && <div className="px-3 py-2 text-[12px] text-[#8A8474]" style={{ marginLeft: 0 }}>Aucune commande — déposez ici une pastille pour basculer une commande sur ce dépôt.</div>}

                      {!replie && clients.map((cl) => {
                        const ouvert = ouverts.has(`${depot}|${cl.tiers}`)
                        const parDate = new Map<string, Commande[]>()
                        const scindees = cl.cmds.filter((c) => c.split)
                        cl.cmds.filter((c) => !c.split).forEach((c) => { const k = c.liv || ''; const l = parDate.get(k); if (l) l.push(c); else parDate.set(k, [c]) })
                        const interessant = cl.cmds.some((c) => c.splitInteressant && !c.split)
                        const modif = cl.cmds.some((c) => c.split || c.modifDate || c.modifDepot)
                        return (
                          <div key={cl.tiers}>
                            {/* Ligne client */}
                            <div className="flex border-b border-[#F0EDE6] hover:bg-[#FCFBF8]" style={{ background: fms ? '#FBFAFD' : undefined }}>
                              <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-[#E5E1D8] px-2 py-1" style={{ width: LARGEUR_GAUCHE, background: fms ? '#FBFAFD' : '#FFFFFF' }}>
                                <button type="button" onClick={() => setOuverts((s) => { const n = new Set(s); const k = `${depot}|${cl.tiers}`; if (n.has(k)) n.delete(k); else n.add(k); return n })} className="w-4 text-[11px] text-[#8A8474]">{ouvert ? '▾' : '▸'}</button>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-[12.5px] font-bold" title={cl.client}>{cl.client}</div>
                                  <div className="text-[10.5px] text-[#8A8474]">{cl.tiers} · {cl.cmds.length} CDC{modif ? ' · ✎ modifié' : ''}</div>
                                </div>
                                <button type="button" onClick={() => setSplitCmds(cl.cmds)} title={interessant ? 'Scinder : le dispo vaut un envoi (groupe extérieur ou ≥ 1 palette)' : 'Scinder l’expédition'}
                                  className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${interessant ? 'bg-[#7A5EA8] text-white' : 'text-[#8A8474] hover:bg-[#F4F3F0]'}`}>✂</button>
                              </div>
                              <div className="relative h-[40px]" style={{ width: e.largeur }} onDragOver={survolFrise(depot)} onDrop={deposerFrise(depot)} onDragLeave={() => setSurvol(null)}>
                                {survol?.depot === depot && survol.date && <div className="pointer-events-none absolute inset-y-0 bg-[#7A5EA8]/15" style={{ left: e.x(survol.date) - px / 2, width: px }} />}
                                <div className="pointer-events-none absolute inset-y-0 border-l-2 border-[#7A5EA8]/40" style={{ left: e.x(auj) - px / 2 }} />
                                {Array.from(parDate.entries()).map(([d, cmds]) => {
                                  const comp = cmds.some((c) => c.completeInconnue) ? null : cmds.map((c) => c.complete || '').sort().slice(-1)[0] || null
                                  return (
                                    <Jalon key={d} e={e} liv={d || null} complete={comp} completeInconnue={cmds.some((c) => c.completeInconnue)}
                                      m={somme(cmds.map((c) => c.tout))} mDispo={somme(cmds.map((c) => c.dispo))} mReliquat={somme(cmds.map((c) => c.reliquat))} split={null}
                                      manque={cmds.some((c) => c.manque)} transfert={cmds.some((c) => c.transfert)} couleur={couleur}
                                      titre={`${cl.client} — livraison ${fmtD(d)}\n${cmds.map((c) => `${c.doc}${c.manque ? ' ★' : ''}`).join(', ')}`}
                                      glisse={{ docs: cmds.map((c) => c.doc), depot, libelle: `${cmds.length} CDC de ${cl.client}` }} onDragStart={debutGlisse} />
                                  )
                                })}
                                {scindees.map((c) => (
                                  <Jalon key={c.cle} e={e} liv={c.liv} complete={c.complete} completeInconnue={c.completeInconnue} m={c.tout} mDispo={c.dispo} mReliquat={c.reliquat}
                                    split={c.split} manque={c.manque} transfert={c.transfert} couleur={couleur} titre={`${c.doc} — scindée`}
                                    glisse={{ docs: [c.doc], depot, libelle: `${c.doc} (${cl.client})` }} onDragStart={debutGlisse} />
                                ))}
                              </div>
                            </div>

                            {/* Lignes commandes */}
                            {ouvert && cl.cmds.map((c) => (
                              <div key={c.cle} className="flex border-b border-[#F7F5F0] bg-[#FDFCFA]">
                                <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-[#E5E1D8] bg-[#FDFCFA] py-0.5 pl-7 pr-2" style={{ width: LARGEUR_GAUCHE }}>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[11.5px] font-semibold">{c.doc}{c.depotOrigine !== c.depot && <span className="ml-1 text-[10px] text-[#5B4385]" title={`Dépôt SAGE : ${libDepot(c.depotOrigine)}`}>(↺ {libDepot(c.depotOrigine)})</span>}</div>
                                    <div className="truncate text-[10px] text-[#8A8474]" title={c.rep || ''}>
                                      liv. {fmtD(c.liv)}{c.modifDate && <span className="text-[#5B4385]"> (SAGE {fmtD(c.livOrigine)})</span>} · {fmtN(c.montant)} € · {c.rep}
                                    </div>
                                  </div>
                                  <button type="button" onClick={() => setSplitCmds([c])} className={`rounded px-1 text-[10.5px] font-bold ${c.splitInteressant && !c.split ? 'bg-[#7A5EA8] text-white' : 'text-[#8A8474] hover:bg-[#F4F3F0]'}`} title="Scinder cette commande">✂</button>
                                </div>
                                <div className="relative h-[34px]" style={{ width: e.largeur }} onDragOver={survolFrise(depot)} onDrop={deposerFrise(depot)}>
                                  <div className="pointer-events-none absolute inset-y-0 border-l-2 border-[#7A5EA8]/30" style={{ left: e.x(auj) - px / 2 }} />
                                  <Jalon e={e} liv={c.liv} complete={c.complete} completeInconnue={c.completeInconnue} m={c.tout} mDispo={c.dispo} mReliquat={c.reliquat}
                                    split={c.split} manque={c.manque} transfert={c.transfert} couleur={couleur} petit
                                    titre={`${c.doc} — ${c.client}\nLivraison ${fmtD(c.liv)}${c.manque ? `\n★ Manque : ${c.reliquat.lignes} ligne(s), complète ${c.completeInconnue ? 'à une date inconnue' : 'le ' + fmtD(c.complete)}` : ''}\n${c.lignes.slice(0, 12).map((l) => `${l.ref} × ${l.qte}${l.q_att > 0 ? ` (attend ${l.cont || l.cdf || '—'} ${fmtD(l.dispo)})` : ''}`).join('\n')}${c.lignes.length > 12 ? '\n…' : ''}`}
                                    glisse={{ docs: [c.doc], depot, libelle: `${c.doc} (${c.client})` }} onDragStart={debutGlisse} />
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </section>
          </>
        )}
      </div>

      {deplacement && <FenetreDeplacement d={deplacement} commandes={commandes} onAnnule={() => setDeplacement(null)} onValide={validerDeplacement} />}
      {splitCmds && <FenetreSplit cmds={splitCmds} depotAgence={depotAgence} auj={auj} onAnnule={() => setSplitCmds(null)} onValide={validerSplit} />}

      {panneau && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setPanneau(false)}>
          <div className="h-full w-full max-w-[760px] overflow-y-auto bg-[#F4F3F0] p-4 shadow-2xl" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[18px] font-bold">À reporter dans SAGE — {agence}</h2>
                <p className="text-[12px] text-[#5E5A44]">Décisions prises dans la frise. Une fois reportée dans SAGE, marquez-la « Reporté » : elle disparaît ici et la frise reprend la valeur SAGE après la synchro.</p>
              </div>
              <button type="button" onClick={() => setPanneau(false)} className="rounded-lg border border-[#E5E1D8] bg-white px-3 py-1.5 text-[14px] font-bold">×</button>
            </div>
            <button type="button" disabled={!actions.length} onClick={() => void exporterActions()} className="mt-3 h-9 rounded-lg bg-[#111820] px-3 text-[12.5px] font-bold text-white disabled:opacity-40">⬇ Excel ({actions.length})</button>
            <div className="mt-3 space-y-2">
              {actions.length === 0 && <div className="rounded-lg border border-[#E5E1D8] bg-white px-3 py-4 text-[12.5px] text-[#8A8474]">Aucune modification en attente.</div>}
              {actions.slice().reverse().map((a) => (
                <div key={a.id} className="rounded-lg border border-[#E5E1D8] bg-white px-3 py-2 text-[12.5px]">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <b>{a.numero_document}</b> · {a.nom_tiers}
                      <div className="mt-0.5">
                        {a.type_action === 'DEPOT' && <>📦 Dépôt : {libDepot(a.depot_avant || '')} → <b>{libDepot(a.depot_apres || '')}</b></>}
                        {a.type_action === 'DATE' && <>📅 Livraison : {fmtD(a.date_avant)} → <b>{fmtD(a.date_apres)}</b></>}
                        {a.type_action === 'SPLIT' && <>✂ Scindée : envoi 1 le <b>{fmtD(a.split_date_1)}</b> depuis <b>{libDepot(a.split_depot || '')}</b>, reliquat le <b>{fmtD(a.split_date_2)}</b></>}
                      </div>
                      {a.commentaire && <div className="text-[11.5px] italic text-[#5E5A44]">« {a.commentaire} »</div>}
                      <div className="text-[10.5px] text-[#8A8474]">{new Date(a.created_at).toLocaleString('fr-FR')}{a.created_by ? ` · ${a.created_by.split('@')[0]}` : ''}</div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => void traiter(a, 'REPORTE')} className="h-7 rounded bg-emerald-600 px-2 text-[11.5px] font-bold text-white">✓ Reporté</button>
                      <button type="button" onClick={() => void traiter(a, 'ANNULE')} className="h-7 rounded border border-[#E5E1D8] px-2 text-[11.5px] font-bold text-[#C1683C]">Annuler</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default function VueAgencePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>}>
      <VueAgence />
    </Suspense>
  )
}
