'use client'

/**
 * Écran « Suivi agences / commerciaux » (bloc « Mes agences / Mes commerciaux »,
 * /suivi-agences). Créé le 09/10/2026.
 *
 * - Vue Agences (dépliables pour voir leurs collaborateurs) ou vue Collaborateurs.
 * - Filtres multi-sélection Agences / Collaborateurs / Familles macro, rangés
 *   dans une barre compacte ; variantes de sélection enregistrables par
 *   utilisateur (une par défaut) — table user_filtres_variantes.
 * - Liste : CA facturé N-1, N à date, évolution vs N-1, évolution par
 *   trimestre, marge, écart à l'entreprise, positionnement.
 * - Croix de positionnement vs N-1 avec trajectoire trimestre par trimestre
 *   (logique « Point commerce » : ça va / ça va pas, ça va mieux / se dégrade).
 * - Clic sur une ligne ou une bulle : fiche détaillée (components/suivi-agences/FicheDetail).
 *
 * Sources : RPC get_suivi_agences_data (RLS appliquée), get_suivi_agences_reference
 * (entreprise hors exclusions), get_suivi_objectifs, get_suivi_profil_clients —
 * migration supabase/migrations/20261009_suivi_agences_commerciaux.sql.
 * URL : ?vue=collaborateurs, ?fiche=A:ANGLET ou ?fiche=C:BRPAROUTOT.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import MultiSelect from '@/components/suivi-agences/MultiSelect'
import VariantesMenu, { useVariantes, type Variante } from '@/components/suivi-agences/VariantesMenu'
import PositionCross, { type CrossPoint } from '@/components/suivi-agences/PositionCross'
import FicheDetail from '@/components/suivi-agences/FicheDetail'
import {
  FAMILLES_LIBELLES,
  MOIS_LONGS,
  QUADRANT_LIBELLES,
  addToSerie,
  emptySerie,
  evolPct,
  fmtEuro,
  fmtK,
  fmtPct,
  fmtPts,
  objectifsPourEntite,
  parseDataRows,
  parseRefRows,
  positionsTrimestrielles,
  quadrantOf,
  sumMonths,
  tauxMarge,
  toneOf,
  type Collaborateur,
  type Commercial,
  type DataRow,
  type Entity,
  type Objectif,
  type RefRow,
  type Serie,
} from '@/lib/suiviAgences'

const ECRAN = 'suivi-agences'

type Vue = 'agences' | 'collaborateurs'

type Filtres = {
  agences: string[]
  collaborateurs: string[]
  familles: string[]
  vue: Vue
  masquerPetits: boolean
}

const FILTRES_VIDES: Filtres = { agences: [], collaborateurs: [], familles: [], vue: 'agences', masquerPetits: true }
const SEUIL_PETIT = 10000

type SortKey = 'label' | 'caN1' | 'caN1Date' | 'caNDate' | 'evol' | 'ecart' | 'marge' | 'margeDelta' | 'vsEntreprise' | 'objectif'

type Ligne = {
  entity: Entity
  serie: Serie
  caN1: number
  caN1Date: number
  caNDate: number
  evol: number | null
  ecart: number
  trims: Array<{ q: number; evol: number | null; partiel: boolean } | null>
  marge: number | null
  margeDelta: number | null
  vsEntreprise: number | null
  objectifCa: number | null
  realisation: number | null
  positions: ReturnType<typeof positionsTrimestrielles>
}

export default function SuiviAgencesPageWrapper() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-slate-500">Chargement…</div>}>
      <SuiviAgencesPage />
    </Suspense>
  )
}

function SuiviAgencesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [annee, setAnnee] = useState(new Date().getFullYear())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<DataRow[]>([])
  const [refRows, setRefRows] = useState<RefRow[]>([])
  const [collaborateurs, setCollaborateurs] = useState<Collaborateur[]>([])
  const [moisClos, setMoisClos] = useState(0)
  const [moisMax, setMoisMax] = useState(0)
  const [exclusionsLibelle, setExclusionsLibelle] = useState('')
  const [objectifs, setObjectifs] = useState<Objectif[]>([])
  const [commerciaux, setCommerciaux] = useState<Commercial[]>([])

  const [filtres, setFiltres] = useState<Filtres>({ ...FILTRES_VIDES, vue: searchParams.get('vue') === 'collaborateurs' ? 'collaborateurs' : 'agences' })
  const [activeVarianteId, setActiveVarianteId] = useState<string | null>(null)
  const [defaultApplied, setDefaultApplied] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showCross, setShowCross] = useState(true)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'caNDate', dir: -1 })

  const variantesApi = useVariantes<Filtres>(ECRAN)

  // ------------------------------------------------------------------ chargement
  const load = useCallback(async (targetAnnee: number) => {
    setLoading(true)
    setError(null)
    const [dataRes, refRes, objRes] = await Promise.all([
      supabase.rpc('get_suivi_agences_data', { p_annee: targetAnnee }),
      supabase.rpc('get_suivi_agences_reference', { p_annee: targetAnnee }),
      supabase.rpc('get_suivi_objectifs', { p_annee: targetAnnee }),
    ])
    if (dataRes.error) {
      setError(dataRes.error.message)
      setLoading(false)
      return
    }
    const data = (dataRes.data || {}) as any
    setRows(parseDataRows(data.rows))
    setCollaborateurs(((data.collaborateurs || []) as any[]).map((c) => ({
      code: String(c.code),
      nom: String(c.nom || c.code),
      agence: String(c.agence || 'NON AFFECTE'),
      sommeil: !!c.sommeil,
      fonction: c.fonction ? String(c.fonction) : null,
    })))
    setMoisClos(Number(data.mois_clos) || 0)
    setMoisMax(Number(data.mois_max) || 0)

    const ref = (refRes.data || {}) as any
    setRefRows(parseRefRows(ref.rows))
    const excl = ((ref.exclusions || []) as any[]).map((e) => String(e.libelle || e.valeur))
    setExclusionsLibelle(excl.length ? `hors ${excl.join(' et ')}` : '')

    const obj = (objRes.data || {}) as any
    setObjectifs(((obj.objectifs || []) as any[]).map((o) => ({
      perimetre_type: o.perimetre_type,
      perimetre_ref: o.perimetre_ref,
      type_objectif: String(o.type_objectif),
      famille_macro: o.famille_macro ? String(o.famille_macro) : null,
      valeur_cible: Number(o.valeur_cible),
    })))
    setCommerciaux(((obj.commerciaux || []) as any[]).map((c) => ({
      email: String(c.email || ''),
      display_name: String(c.display_name || ''),
      agence_objectif: String(c.agence_objectif || ''),
      code: c.code ? String(c.code) : null,
    })))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load(annee)
  }, [annee, load])

  // Variante par défaut appliquée une fois, à l'ouverture.
  useEffect(() => {
    if (defaultApplied || !variantesApi.loaded) return
    const def = variantesApi.variantes.find((v) => v.par_defaut)
    if (def) {
      setFiltres({ ...FILTRES_VIDES, ...def.filtres })
      setActiveVarianteId(def.id)
    }
    setDefaultApplied(true)
  }, [variantesApi.loaded, variantesApi.variantes, defaultApplied])

  const activeVariante = variantesApi.variantes.find((v) => v.id === activeVarianteId) || null
  const dirty = !!activeVariante && JSON.stringify({ ...FILTRES_VIDES, ...activeVariante.filtres }) !== JSON.stringify(filtres)

  function applyVariante(v: Variante<Filtres> | null) {
    setActiveVarianteId(v ? v.id : null)
    setFiltres(v ? { ...FILTRES_VIDES, ...v.filtres } : { ...FILTRES_VIDES, vue: filtres.vue })
  }

  function patchFiltres(patch: Partial<Filtres>) {
    setFiltres((current) => ({ ...current, ...patch }))
  }

  // ------------------------------------------------------------------ options
  const collabByCode = useMemo(() => new Map(collaborateurs.map((c) => [c.code, c])), [collaborateurs])

  const agenceOptions = useMemo(() => {
    const totals = new Map<string, number>()
    rows.forEach((r) => {
      if (r.annee >= annee - 1) totals.set(r.agence, (totals.get(r.agence) || 0) + r.ca)
    })
    return Array.from(new Set(collaborateurs.map((c) => c.agence)))
      .sort((a, b) => a.localeCompare(b, 'fr'))
      .map((a) => ({ value: a, label: a, hint: fmtK(totals.get(a) || 0) }))
  }, [collaborateurs, rows, annee])

  const collabOptions = useMemo(
    () =>
      collaborateurs
        .filter((c) => filtres.agences.length === 0 || filtres.agences.includes(c.agence))
        .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
        .map((c) => ({ value: c.code, label: c.nom, hint: c.agence, muted: c.sommeil })),
    [collaborateurs, filtres.agences]
  )

  const familleOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.famille))
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, 'fr'))
      .map((f) => ({ value: f, label: FAMILLES_LIBELLES[f] && FAMILLES_LIBELLES[f] !== f ? `${f} · ${FAMILLES_LIBELLES[f]}` : f }))
  }, [rows])

  // ------------------------------------------------------------------ agrégats
  const famSet = useMemo(() => (filtres.familles.length ? new Set(filtres.familles) : null), [filtres.familles])
  const agSet = useMemo(() => (filtres.agences.length ? new Set(filtres.agences) : null), [filtres.agences])
  const coSet = useMemo(() => (filtres.collaborateurs.length ? new Set(filtres.collaborateurs) : null), [filtres.collaborateurs])

  const { seriesByCode, seriesByAgence, serieTotal } = useMemo(() => {
    const byCode = new Map<string, Serie>()
    const byAgence = new Map<string, Serie>()
    const total = emptySerie()
    rows.forEach((r) => {
      if (famSet && !famSet.has(r.famille)) return
      if (agSet && !agSet.has(r.agence)) return
      if (coSet && !coSet.has(r.code)) return
      const y = r.annee - (annee - 2)
      if (!byCode.has(r.code)) byCode.set(r.code, emptySerie())
      if (!byAgence.has(r.agence)) byAgence.set(r.agence, emptySerie())
      addToSerie(byCode.get(r.code)!, y, r.mois, r.ca, r.marge)
      addToSerie(byAgence.get(r.agence)!, y, r.mois, r.ca, r.marge)
      addToSerie(total, y, r.mois, r.ca, r.marge)
    })
    return { seriesByCode: byCode, seriesByAgence: byAgence, serieTotal: total }
  }, [rows, famSet, agSet, coSet, annee])

  const refSerie = useMemo(() => {
    const s = emptySerie()
    refRows.forEach((r) => {
      if (famSet && !famSet.has(r.famille)) return
      addToSerie(s, r.annee - (annee - 2), r.mois, r.ca, r.marge)
    })
    return s
  }, [refRows, famSet, annee])

  const refEvol = evolPct(sumMonths(refSerie.ca[2], 1, moisClos), sumMonths(refSerie.ca[1], 1, moisClos))

  const buildLigne = useCallback(
    (entity: Entity, serie: Serie): Ligne => {
      const caN1 = sumMonths(serie.ca[1], 1, 12)
      const caN1Date = sumMonths(serie.ca[1], 1, moisClos)
      const caNDate = sumMonths(serie.ca[2], 1, moisClos)
      const evol = evolPct(caNDate, caN1Date)
      const trims = [1, 2, 3, 4].map((q) => {
        const from = q * 3 - 2
        if (from > moisClos) return null
        const to = Math.min(q * 3, moisClos)
        return { q, evol: evolPct(sumMonths(serie.ca[2], from, to), sumMonths(serie.ca[1], from, to)), partiel: to < q * 3 }
      })
      const tN = tauxMarge(sumMonths(serie.mg[2], 1, moisClos), caNDate)
      const tN1 = tauxMarge(sumMonths(serie.mg[1], 1, moisClos), caN1Date)
      const objs = objectifsPourEntite(entity, objectifs, commerciaux)
      const objCa = objs.propres.find((o) => o.type_objectif === 'ca_valeur' && !o.famille_macro)
      return {
        entity,
        serie,
        caN1,
        caN1Date,
        caNDate,
        evol,
        ecart: caNDate - caN1Date,
        trims,
        marge: tN,
        margeDelta: tN !== null && tN1 !== null ? tN - tN1 : null,
        vsEntreprise: evol !== null && refEvol !== null ? evol - refEvol : null,
        objectifCa: objCa ? objCa.valeur_cible : null,
        realisation: objCa && objCa.valeur_cible > 0 ? (caNDate / objCa.valeur_cible) * 100 : null,
        positions: positionsTrimestrielles(serie, moisClos),
      }
    },
    [moisClos, objectifs, commerciaux, refEvol]
  )

  const isPetit = useCallback(
    (serie: Serie) => Math.abs(sumMonths(serie.ca[1], 1, 12)) < SEUIL_PETIT && Math.abs(sumMonths(serie.ca[2], 1, 12)) < SEUIL_PETIT,
    []
  )

  const collabEntity = useCallback(
    (code: string): Entity => {
      const c = collabByCode.get(code)
      return { key: `C:${code}`, kind: 'collaborateur', id: code, label: c?.nom || code, agence: c?.agence || '—', sommeil: c?.sommeil, codes: [code] }
    },
    [collabByCode]
  )

  const lignesCollab = useMemo(() => {
    const out: Ligne[] = []
    seriesByCode.forEach((serie, code) => {
      if (filtres.masquerPetits && isPetit(serie)) return
      out.push(buildLigne(collabEntity(code), serie))
    })
    return out
  }, [seriesByCode, filtres.masquerPetits, isPetit, buildLigne, collabEntity])

  const lignesAgence = useMemo(() => {
    const out: Ligne[] = []
    seriesByAgence.forEach((serie, agence) => {
      const codes = Array.from(seriesByCode.keys()).filter((code) => (collabByCode.get(code)?.agence || '') === agence)
      out.push(buildLigne({ key: `A:${agence}`, kind: 'agence', id: agence, label: agence, agence, codes }, serie))
    })
    return out
  }, [seriesByAgence, seriesByCode, collabByCode, buildLigne])

  const sorter = useCallback(
    (a: Ligne, b: Ligne) => {
      const get = (l: Ligne): number | string | null => (sort.key === 'label' ? l.entity.label : (l as any)[sort.key])
      const va = get(a)
      const vb = get(b)
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb), 'fr') * sort.dir
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      return ((va as number) - (vb as number)) * sort.dir
    },
    [sort]
  )

  const topLignes = useMemo(
    () => [...(filtres.vue === 'agences' ? lignesAgence : lignesCollab)].sort(sorter),
    [filtres.vue, lignesAgence, lignesCollab, sorter]
  )

  const totalLigne = useMemo(
    () => buildLigne({ key: 'T', kind: 'entreprise', id: 'total', label: 'Total sélection', agence: '', codes: Array.from(seriesByCode.keys()) }, serieTotal),
    [buildLigne, serieTotal, seriesByCode]
  )
  const refLigne = useMemo(
    () => buildLigne({ key: 'R', kind: 'entreprise', id: 'entreprise', label: 'Entreprise (réf.)', agence: '', codes: [] }, refSerie),
    [buildLigne, refSerie]
  )

  const nbTrimestres = Math.min(4, Math.floor(moisClos / 3))

  const crossPoints: CrossPoint[] = useMemo(() => {
    const pts: CrossPoint[] = topLignes.map((l) => ({
      key: l.entity.key,
      label: l.entity.kind === 'collaborateur' ? l.entity.id : l.entity.label,
      positions: l.positions,
      poids: l.caNDate,
    }))
    pts.push({ key: 'R', label: 'Entreprise', positions: refLigne.positions, poids: refLigne.caNDate, reference: true })
    return pts
  }, [topLignes, refLigne])

  // ------------------------------------------------------------------ fiche
  const ficheKey = searchParams.get('fiche')
  const openFiche = useCallback(
    (key: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (key) params.set('fiche', key)
      else params.delete('fiche')
      router.replace(`/suivi-agences${params.toString() ? `?${params}` : ''}`, { scroll: false })
    },
    [router, searchParams]
  )

  const fiche = useMemo(() => {
    if (!ficheKey || loading) return null
    if (ficheKey.startsWith('C:')) {
      const code = ficheKey.slice(2)
      const serie = seriesByCode.get(code) || emptySerie()
      return { entity: collabEntity(code), serie }
    }
    if (ficheKey.startsWith('A:')) {
      const agence = ficheKey.slice(2)
      const serie = seriesByAgence.get(agence) || emptySerie()
      const codes = Array.from(seriesByCode.keys()).filter((code) => (collabByCode.get(code)?.agence || '') === agence)
      return { entity: { key: ficheKey, kind: 'agence' as const, id: agence, label: agence, agence, codes }, serie }
    }
    return null
  }, [ficheKey, loading, seriesByCode, seriesByAgence, collabByCode, collabEntity])

  const ficheRows = useMemo(() => {
    if (!fiche) return []
    const codes = new Set(fiche.entity.codes)
    return rows.filter((r) => codes.has(r.code))
  }, [fiche, rows])

  const ficheObjectifs = useMemo(
    () => (fiche ? objectifsPourEntite(fiche.entity, objectifs, commerciaux) : { propres: [], familles: [] }),
    [fiche, objectifs, commerciaux]
  )

  // ------------------------------------------------------------------ rendu
  function toggleExpand(agence: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(agence)) next.delete(agence)
      else next.add(agence)
      return next
    })
  }

  const allExpanded = filtres.vue === 'agences' && lignesAgence.length > 0 && lignesAgence.every((l) => expanded.has(l.entity.id))

  function header(key: SortKey, label: string, align: 'left' | 'right' = 'right', title?: string) {
    const active = sort.key === key
    return (
      <th
        className={`cursor-pointer select-none whitespace-nowrap px-2 py-2.5 font-semibold ${align === 'left' ? 'text-left' : 'text-right'} ${active ? 'text-slate-900' : ''}`}
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : key === 'label' ? 1 : -1 }))}
        title={title}
      >
        {label}
        {active ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
      </th>
    )
  }

  const filtresActifs = filtres.agences.length + filtres.collaborateurs.length + filtres.familles.length

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      {/* ------------------------------------------------------------ bandeau */}
      <header className="border-b border-[#1E2833] bg-[#111820]">
        <div className="mx-auto flex w-full max-w-[1760px] flex-wrap items-end justify-between gap-4 px-4 py-4 md:px-8">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#B4761A]">Mes agences / Mes commerciaux</div>
            <h1 className="mt-1 text-[24px] font-bold leading-tight text-white md:text-[28px]">Suivi agences – commerciaux</h1>
            <p className="mt-1 text-[12px] text-slate-400">
              CA facturé {annee} · à date = janvier → {MOIS_LONGS[moisClos] || '—'} (dernier mois clos), comparé aux mêmes mois {annee - 1}
              {exclusionsLibelle && ` · référence entreprise ${exclusionsLibelle}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={annee}
              onChange={(e) => setAnnee(Number(e.target.value))}
              className="h-9 cursor-pointer rounded-lg border border-[#2C3946] bg-[#161F29] px-2.5 text-sm font-semibold text-white outline-none focus:border-[#B4761A]"
              aria-label="Année"
            >
              {[new Date().getFullYear() - 2, new Date().getFullYear() - 1, new Date().getFullYear()].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <a href="/objectifs" className="flex h-9 items-center rounded-lg border border-[#2C3946] px-3 text-sm font-semibold text-slate-200 hover:border-[#B4761A] hover:text-white">
              🎯 Objectifs
            </a>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------- barre de filtres */}
      <div className="relative z-40 border-b border-[#E2DFD8] bg-[#F4F3F0]">
        <div className="mx-auto flex w-full max-w-[1760px] flex-wrap items-center gap-2 px-4 py-2 md:px-8">
          <div className="flex rounded-lg border border-[#D8D3C8] bg-white p-0.5 text-[13px]">
            {(['agences', 'collaborateurs'] as Vue[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => patchFiltres({ vue: v })}
                className={`rounded-md px-3 py-1.5 font-semibold transition ${filtres.vue === v ? 'bg-[#111820] text-white' : 'text-slate-600 hover:text-slate-900'}`}
              >
                {v === 'agences' ? 'Agences' : 'Collaborateurs'}
              </button>
            ))}
          </div>
          <span className="mx-1 hidden h-6 w-px bg-[#D8D3C8] md:block" />
          <MultiSelect label="Agences" allLabel="Toutes" options={agenceOptions} selected={filtres.agences} onChange={(v) => patchFiltres({ agences: v })} />
          <MultiSelect label="Collab." allLabel="Tous" options={collabOptions} selected={filtres.collaborateurs} onChange={(v) => patchFiltres({ collaborateurs: v })} width={320} />
          <MultiSelect label="Familles" allLabel="Toutes" options={familleOptions} selected={filtres.familles} onChange={(v) => patchFiltres({ familles: v })} />
          <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-600" title={`Masque les collaborateurs sous ${fmtK(SEUIL_PETIT)} de CA en N-1 et en N`}>
            <input type="checkbox" checked={filtres.masquerPetits} onChange={(e) => patchFiltres({ masquerPetits: e.target.checked })} className="h-3.5 w-3.5 accent-[#B4761A]" />
            Masquer &lt; 10 k€
          </label>
          {filtresActifs > 0 && (
            <button type="button" onClick={() => patchFiltres({ agences: [], collaborateurs: [], familles: [] })} className="text-[12px] font-semibold text-slate-500 hover:text-[#A32C2C]">
              Effacer les filtres
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCross((v) => !v)}
              className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition ${showCross ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#D8D3C8] bg-white text-slate-700 hover:border-[#B4761A]'}`}
            >
              ✛ Croix de positionnement
            </button>
            <VariantesMenu<Filtres>
              variantes={variantesApi.variantes}
              activeId={activeVarianteId}
              dirty={dirty}
              onApply={applyVariante}
              onSave={async (nom, parDefaut) => {
                const err = await variantesApi.save(nom, filtres, parDefaut)
                if (!err) {
                  const { data } = await supabase.from('user_filtres_variantes').select('id').eq('ecran', ECRAN).eq('nom', nom).maybeSingle()
                  if (data) setActiveVarianteId(String((data as any).id))
                }
                return err
              }}
              onSetDefault={variantesApi.setDefault}
              onRemove={async (id) => {
                const err = await variantesApi.remove(id)
                if (!err && id === activeVarianteId) setActiveVarianteId(null)
                return err
              }}
            />
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-[1760px] px-4 py-5 md:px-8">
        {error ? (
          <div className="rounded-2xl border border-[#F0C5BE] bg-[#FCEFEC] p-6 text-sm text-[#7F1D1D]">
            <div className="font-semibold">Chargement impossible</div>
            <div className="mt-1">{error}</div>
            {/function .* does not exist|Could not find the function/i.test(error) && (
              <div className="mt-2 text-[13px]">La migration 20261009_suivi_agences_commerciaux.sql n’est pas encore appliquée en base.</div>
            )}
          </div>
        ) : loading ? (
          <div className="rounded-2xl border border-[#E2DFD8] bg-white p-16 text-center text-sm text-slate-500">Chargement du CA facturé…</div>
        ) : (
          <>
            {/* KPI sélection */}
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <Kpi label={`CA ${annee} à date`} value={fmtK(totalLigne.caNDate)} sub={`${annee - 1} : ${fmtK(totalLigne.caN1Date)}`} />
              <Kpi label="Évolution vs N-1" value={fmtPct(totalLigne.evol)} tone={toneOf(totalLigne.evol)} sub={`${totalLigne.ecart >= 0 ? '+' : ''}${fmtK(totalLigne.ecart)}`} />
              <Kpi label="Entreprise (réf.)" value={fmtPct(refLigne.evol)} tone={toneOf(refLigne.evol)} sub={exclusionsLibelle || 'toutes agences'} />
              <Kpi label="Écart vs entreprise" value={fmtPts(totalLigne.vsEntreprise)} tone={toneOf(totalLigne.vsEntreprise)} sub="sélection − entreprise" />
              <Kpi label="Taux de marge" value={fmtPct(totalLigne.marge, 1, false)} sub={`vs N-1 ${fmtPts(totalLigne.margeDelta)}`} />
              <Kpi label={`CA ${annee - 1} année`} value={fmtK(totalLigne.caN1)} sub={`${annee - 2} : ${fmtK(sumMonths(serieTotal.ca[0], 1, 12))}`} />
            </div>

            <div className={`grid grid-cols-1 gap-4 ${showCross ? '2xl:grid-cols-[minmax(0,1fr)_640px]' : ''}`}>
              {/* ------------------------------------------------------ tableau */}
              <section className="min-w-0 rounded-2xl border border-[#E2DFD8] bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFEDE8] px-4 py-3">
                  <div className="text-[14px] font-bold text-slate-900">
                    {filtres.vue === 'agences' ? `${topLignes.length} agences` : `${topLignes.length} collaborateurs`}
                    <span className="ml-2 text-[12px] font-normal text-slate-500">cliquer sur un nom pour ouvrir la fiche</span>
                  </div>
                  {filtres.vue === 'agences' && (
                    <button
                      type="button"
                      onClick={() => setExpanded(allExpanded ? new Set() : new Set(lignesAgence.map((l) => l.entity.id)))}
                      className="rounded-lg border border-[#D8D3C8] px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:border-[#B4761A]"
                    >
                      {allExpanded ? '▾ Replier les agences' : '▸ Développer les agences'}
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1080px] text-[13px]">
                    <thead className="bg-[#FAF9F7] text-[11px] uppercase tracking-[0.05em] text-slate-500">
                      <tr>
                        {header('label', filtres.vue === 'agences' ? 'Agence / collaborateur' : 'Collaborateur', 'left')}
                        {header('caN1', `CA ${annee - 1}`)}
                        {header('caN1Date', `${annee - 1} à date`)}
                        {header('caNDate', `${annee} à date`)}
                        {header('evol', 'Évol.')}
                        {header('ecart', 'Écart €')}
                        <th className="whitespace-nowrap px-2 py-2.5 text-center font-semibold" title="Évolution de chaque trimestre vs le même trimestre N-1">
                          T1 · T2 · T3 · T4
                        </th>
                        {header('vsEntreprise', 'vs entr.', 'right', `Évolution − évolution entreprise ${exclusionsLibelle}`)}
                        {header('marge', 'Marge %')}
                        {header('margeDelta', 'Δ marge')}
                        {header('objectif', 'Obj. CA')}
                        <th className="whitespace-nowrap px-2 py-2.5 text-left font-semibold">Position</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topLignes.map((l) => {
                        const isAgence = l.entity.kind === 'agence'
                        const open = isAgence && expanded.has(l.entity.id)
                        const enfants = open
                          ? lignesCollab.filter((c) => c.entity.agence === l.entity.id).sort(sorter)
                          : []
                        return (
                          <LigneGroupe
                            key={l.entity.key}
                            ligne={l}
                            enfants={enfants}
                            open={open}
                            onToggle={isAgence ? () => toggleExpand(l.entity.id) : undefined}
                            onOpen={(key) => openFiche(key)}
                            showAgence={filtres.vue === 'collaborateurs'}
                          />
                        )
                      })}
                      {topLignes.length === 0 && (
                        <tr>
                          <td colSpan={12} className="px-4 py-10 text-center text-sm text-slate-500">
                            Aucune ligne pour cette sélection.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <LigneRow ligne={totalLigne} variant="total" />
                      <LigneRow ligne={refLigne} variant="ref" />
                    </tfoot>
                  </table>
                </div>
                <div className="border-t border-[#EFEDE8] px-4 py-2 text-[11px] text-slate-500">
                  Agence = agence de la fiche collaborateur. Trimestre en italique = trimestre en cours, comparé sur les mêmes mois. Obj. CA = réalisé à date / objectif annuel.
                </div>
              </section>

              {/* ------------------------------------------------------- croix */}
              {showCross && (
                <section className="rounded-2xl border border-[#E2DFD8] bg-white p-4">
                  <div className="mb-2">
                    <div className="text-[14px] font-bold text-slate-900">Croix de positionnement vs N-1</div>
                    <p className="text-[12px] text-slate-500">
                      Horizontal : évolution du CA cumulé à fin de trimestre. Vertical : tendance = évolution du trimestre − évolution cumulée au trimestre précédent
                      (pour T1 : année {annee - 1} vs {annee - 2}). ◆ = entreprise {exclusionsLibelle}.
                    </p>
                  </div>
                  <PositionCross points={crossPoints} nbTrimestres={nbTrimestres} onSelect={(key) => openFiche(key)} />
                </section>
              )}
            </div>
          </>
        )}
      </main>

      {fiche && (
        <FicheDetail
          entity={fiche.entity}
          annee={annee}
          moisClos={moisClos}
          moisMax={moisMax}
          serie={fiche.serie}
          refSerie={refSerie}
          rowsEntite={ficheRows}
          refRows={refRows}
          famillesFiltre={filtres.familles}
          objectifs={ficheObjectifs}
          exclusionsLibelle={exclusionsLibelle}
          onClose={() => openFiche(null)}
        />
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Lignes du tableau
// ----------------------------------------------------------------------------
function LigneGroupe({
  ligne,
  enfants,
  open,
  onToggle,
  onOpen,
  showAgence,
}: {
  ligne: Ligne
  enfants: Ligne[]
  open: boolean
  onToggle?: () => void
  onOpen: (key: string) => void
  showAgence: boolean
}) {
  return (
    <>
      <LigneRow ligne={ligne} open={open} onToggle={onToggle} onOpen={onOpen} showAgence={showAgence} />
      {enfants.map((e) => (
        <LigneRow key={e.entity.key} ligne={e} child onOpen={onOpen} />
      ))}
    </>
  )
}

function LigneRow({
  ligne: l,
  open,
  onToggle,
  onOpen,
  child,
  showAgence,
  variant,
}: {
  ligne: Ligne
  open?: boolean
  onToggle?: () => void
  onOpen?: (key: string) => void
  child?: boolean
  showAgence?: boolean
  variant?: 'total' | 'ref'
}) {
  const last = l.positions[l.positions.length - 1]
  const quadrant = quadrantOf(last)
  const rowClass =
    variant === 'total'
      ? 'border-t-2 border-[#111820] bg-[#FAF9F7] font-bold'
      : variant === 'ref'
      ? 'bg-[#FDF7EA] text-[#6B470E]'
      : child
      ? 'border-t border-[#F1EFEA] bg-[#FCFBF9] hover:bg-[#F7F5F0]'
      : 'border-t border-[#EFEDE8] hover:bg-[#FAF9F7]'

  return (
    <tr className={rowClass}>
      <td className="px-2 py-2">
        <div className={`flex items-center gap-1.5 ${child ? 'pl-7' : ''}`}>
          {onToggle && (
            <button type="button" onClick={onToggle} className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-[#EDEAE3] hover:text-slate-700" aria-label={open ? 'Replier' : 'Déplier'}>
              {open ? '▾' : '▸'}
            </button>
          )}
          {onOpen ? (
            <button type="button" onClick={() => onOpen(l.entity.key)} className={`truncate text-left hover:text-[#245A9E] hover:underline ${child ? 'font-medium text-slate-700' : 'font-semibold text-slate-900'} ${l.entity.sommeil ? 'italic text-slate-400' : ''}`}>
              {l.entity.label}
            </button>
          ) : (
            <span>{l.entity.label}</span>
          )}
          {showAgence && <span className="shrink-0 rounded bg-[#EDEAE3] px-1.5 text-[10px] font-semibold text-slate-500">{l.entity.agence}</span>}
          {l.entity.sommeil && <span className="shrink-0 text-[10px] text-slate-400">sommeil</span>}
        </div>
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-slate-600">{fmtEuro(l.caN1)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{fmtEuro(l.caN1Date)}</td>
      <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-900">{fmtEuro(l.caNDate)}</td>
      <td className={`px-2 py-2 text-right font-semibold tabular-nums ${toneOf(l.evol)}`}>{fmtPct(l.evol)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${toneOf(l.ecart, 1)}`}>{`${l.ecart > 0 ? '+' : ''}${fmtK(l.ecart)}`}</td>
      <td className="px-2 py-2">
        <div className="flex justify-center gap-1">
          {l.trims.map((t, i) =>
            t ? (
              <span
                key={i}
                className={`min-w-[46px] rounded px-1 py-0.5 text-center text-[11px] font-semibold tabular-nums ${t.partiel ? 'italic' : ''} ${
                  t.evol === null ? 'bg-[#F1EFEA] text-slate-400' : t.evol >= 0 ? 'bg-[#E5F2E8] text-[#1F6B3A]' : 'bg-[#FBE6E3] text-[#A32C2C]'
                }`}
                title={`T${t.q}${t.partiel ? ' (en cours)' : ''} vs N-1`}
              >
                {t.evol === null ? '—' : `${t.evol > 0 ? '+' : ''}${Math.round(t.evol)}%`}
              </span>
            ) : (
              <span key={i} className="min-w-[46px] rounded bg-[#F7F5F0] px-1 py-0.5 text-center text-[11px] text-slate-300">
                T{i + 1}
              </span>
            )
          )}
        </div>
      </td>
      <td className={`px-2 py-2 text-right tabular-nums ${variant === 'ref' ? '' : toneOf(l.vsEntreprise)}`}>{variant === 'ref' ? '—' : fmtPts(l.vsEntreprise)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{fmtPct(l.marge, 1, false)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${toneOf(l.margeDelta, 0.1)}`}>{fmtPts(l.margeDelta)}</td>
      <td className="px-2 py-2 text-right tabular-nums" title={l.objectifCa ? `Objectif ${fmtEuro(l.objectifCa)}` : undefined}>
        {l.realisation === null ? <span className="text-slate-300">—</span> : `${Math.round(l.realisation)} %`}
      </td>
      <td className="px-2 py-2">
        {quadrant ? (
          <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: QUADRANT_LIBELLES[quadrant].bg, color: QUADRANT_LIBELLES[quadrant].tone }}>
            {QUADRANT_LIBELLES[quadrant].label}
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
    </tr>
  )
}

function Kpi({ label, value, sub, tone = 'text-slate-900' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-[#E2DFD8] bg-white px-3.5 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className={`mt-1 text-[19px] font-bold leading-tight ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

