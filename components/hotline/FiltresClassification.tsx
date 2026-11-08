'use client'

/**
 * Filtres de classification des tickets hotline (08/11/2026) : symptôme,
 * organe défaillant, action menée, issue. Valeur '' = tous, '-' = non
 * renseigné, sinon un code du référentiel hotline_classif_valeurs.
 * Utilisé par la liste des tickets (/hotline/tickets, filtre côté base) et la
 * synthèse N2 / N3 (/hotline/escalades, filtre sur les tickets chargés).
 * `compteurs` (optionnel) affiche le nombre de tickets par valeur.
 */

import { AXES_CLASSIF, type AxeClassif, type Classification, type Ticket } from '@/lib/hotline'

export type FiltreClassif = Record<AxeClassif, string>
export const FILTRE_CLASSIF_VIDE: FiltreClassif = { symptome: '', organe: '', action: '', issue: '' }

const TOUS: Record<AxeClassif, string> = {
  symptome: 'Tous symptômes',
  organe: 'Tous organes',
  action: 'Toutes actions',
  issue: 'Toutes issues',
}
const NON_RENSEIGNE: Record<AxeClassif, string> = {
  symptome: 'Symptôme non renseigné',
  organe: 'Organe non renseigné',
  action: 'Aucune action renseignée',
  issue: 'Issue non renseignée',
}

/** Valeur(s) d'un ticket sur un axe ; [] = non renseigné. */
export function valeursTicket(t: Pick<Ticket, 'symptome' | 'organe' | 'actions' | 'issue'>, axe: AxeClassif): string[] {
  if (axe === 'action') return t.actions || []
  const v = axe === 'symptome' ? t.symptome : axe === 'organe' ? t.organe : t.issue
  return v ? [v] : []
}

/** Le ticket passe-t-il les filtres (filtrage côté écran) ? */
export function passeFiltres(t: Pick<Ticket, 'symptome' | 'organe' | 'actions' | 'issue'>, f: FiltreClassif) {
  return (Object.keys(f) as AxeClassif[]).every((axe) => {
    const v = f[axe]
    if (!v) return true
    const vals = valeursTicket(t, axe)
    return v === '-' ? vals.length === 0 : vals.includes(v)
  })
}

/** Nombre de tickets par axe et par valeur ('-' = non renseigné). */
export function compterClassif(tickets: Array<Pick<Ticket, 'symptome' | 'organe' | 'actions' | 'issue'>>) {
  const res: Record<AxeClassif, Record<string, number>> = { symptome: {}, organe: {}, action: {}, issue: {} }
  tickets.forEach((t) =>
    (Object.keys(res) as AxeClassif[]).forEach((axe) => {
      const vals = valeursTicket(t, axe)
      ;(vals.length ? vals : ['-']).forEach((v) => {
        res[axe][v] = (res[axe][v] || 0) + 1
      })
    }),
  )
  return res
}

export const nbFiltresActifs = (f: FiltreClassif) => Object.values(f).filter(Boolean).length

export default function FiltresClassification({
  valeur,
  onChange,
  classif,
  compteurs,
}: {
  valeur: FiltreClassif
  onChange: (f: FiltreClassif) => void
  classif: Classification
  compteurs?: Record<AxeClassif, Record<string, number>>
}) {
  const n = (axe: AxeClassif, code: string) => (compteurs ? ` (${compteurs[axe][code] || 0})` : '')
  return (
    <>
      {AXES_CLASSIF.map(({ axe, label }) => {
        const v = valeur[axe]
        return (
          <select
            key={axe}
            value={v}
            title={label}
            onChange={(e) => onChange({ ...valeur, [axe]: e.target.value })}
            className={`h-8 max-w-[230px] rounded-lg border bg-white px-2 text-[13px] ${v ? 'border-[#1E4E8C] font-semibold text-[#1E4E8C]' : 'border-[#D8D3C8] text-slate-700'}`}
          >
            <option value="">{TOUS[axe]}</option>
            <option value="-">{`${NON_RENSEIGNE[axe]}${n(axe, '-')}`}</option>
            {classif[axe]
              .filter((c) => !compteurs || compteurs[axe][c.code] || c.code === v)
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.libelle}
                  {n(axe, c.code)}
                </option>
              ))}
          </select>
        )
      })}
      {nbFiltresActifs(valeur) ? (
        <button type="button" onClick={() => onChange({ symptome: '', organe: '', action: '', issue: '' })} className="text-[12px] font-semibold text-slate-500 underline">
          Effacer la classification
        </button>
      ) : null}
    </>
  )
}
