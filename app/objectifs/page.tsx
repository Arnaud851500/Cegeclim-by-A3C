'use client'

import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { supabase } from '@/lib/supabaseClient'

/**
 * Page Objectifs commerciaux — réservée aux profils ayant can_objectifs
 * (Direction / Administrateur, cf. /autorisation).
 *
 * Modèle :
 *  - Un objectif est posé sur un "périmètre" : l'entreprise, une agence, ou
 *    un commercial (une personne marquée soumis_objectif = true dans
 *    user_page_access, cf. page /autorisation).
 *  - Les commerciaux sont rattachés à une agence via agence_objectif ; c'est
 *    ce qui permet de cumuler leurs objectifs individuels dans l'objectif
 *    de leur agence, puis les agences dans l'objectif entreprise.
 *  - Types d'objectifs disponibles pour l'instant : CA en valeur, évolution
 *    du CA vs N-1, évolution de la marge (globale ou par famille macro),
 *    nombre de clients gros/moyens/petits (profil de CA 12 mois glissants).
 *    D'autres types viendront s'ajouter à TYPE_OBJECTIF_DEFS.
 *
 * TODO Arnaud : la comparaison au réel (get_objectifs_reel_annee) est un
 * stub côté SQL — à brancher sur les vues/indicateurs qui portent déjà le
 * CA, la marge et le profil de CA 12MG par client ailleurs dans l'app.
 * La liste FAMILLES_MACRO ci-dessous est à recaler sur les vraies familles
 * macro utilisées sur le Portefeuille commande / la Projection stock.
 */

type TypeObjectif =
  | 'ca_valeur'
  | 'ca_evolution_pct'
  | 'marge_evolution_pct'
  | 'nb_clients_gros'
  | 'nb_clients_moyens'
  | 'nb_clients_petits'

type PerimetreType = 'entreprise' | 'agence' | 'commercial'

type ObjectifRow = {
  id: string
  annee: number
  perimetre_type: PerimetreType
  perimetre_ref: string | null
  type_objectif: TypeObjectif
  famille_macro: string | null
  valeur_cible: number
  commentaire: string
}

type UserObjectif = {
  email: string
  display_name: string
  agence_objectif: string
}

type RealValues = {
  ca_reel: number | null
  ca_n1: number | null
  marge_pct_reel: number | null
  marge_pct_n1: number | null
  nb_clients_gros: number | null
  nb_clients_moyens: number | null
  nb_clients_petits: number | null
}

type Perimetre = { type: PerimetreType; ref: string; label: string }

type MargeFamilleDraft = { famille: string; valeur: string }

type ObjectifDraft = {
  ca_valeur: string
  ca_evolution_pct: string
  marge_evolution_pct: string
  marge_par_famille: MargeFamilleDraft[]
  nb_clients_gros: string
  nb_clients_moyens: string
  nb_clients_petits: string
  commentaire: string
}

type ToastState = { tone: 'success' | 'error'; text: string } | null

// À ajuster sur les libellés de famille macro réellement utilisés dans l'app
// (Portefeuille commande, Projection stock…).
const FAMILLES_MACRO = [
  'Chauffage',
  'Climatisation',
  'Ventilation',
  'Plomberie / Sanitaire',
  'Génie électrique',
  'Gaz',
  'Régulation',
  'Accessoires / Divers',
]

const TYPE_OBJECTIF_DEFS: Record<
  Exclude<TypeObjectif, 'marge_evolution_pct'>,
  { label: string; unit: string; additive: boolean }
> = {
  ca_valeur: { label: 'CA en valeur', unit: '€', additive: true },
  ca_evolution_pct: { label: 'Évolution du CA vs N-1', unit: '%', additive: false },
  nb_clients_gros: { label: 'Nombre de gros clients', unit: 'clients', additive: true },
  nb_clients_moyens: { label: 'Nombre de clients moyens', unit: 'clients', additive: true },
  nb_clients_petits: { label: 'Nombre de petits clients', unit: 'clients', additive: true },
}

const EMPTY_DRAFT: ObjectifDraft = {
  ca_valeur: '',
  ca_evolution_pct: '',
  marge_evolution_pct: '',
  marge_par_famille: [],
  nb_clients_gros: '',
  nb_clients_moyens: '',
  nb_clients_petits: '',
  commentaire: '',
}

function currentYearRange() {
  const year = new Date().getFullYear()
  return [year - 1, year, year + 1]
}

function objectifKey(perimetre: Perimetre) {
  return `${perimetre.type}:${perimetre.ref}`
}

function numOrNull(value: string) {
  const trimmed = value.trim().replace(',', '.')
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function formatEuros(value: number | null) {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)
}

function formatNumber(value: number | null) {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('fr-FR').format(value)
}

function formatPct(value: number | null, digits = 1) {
  if (value === null || value === undefined) return '—'
  return `${value.toFixed(digits)} %`
}

/** Reconstruit un brouillon d'objectif à partir des lignes brutes d'un périmètre. */
function draftFromRows(rows: ObjectifRow[]): ObjectifDraft {
  const draft: ObjectifDraft = { ...EMPTY_DRAFT, marge_par_famille: [] }
  let commentaire = ''
  rows.forEach((row) => {
    if (row.commentaire) commentaire = row.commentaire
    if (row.type_objectif === 'marge_evolution_pct') {
      if (row.famille_macro) {
        draft.marge_par_famille.push({ famille: row.famille_macro, valeur: String(row.valeur_cible) })
      } else {
        draft.marge_evolution_pct = String(row.valeur_cible)
      }
      return
    }
    const key = row.type_objectif as keyof typeof TYPE_OBJECTIF_DEFS
    if (key in TYPE_OBJECTIF_DEFS) {
      ;(draft as any)[key] = String(row.valeur_cible)
    }
  })
  draft.commentaire = commentaire
  return draft
}

/** Convertit un brouillon en lignes prêtes à upsert pour un périmètre/année donnés. */
function rowsFromDraft(annee: number, perimetre: Perimetre, draft: ObjectifDraft) {
  const rows: Array<Omit<ObjectifRow, 'id'>> = []
  const perimetre_ref = perimetre.type === 'entreprise' ? null : perimetre.ref

  ;(Object.keys(TYPE_OBJECTIF_DEFS) as Array<keyof typeof TYPE_OBJECTIF_DEFS>).forEach((key) => {
    const raw = numOrNull((draft as any)[key])
    if (raw === null) return
    rows.push({
      annee,
      perimetre_type: perimetre.type,
      perimetre_ref,
      type_objectif: key,
      famille_macro: null,
      valeur_cible: raw,
      commentaire: draft.commentaire.trim(),
    })
  })

  const margeGlobale = numOrNull(draft.marge_evolution_pct)
  if (margeGlobale !== null) {
    rows.push({
      annee,
      perimetre_type: perimetre.type,
      perimetre_ref,
      type_objectif: 'marge_evolution_pct',
      famille_macro: null,
      valeur_cible: margeGlobale,
      commentaire: draft.commentaire.trim(),
    })
  }

  draft.marge_par_famille.forEach(({ famille, valeur }) => {
    const parsed = numOrNull(valeur)
    if (!famille.trim() || parsed === null) return
    rows.push({
      annee,
      perimetre_type: perimetre.type,
      perimetre_ref,
      type_objectif: 'marge_evolution_pct',
      famille_macro: famille.trim(),
      valeur_cible: parsed,
      commentaire: draft.commentaire.trim(),
    })
  })

  return rows
}

export default function ObjectifsPage() {
  const [loading, setLoading] = useState(true)
  const [annee, setAnnee] = useState(new Date().getFullYear())
  const [objectifs, setObjectifs] = useState<ObjectifRow[]>([])
  const [usersObjectif, setUsersObjectif] = useState<UserObjectif[]>([])
  const [selected, setSelected] = useState<Perimetre>({ type: 'entreprise', ref: '', label: 'Entreprise' })
  const [draft, setDraft] = useState<ObjectifDraft>(EMPTY_DRAFT)
  const [real, setReal] = useState<RealValues | null>(null)
  const [expandedAgences, setExpandedAgences] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 5200)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function loadAll(targetAnnee: number) {
    setLoading(true)

    const [{ data: objData, error: objError }, { data: userData, error: userError }] = await Promise.all([
      supabase.from('objectifs_commerciaux').select('*').eq('annee', targetAnnee),
      supabase
        .from('user_page_access')
        .select('email, display_name, agence_objectif')
        .eq('soumis_objectif', true)
        .order('display_name', { ascending: true }),
    ])

    if (objError || userError) {
      setToast({ tone: 'error', text: `Chargement impossible : ${objError?.message || userError?.message}` })
      setLoading(false)
      return
    }

    setObjectifs(((objData || []) as any[]).map((row) => ({
      id: String(row.id),
      annee: Number(row.annee),
      perimetre_type: row.perimetre_type,
      perimetre_ref: row.perimetre_ref,
      type_objectif: row.type_objectif,
      famille_macro: row.famille_macro,
      valeur_cible: Number(row.valeur_cible),
      commentaire: String(row.commentaire || ''),
    })))

    setUsersObjectif(((userData || []) as any[]).map((row) => ({
      email: String(row.email || '').toLowerCase().trim(),
      display_name: String(row.display_name || '').trim(),
      agence_objectif: String(row.agence_objectif || '').trim(),
    })))

    setLoading(false)
  }

  useEffect(() => {
    void loadAll(annee)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annee])

  // Liste des agences = agences distinctes déclarées sur les commerciaux soumis à objectif.
  const agences = useMemo(() => {
    const set = new Set(usersObjectif.map((user) => user.agence_objectif).filter(Boolean))
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [usersObjectif])

  const commerciauxSansAgence = useMemo(
    () => usersObjectif.filter((user) => !user.agence_objectif),
    [usersObjectif]
  )

  function commerciauxDe(agence: string) {
    return usersObjectif.filter((user) => user.agence_objectif === agence)
  }

  function rowsFor(perimetre: Perimetre) {
    const ref = perimetre.type === 'entreprise' ? null : perimetre.ref
    return objectifs.filter((row) => row.perimetre_type === perimetre.type && (row.perimetre_ref || null) === ref)
  }

  function targetFor(perimetre: Perimetre, type: TypeObjectif, famille: string | null = null): number | null {
    const ref = perimetre.type === 'entreprise' ? null : perimetre.ref
    const row = objectifs.find(
      (item) =>
        item.perimetre_type === perimetre.type &&
        (item.perimetre_ref || null) === ref &&
        item.type_objectif === type &&
        (item.famille_macro || null) === famille
    )
    return row ? row.valeur_cible : null
  }

  useEffect(() => {
    setDraft(draftFromRows(rowsFor(selected)))
    void loadReal(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, objectifs, annee])

  async function loadReal(perimetre: Perimetre) {
    setReal(null)
    const { data, error } = await supabase.rpc('get_objectifs_reel_annee', {
      p_annee: annee,
      p_perimetre_type: perimetre.type,
      p_perimetre_ref: perimetre.type === 'entreprise' ? null : perimetre.ref,
    })
    if (error) return
    const row = Array.isArray(data) ? data[0] : data
    if (row) {
      setReal({
        ca_reel: row.ca_reel === null || row.ca_reel === undefined ? null : Number(row.ca_reel),
        ca_n1: row.ca_n1 === null || row.ca_n1 === undefined ? null : Number(row.ca_n1),
        marge_pct_reel: row.marge_pct_reel === null || row.marge_pct_reel === undefined ? null : Number(row.marge_pct_reel),
        marge_pct_n1: row.marge_pct_n1 === null || row.marge_pct_n1 === undefined ? null : Number(row.marge_pct_n1),
        nb_clients_gros: row.nb_clients_gros === null || row.nb_clients_gros === undefined ? null : Number(row.nb_clients_gros),
        nb_clients_moyens: row.nb_clients_moyens === null || row.nb_clients_moyens === undefined ? null : Number(row.nb_clients_moyens),
        nb_clients_petits: row.nb_clients_petits === null || row.nb_clients_petits === undefined ? null : Number(row.nb_clients_petits),
      })
    }
  }

  function selectPerimetre(perimetre: Perimetre) {
    setSelected(perimetre)
  }

  function toggleAgence(agence: string) {
    setExpandedAgences((current) => {
      const next = new Set(current)
      if (next.has(agence)) next.delete(agence)
      else next.add(agence)
      return next
    })
  }

  async function saveDraft() {
    setSaving(true)

    const ref = selected.type === 'entreprise' ? null : selected.ref
    const nextRows = rowsFromDraft(annee, selected, draft)

    // On repart de zéro pour ce périmètre/année : supprime les lignes existantes
    // puis réinsère celles du brouillon. Plus simple et plus sûr qu'un diff fin,
    // vu le faible volume de lignes par périmètre.
    const deleteQuery = supabase
      .from('objectifs_commerciaux')
      .delete()
      .eq('annee', annee)
      .eq('perimetre_type', selected.type)

    const { error: deleteError } =
      ref === null ? await deleteQuery.is('perimetre_ref', null) : await deleteQuery.eq('perimetre_ref', ref)

    if (deleteError) {
      setSaving(false)
      setToast({ tone: 'error', text: `Enregistrement impossible : ${deleteError.message}` })
      return
    }

    if (nextRows.length > 0) {
      const { error: insertError } = await supabase.from('objectifs_commerciaux').insert(nextRows)
      if (insertError) {
        setSaving(false)
        setToast({ tone: 'error', text: `Enregistrement impossible : ${insertError.message}` })
        return
      }
    }

    setSaving(false)
    setToast({ tone: 'success', text: `Objectifs enregistrés pour « ${selected.label} ».` })
    await loadAll(annee)
  }

  // ---------------------------------------------------------------- Cohérence
  type CoherenceLine = {
    label: string
    unit: string
    parentTarget: number | null
    childrenSum: number
    childrenCount: number
    childrenWithValue: number
  }

  const coherenceLines: CoherenceLine[] = useMemo(() => {
    let children: Perimetre[] = []
    if (selected.type === 'entreprise') {
      children = agences.map((agence) => ({ type: 'agence', ref: agence, label: agence }))
    } else if (selected.type === 'agence') {
      children = commerciauxDe(selected.ref).map((user) => ({
        type: 'commercial',
        ref: user.email,
        label: user.display_name || user.email,
      }))
    }
    if (children.length === 0) return []

    return (Object.keys(TYPE_OBJECTIF_DEFS) as Array<keyof typeof TYPE_OBJECTIF_DEFS>)
      .filter((key) => TYPE_OBJECTIF_DEFS[key].additive)
      .map((key) => {
        const def = TYPE_OBJECTIF_DEFS[key]
        const values = children.map((child) => targetFor(child, key))
        const withValue = values.filter((value) => value !== null) as number[]
        return {
          label: def.label,
          unit: def.unit,
          parentTarget: targetFor(selected, key),
          childrenSum: withValue.reduce((sum, value) => sum + value, 0),
          childrenCount: children.length,
          childrenWithValue: withValue.length,
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, agences, usersObjectif, objectifs])

  const perimetreHasChildren = selected.type !== 'commercial'

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      <header className="border-b border-[#1E2833] bg-[#111820]">
        <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-6 px-4 py-6 md:px-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#B4761A]">Direction</div>
            <h1 className="mt-2 text-[28px] font-bold leading-tight text-white md:text-[32px]">Objectifs commerciaux</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
              Un objectif par entreprise, par agence et par commercial. La cohérence se vérifie en comparant
              la somme des objectifs individuels à celui de l’agence, puis la somme des agences à l’objectif entreprise.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Année</span>
              <select
                value={annee}
                onChange={(event) => setAnnee(Number(event.target.value))}
                className="h-[44px] cursor-pointer rounded-xl border border-[#2C3946] bg-[#161F29] px-3 text-sm font-semibold text-white outline-none focus:border-[#B4761A]"
              >
                {currentYearRange().map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void loadAll(annee)}
              className="h-[44px] rounded-xl border border-[#2C3946] px-4 text-sm font-semibold text-slate-200 transition hover:border-[#B4761A] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]"
            >
              Recharger
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1760px] px-4 py-6 md:px-8">
        {loading ? (
          <div className="rounded-2xl border border-[#E2DFD8] bg-white p-16 text-center text-sm text-slate-500">
            Chargement des objectifs…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
            {/* ------------------------------------------------- Arbre des périmètres */}
            <aside className="flex flex-col gap-3">
              <div className="rounded-2xl border border-[#E2DFD8] bg-white p-3">
                <div className="space-y-1.5">
                  <PerimetreButton
                    active={selected.type === 'entreprise'}
                    label="Entreprise"
                    sub="Objectif global CEGECLIM"
                    onClick={() => selectPerimetre({ type: 'entreprise', ref: '', label: 'Entreprise' })}
                  />

                  <div className="mt-2 space-y-1">
                    {agences.map((agence) => {
                      const expanded = expandedAgences.has(agence)
                      const commerciaux = commerciauxDe(agence)
                      return (
                        <div key={agence}>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => toggleAgence(agence)}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-[#FAF9F7] hover:text-slate-700"
                              aria-label={expanded ? 'Replier' : 'Déplier'}
                            >
                              {expanded ? '▾' : '▸'}
                            </button>
                            <div className="flex-1">
                              <PerimetreButton
                                active={selected.type === 'agence' && selected.ref === agence}
                                label={agence}
                                sub={`${commerciaux.length} commercial${commerciaux.length > 1 ? 'aux' : ''}`}
                                onClick={() => selectPerimetre({ type: 'agence', ref: agence, label: agence })}
                              />
                            </div>
                          </div>
                          {expanded && (
                            <div className="ml-9 mt-1 space-y-1 border-l border-[#EFEDE8] pl-2">
                              {commerciaux.map((user) => (
                                <PerimetreButton
                                  key={user.email}
                                  compact
                                  active={selected.type === 'commercial' && selected.ref === user.email}
                                  label={user.display_name || user.email}
                                  onClick={() =>
                                    selectPerimetre({
                                      type: 'commercial',
                                      ref: user.email,
                                      label: user.display_name || user.email,
                                    })
                                  }
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {commerciauxSansAgence.length > 0 && (
                    <div className="mt-2">
                      <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#A32C2C]">
                        Sans agence de rattachement
                      </div>
                      <div className="space-y-1">
                        {commerciauxSansAgence.map((user) => (
                          <PerimetreButton
                            key={user.email}
                            compact
                            active={selected.type === 'commercial' && selected.ref === user.email}
                            label={user.display_name || user.email}
                            onClick={() =>
                              selectPerimetre({
                                type: 'commercial',
                                ref: user.email,
                                label: user.display_name || user.email,
                              })
                            }
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {agences.length === 0 && commerciauxSansAgence.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs leading-relaxed text-slate-500">
                      Personne n’est encore marqué « Soumis à objectif ». Cochez-le sur les fiches utilisateur, page
                      Autorisations → Utilisateurs.
                    </p>
                  )}
                </div>
              </div>
            </aside>

            {/* ------------------------------------------------------------- Détail */}
            <section className="space-y-4">
              <div className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
                <Eyebrow>
                  {selected.type === 'entreprise' ? 'Périmètre entreprise' : selected.type === 'agence' ? 'Périmètre agence' : 'Périmètre commercial'}
                </Eyebrow>
                <h2 className="mt-1 text-xl font-bold text-slate-900">{selected.label}</h2>

                <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <ObjectifFieldGroup title="Chiffre d’affaires">
                    <ObjectifInput
                      label={TYPE_OBJECTIF_DEFS.ca_valeur.label}
                      unit="€"
                      value={draft.ca_valeur}
                      onChange={(value) => setDraft((current) => ({ ...current, ca_valeur: value }))}
                      real={real ? formatEuros(real.ca_reel) : undefined}
                      realN1={real ? formatEuros(real.ca_n1) : undefined}
                    />
                    <ObjectifInput
                      label={TYPE_OBJECTIF_DEFS.ca_evolution_pct.label}
                      unit="%"
                      value={draft.ca_evolution_pct}
                      onChange={(value) => setDraft((current) => ({ ...current, ca_evolution_pct: value }))}
                      real={
                        real && real.ca_reel !== null && real.ca_n1
                          ? formatPct(((real.ca_reel - real.ca_n1) / real.ca_n1) * 100)
                          : undefined
                      }
                    />
                  </ObjectifFieldGroup>

                  <ObjectifFieldGroup title="Structure clients (profil CA 12 mois glissants)">
                    <ObjectifInput
                      label={TYPE_OBJECTIF_DEFS.nb_clients_gros.label}
                      unit="clients"
                      value={draft.nb_clients_gros}
                      onChange={(value) => setDraft((current) => ({ ...current, nb_clients_gros: value }))}
                      real={real ? formatNumber(real.nb_clients_gros) : undefined}
                    />
                    <ObjectifInput
                      label={TYPE_OBJECTIF_DEFS.nb_clients_moyens.label}
                      unit="clients"
                      value={draft.nb_clients_moyens}
                      onChange={(value) => setDraft((current) => ({ ...current, nb_clients_moyens: value }))}
                      real={real ? formatNumber(real.nb_clients_moyens) : undefined}
                    />
                    <ObjectifInput
                      label={TYPE_OBJECTIF_DEFS.nb_clients_petits.label}
                      unit="clients"
                      value={draft.nb_clients_petits}
                      onChange={(value) => setDraft((current) => ({ ...current, nb_clients_petits: value }))}
                      real={real ? formatNumber(real.nb_clients_petits) : undefined}
                    />
                  </ObjectifFieldGroup>
                </div>

                <div className="mt-5">
                  <ObjectifFieldGroup title="Marge">
                    <ObjectifInput
                      label="Évolution de la marge globale"
                      unit="%"
                      value={draft.marge_evolution_pct}
                      onChange={(value) => setDraft((current) => ({ ...current, marge_evolution_pct: value }))}
                      real={
                        real && real.marge_pct_reel !== null && real.marge_pct_n1 !== null
                          ? formatPct(real.marge_pct_reel - real.marge_pct_n1)
                          : undefined
                      }
                    />

                    <div className="mt-1 space-y-2">
                      {draft.marge_par_famille.map((entry, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <select
                            value={entry.famille}
                            onChange={(event) =>
                              setDraft((current) => {
                                const next = [...current.marge_par_famille]
                                next[index] = { ...next[index], famille: event.target.value }
                                return { ...current, marge_par_famille: next }
                              })
                            }
                            className="h-[42px] flex-1 rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm outline-none focus:border-[#B4761A]"
                          >
                            <option value="">Famille macro…</option>
                            {FAMILLES_MACRO.map((famille) => (
                              <option key={famille} value={famille}>
                                {famille}
                              </option>
                            ))}
                          </select>
                          <input
                            value={entry.valeur}
                            onChange={(event) =>
                              setDraft((current) => {
                                const next = [...current.marge_par_famille]
                                next[index] = { ...next[index], valeur: event.target.value }
                                return { ...current, marge_par_famille: next }
                              })
                            }
                            placeholder="+2.5"
                            inputMode="decimal"
                            className="h-[42px] w-28 rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm outline-none focus:border-[#B4761A]"
                          />
                          <span className="text-xs text-slate-500">%</span>
                          <button
                            type="button"
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                marge_par_famille: current.marge_par_famille.filter((_, i) => i !== index),
                              }))
                            }
                            className="rounded-lg px-2 py-1 text-xs font-semibold text-[#A32C2C] transition hover:bg-[#FBE9E9]"
                          >
                            Retirer
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            marge_par_famille: [...current.marge_par_famille, { famille: '', valeur: '' }],
                          }))
                        }
                        className="rounded-lg border border-[#D8D3C8] bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[#B4761A] hover:text-[#8A5A11]"
                      >
                        + Objectif de marge par famille
                      </button>
                    </div>
                  </ObjectifFieldGroup>
                </div>

                <div className="mt-5">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold text-slate-800">Note</span>
                    <textarea
                      value={draft.commentaire}
                      onChange={(event) => setDraft((current) => ({ ...current, commentaire: event.target.value }))}
                      placeholder="Contexte, hypothèses retenues, points d’attention…"
                      rows={2}
                      className="w-full rounded-xl border border-[#D8D3C8] bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
                    />
                  </label>
                </div>
              </div>

              {/* --------------------------------------------------- Cohérence */}
              {perimetreHasChildren && (
                <div className="rounded-2xl border border-[#E2DFD8] bg-white">
                  <div className="border-b border-[#EFEDE8] px-5 py-4">
                    <Eyebrow>Contrôle</Eyebrow>
                    <h3 className="mt-1 text-lg font-bold text-slate-900">Cohérence avec les objectifs enfants</h3>
                    <p className="mt-1 max-w-3xl text-sm text-slate-600">
                      Somme des objectifs {selected.type === 'entreprise' ? 'agences' : 'commerciaux'} comparée à
                      l’objectif de « {selected.label} ». Les évolutions en % ne se cumulent pas et restent informatives.
                    </p>
                  </div>
                  <div className="space-y-2 px-5 pb-5">
                    {coherenceLines.length === 0 ? (
                      <p className="pt-3 text-sm text-slate-500">
                        Aucun {selected.type === 'entreprise' ? 'agence' : 'commercial'} rattaché pour l’instant.
                      </p>
                    ) : (
                      coherenceLines.map((line) => (
                        <CoherenceRow key={line.label} line={line} />
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* ------------------------------------------------------ Save bar */}
              <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E2DFD8] bg-white/90 px-4 py-3 backdrop-blur">
                <span className="text-sm text-slate-500">
                  Objectifs {annee} pour « {selected.label} ».
                </span>
                <button
                  type="button"
                  onClick={() => void saveDraft()}
                  disabled={saving}
                  className="rounded-xl bg-[#111820] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#25313D] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? 'Enregistrement…' : 'Enregistrer les objectifs'}
                </button>
              </div>
            </section>
          </div>
        )}
      </main>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[10000] flex justify-center px-4">
          <div
            role="status"
            className={`pointer-events-auto flex max-w-2xl items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-xl ${
              toast.tone === 'success' ? 'bg-[#111820] text-white' : 'bg-[#7F1D1D] text-white'
            }`}
          >
            <span className="flex-1 leading-relaxed">{toast.text}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="shrink-0 rounded px-1 text-white/70 transition hover:text-white"
              aria-label="Fermer le message"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Briques d'interface                                                */
/* ------------------------------------------------------------------ */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8A5A11]">{children}</div>
}

function PerimetreButton({
  active,
  label,
  sub,
  compact = false,
  onClick,
}: {
  active: boolean
  label: string
  sub?: string
  compact?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border px-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] ${
        compact ? 'py-1.5' : 'py-2.5'
      } ${
        active
          ? 'border-[#111820] bg-[#111820] text-white'
          : 'border-transparent bg-[#FAF9F7] hover:border-[#D8D3C8] hover:bg-white'
      }`}
    >
      <span className={`block truncate font-semibold ${compact ? 'text-[13px]' : 'text-[15px]'}`}>{label}</span>
      {sub && (
        <span className={`mt-0.5 block truncate text-[11px] ${active ? 'text-slate-300' : 'text-slate-500'}`}>{sub}</span>
      )}
    </button>
  )
}

function ObjectifFieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#E7E4DD] bg-[#FAF9F7] p-4">
      <h4 className="mb-3 text-sm font-bold uppercase tracking-[0.1em] text-slate-700">{title}</h4>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function ObjectifInput({
  label,
  unit,
  value,
  onChange,
  real,
  realN1,
}: {
  label: string
  unit: string
  value: string
  onChange: (value: string) => void
  real?: string
  realN1?: string
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">{label}</span>
        {real !== undefined && (
          <span className="text-[11px] text-slate-500">
            réel {real}
            {realN1 ? ` · N-1 ${realN1}` : ''}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="—"
          inputMode="decimal"
          className="h-[42px] w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
        />
        <span className="w-14 shrink-0 text-xs text-slate-500">{unit}</span>
      </div>
    </div>
  )
}

function CoherenceRow({
  line,
}: {
  line: {
    label: string
    unit: string
    parentTarget: number | null
    childrenSum: number
    childrenCount: number
    childrenWithValue: number
  }
}) {
  const { label, unit, parentTarget, childrenSum, childrenCount, childrenWithValue } = line
  const incomplete = childrenWithValue < childrenCount
  const hasParent = parentTarget !== null
  const delta = hasParent ? childrenSum - (parentTarget as number) : null
  const aligned = hasParent && delta !== null && Math.abs(delta) < 0.5

  const formatValue = (value: number) =>
    unit === '€' ? formatEuros(value) : unit === 'clients' ? formatNumber(value) : `${value}${unit}`

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#EFEDE8] px-3 py-2.5">
      <div>
        <div className="text-sm font-semibold text-slate-800">{label}</div>
        <div className="text-xs text-slate-500">
          {childrenWithValue}/{childrenCount} renseigné{childrenWithValue > 1 ? 's' : ''} · somme {formatValue(childrenSum)}
          {hasParent ? ` · objectif ${formatValue(parentTarget as number)}` : ' · objectif non fixé'}
        </div>
      </div>
      <span
        className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
          !hasParent
            ? 'bg-[#EDEAE3] text-slate-500'
            : incomplete
            ? 'bg-[#FDF7EA] text-[#8A5A11]'
            : aligned
            ? 'bg-[#E7F3EA] text-[#256B3A]'
            : 'bg-[#FBE9E9] text-[#A32C2C]'
        }`}
      >
        {!hasParent
          ? 'objectif à fixer'
          : incomplete
          ? 'à compléter'
          : aligned
          ? 'cohérent'
          : `écart ${delta! > 0 ? '+' : ''}${formatValue(delta as number)}`}
      </span>
    </div>
  )
}
