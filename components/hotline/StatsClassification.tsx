'use client'

/**
 * Statistiques de classification des tickets thermie (08/11/2026), affichées
 * dans /hotline/stats. RPC hotline_stats_classification (migration
 * 20261108c_hotline_stats_classification.sql), réservée aux experts hotline.
 *
 * Reprend l'analyse des 22 370 tickets (doc « Hotline Thermie — proposition
 * de classification ») sur la période choisie et une gamme :
 *   - chiffres clés : tickets, classés, finis en pièce / garantie, réglés au téléphone ;
 *   - symptômes et leur issue (pièce / garantie, réglé au téléphone, le reste) ;
 *   - organes défaillants par gamme ;
 *   - codes défaut : gamme dominante, organe le plus souvent en cause, issue ;
 *   - évolution mensuelle ; issues, actions, natures.
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { GAMMES, NATURES, libelleClassif, messageErreur, type AxeClassif, type Classification } from '@/lib/hotline'

type LigneSymptome = { code: string; n: number; piece: number; tel: number; sans_suite: number; non_tracee: number }
type LigneOrgane = { code: string; n: number; RO: number; RR: number; GAINABLE: number; ND: number }
type LigneCode = { code: string; n: number; piece: number; tel: number; gamme: string | null; gamme_n: number; organe: string | null; organe_n: number }
type Compte = { code: string; n: number }
type Mois = { mois: string; n: number; piece: number; tel: number; sans_suite: number }
type StatsClassif = {
  total: number
  classes: number
  auto: number
  saisie: number
  piece: number
  tel: number
  symptomes: LigneSymptome[]
  organes: LigneOrgane[]
  codes: LigneCode[]
  issues: Compte[]
  actions: Compte[]
  natures: Compte[]
  gammes: Compte[]
  mois: Mois[]
}

const C_PIECE = '#1E4E8C'
const C_TEL = '#9DB8DA'
const C_RESTE = '#DAD5CA'
const C_GAMME: Record<string, string> = { RO: '#2D5FA0', RR: '#C98A1E', GAINABLE: '#4E8A5B', ND: '#C9C4BA' }
const LIB_GAMME: Record<string, string> = { RO: 'R/O', RR: 'R/R', GAINABLE: 'Gainable / DRV', ND: 'Non renseignée', '-': 'Non renseignée' }

const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0)
const nb = (n: number) => n.toLocaleString('fr-FR')
const carte = 'rounded-2xl border border-[#E2DFD8] bg-white'
const titreCarte = 'flex flex-wrap items-baseline justify-between gap-2 border-b border-[#EFEDE8] px-4 py-3'

export default function StatsClassification({ debut, fin, classif }: { debut: string; fin: string; classif: Classification }) {
  const [gamme, setGamme] = useState('')
  const [stats, setStats] = useState<StatsClassif | null>(null)
  const [chargee, setChargee] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const cle = `${debut}|${fin}|${gamme}`
  const chargement = chargee !== cle

  useEffect(() => {
    let vivant = true
    supabase.rpc('hotline_stats_classification', { p_debut: debut, p_fin: fin, p_gamme: gamme || null }).then(({ data, error }) => {
      if (!vivant) return
      if (error) setErreur(messageErreur(error))
      else {
        setErreur(null)
        setStats(data as StatsClassif)
      }
      setChargee(`${debut}|${fin}|${gamme}`)
    })
    return () => {
      vivant = false
    }
  }, [debut, fin, gamme])

  const lib = (axe: AxeClassif, code: string | null) => (!code || code === '-' ? 'Non renseigné' : libelleClassif(classif, axe, code))

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-bold text-slate-900">Classification des tickets thermie</h2>
          <p className="text-[12px] text-slate-500">Symptôme, organe défaillant, actions et issue de chaque ticket — période choisie en haut de page.</p>
        </div>
        <div className="flex rounded-lg border border-[#D8D3C8] bg-white p-0.5 text-[12px]">
          {[{ value: '', label: 'Toutes gammes' }, ...GAMMES.map((g) => ({ value: g.value as string, label: g.label })), { value: '-', label: 'Non renseignée' }].map((g) => (
            <button
              key={g.value || 'tous'}
              type="button"
              onClick={() => setGamme(g.value)}
              className={`rounded-md px-2.5 py-1 font-semibold ${gamme === g.value ? 'bg-[#1E4E8C] text-white' : 'text-slate-600'}`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {erreur ? <div className="mb-3 rounded-lg border border-[#E8B4AE] bg-[#FCE9E6] px-3 py-2 text-[13px] text-[#7F1D1D]">{erreur}</div> : null}

      {!stats ? (
        <div className={`${carte} p-10 text-center text-sm text-slate-500`}>Calcul de la classification…</div>
      ) : (
        <div className={`space-y-4 ${chargement ? 'opacity-60' : ''}`}>
          {/* Chiffres clés */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              { label: 'Tickets thermie', valeur: nb(stats.total), sous: chargement ? 'mise à jour…' : '' },
              { label: 'Classés', valeur: `${pct(stats.classes, stats.total)} %`, sous: `${nb(stats.classes)} tickets` },
              { label: 'Finis en pièce / garantie', valeur: `${pct(stats.piece, stats.total)} %`, sous: `${nb(stats.piece)} tickets`, ton: C_PIECE },
              { label: 'Réglés au téléphone', valeur: `${pct(stats.tel, stats.total)} %`, sous: `${nb(stats.tel)} tickets`, ton: '#4A79B4' },
              { label: 'Classés à la saisie', valeur: nb(stats.saisie), sous: `${nb(stats.auto)} déduits de l’historique` },
            ].map((k) => (
              <div key={k.label} className="rounded-xl border border-[#E2DFD8] bg-white px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">{k.label}</div>
                <div className="mt-1 text-[24px] font-bold" style={{ color: k.ton || '#0F172A' }}>
                  {k.valeur}
                </div>
                {k.sous ? <div className="text-[11px] text-slate-500">{k.sous}</div> : null}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* Symptômes et issue */}
            <div className={carte}>
              <div className={titreCarte}>
                <span className="text-[14px] font-bold text-slate-900">Symptômes et issue</span>
                <Legende items={[['Pièce / garantie', C_PIECE], ['Réglé au téléphone', C_TEL], ['Sans suite, conseil, non tracé', C_RESTE]]} />
              </div>
              <div className="space-y-1.5 p-4">
                {(() => {
                  const max = Math.max(1, ...stats.symptomes.map((s) => s.n))
                  return stats.symptomes.map((s) => (
                    <div key={s.code} className="grid grid-cols-[minmax(0,190px)_1fr_auto] items-center gap-2 text-[12px]" title={`${lib('symptome', s.code)} : ${nb(s.n)} tickets — ${pct(s.piece, s.n)} % pièce / garantie, ${pct(s.tel, s.n)} % réglés au téléphone, ${pct(s.sans_suite, s.n)} % sans suite`}>
                      <span className={`truncate text-right ${s.code === '-' ? 'text-slate-400' : 'text-slate-700'}`}>{lib('symptome', s.code)}</span>
                      <div className="flex h-3.5" style={{ width: `${(100 * s.n) / max}%`, minWidth: 2 }}>
                        <div style={{ width: `${pct(s.piece, s.n)}%`, background: C_PIECE }} className="rounded-l-[3px]" />
                        <div style={{ width: `${pct(s.tel, s.n)}%`, background: C_TEL }} />
                        <div style={{ flex: 1, background: C_RESTE }} className="rounded-r-[3px]" />
                      </div>
                      <span className="whitespace-nowrap tabular-nums text-slate-900">
                        {nb(s.n)} <span className="text-slate-500">· {pct(s.piece, s.n)} % pièce</span>
                      </span>
                    </div>
                  ))
                })()}
              </div>
            </div>

            {/* Organes par gamme */}
            <div className={carte}>
              <div className={titreCarte}>
                <span className="text-[14px] font-bold text-slate-900">Organes défaillants par gamme</span>
                <Legende items={(['RO', 'RR', 'GAINABLE', 'ND'] as const).map((g) => [LIB_GAMME[g], C_GAMME[g]])} />
              </div>
              <div className="space-y-1.5 p-4">
                {stats.organes.length ? (
                  (() => {
                    const max = Math.max(1, ...stats.organes.map((o) => o.n))
                    const total = stats.organes.reduce((s, o) => s + o.n, 0)
                    return stats.organes.map((o) => (
                      <div key={o.code} className="grid grid-cols-[minmax(0,190px)_1fr_auto] items-center gap-2 text-[12px]" title={`${lib('organe', o.code)} : ${nb(o.n)} — R/O ${o.RO}, R/R ${o.RR}, Gainable ${o.GAINABLE}, non renseignée ${o.ND}`}>
                        <span className="truncate text-right text-slate-700">{lib('organe', o.code)}</span>
                        <div className="flex h-3.5 overflow-hidden rounded-[3px]" style={{ width: `${(100 * o.n) / max}%`, minWidth: 2 }}>
                          {(['RO', 'RR', 'GAINABLE', 'ND'] as const).map((g) => (o[g] ? <div key={g} style={{ width: `${(100 * o[g]) / o.n}%`, background: C_GAMME[g] }} /> : null))}
                        </div>
                        <span className="whitespace-nowrap tabular-nums text-slate-900">
                          {nb(o.n)} <span className="text-slate-500">· {pct(o.n, total)} %</span>
                        </span>
                      </div>
                    ))
                  })()
                ) : (
                  <p className="text-[13px] text-slate-500">Aucun organe défaillant renseigné sur la période.</p>
                )}
              </div>
            </div>
          </div>

          {/* Codes défaut */}
          <div className={carte}>
            <div className={titreCarte}>
              <span className="text-[14px] font-bold text-slate-900">Codes défaut les plus fréquents</span>
              <span className="text-[12px] text-slate-500">Codes ramenés à une forme commune : « 03 », « code 3 », « défaut 003 » = 3</span>
            </div>
            <div className="overflow-x-auto p-4">
              {stats.codes.length ? (
                <table className="w-full min-w-[820px] text-[12px]">
                  <thead className="text-[11px] uppercase tracking-[0.05em] text-slate-500">
                    <tr>
                      <th className="pb-2 text-left">Code</th>
                      <th className="pb-2 text-right">Tickets</th>
                      <th className="pb-2 pl-4 text-left">Gamme dominante</th>
                      <th className="pb-2 text-left">Organe le plus souvent en cause</th>
                      <th className="w-[30%] pb-2 pl-4 text-left">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.codes.map((c) => (
                      <tr key={c.code} className="border-t border-[#EFEDE8]">
                        <td className="py-1.5 font-semibold text-slate-900">{c.code}</td>
                        <td className="py-1.5 text-right tabular-nums text-slate-900">{nb(c.n)}</td>
                        <td className="py-1.5 pl-4 text-slate-700">{c.gamme ? `${LIB_GAMME[c.gamme] || c.gamme} · ${pct(c.gamme_n, c.n)} %` : '—'}</td>
                        <td className="py-1.5 text-slate-700">{c.organe ? `${lib('organe', c.organe)} (${nb(c.organe_n)})` : <span className="text-slate-400">peu d’organe cité</span>}</td>
                        <td className="py-1.5 pl-4">
                          <div className="flex items-center gap-2" title={`${pct(c.piece, c.n)} % pièce / garantie, ${pct(c.tel, c.n)} % réglés au téléphone`}>
                            <div className="flex h-2.5 flex-1 overflow-hidden rounded-[3px] bg-[#F1EFEA]">
                              <div style={{ width: `${pct(c.piece, c.n)}%`, background: C_PIECE }} />
                              <div style={{ width: `${pct(c.tel, c.n)}%`, background: C_TEL }} />
                            </div>
                            <span className="w-[92px] whitespace-nowrap text-right tabular-nums text-slate-600">
                              {pct(c.piece, c.n)} % · {pct(c.tel, c.n)} % tél.
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-[13px] text-slate-500">Aucun code défaut sur la période.</p>
              )}
            </div>
          </div>

          {/* Évolution mensuelle */}
          {stats.mois.length > 1 ? <Evolution mois={stats.mois} /> : null}

          {/* Issues, actions, natures */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Liste titre="Issues" lignes={stats.issues.map((x) => ({ label: lib('issue', x.code), n: x.n, gris: x.code === '-' || x.code === 'NON_TRACEE' }))} />
            <Liste titre="Actions menées" lignes={stats.actions.map((x) => ({ label: lib('action', x.code), n: x.n }))} total={stats.total} />
            <Liste
              titre="Nature de l’appel"
              lignes={stats.natures.map((x) => ({ label: x.code === '-' ? 'Non renseignée' : NATURES.find((n) => n.value === x.code)?.label || x.code, n: x.n, gris: x.code === '-' }))}
            />
          </div>
        </div>
      )}
    </section>
  )
}

function Legende({ items }: { items: Array<[string, string]> }) {
  return (
    <span className="flex flex-wrap gap-3 text-[11.5px] text-slate-600">
      {items.map(([l, c]) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
          {l}
        </span>
      ))}
    </span>
  )
}

function Liste({ titre, lignes, total }: { titre: string; lignes: Array<{ label: string; n: number; gris?: boolean }>; total?: number }) {
  const somme = total || lignes.reduce((s, l) => s + l.n, 0)
  const max = Math.max(1, ...lignes.map((l) => l.n))
  return (
    <div className={carte}>
      <div className={titreCarte}>
        <span className="text-[14px] font-bold text-slate-900">{titre}</span>
        {total ? <span className="text-[11.5px] text-slate-500">% des tickets (plusieurs par ticket)</span> : null}
      </div>
      <div className="space-y-2 p-4">
        {lignes.length ? (
          lignes.map((l) => (
            <div key={l.label}>
              <div className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className={l.gris ? 'text-slate-400' : 'text-slate-700'}>{l.label}</span>
                <span className="tabular-nums text-slate-900">
                  {nb(l.n)} <span className="text-slate-400">· {pct(l.n, somme)} %</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-[#F1EFEA]">
                <div className="h-1.5 rounded-full" style={{ width: `${(100 * l.n) / max}%`, background: l.gris ? '#C9C4BA' : '#5E6B7E' }} />
              </div>
            </div>
          ))
        ) : (
          <p className="text-[13px] text-slate-500">Rien sur la période.</p>
        )}
      </div>
    </div>
  )
}

function Evolution({ mois }: { mois: Mois[] }) {
  const max = Math.max(1, ...mois.map((m) => m.n))
  const fmtMois = (m: string) => {
    const [a, mm] = m.split('-')
    return `${['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][Number(mm) - 1]} ${a.slice(2)}`
  }
  return (
    <div className={carte}>
      <div className={titreCarte}>
        <span className="text-[14px] font-bold text-slate-900">Évolution mensuelle</span>
        <Legende items={[['Pièce / garantie', C_PIECE], ['Réglé au téléphone', C_TEL], ['Autres', C_RESTE]]} />
      </div>
      <div className="overflow-x-auto p-4">
        <div className="flex h-[180px] items-end gap-[3px]" style={{ minWidth: mois.length * 18 }}>
          {mois.map((m) => (
            <div key={m.mois} className="flex h-full flex-1 flex-col justify-end" title={`${fmtMois(m.mois)} : ${nb(m.n)} tickets — ${pct(m.piece, m.n)} % pièce / garantie, ${pct(m.tel, m.n)} % réglés au téléphone`}>
              <div className="flex flex-col-reverse overflow-hidden rounded-t-[3px]" style={{ height: `${(100 * m.n) / max}%` }}>
                <div style={{ height: `${pct(m.piece, m.n)}%`, background: C_PIECE }} />
                <div style={{ height: `${pct(m.tel, m.n)}%`, background: C_TEL }} />
                <div style={{ flex: 1, background: C_RESTE }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-[3px] text-[10px] text-slate-500" style={{ minWidth: mois.length * 18 }}>
          {mois.map((m, i) => (
            <div key={m.mois} className="flex-1 text-center">
              {mois.length <= 14 || i % 3 === 0 ? fmtMois(m.mois) : ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
