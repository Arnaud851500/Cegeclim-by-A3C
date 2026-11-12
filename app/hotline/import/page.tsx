'use client'

/**
 * Reprise de l'historique de l'ancien outil de ticketing — Hotline technique
 * (/hotline/import). Créé le 04/11/2026. Réservé aux comptes d'Arnaud.
 *
 * 1. Charger l'export CSV de l'ancien outil (ou le fichier de contrôle Excel
 *    corrigé) ; les doublons de référence sont fusionnés.
 * 2. Choisir le périmètre : les N tickets les plus récents (test) ou tout.
 * 3. Simuler : client retrouvé par téléphone, puis par nom de société ; nature,
 *    gamme et statut déduits. Rien n'est écrit.
 * 4. Télécharger le fichier de contrôle (colonne « Code tiers » à corriger),
 *    puis le recharger : le code saisi est prioritaire.
 * 5. Importer : tickets créés à leur date d'origine, numéro TICK… conservé,
 *    notes et diagnostics dans le ticket ; un ré-import met à jour.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useAccess } from '@/components/AccessContext'
import HotlineHeader, { HotlineErreur } from '@/components/hotline/HotlineHeader'
import { fmtDateHeure, libelleGamme, libelleNature, messageErreur } from '@/lib/hotline'
import { METHODES, exporterControle, lireFichierHistorique, traiterHistorique, type LigneHistorique, type ResultatLigne, type Stats } from '@/lib/hotlineImport'

const COMPTES = ['valancha@gmail.com', 'a.valanchauskas@cegeclim-energies.com']
const carte = 'rounded-2xl border border-[#E2DFD8] bg-white'

export default function HotlineImport() {
  const { email } = useAccess()
  const autorise = COMPTES.includes(String(email || '').toLowerCase())
  const [fichier, setFichier] = useState<string | null>(null)
  const [lignes, setLignes] = useState<LigneHistorique[]>([])
  const [doublons, setDoublons] = useState(0)
  const [avertissements, setAvertissements] = useState<string[]>([])
  const [perimetre, setPerimetre] = useState<'TEST' | 'TOUT'>('TEST')
  const [nbTest, setNbTest] = useState(10)
  const [resultat, setResultat] = useState<{ simulation: boolean; stats: Stats; resultats: ResultatLigne[] } | null>(null)
  const [progression, setProgression] = useState<{ fait: number; total: number } | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [filtre, setFiltre] = useState<'TOUS' | 'NON_TROUVES'>('TOUS')
  const [confirmer, setConfirmer] = useState(false)

  const selection = useMemo(() => (perimetre === 'TOUT' ? lignes : lignes.slice(0, Math.max(1, nbTest))), [lignes, perimetre, nbTest])
  const affichees = useMemo(() => {
    const r = resultat?.resultats || []
    return filtre === 'NON_TROUVES' ? r.filter((x) => x.methode === 'AUCUN' || x.methode === 'TELEPHONE_AMBIGU' || x.methode === 'CODE_FICHIER_INCONNU') : r
  }, [resultat, filtre])

  async function charger(f: File | null) {
    if (!f) return
    setErreur(null)
    setResultat(null)
    setConfirmer(false)
    try {
      const r = await lireFichierHistorique(f)
      setFichier(f.name)
      setLignes(r.lignes)
      setDoublons(r.doublons)
      setAvertissements(r.erreurs)
    } catch (e) {
      setErreur(messageErreur(e))
    }
  }

  async function lancer(simulation: boolean) {
    setErreur(null)
    setConfirmer(false)
    setProgression({ fait: 0, total: selection.length })
    try {
      const r = await traiterHistorique(selection, simulation, (fait, total) => setProgression({ fait, total }))
      setResultat({ simulation, ...r })
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setProgression(null)
    }
  }

  if (!autorise) {
    return (
      <div className="min-h-screen bg-[#F4F3F0]">
        <HotlineHeader titre="Reprise de l’historique" />
        <main className="mx-auto max-w-[900px] p-8 text-sm text-slate-600">Écran réservé à l’administrateur de la hotline.</main>
      </div>
    )
  }

  const enCours = progression !== null
  const s = resultat?.stats

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      <HotlineHeader
        titre="Reprise de l’historique"
        sousTitre="Import des tickets de l’ancien outil : client retrouvé par téléphone puis par nom, date d’origine conservée, notes et diagnostics dans le ticket"
      />
      <main className="mx-auto w-full max-w-[1760px] space-y-4 px-4 py-5 md:px-8">
        {erreur ? <HotlineErreur message={erreur} onClose={() => setErreur(null)} /> : null}

        <section className={`${carte} p-5`}>
          <div className="grid gap-5 lg:grid-cols-3">
            <div>
              <div className="text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">1. Fichier</div>
              <label className="mt-2 flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-[#D8D3C8] px-4 py-6 text-center text-[13px] text-slate-600 hover:border-[#B4761A]">
                <input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => void charger(e.target.files?.[0] || null)} />
                {fichier ? (
                  <span>
                    <span className="font-semibold text-slate-900">{fichier}</span>
                    <br />
                    {lignes.length.toLocaleString('fr-FR')} tickets{doublons ? ` (${doublons} doublons fusionnés)` : ''} — cliquer pour changer
                  </span>
                ) : (
                  <span>
                    Choisir l’export CSV de l’ancien outil
                    <br />
                    <span className="text-[11px] text-slate-400">ou le fichier de contrôle Excel corrigé</span>
                  </span>
                )}
              </label>
              {avertissements.length ? (
                <ul className="mt-2 max-h-24 overflow-y-auto text-[11px] text-[#8A5A11]">
                  {avertissements.slice(0, 20).map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div>
              <div className="text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">2. Périmètre</div>
              <div className="mt-2 space-y-2 text-[13px] text-slate-700">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={perimetre === 'TEST'} onChange={() => setPerimetre('TEST')} className="accent-[#B4761A]" />
                  Test : les
                  <input
                    type="number"
                    min={1}
                    value={nbTest}
                    onChange={(e) => setNbTest(Math.max(1, Number(e.target.value) || 1))}
                    className="h-8 w-20 rounded-md border border-[#D8D3C8] px-2"
                  />
                  tickets les plus récents
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={perimetre === 'TOUT'} onChange={() => setPerimetre('TOUT')} className="accent-[#B4761A]" />
                  Tout le fichier ({lignes.length.toLocaleString('fr-FR')} tickets)
                </label>
                <p className="text-[11px] text-slate-500">Un ticket déjà importé (même n° TICK…) est mis à jour, jamais dupliqué.</p>
              </div>
            </div>

            <div>
              <div className="text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">3. Contrôle puis import</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={!lignes.length || enCours} onClick={() => void lancer(true)} className="rounded-lg bg-[#0B1220] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                  Simuler ({selection.length.toLocaleString('fr-FR')})
                </button>
                <button
                  type="button"
                  disabled={!resultat || enCours}
                  onClick={() => resultat && void exporterControle(selection, resultat.resultats)}
                  className="rounded-lg border border-[#D8D3C8] px-4 py-2 text-[13px] font-semibold text-slate-700 hover:border-[#B4761A] disabled:opacity-40"
                >
                  Fichier de contrôle Excel
                </button>
                {confirmer ? (
                  <span className="flex items-center gap-2 text-[12px]">
                    <span className="font-semibold text-[#8A5A11]">Importer {selection.length.toLocaleString('fr-FR')} tickets ?</span>
                    <button type="button" onClick={() => void lancer(false)} className="rounded-lg bg-[#B4761A] px-3 py-2 font-semibold text-white">
                      Oui, importer
                    </button>
                    <button type="button" onClick={() => setConfirmer(false)} className="font-semibold text-slate-500 underline">
                      Non
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={!resultat?.simulation || enCours}
                    onClick={() => setConfirmer(true)}
                    title={resultat?.simulation ? '' : 'Simuler d’abord'}
                    className="rounded-lg bg-[#B4761A] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#9A6414] disabled:opacity-40"
                  >
                    Importer
                  </button>
                )}
              </div>
              {progression ? (
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded-full bg-[#EEEDEA]">
                    <div className="h-full bg-[#B4761A]" style={{ width: `${Math.round((progression.fait / Math.max(1, progression.total)) * 100)}%` }} />
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {progression.fait.toLocaleString('fr-FR')} / {progression.total.toLocaleString('fr-FR')}
                  </div>
                </div>
              ) : null}
              <p className="mt-2 text-[11px] text-slate-500">
                Le fichier de contrôle reprend toutes les colonnes ; corrigez la colonne « Code tiers » (orange) puis rechargez-le ici.
              </p>
            </div>
          </div>
        </section>

        {resultat && s ? (
          <>
            <div className={`rounded-xl px-4 py-2.5 text-[13px] ${resultat.simulation ? 'border border-[#EBD8AE] bg-[#FDF7EA] text-[#6B470E]' : 'border border-[#CDE5D1] bg-[#EEF7EF] text-[#2F6B3A]'}`}>
              {resultat.simulation ? (
                'Simulation : rien n’a été écrit.'
              ) : (
                <>
                  Import terminé : {s.lignes.toLocaleString('fr-FR')} tickets écrits. Vérifiez dans la console en saisissant le téléphone d’un appelant (historique contact), ou dans{' '}
                  <Link href="/hotline/tickets" className="font-semibold underline">
                    la liste des tickets
                  </Link>
                  .
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
              <Kpi label="Tickets" v={s.lignes} />
              <Kpi label="Nouveaux" v={s.nouveaux} />
              <Kpi label="Déjà importés" v={s.deja_importes} />
              <Kpi label="Client par téléphone" v={s.par_telephone} ton="#2F6B3A" />
              <Kpi label="Client par nom" v={s.par_nom} ton="#2F6B3A" />
              <Kpi label="Code du fichier" v={s.par_fichier} ton="#1E4E8C" />
              <Kpi label="Téléphone ambigu" v={s.ambigus} ton="#8A5A11" />
              <Kpi label="Client non trouvé" v={s.non_trouves} ton="#A32C2C" />
            </div>

            <section className={`${carte} overflow-x-auto`}>
              <div className="flex items-center justify-between gap-2 border-b border-[#EFEDE8] px-4 py-3">
                <span className="text-[14px] font-bold text-slate-900">Détail</span>
                <div className="flex rounded-lg border border-[#D8D3C8] bg-white p-0.5 text-[12px]">
                  {(['TOUS', 'NON_TROUVES'] as const).map((f) => (
                    <button key={f} type="button" onClick={() => setFiltre(f)} className={`rounded-md px-3 py-1 font-semibold ${filtre === f ? 'bg-[#0B1220] text-white' : 'text-slate-600'}`}>
                      {f === 'TOUS' ? 'Tous' : 'Client à corriger'}
                    </button>
                  ))}
                </div>
              </div>
              <table className="w-full min-w-[1100px] text-[12px]">
                <thead className="bg-[#FAF9F7] text-left text-[11px] uppercase tracking-[0.05em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Ticket</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Société (fichier)</th>
                    <th className="px-3 py-2">Téléphone</th>
                    <th className="px-3 py-2">Client retrouvé</th>
                    <th className="px-3 py-2">Méthode</th>
                    <th className="px-3 py-2">Nature</th>
                    <th className="px-3 py-2">Gamme</th>
                    <th className="px-3 py-2">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1EFEA]">
                  {affichees.slice(0, 500).map((r) => (
                    <tr key={r.ref}>
                      <td className="px-3 py-1.5 font-mono">
                        {r.ref}
                        {r.existe ? <span className="ml-1 font-sans text-[10px] font-bold text-slate-400">déjà importé</span> : null}
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">{fmtDateHeure(r.date)}</td>
                      <td className="px-3 py-1.5">{r.societe}</td>
                      <td className="px-3 py-1.5 text-slate-600">{r.telephone}</td>
                      <td className="px-3 py-1.5">
                        {r.numero_tiers ? (
                          <>
                            <span className="font-semibold">{r.numero_tiers}</span> {r.intitule_tiers}
                          </>
                        ) : (
                          <span className="text-slate-400">{r.candidats ? `candidats : ${r.candidats}` : '—'}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-semibold" style={{ color: METHODES[r.methode]?.ton }}>
                        {METHODES[r.methode]?.label || r.methode}
                      </td>
                      <td className="px-3 py-1.5">{libelleNature(r.nature) || '—'}</td>
                      <td className="px-3 py-1.5">{libelleGamme(r.gamme) || '—'}</td>
                      <td className="px-3 py-1.5">{r.statut === 'CLOS' || r.statut === 'RESOLU' ? 'Résolu' : 'En cours'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {affichees.length > 500 ? <p className="px-4 py-2 text-[11px] text-slate-500">500 premières lignes affichées — le fichier de contrôle contient tout.</p> : null}
            </section>
          </>
        ) : null}
      </main>
    </div>
  )
}

function Kpi({ label, v, ton = '#0B1220' }: { label: string; v: number; ton?: string }) {
  return (
    <div className={`${carte} px-4 py-3`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">{label}</div>
      <div className="mt-1 text-[22px] font-bold leading-none" style={{ color: ton }}>
        {v.toLocaleString('fr-FR')}
      </div>
    </div>
  )
}
