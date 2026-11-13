'use client'

/**
 * Paramètres de la hotline (13/11/2026, retours d'ergonomie de Philippe VERGES) :
 *  - clôture automatique des tickets sans activité (« pas de suite donnée par le client ») ;
 *  - export CSV automatique et téléchargement des exports produits ;
 *  - affichage du diagnostic guidé et de la classification détaillée (masqués en V1) ;
 *  - suppression des tickets de test (TEST…).
 * Onglet « Paramètres » de /hotline/diagnostic.
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { chargerParametres, majParametre, messageErreur, PARAMETRES_DEFAUT, supprimerTicketsTest, fmtDateHeure, type ParametresHotline } from '@/lib/hotline'

type ExportFichier = { id: string; chemin: string; nb_tickets: number; mode: string; cree_le: string }

const carte = 'rounded-2xl border border-[#E2DFD8] bg-white p-5'
const titre = 'text-[13px] font-bold uppercase tracking-[0.05em] text-slate-500'

function ChampJours({ valeur, onValider, aide }: { valeur: number | null; onValider: (v: number | null) => void; aide: string }) {
  const [saisie, setSaisie] = useState(valeur ? String(valeur) : '')
  const modifie = (saisie.trim() ? Number(saisie) : null) !== valeur
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
      <input
        type="number"
        min={1}
        value={saisie}
        onChange={(e) => setSaisie(e.target.value)}
        placeholder="désactivé"
        className="h-9 w-28 rounded-lg border border-[#D8D3C8] bg-white px-2 text-[13px]"
      />
      <span className="text-slate-600">jours</span>
      <button
        type="button"
        disabled={!modifie || (saisie.trim() !== '' && !(Number(saisie) > 0))}
        onClick={() => onValider(saisie.trim() ? Math.round(Number(saisie)) : null)}
        className="h-9 rounded-lg bg-[#0B1220] px-3 font-semibold text-white disabled:opacity-40"
      >
        Enregistrer
      </button>
      <span className="text-[12px] text-slate-500">{aide}</span>
    </div>
  )
}

export default function ParametresHotlineAdmin({ onErreur, onInfo }: { onErreur: (m: string) => void; onInfo: (m: string) => void }) {
  const [p, setP] = useState<ParametresHotline | null>(null)
  const [exports, setExports] = useState<ExportFichier[]>([])
  const [nbTests, setNbTests] = useState(0)
  const [confirmer, setConfirmer] = useState(false)
  const [busy, setBusy] = useState(false)

  const charger = useCallback(async () => {
    try {
      setP(await chargerParametres())
      const [{ data: ex }, { count }] = await Promise.all([
        supabase.from('hotline_exports').select('*').order('cree_le', { ascending: false }).limit(30),
        supabase.from('hotline_tickets').select('id', { count: 'exact', head: true }).eq('est_test', true),
      ])
      setExports((ex || []) as ExportFichier[])
      setNbTests(count || 0)
    } catch (e) {
      onErreur(messageErreur(e))
    }
  }, [onErreur])

  useEffect(() => {
    void charger()
  }, [charger])

  async function maj<K extends keyof ParametresHotline>(cle: K, valeur: ParametresHotline[K]) {
    setBusy(true)
    try {
      await majParametre(cle, valeur)
      setP((x) => ({ ...(x || PARAMETRES_DEFAUT), [cle]: valeur }))
      onInfo('Paramètre enregistré.')
    } catch (e) {
      onErreur(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  async function telecharger(e: ExportFichier) {
    const { data, error } = await supabase.storage.from('hotline-exports').createSignedUrl(e.chemin, 120, { download: e.chemin.split('/').pop() })
    if (error || !data) return onErreur(messageErreur(error))
    window.location.assign(data.signedUrl)
  }

  async function purgerTests() {
    setBusy(true)
    try {
      const n = await supprimerTicketsTest()
      setConfirmer(false)
      onInfo(`${n} ticket${n > 1 ? 's' : ''} de test supprimé${n > 1 ? 's' : ''}.`)
      await charger()
    } catch (e) {
      onErreur(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  if (!p) return <div className="text-sm text-slate-500">Chargement des paramètres…</div>

  return (
    <div className="space-y-4">
      <section className={carte}>
        <div className={titre}>Clôture automatique</div>
        <p className="mt-1 text-[13px] text-slate-600">
          Un ticket non résolu sans aucune activité depuis ce délai est résolu automatiquement chaque nuit, avec le motif
          « pas de suite donnée par le client » (issue « Sans suite » en Thermie). Les tickets de test ne sont pas concernés.
        </p>
        <ChampJours key={`c${p.cloture_auto_jours}`} valeur={p.cloture_auto_jours} onValider={(v) => void maj('cloture_auto_jours', v)} aide="Vide = pas de clôture automatique." />
      </section>

      <section className={carte}>
        <div className={titre}>Export CSV automatique</div>
        <p className="mt-1 text-[13px] text-slate-600">
          Export de tous les tickets (commentaires visibles compris) produit automatiquement selon cette périodicité. L’export manuel des tickets affichés se fait depuis la
          liste des tickets (bouton « Export CSV »).
        </p>
        <ChampJours key={`e${p.export_auto_jours}`} valeur={p.export_auto_jours} onValider={(v) => void maj('export_auto_jours', v)} aide="Ex. 7 = chaque semaine. Vide = désactivé." />
        <div className="mt-4">
          {exports.length ? (
            <table className="w-full text-[13px]">
              <thead className="text-left text-[11px] uppercase tracking-[0.05em] text-slate-500">
                <tr>
                  <th className="py-1">Produit le</th>
                  <th className="py-1">Tickets</th>
                  <th className="py-1">Mode</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {exports.map((e) => (
                  <tr key={e.id} className="border-t border-[#EFEDE8]">
                    <td className="py-1.5">{fmtDateHeure(e.cree_le)}</td>
                    <td className="py-1.5">{e.nb_tickets}</td>
                    <td className="py-1.5 text-slate-500">{e.mode === 'AUTO' ? 'automatique' : 'manuel'}</td>
                    <td className="py-1.5 text-right">
                      <button type="button" onClick={() => void telecharger(e)} className="font-semibold text-[#B4761A] underline">
                        Télécharger
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[12px] text-slate-500">Aucun export automatique produit pour l’instant.</p>
          )}
        </div>
      </section>

      <section className={carte}>
        <div className={titre}>Console d’appel</div>
        <div className="mt-3 space-y-2 text-[13px]">
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={busy} checked={p.diagnostic_guide_actif} onChange={(e) => void maj('diagnostic_guide_actif', e.target.checked)} className="h-4 w-4 accent-[#B4761A]" />
            Afficher le diagnostic guidé (parcours de questions) dans la console <span className="text-slate-400">— masqué en V1</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              disabled={busy}
              checked={p.classification_detaillee_active}
              onChange={(e) => void maj('classification_detaillee_active', e.target.checked)}
              className="h-4 w-4 accent-[#B4761A]"
            />
            Afficher la classification détaillée (symptôme, organe, actions menées) <span className="text-slate-400">— masquée en V1, l’issue reste affichée</span>
          </label>
        </div>
      </section>

      <section className={carte}>
        <div className={titre}>Tickets de test</div>
        <p className="mt-1 text-[13px] text-slate-600">
          Les tickets créés avec la case « Ticket de test » sont numérotés TEST… et exclus des statistiques. Les numéros TICK… des vrais tickets ne sont pas
          affectés par leur suppression.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="font-semibold">{nbTests} ticket{nbTests > 1 ? 's' : ''} de test</span>
          {nbTests ? (
            confirmer ? (
              <>
                <span className="font-semibold text-[#A32C2C]">Supprimer définitivement ?</span>
                <button type="button" disabled={busy} onClick={() => void purgerTests()} className="rounded-lg bg-[#A32C2C] px-3 py-1.5 font-semibold text-white disabled:opacity-50">
                  Oui, supprimer
                </button>
                <button type="button" onClick={() => setConfirmer(false)} className="font-semibold text-slate-500 underline">
                  Non
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmer(true)} className="rounded-lg border border-[#A32C2C] px-3 py-1.5 font-semibold text-[#A32C2C]">
                Supprimer les tickets de test
              </button>
            )
          ) : null}
        </div>
      </section>
    </div>
  )
}
