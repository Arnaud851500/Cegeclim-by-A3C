'use client'

/**
 * Écran « Inventaire — saisie dépôt » (menu Stocks & logistique, /stock/inventaire/saisie?id=<inventaire dépôt>).
 * ---------------------------------------------------------------------------
 * Créé le 01/11/2026 pour l'inventaire de fin d'année (≈ samedi 28/11/2026).
 *
 * Utilisé en agence (PC ou tablette) pour le 1er, 2e et 3e comptage :
 *  - initiales de l'inventoriste obligatoires avant toute saisie, différentes d'un
 *    comptage à l'autre (contrôlé en base) ;
 *  - liste du comptage en cours : réf. CEGECLIM, réf. fournisseur, désignation, qté en
 *    stock, quantité comptée, PUMP, commentaire ; enregistrement à chaque saisie,
 *    Entrée = ligne suivante ;
 *  - 2e / 3e comptage : seules les lignes renvoyées par les achats, sans les quantités
 *    des comptages précédents ;
 *  - « Imprimer la liste » (PDF) pour compter sur papier puis saisir ;
 *  - « Fin du comptage » seulement quand toutes les lignes sont saisies : la saisie est
 *    ensuite verrouillée et les achats analysent les écarts ;
 *  - 1er comptage : ajout d'un article trouvé en rayon mais absent de la liste.
 *
 * Accès : droit can_stocks ; dépôt limité à l'agence de l'utilisateur (périmètre agences
 * de l'onglet Utilisateurs d'Autorisations, MEES = DAX) ; achats = tous les dépôts.
 * Sources : RPC inv_saisie_depots, inv_saisie_liste, inv_comptage_initiales, inv_saisir,
 * inv_ajouter_hors_liste, inv_comptage_terminer (migration 20261101_inventaire_annuel.sql).
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import {
  ORDINAL, ORDINAL_LONG, couleurStatut, fmtDate, fmtDateHeure, fmtEuro, fmtNum, fmtQte, libelleStatut,
  lireQuantite, messageErreur, pdfListeComptage,
  type InvDepot, type LigneSaisie, type ListeSaisie,
} from '@/lib/inventaire'

type InvAgence = InvDepot & { nb_a_compter: number; nb_saisies: number }
type Brouillon = { qte: string; com: string; etat: 'idle' | 'saving' | 'ok' | 'err'; msg?: string }
type Filtre = 'tous' | 'a_saisir' | 'saisis' | 'ecart_stock'

const vQte = (v: number | null) => (v === null || v === undefined ? '' : String(v).replace('.', ','))

function SaisieInventaire() {
  const router = useRouter()
  const params = useSearchParams()
  const [inventaires, setInventaires] = useState<InvAgence[] | null>(null)
  const [selId, setSelId] = useState<string | null>(params.get('id'))
  const [liste, setListe] = useState<ListeSaisie | null>(null)
  const [brouillons, setBrouillons] = useState<Record<number, Brouillon>>({})
  const [erreur, setErreur] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [initiales, setInitiales] = useState('')
  const [search, setSearch] = useState('')
  const [filtre, setFiltre] = useState<Filtre>('tous')
  const [confirmFin, setConfirmFin] = useState(false)
  const [finEnCours, setFinEnCours] = useState(false)
  const [ajoutRef, setAjoutRef] = useState('')
  const [ajoutEnCours, setAjoutEnCours] = useState(false)
  const tableRef = useRef<HTMLTableSectionElement | null>(null)

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
    setListe(l)
    setBrouillons(Object.fromEntries(l.lignes.map((x) => [x.id, { qte: vQte(x.qte), com: x.commentaire || '', etat: 'idle' as const }])))
    const c = l.comptages.find((k) => k.numero === l.numero)
    setInitiales(c?.initiales || '')
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
    router.replace(`/stock/inventaire/saisie?id=${selId}`)
    return () => { annule = true }
  }, [selId, appliquerListe, router])

  const chargement = !!selId && liste?.id !== selId && !erreur
  const numero = liste?.numero ?? 1
  const comptage = liste?.comptages.find((c) => c.numero === numero)
  const autresInitiales = (liste?.comptages || []).filter((c) => c.numero !== numero && c.initiales)
  const ouvert = !!liste && liste.statut === 'comptage' && comptage?.statut === 'en_cours'
  const initialesOk = !!comptage?.initiales
  const editable = ouvert && initialesOk

  const lignesAffichees = useMemo(() => {
    const q = search.trim().toUpperCase()
    return (liste?.lignes || []).filter((l) => {
      const b = brouillons[l.id]
      const saisie = b ? b.qte.trim() !== '' : l.qte !== null
      if (filtre === 'a_saisir' && saisie) return false
      if (filtre === 'saisis' && !saisie) return false
      if (filtre === 'ecart_stock') {
        const v = b ? lireQuantite(b.qte) : l.qte
        if (v === null || Number.isNaN(v) || v === l.qte_theorique) return false
      }
      if (!q) return true
      return [l.reference, l.ref_fournisseur, l.designation, l.famille].some((x) => (x || '').toUpperCase().includes(q))
    })
  }, [liste, brouillons, search, filtre])

  const nbTotal = liste?.lignes.length ?? 0
  const nbSaisis = (liste?.lignes || []).filter((l) => l.qte !== null).length
  const nbErreurs = Object.values(brouillons).filter((b) => b.etat === 'err').length
  const nbEnCours = Object.values(brouillons).filter((b) => b.etat === 'saving').length
  const valeurStock = (liste?.lignes || []).reduce((s, l) => s + l.qte_theorique * l.pump, 0)

  async function validerInitiales() {
    if (!liste) return
    setErreur(null)
    const { data, error } = await supabase.rpc('inv_comptage_initiales', { p_inv_depot_id: liste.id, p_numero: numero, p_initiales: initiales })
    if (error) { setErreur(messageErreur(error)); return }
    setInitiales(String(data))
    setListe((cur) => cur && ({ ...cur, comptages: cur.comptages.map((c) => (c.numero === numero ? { ...c, initiales: String(data) } : c)) }))
    setInfo(`Initiales ${data} enregistrées pour le ${ORDINAL[numero]} comptage.`)
  }

  async function enregistrer(l: LigneSaisie, b: Brouillon) {
    if (!liste || !editable) return
    const q = lireQuantite(b.qte)
    if (Number.isNaN(q)) { setBrouillons((cur) => ({ ...cur, [l.id]: { ...b, etat: 'err', msg: 'Quantité invalide' } })); return }
    if (q !== null && q < 0) { setBrouillons((cur) => ({ ...cur, [l.id]: { ...b, etat: 'err', msg: 'Quantité négative' } })); return }
    const com = b.com.trim()
    if (q === l.qte && com === (l.commentaire || '')) return
    setBrouillons((cur) => ({ ...cur, [l.id]: { ...b, etat: 'saving', msg: undefined } }))
    const { error } = await supabase.rpc('inv_saisir', { p_ligne_id: l.id, p_numero: numero, p_qte: q, p_commentaire: com || null })
    if (error) {
      setBrouillons((cur) => ({ ...cur, [l.id]: { ...(cur[l.id] || b), etat: 'err', msg: messageErreur(error) } }))
      return
    }
    setListe((cur) => cur && ({ ...cur, lignes: cur.lignes.map((x) => (x.id === l.id ? { ...x, qte: q, commentaire: com || null } : x)) }))
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
    const l = data as LigneSaisie
    setListe((cur) => cur && ({ ...cur, lignes: [...cur.lignes, l] }))
    setBrouillons((cur) => ({ ...cur, [l.id]: { qte: '', com: '', etat: 'idle' } }))
    setAjoutRef('')
    setSearch(l.reference); setFiltre('tous')
    setInfo(`${l.reference} ajoutée à la liste (stock SAGE ${fmtQte(l.qte_theorique)}) : saisir la quantité trouvée.`)
    setTimeout(() => {
      const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-champ="qte"][data-id="${l.id}"]`)
      el?.focus()
    }, 50)
  }

  function imprimer(avecSaisies: boolean) {
    if (!liste) return
    pdfListeComptage(liste, { avecSaisies })
  }

  const ctl = 'h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[14px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-3 py-3 text-[#111820] sm:px-4" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1500px] space-y-2.5">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Inventaire</p>
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
              <select value={selId || ''} onChange={(e) => { setSelId(e.target.value); setSearch(''); setFiltre('tous'); setInfo(null) }} className={`${ctl} font-bold`}>
                {inventaires.map((i) => (
                  <option key={i.id} value={i.id}>{i.depot_libelle} — {i.campagne?.libelle} ({libelleStatut(i)})</option>
                ))}
              </select>
            )}
            {liste && (
              <>
                <button type="button" onClick={() => imprimer(false)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-bold hover:bg-[#F4F3F0]" title="Liste à compter, cases vides">🖨 Imprimer la liste</button>
                {nbSaisis > 0 && (
                  <button type="button" onClick={() => imprimer(true)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-bold hover:bg-[#F4F3F0]" title="Liste avec les quantités déjà saisies">🖨 Avec les saisies</button>
                )}
              </>
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
            {/* Statut, initiales, avancement */}
            <section className="grid gap-2.5 lg:grid-cols-[1.1fr_1fr_1fr]">
              <div className="rounded-xl border border-[#E5E1D8] bg-white p-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-0.5 text-[12px] font-bold ${couleurStatut(liste.statut)}`}>{libelleStatut(liste)}</span>
                </div>
                {ouvert ? (
                  <div className="mt-2.5">
                    <label className="block text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Initiales de l’inventoriste ({ORDINAL[numero]} comptage)</label>
                    <div className="mt-1 flex items-center gap-2">
                      <input value={initiales} onChange={(e) => setInitiales(e.target.value.toUpperCase())} maxLength={8}
                        onKeyDown={(e) => { if (e.key === 'Enter') void validerInitiales() }}
                        placeholder="ex. PJC" className={`${ctl} w-28 text-center text-[18px] font-bold tracking-widest`} />
                      <button type="button" onClick={() => void validerInitiales()} disabled={!initiales.trim() || initiales === comptage?.initiales}
                        className="h-10 rounded-lg bg-[#111820] px-3 text-[13px] font-bold text-white disabled:opacity-40">
                        {initialesOk ? 'Modifier' : 'Valider'}
                      </button>
                      {initialesOk && <span className="text-[13px] font-bold text-[#2F6F33]">✓ {comptage?.initiales}</span>}
                    </div>
                    {autresInitiales.length > 0 && (
                      <p className="mt-1 text-[12px] text-[#8A8474]">
                        Doivent être différentes de : {autresInitiales.map((c) => `${c.initiales} (${ORDINAL[c.numero]} comptage)`).join(', ')}
                      </p>
                    )}
                    {!initialesOk && <p className="mt-1 text-[12px] font-semibold text-[#B4761A]">Les initiales sont obligatoires avant de saisir les quantités.</p>}
                  </div>
                ) : (
                  <p className="mt-2.5 text-[13px] text-[#5E5A44]">
                    {liste.statut === 'valide'
                      ? `Inventaire validé par les achats le ${fmtDateHeure(liste.valide_le)}.`
                      : `Comptage terminé le ${fmtDateHeure(comptage?.termine_le)} (${comptage?.initiales || '—'}). La saisie est verrouillée : les achats analysent les écarts et peuvent demander un ${numero < 3 ? ORDINAL[numero + 1] + ' ' : 'nouveau '}comptage sur certaines lignes.`}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-[#E5E1D8] bg-white p-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Avancement</div>
                <div className="mt-1 text-[24px] font-bold leading-8">{fmtNum(nbSaisis)} <span className="text-[15px] font-semibold text-[#8A8474]">/ {fmtNum(nbTotal)} lignes saisies</span></div>
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
                    ? <>Toutes les lignes doivent être saisies (0 si l’article est absent) pour terminer. Après la fin du {ORDINAL_LONG[numero]} comptage, plus aucune modification n’est possible.</>
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

            {/* Barre d'outils */}
            <section className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Référence, réf. fournisseur, désignation…" className={`${ctl} min-w-[220px] flex-1`} />
              <div className="flex overflow-hidden rounded-lg border border-[#E5E1D8]">
                {([['tous', 'Toutes'], ['a_saisir', 'À saisir'], ['saisis', 'Saisies'], ['ecart_stock', '≠ stock']] as Array<[Filtre, string]>).map(([k, lib]) => (
                  <button key={k} type="button" onClick={() => setFiltre(k)}
                    className={`h-10 px-3 text-[13px] font-bold ${filtre === k ? 'bg-[#111820] text-white' : 'bg-white text-[#3A362E] hover:bg-[#F4F3F0]'}`}>{lib}</button>
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
              <span className="text-[12px] text-[#8A8474]">{fmtNum(lignesAffichees.length)} ligne(s)</span>
            </section>

            {/* Liste */}
            <section className="overflow-hidden rounded-xl border border-[#E5E1D8] bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] border-collapse text-[13.5px]">
                  <thead className="sticky top-0 z-10 bg-[#FAF8F3]">
                    <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
                      <th className="px-3 py-2">Réf. CEGECLIM</th>
                      <th className="px-2 py-2">Réf. fournisseur</th>
                      <th className="px-2 py-2">Désignation</th>
                      <th className="px-2 py-2 text-right">Qté stock</th>
                      <th className="px-2 py-2 text-center">Qté comptée</th>
                      <th className="px-2 py-2 text-right">PUMP</th>
                      <th className="px-2 py-2">Commentaire</th>
                    </tr>
                  </thead>
                  <tbody ref={tableRef}>
                    {chargement && <tr><td colSpan={7} className="px-3 py-8 text-center text-[#8A8474]">Chargement…</td></tr>}
                    {!chargement && lignesAffichees.map((l, i) => {
                      const b = brouillons[l.id] || { qte: vQte(l.qte), com: l.commentaire || '', etat: 'idle' as const }
                      const macro = l.famille_macro || 'Sans famille macro'
                      const macroPrec = i > 0 ? (lignesAffichees[i - 1].famille_macro || 'Sans famille macro') : null
                      const vq = lireQuantite(b.qte)
                      const diff = vq !== null && !Number.isNaN(vq) && vq !== l.qte_theorique
                      return (
                        <React.Fragment key={l.id}>
                          {macro !== macroPrec && (
                            <tr><td colSpan={7} className="border-t border-[#E5E1D8] bg-[#F4F3F0] px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[#5E5A44]">{macro}</td></tr>
                          )}
                          <tr className={`border-t border-[#EFECE4] ${b.etat === 'err' ? 'bg-red-50' : l.qte === null ? '' : 'bg-[#F7FBF7]'}`}>
                            <td className="px-3 py-1.5 font-bold">
                              {l.reference}
                              {l.hors_liste && <span className="ml-1.5 rounded bg-[#FDF3E3] px-1.5 py-0.5 text-[10px] font-bold text-[#96600F]">hors liste</span>}
                            </td>
                            <td className="px-2 py-1.5 text-[#5E5A44]">{l.ref_fournisseur || '—'}</td>
                            <td className="px-2 py-1.5">{l.designation || '—'}</td>
                            <td className="px-2 py-1.5 text-right font-semibold">{fmtQte(l.qte_theorique)}</td>
                            <td className="px-2 py-1 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <input
                                  data-champ="qte" data-id={l.id} inputMode="decimal" value={b.qte} disabled={!editable}
                                  onChange={(e) => setBrouillons((cur) => ({ ...cur, [l.id]: { ...b, qte: e.target.value, etat: 'idle', msg: undefined } }))}
                                  onBlur={() => void enregistrer(l, b)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') focusSuivant(e, l.id, 'qte') }}
                                  onFocus={(e) => e.currentTarget.select()}
                                  className={`h-10 w-24 rounded-lg border text-center text-[16px] font-bold outline-none focus:border-[#B4761A] disabled:bg-[#F4F3F0] ${diff ? 'border-[#F0D4A6] text-[#96600F]' : 'border-[#D9D4C7]'}`}
                                />
                                <span className="w-4 text-[13px]" title={b.msg || ''}>
                                  {b.etat === 'saving' ? '…' : b.etat === 'ok' ? <span className="text-[#3F9142]">✓</span> : b.etat === 'err' ? <span className="text-red-700">!</span> : ''}
                                </span>
                              </div>
                              {b.etat === 'err' && b.msg && <div className="mt-0.5 text-[11px] font-semibold text-red-700">{b.msg}</div>}
                            </td>
                            <td className="px-2 py-1.5 text-right text-[#5E5A44]">{fmtEuro(l.pump, 2)}</td>
                            <td className="px-2 py-1">
                              <input
                                data-champ="com" data-id={l.id} value={b.com} disabled={!editable} maxLength={300}
                                onChange={(e) => setBrouillons((cur) => ({ ...cur, [l.id]: { ...b, com: e.target.value, etat: 'idle', msg: undefined } }))}
                                onBlur={() => void enregistrer(l, b)}
                                onKeyDown={(e) => { if (e.key === 'Enter') focusSuivant(e, l.id, 'com') }}
                                placeholder={editable ? 'Commentaire' : ''}
                                className="h-10 w-full min-w-[160px] rounded-lg border border-[#E5E1D8] px-2 text-[13px] outline-none focus:border-[#B4761A] disabled:bg-[#F4F3F0]"
                              />
                            </td>
                          </tr>
                        </React.Fragment>
                      )
                    })}
                    {!chargement && lignesAffichees.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-[#8A8474]">Aucune ligne pour ce filtre.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      {confirmFin && liste && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !finEnCours && setConfirmFin(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[18px] font-bold">Terminer le {ORDINAL_LONG[numero]} comptage ?</h2>
            <p className="mt-2 text-[14px] text-[#3A362E]">
              {liste.depot_libelle} · {fmtNum(nbTotal)} lignes saisies par {comptage?.initiales}.
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

export default function SaisieInventairePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>}>
      <SaisieInventaire />
    </Suspense>
  )
}
