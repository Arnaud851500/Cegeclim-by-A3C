'use client'

/**
 * Classification d'un ticket hotline (08/11/2026) : symptôme, organe
 * défaillant, actions menées (plusieurs), issue. Valeurs du référentiel
 * hotline_classif_valeurs (lib/hotline.ts › chargerClassification).
 * Utilisé dans la console (/hotline) et la fiche ticket (/hotline/tickets).
 * Composant contrôlé : le parent garde les valeurs et décide quand enregistrer.
 */

import { useEffect, useState } from 'react'
import { CLASSIF_VIDE, chargerClassification, type Classification, type ValeurClassif } from '@/lib/hotline'

export type ValeursClassif = {
  symptome: string
  organe: string
  actions: string[]
  issue: string
}

export const CLASSIF_FORM_VIDE: ValeursClassif = { symptome: '', organe: '', actions: [], issue: '' }

export function valeursDepuisTicket(t: { symptome?: string | null; organe?: string | null; actions?: string[] | null; issue?: string | null } | null | undefined): ValeursClassif {
  return {
    symptome: t?.symptome || '',
    organe: t?.organe || '',
    actions: t?.actions || [],
    issue: t?.issue || '',
  }
}

/** Patch base (null pour les champs vides). */
export function patchClassif(v: ValeursClassif) {
  return {
    symptome: v.symptome || null,
    organe: v.organe || null,
    actions: v.actions.length ? v.actions : null,
    issue: v.issue || null,
  }
}

export function useClassification() {
  const [classif, setClassif] = useState<Classification>(CLASSIF_VIDE)
  const [erreur, setErreur] = useState<string | null>(null)
  useEffect(() => {
    let vivant = true
    chargerClassification()
      .then((c) => vivant && setClassif(c))
      .catch((e) => vivant && setErreur(String(e?.message || e)))
    return () => {
      vivant = false
    }
  }, [])
  return { classif, erreur }
}

const champ = 'h-9 w-full rounded-lg border border-[#D8D3C8] bg-white px-2.5 text-[13px] text-slate-900 outline-none focus:border-[#B4761A]'

function options(valeurs: ValeurClassif[], courant: string) {
  // Une valeur inactive (ex. NON_TRACEE de l'historique) reste affichée si elle est portée par le ticket.
  return valeurs.filter((v) => v.actif || v.code === courant)
}

export default function ClassificationTicket({
  valeurs,
  onChange,
  classif,
  issueObligatoire,
  source,
  disabled,
  mode = 'complet',
}: {
  valeurs: ValeursClassif
  onChange: (v: ValeursClassif) => void
  classif: Classification
  /** Affiche l'issue en rouge tant qu'elle manque. */
  issueObligatoire?: boolean
  /** classif_source du ticket : signale une classification déduite de l'historique. */
  source?: string | null
  disabled?: boolean
  /** (13/11/2026) 'detail' = symptôme, organe, actions ; 'issue' = issue seule ; 'complet' = tout. */
  mode?: 'complet' | 'detail' | 'issue'
}) {
  const patch = (p: Partial<ValeursClassif>) => onChange({ ...valeurs, ...p })
  const basculerAction = (code: string) =>
    patch({ actions: valeurs.actions.includes(code) ? valeurs.actions.filter((a) => a !== code) : [...valeurs.actions, code] })
  const manqueIssue = issueObligatoire && !valeurs.issue
  const avecDetail = mode !== 'issue'
  const avecIssue = mode !== 'detail'

  return (
    <div className="space-y-2 rounded-lg border border-[#EFEDE8] bg-[#FAF9F7] p-2.5">
      {avecDetail ? (
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">
        Classification
        {source === 'AUTO_2026_11' ? (
          <span className="rounded bg-[#EEF2F8] px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-[#1E4E8C]" title="Déduite des commentaires de l'ancien outil (analyse du 08/11/2026) : à corriger si besoin">
            déduite de l’historique
          </span>
        ) : null}
      </div>
      ) : null}
      {avecDetail ? (
      <>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-[11px] font-semibold text-slate-500">
          Symptôme principal
          <select value={valeurs.symptome} disabled={disabled} onChange={(e) => patch({ symptome: e.target.value })} className={champ}>
            <option value="">—</option>
            {options(classif.symptome, valeurs.symptome).map((v) => (
              <option key={v.code} value={v.code} title={v.aide || undefined}>
                {v.libelle}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-slate-500">
          Organe défaillant
          <select value={valeurs.organe} disabled={disabled} onChange={(e) => patch({ organe: e.target.value })} className={champ}>
            <option value="">—</option>
            {options(classif.organe, valeurs.organe).map((v) => (
              <option key={v.code} value={v.code} title={v.aide || undefined}>
                {v.libelle}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold text-slate-500">Actions menées</div>
        <div className="flex flex-wrap gap-1.5">
          {options(classif.action, '').map((v) => {
            const on = valeurs.actions.includes(v.code)
            return (
              <button
                key={v.code}
                type="button"
                disabled={disabled}
                title={v.aide || undefined}
                onClick={() => basculerAction(v.code)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50 ${on ? 'border-[#1E4E8C] bg-[#1E4E8C] text-white' : 'border-[#D8D3C8] bg-white text-slate-600 hover:border-[#1E4E8C]'}`}
              >
                {v.libelle}
              </button>
            )
          })}
        </div>
      </div>
      </>
      ) : null}
      {avecIssue ? (
      <label className={`block text-[11px] font-semibold ${manqueIssue ? 'text-[#A32C2C]' : 'text-slate-500'}`}>
        Issue {issueObligatoire ? '(obligatoire pour résoudre)' : ''}
        <select
          value={valeurs.issue}
          disabled={disabled}
          onChange={(e) => patch({ issue: e.target.value })}
          className={`${champ} ${manqueIssue ? 'border-[#E8B4AE]' : ''}`}
        >
          <option value="">—</option>
          {options(classif.issue, valeurs.issue).map((v) => (
            <option key={v.code} value={v.code} title={v.aide || undefined}>
              {v.libelle}
            </option>
          ))}
        </select>
      </label>
      ) : null}
    </div>
  )
}
