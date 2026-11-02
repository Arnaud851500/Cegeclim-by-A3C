'use client'

/**
 * Éditeur de diagnostic — Hotline technique / SAV (/hotline/diagnostic).
 * Créé le 02/11/2026. Réservé au droit can_hotline_expert (RLS en base).
 *
 * - Parcours (arbres) par filière × motif, avec famille de produit, actif et
 *   « publié sur l'extranet » (préparé pour le libre-service pro).
 * - Questions (nœuds) : consigne pour le niveau 1, documents à afficher
 *   (procédures, schémas, firmwares), réponses → question suivante, ou fin de
 *   parcours avec préconisation (et option « proposer l'escalade »).
 * - Lignes 3CX : numéro appelé → filière.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'
import HotlineHeader, { HotlineErreur } from '@/components/hotline/HotlineHeader'
import {
  FILIERES,
  MOTIFS,
  chargerArbres,
  chargerLignes,
  chargerNoeuds,
  libelleFiliere,
  libelleMotif,
  messageErreur,
  type Arbre,
  type Choix,
  type DocumentLien,
  type Filiere,
  type Ligne,
  type Motif,
  type Noeud,
} from '@/lib/hotline'

const champ = 'h-9 w-full rounded-lg border border-[#D8D3C8] bg-white px-2.5 text-[13px] text-slate-900 outline-none focus:border-[#B4761A]'
const petitBouton = 'rounded-lg border border-[#D8D3C8] px-2.5 py-1 text-[12px] font-semibold text-slate-700 hover:border-[#B4761A] disabled:opacity-40'

export default function HotlineDiagnosticPage() {
  const { rights, email } = useAccess()
  const expert = Boolean(rights.can_hotline_expert || rights.can_autorisation)

  const [arbres, setArbres] = useState<Arbre[]>([])
  const [arbreId, setArbreId] = useState<string>('')
  const [noeuds, setNoeuds] = useState<Noeud[]>([])
  const [modifies, setModifies] = useState<Set<string>>(new Set())
  const [lignes, setLignes] = useState<Array<Ligne & { nouveau?: boolean }>>([])
  const [erreur, setErreur] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [nouveau, setNouveau] = useState<{ filiere: Filiere; motif: Motif; nom: string; famille: string }>({
    filiere: 'THERMIQUE',
    motif: 'MISE_EN_SERVICE',
    nom: '',
    famille: '',
  })

  const chargerTout = useCallback(async () => {
    try {
      const [a, l] = await Promise.all([chargerArbres(), chargerLignes()])
      setArbres(a)
      setLignes(l)
      setArbreId((id) => id || a[0]?.id || '')
    } catch (e) {
      setErreur(messageErreur(e))
    }
  }, [])

  useEffect(() => {
    void chargerTout()
  }, [chargerTout])

  useEffect(() => {
    setNoeuds([])
    setModifies(new Set())
    if (!arbreId) return
    chargerNoeuds(arbreId).then(setNoeuds).catch((e) => setErreur(messageErreur(e)))
  }, [arbreId])

  const arbre = arbres.find((a) => a.id === arbreId) || null
  const libellesNoeuds = useMemo(() => new Map(noeuds.map((n, i) => [n.id, `Q${i + 1} · ${n.question || 'Sans titre'}`])), [noeuds])

  function patchArbre(p: Partial<Arbre>) {
    setArbres((list) => list.map((a) => (a.id === arbreId ? { ...a, ...p } : a)))
  }

  function patchNoeud(id: string, p: Partial<Noeud>) {
    setNoeuds((list) => list.map((n) => (n.id === id ? { ...n, ...p } : n)))
    setModifies((s) => new Set(s).add(id))
  }

  function patchChoix(n: Noeud, index: number, p: Partial<Choix>) {
    patchNoeud(n.id, { choix: n.choix.map((c, i) => (i === index ? { ...c, ...p } : c)) })
  }

  function patchDoc(n: Noeud, index: number, p: Partial<DocumentLien>) {
    patchNoeud(n.id, { documents: n.documents.map((d, i) => (i === index ? { ...d, ...p } : d)) })
  }

  async function run(fn: () => Promise<unknown>, message?: string) {
    setBusy(true)
    setErreur(null)
    try {
      await fn()
      if (message) {
        setInfo(message)
        window.setTimeout(() => setInfo(null), 2500)
      }
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  async function creerArbre() {
    if (!nouveau.nom.trim()) return
    await run(async () => {
      const { data, error } = await supabase
        .from('hotline_arbres')
        .insert({ filiere: nouveau.filiere, motif: nouveau.motif, nom: nouveau.nom.trim(), famille: nouveau.famille.trim() || null, updated_by: email })
        .select('*')
        .single()
      if (error) throw error
      const a = data as Arbre
      const { data: n, error: e2 } = await supabase
        .from('hotline_noeuds')
        .insert({ arbre_id: a.id, ordre: 1, question: 'Première question', choix: [], documents: [] })
        .select('id')
        .single()
      if (e2) throw e2
      await supabase.from('hotline_arbres').update({ noeud_racine: n.id }).eq('id', a.id)
      setNouveau((v) => ({ ...v, nom: '', famille: '' }))
      await chargerTout()
      setArbreId(a.id)
    }, 'Parcours créé')
  }

  async function enregistrerArbre() {
    if (!arbre) return
    await run(async () => {
      const { error } = await supabase
        .from('hotline_arbres')
        .update({
          nom: arbre.nom,
          famille: arbre.famille || null,
          motif: arbre.motif,
          filiere: arbre.filiere,
          actif: arbre.actif,
          publie_extranet: arbre.publie_extranet,
          noeud_racine: arbre.noeud_racine,
          updated_at: new Date().toISOString(),
          updated_by: email,
        })
        .eq('id', arbre.id)
      if (error) throw error
    }, 'Parcours enregistré')
  }

  async function enregistrerNoeuds() {
    if (!arbre || !modifies.size) return
    await run(async () => {
      const rows = noeuds
        .filter((n) => modifies.has(n.id))
        .map((n) => ({
          id: n.id,
          arbre_id: arbre.id,
          question: n.question.trim() || 'Sans titre',
          aide: n.aide?.trim() || null,
          documents: n.documents.filter((d) => d.titre.trim()),
          choix: n.choix.filter((c) => c.libelle.trim()),
          ordre: n.ordre,
          updated_at: new Date().toISOString(),
        }))
      const { error } = await supabase.from('hotline_noeuds').upsert(rows)
      if (error) throw error
      await supabase.from('hotline_arbres').update({ updated_at: new Date().toISOString(), updated_by: email }).eq('id', arbre.id)
      setModifies(new Set())
    }, 'Questions enregistrées')
  }

  async function ajouterNoeud() {
    if (!arbre) return
    await run(async () => {
      const ordre = Math.max(0, ...noeuds.map((n) => n.ordre)) + 1
      const { data, error } = await supabase
        .from('hotline_noeuds')
        .insert({ arbre_id: arbre.id, ordre, question: 'Nouvelle question', choix: [], documents: [] })
        .select('*')
        .single()
      if (error) throw error
      setNoeuds((list) => [...list, { ...(data as Noeud), documents: [], choix: [] }])
    })
  }

  async function supprimerNoeud(n: Noeud) {
    if (!arbre) return
    if (!window.confirm(`Supprimer la question « ${n.question} » ? Les réponses qui y mènent deviendront des fins de parcours.`)) return
    await run(async () => {
      const { error } = await supabase.from('hotline_noeuds').delete().eq('id', n.id)
      if (error) throw error
      const touches = noeuds.filter((x) => x.id !== n.id && x.choix.some((c) => c.suivant === n.id))
      if (touches.length) {
        const rows = touches.map((x) => ({
          id: x.id,
          arbre_id: arbre.id,
          question: x.question,
          aide: x.aide,
          documents: x.documents,
          choix: x.choix.map((c) => (c.suivant === n.id ? { ...c, suivant: null } : c)),
          ordre: x.ordre,
        }))
        const { error: e2 } = await supabase.from('hotline_noeuds').upsert(rows)
        if (e2) throw e2
      }
      setNoeuds(await chargerNoeuds(arbre.id))
      await chargerTout()
    }, 'Question supprimée')
  }

  async function enregistrerLignes() {
    await run(async () => {
      const rows = lignes
        .filter((l) => l.numero.trim())
        .map((l) => ({ numero: l.numero.trim(), filiere: l.filiere, libelle: l.libelle, actif: l.actif }))
      const { error } = await supabase.from('hotline_lignes').upsert(rows)
      if (error) throw error
      setLignes(await chargerLignes())
    }, 'Lignes 3CX enregistrées')
  }

  async function supprimerLigne(numero: string) {
    await run(async () => {
      const { error } = await supabase.from('hotline_lignes').delete().eq('numero', numero)
      if (error) throw error
      setLignes(await chargerLignes())
    })
  }

  if (!expert) {
    return (
      <div className="min-h-screen bg-[#F4F3F0]">
        <HotlineHeader titre="Éditeur de diagnostic" />
        <main className="mx-auto max-w-[1760px] px-4 py-6 md:px-8">
          <HotlineErreur message="Écran réservé aux experts hotline : demander le droit « Hotline – expert » (Admin › Profils et autorisations)." />
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      <HotlineHeader titre="Éditeur de diagnostic" sousTitre="Parcours de questions-réponses suivis par le niveau 1, documents à proposer, préconisations" />

      <main className="mx-auto grid w-full max-w-[1760px] grid-cols-1 gap-4 px-4 py-5 md:px-8 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="xl:col-span-2">
          {erreur ? <HotlineErreur message={erreur} onClose={() => setErreur(null)} /> : null}
          {info ? <div className="mb-2 rounded-xl border border-[#CDE5D1] bg-[#EEF7EF] px-4 py-2 text-[13px] text-[#2F6B3A]">{info}</div> : null}
        </div>

        {/* ── Parcours et lignes ───────────────────────────────────── */}
        <aside className="space-y-4">
          <section className="rounded-2xl border border-[#E2DFD8] bg-white">
            <div className="border-b border-[#EFEDE8] px-4 py-3 text-[14px] font-bold text-slate-900">Parcours</div>
            <div className="space-y-3 p-3">
              {FILIERES.map((f) => (
                <div key={f.value}>
                  <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">
                    {f.icon} {f.label}
                  </div>
                  {arbres
                    .filter((a) => a.filiere === f.value)
                    .map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setArbreId(a.id)}
                        className={`mb-1 block w-full rounded-lg px-3 py-2 text-left text-[13px] ${a.id === arbreId ? 'bg-[#FDF7EA] ring-1 ring-[#B4761A]' : 'hover:bg-[#FAF9F7]'}`}
                      >
                        <div className={`font-semibold ${a.actif ? 'text-slate-900' : 'text-slate-400 line-through'}`}>{a.nom}</div>
                        <div className="text-[11px] text-slate-500">
                          {libelleMotif(a.motif)}
                          {a.famille ? ` · ${a.famille}` : ''}
                          {a.publie_extranet ? ' · extranet' : ''}
                        </div>
                      </button>
                    ))}
                </div>
              ))}
            </div>
            <div className="space-y-2 border-t border-[#EFEDE8] p-3">
              <div className="text-[12px] font-bold text-slate-700">Nouveau parcours</div>
              <div className="grid grid-cols-2 gap-2">
                <select value={nouveau.filiere} onChange={(e) => setNouveau((v) => ({ ...v, filiere: e.target.value as Filiere }))} className={champ}>
                  {FILIERES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <select value={nouveau.motif} onChange={(e) => setNouveau((v) => ({ ...v, motif: e.target.value as Motif }))} className={champ}>
                  {MOTIFS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <input value={nouveau.nom} onChange={(e) => setNouveau((v) => ({ ...v, nom: e.target.value }))} placeholder="Nom du parcours" className={champ} />
              <input value={nouveau.famille} onChange={(e) => setNouveau((v) => ({ ...v, famille: e.target.value }))} placeholder="Famille de produit (PAC, onduleur…)" className={champ} />
              <button type="button" disabled={busy || !nouveau.nom.trim()} onClick={creerArbre} className="h-9 w-full rounded-lg bg-[#0B1220] text-[13px] font-semibold text-white disabled:opacity-40">
                Créer le parcours
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-[#E2DFD8] bg-white">
            <div className="border-b border-[#EFEDE8] px-4 py-3 text-[14px] font-bold text-slate-900">Lignes 3CX</div>
            <div className="space-y-2 p-3">
              <p className="text-[11px] text-slate-500">Numéro appelé (ligne hotline) → filière proposée à l’ouverture de la console.</p>
              {lignes.map((l, i) => (
                <div key={`${l.numero}-${i}`} className="space-y-1 rounded-lg border border-[#E2DFD8] p-2">
                  <div className="flex gap-1">
                    <input
                      value={l.numero}
                      disabled={!l.nouveau}
                      title={l.nouveau ? 'Numéro appelé, tel que transmis par 3CX' : 'Pour changer de numéro : supprimer la ligne et en créer une nouvelle'}
                      onChange={(e) => setLignes((list) => list.map((x, j) => (j === i ? { ...x, numero: e.target.value } : x)))}
                      className={`${champ} disabled:bg-[#FAF9F7]`}
                    />
                    <select value={l.filiere} onChange={(e) => setLignes((list) => list.map((x, j) => (j === i ? { ...x, filiere: e.target.value as Filiere } : x)))} className={`${champ} w-[120px]`}>
                      {FILIERES.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.value === 'PV' ? 'PV' : 'Thermique'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-1">
                    <input value={l.libelle} onChange={(e) => setLignes((list) => list.map((x, j) => (j === i ? { ...x, libelle: e.target.value } : x)))} className={champ} />
                    <button type="button" onClick={() => (l.nouveau ? setLignes((list) => list.filter((_, j) => j !== i)) : supprimerLigne(l.numero))} className="px-2 text-[12px] text-slate-400 hover:text-[#A32C2C]" title="Supprimer">
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <button type="button" onClick={() => setLignes((list) => [...list, { numero: '', filiere: 'THERMIQUE', libelle: 'Nouvelle ligne', actif: true, nouveau: true }])} className={petitBouton}>
                  + Ligne
                </button>
                <button type="button" disabled={busy} onClick={enregistrerLignes} className={petitBouton}>
                  Enregistrer
                </button>
              </div>
            </div>
          </section>
        </aside>

        {/* ── Parcours sélectionné ─────────────────────────────────── */}
        <section className="min-w-0 space-y-4">
          {!arbre ? (
            <div className="rounded-2xl border border-[#E2DFD8] bg-white p-10 text-center text-sm text-slate-500">Choisir ou créer un parcours.</div>
          ) : (
            <>
              <div className="rounded-2xl border border-[#E2DFD8] bg-white p-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <label className="text-[11px] font-semibold text-slate-500 md:col-span-2">
                    Nom du parcours
                    <input value={arbre.nom} onChange={(e) => patchArbre({ nom: e.target.value })} className={champ} />
                  </label>
                  <label className="text-[11px] font-semibold text-slate-500">
                    Famille de produit
                    <input value={arbre.famille || ''} onChange={(e) => patchArbre({ famille: e.target.value })} className={champ} />
                  </label>
                  <label className="text-[11px] font-semibold text-slate-500">
                    Motif
                    <select value={arbre.motif} onChange={(e) => patchArbre({ motif: e.target.value as Motif })} className={champ}>
                      {MOTIFS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] font-semibold text-slate-500 md:col-span-2">
                    Question de départ
                    <select value={arbre.noeud_racine || ''} onChange={(e) => patchArbre({ noeud_racine: e.target.value || null })} className={champ}>
                      {noeuds.map((n) => (
                        <option key={n.id} value={n.id}>
                          {libellesNoeuds.get(n.id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-slate-700">
                    <input type="checkbox" checked={arbre.actif} onChange={(e) => patchArbre({ actif: e.target.checked })} className="h-4 w-4 accent-[#B4761A]" />
                    Actif dans la console
                  </label>
                  <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-slate-700">
                    <input type="checkbox" checked={arbre.publie_extranet} onChange={(e) => patchArbre({ publie_extranet: e.target.checked })} className="h-4 w-4 accent-[#B4761A]" />
                    Publié sur l’extranet
                  </label>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400">
                    {libelleFiliere(arbre.filiere)}
                    {arbre.updated_by ? ` · modifié par ${arbre.updated_by.split('@')[0]}` : ''}
                  </span>
                  <button type="button" disabled={busy} onClick={enregistrerArbre} className="rounded-lg bg-[#0B1220] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                    Enregistrer le parcours
                  </button>
                </div>
              </div>

              {noeuds.map((n, idx) => (
                <div key={n.id} className={`rounded-2xl border bg-white p-4 ${modifies.has(n.id) ? 'border-[#B4761A]' : 'border-[#E2DFD8]'}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">
                      Q{idx + 1}
                      {arbre.noeud_racine === n.id ? <span className="ml-2 rounded bg-[#FDF2DD] px-1.5 py-0.5 text-[10px] text-[#8A5A11]">départ</span> : null}
                      {modifies.has(n.id) ? <span className="ml-2 text-[10px] text-[#B4761A]">non enregistré</span> : null}
                    </span>
                    <button type="button" onClick={() => supprimerNoeud(n)} className="text-[12px] text-slate-400 hover:text-[#A32C2C]">
                      Supprimer
                    </button>
                  </div>
                  <input value={n.question} onChange={(e) => patchNoeud(n.id, { question: e.target.value })} className={`${champ} h-10 text-[15px] font-semibold`} />
                  <input
                    value={n.aide || ''}
                    onChange={(e) => patchNoeud(n.id, { aide: e.target.value })}
                    placeholder="Consigne pour le niveau 1 (facultatif)"
                    className={`${champ} mt-2`}
                  />

                  <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div>
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">Réponses</div>
                      <div className="space-y-2">
                        {n.choix.map((c, i) => (
                          <div key={i} className="space-y-1 rounded-lg border border-[#EFEDE8] bg-[#FAF9F7] p-2">
                            <div className="flex gap-1">
                              <input value={c.libelle} onChange={(e) => patchChoix(n, i, { libelle: e.target.value })} placeholder="Réponse" className={champ} />
                              <button
                                type="button"
                                onClick={() => patchNoeud(n.id, { choix: n.choix.filter((_, j) => j !== i) })}
                                className="px-2 text-[12px] text-slate-400 hover:text-[#A32C2C]"
                              >
                                ✕
                              </button>
                            </div>
                            <select value={c.suivant || ''} onChange={(e) => patchChoix(n, i, { suivant: e.target.value || null })} className={champ}>
                              <option value="">Fin du parcours : préconisation</option>
                              {noeuds
                                .filter((x) => x.id !== n.id)
                                .map((x) => (
                                  <option key={x.id} value={x.id}>
                                    → {libellesNoeuds.get(x.id)}
                                  </option>
                                ))}
                            </select>
                            {!c.suivant ? (
                              <>
                                <input
                                  value={c.preconisation || ''}
                                  onChange={(e) => patchChoix(n, i, { preconisation: e.target.value })}
                                  placeholder="Préconisation donnée à l’appelant"
                                  className={champ}
                                />
                                <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
                                  <input type="checkbox" checked={Boolean(c.escalade)} onChange={(e) => patchChoix(n, i, { escalade: e.target.checked })} className="h-3.5 w-3.5 accent-[#C1683C]" />
                                  Proposer l’escalade au niveau supérieur
                                </label>
                              </>
                            ) : null}
                          </div>
                        ))}
                        <button type="button" onClick={() => patchNoeud(n.id, { choix: [...n.choix, { libelle: '', suivant: null, preconisation: '', escalade: false }] })} className={petitBouton}>
                          + Réponse
                        </button>
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">Documents affichés à cette question</div>
                      <div className="space-y-2">
                        {n.documents.map((d, i) => (
                          <div key={i} className="space-y-1 rounded-lg border border-[#EFEDE8] bg-[#FAF9F7] p-2">
                            <div className="flex gap-1">
                              <input value={d.titre} onChange={(e) => patchDoc(n, i, { titre: e.target.value })} placeholder="Titre" className={champ} />
                              <select value={d.type || 'PDF'} onChange={(e) => patchDoc(n, i, { type: e.target.value })} className={`${champ} w-[110px]`}>
                                {['PDF', 'SCHEMA', 'FIRMWARE', 'VIDEO', 'XLS', 'LIEN'].map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => patchNoeud(n.id, { documents: n.documents.filter((_, j) => j !== i) })}
                                className="px-2 text-[12px] text-slate-400 hover:text-[#A32C2C]"
                              >
                                ✕
                              </button>
                            </div>
                            <input value={d.url || ''} onChange={(e) => patchDoc(n, i, { url: e.target.value })} placeholder="Lien (Documents, SharePoint, site fabricant…)" className={champ} />
                          </div>
                        ))}
                        <button type="button" onClick={() => patchNoeud(n.id, { documents: [...n.documents, { titre: '', type: 'PDF', url: '' }] })} className={petitBouton}>
                          + Document
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              <div className="sticky bottom-4 flex justify-end gap-2">
                <button type="button" disabled={busy} onClick={ajouterNoeud} className="rounded-lg border border-[#D8D3C8] bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 shadow-sm">
                  + Question
                </button>
                <button
                  type="button"
                  disabled={busy || !modifies.size}
                  onClick={enregistrerNoeuds}
                  className="rounded-lg bg-[#B4761A] px-4 py-2 text-[13px] font-bold text-white shadow-sm disabled:opacity-40"
                >
                  Enregistrer les questions{modifies.size ? ` (${modifies.size})` : ''}
                </button>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
