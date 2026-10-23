'use client'

/**
 * Écran « Portefeuille commandes fournisseurs » (menu Stocks & logistique, /stock/portefeuille-cdf).
 * ---------------------------------------------------------------------------
 * Créé le 23/10/2026.
 *
 * Distinct du « Calcul de besoin - Appro » (ce qui manque = commandes à lancer) :
 * ici on pilote les commandes fournisseurs DÉJÀ PASSÉES (CDF SAGE ouvertes) pour les
 * fiabiliser — routines de relance, de contrôle et de nettoyage.
 *
 * Alertes (calculées par get_appro_portefeuille_cdf, seuils dans appro_parametres) :
 *  - CONT_SANS_CONTAINER   : CDF « CONT » (containers Asie) à moins de N jours (70) de la
 *                            livraison estimée sans n° de container valide ;
 *  - CONT_CONTAINER_INVALIDE / _ECART / PLUSIEURS : n° faux (chiffre de contrôle ISO 6346),
 *                            n° SAGE ≠ n° saisi, plusieurs containers sur une CDF ;
 *  - CONT_SANS_SUIVI / CONT_SUIVI_ANCIEN : pas de relevé bateau (ETA) ou relevé trop ancien ;
 *  - CONT_MARGE            : marge (date livraison CDF − ETA port) en retard / intenable / très juste ;
 *  - SANS_AR               : CDF à destination de FMS sans statut SAGE « AR OK » après N jours ;
 *  - CDC_A_CONFIRMER       : CDF attendue par des commandes clients, due sous N jours → faire confirmer ;
 *  - DATE_DEPASSEE / SANS_DATE : nettoyage.
 *
 * Suivi bateau : bouton « Suivre » (copie le n° et ouvre le site gratuit de l'armateur),
 * puis saisie manuelle du relevé (navire, port, ETA, statut) — pas d'API payante.
 * « Confirmé » masque une alerte tant que la date de livraison de la CDF ne change pas
 * (au plus cdf_confirmation_validite_jours jours).
 *
 * 23/10/2026 (suite) — relevé semi-automatique du suivi bateau :
 *  - « Suivre » sans armateur connu (préfixe de loueur TLLU, TXGU, TCNU…) propose MSC / CMA CGM / autre ;
 *  - « 📋 Coller le suivi » : lit la page de l'armateur copiée (Ctrl+A, Ctrl+C) et remplit le formulaire
 *    (lib/suiviContainer.ts : MSC, CMA CGM) — l'utilisateur vérifie puis enregistre ;
 *  - favori « Envoyer au compagnon » (PC) : un clic sur la page de l'armateur ouvre cette page avec
 *    #suivi=<texte de la page> ; la CDF est retrouvée par son n° de container et sa fiche s'ouvre pré-remplie.
 *
 * 23/10/2026 (suite 2) — traitement container par container sans attendre :
 *  - après un relevé ou une action, la ligne est mise à jour tout de suite dans la liste et le
 *    portefeuille se recalcule en arrière-plan (plus d'écran « Chargement… ») ;
 *  - « Enregistrer et suivant → » ; ← / → suivent la liste telle qu'elle était à l'ouverture de la fiche ;
 *  - favori : si le compagnon est déjà ouvert, l'onglet ouvert par le favori transmet la page au
 *    compagnon (BroadcastChannel) puis se ferme — la fiche s'ouvre dans l'onglet existant, sans rechargement.
 *
 * Sources : RPC get_appro_portefeuille_cdf / get_appro_cdf_detail ; tables appro_container_releves,
 * appro_cdf_actions, appro_armateurs, appro_cdf_statuts ; sage.cdf_statut et sage.bdcf_commentaires
 * (export TSE à compléter, voir supabase/sql/20261023_export_sage_cdf_complements.sql).
 * Migration requise : supabase/sql/20261023_portefeuille_cdf.sql.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'
import { lireSuiviContainer, type SuiviLu } from '@/lib/suiviContainer'

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type CodeAlerte =
  | 'CONT_SANS_CONTAINER' | 'CONT_CONTAINER_INVALIDE' | 'CONT_CONTAINER_ECART' | 'CONT_PLUSIEURS_CONTAINERS'
  | 'CONT_SANS_SUIVI' | 'CONT_SUIVI_ANCIEN' | 'CONT_MARGE' | 'SANS_AR' | 'CDC_A_CONFIRMER' | 'DATE_DEPASSEE' | 'SANS_DATE'
type Verdict = 'RETARD' | 'INTENABLE' | 'TRES_JUSTE' | 'JUSTE' | 'OK'
type StatutSuivi = 'booke' | 'embarque' | 'en_mer' | 'arrive' | 'decharge' | 'livre'

type Ligne = {
  numero: string
  fournisseur_code: string | null; fournisseur_nom: string | null
  reference: string | null; depot: string | null; est_fms: boolean; est_cont: boolean
  date_commande: string | null; date_livraison: string | null; age_jours: number | null; jours_avant_livraison: number | null
  nb_lignes: number; qte: number; montant_ht: number
  statut_code: number | null; statut_libelle: string | null; ar_recu: boolean | null
  commentaires: string[]
  container: string | null; container_source: 'sage' | 'saisie' | null; container_valide: boolean | null
  container_saisi: string | null; containers_invalides: string[]
  armateur: string | null; armateur_suggere: string | null; navire: string | null; port_arrivee: string | null
  eta_port: string | null; statut_suivi: StatutSuivi | null; commentaire_suivi: string | null
  releve_le: string | null; releve_par: string | null; nb_releves: number
  marge_jours: number | null; verdict: Verdict | null
  nb_cdc: number; nb_cdc_tardives: number; qte_cdc: number | null; premiere_livraison_cdc: string | null
  alertes: CodeAlerte[]; alertes_confirmees: CodeAlerte[]
  derniere_action: { action: string; alerte_code: string | null; commentaire: string | null; le: string; par: string | null } | null
}
type Armateur = { code: string; nom: string; url_suivi: string }
type Parametres = {
  cont_alerte_jours_avant: number; cont_releve_max_jours: number; marge_intenable: number; marge_tres_juste: number
  marge_juste: number; sans_ar_jours: number; relance_cdc_horizon_jours: number; confirmation_validite_jours: number
}
type Reponse = {
  genere_le: string; import_sage_le: string | null
  sources: { statut_ar: boolean; commentaires: boolean }
  parametres: Parametres; armateurs: Armateur[]; rows: Ligne[]
}
type Detail = {
  lignes: { ligne: string; reference_article: string; designation: string; quantite: number; montant_ht: number; date_livraison: string | null }[]
  commentaires: string[]
  cdc: { numero_document: string; nom_tiers: string | null; numero_tiers: string | null; representant: string | null; agence: string | null
    reference_article: string; quantite: number; date_livraison: string | null; statut_couverture: string; retard_estime_jours: number | null }[]
  releves: { id: number; container_numero: string | null; armateur: string | null; navire: string | null; port_arrivee: string | null
    eta_port: string | null; statut: StatutSuivi | null; commentaire: string | null; created_at: string; created_by: string | null }[]
  actions: { id: number; alerte_code: string | null; action: string; commentaire: string | null; date_livraison_ref: string | null; created_at: string; created_by: string | null }[]
}

// ─────────────────────────────────────────────────────────────────────────
// Libellés & styles
// ─────────────────────────────────────────────────────────────────────────

const ALERTE: Record<CodeAlerte, { label: string; cls: string; title: string; attendu: string }> = {
  CONT_SANS_CONTAINER: { label: 'Sans n° container', cls: 'bg-red-600 text-white', title: 'Commande container à moins de 9–10 semaines de la livraison sans n° de container', attendu: 'Demander le n° de container et le booking au fournisseur, puis le saisir en commentaire de la CDF dans SAGE.' },
  CONT_CONTAINER_INVALIDE: { label: 'N° container faux', cls: 'bg-red-50 text-red-700', title: 'Le n° ne respecte pas la norme ISO 6346 (chiffre de contrôle)', attendu: 'Corriger le n° de container dans SAGE (faute de frappe probable).' },
  CONT_CONTAINER_ECART: { label: 'N° SAGE ≠ saisi', cls: 'bg-orange-100 text-orange-800', title: 'Le n° lu dans SAGE diffère de celui saisi dans le suivi', attendu: 'Vérifier le bon n° et corriger SAGE ou le suivi.' },
  CONT_PLUSIEURS_CONTAINERS: { label: 'Plusieurs containers', cls: 'bg-orange-100 text-orange-800', title: 'Plusieurs n° de container valides sur la même CDF', attendu: 'Vérifier : une CDF = un container a priori.' },
  CONT_SANS_SUIVI: { label: 'Suivi bateau à faire', cls: 'bg-[#B4761A]/[0.14] text-[#8A5A08]', title: 'N° de container connu mais aucun relevé navire / ETA', attendu: 'Cliquer sur « Suivre », relever navire et ETA port, puis « Mettre à jour le suivi ».' },
  CONT_SUIVI_ANCIEN: { label: 'Suivi à rafraîchir', cls: 'bg-[#B4761A]/[0.14] text-[#8A5A08]', title: 'Dernier relevé trop ancien alors que le bateau n’est pas arrivé', attendu: 'Refaire un relevé sur le site de l’armateur.' },
  CONT_MARGE: { label: 'Marge critique', cls: 'bg-red-50 text-red-700', title: 'ETA port trop proche ou après la date de livraison de la CDF', attendu: 'Recaler la date de livraison de la CDF et prévenir les commandes clients concernées.' },
  SANS_AR: { label: 'Sans AR', cls: 'bg-red-50 text-red-700', title: 'CDF à destination de FMS sans statut « AR OK » après N jours', attendu: 'Relancer le fournisseur pour obtenir l’AR, puis passer la CDF en « AR OK » dans SAGE.' },
  CDC_A_CONFIRMER: { label: 'CDC attendent', cls: 'bg-sky-50 text-sky-800', title: 'Des commandes clients attendent cette CDF, due bientôt', attendu: 'Faire confirmer la date au fournisseur ; si elle glisse, recaler la CDF et prévenir les clients.' },
  DATE_DEPASSEE: { label: 'Date dépassée', cls: 'bg-red-50 text-red-700', title: 'Date de livraison passée, CDF toujours ouverte', attendu: 'Réceptionner, recaler la date ou solder la CDF.' },
  SANS_DATE: { label: 'Sans date', cls: 'bg-violet-100 text-violet-900', title: 'Aucune date de livraison sur la CDF', attendu: 'Saisir la date de livraison prévue dans SAGE.' },
}
const ORDRE_ALERTES: CodeAlerte[] = ['CONT_SANS_CONTAINER', 'CONT_MARGE', 'SANS_AR', 'DATE_DEPASSEE', 'CDC_A_CONFIRMER', 'CONT_SANS_SUIVI', 'CONT_SUIVI_ANCIEN',
  'CONT_CONTAINER_INVALIDE', 'CONT_CONTAINER_ECART', 'CONT_PLUSIEURS_CONTAINERS', 'SANS_DATE']

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  RETARD: { label: 'En retard', cls: 'bg-red-600 text-white' },
  INTENABLE: { label: 'Intenable', cls: 'bg-orange-500 text-white' },
  TRES_JUSTE: { label: 'Très juste', cls: 'bg-orange-100 text-orange-800' },
  JUSTE: { label: 'Juste', cls: 'bg-yellow-100 text-yellow-800' },
  OK: { label: 'OK', cls: 'bg-emerald-50 text-emerald-700' },
}
const STATUT_SUIVI: Record<StatutSuivi, string> = {
  booke: 'Booké', embarque: 'Embarqué', en_mer: 'En mer', arrive: 'Arrivé au port', decharge: 'Déchargé', livre: 'Livré FMS',
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function fmtNum(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(String(v).length === 10 ? `${v}T12:00:00` : v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR')
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
/** Contrôle ISO 6346 (même règle que appro_container_valide côté SQL). */
function containerValide(v: string): boolean {
  const s = v.toUpperCase().replace(/[\s\-./]/g, '')
  if (!/^[A-Z]{3}[UJZ][0-9]{7}$/.test(s)) return false
  let total = 0
  for (let i = 0; i < 10; i++) {
    const c = s[i]
    let val: number
    if (/[0-9]/.test(c)) val = Number(c)
    else { const n = c.charCodeAt(0) - 55; val = n + Math.floor((n - 1) / 10) }
    total += val * 2 ** i
  }
  return (total % 11) % 10 === Number(s[10])
}
function libelleJours(j: number | null): string {
  if (j === null || j === undefined) return ''
  if (j === 0) return 'aujourd’hui'
  return j > 0 ? `J−${j}` : `J+${-j}`
}

// ─────────────────────────────────────────────────────────────────────────
// Petits composants
// ─────────────────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, tone, onClick, actif, title }: {
  label: string; value: string; sub?: string; tone?: 'alerte' | 'warn' | 'ok' | 'violet' | 'info'; onClick?: () => void; actif?: boolean; title?: string
}) {
  const color = tone === 'alerte' ? '#B42318' : tone === 'warn' ? '#B4761A' : tone === 'ok' ? '#3F9142' : tone === 'violet' ? '#7A5EA8' : tone === 'info' ? '#1D5C86' : '#111820'
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

function ouvrirSuivi(container: string | null, armateurCode: string | null, armateurs: Armateur[]) {
  const a = armateurs.find((x) => x.code === armateurCode) || armateurs.find((x) => x.code === 'AUTRE') || armateurs[0]
  if (!a) return
  try { sessionStorage.setItem('portefeuille-cdf:dernier-suivi', container || '') } catch { /* stockage indisponible */ }
  if (container) { try { void navigator.clipboard?.writeText(container) } catch { /* presse-papiers indisponible */ } }
  const url = a.url_suivi.includes('{container}') ? a.url_suivi.replace('{container}', encodeURIComponent(container || '')) : a.url_suivi
  window.open(url, '_blank', 'noopener,noreferrer')
}

// ─────────────────────────────────────────────────────────────────────────
// Fenêtre CDF
// ─────────────────────────────────────────────────────────────────────────

const LIBELLE_ARMATEUR: Record<string, string> = { MSC: 'MSC', CMA: 'CMA CGM' }

type FormSuivi = {
  container: string; armateur: string; navire: string; port_arrivee: string
  eta_port: string; statut: StatutSuivi | ''; commentaire: string
}
/** Reporte dans le formulaire les champs lus sur la page de l'armateur (les autres restent inchangés). */
function appliquerLecture(f: FormSuivi, r: SuiviLu): FormSuivi {
  return {
    ...f,
    container: r.container || f.container,
    armateur: r.armateur || f.armateur,
    navire: r.navire || f.navire,
    port_arrivee: r.port_arrivee || f.port_arrivee,
    eta_port: r.eta_port || f.eta_port,
    statut: r.statut || f.statut,
    commentaire: r.voyage && !f.commentaire ? `Voyage ${r.voyage}${r.dernier_evenement ? ` · ${r.dernier_evenement}` : ''}` : f.commentaire,
  }
}

/** Favori « Envoyer au compagnon » : envoie le texte de la page de suivi en fragment d'URL (#suivi=…),
 * jamais transmis au serveur, et ouvre l'écran dans un nouvel onglet. */
function codeFavori(origine: string): string {
  return `javascript:(function(){var t=(document.body.innerText||'').slice(0,20000);`
    + `window.open('${origine}/stock/portefeuille-cdf#suivi='+encodeURIComponent(t),'_blank');})();`
}
function LienFavori() {
  const ref = React.useRef<HTMLAnchorElement | null>(null)
  useEffect(() => {
    // React bloque les href « javascript: » écrits en JSX : on pose l'attribut après le rendu
    if (ref.current) ref.current.setAttribute('href', codeFavori(window.location.origin))
  }, [])
  return (
    <a ref={ref} onClick={(e) => e.preventDefault()} draggable
      title="Glissez ce bouton dans la barre de favoris de Chrome. Ensuite, sur la page de suivi MSC ou CMA CGM, cliquez sur le favori : la fiche de la CDF s’ouvre pré-remplie."
      className="inline-flex h-10 cursor-grab items-center rounded-lg border border-dashed border-[#1D5C86] bg-[#1D5C86]/[0.06] px-3 text-[12.5px] font-bold text-[#1D5C86]">
      ⭐ Envoyer au compagnon
    </a>
  )
}

function CdfModal({ ligne, armateurs, parametres, onClose, onSaved, position, onPrev, onNext, prefill }: {
  ligne: Ligne; armateurs: Armateur[]; parametres: Parametres | null
  onClose: () => void; onSaved: (patch: Partial<Ligne>) => void; position: string | null; onPrev?: () => void; onNext?: () => void
  prefill?: SuiviLu | null
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const [f, setF] = useState(() => {
    const base = {
      container: ligne.container || '',
      armateur: ligne.armateur || ligne.armateur_suggere || '',
      navire: ligne.navire || '',
      port_arrivee: ligne.port_arrivee || 'FOS',
      eta_port: ligne.eta_port || '',
      statut: (ligne.statut_suivi || '') as StatutSuivi | '',
      commentaire: '',
    }
    return prefill ? appliquerLecture(base, prefill) : base
  })
  const [lu, setLu] = useState<SuiviLu | null>(prefill || null)
  const [choixArmateur, setChoixArmateur] = useState(false)
  const [collerManuel, setCollerManuel] = useState(false)
  const [texteColle, setTexteColle] = useState('')

  function appliquer(texte: string) {
    const r = lireSuiviContainer(texte)
    setLu(r)
    if (r.champs_lus === 0 && !r.armateur) {
      setErreur('Page non reconnue : copiez toute la page de suivi MSC ou CMA CGM (Ctrl+A puis Ctrl+C), puis recommencez.')
      return
    }
    setErreur(null)
    setF((x) => appliquerLecture(x, r))
    setCollerManuel(false); setTexteColle('')
  }
  async function collerSuivi() {
    setOk(null)
    try {
      const texte = await navigator.clipboard.readText()
      if (texte && texte.trim().length > 20) { appliquer(texte); return }
    } catch { /* lecture du presse-papiers refusée : saisie manuelle */ }
    setCollerManuel(true)
  }
  function suivre() {
    const c = f.container || ligne.container
    if (!f.armateur) { setChoixArmateur((v) => !v); return }
    ouvrirSuivi(c, f.armateur, armateurs)
  }
  const [actionAlerte, setActionAlerte] = useState<CodeAlerte | ''>(ligne.alertes[0] || '')
  const [actionCommentaire, setActionCommentaire] = useState('')

  const charger = useCallback(async () => {
    setLoading(true); setErreur(null)
    const { data, error } = await supabase.rpc('get_appro_cdf_detail', { p_numero: ligne.numero })
    if (error) setErreur(messageErreur(error)); else setDetail(data as Detail)
    setLoading(false)
  }, [ligne.numero])
  useEffect(() => { void charger() }, [charger])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName && ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && onPrev) onPrev()
      if (e.key === 'ArrowRight' && onNext) onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  const containerSaisiOk = !f.container.trim() || containerValide(f.container)
  const marge = f.eta_port && ligne.date_livraison
    ? Math.round((new Date(`${ligne.date_livraison}T12:00:00`).getTime() - new Date(`${f.eta_port}T12:00:00`).getTime()) / 86400000)
    : null
  const verdictPrevu: Verdict | null = marge === null || !parametres ? null
    : marge < 0 ? 'RETARD' : marge <= parametres.marge_intenable ? 'INTENABLE' : marge <= parametres.marge_tres_juste ? 'TRES_JUSTE' : marge <= parametres.marge_juste ? 'JUSTE' : 'OK'

  async function enregistrerReleve(suivant = false) {
    setSaving(true); setErreur(null); setOk(null)
    const cont = f.container.trim() ? f.container.toUpperCase().replace(/[\s\-./]/g, '') : null
    const { error } = await supabase.from('appro_container_releves').insert({
      cdf_numero: ligne.numero,
      container_numero: cont,
      armateur: f.armateur || null,
      navire: f.navire.trim() || null,
      port_arrivee: f.port_arrivee.trim() || null,
      eta_port: f.eta_port || null,
      statut: f.statut || null,
      commentaire: f.commentaire.trim() || null,
    })
    setSaving(false)
    if (error) { setErreur(messageErreur(error)); return }
    // Mise à jour immédiate de la ligne dans la liste (le portefeuille se recalcule en arrière-plan)
    const containerRetenu = ligne.container_source === 'sage' ? ligne.container : cont
    const alertes = ligne.alertes.filter((a) => !['CONT_SANS_SUIVI', 'CONT_SUIVI_ANCIEN', 'CONT_MARGE'].includes(a)
      && !(a === 'CONT_SANS_CONTAINER' && containerRetenu && containerValide(containerRetenu))
      && !(a === 'CONT_CONTAINER_INVALIDE' && containerRetenu && containerValide(containerRetenu)))
    if (verdictPrevu && ['RETARD', 'INTENABLE', 'TRES_JUSTE'].includes(verdictPrevu)) alertes.push('CONT_MARGE')
    onSaved({
      container: containerRetenu,
      container_source: ligne.container_source || (cont ? 'saisie' : null),
      container_valide: containerRetenu ? containerValide(containerRetenu) : null,
      container_saisi: cont,
      armateur: f.armateur || null, navire: f.navire.trim() || null, port_arrivee: f.port_arrivee.trim() || null,
      eta_port: f.eta_port || null, statut_suivi: f.statut || null, commentaire_suivi: f.commentaire.trim() || null,
      releve_le: new Date().toISOString(), releve_par: 'vous', nb_releves: ligne.nb_releves + 1,
      marge_jours: marge, verdict: verdictPrevu, alertes,
    })
    if (suivant && onNext) { onNext(); return }
    setOk('Suivi enregistré.'); setF((x) => ({ ...x, commentaire: '' }))
    void charger()
  }

  async function enregistrerAction(action: 'relance' | 'confirme' | 'commentaire') {
    if (action === 'commentaire' && !actionCommentaire.trim()) { setErreur('Saisir un commentaire.'); return }
    setSaving(true); setErreur(null); setOk(null)
    const { error } = await supabase.from('appro_cdf_actions').insert({
      cdf_numero: ligne.numero,
      alerte_code: actionAlerte || null,
      action,
      commentaire: actionCommentaire.trim() || null,
      date_livraison_ref: ligne.date_livraison,
    })
    setSaving(false)
    if (error) { setErreur(messageErreur(error)); return }
    setOk(action === 'confirme' ? 'Alerte confirmée : masquée tant que la date de livraison ne change pas.' : action === 'relance' ? 'Relance tracée.' : 'Commentaire ajouté.')
    const confirmee = action === 'confirme' && actionAlerte ? actionAlerte : null
    onSaved({
      derniere_action: { action, alerte_code: actionAlerte || null, commentaire: actionCommentaire.trim() || null, le: new Date().toISOString(), par: 'vous' },
      ...(confirmee ? {
        alertes: ligne.alertes.filter((a) => a !== confirmee),
        alertes_confirmees: Array.from(new Set([...ligne.alertes_confirmees, confirmee])),
      } : {}),
    })
    setActionCommentaire('')
    void charger()
  }

  const ctl = 'h-8 w-full min-w-0 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const commentaires = detail?.commentaires?.length ? detail.commentaires : ligne.commentaires

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-3" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-[1250px] flex-col overflow-hidden rounded-2xl bg-[#F4F3F0] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* En-tête */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E5E1D8] bg-white px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">Commande fournisseur{ligne.est_cont ? ' · container' : ''}</p>
            <h2 className="text-[19px] font-bold leading-tight">{ligne.numero} · {ligne.reference || '—'}</h2>
            <p className="text-[12px] text-[#8A8474]">
              {ligne.fournisseur_code} {ligne.fournisseur_nom || ''} · dépôt {ligne.depot || '—'} · commandée le {fmtDate(ligne.date_commande)}
              {' '}· livraison {fmtDate(ligne.date_livraison)} {ligne.jours_avant_livraison !== null && <b>({libelleJours(ligne.jours_avant_livraison)})</b>}
              {' '}· {fmtNum(ligne.nb_lignes)} lignes · {fmtNum(ligne.qte)} pièces · {fmtNum(ligne.montant_ht)} € HT
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {ligne.statut_libelle && <Badge cls={ligne.ar_recu ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}>{ligne.statut_libelle}</Badge>}
              {ligne.alertes.map((a) => <Badge key={a} cls={ALERTE[a].cls} title={ALERTE[a].title}>{ALERTE[a].label}</Badge>)}
              {ligne.alertes_confirmees.map((a) => <Badge key={`c-${a}`} cls="bg-[#E5E1D8] text-[#5E5A44] line-through" title="Confirmée">{ALERTE[a].label}</Badge>)}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {position && <span className="text-[11px] font-semibold text-[#8A8474]">{position}</span>}
            <button type="button" onClick={onPrev} disabled={!onPrev} className="h-8 rounded-md border border-[#E5E1D8] bg-white px-2 text-[13px] font-bold disabled:opacity-30">←</button>
            <button type="button" onClick={onNext} disabled={!onNext} className="h-8 rounded-md border border-[#E5E1D8] bg-white px-2 text-[13px] font-bold disabled:opacity-30">→</button>
            <button type="button" onClick={onClose} className="h-8 rounded-md bg-[#111820] px-3 text-[13px] font-bold text-white">Fermer</button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 lg:grid-cols-2">
          {erreur && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-800 lg:col-span-2">{erreur}</div>}
          {ok && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] font-semibold text-emerald-800 lg:col-span-2">{ok}</div>}

          {/* Ce qui est attendu */}
          {ligne.alertes.length > 0 && (
            <section className="rounded-xl border border-[#E5E1D8] bg-white p-3 lg:col-span-2">
              <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Ce qui est attendu</h3>
              <ul className="space-y-1 text-[12.5px]">
                {ligne.alertes.map((a) => (
                  <li key={a} className="flex gap-2"><Badge cls={ALERTE[a].cls}>{ALERTE[a].label}</Badge><span>{ALERTE[a].attendu}</span></li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-[#8A8474]">Les corrections faites dans SAGE suppriment l’alerte à la prochaine synchronisation.</p>
            </section>
          )}

          {/* Container & suivi bateau */}
          {(ligne.est_cont || ligne.container) && (
            <section className="rounded-xl border border-[#E5E1D8] bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Container & suivi bateau</h3>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={suivre}
                    disabled={!f.container && !ligne.container}
                    title="Copie le n° de container et ouvre le site de suivi de l’armateur (collez le n° si la page le demande)"
                    className="h-8 rounded-lg bg-[#1D5C86] px-3 text-[12.5px] font-bold text-white disabled:opacity-40">🔗 Suivre</button>
                  <button type="button" onClick={() => void collerSuivi()}
                    title="Sur la page de l’armateur : Ctrl+A puis Ctrl+C, puis cliquez ici — le formulaire se remplit, vous vérifiez avant d’enregistrer"
                    className="h-8 rounded-lg border border-[#1D5C86] bg-white px-3 text-[12.5px] font-bold text-[#1D5C86]">📋 Coller le suivi</button>
                </div>
              </div>
              {choixArmateur && !f.armateur && (
                <div className="mb-2 rounded-lg border border-[#1D5C86]/30 bg-[#1D5C86]/[0.06] px-2.5 py-2 text-[12px]">
                  <div className="mb-1 font-semibold text-[#1D5C86]">Container de loueur : armateur à choisir (le n° est copié, collez-le sur la page)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {armateurs.filter((a) => ['MSC', 'CMA', 'AUTRE'].includes(a.code)).map((a) => (
                      <button key={a.code} type="button"
                        onClick={() => { setF((x) => ({ ...x, armateur: a.code === 'AUTRE' ? x.armateur : a.code })); setChoixArmateur(false); ouvrirSuivi(f.container || ligne.container, a.code, armateurs) }}
                        className="h-7 rounded-md border border-[#E5E1D8] bg-white px-2.5 text-[12px] font-bold">{a.nom}</button>
                    ))}
                  </div>
                </div>
              )}
              {collerManuel && (
                <div className="mb-2 rounded-lg border border-[#E5E1D8] bg-[#FAF8F3] p-2 text-[12px]">
                  <div className="mb-1 font-semibold">Collez ici la page de suivi (Ctrl+V) :</div>
                  <textarea autoFocus value={texteColle} onChange={(e) => setTexteColle(e.target.value)}
                    onPaste={(e) => { const v = e.clipboardData.getData('text'); if (v) { e.preventDefault(); appliquer(v) } }}
                    className="h-20 w-full rounded-md border border-[#E5E1D8] bg-white p-1.5 font-mono text-[11px]" placeholder="Ctrl+V" />
                  <div className="mt-1 flex justify-end gap-1.5">
                    <button type="button" onClick={() => setCollerManuel(false)} className="h-7 rounded-md border border-[#E5E1D8] bg-white px-2.5 text-[12px] font-bold">Annuler</button>
                    <button type="button" onClick={() => appliquer(texteColle)} disabled={!texteColle.trim()} className="h-7 rounded-md bg-[#111820] px-2.5 text-[12px] font-bold text-white disabled:opacity-40">Lire</button>
                  </div>
                </div>
              )}
              {lu && lu.champs_lus > 0 && (
                <div className={`mb-2 rounded-lg px-2.5 py-1.5 text-[12px] ${lu.container && f.container && lu.container !== f.container.replace(/\s/g, '').toUpperCase() ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
                  <b>Lu sur la page {lu.armateur ? LIBELLE_ARMATEUR[lu.armateur] : 'de suivi'}</b> : {[lu.container, lu.navire && `${lu.navire}${lu.voyage ? ` (${lu.voyage})` : ''}`, lu.port_arrivee, lu.eta_port && `ETA ${fmtDate(lu.eta_port)}`, lu.dernier_evenement].filter(Boolean).join(' · ')}
                  {lu.container && ligne.container && lu.container !== ligne.container
                    ? <div className="font-bold">⚠ Ce n’est pas le container de cette CDF ({ligne.container}) — vérifiez avant d’enregistrer.</div>
                    : <div>Vérifiez les champs remplis puis cliquez sur « Mettre à jour le suivi ».</div>}
                </div>
              )}
              <div className="mb-2 rounded-lg bg-[#F4F3F0] px-2.5 py-1.5 text-[12px]">
                {ligne.container
                  ? <>N° retenu <b className="font-mono">{ligne.container}</b> ({ligne.container_source === 'sage' ? 'lu dans SAGE' : 'saisi dans l’app'})
                    {ligne.container_valide === false && <span className="ml-1 font-bold text-red-700">· chiffre de contrôle faux</span>}</>
                  : <span className="font-semibold text-red-700">Aucun n° de container valide dans SAGE ni dans le suivi.</span>}
                {ligne.containers_invalides.length > 0 && <div className="text-red-700">N° invalides lus dans SAGE : {ligne.containers_invalides.join(', ')}</div>}
                {ligne.eta_port && <div>ETA port {fmtDate(ligne.eta_port)}{ligne.navire ? ` · ${ligne.navire}` : ''}{ligne.statut_suivi ? ` · ${STATUT_SUIVI[ligne.statut_suivi]}` : ''} · relevé le {fmtDateHeure(ligne.releve_le)}{ligne.releve_par ? ` par ${ligne.releve_par}` : ''}</div>}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                <label className="space-y-0.5">
                  <span className="font-bold text-[#5E5A44]">N° de container</span>
                  <input className={`${ctl} font-mono ${containerSaisiOk ? '' : 'border-red-400 text-red-700'}`} value={f.container}
                    onChange={(e) => setF({ ...f, container: e.target.value.toUpperCase() })} placeholder="MSCU1234565" />
                  {!containerSaisiOk && <span className="text-[10.5px] font-semibold text-red-700">Chiffre de contrôle ISO 6346 incorrect</span>}
                </label>
                <label className="space-y-0.5">
                  <span className="font-bold text-[#5E5A44]">Armateur</span>
                  <select className={ctl} value={f.armateur} onChange={(e) => setF({ ...f, armateur: e.target.value })}>
                    <option value="">— à choisir —</option>
                    {armateurs.map((a) => <option key={a.code} value={a.code}>{a.nom}</option>)}
                  </select>
                  {!ligne.armateur && !ligne.armateur_suggere && f.container && <span className="text-[10.5px] text-[#8A8474]">Préfixe de loueur : armateur à choisir</span>}
                </label>
                <label className="space-y-0.5"><span className="font-bold text-[#5E5A44]">Navire</span>
                  <input className={ctl} value={f.navire} onChange={(e) => setF({ ...f, navire: e.target.value })} placeholder="CMA CGM Kerguelen" /></label>
                <label className="space-y-0.5"><span className="font-bold text-[#5E5A44]">Port d’arrivée</span>
                  <input className={ctl} value={f.port_arrivee} onChange={(e) => setF({ ...f, port_arrivee: e.target.value })} /></label>
                <label className="space-y-0.5"><span className="font-bold text-[#5E5A44]">ETA port</span>
                  <input type="date" className={ctl} value={f.eta_port} onChange={(e) => setF({ ...f, eta_port: e.target.value })} />
                  {verdictPrevu && <span className="text-[10.5px]">Marge {marge} j → <Badge cls={VERDICT[verdictPrevu].cls}>{VERDICT[verdictPrevu].label}</Badge></span>}
                </label>
                <label className="space-y-0.5"><span className="font-bold text-[#5E5A44]">Statut</span>
                  <select className={ctl} value={f.statut} onChange={(e) => setF({ ...f, statut: e.target.value as StatutSuivi | '' })}>
                    <option value="">—</option>
                    {(Object.keys(STATUT_SUIVI) as StatutSuivi[]).map((s) => <option key={s} value={s}>{STATUT_SUIVI[s]}</option>)}
                  </select></label>
                <label className="col-span-2 space-y-0.5"><span className="font-bold text-[#5E5A44]">Commentaire</span>
                  <input className={ctl} value={f.commentaire} onChange={(e) => setF({ ...f, commentaire: e.target.value })} placeholder="ex. transbordement à Port Klang" /></label>
              </div>
              <div className="mt-2 flex justify-end gap-1.5">
                <button type="button" onClick={() => void enregistrerReleve()} disabled={saving || !containerSaisiOk}
                  className="h-9 rounded-lg bg-[#111820] px-4 text-[12.5px] font-bold text-white disabled:opacity-40">
                  {saving ? '…' : 'Mettre à jour le suivi'}
                </button>
                {onNext && (
                  <button type="button" onClick={() => void enregistrerReleve(true)} disabled={saving || !containerSaisiOk}
                    title="Enregistre le relevé et ouvre la CDF suivante de la liste"
                    className="h-9 rounded-lg bg-[#1D5C86] px-4 text-[12.5px] font-bold text-white disabled:opacity-40">
                    {saving ? '…' : 'Enregistrer et suivant →'}
                  </button>
                )}
              </div>
              {(detail?.releves?.length || 0) > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto border-t border-[#E5E1D8] pt-2">
                  <table className="w-full text-[11px]">
                    <thead><tr className="text-left text-[#8A8474]"><th className="px-1">Le</th><th className="px-1">Par</th><th className="px-1">Container</th><th className="px-1">Navire</th><th className="px-1">ETA</th><th className="px-1">Statut</th><th className="px-1">Commentaire</th></tr></thead>
                    <tbody>{detail!.releves.map((r) => (
                      <tr key={r.id} className="border-t border-[#F0EDE6]">
                        <td className="whitespace-nowrap px-1">{fmtDateHeure(r.created_at)}</td><td className="px-1">{r.created_by?.split('@')[0] || '—'}</td>
                        <td className="px-1 font-mono">{r.container_numero || '—'}</td><td className="px-1">{[r.armateur, r.navire].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="whitespace-nowrap px-1">{fmtDate(r.eta_port)}</td><td className="px-1">{r.statut ? STATUT_SUIVI[r.statut] : '—'}</td><td className="px-1">{r.commentaire || ''}</td>
                      </tr>))}</tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Commentaires SAGE */}
          <section className="rounded-xl border border-[#E5E1D8] bg-white p-3">
            <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Commentaires de la CDF (SAGE)</h3>
            {commentaires.length
              ? <ul className="space-y-0.5 text-[12.5px] italic text-[#3A362E]">{commentaires.map((c, i) => <li key={i}>{c}</li>)}</ul>
              : <p className="text-[12px] text-[#8A8474]">Aucun commentaire remonté de SAGE.</p>}
          </section>

          {/* Traitement des alertes */}
          <section className="rounded-xl border border-[#E5E1D8] bg-white p-3">
            <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Relance & confirmation fournisseur</h3>
            <div className="grid gap-2 text-[11.5px]">
              <select className={ctl} value={actionAlerte} onChange={(e) => setActionAlerte(e.target.value as CodeAlerte | '')}>
                <option value="">Toute la CDF</option>
                {[...ligne.alertes, ...ligne.alertes_confirmees].map((a) => <option key={a} value={a}>{ALERTE[a].label}</option>)}
              </select>
              <input className={ctl} value={actionCommentaire} onChange={(e) => setActionCommentaire(e.target.value)} placeholder="ex. confirmé par Stéphanie, expé 10.11" />
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => void enregistrerAction('relance')} disabled={saving} className="h-8 rounded-md border border-[#E5E1D8] bg-white px-3 text-[12px] font-bold disabled:opacity-40">📨 Relancé</button>
                <button type="button" onClick={() => void enregistrerAction('confirme')} disabled={saving || !actionAlerte}
                  title={parametres ? `Masque l’alerte tant que la date de livraison ne change pas (au plus ${parametres.confirmation_validite_jours} j)` : ''}
                  className="h-8 rounded-md bg-emerald-700 px-3 text-[12px] font-bold text-white disabled:opacity-40">✓ Confirmé</button>
                <button type="button" onClick={() => void enregistrerAction('commentaire')} disabled={saving} className="h-8 rounded-md border border-[#E5E1D8] bg-white px-3 text-[12px] font-bold disabled:opacity-40">💬 Commentaire</button>
              </div>
            </div>
            {(detail?.actions?.length || 0) > 0 && (
              <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto border-t border-[#E5E1D8] pt-2 text-[11.5px]">
                {detail!.actions.map((a) => (
                  <li key={a.id}>
                    <b>{fmtDateHeure(a.created_at)}</b> · {a.created_by?.split('@')[0] || '—'} · {a.action === 'confirme' ? '✓ confirmé' : a.action === 'relance' ? '📨 relancé' : '💬'}
                    {a.alerte_code && <> · {ALERTE[a.alerte_code as CodeAlerte]?.label || a.alerte_code}</>}
                    {a.commentaire && <> — {a.commentaire}</>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* CDC qui attendent la CDF */}
          <section className="rounded-xl border border-[#E5E1D8] bg-white p-3 lg:col-span-2">
            <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Commandes clients qui ont besoin de cette CDF</h3>
            <p className="mb-1.5 text-[11px] text-[#8A8474]">Seules les commandes que le stock et les réceptions précédentes ne couvrent pas (réceptions servies dans l’ordre des dates).</p>
            {loading ? <p className="text-[12px] text-[#8A8474]">Chargement…</p> : !detail?.cdc?.length ? <p className="text-[12px] text-[#8A8474]">Aucune commande client n’a besoin de cette réception : le stock et les réceptions précédentes suffisent.</p> : (
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-[11.5px]">
                  <thead className="sticky top-0 bg-white"><tr className="text-left text-[#8A8474]"><th className="px-1.5 py-1">CDC</th><th className="px-1.5">Client</th><th className="px-1.5">Représentant</th><th className="px-1.5">Référence</th><th className="px-1.5 text-right">Qté</th><th className="px-1.5">Livraison</th><th className="px-1.5">Couverture</th></tr></thead>
                  <tbody>{detail.cdc.map((c, i) => (
                    <tr key={`${c.numero_document}-${c.reference_article}-${i}`} className="border-t border-[#F0EDE6]">
                      <td className="px-1.5 py-0.5 font-semibold">{c.numero_document}</td><td className="px-1.5">{c.nom_tiers || c.numero_tiers}</td>
                      <td className="px-1.5">{c.representant || '—'}</td><td className="px-1.5">{c.reference_article}</td>
                      <td className="px-1.5 text-right">{fmtNum(c.quantite)}</td><td className="whitespace-nowrap px-1.5">{fmtDate(c.date_livraison)}</td>
                      <td className="px-1.5">{c.statut_couverture === 'RECEPTION_TARDIVE'
                        ? <Badge cls="bg-orange-100 text-orange-800">Réception tardive{c.retard_estime_jours ? ` (+${c.retard_estime_jours} j)` : ''}</Badge>
                        : <Badge cls="bg-sky-50 text-sky-800">Couverte par la réception</Badge>}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            )}
          </section>

          {/* Lignes */}
          <section className="rounded-xl border border-[#E5E1D8] bg-white p-3 lg:col-span-2">
            <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Lignes de la CDF</h3>
            {loading ? <p className="text-[12px] text-[#8A8474]">Chargement…</p> : (
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-[11.5px]">
                  <thead className="sticky top-0 bg-white"><tr className="text-left text-[#8A8474]"><th className="px-1.5 py-1">Référence</th><th className="px-1.5">Désignation</th><th className="px-1.5 text-right">Qté</th><th className="px-1.5 text-right">Montant HT</th></tr></thead>
                  <tbody>{(detail?.lignes || []).map((l, i) => (
                    <tr key={`${l.ligne}-${i}`} className="border-t border-[#F0EDE6]">
                      <td className="px-1.5 py-0.5 font-semibold">{l.reference_article}</td><td className="px-1.5">{l.designation}</td>
                      <td className="px-1.5 text-right">{fmtNum(l.quantite)}</td><td className="px-1.5 text-right">{fmtNum(l.montant_ht, 2)}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

type Perimetre = 'tous' | 'cont' | 'fms'
type CleTri = 'numero' | 'fournisseur' | 'date_commande' | 'date_livraison' | 'eta_port' | 'marge_jours' | 'nb_cdc' | 'montant_ht' | 'alertes'

function PortefeuilleCdf() {
  const router = useRouter()
  const params = useSearchParams()
  const [rep, setRep] = useState<Reponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [fournF, setFournF] = useState('')
  const [perimetre, setPerimetre] = useState<Perimetre>(() => (params.get('perimetre') === 'cont' ? 'cont' : params.get('perimetre') === 'fms' ? 'fms' : 'tous'))
  const [alerteF, setAlerteF] = useState<CodeAlerte | ''>(() => (params.get('alerte') as CodeAlerte) || '')
  const [seulementAlertes, setSeulementAlertes] = useState(true)
  const [tri, setTri] = useState<{ k: CleTri; dir: 1 | -1 }>({ k: 'date_livraison', dir: 1 })
  const [exportEnCours, setExportEnCours] = useState(false)
  const cdfOuverte = params.get('cdf')
  const [prefill, setPrefill] = useState<{ cdf: string; lu: SuiviLu } | null>(null)
  const [suiviRecu, setSuiviRecu] = useState<SuiviLu | null>(null)
  const [infoSuivi, setInfoSuivi] = useState<string | null>(null)
  const [majFond, setMajFond] = useState(false)
  const [relaye, setRelaye] = useState(false)
  const [ordreNav, setOrdreNav] = useState<string[] | null>(null)
  const idEnvoiRef = React.useRef<string | null>(null)

  /** silencieux = recalcul en arrière-plan : la liste reste affichée et utilisable. */
  const charger = useCallback(async (silencieux = false) => {
    if (silencieux) setMajFond(true); else { setLoading(true); setErreur(null) }
    const { data, error } = await supabase.rpc('get_appro_portefeuille_cdf')
    if (error) { setErreur(messageErreur(error)); if (!silencieux) setRep(null) } else setRep(data as Reponse)
    if (silencieux) setMajFond(false); else setLoading(false)
  }, [])

  /** Mise à jour immédiate d'une ligne (après un relevé ou une action), avant le recalcul en arrière-plan. */
  const majLigne = useCallback((numero: string, patch: Partial<Ligne>) => {
    setRep((prev) => (prev ? { ...prev, rows: prev.rows.map((r) => (r.numero === numero ? { ...r, ...patch } : r)) } : prev))
    void charger(true)
  }, [charger])

  // Premier chargement. Favori « Envoyer au compagnon » (#suivi=…) : si le compagnon est déjà
  // ouvert dans un autre onglet, on lui transmet la page et cet onglet se ferme (pas de rechargement).
  useEffect(() => {
    const h = window.location.hash
    if (!h.startsWith('#suivi=')) { void charger(); return }
    let texte = ''
    try { texte = decodeURIComponent(h.slice(7)) } catch { texte = '' }
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    let canal: BroadcastChannel | null = null
    try { canal = new BroadcastChannel('cegeclim-portefeuille-cdf') } catch { canal = null }
    if (!canal) { setSuiviRecu(lireSuiviContainer(texte)); void charger(); return }
    const id = Math.random().toString(36).slice(2)
    idEnvoiRef.current = id
    let recu = false
    canal.onmessage = (e: MessageEvent) => { if (e.data?.type === 'ack' && e.data.id === id) recu = true }
    canal.postMessage({ type: 'suivi', id, texte })
    const timer = window.setTimeout(() => {
      canal?.close()
      if (recu) { setRelaye(true); window.close(); return }
      setSuiviRecu(lireSuiviContainer(texte)); void charger()
    }, 700)
    return () => { window.clearTimeout(timer) }
  }, [charger])

  // Onglet compagnon déjà ouvert : reçoit la page envoyée par le favori depuis un autre onglet
  useEffect(() => {
    let canal: BroadcastChannel | null = null
    try { canal = new BroadcastChannel('cegeclim-portefeuille-cdf') } catch { return }
    canal.onmessage = (e: MessageEvent) => {
      const d = e.data
      if (d?.type !== 'suivi' || typeof d.texte !== 'string' || d.id === idEnvoiRef.current) return
      canal?.postMessage({ type: 'ack', id: d.id })
      setSuiviRecu(lireSuiviContainer(d.texte))
      try { window.focus() } catch { /* focus refusé par le navigateur */ }
    }
    return () => { canal?.close() }
  }, [])

  // Quand le portefeuille est chargé : on retrouve la CDF du container reçu et on ouvre sa fiche pré-remplie
  useEffect(() => {
    if (!suiviRecu || !rep) return
    const c = suiviRecu.container
    const cible = c ? rep.rows.find((r) => r.container === c) : undefined
    setSuiviRecu(null)
    if (!c) { setInfoSuivi('Page reçue, mais aucun n° de container reconnu : ouvrez la page de résultat du suivi (MSC ou CMA CGM) avant de cliquer sur le favori.'); return }
    if (!cible) { setInfoSuivi(`Container ${c} introuvable dans les CDF ouvertes : ouvrez la CDF, saisissez le n° puis utilisez « 📋 Coller le suivi ».`); return }
    setInfoSuivi(null)
    setPrefill({ cdf: cible.numero, lu: suiviRecu })
    const sp = new URLSearchParams(params.toString()); sp.set('cdf', cible.numero)
    router.replace(`/stock/portefeuille-cdf?${sp.toString()}`, { scroll: false })
  }, [suiviRecu, rep, params, router])

  function setUrl(next: { cdf?: string | null }) {
    const sp = new URLSearchParams(params.toString())
    if (next.cdf !== undefined) { if (next.cdf) sp.set('cdf', next.cdf); else sp.delete('cdf') }
    const qs = sp.toString()
    router.replace(qs ? `/stock/portefeuille-cdf?${qs}` : '/stock/portefeuille-cdf', { scroll: false })
  }

  const rows = useMemo(() => rep?.rows || [], [rep])
  const armateurs = rep?.armateurs || []
  const auj = isoAujourdhui()

  const fournisseurs = useMemo(() => {
    const m = new Map<string, string>()
    rows.forEach((r) => { if (r.fournisseur_code) m.set(r.fournisseur_code, r.fournisseur_nom || r.fournisseur_code) })
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1], 'fr'))
  }, [rows])

  const base = useMemo(() => rows.filter((r) => {
    if (perimetre === 'cont' && !r.est_cont) return false
    if (perimetre === 'fms' && !r.est_fms) return false
    if (fournF && r.fournisseur_code !== fournF) return false
    return true
  }), [rows, perimetre, fournF])

  const compte = useMemo(() => {
    const c = {} as Record<CodeAlerte, number>
    ORDRE_ALERTES.forEach((a) => { c[a] = 0 })
    base.forEach((r) => r.alertes.forEach((a) => { c[a] = (c[a] || 0) + 1 }))
    return c
  }, [base])

  const filtres = useMemo(() => {
    const termes = normaliser(search.trim()).split(/[\s,;]+/).filter(Boolean)
    const list = base.filter((r) => {
      if (alerteF && !r.alertes.includes(alerteF)) return false
      if (!alerteF && seulementAlertes && r.alertes.length === 0) return false
      if (termes.length) {
        const hay = normaliser(`${r.numero} ${r.reference} ${r.fournisseur_code} ${r.fournisseur_nom} ${r.depot} ${r.container} ${r.navire} ${r.commentaires.join(' ')}`)
        if (!termes.every((t) => hay.includes(t))) return false
      }
      return true
    })
    const val = (r: Ligne): string | number | null => {
      switch (tri.k) {
        case 'fournisseur': return r.fournisseur_nom || r.fournisseur_code
        case 'alertes': return r.alertes.length
        default: return (r[tri.k] as string | number | null) ?? null
      }
    }
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va === null || va === '') return 1
      if (vb === null || vb === '') return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * tri.dir
      return String(va).localeCompare(String(vb), 'fr') * tri.dir
    })
  }, [base, search, alerteF, seulementAlertes, tri])

  const kpis = useMemo(() => ({
    total: base.length,
    cont: base.filter((r) => r.est_cont).length,
    avecAlerte: base.filter((r) => r.alertes.length > 0).length,
    montant: base.reduce((s, r) => s + Number(r.montant_ht || 0), 0),
  }), [base])

  // ← / → suivent la liste telle qu'elle était à l'ouverture de la fiche (une CDF traitée qui perd
  // son alerte ne décale pas la navigation)
  const listeNav = ordreNav || filtres.map((r) => r.numero)
  const indexOuvert = cdfOuverte ? listeNav.indexOf(cdfOuverte) : -1
  function ouvrirCdf(numero: string) { setOrdreNav(filtres.map((r) => r.numero)); setUrl({ cdf: numero }) }
  const ligneOuverte = cdfOuverte ? rows.find((r) => r.numero === cdfOuverte) || null : null

  function trier(k: CleTri) { setTri((t) => (t.k === k ? { k, dir: (t.dir === 1 ? -1 : 1) as 1 | -1 } : { k, dir: 1 })) }
  function Th({ k, children, cls = '' }: { k?: CleTri; children: React.ReactNode; cls?: string }) {
    return (
      <th onClick={k ? () => trier(k) : undefined} className={`whitespace-nowrap px-2 py-1.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#8A8474] ${k ? 'cursor-pointer hover:text-[#3A362E]' : ''} ${cls}`}>
        {children}{k && tri.k === k ? (tri.dir === 1 ? ' ▲' : ' ▼') : ''}
      </th>
    )
  }

  async function exporterExcel() {
    setExportEnCours(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Portefeuille CDF')
      const cols: { h: string; f: (r: Ligne) => unknown; w?: number }[] = [
        { h: 'N° CDF', f: (r) => r.numero, w: 12 }, { h: 'Fournisseur', f: (r) => r.fournisseur_code }, { h: 'Nom fournisseur', f: (r) => r.fournisseur_nom, w: 26 },
        { h: 'Référence', f: (r) => r.reference, w: 22 }, { h: 'Dépôt', f: (r) => r.depot }, { h: 'Container (CONT)', f: (r) => (r.est_cont ? 'Oui' : '') },
        { h: 'Date commande', f: (r) => fmtDate(r.date_commande) }, { h: 'Date livraison', f: (r) => fmtDate(r.date_livraison) },
        { h: 'Statut SAGE', f: (r) => r.statut_libelle }, { h: 'N° container', f: (r) => r.container, w: 14 },
        { h: 'Container valide', f: (r) => (r.container ? (r.container_valide ? 'Oui' : 'Non') : '') },
        { h: 'Armateur', f: (r) => r.armateur }, { h: 'Navire', f: (r) => r.navire, w: 20 }, { h: 'ETA port', f: (r) => fmtDate(r.eta_port) },
        { h: 'Statut suivi', f: (r) => (r.statut_suivi ? STATUT_SUIVI[r.statut_suivi] : '') }, { h: 'Relevé le', f: (r) => fmtDateHeure(r.releve_le) },
        { h: 'Marge (j)', f: (r) => r.marge_jours }, { h: 'Verdict', f: (r) => (r.verdict ? VERDICT[r.verdict].label : '') },
        { h: 'CDC en attente', f: (r) => r.nb_cdc }, { h: '1re livraison CDC', f: (r) => fmtDate(r.premiere_livraison_cdc) },
        { h: 'Lignes', f: (r) => r.nb_lignes }, { h: 'Pièces', f: (r) => r.qte }, { h: 'Montant HT', f: (r) => r.montant_ht },
        { h: 'Alertes', f: (r) => r.alertes.map((a) => ALERTE[a].label).join(', '), w: 40 },
        { h: 'Commentaires SAGE', f: (r) => r.commentaires.join(' | '), w: 60 },
      ]
      ws.addRow(cols.map((c) => c.h)).font = { bold: true }
      filtres.forEach((r) => ws.addRow(cols.map((c) => { const v = c.f(r); return v === null || v === undefined ? '' : v })))
      cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w || 13 })
      ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = `portefeuille_cdf_${auj}.xlsx`; a.click(); URL.revokeObjectURL(url)
    } catch (e) { setErreur('Export Excel : ' + messageErreur(e)) } finally { setExportEnCours(false) }
  }

  const ctl = 'h-8 min-w-0 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const p = rep?.parametres
  const toggleAlerte = (a: CodeAlerte) => setAlerteF((v) => (v === a ? '' : a))

  if (relaye) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F4F3F0] p-6 text-center text-[#111820]">
        <div className="rounded-xl border border-[#E5E1D8] bg-white px-6 py-5">
          <div className="text-[18px] font-bold text-emerald-700">✓ Envoyé au compagnon</div>
          <p className="mt-1 text-[13px] text-[#5E5A44]">La fiche de la CDF s’est ouverte dans l’onglet du compagnon. Vous pouvez fermer cet onglet.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1900px] space-y-2.5">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Stocks & logistique</p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">Portefeuille commandes fournisseurs</h1>
            <p className="text-[11.5px] text-[#8A8474]">
              CDF SAGE ouvertes · relances, AR, suivi des containers et nettoyage
              {rep?.import_sage_le && <> · données SAGE du {fmtDateHeure(rep.import_sage_le)}</>}
              {majFond && <span className="ml-1 text-[#1D5C86]"> · mise à jour en arrière-plan…</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] p-0.5 text-[12.5px] font-bold">
              {([['tous', 'Toutes les CDF'], ['cont', 'Containers (CONT)'], ['fms', 'Destination FMS']] as [Perimetre, string][]).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setPerimetre(k)} className={`rounded-md px-3 py-1.5 ${perimetre === k ? 'bg-white text-[#111820] shadow-sm' : 'text-[#8A8474]'}`}>{l}</button>
              ))}
            </div>
            <LienFavori />
            <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || loading || filtres.length === 0} className="h-10 rounded-lg bg-[#111820] px-3 text-[13px] font-bold text-white disabled:opacity-50">
              {exportEnCours ? 'Export…' : `⬇ Excel (${fmtNum(filtres.length)})`}
            </button>
            <button type="button" onClick={() => void charger()} disabled={loading} title="Recharger" className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[14px] font-bold disabled:opacity-50">{loading || majFond ? '…' : '↻'}</button>
          </div>
        </section>

        {erreur && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-800">
            {erreur}{/get_appro_portefeuille_cdf|does not exist/.test(erreur) ? ' — la migration 20261023_portefeuille_cdf.sql est-elle appliquée ?' : ''}
          </div>
        )}
        {infoSuivi && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-[#1D5C86]/30 bg-[#1D5C86]/[0.06] px-3 py-2 text-[12.5px] font-semibold text-[#1D5C86]">
            <span>{infoSuivi}</span>
            <button type="button" onClick={() => setInfoSuivi(null)} className="text-[14px]">×</button>
          </div>
        )}
        {rep && (!rep.sources.commentaires || !rep.sources.statut_ar) && (
          <div className="rounded-lg border border-[#B4761A]/40 bg-[#B4761A]/[0.08] px-3 py-2 text-[12px] text-[#5E4A1A]">
            {!rep.sources.commentaires && <div><b>Commentaires des CDF non remontés de SAGE</b> : les n° de container ne sont pas encore lus automatiquement — ils peuvent être saisis dans le suivi en attendant.</div>}
            {!rep.sources.statut_ar && <div><b>Statut SAGE (AR OK) non remonté</b> : l’alerte « Sans AR » est inactive jusqu’à l’ajout de l’export.</div>}
          </div>
        )}

        <section className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <Kpi label="CDF ouvertes" value={loading && !rep ? '…' : fmtNum(kpis.total)} sub={`${fmtNum(kpis.cont)} containers · ${fmtNum(kpis.montant / 1000)} k€ HT`} onClick={() => { setAlerteF(''); setSeulementAlertes(false) }} actif={!alerteF && !seulementAlertes} title="Toutes les CDF du périmètre" />
          <Kpi label="Avec alerte" value={loading && !rep ? '…' : fmtNum(kpis.avecAlerte)} sub="à traiter" tone="alerte" onClick={() => { setAlerteF(''); setSeulementAlertes(true) }} actif={!alerteF && seulementAlertes} />
          <Kpi label="Container sans n°" value={loading && !rep ? '…' : fmtNum(compte.CONT_SANS_CONTAINER)} sub={p ? `livraison ≤ ${p.cont_alerte_jours_avant} j` : ''} tone="alerte" onClick={() => toggleAlerte('CONT_SANS_CONTAINER')} actif={alerteF === 'CONT_SANS_CONTAINER'} title={ALERTE.CONT_SANS_CONTAINER.title} />
          <Kpi label="Suivi bateau" value={loading && !rep ? '…' : fmtNum(compte.CONT_SANS_SUIVI + compte.CONT_SUIVI_ANCIEN)} sub={`${fmtNum(compte.CONT_SANS_SUIVI)} à faire · ${fmtNum(compte.CONT_SUIVI_ANCIEN)} à rafraîchir`} tone="warn" onClick={() => toggleAlerte(compte.CONT_SANS_SUIVI ? 'CONT_SANS_SUIVI' : 'CONT_SUIVI_ANCIEN')} actif={alerteF === 'CONT_SANS_SUIVI' || alerteF === 'CONT_SUIVI_ANCIEN'} />
          <Kpi label="Marge critique" value={loading && !rep ? '…' : fmtNum(compte.CONT_MARGE)} sub="ETA port vs date CDF" tone="alerte" onClick={() => toggleAlerte('CONT_MARGE')} actif={alerteF === 'CONT_MARGE'} title={ALERTE.CONT_MARGE.title} />
          <Kpi label="Sans AR" value={loading && !rep ? '…' : rep?.sources.statut_ar ? fmtNum(compte.SANS_AR) : 'n/d'} sub={p ? `FMS, créées depuis ≥ ${p.sans_ar_jours} j` : ''} tone="alerte" onClick={() => toggleAlerte('SANS_AR')} actif={alerteF === 'SANS_AR'} title={ALERTE.SANS_AR.title} />
          <Kpi label="CDC attendent" value={loading && !rep ? '…' : fmtNum(compte.CDC_A_CONFIRMER)} sub={p ? `dues sous ${p.relance_cdc_horizon_jours} j : confirmer` : ''} tone="info" onClick={() => toggleAlerte('CDC_A_CONFIRMER')} actif={alerteF === 'CDC_A_CONFIRMER'} title={ALERTE.CDC_A_CONFIRMER.title} />
          <Kpi label="Date dépassée" value={loading && !rep ? '…' : fmtNum(compte.DATE_DEPASSEE)} sub={`${fmtNum(compte.SANS_DATE)} sans date`} tone="violet" onClick={() => toggleAlerte('DATE_DEPASSEE')} actif={alerteF === 'DATE_DEPASSEE'} title={ALERTE.DATE_DEPASSEE.title} />
        </section>

        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
          <input className={`${ctl} w-[280px]`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="CDF, référence, container, navire, commentaire…" />
          <select className={`${ctl} w-[240px]`} value={fournF} onChange={(e) => setFournF(e.target.value)}>
            <option value="">Tous les fournisseurs</option>
            {fournisseurs.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}
          </select>
          <select className={`${ctl} w-[200px]`} value={alerteF} onChange={(e) => setAlerteF(e.target.value as CodeAlerte | '')}>
            <option value="">Toutes les alertes</option>
            {ORDRE_ALERTES.map((a) => <option key={a} value={a}>{ALERTE[a].label} ({fmtNum(compte[a])})</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#3A362E]">
            <input type="checkbox" checked={seulementAlertes} onChange={(e) => setSeulementAlertes(e.target.checked)} /> Avec alerte seulement
          </label>
          <span className="ml-auto text-[11.5px] text-[#8A8474]">{fmtNum(filtres.length)} CDF affichées</span>
        </section>

        <section className="overflow-x-auto rounded-xl border border-[#E5E1D8] bg-white">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-[#E5E1D8]">
                <Th k="numero">CDF</Th><Th k="fournisseur">Fournisseur</Th><Th>Référence</Th>
                <Th k="date_commande">Commande</Th><Th k="date_livraison">Livraison</Th><Th>Statut</Th>
                <Th>Container</Th><Th k="eta_port">Bateau · ETA</Th><Th k="marge_jours">Marge</Th>
                <Th k="nb_cdc" cls="text-right">CDC</Th><Th k="montant_ht" cls="text-right">Montant HT</Th><Th k="alertes">Alertes</Th><Th>Dernière action</Th>
              </tr>
            </thead>
            <tbody>
              {loading && !rep && <tr><td colSpan={13} className="px-3 py-6 text-center text-[#8A8474]">Chargement du portefeuille…</td></tr>}
              {!(loading && !rep) && filtres.length === 0 && <tr><td colSpan={13} className="px-3 py-6 text-center font-semibold text-emerald-700">Aucune CDF à traiter avec ces filtres.</td></tr>}
              {!(loading && !rep) && filtres.map((r) => (
                <tr key={r.numero} onClick={() => ouvrirCdf(r.numero)} className="cursor-pointer border-b border-[#F0EDE6] hover:bg-[#FAF8F3]">
                  <td className="whitespace-nowrap px-2 py-1 font-semibold">{r.numero}{r.est_cont && <span className="ml-1 text-[10px]" title="Commande container">🚢</span>}</td>
                  <td className="max-w-[180px] truncate px-2 py-1" title={`${r.fournisseur_code} ${r.fournisseur_nom || ''}`}>{r.fournisseur_nom || r.fournisseur_code}</td>
                  <td className="max-w-[170px] truncate px-2 py-1" title={r.reference || ''}>{r.reference || '—'}<span className="ml-1 text-[10.5px] text-[#8A8474]">{r.depot || ''}</span></td>
                  <td className="whitespace-nowrap px-2 py-1">{fmtDate(r.date_commande)}<span className="ml-1 text-[10.5px] text-[#8A8474]">{r.age_jours !== null ? `${r.age_jours} j` : ''}</span></td>
                  <td className="whitespace-nowrap px-2 py-1">
                    {r.date_livraison ? <>{fmtDate(r.date_livraison)} <span className={`text-[10.5px] font-bold ${r.jours_avant_livraison !== null && r.jours_avant_livraison < 0 ? 'text-red-700' : 'text-[#8A8474]'}`}>{libelleJours(r.jours_avant_livraison)}</span></> : <span className="text-violet-800">sans date</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1">{r.statut_libelle ? <Badge cls={r.ar_recu ? 'bg-emerald-50 text-emerald-700' : 'bg-[#F4F3F0] text-[#5E5A44]'}>{r.statut_libelle}</Badge> : <span className="text-[#C9C3B5]">—</span>}</td>
                  <td className="whitespace-nowrap px-2 py-1 font-mono text-[11.5px]">
                    {r.container ? <span className={r.container_valide ? '' : 'text-red-700'} title={r.container_source === 'sage' ? 'Lu dans SAGE' : 'Saisi dans l’app'}>{r.container}{r.container_source === 'saisie' && <span className="ml-0.5 font-sans text-[10px] text-[#8A8474]">✎</span>}</span>
                      : r.est_cont ? <span className="font-sans text-[11px] text-red-700">à obtenir</span> : <span className="text-[#C9C3B5]">—</span>}
                  </td>
                  <td className="max-w-[200px] truncate px-2 py-1" title={[r.armateur, r.navire, r.port_arrivee].filter(Boolean).join(' · ')}>
                    {r.eta_port ? <>{fmtDate(r.eta_port)} <span className="text-[10.5px] text-[#8A8474]">{r.navire || r.armateur || ''}{r.statut_suivi ? ` · ${STATUT_SUIVI[r.statut_suivi]}` : ''}</span></> : <span className="text-[#C9C3B5]">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1">{r.verdict ? <Badge cls={VERDICT[r.verdict].cls}>{r.marge_jours} j · {VERDICT[r.verdict].label}</Badge> : <span className="text-[#C9C3B5]">—</span>}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">{r.nb_cdc ? <span title={`1re livraison client ${fmtDate(r.premiere_livraison_cdc)}`}><b>{fmtNum(r.nb_cdc)}</b>{r.nb_cdc_tardives ? <span className="ml-1 text-[10.5px] text-orange-700">({fmtNum(r.nb_cdc_tardives)} tard.)</span> : ''}</span> : <span className="text-[#C9C3B5]">—</span>}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">{fmtNum(r.montant_ht)}</td>
                  <td className="px-2 py-1"><span className="inline-flex flex-wrap gap-1">{r.alertes.map((a) => <Badge key={a} cls={ALERTE[a].cls} title={ALERTE[a].title}>{ALERTE[a].label}</Badge>)}</span></td>
                  <td className="max-w-[200px] truncate px-2 py-1 text-[11px] text-[#5E5A44]" title={r.derniere_action?.commentaire || ''}>
                    {r.derniere_action ? <>{fmtDate(r.derniere_action.le)} · {r.derniere_action.action === 'confirme' ? '✓' : r.derniere_action.action === 'relance' ? '📨' : '💬'} {r.derniere_action.commentaire || ''}</> : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {ligneOuverte && (
        <CdfModal key={`${ligneOuverte.numero}${prefill && prefill.cdf === ligneOuverte.numero ? '-suivi' : ''}`} ligne={ligneOuverte} armateurs={armateurs} parametres={rep?.parametres || null}
          position={indexOuvert >= 0 ? `${indexOuvert + 1} / ${listeNav.length}` : null}
          onPrev={indexOuvert > 0 ? () => setUrl({ cdf: listeNav[indexOuvert - 1] }) : undefined}
          onNext={indexOuvert >= 0 && indexOuvert < listeNav.length - 1 ? () => setUrl({ cdf: listeNav[indexOuvert + 1] }) : undefined}
          prefill={prefill && prefill.cdf === ligneOuverte.numero ? prefill.lu : null}
          onClose={() => { setPrefill(null); setOrdreNav(null); setUrl({ cdf: null }) }}
          onSaved={(patch) => majLigne(ligneOuverte.numero, patch)} />
      )}
    </main>
  )
}

export default function PortefeuilleCdfPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>}>
      <PortefeuilleCdf />
    </Suspense>
  )
}
