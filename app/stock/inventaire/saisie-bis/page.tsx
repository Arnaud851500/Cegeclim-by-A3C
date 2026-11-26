'use client'

/**
 * Écran « Inventaire — saisie dépôt » V2 EN TEST (/stock/inventaire/saisie-bis?id=<inventaire dépôt>).
 * ---------------------------------------------------------------------------
 * Créé le 26/11/2026 à la demande d'Arnaud, en page « bis » à côté de la V1
 * (/stock/inventaire/saisie, inchangée) : à valider avant l'inventaire du 28/11/2026.
 *
 * Différences avec la V1 :
 *  - SAISIES PAR ÉQUIPE CUMULÉES : un article rangé dans plusieurs zones est compté par plusieurs
 *    équipes. Une fois les initiales saisies, la case de saisie ne montre QUE la quantité de cette
 *    équipe (vide tant qu'elle n'a pas compté la ligne) ; les quantités des autres équipes sont
 *    affichées à droite ; la quantité de la ligne = somme des équipes (RPC inv_saisir_equipe,
 *    table inventaire_saisies, migration 20261126_inventaire_saisies_equipes.sql).
 *    Bouton ✎ : correction de la saisie de n'importe quelle équipe avant la clôture.
 *  - TRI au choix : alphabétique (réf. CEGECLIM) ou famille puis réf., avec rupture (nom de la
 *    famille) en début de famille, à l'écran et sur la feuille imprimée.
 *  - FEUILLE PDF portrait dense (pdfListeComptageV2) : en-tête réduit à partir de la page 2,
 *    désignation 40 caractères, sans colonne « Éq. », mode de tri en en-tête.
 *  - Filtre « À saisir » : la liste est figée au clic (une ligne ne disparaît plus dès le 1er
 *    chiffre tapé) ; recliquer sur le filtre pour la rafraîchir.
 *  - Intégration des feuilles scannées en mode équipes (chaque équipe garde sa quantité).
 *
 * Inchangé : contrôle des initiales (différentes d'un comptage à l'autre, ligne par ligne),
 * périmètre dépôt (can_stocks), fin du comptage, article hors liste, transit, rafraîchissement 30 s.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import {
  AIDE_TRANSIT, LIB_TRI, ORDINAL, ORDINAL_LONG, couleurStatut, fmtDate, fmtDateHeure, fmtEuro, fmtNum, fmtQte, libelleStatut,
  lireQuantite, membresCommuns, messageErreur, normaliserEquipe, pdfListeComptageV2, sectionLigneV2, trierLignes,
  type InvDepot, type LigneSaisie, type ListeSaisie, type SaisieEquipe, type TriListe,
} from '@/lib/inventaire'
import ImportFeuilles from '@/components/inventaire/ImportFeuilles'

type InvAgence = InvDepot & { nb_a_compter: number; nb_saisies: number }
type Brouillon = { qte: string; com: string; etat: 'idle' | 'saving' | 'ok' | 'err'; msg?: string }
type Filtre = 'tous' | 'a_saisir' | 'saisis' | 'mon_equipe' | 'ecart_stock'
type Correction = { ligne: LigneSaisie; lignes: Array<{ equipe: string; qte: string; com: string; etat: 'idle' | 'saving' | 'ok' | 'err'; msg?: string }> }

const cleEquipe = (id: string, n: number) => `cegeclim-inv-equipe:${id}:${n}`
function lireEquipe(id: string, n: number): string {
  try { return window.localStorage.getItem(cleEquipe(id, n)) || '' } catch { return '' }
}
function ecrireEquipe(id: string, n: number, v: string) {
  try { if (v) window.localStorage.setItem(cleEquipe(id, n), v); else window.localStorage.removeItem(cleEquipe(id, n)) } catch { /* stockage indisponible */ }
}
const CLE_TRI = 'cegeclim-inv-tri'
function lireTri(): TriListe {
  try { return window.localStorage.getItem(CLE_TRI) === 'famille' ? 'famille' : 'alpha' } catch { return 'alpha' }
}

const vQte = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','))
const saisieDe = (l: LigneSaisie, eq: string): SaisieEquipe | undefined => (eq ? (l.saisies || []).find((s) => s.equipe === eq) : undefined)
const brouillonDe = (l: LigneSaisie, eq: string): Brouillon => {
  const s = saisieDe(l, eq)
  return { qte: vQte(s?.qte ?? null), com: s?.commentaire || '', etat: 'idle' }
}

function SaisieInventaireV2() {
  const router = useRouter()
  const params = useSearchParams()
  const [inventaires, setInventaires] = useState<InvAgence[] | null>(null)
  const [selId, setSelId] = useState<string | null>(params.get('id'))
  const [liste, setListe] = useState<ListeSaisie | null>(null)
  const [brouillons, setBrouillons] = useState<Record<number, Brouillon>>({})
  const [erreur, setErreur] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  /** Équipe validée sur cet appareil (vide = à saisir) et champ en cours de frappe. */
  const [equipe, setEquipe] = useState('')
  const [initiales, setInitiales] = useState('')
  const [editEquipe, setEditEquipe] = useState(false)
  const [search, setSearch] = useState('')
  const [filtre, setFiltre] = useState<Filtre>('tous')
  /** Filtre « À saisir » : lignes figées au clic (ne disparaissent pas pendant la frappe). */
  const [figees, setFigees] = useState<Set<number> | null>(null)
  const [tri, setTri] = useState<TriListe>('alpha')
  const [confirmFin, setConfirmFin] = useState(false)
  const [finEnCours, setFinEnCours] = useState(false)
  const [ajoutRef, setAjoutRef] = useState('')
  const [ajoutEnCours, setAjoutEnCours] = useState(false)
  const [importOuvert, setImportOuvert] = useState(false)
  const [correction, setCorrection] = useState<Correction | null>(null)
  const tableRef = useRef<HTMLTableSectionElement | null>(null)

  function changerTri(t: TriListe) {
    setTri(t)
    try { window.localStorage.setItem(CLE_TRI, t) } catch { /* stockage indisponible */ }
  }

  const appliquerInventaires = useCallback((data: unknown, error: unknown) => {
    if (error) { setErreur(messageErreur(error)); setInventaires([]); return }
    const rows = (data || []) as InvAgence[]
    setInventaires(rows)
    setSelId((cur) => {
      if (cur && rows.some((r) => r.id === cur)) return cur
      return (rows.find((r) => r.statut === 'comptage') || rows[0])?.id ?? null
    })
  }, [])

  const chargerInventaires = useCallback(async () => {
    const { data, error } = await supabase.rpc('inv_saisie_depots')
    appliquerInventaires(data, error)
  }, [appliquerInventaires])

  const appliquerListe = useCallback((data: unknown, error: unknown) => {
    if (error) { setErreur(messageErreur(error)); setListe(null); return }
    setErreur(null)
    const l = data as ListeSaisie
    const eq = lireEquipe(l.id, l.numero)
    setListe(l)
    setEquipe(eq); setInitiales(eq); setEditEquipe(!eq)
    setBrouillons(Object.fromEntries(l.lignes.map((x) => [x.id, brouillonDe(x, eq)])))
    setFigees(null)
    setTri(lireTri())
  }, [])

  /** Rafraîchissement silencieux (saisies des autres tablettes) sans écraser une ligne en cours de frappe. */
  const listeRef = useRef<ListeSaisie | null>(null)
  const equipeRef = useRef('')
  useEffect(() => { listeRef.current = liste }, [liste])
  useEffect(() => { equipeRef.current = equipe }, [equipe])
  const fusionnerListe = useCallback((data: unknown) => {
    const l = data as ListeSaisie
    const cur = listeRef.current
    const eq = equipeRef.current
    if (!cur || cur.id !== l.id || cur.numero !== l.numero) return
    const ancien = new Map(cur.lignes.map((x) => [x.id, x]))
    setBrouillons((bs) => {
      const out = { ...bs }
      for (const x of l.lignes) {
        const b = bs[x.id]
        const a = ancien.get(x.id)
        const avant = a ? brouillonDe(a, eq) : null
        const propre = !b || (b.etat !== 'saving' && b.etat !== 'err' && (!avant || (b.qte === avant.qte && b.com === avant.com)))
        if (propre) out[x.id] = { ...brouillonDe(x, eq), etat: b?.etat === 'ok' ? 'ok' : 'idle' }
      }
      return out
    })
    setListe(l)
  }, [])

  const chargerListe = useCallback(async (id: string) => {
    const { data, error } = await supabase.rpc('inv_saisie_liste', { p_inv_depot_id: id })
    appliquerListe(data, error)
  }, [appliquerListe])

  useEffect(() => {
    let annule = false
    void supabase.rpc('inv_saisie_depots').then(({ data, error }) => { if (!annule) appliquerInventaires(data, error) })
    return () => { annule = true }
  }, [appliquerInventaires])
  useEffect(() => {
    if (!selId) return
    let annule = false
    void supabase.rpc('inv_saisie_liste', { p_inv_depot_id: selId }).then(({ data, error }) => { if (!annule) appliquerListe(data, error) })
    router.replace(`/stock/inventaire/saisie-bis?id=${selId}`)
    return () => { annule = true }
  }, [selId, appliquerListe, router])

  const chargement = !!selId && liste?.id !== selId && !erreur
  const numero = liste?.numero ?? 1
  const comptage = liste?.comptages.find((c) => c.numero === numero)
  const ouvert = !!liste && liste.statut === 'comptage' && comptage?.statut === 'en_cours'
  const initialesOk = !!equipe
  const editable = ouvert && initialesOk
  const equipesComptage = (comptage?.initiales || '').split(',').map((x) => x.trim()).filter(Boolean)

  // Saisies des autres équipes : relecture toutes les 30 s pendant le comptage.
  const listeId = liste?.id
  useEffect(() => {
    if (!listeId || !ouvert) return
    const t = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void supabase.rpc('inv_saisie_liste', { p_inv_depot_id: listeId }).then(({ data, error }) => { if (!error && data) fusionnerListe(data) })
    }, 30000)
    return () => window.clearInterval(t)
  }, [listeId, ouvert, fusionnerListe])

  /** Inventoristes de l'équipe courante ayant déjà compté la ligne à un comptage précédent. */
  const bloqueePour = (l: LigneSaisie) => (numero > 1 && equipe ? membresCommuns(equipe, l.equipes_prec) : [])

  function choisirFiltre(f: Filtre) {
    setFiltre(f)
    // « À saisir » : liste figée au clic ; recliquer pour la rafraîchir.
    setFigees(f === 'a_saisir' ? new Set((liste?.lignes || []).filter((l) => l.qte === null).map((l) => l.id)) : null)
  }

  const lignesAffichees = useMemo(() => {
    const q = search.trim().toUpperCase()
    return trierLignes(liste?.lignes || [], tri).filter((l) => {
      if (filtre === 'a_saisir' && !(figees?.has(l.id) ?? l.qte === null)) return false
      if (filtre === 'saisis' && l.qte === null) return false
      if (filtre === 'mon_equipe' && !saisieDe(l, equipe)) return false
      if (filtre === 'ecart_stock' && (l.qte === null || l.qte === l.qte_theorique)) return false
      if (!q) return true
      return [l.reference, l.ref_fournisseur, l.designation, l.famille, l.famille_macro].some((x) => (x || '').toUpperCase().includes(q))
    })
  }, [liste, search, filtre, figees, equipe, tri])

  const nbTotal = liste?.lignes.length ?? 0
  const nbSaisis = (liste?.lignes || []).filter((l) => l.qte !== null).length
  const nbErreurs = Object.values(brouillons).filter((b) => b.etat === 'err').length
  const nbEnCours = Object.values(brouillons).filter((b) => b.etat === 'saving').length
  const valeurStock = (liste?.lignes || []).reduce((s, l) => s + l.qte_theorique * l.pump, 0)
  const nbMonEquipe = equipe ? (liste?.lignes || []).filter((l) => saisieDe(l, equipe)).length : 0
  const nbMultiEquipes = (liste?.lignes || []).filter((l) => (l.saisies || []).length > 1).length
  const nbBloquees = (liste?.lignes || []).filter((l) => l.qte === null && bloqueePour(l).length > 0).length
  const selectionActive = filtre !== 'tous' || search.trim() !== ''

  async function validerInitiales() {
    if (!liste) return
    setErreur(null)
    const { data, error } = await supabase.rpc('inv_comptage_initiales', { p_inv_depot_id: liste.id, p_numero: numero, p_initiales: normaliserEquipe(initiales) })
    if (error) { setErreur(messageErreur(error)); return }
    const eq = String(data)
    const changement = !!equipe && equipe !== eq
    setEquipe(eq); setInitiales(eq); setEditEquipe(false)
    ecrireEquipe(liste.id, numero, eq)
    // Les cases de saisie montrent désormais les quantités de CETTE équipe.
    setBrouillons(Object.fromEntries(liste.lignes.map((x) => [x.id, brouillonDe(x, eq)])))
    setInfo(changement
      ? `Équipe changée : les cases montrent maintenant les quantités comptées par ${eq} (vides si elle n’a pas encore compté la ligne).`
      : `Équipe ${eq} : les quantités saisies sur cet appareil lui sont attribuées et s’ajoutent à celles des autres équipes.`)
  }

  function majLigne(id: number, data: unknown) {
    const r = data as { qte: number | null; commentaire: string | null; initiales: string | null; saisies: SaisieEquipe[] } | null
    if (!r) return
    setListe((cur) => cur && ({
      ...cur,
      lignes: cur.lignes.map((x) => (x.id === id ? { ...x, qte: r.qte, commentaire: r.commentaire, initiales: r.initiales, saisies: r.saisies } : x)),
      comptages: cur.comptages.map((c) => {
        if (c.numero !== numero) return c
        const eqs = (c.initiales || '').split(',').map((v) => v.trim()).filter(Boolean)
        const nouvelles = (r.saisies || []).map((s) => s.equipe).filter((e) => !eqs.includes(e))
        return nouvelles.length ? { ...c, initiales: [...eqs, ...nouvelles].join(', ') } : c
      }),
    }))
  }

  async function enregistrer(l: LigneSaisie, b: Brouillon) {
    if (!liste || !editable) return
    const q = lireQuantite(b.qte)
    if (Number.isNaN(q)) { setBrouillons((cur) => ({ ...cur, [l.id]: { ...b, etat: 'err', msg: 'Quantité invalide' } })); return }
    if (q !== null && q < 0) { setBrouillons((cur) => ({ ...cur, [l.id]: { ...b, etat: 'err', msg: 'Quantité négative' } })); return }
    const com = b.com.trim()
    const mienne = saisieDe(l, equipe)
    if (q === (mienne?.qte ?? null) && com === (mienne?.commentaire || '')) return
    const communs = bloqueePour(l)
    if (communs.length > 0) {
      setBrouillons((cur) => ({ ...cur, [l.id]: { ...b, etat: 'err', msg: `Déjà comptée par ${communs.join('/')} : une autre équipe doit la recompter` } }))
      return
    }
    setBrouillons((cur) => ({ ...cur, [l.id]: { ...b, etat: 'saving', msg: undefined } }))
    const { data, error } = await supabase.rpc('inv_saisir_equipe', {
      p_ligne_id: l.id, p_numero: numero, p_equipe: equipe, p_qte: q, p_commentaire: com || null, p_mode: 'remplacer',
    })
    if (error) {
      setBrouillons((cur) => ({ ...cur, [l.id]: { ...(cur[l.id] || b), etat: 'err', msg: messageErreur(error) } }))
      return
    }
    majLigne(l.id, data)
    setBrouillons((cur) => ({ ...cur, [l.id]: { ...(cur[l.id] || b), etat: 'ok', msg: undefined } }))
  }

  /** Entrée : passe à la ligne suivante ; la perte de focus enregistre la ligne quittée. */
  function focusSuivant(e: React.KeyboardEvent<HTMLInputElement>, id: number, champ: 'qte' | 'com') {
    e.preventDefault()
    const inputs = Array.from(tableRef.current?.querySelectorAll<HTMLInputElement>(`input[data-champ="${champ}"]`) || [])
    const i = inputs.findIndex((x) => x.dataset.id === String(id))
    const next = inputs[i + 1]
    if (next) { next.focus(); next.select() } else e.currentTarget.blur()
  }

  // ── Correction des saisies de chaque équipe (avant clôture) ────────────────────────
  function ouvrirCorrection(l: LigneSaisie) {
    setCorrection({ ligne: l, lignes: (l.saisies || []).map((s) => ({ equipe: s.equipe, qte: vQte(s.qte), com: s.commentaire || '', etat: 'idle' })) })
  }
  async function corriger(i: number, supprimer = false) {
    if (!correction || !liste) return
    const c = correction.lignes[i]
    const q = supprimer ? null : lireQuantite(c.qte)
    const maj = (patch: Partial<Correction['lignes'][number]>) =>
      setCorrection((cur) => cur && ({ ...cur, lignes: cur.lignes.map((x, k) => (k === i ? { ...x, ...patch } : x)) }))
    if (q !== null && (Number.isNaN(q) || q < 0)) { maj({ etat: 'err', msg: 'Quantité invalide' }); return }
    maj({ etat: 'saving', msg: undefined })
    const { data, error } = await supabase.rpc('inv_saisir_equipe', {
      p_ligne_id: correction.ligne.id, p_numero: numero, p_equipe: c.equipe, p_qte: q,
      p_commentaire: supprimer ? null : c.com.trim() || null, p_mode: 'remplacer',
    })
    if (error) { maj({ etat: 'err', msg: messageErreur(error) }); return }
    majLigne(correction.ligne.id, data)
    const r = data as { saisies: SaisieEquipe[] }
    setCorrection((cur) => cur && ({ ...cur, lignes: (r.saisies || []).map((s) => ({ equipe: s.equipe, qte: vQte(s.qte), com: s.commentaire || '', etat: s.equipe === c.equipe ? 'ok' as const : 'idle' as const })) }))
    // La case de l'équipe courante suit la correction de sa propre saisie.
    if (c.equipe === equipe) {
      const s = (r.saisies || []).find((x) => x.equipe === equipe)
      setBrouillons((cur) => ({ ...cur, [correction.ligne.id]: { qte: vQte(s?.qte ?? null), com: s?.commentaire || '', etat: 'ok' } }))
    }
  }

  async function terminer() {
    if (!liste) return
    setFinEnCours(true); setErreur(null)
    const { error } = await supabase.rpc('inv_comptage_terminer', { p_inv_depot_id: liste.id, p_numero: numero })
    setFinEnCours(false); setConfirmFin(false)
    if (error) { setErreur(messageErreur(error)); return }
    setInfo(`${ORDINAL[numero]} comptage terminé : la saisie est verrouillée, les achats analysent les écarts.`)
    await Promise.all([chargerListe(liste.id), chargerInventaires()])
  }

  async function ajouterHorsListe() {
    if (!liste || !ajoutRef.trim()) return
    setAjoutEnCours(true); setErreur(null)
    const { data, error } = await supabase.rpc('inv_ajouter_hors_liste', { p_inv_depot_id: liste.id, p_reference: ajoutRef.trim() })
    setAjoutEnCours(false)
    if (error) { setErreur(messageErreur(error)); return }
    const l = { ...(data as LigneSaisie), saisies: [] }
    setListe((cur) => cur && ({ ...cur, lignes: [...cur.lignes, l] }))
    setBrouillons((cur) => ({ ...cur, [l.id]: { qte: '', com: '', etat: 'idle' } }))
    setAjoutRef('')
    setSearch(l.reference); choisirFiltre('tous')
    setInfo(`${l.reference} ajoutée à la liste (stock SAGE ${fmtQte(l.qte_theorique)}) : saisir la quantité trouvée.`)
    setTimeout(() => {
      const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-champ="qte"][data-id="${l.id}"]`)
      el?.focus()
    }, 50)
  }

  function imprimer(avecSaisies: boolean, selection = false) {
    if (!liste) return
    const libFiltre: Record<Filtre, string> = { tous: '', a_saisir: 'à saisir', saisis: 'saisies', mon_equipe: `équipe ${equipe}`, ecart_stock: 'écart au stock' }
    const sel = selection ? [libFiltre[filtre], search.trim() ? `« ${search.trim()} »` : ''].filter(Boolean).join(', ') : undefined
    pdfListeComptageV2(liste, { avecSaisies, lignes: selection ? lignesAffichees : undefined, selection: sel, tri })
  }

  const ctl = 'h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[14px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const NB_COL = 8

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-3 py-3 text-[#111820] sm:px-4" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1500px] space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#C9B3E6] bg-[#F3EEFA] px-4 py-2 text-[12.5px] text-[#4B2F7A]">
          <span><b>Version 2 en test</b> — saisies cumulées par équipe, tri famille, feuille portrait. Les données sont les mêmes que la V1.</span>
          <Link href={`/stock/inventaire/saisie${selId ? `?id=${selId}` : ''}`} className="font-bold underline">Revenir à la V1</Link>
        </div>

        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Inventaire (V2)</p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">
              {liste ? `${liste.depot_libelle} · ${ORDINAL[numero]} comptage` : 'Saisie de l’inventaire'}
            </h1>
            {liste && (
              <p className="text-[12px] text-[#8A8474]">
                {liste.campagne?.libelle} · inventaire du {fmtDate(liste.campagne?.date_inventaire)} · stock SAGE du {fmtDateHeure(liste.stock_sage_le)}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {inventaires && inventaires.length > 1 && (
              <select value={selId || ''} onChange={(e) => { setSelId(e.target.value); setSearch(''); choisirFiltre('tous'); setInfo(null) }} className={`${ctl} font-bold`}>
                {inventaires.map((i) => (
                  <option key={i.id} value={i.id}>{i.depot_libelle} — {i.campagne?.libelle} ({libelleStatut(i)})</option>
                ))}
              </select>
            )}
            {liste && (
              <>
                <div className="flex overflow-hidden rounded-lg border border-[#E5E1D8]" title="Ordre de la liste à l'écran et sur la feuille imprimée">
                  {([['alpha', 'Tri alpha'], ['famille', 'Tri famille']] as Array<[TriListe, string]>).map(([k, lib]) => (
                    <button key={k} type="button" onClick={() => changerTri(k)}
                      className={`h-10 px-3 text-[13px] font-bold ${tri === k ? 'bg-[#1D4F91] text-white' : 'bg-white text-[#3A362E] hover:bg-[#F4F3F0]'}`}>{lib}</button>
                  ))}
                </div>
                <button type="button" onClick={() => imprimer(false)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-bold hover:bg-[#F4F3F0]" title={`Liste à compter, cases vides — ${LIB_TRI[tri]}`}>🖨 Imprimer la liste</button>
                {nbSaisis > 0 && (
                  <button type="button" onClick={() => imprimer(true)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-bold hover:bg-[#F4F3F0]" title="Liste avec les quantités déjà saisies (total des équipes)">🖨 Avec les saisies</button>
                )}
                {selectionActive && lignesAffichees.length > 0 && (
                  <button type="button" onClick={() => imprimer(nbSaisis > 0 && filtre !== 'a_saisir', true)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-bold hover:bg-[#F4F3F0]" title="Imprimer uniquement les lignes affichées (filtre / recherche) pour les confier à une équipe">🖨 Sélection ({fmtNum(lignesAffichees.length)})</button>
                )}
              </>
            )}
            {liste && ouvert && (
              <button type="button" onClick={() => setImportOuvert(true)} className="h-10 rounded-lg bg-[#111820] px-3 text-[13px] font-bold text-white" title="Feuilles de comptage scannées : chaque équipe garde sa quantité, cumulée avec les autres">📄 Intégrer des feuilles (PDF)</button>
            )}
            <button type="button" onClick={() => { void chargerInventaires(); if (selId) void chargerListe(selId) }} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[14px] font-bold" title="Actualiser">↻</button>
          </div>
        </section>

        {erreur && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[13px] font-semibold text-red-800">{erreur}</div>}
        {info && !erreur && <div className="rounded-xl border border-[#BFE0C1] bg-[#E9F5EA] px-4 py-2.5 text-[13px] font-semibold text-[#2F6F33]">{info}</div>}

        {inventaires && inventaires.length === 0 && (
          <section className="rounded-xl border border-[#E5E1D8] bg-white p-6 text-[14px] text-[#5E5A44]">
            Aucun inventaire ouvert pour votre dépôt. Les listes sont activées par le service achats : revenez sur cet écran le jour de l’inventaire.
          </section>
        )}

        {liste && (
          <>
            <section className="grid gap-2.5 lg:grid-cols-[1.1fr_1fr_1fr]">
              <div className="rounded-xl border border-[#E5E1D8] bg-white p-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-0.5 text-[12px] font-bold ${couleurStatut(liste.statut)}`}>{libelleStatut(liste)}</span>
                </div>
                {ouvert ? (
                  <div className="mt-2.5">
                    <label className="block text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Équipe de comptage sur cet appareil ({ORDINAL[numero]} comptage)</label>
                    {initialesOk && !editEquipe ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="rounded-lg bg-[#111820] px-3 py-1.5 text-[18px] font-bold tracking-widest text-white">{equipe}</span>
                        <button type="button" onClick={() => { setEditEquipe(true); setInitiales('') }}
                          className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-bold hover:bg-[#F4F3F0]"
                          title="Saisie d'une feuille d'une autre équipe ou relève d'équipe">⇄ Changer d’équipe</button>
                        <span className="text-[12px] text-[#5E5A44]">{fmtNum(nbMonEquipe)} ligne(s) comptée(s) par {equipe}</span>
                      </div>
                    ) : (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <input value={initiales} onChange={(e) => setInitiales(e.target.value.toUpperCase())} maxLength={20} autoFocus={!!equipe}
                          onKeyDown={(e) => { if (e.key === 'Enter') void validerInitiales(); if (e.key === 'Escape' && equipe) { setEditEquipe(false); setInitiales(equipe) } }}
                          placeholder="ex. PJC ou PJC/AV" className={`${ctl} w-52 text-center text-[18px] font-bold tracking-widest`} />
                        <button type="button" onClick={() => void validerInitiales()} disabled={!normaliserEquipe(initiales)}
                          className="h-10 rounded-lg bg-[#111820] px-3 text-[13px] font-bold text-white disabled:opacity-40">Valider</button>
                        {equipe && <button type="button" onClick={() => { setEditEquipe(false); setInitiales(equipe) }} className="h-10 rounded-lg border border-[#E5E1D8] px-3 text-[13px] font-bold">Annuler</button>}
                      </div>
                    )}
                    <p className="mt-1 text-[12px] text-[#8A8474]">
                      La case de saisie montre seulement ce que <b>votre équipe</b> a compté ; les quantités des autres équipes s’affichent à droite et <b>s’ajoutent</b> (article rangé dans plusieurs zones). ✎ pour corriger la saisie d’une équipe.
                      {numero > 1 && ' Une ligne ne peut pas être recomptée par un inventoriste qui l’a déjà comptée.'}
                    </p>
                    {equipesComptage.length > 0 && (
                      <p className="mt-0.5 text-[12px] text-[#5E5A44]">Équipes ayant saisi ce comptage : <b>{equipesComptage.join(' · ')}</b>{nbMultiEquipes > 0 && <> · {fmtNum(nbMultiEquipes)} ligne(s) comptée(s) par plusieurs équipes</>}</p>
                    )}
                    {nbBloquees > 0 && (
                      <p className="mt-0.5 text-[12px] font-semibold text-[#96600F]">{fmtNum(nbBloquees)} ligne(s) restant à saisir ont déjà été comptées par {equipe} : à confier à une autre équipe.</p>
                    )}
                    {!initialesOk && <p className="mt-1 text-[12px] font-semibold text-[#B4761A]">Les initiales de l’équipe sont obligatoires avant de saisir les quantités.</p>}
                  </div>
                ) : (
                  <p className="mt-2.5 text-[13px] text-[#5E5A44]">
                    {liste.statut === 'valide'
                      ? `Inventaire validé par les achats le ${fmtDateHeure(liste.valide_le)}.`
                      : `Comptage terminé le ${fmtDateHeure(comptage?.termine_le)} (équipes ${comptage?.initiales || '—'}). La saisie est verrouillée : les achats analysent les écarts et peuvent demander un ${numero < 3 ? ORDINAL[numero + 1] + ' ' : 'nouveau '}comptage sur certaines lignes.`}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-[#E5E1D8] bg-white p-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Avancement</div>
                <div className="mt-1 text-[24px] font-bold leading-8">{fmtNum(nbSaisis)} <span className="text-[15px] font-semibold text-[#8A8474]">/ {fmtNum(nbTotal)} références comptées</span></div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[#EFECE4]">
                  <div className="h-full rounded-full bg-[#3F9142] transition-all" style={{ width: `${nbTotal ? (nbSaisis / nbTotal) * 100 : 0}%` }} />
                </div>
                <div className="mt-1 text-[12px] text-[#8A8474]">
                  {nbEnCours > 0 ? 'Enregistrement…' : nbErreurs > 0 ? <span className="font-semibold text-red-700">{nbErreurs} ligne(s) non enregistrée(s)</span> : 'Chaque saisie est enregistrée immédiatement.'}
                  {' · '}valeur en stock {fmtEuro(valeurStock)}
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-xl border border-[#E5E1D8] bg-white p-3">
                <div className="text-[12.5px] text-[#5E5A44]">
                  {ouvert
                    ? <>Toutes les lignes doivent être comptées (0 si l’article est absent) pour terminer. Vérifiez que toutes les équipes ont saisi. Après la fin du {ORDINAL_LONG[numero]} comptage, plus aucune modification n’est possible.</>
                    : <>Les quantités des comptages précédents ne sont pas affichées : chaque comptage est fait à l’aveugle.</>}
                </div>
                {ouvert && (
                  <button type="button" onClick={() => setConfirmFin(true)} disabled={!initialesOk || nbSaisis < nbTotal || nbEnCours > 0 || nbErreurs > 0}
                    className="mt-2 h-12 rounded-lg bg-[#2F6F33] px-4 text-[15px] font-bold text-white disabled:bg-[#B8B3A4]"
                    title={nbSaisis < nbTotal ? `${nbTotal - nbSaisis} ligne(s) restent à saisir` : ''}>
                    ✓ Fin du {ORDINAL_LONG[numero]} comptage {nbSaisis < nbTotal ? `(${nbTotal - nbSaisis} à saisir)` : ''}
                  </button>
                )}
              </div>
            </section>

            <section className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Référence, réf. fournisseur, désignation, famille…" className={`${ctl} min-w-[220px] flex-1`} />
              <div className="flex overflow-hidden rounded-lg border border-[#E5E1D8]">
                {([['tous', 'Toutes'], ['a_saisir', 'À saisir'], ['saisis', 'Saisies'], ...(equipe ? [['mon_equipe', `Équipe ${equipe}`]] : []), ['ecart_stock', '≠ stock']] as Array<[Filtre, string]>).map(([k, lib]) => (
                  <button key={k} type="button" onClick={() => choisirFiltre(k)}
                    title={k === 'a_saisir' ? 'Lignes non comptées au moment du clic (recliquer pour rafraîchir)' : undefined}
                    className={`h-10 px-3 text-[13px] font-bold ${filtre === k ? 'bg-[#111820] text-white' : 'bg-white text-[#3A362E] hover:bg-[#F4F3F0]'}`}>{lib}{k === 'a_saisir' && filtre === k ? ' ↻' : ''}</button>
                ))}
              </div>
              {ouvert && numero === 1 && (
                <div className="flex items-center gap-1.5">
                  <input value={ajoutRef} onChange={(e) => setAjoutRef(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') void ajouterHorsListe() }}
                    placeholder="Article hors liste (réf.)" className={`${ctl} w-48`} disabled={!initialesOk} />
                  <button type="button" onClick={() => void ajouterHorsListe()} disabled={!initialesOk || !ajoutRef.trim() || ajoutEnCours}
                    className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-bold disabled:opacity-40">+ Ajouter</button>
                </div>
              )}
              <span className="text-[12px] text-[#8A8474]">{fmtNum(lignesAffichees.length)} ligne(s) · {tri === 'famille' ? 'tri famille' : 'tri alpha'}</span>
            </section>

            <section className="overflow-hidden rounded-xl border border-[#E5E1D8] bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1040px] border-collapse text-[13.5px]">
                  <thead className="sticky top-0 z-10 bg-[#FAF8F3]">
                    <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
                      <th className="px-3 py-2">Réf. CEGECLIM</th>
                      <th className="px-2 py-2">Réf. fournisseur</th>
                      <th className="px-2 py-2">Désignation</th>
                      <th className="px-2 py-2 text-right">Qté stock</th>
                      <th className="px-2 py-2 text-center">Ma qté{equipe ? ` (${equipe})` : ''}</th>
                      <th className="px-2 py-2">Autres équipes · total</th>
                      <th className="px-2 py-2 text-right">PUMP</th>
                      <th className="px-2 py-2">Commentaire</th>
                    </tr>
                  </thead>
                  <tbody ref={tableRef}>
                    {chargement && <tr><td colSpan={NB_COL} className="px-3 py-8 text-center text-[#8A8474]">Chargement…</td></tr>}
                    {!chargement && lignesAffichees.map((l, i) => {
                      const b = brouillons[l.id] || brouillonDe(l, equipe)
                      const section = sectionLigneV2(l, tri)
                      const sectionPrec = i > 0 ? sectionLigneV2(lignesAffichees[i - 1], tri) : null
                      const autres = (l.saisies || []).filter((s) => s.equipe !== equipe)
                      const communs = bloqueePour(l)
                      const bloquee = communs.length > 0
                      const editableLigne = editable && !bloquee
                      const diff = l.qte !== null && l.qte !== l.qte_theorique
                      return (
                        <React.Fragment key={l.id}>
                          {section !== sectionPrec && (l.transit || tri === 'famille' || sectionPrec !== null) && (
                            l.transit ? (
                              <tr><td colSpan={NB_COL} className="border-t border-[#B9CFEE] bg-[#E8F0FB] px-3 py-1.5 text-[12px] text-[#1D4F91]">
                                <span className="font-bold uppercase tracking-wide">{section}</span> · {AIDE_TRANSIT}
                              </td></tr>
                            ) : (
                              <tr><td colSpan={NB_COL} className="border-t border-[#D9D4C7] bg-[#EFECE4] px-3 py-1.5 text-[12px] font-bold uppercase tracking-wide text-[#3A362E]">{section}</td></tr>
                            )
                          )}
                          <tr className={`border-t border-[#EFECE4] ${b.etat === 'err' ? 'bg-red-50' : l.qte === null ? '' : 'bg-[#F7FBF7]'}`}>
                            <td className="px-3 py-1.5 font-bold">
                              {l.reference}
                              {l.hors_liste && <span className="ml-1.5 rounded bg-[#FDF3E3] px-1.5 py-0.5 text-[10px] font-bold text-[#96600F]">hors liste</span>}
                              {l.transit && <span className="ml-1.5 rounded bg-[#E8F0FB] px-1.5 py-0.5 text-[10px] font-bold text-[#1D4F91]">transit</span>}
                            </td>
                            <td className="px-2 py-1.5 text-[#5E5A44]">{l.ref_fournisseur || '—'}</td>
                            <td className="px-2 py-1.5">{l.designation || '—'}</td>
                            <td className="px-2 py-1.5 text-right font-semibold">{fmtQte(l.qte_theorique)}</td>
                            <td className="px-2 py-1 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <input
                                  data-champ="qte" data-id={l.id} inputMode="decimal" value={b.qte} disabled={!editableLigne}
                                  placeholder={editableLigne ? '—' : ''}
                                  title={bloquee ? `Déjà comptée par ${communs.join('/')} au comptage précédent : une autre équipe doit la recompter` : 'Quantité comptée par votre équipe (s’ajoute à celles des autres équipes)'}
                                  onChange={(e) => setBrouillons((cur) => ({ ...cur, [l.id]: { ...b, qte: e.target.value, etat: 'idle', msg: undefined } }))}
                                  onBlur={() => void enregistrer(l, b)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') focusSuivant(e, l.id, 'qte') }}
                                  onFocus={(e) => e.currentTarget.select()}
                                  className="h-10 w-24 rounded-lg border border-[#D9D4C7] text-center text-[16px] font-bold outline-none focus:border-[#B4761A] disabled:bg-[#F4F3F0]"
                                />
                                <span className="w-4 text-[13px]" title={b.msg || ''}>
                                  {b.etat === 'saving' ? '…' : b.etat === 'ok' ? <span className="text-[#3F9142]">✓</span> : b.etat === 'err' ? <span className="text-red-700">!</span> : ''}
                                </span>
                              </div>
                              {b.etat === 'err' && b.msg && <div className="mt-0.5 text-[11px] font-semibold text-red-700">{b.msg}</div>}
                            </td>
                            <td className="px-2 py-1.5 text-[12px]">
                              <div className="flex flex-wrap items-center gap-1">
                                {autres.map((s) => (
                                  <span key={s.equipe} className="rounded bg-[#EFECE4] px-1.5 py-0.5 font-semibold text-[#3A362E]" title={s.commentaire || undefined}>
                                    {s.equipe} <b>{fmtQte(s.qte)}</b>
                                  </span>
                                ))}
                                {l.qte !== null && (autres.length > 0 || !saisieDe(l, equipe)) && (
                                  <span className={`rounded px-1.5 py-0.5 font-bold ${diff ? 'bg-[#FDF3E3] text-[#96600F]' : 'bg-[#E9F5EA] text-[#2F6F33]'}`} title="Total compté (toutes équipes)">= {fmtQte(l.qte)}</span>
                                )}
                                {l.qte === null && autres.length === 0 && (bloquee
                                  ? <span className="text-[11px] font-semibold text-[#96600F]" title={`Comptée par ${l.equipes_prec} au comptage précédent`}>autre équipe</span>
                                  : <span className="text-[#C9C4B6]">—</span>)}
                                {ouvert && (l.saisies || []).length > 0 && (
                                  <button type="button" onClick={() => ouvrirCorrection(l)} className="ml-0.5 rounded border border-[#D9D4C7] bg-white px-1.5 py-0.5 text-[12px] font-bold text-[#5E5A44] hover:bg-[#F4F3F0]" title="Voir et corriger les saisies de chaque équipe">✎</button>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-1.5 text-right text-[#5E5A44]">{fmtEuro(l.pump, 2)}</td>
                            <td className="px-2 py-1">
                              <input
                                data-champ="com" data-id={l.id} value={b.com} disabled={!editableLigne} maxLength={300}
                                onChange={(e) => setBrouillons((cur) => ({ ...cur, [l.id]: { ...b, com: e.target.value, etat: 'idle', msg: undefined } }))}
                                onBlur={() => void enregistrer(l, b)}
                                onKeyDown={(e) => { if (e.key === 'Enter') focusSuivant(e, l.id, 'com') }}
                                placeholder={editableLigne ? 'Commentaire de l’équipe' : ''}
                                className="h-10 w-full min-w-[150px] rounded-lg border border-[#E5E1D8] px-2 text-[13px] outline-none focus:border-[#B4761A] disabled:bg-[#F4F3F0]"
                              />
                            </td>
                          </tr>
                        </React.Fragment>
                      )
                    })}
                    {!chargement && lignesAffichees.length === 0 && (
                      <tr><td colSpan={NB_COL} className="px-3 py-8 text-center text-[#8A8474]">Aucune ligne pour ce filtre.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      {importOuvert && liste && (
        <ImportFeuilles
          depots={[{ id: liste.id, depot_libelle: liste.depot_libelle, depot_num: liste.depot_num, statut: liste.statut, comptage_courant: liste.comptage_courant, campagne: liste.campagne }]}
          depotFixe={liste.id}
          equipeParDefaut={equipe}
          modeEquipes
          onFermer={() => setImportOuvert(false)}
          onEnregistre={() => { void chargerListe(liste.id); void chargerInventaires() }}
        />
      )}

      {correction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCorrection(null)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[17px] font-bold">{correction.ligne.reference} — saisies par équipe</h2>
            <p className="mt-0.5 text-[12.5px] text-[#5E5A44]">{correction.ligne.designation} · stock SAGE {fmtQte(correction.ligne.qte_theorique)}</p>
            <table className="mt-3 w-full text-[13.5px]">
              <thead className="text-left text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
                <tr><th className="py-1">Équipe</th><th className="py-1 text-center">Qté</th><th className="py-1">Commentaire</th><th /></tr>
              </thead>
              <tbody>
                {correction.lignes.map((c, i) => (
                  <tr key={c.equipe} className="border-t border-[#EFECE4]">
                    <td className="py-1.5 pr-2 font-bold">{c.equipe}{c.equipe === equipe && <span className="ml-1 text-[10px] font-semibold text-[#8A8474]">(vous)</span>}</td>
                    <td className="py-1.5 pr-2 text-center">
                      <input value={c.qte} inputMode="decimal" onChange={(e) => setCorrection((cur) => cur && ({ ...cur, lignes: cur.lignes.map((x, k) => (k === i ? { ...x, qte: e.target.value, etat: 'idle' } : x)) }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') void corriger(i) }}
                        className="h-9 w-20 rounded-lg border border-[#D9D4C7] text-center text-[15px] font-bold outline-none focus:border-[#B4761A]" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input value={c.com} onChange={(e) => setCorrection((cur) => cur && ({ ...cur, lignes: cur.lignes.map((x, k) => (k === i ? { ...x, com: e.target.value, etat: 'idle' } : x)) }))}
                        className="h-9 w-full rounded-lg border border-[#E5E1D8] px-2 text-[13px] outline-none focus:border-[#B4761A]" />
                      {c.etat === 'err' && c.msg && <div className="mt-0.5 text-[11px] font-semibold text-red-700">{c.msg}</div>}
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-right">
                      <button type="button" onClick={() => void corriger(i)} disabled={c.etat === 'saving'} className="h-9 rounded-lg bg-[#111820] px-2.5 text-[12px] font-bold text-white disabled:opacity-50">{c.etat === 'saving' ? '…' : c.etat === 'ok' ? '✓' : 'Enregistrer'}</button>
                      <button type="button" onClick={() => void corriger(i, true)} disabled={c.etat === 'saving'} className="ml-1 h-9 rounded-lg border border-[#E8B4AE] px-2 text-[12px] font-bold text-[#B42318]" title="Supprimer la saisie de cette équipe">✕</button>
                    </td>
                  </tr>
                ))}
                {correction.lignes.length === 0 && <tr><td colSpan={4} className="py-3 text-center text-[#8A8474]">Plus aucune saisie sur cette ligne.</td></tr>}
              </tbody>
            </table>
            <div className="mt-3 flex items-center justify-between text-[13px]">
              <span>Total compté : <b>{fmtQte((liste?.lignes.find((x) => x.id === correction.ligne.id) || correction.ligne).qte)}</b></span>
              <button type="button" onClick={() => setCorrection(null)} className="h-9 rounded-lg border border-[#E5E1D8] px-4 text-[13px] font-bold">Fermer</button>
            </div>
          </div>
        </div>
      )}

      {confirmFin && liste && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !finEnCours && setConfirmFin(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[18px] font-bold">Terminer le {ORDINAL_LONG[numero]} comptage ?</h2>
            <p className="mt-2 text-[14px] text-[#3A362E]">
              {liste.depot_libelle} · {fmtNum(nbTotal)} lignes comptées par {equipesComptage.length > 1 ? `les équipes ${equipesComptage.join(', ')}` : `l’équipe ${equipesComptage[0] || equipe}`}.
              Vérifiez que toutes les équipes ont terminé leur saisie avant de clôturer.
              Après validation, <b>plus aucune quantité ne pourra être modifiée</b> : les achats analysent les écarts et peuvent demander un nouveau comptage.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmFin(false)} disabled={finEnCours} className="h-10 rounded-lg border border-[#E5E1D8] px-4 text-[14px] font-bold">Annuler</button>
              <button type="button" onClick={() => void terminer()} disabled={finEnCours} className="h-10 rounded-lg bg-[#2F6F33] px-4 text-[14px] font-bold text-white disabled:opacity-50">
                {finEnCours ? 'Clôture…' : `Oui, fin du ${ORDINAL_LONG[numero]} comptage`}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default function SaisieInventaireV2Page() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>}>
      <SaisieInventaireV2 />
    </Suspense>
  )
}
