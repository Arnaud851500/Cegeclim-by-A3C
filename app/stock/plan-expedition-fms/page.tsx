'use client'

/**
 * Écran « Plan d'expédition FMS » (menu Stocks & logistique, /stock/plan-expedition-fms).
 * ---------------------------------------------------------------------------
 * Créé le 04/11/2026 à la demande d'Arnaud — vague d'arrivages containers Asie à
 * Fos (5, 6, 7 novembre), réceptions FMS la semaine suivante, capacité FMS ~100
 * palettes / jour et en gros une expédition par destinataire et par jour.
 *
 * But : dès la semaine prochaine, saturer FMS avec ce qui est DÉJÀ dispo (groupes
 * extérieurs, cuivre, volumineux) pour les commandes qui attendent les containers,
 * puis compléter ou expédier le reste à réception — sans faire deux palettes là où
 * une seule aurait suffi.
 *
 *  - Destinataire = client (CDC départ FMS) ou agence (CDC départ agence → palette
 *    de transfert multi-clients, préparation finie en agence).
 *  - Catégories : COMPLET (tout est dispo), ANTICIPER (il manque des articles mais
 *    le dispo contient un groupe extérieur ou fait au moins le seuil de palettes),
 *    ATTENDRE (dispo trop maigre → un seul envoi à réception), RECEPTION (rien de dispo).
 *  - Date de dispo FMS d'un container = date de RDV de déchargement saisie (même table
 *    que l'écran Portefeuille CDF : appro_cdf_rdv_fms) ; sans RDV, date inconnue ou
 *    RDV simulé (ETA + N jours ouvrés) si la case est cochée.
 *  - Planning : jours ouvrés, plafond de palettes par jour, un envoi par destinataire
 *    et par jour (un gros transfert s'étale sur plusieurs jours).
 *
 * Calcul : RPC refresh_plan_expedition_fms (≈ 12 s, matérialisé), lecture
 * get_plan_expedition_fms / get_plan_expedition_fms_detail / get_plan_expedition_fms_lignes.
 * Migration : supabase/sql/20261104d_plan_expedition_fms.sql.
 * Accès : réservé à Arnaud (page + contrôle plan_exp_autorise() côté base).
 */

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'

const COMPTES_AUTORISES = ['a.valanchauskas@cegeclim-energies.com', 'valancha@gmail.com']

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type Categorie = 'COMPLET' | 'ANTICIPER' | 'ATTENDRE' | 'RECEPTION'

type Unite = {
  cle: string; type_destinataire: 'CLIENT' | 'AGENCE'; libelle: string | null; numero_tiers: string | null; agence: string | null
  nb_cdc: number; nb_lignes: number; montant_ht: number | null; date_livraison_min: string | null
  nb_lignes_dispo: number; nb_lignes_attente: number; nb_lignes_vague: number; nb_lignes_reliquat: number
  palettes_dispo: number; palettes_attente: number; palettes_vague: number; poids_dispo: number | null
  nb_groupes_ext_dispo: number; nb_groupes_ext_attente: number; cuivre_dispo: boolean; dim_manquante: boolean
  date_complete_vague: string | null; rdv_simule: boolean; date_inconnue: boolean; sans_reception: boolean
  containers: string[] | null; categorie: Categorie
  anticipation_debut: string | null; anticipation_fin: string | null; anticipation_palettes: number | null
  reception_debut: string | null; reception_fin: string | null; reception_palettes: number | null; reception_type: string | null
  cp_livraison: string | null; ville_livraison: string | null
}
type Envoi = { jour: string; cle: string; vague: 'ANTICIPATION' | 'RECEPTION'; type_envoi: string; palettes: number; partie: number; nb_parties: number }
type Reception = {
  numero_cdf: string; fournisseur: string | null; est_cont: boolean; container: string | null; navire: string | null
  eta_port: string | null; statut_suivi: string | null; rdv_date: string | null; rdv_heure: string | null; rdv_simule: boolean
  date_reception_sage: string | null; date_dispo: string | null; nb_refs: number; qte: number; palettes: number | null
  nb_lignes_cdc: number; nb_destinataires: number; qte_cdc: number | null
  rdv_source: 'COMPAGNON' | 'SAGE' | null; nb_cdc: number | null; rdv_dispo: string | null
  reference_cdf: string | null
}
type Meta = {
  genere_le: string; genere_par: string | null; debut: string; fin_horizon: string; fin_fenetre: string; simuler_rdv: boolean
  parametres: {
    horizon_jours: number; capacite_palettes_jour: number; seuil_palettes_anticipation: number; delai_mise_en_stock_jours: number
    volume_utile_palette_m3: number; poids_max_palette_kg: number; fenetre_jours_ouvres: number; rdv_simule_jours_apres_eta: number
  }
}
type Plan = { meta: Meta | null; unites: Unite[]; envois: Envoi[]; receptions: Reception[]; familles: { famille: string; role: string }[] }
type Ligne = {
  ligne_id: string; cle: string; numero_document: string; numero_tiers: string | null; nom_tiers: string | null; representant: string | null
  depot_expedition: string | null; date_livraison: string | null; reference_article: string; designation: string | null
  famille: string | null; famille_macro: string | null; role_famille: string | null
  quantite: number; montant_ht: number | null; qte_agence: number; qte_fms_dispo: number; qte_attente: number
  numero_cdf: string | null; container: string | null; est_cont: boolean; date_dispo: string | null; rdv_simule: boolean
  sans_reception: boolean; dans_vague: boolean; dim_manquante: boolean; palettes_dispo: number; palettes_attente: number; statut: string
  // export uniquement
  categorie?: Categorie; libelle?: string; agence?: string; anticipation_debut?: string | null; reception_debut?: string | null
}

// ─────────────────────────────────────────────────────────────────────────
// Libellés & formats
// ─────────────────────────────────────────────────────────────────────────

const CATEGORIE: Record<Categorie, { label: string; court: string; cls: string; aide: string }> = {
  COMPLET:   { label: 'Complet — expédier', court: 'Complet', cls: 'bg-emerald-100 text-emerald-800', aide: 'Tout est dispo à FMS : expédier.' },
  ANTICIPER: { label: 'Anticiper le dispo', court: 'Anticiper', cls: 'bg-[#7A5EA8]/15 text-[#5B4385]', aide: 'Le dispo vaut le coup (groupe extérieur ou volume) : envoi anticipé, complément à réception.' },
  ATTENDRE:  { label: 'Attendre — un seul envoi', court: 'Attendre', cls: 'bg-amber-100 text-amber-800', aide: 'Dispo trop maigre : tout partira ensemble à réception.' },
  RECEPTION: { label: 'À réception', court: 'À réception', cls: 'bg-sky-100 text-sky-800', aide: 'Rien de dispo : envoi à réception des containers.' },
}
const ORDRE_CAT: Categorie[] = ['ANTICIPER', 'COMPLET', 'ATTENDRE', 'RECEPTION']
const STATUT_SUIVI: Record<string, string> = { booke: 'Booké', embarque: 'Embarqué', en_mer: 'En mer', arrive: 'Arrivé au port', decharge: 'Déchargé', livre: 'Livré FMS' }

function cpVille(u?: { cp_livraison?: string | null; ville_livraison?: string | null } | null): string {
  return u?.cp_livraison ? `${u.cp_livraison}${u.ville_livraison ? ' ' + u.ville_livraison : ''}` : ''
}

function fmtNum(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(String(v).length === 10 ? `${v}T12:00:00` : v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR')
}
function fmtJour(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(`${v}T12:00:00`)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}
function fmtPeriode(a: string | null, b: string | null): string {
  if (!a) return '—'
  return !b || a === b ? fmtJour(a) : `${fmtJour(a)} → ${fmtJour(b)}`
}
function fmtDateHeure(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}
function isoAujourdhui(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

function Badge({ cls, children, title }: { cls: string; children: React.ReactNode; title?: string }) {
  return <span title={title} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-bold ${cls}`}>{children}</span>
}
function Kpi({ label, valeur, sous, accent }: { label: string; valeur: string; sous?: string; accent?: string }) {
  return (
    <div className="min-w-[150px] flex-1 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-[#8A8474]">{label}</div>
      <div className="text-[22px] font-bold leading-tight" style={{ color: accent || '#111820' }}>{valeur}</div>
      {sous && <div className="text-[11px] text-[#8A8474]">{sous}</div>}
    </div>
  )
}

/** Préconisation en une phrase pour un destinataire. */
function preco(u: Unite): string {
  const ge = u.nb_groupes_ext_dispo > 0 ? `${fmtNum(u.nb_groupes_ext_dispo)} groupe(s) ext.` : null
  const cu = u.cuivre_dispo ? 'cuivre' : null
  const contenu = [ge, cu].filter(Boolean).join(' + ')
  const reliquat = u.nb_lignes_reliquat > 0 ? ` ${u.nb_lignes_reliquat} ligne(s) restent en reliquat (réception plus tardive ou non datée).` : ''
  switch (u.categorie) {
    case 'COMPLET':
      return `Tout est dispo : expédier ${fmtNum(u.anticipation_palettes ?? Math.ceil(u.palettes_dispo))} pal. ${u.anticipation_debut ? fmtPeriode(u.anticipation_debut, u.anticipation_fin) : '(hors fenêtre)'}.`
    case 'ANTICIPER':
      return `Envoyer le dispo${contenu ? ` (${contenu})` : ''} : ${fmtNum(u.anticipation_palettes ?? Math.ceil(u.palettes_dispo))} pal. ${u.anticipation_debut ? fmtPeriode(u.anticipation_debut, u.anticipation_fin) : '(hors fenêtre)'}`
        + (u.reception_debut ? `, puis complément ${fmtNum(u.reception_palettes)} pal. ${fmtPeriode(u.reception_debut, u.reception_fin)}.` : ', complément à réception (date à confirmer par RDV).') + reliquat
    case 'ATTENDRE':
      return `Dispo trop maigre (${fmtNum(u.palettes_dispo, 1)} pal.) : tout envoyer ensemble ${u.reception_debut ? fmtPeriode(u.reception_debut, u.reception_fin) : 'à réception (RDV à saisir)'}.` + reliquat
    case 'RECEPTION':
      return `Rien de dispo : envoi ${u.reception_debut ? fmtPeriode(u.reception_debut, u.reception_fin) : 'à réception (RDV à saisir)'}.` + reliquat
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Fiche d'un destinataire (lignes)
// ─────────────────────────────────────────────────────────────────────────

function TableLignes({ titre, rows, mode, couleur, agence }: { titre: string; rows: Ligne[]; mode: 'dispo' | 'attente'; couleur: string; agence: boolean }) {
  return (
    <div className="rounded-lg border border-[#E5E1D8] bg-white">
      <div className="flex items-center justify-between border-b border-[#E5E1D8] px-3 py-1.5" style={{ background: couleur }}>
        <span className="text-[12.5px] font-bold">{titre}</span>
        <span className="text-[11.5px] font-semibold text-[#5E5A44]">
          {rows.length} ligne(s) · {fmtNum(rows.reduce((s, l) => s + (mode === 'dispo' ? l.palettes_dispo : l.palettes_attente), 0), 1)} pal.
        </span>
      </div>
      {rows.length === 0 ? <div className="px-3 py-2 text-[12px] text-[#8A8474]">—</div> : (
        <div className="max-h-[300px] overflow-auto">
          <table className="w-full text-[11.5px]">
            <thead className="sticky top-0 bg-[#FAF9F6] text-left text-[10.5px] uppercase text-[#8A8474]">
              <tr>
                <th className="px-2 py-1">CDC</th>{agence && <th className="px-2 py-1">Client</th>}
                <th className="px-2 py-1">Liv.</th><th className="px-2 py-1">Référence</th><th className="px-2 py-1">Désignation</th>
                <th className="px-2 py-1 text-right">Qté</th><th className="px-2 py-1 text-right">Pal.</th>
                {mode === 'attente' && <th className="px-2 py-1">Attend</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.ligne_id} className="border-t border-[#F0EDE6]">
                  <td className="px-2 py-1 font-semibold">{l.numero_document}</td>
                  {agence && <td className="max-w-[160px] truncate px-2 py-1" title={l.nom_tiers || ''}>{l.nom_tiers}</td>}
                  <td className="whitespace-nowrap px-2 py-1">{fmtDate(l.date_livraison)}</td>
                  <td className="whitespace-nowrap px-2 py-1 font-mono">
                    {l.reference_article}
                    {l.role_famille === 'GROUPE_EXT' && <span className="ml-1 rounded bg-[#7A5EA8]/15 px-1 text-[9.5px] font-bold text-[#5B4385]">GE</span>}
                    {l.role_famille === 'CUIVRE' && <span className="ml-1 rounded bg-orange-100 px-1 text-[9.5px] font-bold text-orange-800">Cu</span>}
                  </td>
                  <td className="max-w-[240px] truncate px-2 py-1" title={l.designation || ''}>{l.designation}</td>
                  <td className="px-2 py-1 text-right font-semibold">{fmtNum(mode === 'dispo' ? l.qte_fms_dispo : l.qte_attente)}{(mode === 'dispo' ? l.qte_attente : l.qte_fms_dispo) > 0 && <span className="text-[#8A8474]"> /{fmtNum(l.quantite - l.qte_agence)}</span>}</td>
                  <td className="px-2 py-1 text-right">{l.dim_manquante ? <span title="Dimensions et poids absents de BLG" className="text-[#C1683C]">?</span> : fmtNum(mode === 'dispo' ? l.palettes_dispo : l.palettes_attente, 2)}</td>
                  {mode === 'attente' && (
                    <td className="whitespace-nowrap px-2 py-1">
                      {l.sans_reception ? <span className="font-semibold text-[#C1683C]">Aucune CDF</span> : (
                        <span title={l.numero_cdf || ''}>
                          {l.container || l.numero_cdf} · {l.date_dispo ? <>{fmtJour(l.date_dispo)}{l.rdv_simule && <span className="text-[#C1683C]"> (simulé)</span>}</> : <span className="text-[#C1683C]">RDV à saisir</span>}
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FicheDestinataire({ u, onClose }: { u: Unite; onClose: () => void }) {
  const [lignes, setLignes] = useState<Ligne[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    let annule = false
    void (async () => {
      const { data, error } = await supabase.rpc('get_plan_expedition_fms_detail', { p_cle: u.cle })
      if (annule) return
      if (error) setErreur(messageErreur(error)); else setLignes((data || []) as Ligne[])
    })()
    return () => { annule = true }
  }, [u.cle])

  const groupes = useMemo(() => {
    const dispo = (lignes || []).filter((l) => l.qte_fms_dispo > 0)
    const vague = (lignes || []).filter((l) => l.qte_attente > 0 && l.dans_vague)
    const reliquat = (lignes || []).filter((l) => l.qte_attente > 0 && !l.dans_vague)
    return { dispo, vague, reliquat }
  }, [lignes])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-[980px] overflow-y-auto bg-[#F4F3F0] p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">{u.type_destinataire === 'AGENCE' ? 'Transfert FMS → agence' : `Client · agence ${u.agence || '—'}`}</p>
            <h2 className="text-[19px] font-bold leading-tight">{u.libelle}{u.numero_tiers && <span className="ml-2 text-[13px] font-semibold text-[#8A8474]">{u.numero_tiers}</span>}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge cls={CATEGORIE[u.categorie].cls}>{CATEGORIE[u.categorie].label}</Badge>
              <span className="text-[12px] text-[#5E5A44]">{u.nb_cdc} CDC · {u.nb_lignes} lignes · 1re livraison {fmtDate(u.date_livraison_min)}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-[#E5E1D8] bg-white px-3 py-1.5 text-[14px] font-bold">×</button>
        </div>
        <div className="mt-3 rounded-lg border border-[#7A5EA8]/30 bg-[#7A5EA8]/[0.06] px-3 py-2 text-[13px] font-semibold text-[#3F2E62]">👉 {preco(u)}</div>
        {erreur && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-800">{erreur}</div>}
        {!lignes && !erreur && <div className="mt-3 text-[12.5px] text-[#8A8474]">Chargement des lignes…</div>}
        {lignes && (
          <div className="mt-3 space-y-3">
            <TableLignes agence={u.type_destinataire === 'AGENCE'} titre="Dispo à FMS maintenant" rows={groupes.dispo} mode="dispo" couleur="#ECF7EF" />
            <TableLignes agence={u.type_destinataire === 'AGENCE'} titre="Attend une réception datée dans la fenêtre du plan (envoi à réception)" rows={groupes.vague} mode="attente" couleur="#EEF4FA" />
            <TableLignes agence={u.type_destinataire === 'AGENCE'} titre="Reliquat (réception plus tardive, non datée ou absente)" rows={groupes.reliquat} mode="attente" couleur="#FBF1EA" />
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Saisie du RDV de déchargement (même table que le Portefeuille CDF)
// ─────────────────────────────────────────────────────────────────────────

function RdvSaisie({ r, onSaved }: { r: Reception; onSaved: () => void }) {
  const [edit, setEdit] = useState(false)
  const [date, setDate] = useState(r.rdv_date || '')
  const [heure, setHeure] = useState(r.rdv_heure?.slice(0, 5) || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function valider(retirer = false) {
    setSaving(true); setErr(null)
    const { error } = await supabase.from('appro_cdf_rdv_fms').insert({
      cdf_numero: r.numero_cdf,
      container_numero: r.container || null,
      rdv_date: retirer ? null : date || null,
      rdv_heure: !retirer && date && heure ? heure : null,
      commentaire: retirer ? 'RDV retiré (plan d’expédition FMS)' : 'Saisi depuis le plan d’expédition FMS',
    })
    setSaving(false)
    if (error) { setErr(messageErreur(error)); return }
    setEdit(false)
    onSaved()
  }

  if (edit) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-7 rounded border border-[#E5E1D8] px-1 text-[12px]" autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter' && date) void valider(); if (e.key === 'Escape') setEdit(false) }} />
        <input type="time" value={heure} onChange={(e) => setHeure(e.target.value)} className="h-7 w-[80px] rounded border border-[#E5E1D8] px-1 text-[12px]" />
        <button type="button" disabled={saving || !date} onClick={() => void valider()} className="h-7 rounded bg-[#111820] px-2 text-[11.5px] font-bold text-white disabled:opacity-40">{saving ? '…' : 'OK'}</button>
        {r.rdv_date && r.rdv_source === 'COMPAGNON' && <button type="button" disabled={saving} onClick={() => void valider(true)} title="Retirer le RDV saisi (le RDV SAGE éventuel reprend la main)" className="h-7 rounded border border-[#E5E1D8] px-2 text-[11.5px] font-bold text-[#C1683C]">Retirer</button>}
        <button type="button" onClick={() => setEdit(false)} className="h-7 px-1 text-[13px] text-[#8A8474]">×</button>
        {err && <span className="text-[11px] font-semibold text-red-700">{err}</span>}
      </div>
    )
  }
  if (r.rdv_date) {
    return (
      <button type="button" onClick={() => setEdit(true)}
        title={r.rdv_source === 'SAGE' ? 'RDV confirmé lu dans les commentaires de la CDF SAGE — cliquer pour le remplacer par une saisie' : 'RDV saisi dans le compagnon — cliquer pour le modifier'}
        className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ring-1 ${r.rdv_source === 'SAGE' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-indigo-50 text-indigo-800 ring-indigo-200'}`}>
        {fmtJour(r.rdv_date)}{r.rdv_heure ? ` ${r.rdv_heure.slice(0, 5).replace(':', 'h')}` : ''}
        <span className="ml-1 text-[9.5px] font-bold opacity-70">{r.rdv_source === 'SAGE' ? 'SAGE' : 'saisi'}</span>
      </button>
    )
  }
  return (
    <button type="button" onClick={() => setEdit(true)} className={`rounded px-1.5 py-0.5 text-[11.5px] font-bold ${r.est_cont ? 'bg-[#C1683C] text-white' : 'text-[#1D5C86] hover:bg-[#1D5C86]/10'}`}>
      + RDV
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

type Vue = 'agences' | 'planning' | 'receptions'

function PlanExpeditionFms() {
  const { loading: accessLoading, email } = useAccess()
  const autorise = COMPTES_AUTORISES.includes((email || '').trim().toLowerCase())

  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(false)
  const [calcul, setCalcul] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [exportEnCours, setExportEnCours] = useState(false)

  const [debut, setDebut] = useState('')
  const [horizon, setHorizon] = useState(21)
  const [simuler, setSimuler] = useState(true)

  const [vue, setVue] = useState<Vue>('agences')
  const [agenceF, setAgenceF] = useState('')
  const [categorieF, setCategorieF] = useState<Categorie | ''>('')
  const [typeF, setTypeF] = useState<'' | 'CLIENT' | 'AGENCE'>('')
  const [recherche, setRecherche] = useState('')
  const [fiche, setFiche] = useState<Unite | null>(null)
  const [jourOuvert, setJourOuvert] = useState<string | null>(null)
  const [contF, setContF] = useState<'cont' | 'tous'>('cont')

  const appliquerMeta = (p: Plan) => {
    if (p.meta) { setDebut(p.meta.debut); setHorizon(p.meta.parametres.horizon_jours); setSimuler(p.meta.simuler_rdv) }
  }

  const recalculer = useCallback(async (opts?: { debut?: string; horizon?: number; simuler?: boolean }) => {
    setCalcul(true); setErreur(null)
    const { data, error } = await supabase.rpc('refresh_plan_expedition_fms', {
      p_debut: (opts?.debut ?? debut) || null,
      p_horizon_jours: opts?.horizon ?? horizon,
      p_simuler_rdv: opts?.simuler ?? simuler,
    })
    setCalcul(false)
    if (error) { setErreur(messageErreur(error)); return }
    const p = data as Plan
    setPlan(p); appliquerMeta(p)
  }, [debut, horizon, simuler])

  const charger = useCallback(async () => {
    setLoading(true); setErreur(null)
    const { data, error } = await supabase.rpc('get_plan_expedition_fms')
    setLoading(false)
    if (error) { setErreur(messageErreur(error)); return }
    const p = data as Plan
    // Pas encore calculé, ou calcul d'un jour précédent : on recalcule
    const vieux = !p.meta || new Date(p.meta.genere_le).toDateString() !== new Date().toDateString()
    if (vieux) { await recalculer({ debut: '', horizon: p.meta?.parametres.horizon_jours ?? 21, simuler: p.meta?.simuler_rdv ?? true }); return }
    setPlan(p); appliquerMeta(p)
  }, [recalculer])

  useEffect(() => {
    if (accessLoading || !autorise) return
    void charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessLoading, autorise])

  const unites = useMemo(() => plan?.unites || [], [plan])
  const meta = plan?.meta || null
  const cap = meta?.parametres.capacite_palettes_jour || 100

  const agences = useMemo(() => {
    const m = new Map<string, { nb: number; pal1: number; pal2: number; ge: number; transfert: Unite | null }>()
    unites.forEach((u) => {
      const k = u.agence || '—'
      const e = m.get(k) || { nb: 0, pal1: 0, pal2: 0, ge: 0, transfert: null }
      e.nb += 1
      e.pal1 += u.anticipation_palettes || 0
      e.pal2 += u.reception_palettes || 0
      e.ge += (u.nb_groupes_ext_dispo || 0) + (u.nb_groupes_ext_attente || 0)
      if (u.type_destinataire === 'AGENCE') e.transfert = u
      m.set(k, e)
    })
    return Array.from(m.entries()).sort((a, b) => (b[1].pal1 + b[1].pal2) - (a[1].pal1 + a[1].pal2))
  }, [unites])

  const filtres = useMemo(() => {
    const q = normaliser(recherche.trim())
    return unites
      .filter((u) => !agenceF || (u.agence || '—') === agenceF)
      .filter((u) => !categorieF || u.categorie === categorieF)
      .filter((u) => !typeF || u.type_destinataire === typeF)
      .filter((u) => !q || normaliser(`${u.libelle} ${u.numero_tiers} ${u.agence} ${(u.containers || []).join(' ')}`).includes(q))
      .sort((a, b) => {
        if (a.type_destinataire !== b.type_destinataire) return a.type_destinataire === 'AGENCE' ? -1 : 1
        const c = ORDRE_CAT.indexOf(a.categorie) - ORDRE_CAT.indexOf(b.categorie)
        if (c) return c
        return String(a.anticipation_debut || a.reception_debut || '9999').localeCompare(String(b.anticipation_debut || b.reception_debut || '9999'))
      })
  }, [unites, agenceF, categorieF, typeF, recherche])

  const totaux = useMemo(() => {
    const t = { cdc: 0, lignes: 0, palDispo: 0, lDispo: 0, geDispo: 0, palAtt: 0, lAtt: 0, geAtt: 0, pal1: 0, pal2: 0 }
    filtres.forEach((u) => {
      t.cdc += u.nb_cdc; t.lignes += u.nb_lignes
      t.palDispo += Number(u.palettes_dispo) || 0; t.lDispo += u.nb_lignes_dispo; t.geDispo += Number(u.nb_groupes_ext_dispo) || 0
      t.palAtt += Number(u.palettes_attente) || 0; t.lAtt += u.nb_lignes_attente; t.geAtt += Number(u.nb_groupes_ext_attente) || 0
      t.pal1 += u.anticipation_palettes || 0; t.pal2 += u.reception_palettes || 0
    })
    return t
  }, [filtres])

  const kpi = useMemo(() => {
    const parCat = Object.fromEntries(ORDRE_CAT.map((c) => [c, unites.filter((u) => u.categorie === c)])) as Record<Categorie, Unite[]>
    const pal1 = unites.reduce((s, u) => s + (u.anticipation_palettes || 0), 0)
    const pal2 = unites.reduce((s, u) => s + (u.reception_palettes || 0), 0)
    const ge = unites.reduce((s, u) => s + (u.anticipation_palettes ? Number(u.nb_groupes_ext_dispo) || 0 : 0), 0)
    const recs = (plan?.receptions || []).filter((r) => r.est_cont && r.nb_lignes_cdc > 0)
    const sansRdv = recs.filter((r) => !r.rdv_date)
    const nonPlanifies = unites.filter((u) => (u.categorie === 'COMPLET' || u.categorie === 'ANTICIPER') && !u.anticipation_debut).length
    return { parCat, pal1, pal2, ge, recs, sansRdv, nonPlanifies }
  }, [unites, plan])

  const jours = useMemo(() => {
    const m = new Map<string, { jour: string; pal1: number; pal2: number; envois: Envoi[] }>()
    ;(plan?.envois || []).forEach((e) => {
      const j = m.get(e.jour) || { jour: e.jour, pal1: 0, pal2: 0, envois: [] }
      if (e.vague === 'ANTICIPATION') j.pal1 += e.palettes; else j.pal2 += e.palettes
      j.envois.push(e)
      m.set(e.jour, j)
    })
    return Array.from(m.values()).sort((a, b) => a.jour.localeCompare(b.jour))
  }, [plan])
  const parCle = useMemo(() => new Map(unites.map((u) => [u.cle, u])), [unites])

  const receptions = useMemo(() => (plan?.receptions || []).filter((r) => contF === 'tous' || r.est_cont), [plan, contF])

  async function exporterExcel() {
    setExportEnCours(true)
    try {
      const { data, error } = await supabase.rpc('get_plan_expedition_fms_lignes', { p_agence: agenceF || null })
      if (error) throw error
      const lignes = (data || []) as Ligne[]
      const wb = new ExcelJS.Workbook()
      const feuille = (nom: string, cols: { h: string; w?: number }[], rows: unknown[][]) => {
        const ws = wb.addWorksheet(nom)
        ws.addRow(cols.map((c) => c.h)).font = { bold: true }
        rows.forEach((r) => ws.addRow(r.map((v) => (v === null || v === undefined ? '' : v))))
        cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w || 13 })
        ws.views = [{ state: 'frozen', ySplit: 1 }]
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
      }
      const us = agenceF ? unites.filter((u) => (u.agence || '—') === agenceF) : unites
      feuille('Préconisations', [
        { h: 'Agence' }, { h: 'Type' }, { h: 'Destinataire', w: 32 }, { h: 'N° tiers' }, { h: 'CP livraison' }, { h: 'Ville livraison', w: 22 }, { h: 'Catégorie', w: 22 }, { h: 'CDC' }, { h: 'Lignes' },
        { h: '1re livraison' }, { h: 'Lignes dispo' }, { h: 'Palettes dispo' }, { h: 'Groupes ext. dispo' }, { h: 'Groupes ext. en attente' }, { h: 'Cuivre dispo' },
        { h: 'Lignes en attente' }, { h: 'dont réception datée' }, { h: 'dont reliquat' }, { h: 'Palettes en attente' },
        { h: 'Dispo complète (vague)' }, { h: 'RDV simulé' }, { h: 'Envoi anticipé du' }, { h: 'au' }, { h: 'Palettes' },
        { h: 'Envoi à réception du' }, { h: 'au' }, { h: 'Palettes' }, { h: 'Containers / CDF attendus', w: 40 }, { h: 'Préconisation', w: 90 },
      ], us.map((u) => [u.agence, u.type_destinataire === 'AGENCE' ? 'Transfert agence' : 'Client', u.libelle, u.numero_tiers, u.cp_livraison, u.ville_livraison, CATEGORIE[u.categorie].label,
        u.nb_cdc, u.nb_lignes, fmtDate(u.date_livraison_min), u.nb_lignes_dispo, u.palettes_dispo, u.nb_groupes_ext_dispo, u.nb_groupes_ext_attente, u.cuivre_dispo ? 'Oui' : '',
        u.nb_lignes_attente, u.nb_lignes_vague, u.nb_lignes_reliquat, u.palettes_attente, fmtDate(u.date_complete_vague), u.rdv_simule ? 'Oui' : '',
        fmtDate(u.anticipation_debut), fmtDate(u.anticipation_fin), u.anticipation_palettes, fmtDate(u.reception_debut), fmtDate(u.reception_fin),
        u.reception_palettes, (u.containers || []).join(', '), preco(u)]))
      feuille('Lignes', [
        { h: 'Agence' }, { h: 'Destinataire', w: 30 }, { h: 'Catégorie', w: 20 }, { h: 'CDC' }, { h: 'Client', w: 28 }, { h: 'Dépôt expé.' },
        { h: 'Livraison' }, { h: 'Référence', w: 18 }, { h: 'Désignation', w: 36 }, { h: 'Famille' }, { h: 'Rôle' }, { h: 'Qté' }, { h: 'Servie stock agence' },
        { h: 'Dispo FMS' }, { h: 'En attente' }, { h: 'CDF attendue' }, { h: 'Container' }, { h: 'Dispo FMS le' }, { h: 'RDV simulé' }, { h: 'Dans la vague' },
        { h: 'Palettes dispo' }, { h: 'Palettes attente' },
      ], lignes.map((l) => [l.agence, l.libelle, l.categorie ? CATEGORIE[l.categorie].court : '', l.numero_document, l.nom_tiers, l.depot_expedition,
        fmtDate(l.date_livraison), l.reference_article, l.designation, l.famille, l.role_famille, l.quantite, l.qte_agence, l.qte_fms_dispo, l.qte_attente,
        l.numero_cdf, l.container, fmtDate(l.date_dispo), l.rdv_simule ? 'Oui' : '', l.qte_attente > 0 ? (l.dans_vague ? 'Oui' : 'Reliquat') : '',
        Number(l.palettes_dispo || 0).toFixed(2), Number(l.palettes_attente || 0).toFixed(2)]))
      feuille('Planning FMS', [{ h: 'Jour' }, { h: 'Vague' }, { h: 'Type' }, { h: 'Agence' }, { h: 'Destinataire', w: 32 }, { h: 'CP livraison' }, { h: 'Ville livraison', w: 22 }, { h: 'Palettes' }, { h: 'Partie' }],
        (plan?.envois || []).filter((e) => !agenceF || (parCle.get(e.cle)?.agence || '—') === agenceF)
          .map((e) => [fmtDate(e.jour), e.vague === 'ANTICIPATION' ? 'Dès maintenant' : 'À réception', e.type_envoi, parCle.get(e.cle)?.agence, parCle.get(e.cle)?.libelle, parCle.get(e.cle)?.cp_livraison, parCle.get(e.cle)?.ville_livraison, e.palettes, e.nb_parties > 1 ? `${e.partie}/${e.nb_parties}` : '']))
      feuille('Containers & RDV', [{ h: 'CDF' }, { h: 'Commentaire CDF', w: 22 }, { h: 'Fournisseur', w: 26 }, { h: 'Container' }, { h: 'Navire', w: 20 }, { h: 'ETA port' }, { h: 'Statut' },
        { h: 'RDV FMS' }, { h: 'Dispo FMS retenue' }, { h: 'RDV simulé' }, { h: 'Réf.' }, { h: 'Pièces' }, { h: 'Palettes' }, { h: 'Lignes CDC servies' }, { h: 'Destinataires' }],
        (plan?.receptions || []).map((r) => [r.numero_cdf, r.reference_cdf, r.fournisseur, r.container, r.navire, fmtDate(r.eta_port), r.statut_suivi ? STATUT_SUIVI[r.statut_suivi] || r.statut_suivi : '',
          fmtDate(r.rdv_date), fmtDate(r.date_dispo), r.rdv_simule ? 'Oui' : '', r.nb_refs, r.qte, r.palettes, r.nb_lignes_cdc, r.nb_destinataires]))
      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url
      a.download = `plan_expedition_fms_${agenceF ? agenceF.toLowerCase().replace(/\W+/g, '_') + '_' : ''}${isoAujourdhui()}.xlsx`
      a.click(); URL.revokeObjectURL(url)
    } catch (e) { setErreur('Export Excel : ' + messageErreur(e)) } finally { setExportEnCours(false) }
  }

  // ── Accès ────────────────────────────────────────────────────────────────
  if (accessLoading) return <main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>
  if (!autorise) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F4F3F0] p-6 text-center">
        <div className="rounded-xl border border-[#E5E1D8] bg-white px-6 py-5">
          <div className="text-[17px] font-bold">Accès réservé</div>
          <p className="mt-1 text-[13px] text-[#5E5A44]">Le plan d’expédition FMS est en préparation et n’est pas encore ouvert.</p>
        </div>
      </main>
    )
  }

  const ctl = 'h-8 min-w-0 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const transfertAgence = agenceF ? agences.find(([a]) => a === agenceF)?.[1].transfert || null : null

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1900px] space-y-2.5">
        {/* En-tête */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Stocks & logistique · accès réservé</p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">Plan d’expédition FMS</h1>
            <p className="text-[11.5px] text-[#8A8474]">
              Anticiper ce qui est déjà dispo à FMS, compléter à réception des containers
              {meta && <> · calculé le {fmtDateHeure(meta.genere_le)} · CDC à livrer jusqu’au {fmtDate(meta.fin_horizon)} · plan du {fmtJour(meta.debut)} au {fmtJour(meta.fin_fenetre)} · {cap} pal./jour</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[11.5px] font-semibold text-[#5E5A44]">1er jour
              <input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} className={ctl} />
            </label>
            <label className="flex items-center gap-1 text-[11.5px] font-semibold text-[#5E5A44]">CDC à livrer sous
              <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className={ctl}>
                {[7, 14, 21, 30, 45, 60].map((h) => <option key={h} value={h}>{h} j</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#5E5A44]" title={`Container sans RDV saisi : RDV simulé ${meta?.parametres.rdv_simule_jours_apres_eta ?? 5} jours ouvrés après l’ETA port`}>
              <input type="checkbox" checked={simuler} onChange={(e) => setSimuler(e.target.checked)} />
              Simuler les RDV manquants
            </label>
            <a href={`/stock/plan-expedition-fms/agences${agenceF ? `?agence=${encodeURIComponent(agenceF)}` : ''}`} className="flex h-10 items-center rounded-lg border border-[#7A5EA8] px-3 text-[13px] font-bold text-[#5B4385]">🗓 Vue agence (frise)</a>
            <button type="button" onClick={() => void recalculer()} disabled={calcul} className="h-10 rounded-lg bg-[#7A5EA8] px-3 text-[13px] font-bold text-white disabled:opacity-50">
              {calcul ? 'Calcul… (~15 s)' : '↻ Recalculer'}
            </button>
            <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || !plan} className="h-10 rounded-lg bg-[#111820] px-3 text-[13px] font-bold text-white disabled:opacity-50">
              {exportEnCours ? 'Export…' : `⬇ Excel${agenceF ? ` ${agenceF}` : ''}`}
            </button>
          </div>
        </section>

        {erreur && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-800">
            {erreur}{/does not exist|could not find/i.test(erreur) ? ' — la migration 20261104d_plan_expedition_fms.sql est-elle appliquée ?' : ''}
          </div>
        )}
        {(loading || (calcul && !plan)) && <div className="rounded-lg border border-[#E5E1D8] bg-white px-3 py-6 text-center text-[13px] text-[#8A8474]">Calcul du plan en cours (≈ 15 s)…</div>}

        {plan && (
          <>
            {/* Indicateurs */}
            <section className="flex flex-wrap gap-2">
              <Kpi label="Envois dès maintenant" valeur={`${fmtNum(kpi.pal1)} pal.`} sous={`${kpi.parCat.ANTICIPER.length} à anticiper + ${kpi.parCat.COMPLET.length} complets · ${fmtNum(kpi.ge)} groupes ext.`} accent="#5B4385" />
              <Kpi label="Envois à réception" valeur={`${fmtNum(kpi.pal2)} pal.`} sous={`${kpi.parCat.ATTENDRE.length} à attendre · ${kpi.parCat.RECEPTION.length} sans dispo · compléments`} accent="#1D5C86" />
              <Kpi label="Containers à recevoir" valeur={`${kpi.recs.length}`} sous={kpi.sansRdv.length ? `${kpi.sansRdv.length} sans RDV de déchargement` : 'tous ont un RDV'} accent={kpi.sansRdv.length ? '#C1683C' : '#111820'} />
              <Kpi label="Charge FMS" valeur={jours.length ? `${fmtNum(Math.max(...jours.map((j) => j.pal1 + j.pal2)))} pal.` : '—'} sous={`jour le plus chargé / ${cap} · ${jours.filter((j) => j.pal1 + j.pal2 >= cap).length} jour(s) saturé(s)`} />
              {kpi.nonPlanifies > 0 && <Kpi label="Hors fenêtre" valeur={`${kpi.nonPlanifies}`} sous="envois dispo qui ne tiennent pas dans la fenêtre" accent="#C1683C" />}
            </section>
            {meta?.simuler_rdv && kpi.sansRdv.length > 0 && (
              <div className="rounded-lg border border-[#C1683C]/30 bg-[#C1683C]/[0.07] px-3 py-2 text-[12.5px] font-semibold text-[#8A3F1E]">
                {kpi.sansRdv.length} container(s) sans RDV : leurs dates de dispo sont simulées (ETA + {meta.parametres.rdv_simule_jours_apres_eta} j ouvrés). Saisissez les RDV dans l’onglet « Containers & RDV » pour fiabiliser les envois à réception.
              </div>
            )}

            {/* Onglets */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-[#E5E1D8] bg-white p-0.5 text-[12.5px] font-bold">
                {([['agences', 'Préconisations par agence'], ['planning', `Planning FMS (${jours.length} j)`], ['receptions', `Containers & RDV (${kpi.recs.length})`]] as [Vue, string][]).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setVue(k)} className={`rounded-md px-3 py-1.5 ${vue === k ? 'bg-[#111820] text-white' : 'text-[#8A8474]'}`}>{l}</button>
                ))}
              </div>
            </div>

            {/* ── Vue par agence ─────────────────────────────────────────── */}
            {vue === 'agences' && (
              <>
                <section className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setAgenceF('')} className={`rounded-full px-3 py-1 text-[12px] font-bold ${!agenceF ? 'bg-[#111820] text-white' : 'border border-[#E5E1D8] bg-white text-[#5E5A44]'}`}>Toutes ({unites.length})</button>
                  {agences.map(([a, e]) => (
                    <button key={a} type="button" onClick={() => setAgenceF(agenceF === a ? '' : a)}
                      className={`rounded-full px-3 py-1 text-[12px] font-bold ${agenceF === a ? 'bg-[#111820] text-white' : 'border border-[#E5E1D8] bg-white text-[#5E5A44]'}`}
                      title={`${e.nb} destinataire(s) · ${fmtNum(e.pal1)} pal. dès maintenant · ${fmtNum(e.pal2)} pal. à réception · ${fmtNum(e.ge)} groupes extérieurs`}>
                      {a} <span className="opacity-60">{e.nb} · {fmtNum(e.pal1)}/{fmtNum(e.pal2)} pal. · {fmtNum(e.ge)} GE</span>
                    </button>
                  ))}
                </section>

                {agenceF && (
                  <section className="rounded-xl border border-[#E5E1D8] bg-white px-4 py-3">
                    <div className="text-[13px] font-bold">À faire pour {agenceF}</div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-[#3A362E]">
                      {transfertAgence
                        ? <li><b>Transfert FMS → {agenceF}</b> ({transfertAgence.nb_cdc} CDC départ agence) : {preco(transfertAgence)}</li>
                        : <li>Aucune CDC départ agence n’attend FMS sur la période.</li>}
                      {(() => {
                        const cl = unites.filter((u) => u.type_destinataire === 'CLIENT' && (u.agence || '—') === agenceF)
                        const c = (k: Categorie) => cl.filter((u) => u.categorie === k).length
                        return <li><b>{cl.length} client(s) livrés depuis FMS</b> : {c('ANTICIPER')} à anticiper, {c('COMPLET')} complets, {c('ATTENDRE')} à expédier en une fois à réception, {c('RECEPTION')} sans dispo.</li>
                      })()}
                    </ul>
                  </section>
                )}

                <section className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <button type="button" onClick={() => setCategorieF('')} className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${!categorieF ? 'bg-[#111820] text-white' : 'bg-[#F4F3F0] text-[#5E5A44]'}`}>Toutes</button>
                    {ORDRE_CAT.map((c) => (
                      <button key={c} type="button" onClick={() => setCategorieF(categorieF === c ? '' : c)} title={CATEGORIE[c].aide}
                        className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${categorieF === c ? 'ring-2 ring-[#111820]' : ''} ${CATEGORIE[c].cls}`}>
                        {CATEGORIE[c].court} ({unites.filter((u) => u.categorie === c && (!agenceF || (u.agence || '—') === agenceF)).length})
                      </button>
                    ))}
                  </div>
                  <select value={typeF} onChange={(e) => setTypeF(e.target.value as '' | 'CLIENT' | 'AGENCE')} className={ctl}>
                    <option value="">Clients et transferts</option><option value="AGENCE">Transferts agence</option><option value="CLIENT">Clients départ FMS</option>
                  </select>
                  <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Client, n° tiers, container…" className={`${ctl} w-[220px]`} />
                  <span className="ml-auto text-[11.5px] text-[#8A8474]">{filtres.length} destinataire(s)</span>
                </section>

                <section className="max-h-[calc(100vh-260px)] overflow-auto rounded-xl border border-[#E5E1D8] bg-white">
                  <table className="w-full min-w-[1400px] text-[12px]">
                    <thead className="sticky top-0 z-10 bg-[#FAF9F6] text-left text-[10.5px] uppercase tracking-wide text-[#8A8474]">
                      <tr>
                        <th className="px-2 py-2">Destinataire</th><th className="px-2 py-2">Agence</th><th className="px-2 py-2">Préco</th>
                        <th className="px-2 py-2 text-right">CDC · lignes</th><th className="px-2 py-2">1re liv.</th>
                        <th className="px-2 py-2 text-right">Dispo FMS</th><th className="px-2 py-2">Contenu</th>
                        <th className="px-2 py-2 text-right">En attente</th><th className="px-2 py-2">Complet le</th>
                        <th className="px-2 py-2">Envoi dès maintenant</th><th className="px-2 py-2">Envoi à réception</th><th className="px-2 py-2">Attend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtres.map((u) => (
                        <tr key={u.cle} onClick={() => setFiche(u)} className={`cursor-pointer border-t border-[#F0EDE6] hover:bg-[#FAF9F6] ${u.type_destinataire === 'AGENCE' ? 'bg-[#F7F5FB]' : ''}`}>
                          <td className="max-w-[260px] px-2 py-1.5">
                            <div className="truncate font-bold" title={u.libelle || ''}>{u.type_destinataire === 'AGENCE' ? '🚚 ' : ''}{u.libelle}</div>
                            {(u.numero_tiers || u.cp_livraison) && <div className="truncate text-[10.5px] text-[#8A8474]">{[u.numero_tiers, cpVille(u)].filter(Boolean).join(' · ')}</div>}
                          </td>
                          <td className="px-2 py-1.5 font-semibold">{u.agence}</td>
                          <td className="px-2 py-1.5"><Badge cls={CATEGORIE[u.categorie].cls} title={CATEGORIE[u.categorie].aide}>{CATEGORIE[u.categorie].court}</Badge></td>
                          <td className="px-2 py-1.5 text-right">{u.nb_cdc} · {u.nb_lignes}</td>
                          <td className="whitespace-nowrap px-2 py-1.5">{fmtDate(u.date_livraison_min)}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right"><b>{fmtNum(u.palettes_dispo, 1)}</b> pal. <span className="text-[#8A8474]">({u.nb_lignes_dispo} l.)</span></td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {u.nb_groupes_ext_dispo > 0 && <span className="mr-1 rounded bg-[#7A5EA8]/15 px-1.5 text-[10.5px] font-bold text-[#5B4385]">{fmtNum(u.nb_groupes_ext_dispo)} GE</span>}
                            {u.cuivre_dispo && <span className="mr-1 rounded bg-orange-100 px-1.5 text-[10.5px] font-bold text-orange-800">Cuivre</span>}
                            {u.dim_manquante && <span title="Certaines références n'ont ni dimensions ni poids dans BLG : volume estimé avec la médiane de leur famille" className="text-[10.5px] font-bold text-[#C1683C]">dim. ?</span>}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right">
                            {u.nb_lignes_attente > 0 ? <>{u.nb_groupes_ext_attente > 0 && <span className="mr-1 rounded bg-[#7A5EA8]/10 px-1.5 text-[10.5px] font-bold text-[#5B4385]">{fmtNum(u.nb_groupes_ext_attente)} GE</span>}<b>{fmtNum(u.palettes_attente, 1)}</b> pal. <span className="text-[#8A8474]">({u.nb_lignes_attente} l.{u.nb_lignes_reliquat > 0 ? `, ${u.nb_lignes_reliquat} reliquat` : ''})</span></> : '—'}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {u.date_complete_vague ? <>{fmtJour(u.date_complete_vague)}{u.rdv_simule && <span className="text-[10.5px] font-bold text-[#C1683C]" title="Au moins un RDV simulé"> ~</span>}</> : u.nb_lignes_attente > 0 ? <span className="text-[#C1683C]">{u.sans_reception ? 'sans CDF' : 'RDV à saisir'}</span> : '—'}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5">{u.anticipation_debut ? <><b>{fmtPeriode(u.anticipation_debut, u.anticipation_fin)}</b> · {u.anticipation_palettes} pal.</> : (u.categorie === 'COMPLET' || u.categorie === 'ANTICIPER') ? <span className="text-[#C1683C]">hors fenêtre</span> : '—'}</td>
                          <td className="whitespace-nowrap px-2 py-1.5">{u.reception_debut ? <><b>{fmtPeriode(u.reception_debut, u.reception_fin)}</b> · {u.reception_palettes} pal.{u.reception_type === 'COMPLEMENT' ? ' (compl.)' : ''}</> : '—'}</td>
                          <td className="max-w-[220px] truncate px-2 py-1.5 text-[11px] text-[#5E5A44]" title={(u.containers || []).join(', ')}>{(u.containers || []).join(', ') || '—'}</td>
                        </tr>
                      ))}
                      {filtres.length === 0 && <tr><td colSpan={12} className="px-3 py-6 text-center text-[#8A8474]">Aucun destinataire pour ces filtres.</td></tr>}
                    </tbody>
                    {filtres.length > 0 && (
                      <tfoot className="sticky bottom-0 bg-[#111820] text-[12px] font-bold text-white">
                        <tr>
                          <td className="px-2 py-2" colSpan={3}>Total · {filtres.length} destinataire(s)</td>
                          <td className="px-2 py-2 text-right">{fmtNum(totaux.cdc)} · {fmtNum(totaux.lignes)}</td>
                          <td className="px-2 py-2" />
                          <td className="whitespace-nowrap px-2 py-2 text-right">{fmtNum(totaux.palDispo, 1)} pal. <span className="font-semibold opacity-60">({fmtNum(totaux.lDispo)} l.)</span></td>
                          <td className="whitespace-nowrap px-2 py-2"><span className="rounded bg-white/15 px-1.5">{fmtNum(totaux.geDispo)} GE</span></td>
                          <td className="whitespace-nowrap px-2 py-2 text-right"><span className="mr-1 rounded bg-white/15 px-1.5">{fmtNum(totaux.geAtt)} GE</span>{fmtNum(totaux.palAtt, 1)} pal. <span className="font-semibold opacity-60">({fmtNum(totaux.lAtt)} l.)</span></td>
                          <td className="px-2 py-2" />
                          <td className="whitespace-nowrap px-2 py-2">{fmtNum(totaux.pal1)} pal.</td>
                          <td className="whitespace-nowrap px-2 py-2">{fmtNum(totaux.pal2)} pal.</td>
                          <td className="px-2 py-2" />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </section>
              </>
            )}

            {/* ── Planning FMS ───────────────────────────────────────────── */}
            {vue === 'planning' && (
              <section className="rounded-xl border border-[#E5E1D8] bg-white">
                <div className="flex flex-wrap items-center gap-3 border-b border-[#E5E1D8] px-3 py-2 text-[11.5px] text-[#5E5A44]">
                  <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#7A5EA8]" />Dès maintenant (dispo)</span>
                  <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#1D5C86]" />À réception des containers</span>
                  <span>Plafond {cap} pal./jour · un envoi par destinataire et par jour · cliquer un jour pour le détail</span>
                </div>
                {jours.length === 0 && <div className="px-3 py-6 text-center text-[12.5px] text-[#8A8474]">Aucun envoi planifié.</div>}
                {jours.map((j) => {
                  const total = j.pal1 + j.pal2
                  const ouvert = jourOuvert === j.jour
                  return (
                    <div key={j.jour} className="border-t border-[#F0EDE6] first:border-t-0">
                      <button type="button" onClick={() => setJourOuvert(ouvert ? null : j.jour)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[#FAF9F6]">
                        <span className="w-[90px] text-[12.5px] font-bold">{fmtJour(j.jour)}</span>
                        <div className="relative h-5 flex-1 overflow-hidden rounded bg-[#F4F3F0]">
                          <div className="absolute inset-y-0 left-0 bg-[#7A5EA8]" style={{ width: `${Math.min(100, (j.pal1 / cap) * 100)}%` }} />
                          <div className="absolute inset-y-0 bg-[#1D5C86]" style={{ left: `${Math.min(100, (j.pal1 / cap) * 100)}%`, width: `${Math.min(100 - Math.min(100, (j.pal1 / cap) * 100), (j.pal2 / cap) * 100)}%` }} />
                        </div>
                        <span className={`w-[110px] text-right text-[12.5px] font-bold ${total >= cap ? 'text-[#C1683C]' : ''}`}>{fmtNum(total)} / {cap} pal.</span>
                        <span className="w-[90px] text-right text-[11.5px] text-[#8A8474]">{j.envois.length} envoi(s)</span>
                      </button>
                      {ouvert && (
                        <table className="mb-2 ml-[105px] w-[calc(100%-120px)] text-[12px]">
                          <thead className="text-left text-[10.5px] uppercase text-[#8A8474]">
                            <tr><th className="px-2 py-1">Destinataire</th><th className="px-2 py-1">CP livraison</th><th className="px-2 py-1">Agence</th><th className="px-2 py-1">Type</th><th className="px-2 py-1 text-right">Palettes</th><th className="px-2 py-1">Partie</th></tr>
                          </thead>
                          <tbody>
                            {j.envois.slice().sort((a, b) => b.palettes - a.palettes).map((e, i) => {
                              const u = parCle.get(e.cle)
                              return (
                                <tr key={`${e.cle}-${i}`} className="cursor-pointer border-t border-[#F0EDE6] hover:bg-[#FAF9F6]" onClick={() => u && setFiche(u)}>
                                  <td className="px-2 py-1 font-semibold">{u?.type_destinataire === 'AGENCE' ? '🚚 ' : ''}{u?.libelle || e.cle}</td>
                                  <td className="whitespace-nowrap px-2 py-1">{u?.cp_livraison ? <><b>{u.cp_livraison}</b> <span className="text-[#8A8474]">{u.ville_livraison}</span></> : u?.type_destinataire === 'AGENCE' ? <span className="text-[#8A8474]">agence</span> : '—'}</td>
                                  <td className="px-2 py-1">{u?.agence}</td>
                                  <td className="px-2 py-1">{({ COMPLET: 'Complet', ANTICIPATION: 'Anticipation', COMPLEMENT: 'Complément', UNIQUE: 'Envoi unique' } as Record<string, string>)[e.type_envoi] || e.type_envoi}</td>
                                  <td className="px-2 py-1 text-right font-bold">{e.palettes}</td>
                                  <td className="px-2 py-1 text-[#8A8474]">{e.nb_parties > 1 ? `${e.partie}/${e.nb_parties}` : ''}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )
                })}
              </section>
            )}

            {/* ── Containers & RDV ───────────────────────────────────────── */}
            {vue === 'receptions' && (
              <section className="rounded-xl border border-[#E5E1D8] bg-white">
                <div className="flex flex-wrap items-center gap-2 border-b border-[#E5E1D8] px-3 py-2">
                  <div className="flex rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] p-0.5 text-[12px] font-bold">
                    {([['cont', 'Containers (CONT)'], ['tous', 'Toutes les réceptions FMS']] as ['cont' | 'tous', string][]).map(([k, l]) => (
                      <button key={k} type="button" onClick={() => setContF(k)} className={`rounded-md px-3 py-1 ${contF === k ? 'bg-white shadow-sm' : 'text-[#8A8474]'}`}>{l}</button>
                    ))}
                  </div>
                  <span className="text-[11.5px] text-[#8A8474]">Le RDV de déchargement saisi ici est le même que dans le Portefeuille commandes fournisseurs ; le plan se recalcule après chaque saisie.</span>
                  {calcul && <span className="text-[11.5px] font-semibold text-[#7A5EA8]">Recalcul…</span>}
                </div>
                <div className="overflow-auto">
                  <table className="w-full min-w-[1250px] text-[12px]">
                    <thead className="bg-[#FAF9F6] text-left text-[10.5px] uppercase tracking-wide text-[#8A8474]">
                      <tr>
                        <th className="px-2 py-2">CDF</th><th className="px-2 py-2" title="Référence de la commande fournisseur dans SAGE">Commentaire CDF</th><th className="px-2 py-2">Fournisseur</th><th className="px-2 py-2">Container</th><th className="px-2 py-2">Navire</th>
                        <th className="px-2 py-2">ETA port</th><th className="px-2 py-2">Statut</th><th className="px-2 py-2">RDV déchargement FMS</th><th className="px-2 py-2" title="Réception FMS + 3 jours ouvrés de mise en stock">Dispo expédition</th>
                        <th className="px-2 py-2 text-right">Réf. · pièces</th><th className="px-2 py-2 text-right">Palettes</th><th className="px-2 py-2 text-right" title="Commandes clients (à livrer dans l’horizon du plan) dont le manque est comblé par cette réception">CDC · lignes servies</th><th className="px-2 py-2 text-right">Destinataires</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receptions.map((r) => (
                        <tr key={r.numero_cdf} className={`border-t border-[#F0EDE6] ${r.nb_lignes_cdc === 0 ? 'text-[#8A8474]' : ''}`}>
                          <td className="px-2 py-1.5 font-semibold">{r.numero_cdf}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-[#5B4385]">{r.reference_cdf || '—'}</td>
                          <td className="max-w-[200px] truncate px-2 py-1.5" title={r.fournisseur || ''}>{r.fournisseur}</td>
                          <td className="px-2 py-1.5 font-mono">{r.container || (r.est_cont ? <span className="text-[#C1683C]">n° inconnu</span> : '—')}</td>
                          <td className="max-w-[160px] truncate px-2 py-1.5">{r.navire || '—'}</td>
                          <td className="whitespace-nowrap px-2 py-1.5">{fmtDate(r.eta_port)}</td>
                          <td className="px-2 py-1.5">{r.statut_suivi ? STATUT_SUIVI[r.statut_suivi] || r.statut_suivi : '—'}</td>
                          <td className="px-2 py-1.5"><RdvSaisie key={`${r.numero_cdf}-${r.rdv_date}`} r={r} onSaved={() => void recalculer()} /></td>
                          <td className="whitespace-nowrap px-2 py-1.5">{r.date_dispo ? <>{fmtJour(r.date_dispo)}{r.rdv_simule && <span className="text-[10.5px] font-bold text-[#C1683C]" title={`RDV simulé : ETA + ${meta?.parametres.rdv_simule_jours_apres_eta ?? 5} j ouvrés, puis + ${meta?.parametres.delai_mise_en_stock_jours ?? 3} j de mise en stock`}> simulé</span>}{!r.est_cont && !r.rdv_date && <span className="text-[10.5px] text-[#8A8474]"> (date CDF)</span>}</> : <span className="text-[#C1683C]">inconnue</span>}</td>
                          <td className="px-2 py-1.5 text-right">{r.nb_refs} · {fmtNum(r.qte)}</td>
                          <td className="px-2 py-1.5 text-right">{fmtNum(r.palettes, 1)}</td>
                          <td className="px-2 py-1.5 text-right font-bold">{r.nb_lignes_cdc ? <>{fmtNum(r.nb_cdc)} <span className="font-normal text-[#8A8474]">· {fmtNum(r.nb_lignes_cdc)} l.</span></> : '—'}</td>
                          <td className="px-2 py-1.5 text-right">{r.nb_destinataires || '—'}</td>
                        </tr>
                      ))}
                      {receptions.length === 0 && <tr><td colSpan={13} className="px-3 py-6 text-center text-[#8A8474]">Aucune réception attendue.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Hypothèses */}
            {meta && (
              <details className="rounded-xl border border-[#E5E1D8] bg-white px-4 py-2 text-[12px] text-[#5E5A44]">
                <summary className="cursor-pointer font-bold text-[#111820]">Règles et hypothèses du calcul</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  <li>CDC ouvertes à livrer d’ici le {fmtDate(meta.fin_horizon)} (retards compris). Destinataire = client pour une CDC départ FMS, agence pour une CDC départ agence (palette de transfert multi-clients).</li>
                  <li>CDC départ agence : le stock de l’agence (et de son dépôt transit) et les CDF livrées en direct en agence servent d’abord ; le reste est demandé à FMS.</li>
                  <li>Stock FMS libre (stock − préparé) servi par date de livraison puis ancienneté ; le manque est rattaché à la réception FMS qui le comble.</li>
                  <li>RDV de déchargement = saisi dans le compagnon, sinon RDV confirmé lu dans les commentaires de la CDF SAGE (« Livraison le 13.11 à 13h », « … ⇒ OK FMS ») ; sans RDV : {meta.simuler_rdv ? `simulé à ETA + ${meta.parametres.rdv_simule_jours_apres_eta} jours ouvrés` : 'inconnue (non planifié)'}. Dispo à l’expédition (FMS → client ou agence) {meta.parametres.delai_mise_en_stock_jours} jour(s) ouvré(s) après la réception.</li>
                  <li>Départ FMS : un destinataire par client et par lieu de livraison — les commandes « chez le pro » se regroupent, chaque chantier part à part (lieu de livraison SAGE, modifiable dans la vue agence). Code postal : adresse du client chez le pro, fin de l’adresse du lieu de livraison pour un chantier.</li>
                  <li>Palettes : ECS (ballons TAW…) et groupes extérieurs R/O = 1 par palette, groupes extérieurs R/R = 4 par palette ; sinon volume BLG ÷ {fmtNum(meta.parametres.volume_utile_palette_m3, 1)} m³ utiles, ou poids ÷ {fmtNum(meta.parametres.poids_max_palette_kg)} kg, le plus grand des deux (sans dimensions BLG : médiane de la famille, signalé « dim. ? »).</li>
                  <li>Anticiper si le dispo contient un groupe extérieur ou fait au moins {fmtNum(meta.parametres.seuil_palettes_anticipation, 1)} palette.</li>
                  <li>Groupes extérieurs : {(plan.familles || []).filter((f) => f.role === 'GROUPE_EXT').map((f) => f.famille).join(', ') || '—'} · Cuivre : {(plan.familles || []).filter((f) => f.role === 'CUIVRE').map((f) => f.famille).join(', ') || '—'}.</li>
                </ul>
              </details>
            )}
          </>
        )}
      </div>

      {fiche && <FicheDestinataire key={fiche.cle} u={fiche} onClose={() => setFiche(null)} />}
    </main>
  )
}

export default function PlanExpeditionFmsPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>}>
      <PlanExpeditionFms />
    </Suspense>
  )
}
