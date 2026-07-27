'use client'

/**
 * PANNEAU DE GESTION DES REMPLACEMENTS DE RÉFÉRENCES
 * ---------------------------------------------------------------------------
 * Écrit une seule table : `stock_article_substitutions`. Aucun calcul ici — la
 * redistribution des historiques et le recalcul des prévisions sont faits en
 * base par `apply_stock_substitutions_to_run`, appelée après chaque
 * enregistrement.
 *
 * Les règles métier ne sont pas recopiées côté écran : le total de 100 %, le
 * refus des boucles et le filtrage des candidates par famille macro sont tenus
 * par la base. L'écran se contente de présenter les erreurs qu'elle renvoie.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

const VIOLET = '#7A5EA8'
const SAUGE = '#A6A181'
const ALERTE = '#C1683C'
const VERT = '#3F9142'

export type Substitution = {
  id: string
  reference_source: string
  reference_cible: string
  depot: string
  date_bascule: string
  pourcentage: number
  actif: boolean
  commentaire: string | null
}

type Candidate = {
  reference_article: string
  designation: string
  famille: string
  famille_macro: string
  statut: string
  historique_n1: number
}

function aujourdhui() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatNombre(v: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v || 0)
}

export default function PanneauRemplacements({
  referenceSource,
  designationSource,
  runId,
  onClose,
  onApplied,
}: {
  referenceSource: string
  designationSource?: string
  runId: string | null
  onClose: () => void
  onApplied?: () => void
}) {
  const [lignes, setLignes] = useState<Substitution[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [recherche, setRecherche] = useState('')
  const [chargement, setChargement] = useState(true)
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // Formulaire d'ajout
  const [cible, setCible] = useState('')
  const [dateBascule, setDateBascule] = useState(aujourdhui())
  const [pourcentage, setPourcentage] = useState(100)

  const totalAttribue = useMemo(
    () => lignes.filter((l) => l.actif).reduce((s, l) => s + Number(l.pourcentage || 0), 0),
    [lignes],
  )
  const resteAAttribuer = Math.max(0, 100 - totalAttribue)

  const charger = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      const [{ data: subs, error: e1 }, { data: cands, error: e2 }] = await Promise.all([
        supabase
          .from('stock_article_substitutions')
          .select('*')
          .eq('reference_source', referenceSource)
          .order('reference_cible'),
        supabase.rpc('get_stock_substitution_candidates', {
          p_reference: referenceSource,
          p_recherche: recherche || null,
          p_depot: 'GLOBAL',
          p_limit: 200,
        }),
      ])

      if (e1) throw new Error(e1.message)
      if (e2) throw new Error(e2.message)

      setLignes((subs || []) as Substitution[])
      setCandidates((cands || []) as Candidate[])
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setChargement(false)
    }
  }, [referenceSource, recherche])

  useEffect(() => {
    void charger()
  }, [charger])

  /**
   * Après toute écriture, la projection du run courant est recalculée. Sans
   * cela l'écran continuerait d'afficher les anciennes prévisions, et
   * l'utilisateur croirait son réglage sans effet.
   */
  async function rejouerProjection() {
    if (!runId) return
    const { error } = await supabase.rpc('apply_stock_substitutions_to_run', { p_run_id: runId })
    if (error) throw new Error(`Recalcul de la projection : ${error.message}`)
  }

  async function ajouter() {
    if (!cible) {
      setErreur('Choisissez une référence remplaçante.')
      return
    }
    setEnregistrement(true)
    setErreur(null)
    setMessage(null)
    try {
      const { error } = await supabase.from('stock_article_substitutions').insert({
        reference_source: referenceSource,
        reference_cible: cible,
        depot: 'GLOBAL',
        date_bascule: dateBascule,
        pourcentage,
      })
      if (error) throw new Error(error.message)

      await rejouerProjection()
      setCible('')
      setPourcentage(Math.max(0, resteAAttribuer - pourcentage) || 100)
      setMessage('Remplacement enregistré et projection recalculée.')
      await charger()
      onApplied?.()
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setEnregistrement(false)
    }
  }

  async function modifier(id: string, patch: Partial<Substitution>) {
    setEnregistrement(true)
    setErreur(null)
    setMessage(null)
    try {
      const { error } = await supabase.from('stock_article_substitutions').update(patch).eq('id', id)
      if (error) throw new Error(error.message)
      await rejouerProjection()
      setMessage('Modification enregistrée et projection recalculée.')
      await charger()
      onApplied?.()
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setEnregistrement(false)
    }
  }

  async function supprimer(id: string) {
    setEnregistrement(true)
    setErreur(null)
    setMessage(null)
    try {
      const { error } = await supabase.from('stock_article_substitutions').delete().eq('id', id)
      if (error) throw new Error(error.message)
      await rejouerProjection()
      setMessage('Remplacement supprimé. La référence retrouve son historique.')
      await charger()
      onApplied?.()
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setEnregistrement(false)
    }
  }

  const cibleChoisie = candidates.find((c) => c.reference_article === cible)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#060A12]/70 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-[#F5F3EC] text-[#141A26] shadow-2xl">
        {/* ---- En-tête ------------------------------------------------- */}
        <div className="flex items-start justify-between gap-4 border-b border-black/10 px-6 py-5">
          <div>
            <div className="font-[var(--font-mono)] text-[11px] uppercase tracking-[0.18em] text-[#141A26]/45">
              Remplacement de référence
            </div>
            <h2 className="mt-1 font-[var(--font-display)] text-xl font-bold">{referenceSource}</h2>
            {designationSource && <p className="text-sm text-[#141A26]/60">{designationSource}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-medium hover:bg-black/5"
          >
            Fermer
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {/* ---- Compteur de répartition ------------------------------- */}
          <div className="mb-5 rounded-xl border border-black/10 bg-white p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">Besoins transférés</span>
              <span
                className="font-[var(--font-mono)] text-2xl font-semibold"
                style={{ color: totalAttribue >= 100 ? VERT : totalAttribue > 0 ? ALERTE : '#141A2666' }}
              >
                {totalAttribue.toFixed(0)} %
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, totalAttribue)}%`,
                  background: totalAttribue >= 100 ? VERT : ALERTE,
                }}
              />
            </div>
            <p className="mt-2 text-xs text-[#141A26]/55">
              {totalAttribue >= 100
                ? "Transfert total : la prévision de cette référence est ramenée à zéro et son historique alimente les remplaçantes."
                : totalAttribue > 0
                  ? `Transfert partiel : ${resteAAttribuer.toFixed(0)} % des besoins restent sur cette référence.`
                  : "Aucun transfert : cette référence conserve l'intégralité de ses besoins."}
            </p>
          </div>

          {erreur && (
            <div className="mb-4 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: `${ALERTE}55`, background: `${ALERTE}14`, color: '#9C4A24' }}>
              {erreur}
            </div>
          )}
          {message && (
            <div className="mb-4 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: `${VERT}55`, background: `${VERT}14`, color: '#2F6B31' }}>
              {message}
            </div>
          )}

          {/* ---- Remplacements en place -------------------------------- */}
          <h3 className="mb-2 font-[var(--font-display)] text-sm font-semibold uppercase tracking-wide text-[#141A26]/60">
            Références remplaçantes
          </h3>

          {chargement ? (
            <div className="rounded-xl bg-white p-6 text-center text-sm text-[#141A26]/50">Chargement…</div>
          ) : lignes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-black/15 bg-white p-6 text-center text-sm text-[#141A26]/50">
              Aucune remplaçante définie pour cette référence.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-black/10 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-left text-[11px] uppercase tracking-wide text-[#141A26]/45">
                    <th className="px-3 py-2">Remplaçante</th>
                    <th className="px-3 py-2">Bascule le</th>
                    <th className="px-3 py-2 text-right">%</th>
                    <th className="px-3 py-2 text-center">Active</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.06]">
                  {lignes.map((l) => (
                    <tr key={l.id} className={l.actif ? '' : 'opacity-50'}>
                      <td className="px-3 py-2 font-[var(--font-mono)] font-medium">{l.reference_cible}</td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={l.date_bascule}
                          disabled={enregistrement}
                          onChange={(e) => void modifier(l.id, { date_bascule: e.target.value })}
                          className="rounded-md border border-black/15 bg-white px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          defaultValue={Number(l.pourcentage)}
                          disabled={enregistrement}
                          onBlur={(e) => {
                            const v = Number(e.target.value)
                            if (v !== Number(l.pourcentage)) void modifier(l.id, { pourcentage: v })
                          }}
                          className="w-16 rounded-md border border-black/15 bg-white px-2 py-1 text-right font-[var(--font-mono)] text-xs"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={l.actif}
                          disabled={enregistrement}
                          onChange={(e) => void modifier(l.id, { actif: e.target.checked })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => void supprimer(l.id)}
                          disabled={enregistrement}
                          className="rounded-md border border-black/15 px-2 py-1 text-xs font-medium text-[#9C4A24] hover:bg-black/5 disabled:opacity-40"
                        >
                          Retirer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ---- Ajout ------------------------------------------------- */}
          <h3 className="mb-2 mt-6 font-[var(--font-display)] text-sm font-semibold uppercase tracking-wide text-[#141A26]/60">
            Ajouter une remplaçante
          </h3>

          <div className="rounded-xl border border-black/10 bg-white p-4">
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Filtrer par référence ou désignation…"
              className="mb-3 w-full rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-[#A6A181]"
            />

            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#141A26]/50">
                  Référence remplaçante ({candidates.length} de la même famille macro)
                </span>
                <select
                  value={cible}
                  onChange={(e) => setCible(e.target.value)}
                  className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-[#A6A181]"
                >
                  <option value="">— Choisir —</option>
                  {candidates.map((c) => (
                    <option key={c.reference_article} value={c.reference_article}>
                      {c.reference_article} · {c.designation?.slice(0, 40)} · N-1 {formatNombre(c.historique_n1)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#141A26]/50">Bascule le</span>
                <input
                  type="date"
                  value={dateBascule}
                  onChange={(e) => setDateBascule(e.target.value)}
                  className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#141A26]/50">%</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={pourcentage}
                  onChange={(e) => setPourcentage(Number(e.target.value))}
                  className="w-20 rounded-lg border border-black/15 bg-white px-3 py-2 text-right font-[var(--font-mono)] text-sm"
                />
              </label>

              <button
                onClick={() => void ajouter()}
                disabled={enregistrement || !cible}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-[#141A26] transition hover:brightness-110 disabled:opacity-40"
                style={{ background: SAUGE }}
              >
                {enregistrement ? 'Enregistrement…' : 'Ajouter'}
              </button>
            </div>

            {cibleChoisie && (
              <p className="mt-3 text-xs text-[#141A26]/60">
                {cibleChoisie.reference_article} porte aujourd&rsquo;hui{' '}
                <strong>{formatNombre(cibleChoisie.historique_n1)}</strong> en base N-1. Après bascule à{' '}
                {pourcentage} %, elle reprendra en plus la part correspondante de l&rsquo;historique de{' '}
                {referenceSource}, et l&rsquo;hypothèse de prévision s&rsquo;appliquera à la somme des deux.
              </p>
            )}

            {resteAAttribuer < 100 && (
              <p className="mt-2 text-xs" style={{ color: ALERTE }}>
                Il reste {resteAAttribuer.toFixed(0)} % attribuables. Au-delà, la base refusera l&rsquo;enregistrement.
              </p>
            )}
          </div>

          <p className="mt-5 text-xs leading-relaxed text-[#141A26]/50">
            La bascule ne s&rsquo;applique qu&rsquo;aux semaines de projection postérieures à la date choisie ;
            avant cette date, les besoins restent sur la référence d&rsquo;origine. Les quantités ne sont ni
            créées ni perdues : ce que la référence cède est exactement ce que ses remplaçantes reçoivent,
            les totaux famille et les graphiques restent donc justes.
          </p>
        </div>
      </div>
    </div>
  )
}
