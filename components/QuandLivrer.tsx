'use client'

// ============================================================================
// components/QuandLivrer.tsx — « Quand puis-je livrer ? » (20/11/2026)
// ----------------------------------------------------------------------------
// Contrôle avant commande, en libre-service, partagé par l'écran PC
// (/quand-livrer) et l'écran mobile (MobileShell, écran 'livrer').
//
// Deux entrées, une seule mécanique :
//   - un devis (n° tapé ou choisi dans la liste) : lignes dans l'ordre du devis,
//     découpées en blocs sur les lignes de commentaire, cochables par bloc ou
//     ligne à ligne (RPC get_quand_livrer_devis, get_quand_livrer_devis_recherche) ;
//   - une liste collée « référence  quantité » (copier-coller Excel / mail) ou
//     lue sur une photo de commande (route /api/quand-livrer/photo)
//     (RPC get_quand_livrer_articles).
// Dans les deux cas, les quantités cochées sont regroupées par référence et
// envoyées à get_dispo_lignes_quantites (stock projeté : stock − CDC + CDF,
// première date où la quantité entière est promettable, sinon délai d'appro).
//
// Code couleur fixé par Arnaud :
//   vert   = dispo tout de suite ;
//   orange = dispo à une date future (projection stock + arrivages) ;
//   rouge  = stock insuffisant : commande d'appro à passer (date = délai d'appro)
//            ou référence bloquée en appro (non promettable).
// La référence limitante (celle qui fixe la date au plus tôt) est mise en avant.
// Contrôles complémentaires : article en sommeil / inconnu, écart entre le
// tarif de base du devis et le tarif actuel, écart entre le PR du devis et le
// PUMP actuel (ex. cuivre), ancienneté du devis.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type TypeLigne = 'ARTICLE' | 'NON_STOCKE' | 'INCONNU' | 'COMMENTAIRE'
type StatutDispo = 'DISPO' | 'DATE_FUTURE' | 'SUR_DELAI_APPRO' | 'BLOQUE_APPRO'
type Couleur = 'vert' | 'orange' | 'rouge' | 'neutre'
type Mode = 'devis' | 'liste'

type Ligne = {
  id: string
  bloc: number
  type: TypeLigne
  ref: string | null
  designation: string | null
  qte: number
  puDevis: number | null
  remise: number | null
  montant: number | null
  puActuel: number | null
  prDevis: number | null
  prActuel: number | null
  prActuelSource: string | null
  sommeil: boolean
}

type Bloc = { bloc: number; libelle: string | null }

type EnteteDevis = {
  numero: string
  date_devis: string | null
  numero_tiers: string | null
  client: string | null
  collaborateur: string | null
  reference: string | null
  montant_ht: number | null
  age_jours: number | null
}

type DevisCharge = { entete: EnteteDevis; blocs: Bloc[]; source: 'STRUCTURE' | 'LIGNES' }

type DevisResume = {
  numero_piece: string
  date_devis: string | null
  numero_tiers: string | null
  intitule_tiers: string | null
  collaborateur: string | null
  reference: string | null
  ca_ht: number | null
  nb_lignes: number | null
}

type Dispo = {
  reference_article: string
  qte_demandee: number
  stock_dispo: number
  qte_immediate: number
  date_premiere_dispo: string | null
  qte_premiere_dispo: number | null
  date_dispo_complete: string | null
  date_complete_source: string | null
  statut: StatutDispo
  blocage_appro: boolean
  blocage_source: string | null
  delai_appro_jours: number | null
}

type InfoArticle = {
  reference_article: string
  connu: boolean
  designation: string | null
  famille: string | null
  type_ligne: TypeLigne
  sommeil: boolean
  pu_vente_actuel: number | null
  pr_actuel: number | null
  pr_actuel_source: string | null
}

export type QuandLivrerProps = {
  /** Affichage resserré (mobile). */
  compact?: boolean
  /** N° de devis à ouvrir au chargement. */
  initialDevis?: string | null
  /** Liste « REF;QTE,REF;QTE » à contrôler au chargement. */
  initialListe?: string | null
  /** Onglet ouvert au chargement (repli : liste si initialListe, sinon devis). */
  initialMode?: 'devis' | 'liste'
  /** Appelé quand le devis affiché change (synchronisation d'URL côté PC). */
  onDevisChange?: (numero: string | null) => void
}

// ─────────────────────────────────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────────────────────────────────

// Écart de prix de revient signalé (Arnaud, 20/11/2026) : plus de 10 % ET plus
// de 10 € sur la ligne (écart unitaire × quantité), dans un sens ou dans l'autre.
const SEUIL_ECART_PR_PCT = 10
const SEUIL_ECART_PR_EUR = 10

function alertePr(l: { prDevis: number | null; prActuel: number | null; qte: number }) {
  const pct = ecartPctBrut(l.prDevis, l.prActuel)
  if (pct === null || l.prDevis === null || l.prActuel === null) return null
  const valeur = (l.prActuel - l.prDevis) * (l.qte || 0)
  if (Math.abs(pct) <= SEUIL_ECART_PR_PCT || Math.abs(valeur) <= SEUIL_ECART_PR_EUR) return null
  return { pct, valeur }
}

function ecartPctBrut(avant: number | null, apres: number | null) {
  if (avant === null || apres === null || avant <= 0 || apres <= 0) return null
  return ((apres - avant) / avant) * 100
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function aujourdhuiIso() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const j = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${j}`
}

function fmtDate(iso: string | null | undefined, avecJour = true) {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const base = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
  if (!avecJour) return base
  const jour = date.toLocaleDateString('fr-FR', { weekday: 'short' })
  return `${jour} ${base}`
}

function fmtQte(n: number | null | undefined) {
  if (n === null || n === undefined) return '—'
  return Number.isInteger(n) ? String(n) : n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

function fmtEur(n: number | null | undefined, dec = 2) {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' €'
}

function fmtPct(p: number) {
  const s = p > 0 ? '+' : ''
  return `${s}${p.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`
}

function joursEntre(a: string, b: string) {
  const da = new Date(a.slice(0, 10) + 'T00:00:00')
  const db = new Date(b.slice(0, 10) + 'T00:00:00')
  return Math.round((db.getTime() - da.getTime()) / 86400000)
}

/** Une ligne de texte collée → { ref, qte } (tabulation, ;, |, espaces). */
function analyserLigneCollee(brut: string): { ref: string; qte: number } | null {
  const ligne = brut.replace(/ /g, ' ').trim()
  if (!ligne) return null
  let tokens = ligne.split(/\t|;|\|/).map((t) => t.trim()).filter(Boolean)
  if (tokens.length <= 1) tokens = ligne.split(/\s+/).filter(Boolean)
  const estQte = (t: string) => /^x?\d+([.,]\d+)?x?$/i.test(t)
  const versQte = (t: string) => Number(t.replace(/x/gi, '').replace(',', '.'))
  // « 3 x RAK-… » ou « 3 RAK-… » : quantité en tête.
  if (tokens.length >= 2 && estQte(tokens[0]) && !estQte(tokens[1])) {
    const reste = tokens.slice(1).filter((t) => t.toLowerCase() !== 'x')
    if (!reste.length) return null
    return { ref: reste[0].toUpperCase(), qte: versQte(tokens[0]) || 1 }
  }
  const refTok = tokens.find((t) => !estQte(t))
  if (!refTok) return null
  if (/^(r[ée]f([ée]rence)?|article|code|d[ée]signation|quantit[ée]|qt[ée])\b/i.test(refTok) && !tokens.some(estQte)) return null
  const qtes = tokens.filter((t) => t !== refTok && estQte(t))
  const qte = qtes.length ? versQte(qtes[qtes.length - 1]) : 1
  return { ref: refTok.toUpperCase(), qte: qte > 0 ? qte : 1 }
}

/** Réduit une image (photo de téléphone) avant envoi à l'IA. */
async function imageVersDataUrl(fichier: File, max = 1600): Promise<string> {
  const url = URL.createObjectURL(fichier)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Image illisible.'))
      i.src = url
    })
    const k = Math.min(1, max / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * k)
    canvas.height = Math.round(img.height * k)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Image illisible.')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Lecture d'une ligne au regard de la dispo
// ─────────────────────────────────────────────────────────────────────────

type Lecture = {
  couleur: Couleur
  date: string | null
  titre: string
  detail: string | null
}

function lireDispo(d: Dispo | undefined, aujourdhui: string): Lecture {
  if (!d) return { couleur: 'neutre', date: null, titre: 'Calcul…', detail: null }
  const partiel =
    d.statut !== 'DISPO' && d.qte_immediate > 0
      ? `${fmtQte(d.qte_immediate)} dispo tout de suite`
      : d.statut !== 'DISPO' &&
          d.date_premiere_dispo &&
          d.qte_premiere_dispo !== null &&
          d.qte_premiere_dispo < d.qte_demandee &&
          (!d.date_dispo_complete || d.date_premiere_dispo < d.date_dispo_complete)
        ? `${fmtQte(d.qte_premiere_dispo)} dispo le ${fmtDate(d.date_premiere_dispo, false)}`
        : null
  switch (d.statut) {
    case 'DISPO':
      return { couleur: 'vert', date: aujourdhui, titre: 'Dispo tout de suite', detail: null }
    case 'DATE_FUTURE':
      return { couleur: 'orange', date: d.date_dispo_complete, titre: `Dispo le ${fmtDate(d.date_dispo_complete)}`, detail: partiel }
    case 'SUR_DELAI_APPRO':
      return {
        couleur: 'rouge',
        date: d.date_dispo_complete,
        titre: `Appro à passer — ${fmtDate(d.date_dispo_complete)}`,
        detail: [`délai d’appro ${d.delai_appro_jours ?? '?'} j`, partiel].filter(Boolean).join(' · '),
      }
    case 'BLOQUE_APPRO':
      return {
        couleur: 'rouge',
        date: null,
        titre: 'Non promettable — bloqué appro',
        detail: [d.blocage_source === 'SAGE' ? 'blocage appro SAGE' : d.blocage_source === 'MANUEL' ? 'arrêt appro manuel' : null, partiel].filter(Boolean).join(' · ') || null,
      }
    default:
      return { couleur: 'neutre', date: null, titre: '—', detail: null }
  }
}

// Couleurs pleines (lisibles en clair comme en sombre) : trait = bordure et
// pastille, fond = teinte de la ligne, encre = texte sur fond de page.
const COULEURS: Record<Couleur, { trait: string; fond: string; encre: string }> = {
  vert: { trait: '#2E8B57', fond: 'rgba(46,139,87,0.10)', encre: 'var(--cg-ok-text)' },
  orange: { trait: '#D9861C', fond: 'rgba(217,134,28,0.13)', encre: 'var(--cg-warn-ink)' },
  rouge: { trait: '#C8372D', fond: 'rgba(200,55,45,0.13)', encre: 'var(--cg-danger-text)' },
  neutre: { trait: 'rgba(var(--cg-ink-rgb),0.18)', fond: 'transparent', encre: 'rgba(var(--cg-ink-rgb),0.6)' },
}

const RANG: Record<Couleur, number> = { neutre: 0, vert: 1, orange: 2, rouge: 3 }

// ─────────────────────────────────────────────────────────────────────────
// Composant
// ─────────────────────────────────────────────────────────────────────────

export default function QuandLivrer({ compact = false, initialDevis, initialListe, initialMode, onDevisChange }: QuandLivrerProps) {
  const aujourdhui = useMemo(() => aujourdhuiIso(), [])

  const [mode, setMode] = useState<Mode>(initialMode ?? (initialListe ? 'liste' : 'devis'))

  // Devis
  const [recherche, setRecherche] = useState('')
  const [suggestions, setSuggestions] = useState<DevisResume[]>([])
  const [recents, setRecents] = useState<DevisResume[]>([])
  const [suggestOuvert, setSuggestOuvert] = useState(false)
  const [devis, setDevis] = useState<DevisCharge | null>(null)

  // Liste collée
  const [texte, setTexte] = useState(initialListe ? initialListe.split(',').map((x) => x.replace(';', '\t')).join('\n') : '')
  const [photoEnCours, setPhotoEnCours] = useState(false)
  const fichierRef = useRef<HTMLInputElement | null>(null)

  // Commun
  const [lignes, setLignes] = useState<Ligne[]>([])
  const [decochees, setDecochees] = useState<Set<string>>(new Set())
  const [dispo, setDispo] = useState<Map<string, Dispo>>(new Map())
  const [chargement, setChargement] = useState(false)
  const [calcul, setCalcul] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const requete = useRef(0)

  // ── Liste des derniers devis (périmètre de l'utilisateur) ──────────────
  useEffect(() => {
    let annule = false
    void supabase.rpc('get_quand_livrer_devis_recherche', { p_q: null, p_limit: 15 }).then(({ data }) => {
      if (!annule && Array.isArray(data)) setRecents(data as DevisResume[])
    })
    return () => { annule = true }
  }, [])

  useEffect(() => {
    const q = recherche.trim()
    if (q.length < 2) { setSuggestions([]); return }
    const t = setTimeout(() => {
      void supabase.rpc('get_quand_livrer_devis_recherche', { p_q: q, p_limit: 12 }).then(({ data }) => {
        if (Array.isArray(data)) setSuggestions(data as DevisResume[])
      })
    }, 220)
    return () => clearTimeout(t)
  }, [recherche])

  // ── Chargement d'un devis ──────────────────────────────────────────────
  const chargerDevis = useCallback(async (numero: string) => {
    const n = numero.trim().toUpperCase()
    if (!n) return
    setSuggestOuvert(false)
    setChargement(true)
    setErreur(null)
    setMessage(null)
    try {
      const { data, error } = await supabase.rpc('get_quand_livrer_devis', { p_numero: n })
      if (error) throw error
      const res = data as any
      if (!res?.trouve) {
        setErreur(res?.refuse ? `Le devis ${n} n’est pas dans votre périmètre.` : `Devis ${n} introuvable.`)
        return
      }
      const ls: Ligne[] = (res.lignes || []).map((l: any, i: number) => ({
        id: `d${i}`,
        bloc: Number(l.bloc) || 1,
        type: (l.type || 'INCONNU') as TypeLigne,
        ref: l.ref || null,
        designation: l.designation || null,
        qte: num(l.qte) ?? 0,
        puDevis: num(l.pu_devis),
        remise: num(l.remise_pct),
        montant: num(l.montant_ht),
        puActuel: num(l.pu_actuel),
        prDevis: num(l.pr_devis),
        prActuel: num(l.pr_actuel),
        prActuelSource: l.pr_actuel_source || null,
        sommeil: Boolean(l.sommeil),
      }))
      setMode('devis')
      setDevis({ entete: res.entete, blocs: res.blocs || [], source: res.source })
      setLignes(ls)
      setDecochees(new Set())
      setDispo(new Map())
      setRecherche(n)
      onDevisChange?.(n)
    } catch (e: any) {
      setErreur(e?.message || 'Erreur au chargement du devis.')
    } finally {
      setChargement(false)
    }
  }, [onDevisChange])

  // ── Contrôle d'une liste collée ────────────────────────────────────────
  const controlerListe = useCallback(async (source?: string) => {
    const brut = source ?? texte
    const items = brut.split(/\r?\n/).map(analyserLigneCollee).filter(Boolean) as { ref: string; qte: number }[]
    if (!items.length) { setErreur('Aucune référence reconnue. Collez une ligne par article : référence puis quantité.'); return }
    setChargement(true)
    setErreur(null)
    setMessage(null)
    try {
      const refs = Array.from(new Set(items.map((x) => x.ref)))
      const { data, error } = await supabase.rpc('get_quand_livrer_articles', { p_refs: refs })
      if (error) throw error
      const infos = new Map<string, InfoArticle>(((data as InfoArticle[]) || []).map((x) => [x.reference_article, x]))
      const ls: Ligne[] = items.map((it, i) => {
        const inf = infos.get(it.ref)
        return {
          id: `l${i}`,
          bloc: 1,
          type: (inf?.type_ligne || 'INCONNU') as TypeLigne,
          ref: it.ref,
          designation: inf?.designation || null,
          qte: it.qte,
          puDevis: null,
          remise: null,
          montant: null,
          puActuel: num(inf?.pu_vente_actuel),
          prDevis: null,
          prActuel: num(inf?.pr_actuel),
          prActuelSource: inf?.pr_actuel_source || null,
          sommeil: Boolean(inf?.sommeil),
        }
      })
      setMode('liste')
      setDevis(null)
      setLignes(ls)
      setDecochees(new Set())
      setDispo(new Map())
      onDevisChange?.(null)
    } catch (e: any) {
      setErreur(e?.message || 'Erreur au contrôle de la liste.')
    } finally {
      setChargement(false)
    }
  }, [texte, onDevisChange])

  // Ouverture initiale (URL)
  const initFait = useRef(false)
  useEffect(() => {
    if (initFait.current) return
    initFait.current = true
    if (initialDevis) void chargerDevis(initialDevis)
    else if (initialListe) void controlerListe()
  }, [initialDevis, initialListe, chargerDevis, controlerListe])

  // ── Photo / image d'une commande ───────────────────────────────────────
  const lirePhoto = useCallback(async (fichiers: FileList | File[] | null) => {
    const liste = fichiers ? Array.from(fichiers).filter((f) => f.type.startsWith('image/')).slice(0, 4) : []
    if (!liste.length) return
    setPhotoEnCours(true)
    setErreur(null)
    setMessage(null)
    try {
      const images = await Promise.all(liste.map((f) => imageVersDataUrl(f)))
      const res = await fetch('/api/quand-livrer/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || `Lecture impossible (${res.status}).`)
      const lus: { ref: string; qte: number }[] = Array.isArray(json?.lignes) ? json.lignes : []
      if (!lus.length) { setErreur('Aucune référence lue sur l’image.'); return }
      const ajout = lus.map((x) => `${x.ref}\t${x.qte}`).join('\n')
      const nouveau = texte.trim() ? `${texte.trim()}\n${ajout}` : ajout
      setTexte(nouveau)
      setMessage(`${lus.length} ligne${lus.length > 1 ? 's' : ''} lue${lus.length > 1 ? 's' : ''} sur l’image — vérifiez les références avant de vous y fier.`)
      await controlerListe(nouveau)
    } catch (e: any) {
      setErreur(e?.message || 'Lecture de l’image impossible.')
    } finally {
      setPhotoEnCours(false)
      if (fichierRef.current) fichierRef.current.value = ''
    }
  }, [texte, controlerListe])

  // ── Sélection → quantités par référence → dispo ────────────────────────
  const selection = useMemo(() => lignes.filter((l) => !decochees.has(l.id)), [lignes, decochees])

  const qteParRef = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of selection) {
      if (l.type !== 'ARTICLE' || !l.ref || l.qte <= 0) continue
      m.set(l.ref, (m.get(l.ref) || 0) + l.qte)
    }
    return m
  }, [selection])

  const cleSelection = useMemo(() => JSON.stringify(Array.from(qteParRef.entries()).sort()), [qteParRef])

  useEffect(() => {
    const payload = Array.from(qteParRef.entries()).map(([ref, qte]) => ({ ref, qte }))
    if (!payload.length) { setDispo(new Map()); return }
    const id = ++requete.current
    setCalcul(true)
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('get_dispo_lignes_quantites', { p_lignes: payload })
      if (id !== requete.current) return
      setCalcul(false)
      if (error) { setErreur(`Calcul de dispo impossible : ${error.message}`); return }
      const m = new Map<string, Dispo>()
      for (const r of (data as any[]) || []) {
        m.set(r.reference_article, {
          ...r,
          qte_demandee: Number(r.qte_demandee) || 0,
          stock_dispo: Number(r.stock_dispo) || 0,
          qte_immediate: Number(r.qte_immediate) || 0,
          qte_premiere_dispo: num(r.qte_premiere_dispo),
          delai_appro_jours: num(r.delai_appro_jours),
        })
      }
      setDispo(m)
    }, 120)
    return () => clearTimeout(t)
    // cleSelection résume qteParRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleSelection])

  // ── Synthèse ───────────────────────────────────────────────────────────
  const synthese = useMemo(() => {
    const refs = Array.from(qteParRef.keys())
    const lectures = new Map<string, Lecture>()
    for (const r of refs) lectures.set(r, lireDispo(dispo.get(r), aujourdhui))
    const pret = refs.length > 0 && refs.every((r) => dispo.has(r))
    let dateMax: string | null = null
    let couleur: Couleur = refs.length ? 'vert' : 'neutre'
    const bloquees: string[] = []
    const aCommander: string[] = []
    for (const r of refs) {
      const lec = lectures.get(r)!
      if (RANG[lec.couleur] > RANG[couleur]) couleur = lec.couleur
      if (dispo.get(r)?.statut === 'BLOQUE_APPRO') bloquees.push(r)
      else if (lec.date && (!dateMax || lec.date > dateMax)) dateMax = lec.date
      if (dispo.get(r)?.statut === 'SUR_DELAI_APPRO') aCommander.push(r)
    }
    const limitantes = dateMax && dateMax > aujourdhui
      ? refs.filter((r) => dispo.get(r)?.statut !== 'BLOQUE_APPRO' && lectures.get(r)?.date === dateMax)
      : []
    return { refs, lectures, pret, dateMax, couleur, bloquees, aCommander, limitantes: new Set([...limitantes, ...bloquees]) }
  }, [qteParRef, dispo, aujourdhui])

  const controles = useMemo(() => {
    const articles = selection.filter((l) => l.ref && l.type !== 'COMMENTAIRE')
    const sommeil = articles.filter((l) => l.sommeil)
    const inconnues = articles.filter((l) => l.type === 'INCONNU')
    const ecartPr = articles.filter((l) => l.type === 'ARTICLE' && alertePr(l) !== null)
    const ecartPrValeur = ecartPr.reduce((t, l) => t + (alertePr(l)?.valeur ?? 0), 0)
    // Marge sur les lignes cochées qui portent un montant.
    let montant = 0
    let coutDevis = 0
    let coutActuel = 0
    let prDevisComplet = true
    let avecMontant = false
    for (const l of selection) {
      if (l.montant === null || l.type === 'COMMENTAIRE') continue
      avecMontant = true
      montant += l.montant
      const prD = l.prDevis
      const prA = l.prActuel ?? l.prDevis
      if (l.type === 'ARTICLE' && prD === null) prDevisComplet = false
      coutDevis += (prD ?? prA ?? 0) * l.qte
      coutActuel += (prA ?? 0) * l.qte
    }
    return {
      sommeil, inconnues, ecartPr, ecartPrValeur,
      marge: avecMontant ? { montant, margeDevis: prDevisComplet ? montant - coutDevis : null, margeActuelle: montant - coutActuel } : null,
    }
  }, [selection])

  // ── Actions de sélection ───────────────────────────────────────────────
  const basculerLigne = (id: string) => {
    setDecochees((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  const lignesDuBloc = useCallback((b: number) => lignes.filter((l) => l.bloc === b && l.type !== 'COMMENTAIRE'), [lignes])

  const basculerBloc = (b: number) => {
    const ids = lignesDuBloc(b).map((l) => l.id)
    setDecochees((prev) => {
      const s = new Set(prev)
      const toutCoche = ids.every((id) => !s.has(id))
      for (const id of ids) {
        if (toutCoche) s.add(id)
        else s.delete(id)
      }
      return s
    })
  }

  const copierResume = async () => {
    const lignesTxt: string[] = []
    if (devis) lignesTxt.push(`Devis ${devis.entete.numero} — ${devis.entete.client ?? ''}`.trim())
    if (synthese.dateMax) lignesTxt.push(`Livraison possible au plus tôt : ${fmtDate(synthese.dateMax)}`)
    if (synthese.limitantes.size) lignesTxt.push(`Référence(s) limitante(s) : ${Array.from(synthese.limitantes).join(', ')}`)
    if (synthese.bloquees.length) lignesTxt.push(`Non promettable (blocage appro) : ${synthese.bloquees.join(', ')}`)
    if (synthese.aCommander.length) lignesTxt.push(`Commande d’appro à passer : ${synthese.aCommander.join(', ')}`)
    try {
      await navigator.clipboard.writeText(lignesTxt.join('\n'))
      setMessage('Résumé copié.')
    } catch {
      setMessage(lignesTxt.join(' · '))
    }
  }

  // ── Rendu ──────────────────────────────────────────────────────────────
  const aDesResultats = lignes.length > 0
  const blocs: Bloc[] = devis ? devis.blocs : [{ bloc: 1, libelle: null }]
  const plusieursBlocs = blocs.filter((b) => lignesDuBloc(b.bloc).length > 0).length > 1

  return (
    <div className={`ql ${compact ? 'qlCompact' : ''}`}>
      <style>{CSS}</style>

      {!compact && (
        <header className="qlHead">
          <div className="qlKicker">AIDE À LA COMMANDE</div>
          <h1 className="qlTitre">Quand puis-je livrer ?</h1>
          <p className="qlLead">
            Avant de créer la commande dans SAGE ou BLG : la date de livraison au plus tôt, ligne à ligne, à partir du stock projeté
            (stock − commandes clients déjà prises + commandes fournisseurs), et les points à revoir sur un devis ancien.
          </p>
        </header>
      )}

      <div className="qlOnglets" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'devis'} className={mode === 'devis' ? 'on' : ''} onClick={() => setMode('devis')}>
          📄 Un devis
        </button>
        <button type="button" role="tab" aria-selected={mode === 'liste'} className={mode === 'liste' ? 'on' : ''} onClick={() => setMode('liste')}>
          📋 Une liste d’articles
        </button>
      </div>

      {mode === 'devis' ? (
        <div className="qlSaisie">
          <form
            className="qlRecherche"
            onSubmit={(e) => {
              e.preventDefault()
              const q = recherche.trim()
              if (/^[A-Z]{1,4}\d{3,}$/i.test(q)) void chargerDevis(q)
              else if (suggestions[0]) void chargerDevis(suggestions[0].numero_piece)
            }}
          >
            <input
              className="qlInput"
              value={recherche}
              onChange={(e) => { setRecherche(e.target.value); setSuggestOuvert(true) }}
              onFocus={() => setSuggestOuvert(true)}
              onBlur={() => setTimeout(() => setSuggestOuvert(false), 180)}
              placeholder="N° de devis, client ou référence chantier…"
              autoComplete="off"
              inputMode="search"
              autoFocus={!compact && !initialDevis}
            />
            <button type="submit" className="qlBtn qlBtnPrim" disabled={chargement}>
              {chargement ? '…' : 'Contrôler'}
            </button>
            {suggestOuvert && (recherche.trim().length >= 2 ? suggestions : recents).length > 0 && (
              <div className="qlSuggest">
                <div className="qlSuggestTitre">{recherche.trim().length >= 2 ? 'Devis trouvés' : 'Vos derniers devis'}</div>
                {(recherche.trim().length >= 2 ? suggestions : recents).map((d) => (
                  <button key={d.numero_piece} type="button" className="qlSuggestItem" onMouseDown={(e) => e.preventDefault()} onClick={() => void chargerDevis(d.numero_piece)}>
                    <span className="qlMono">{d.numero_piece}</span>
                    <span className="qlSuggestClient">{d.intitule_tiers || d.numero_tiers}{d.reference ? ` · ${d.reference}` : ''}</span>
                    <span className="qlSuggestMeta">{fmtDate(d.date_devis, false)} · {fmtEur(d.ca_ht, 0)}</span>
                  </button>
                ))}
              </div>
            )}
          </form>
        </div>
      ) : (
        <div className="qlSaisie">
          <textarea
            className="qlTexte"
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData.files || []).filter((f) => f.type.startsWith('image/'))
              if (imgs.length) { e.preventDefault(); void lirePhoto(imgs) }
            }}
            placeholder={'Une ligne par article : référence puis quantité\n(copier-coller depuis Excel, un mail, un bon de commande…)\n\nRAK-DJ35RHAE\t3\nSPX-URFG1\t3'}
            rows={compact ? 6 : 7}
          />
          <div className="qlActions">
            <button type="button" className="qlBtn qlBtnPrim" onClick={() => void controlerListe()} disabled={chargement || !texte.trim()}>
              {chargement ? '…' : 'Contrôler la liste'}
            </button>
            <button type="button" className="qlBtn" onClick={() => fichierRef.current?.click()} disabled={photoEnCours}>
              {photoEnCours ? 'Lecture de l’image…' : '📷 Photo / image de la commande'}
            </button>
            {texte && (
              <button type="button" className="qlBtn qlBtnGhost" onClick={() => { setTexte(''); setLignes([]); setDispo(new Map()) }}>
                Effacer
              </button>
            )}
            <input
              ref={fichierRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              onChange={(e) => void lirePhoto(e.target.files)}
            />
          </div>
          {!compact && <div className="qlAide">Astuce : une capture d’écran collée ici (Ctrl+V) est lue comme une photo.</div>}
        </div>
      )}

      {erreur && <div className="qlMsg qlErr">{erreur}</div>}
      {message && <div className="qlMsg">{message}</div>}

      {aDesResultats && (
        <>
          {/* ── Verdict ─────────────────────────────────────────────── */}
          <section className="qlVerdict" style={{ borderColor: COULEURS[synthese.couleur].trait, background: COULEURS[synthese.couleur].fond }}>
            <div className="qlVerdictMain">
              <div className="qlVerdictLabel">
                {devis ? <>Devis <b>{devis.entete.numero}</b> · {devis.entete.client}{devis.entete.reference ? ` · ${devis.entete.reference}` : ''}</> : 'Liste d’articles'}
                {calcul && <span className="qlSpin" aria-label="calcul en cours" />}
              </div>
              <div className="qlVerdictDate" style={{ color: COULEURS[synthese.couleur].encre }}>
                {synthese.refs.length === 0
                  ? 'Aucun article stocké coché'
                  : !synthese.pret
                    ? 'Calcul en cours…'
                    : synthese.dateMax === null
                      ? 'Non promettable'
                      : synthese.dateMax <= aujourdhui
                        ? 'Tout est dispo : livrable dès aujourd’hui'
                        : `Livrable au plus tôt le ${fmtDate(synthese.dateMax)}`}
              </div>
              {synthese.pret && synthese.dateMax && synthese.dateMax > aujourdhui && (
                <div className="qlVerdictSous">
                  dans {joursEntre(aujourdhui, synthese.dateMax)} jours · fixé par{' '}
                  {Array.from(synthese.limitantes).filter((r) => !synthese.bloquees.includes(r)).map((r) => (
                    <span key={r} className="qlLimitante">⚑ {r}</span>
                  ))}
                </div>
              )}
              {synthese.pret && synthese.bloquees.length > 0 && (
                <div className="qlVerdictSous">
                  Non promettable{synthese.dateMax ? ' en plus' : ''} : {synthese.bloquees.map((r) => <span key={r} className="qlLimitante">⛔ {r}</span>)}
                </div>
              )}
              {synthese.pret && synthese.aCommander.length > 0 && (
                <div className="qlVerdictSous">🛒 Commande d’appro à passer : {synthese.aCommander.join(', ')}</div>
              )}
            </div>
            <div className="qlVerdictCote">
              {devis && devis.entete.age_jours !== null && devis.entete.age_jours > 60 && (
                <div className="qlPuce qlPuceWarn">Devis de {Math.round(devis.entete.age_jours / 30)} mois</div>
              )}
              {controles.inconnues.length > 0 && <div className="qlPuce qlPuceErr">{controles.inconnues.length} réf. inconnue{controles.inconnues.length > 1 ? 's' : ''}</div>}
              {controles.sommeil.length > 0 && <div className="qlPuce qlPuceErr">{controles.sommeil.length} article{controles.sommeil.length > 1 ? 's' : ''} en sommeil</div>}
              {controles.ecartPr.length > 0 && (
                <div className="qlPuce qlPuceWarn" title={`Écart de prix de revient > ${SEUIL_ECART_PR_PCT} % et > ${SEUIL_ECART_PR_EUR} € sur la ligne`}>
                  {controles.ecartPr.length} écart{controles.ecartPr.length > 1 ? 's' : ''} de PR &gt; {SEUIL_ECART_PR_PCT} % · {controles.ecartPrValeur > 0 ? '+' : ''}{fmtEur(controles.ecartPrValeur, 0)}
                </div>
              )}
              {devis && controles.marge && (
                <div className="qlMarge">
                  <div>Montant coché : <b>{fmtEur(controles.marge.montant, 0)}</b></div>
                  {controles.marge.margeDevis !== null && (
                    <div>Marge au PR du devis : {fmtEur(controles.marge.margeDevis, 0)} ({controles.marge.montant ? fmtPct((controles.marge.margeDevis / controles.marge.montant) * 100).replace('+', '') : '—'})</div>
                  )}
                  <div>
                    Marge au PUMP actuel : <b>{fmtEur(controles.marge.margeActuelle, 0)}</b> ({controles.marge.montant ? fmtPct((controles.marge.margeActuelle / controles.marge.montant) * 100).replace('+', '') : '—'})
                  </div>
                </div>
              )}
              <button type="button" className="qlBtn qlBtnSmall" onClick={() => void copierResume()} disabled={!synthese.pret}>Copier le résumé</button>
            </div>
          </section>

          <div className="qlLegende">
            <span><i style={{ background: COULEURS.vert.trait }} /> dispo tout de suite</span>
            <span><i style={{ background: COULEURS.orange.trait }} /> dispo à une date future</span>
            <span><i style={{ background: COULEURS.rouge.trait }} /> commande d’appro à passer / non promettable</span>
            <span>⚑ référence limitante</span>
            {devis?.source === 'LIGNES' && <span className="qlAide">Devis antérieur au tri des lignes : un seul bloc, cochez ligne à ligne.</span>}
            {plusieursBlocs && <span className="qlAide">Décochez un bloc pour voir la date sans lui.</span>}
          </div>

          {/* ── Lignes, par bloc ────────────────────────────────────── */}
          <div className="qlLignes">
            {blocs.map((b) => {
              const lb = lignes.filter((l) => l.bloc === b.bloc)
              const selectionnables = lb.filter((l) => l.type !== 'COMMENTAIRE')
              if (!selectionnables.length) return null
              const nbCoches = selectionnables.filter((l) => !decochees.has(l.id)).length
              // Date et couleur du bloc (lignes cochées)
              let couleurBloc: Couleur = 'neutre'
              let dateBloc: string | null = null
              for (const l of selectionnables) {
                if (decochees.has(l.id) || l.type !== 'ARTICLE' || !l.ref) continue
                const lec = synthese.lectures.get(l.ref)
                if (!lec) continue
                if (RANG[lec.couleur] > RANG[couleurBloc]) couleurBloc = lec.couleur
                if (lec.date && (!dateBloc || lec.date > dateBloc)) dateBloc = lec.date
              }
              return (
                <section key={b.bloc} className="qlBloc">
                  {(plusieursBlocs || b.libelle) && (
                    <label className="qlBlocTete">
                      <input
                        type="checkbox"
                        checked={nbCoches === selectionnables.length}
                        ref={(el) => { if (el) el.indeterminate = nbCoches > 0 && nbCoches < selectionnables.length }}
                        onChange={() => basculerBloc(b.bloc)}
                      />
                      <span className="qlBlocNom">{b.libelle || `Bloc ${b.bloc}`}</span>
                      {nbCoches > 0 && couleurBloc !== 'neutre' && (
                        <span className="qlBlocDate" style={{ color: COULEURS[couleurBloc].encre, borderColor: COULEURS[couleurBloc].trait }}>
                          {dateBloc && dateBloc <= aujourdhui ? 'dispo' : dateBloc ? `au plus tôt ${fmtDate(dateBloc, false)}` : 'non promettable'}
                        </span>
                      )}
                      {nbCoches === 0 && <span className="qlBlocDate">retiré</span>}
                    </label>
                  )}
                  {lb.map((l) => {
                    if (l.type === 'COMMENTAIRE') {
                      if (!l.designation || l.designation === b.libelle) return null
                      return <div key={l.id} className="qlCommentaire">{l.designation}</div>
                    }
                    return (
                      <LigneVue
                        key={l.id}
                        l={l}
                        coche={!decochees.has(l.id)}
                        onBascule={() => basculerLigne(l.id)}
                        lecture={l.ref ? synthese.lectures.get(l.ref) : undefined}
                        dispo={l.ref ? dispo.get(l.ref) : undefined}
                        qteTotaleRef={l.ref ? qteParRef.get(l.ref) ?? null : null}
                        limitante={Boolean(l.ref && synthese.limitantes.has(l.ref))}
                        avecPrixDevis={Boolean(devis)}
                      />
                    )
                  })}
                </section>
              )
            })}
          </div>

          <p className="qlNote">
            Date de mise à disposition au dépôt (hors délai de transport). Le calcul tient compte de toutes les commandes clients déjà en portefeuille
            à leur date de livraison : une commande mal datée peut retarder la date affichée.
          </p>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Une ligne
// ─────────────────────────────────────────────────────────────────────────

function LigneVue({
  l, coche, onBascule, lecture, dispo, qteTotaleRef, limitante,
}: {
  l: Ligne
  coche: boolean
  onBascule: () => void
  lecture: Lecture | undefined
  dispo: Dispo | undefined
  qteTotaleRef: number | null
  limitante: boolean
  avecPrixDevis: boolean
}) {
  const estArticle = l.type === 'ARTICLE'

  // Lignes non stockées (n° de série, prestations, textes) : une ligne discrète.
  if (l.type === 'NON_STOCKE') {
    return (
      <div className={`qlLigneMini ${coche ? '' : 'off'}`}>
        <input type="checkbox" checked={coche} onChange={onBascule} />
        <span className="qlMono">{l.ref}</span>
        <span className="qlMiniDesign">{l.designation}</span>
        <span className="qlMiniTag">non stocké · hors calcul</span>
      </div>
    )
  }

  const couleur: Couleur = !coche ? 'neutre' : l.type === 'INCONNU' ? 'rouge' : lecture?.couleur ?? 'neutre'
  const c = COULEURS[couleur]
  const alerte = estArticle ? alertePr(l) : null
  const lim = limitante && coche

  const details = [
    estArticle && coche ? lecture?.detail : null,
    estArticle && coche && dispo ? `stock dispo ${fmtQte(dispo.stock_dispo)}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div
      className={`qlLigne ${coche ? '' : 'off'} ${lim ? 'limitante' : ''}`}
      style={{ borderLeftColor: c.trait, background: lim ? undefined : c.fond, ...(lim ? { ['--ql-lim' as string]: c.trait } : {}) }}
    >
      <input className="qlCase" type="checkbox" checked={coche} onChange={onBascule} />

      <div className="qlRefCol">
        {lim && <span className="qlLimBadge" style={{ background: c.trait }}>⚑ LIMITANTE</span>}
        <span className="qlMono qlRefCode">{l.ref}</span>
        {l.sommeil && <span className="qlBadge qlBadgeErr">sommeil</span>}
        {l.type === 'INCONNU' && <span className="qlBadge qlBadgeErr">inconnue</span>}
      </div>

      <div className="qlDesign" title={l.designation || ''}>{l.designation || '—'}</div>

      <div className="qlQte">
        <span className="qlQteVal">{fmtQte(l.qte)}</span>
        {estArticle && qteTotaleRef !== null && qteTotaleRef > l.qte && coche && (
          <span className="qlQteTot" title="Quantité totale de cette référence dans les lignes cochées">/{fmtQte(qteTotaleRef)}</span>
        )}
      </div>

      <div className="qlDispo">
        {estArticle && coche ? (
          <>
            <span className="qlPill" style={{ background: c.trait }}>{lecture?.titre ?? '…'}</span>
            {details && <span className="qlDispoDetail">{details}</span>}
          </>
        ) : l.type === 'INCONNU' ? (
          <span className="qlPill" style={{ background: COULEURS.rouge.trait }}>Référence à corriger</span>
        ) : (
          <span className="qlDispoDetail">retirée</span>
        )}
      </div>

      <div className="qlPrix">
        {alerte && (
          <span
            className={`qlEcartPr ${alerte.pct > 0 ? 'hausse' : 'baisse'}`}
            title={`PR du devis ${fmtEur(l.prDevis)} → ${l.prActuelSource === 'PUMP' ? 'PUMP' : 'dernier achat'} ${fmtEur(l.prActuel)} par unité`}
          >
            PR <b>{fmtPct(alerte.pct)}</b> · <b>{alerte.valeur > 0 ? '+' : ''}{fmtEur(alerte.valeur, 0)}</b>
          </span>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Styles (variables de thème : clair et sombre)
// ─────────────────────────────────────────────────────────────────────────

const CSS = `
.ql { color: var(--cg-ink); font-family: inherit; max-width: 1920px; margin: 0 auto; padding: 14px 22px 32px; }
.qlCompact { padding: 12px 10px 28px; }
.qlHead { margin-bottom: 10px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 18px; }
.qlKicker { font-size: 11px; letter-spacing: 0.18em; font-weight: 700; color: var(--cg-sauge); }
.qlTitre { font-size: 26px; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.qlLead { margin: 0; font-size: 13px; color: rgba(var(--cg-ink-rgb),0.6); flex-basis: 100%; line-height: 1.45; }
.qlOnglets { display: inline-flex; gap: 4px; padding: 3px; border-radius: 12px; background: rgba(var(--cg-ink-rgb),0.06); margin-bottom: 8px; }
.qlOnglets button { border: 0; background: transparent; color: rgba(var(--cg-ink-rgb),0.7); font: inherit; font-size: 14px; font-weight: 600; padding: 6px 14px; border-radius: 9px; cursor: pointer; }
.qlOnglets button.on { background: var(--cg-ink); color: var(--cg-bg); }
.qlSaisie { margin-bottom: 10px; }
.qlRecherche { position: relative; display: flex; gap: 8px; max-width: 760px; }
.qlInput, .qlTexte { flex: 1; width: 100%; font: inherit; font-size: 16px; color: var(--cg-ink); background: rgba(var(--cg-ink-rgb),0.05); border: 1px solid rgba(var(--cg-ink-rgb),0.18); border-radius: 12px; padding: 9px 14px; outline: none; }
.qlInput:focus, .qlTexte:focus { border-color: var(--cg-accent); }
.qlTexte { display: block; max-width: 760px; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 14px; resize: vertical; }
.qlActions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.qlBtn { font: inherit; font-size: 14px; font-weight: 600; padding: 10px 14px; border-radius: 11px; border: 1px solid rgba(var(--cg-ink-rgb),0.2); background: rgba(var(--cg-ink-rgb),0.06); color: var(--cg-ink); cursor: pointer; white-space: nowrap; }
.qlBtn:hover:not(:disabled) { background: rgba(var(--cg-ink-rgb),0.12); }
.qlBtn:disabled { opacity: 0.5; cursor: default; }
.qlBtnPrim { background: #C1683C; border-color: #C1683C; color: #fff; }
.qlBtnPrim:hover:not(:disabled) { background: #A9572F; }
.qlBtnGhost { background: transparent; }
.qlBtnSmall { padding: 6px 10px; font-size: 12.5px; }
.qlAide { font-size: 12px; color: rgba(var(--cg-ink-rgb),0.5); margin-top: 6px; }
.qlSuggest { position: absolute; z-index: 30; top: calc(100% + 6px); left: 0; right: 0; background: var(--cg-surface); border: 1px solid rgba(var(--cg-ink-rgb),0.16); border-radius: 12px; box-shadow: 0 18px 40px rgba(0,0,0,calc(0.35 * var(--cg-shadow-k))); max-height: 380px; overflow: auto; padding: 6px; }
.qlSuggestTitre { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(var(--cg-ink-rgb),0.5); padding: 6px 8px; }
.qlSuggestItem { display: grid; grid-template-columns: 96px 1fr auto; gap: 10px; align-items: baseline; width: 100%; text-align: left; border: 0; background: transparent; color: var(--cg-ink); font: inherit; font-size: 13.5px; padding: 8px; border-radius: 8px; cursor: pointer; }
.qlSuggestItem:hover { background: rgba(var(--cg-ink-rgb),0.08); }
.qlSuggestClient { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qlSuggestMeta { font-size: 12px; color: rgba(var(--cg-ink-rgb),0.55); white-space: nowrap; }
.qlMono { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-weight: 600; }
.qlMsg { margin: 8px 0; padding: 10px 12px; border-radius: 10px; background: rgba(var(--cg-ink-rgb),0.06); font-size: 13.5px; }
.qlErr { background: var(--cg-danger-bg); color: var(--cg-danger-text); border: 1px solid var(--cg-danger-border); }
.qlVerdict { display: flex; flex-wrap: wrap; gap: 12px 24px; justify-content: space-between; border: 1px solid; border-left-width: 6px; border-radius: 14px; padding: 10px 16px; margin: 4px 0 8px; }
.qlVerdictMain { flex: 1 1 420px; min-width: 0; }
.qlVerdictLabel { font-size: 13px; color: rgba(var(--cg-ink-rgb),0.7); display: flex; align-items: center; gap: 8px; }
.qlVerdictDate { font-size: 24px; font-weight: 700; margin: 2px 0 4px; letter-spacing: -0.01em; }
.qlVerdictSous { font-size: 13px; margin-top: 2px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.qlLimitante { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: rgba(var(--cg-ink-rgb),0.12); }
.qlVerdictCote { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: 0 1 340px; }
.qlPuce { font-size: 12.5px; font-weight: 600; padding: 4px 10px; border-radius: 999px; }
.qlPuceWarn { background: rgba(214,154,74,0.18); color: var(--cg-warn-ink); }
.qlPuceErr { background: var(--cg-danger-bg); color: var(--cg-danger-text); }
.qlMarge { font-size: 12.5px; text-align: right; color: rgba(var(--cg-ink-rgb),0.75); line-height: 1.5; }
.qlLegende { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: rgba(var(--cg-ink-rgb),0.6); margin: 2px 0 6px; align-items: center; }
.qlLegende i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
.qlLegende .qlAide { margin: 0; }
.qlLignes { display: flex; flex-direction: column; gap: 8px; }
.qlBloc { border: 1px solid rgba(var(--cg-ink-rgb),0.1); border-radius: 10px; overflow: hidden; background: rgba(var(--cg-ink-rgb),0.02); }
.qlBlocTete { display: flex; align-items: center; gap: 10px; padding: 6px 14px; background: rgba(var(--cg-ink-rgb),0.06); cursor: pointer; font-weight: 700; font-size: 13.5px; }
.qlBlocTete input { width: 17px; height: 17px; }
.qlBlocNom { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.qlBlocDate { font-size: 12px; font-weight: 600; border: 1px solid rgba(var(--cg-ink-rgb),0.2); border-radius: 999px; padding: 2px 9px; white-space: nowrap; color: rgba(var(--cg-ink-rgb),0.6); }
.qlCommentaire { font-size: 12px; font-style: italic; color: rgba(var(--cg-ink-rgb),0.5); padding: 2px 14px 2px 42px; }
.qlLigne { display: grid; grid-template-columns: 22px minmax(150px, 210px) minmax(180px, 1fr) 64px minmax(330px, 1.1fr) minmax(150px, 190px); gap: 12px; align-items: center; padding: 5px 14px; border-left: 6px solid; border-top: 1px solid rgba(var(--cg-ink-rgb),0.07); min-height: 36px; }
.qlLigne.off { opacity: 0.4; background: transparent !important; }
.qlLigne.limitante { background: color-mix(in srgb, var(--ql-lim) 24%, transparent); box-shadow: inset 0 0 0 2px var(--ql-lim); }
.qlLigne.limitante .qlRefCode { font-size: 15.5px; }
.qlCase { width: 16px; height: 16px; margin: 0; }
.qlRefCol { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.qlRefCode { font-size: 14px; white-space: nowrap; }
.qlLimBadge { color: #fff; font-size: 10.5px; font-weight: 800; letter-spacing: 0.05em; padding: 2px 7px; border-radius: 5px; white-space: nowrap; }
.qlPill { display: inline-block; color: #fff; font-size: 13px; font-weight: 700; padding: 3px 10px; border-radius: 999px; line-height: 1.35; white-space: nowrap; }
.qlLigneMini { display: flex; align-items: center; gap: 10px; padding: 1px 14px 1px 20px; border-top: 1px solid rgba(var(--cg-ink-rgb),0.04); font-size: 11.5px; color: rgba(var(--cg-ink-rgb),0.42); }
.qlLigneMini.off { opacity: 0.5; }
.qlLigneMini input { width: 13px; height: 13px; margin: 0; }
.qlLigneMini .qlMono { font-size: 11.5px; }
.qlMiniDesign { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qlMiniTag { font-size: 11px; white-space: nowrap; }
.qlEcartPr { display: inline-block; white-space: nowrap; padding: 2px 9px; border-radius: 8px; font-size: 12.5px; }
.qlEcartPr.hausse { background: rgba(200,55,45,0.14); color: var(--cg-danger-text); border: 1px solid rgba(200,55,45,0.45); }
.qlEcartPr.baisse { background: rgba(46,139,87,0.12); color: var(--cg-ok-text); border: 1px solid rgba(46,139,87,0.4); }
.qlCase input { width: 17px; height: 17px; margin-top: 2px; }
.qlArt { min-width: 0; }
.qlRef { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 14px; }
.qlDesign { font-size: 12.5px; color: rgba(var(--cg-ink-rgb),0.62); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.qlBadge { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: rgba(var(--cg-ink-rgb),0.1); color: rgba(var(--cg-ink-rgb),0.75); }
.qlBadgeLim { background: var(--cg-warn); color: #1b1206; }
.qlBadgeErr { background: var(--cg-danger-bg); color: var(--cg-danger-text); }
.qlQte { text-align: right; font-variant-numeric: tabular-nums; }
.qlQteVal { font-size: 15px; font-weight: 700; }
.qlQteTot { font-size: 11px; color: rgba(var(--cg-ink-rgb),0.5); margin-left: 2px; }
.qlDispoTitre { font-size: 13.5px; font-weight: 700; }
.qlDispo { display: flex; align-items: center; gap: 10px; min-width: 0; }
.qlDispoDetail { font-size: 12px; color: rgba(var(--cg-ink-rgb),0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.qlPrix { font-size: 12.5px; text-align: right; font-variant-numeric: tabular-nums; line-height: 1.3; color: rgba(var(--cg-ink-rgb),0.8); }
.qlPrixDoux { color: rgba(var(--cg-ink-rgb),0.6); }
.qlPrixAlerte { color: var(--cg-warn-ink); font-weight: 600; }
.qlRemise { color: rgba(var(--cg-ink-rgb),0.5); font-weight: 400; }
.qlNote { font-size: 12px; color: rgba(var(--cg-ink-rgb),0.5); margin-top: 14px; }
.qlSpin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid rgba(var(--cg-ink-rgb),0.25); border-top-color: var(--cg-ink); animation: qlTourne 0.8s linear infinite; display: inline-block; }
@keyframes qlTourne { to { transform: rotate(360deg); } }
@media (max-width: 900px) {
  .qlLigne { grid-template-columns: 22px 1fr auto; gap: 4px 10px; padding: 6px 10px; }
  .qlDesign { grid-column: 2 / -1; grid-row: 2; }
  .qlDispo, .qlPrix { grid-column: 2 / -1; text-align: left; flex-wrap: wrap; }
  .qlDispoDetail { white-space: normal; }
  .qlVerdictCote { align-items: flex-start; flex-basis: 100%; }
  .qlMarge { text-align: left; }
  .qlVerdictDate { font-size: 21px; }
  .qlSuggestItem { grid-template-columns: 84px 1fr; }
  .qlSuggestMeta { grid-column: 2; }
}
`
