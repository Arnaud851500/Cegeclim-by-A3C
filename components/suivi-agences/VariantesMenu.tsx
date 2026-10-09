'use client'

// Variantes de sélection (filtres enregistrés par utilisateur et par écran),
// table user_filtres_variantes. Une variante peut être marquée « par défaut » :
// elle est appliquée à l'ouverture de l'écran.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export type Variante<T> = { id: string; nom: string; filtres: T; par_defaut: boolean }

export function useVariantes<T>(ecran: string) {
  const [variantes, setVariantes] = useState<Variante<T>[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('user_filtres_variantes')
      .select('id, nom, filtres, par_defaut')
      .eq('ecran', ecran)
      .order('nom', { ascending: true })
    if (err) setError(err.message)
    else {
      setError(null)
      setVariantes(((data || []) as any[]).map((r) => ({ id: String(r.id), nom: String(r.nom), filtres: r.filtres as T, par_defaut: !!r.par_defaut })))
    }
    setLoaded(true)
  }, [ecran])

  useEffect(() => {
    void reload()
  }, [reload])

  const save = useCallback(
    async (nom: string, filtres: T, parDefaut: boolean) => {
      if (parDefaut) {
        const { error: e1 } = await supabase.from('user_filtres_variantes').update({ par_defaut: false }).eq('ecran', ecran).eq('par_defaut', true)
        if (e1) return e1.message
      }
      const existing = variantes.find((v) => v.nom.toLowerCase() === nom.toLowerCase())
      const payload = { ecran, nom, filtres, par_defaut: parDefaut, updated_at: new Date().toISOString() }
      const { error: e2 } = existing
        ? await supabase.from('user_filtres_variantes').update(payload).eq('id', existing.id)
        : await supabase.from('user_filtres_variantes').insert(payload)
      if (e2) return e2.message
      await reload()
      return null
    },
    [ecran, variantes, reload]
  )

  const setDefault = useCallback(
    async (id: string | null) => {
      const { error: e1 } = await supabase.from('user_filtres_variantes').update({ par_defaut: false }).eq('ecran', ecran).eq('par_defaut', true)
      if (e1) return e1.message
      if (id) {
        const { error: e2 } = await supabase.from('user_filtres_variantes').update({ par_defaut: true }).eq('id', id)
        if (e2) return e2.message
      }
      await reload()
      return null
    },
    [ecran, reload]
  )

  const remove = useCallback(
    async (id: string) => {
      const { error: e } = await supabase.from('user_filtres_variantes').delete().eq('id', id)
      if (e) return e.message
      await reload()
      return null
    },
    [reload]
  )

  return { variantes, loaded, error, save, setDefault, remove }
}

export default function VariantesMenu<T>({
  variantes,
  activeId,
  dirty,
  onApply,
  onSave,
  onSetDefault,
  onRemove,
}: {
  variantes: Variante<T>[]
  activeId: string | null
  dirty: boolean
  onApply: (variante: Variante<T> | null) => void
  onSave: (nom: string, parDefaut: boolean) => Promise<string | null>
  onSetDefault: (id: string | null) => Promise<string | null>
  onRemove: (id: string) => Promise<string | null>
}) {
  const [open, setOpen] = useState(false)
  const [nom, setNom] = useState('')
  const [parDefaut, setParDefaut] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const active = variantes.find((v) => v.id === activeId) || null

  useEffect(() => {
    if (!open) return
    setNom(active?.nom || '')
    setParDefaut(active?.par_defaut || false)
    setMessage(null)
    function onDoc(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function run(action: () => Promise<string | null>, ok?: string) {
    setBusy(true)
    const err = await action()
    setBusy(false)
    setMessage(err ? `Erreur : ${err}` : ok || null)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 max-w-[260px] items-center gap-2 rounded-lg border border-[#D8D3C8] bg-white px-3 text-[13px] text-slate-700 transition hover:border-[#B4761A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]"
        title="Variantes de sélection enregistrées"
      >
        <span className="text-[13px]">☆</span>
        <span className="truncate font-semibold">{active ? active.nom : 'Variantes'}</span>
        {active?.par_defaut && <span className="rounded bg-[#FDF7EA] px-1 text-[10px] font-bold text-[#8A5A11]">défaut</span>}
        {dirty && active && <span className="text-[10px] italic text-slate-400">modifiée</span>}
        <span className="text-[10px] text-slate-400">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-[60] w-[340px] rounded-xl border border-[#E2DFD8] bg-white p-3 shadow-xl">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Mes variantes</div>
          <div className="max-h-[220px] space-y-0.5 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onApply(null)
                setOpen(false)
              }}
              className="w-full rounded-md px-2 py-1.5 text-left text-[13px] text-slate-600 hover:bg-[#FAF9F7]"
            >
              Sans filtre (tout afficher)
            </button>
            {variantes.length === 0 && <div className="px-2 py-2 text-xs text-slate-400">Aucune variante enregistrée.</div>}
            {variantes.map((v) => (
              <div key={v.id} className={`group flex items-center gap-1 rounded-md px-1 ${v.id === activeId ? 'bg-[#FDF7EA]' : 'hover:bg-[#FAF9F7]'}`}>
                <button
                  type="button"
                  onClick={() => {
                    onApply(v)
                    setOpen(false)
                  }}
                  className="flex-1 truncate px-1 py-1.5 text-left text-[13px] font-medium text-slate-800"
                >
                  {v.nom}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => onSetDefault(v.par_defaut ? null : v.id), v.par_defaut ? 'Plus de variante par défaut.' : `« ${v.nom} » s’ouvrira par défaut.`)}
                  className={`rounded px-1.5 py-1 text-[13px] ${v.par_defaut ? 'text-[#B4761A]' : 'text-slate-300 hover:text-[#B4761A]'}`}
                  title={v.par_defaut ? 'Variante par défaut (cliquer pour retirer)' : 'Afficher par défaut'}
                >
                  ★
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => onRemove(v.id), 'Variante supprimée.')}
                  className="rounded px-1.5 py-1 text-[12px] text-slate-300 hover:text-[#A32C2C]"
                  title="Supprimer"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 border-t border-[#EFEDE8] pt-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Enregistrer la sélection actuelle</div>
            <input
              value={nom}
              onChange={(event) => setNom(event.target.value)}
              placeholder="Nom de la variante (ex. Agences Sud)"
              className="h-8 w-full rounded-lg border border-[#E2DFD8] px-2.5 text-[13px] outline-none focus:border-[#B4761A]"
            />
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-slate-700">
              <input type="checkbox" checked={parDefaut} onChange={(event) => setParDefaut(event.target.checked)} className="h-3.5 w-3.5 accent-[#B4761A]" />
              Afficher par défaut à l’ouverture
            </label>
            <button
              type="button"
              disabled={busy || !nom.trim()}
              onClick={() => void run(() => onSave(nom.trim(), parDefaut), `« ${nom.trim()} » enregistrée.`)}
              className="mt-2 w-full rounded-lg bg-[#111820] py-2 text-[13px] font-semibold text-white transition hover:bg-[#25313D] disabled:opacity-40"
            >
              {variantes.some((v) => v.nom.toLowerCase() === nom.trim().toLowerCase()) ? 'Mettre à jour la variante' : 'Enregistrer'}
            </button>
            {message && <div className={`mt-2 text-[12px] ${message.startsWith('Erreur') ? 'text-[#A32C2C]' : 'text-[#1F6B3A]'}`}>{message}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
