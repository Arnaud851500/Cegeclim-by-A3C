'use client'

// Liste déroulante compacte à sélection multiple (écran Suivi agences /
// commerciaux). Sélection vide = « Tous ». Recherche, Tout / Aucun.

import { useEffect, useMemo, useRef, useState } from 'react'

export type MultiOption = { value: string; label: string; hint?: string; muted?: boolean }

export default function MultiSelect({
  label,
  allLabel = 'Tous',
  options,
  selected,
  onChange,
  width = 280,
}: {
  label: string
  allLabel?: string
  options: MultiOption[]
  selected: string[]
  onChange: (next: string[]) => void
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => `${o.label} ${o.value} ${o.hint || ''}`.toLowerCase().includes(q))
  }, [options, query])

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label || selected[0]
      : `${selected.length} sélectionnés`

  function toggle(value: string) {
    if (selectedSet.has(value)) onChange(selected.filter((v) => v !== value))
    else onChange([...selected, value])
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 max-w-[240px] items-center gap-2 rounded-lg border px-3 text-[13px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] ${
          selected.length
            ? 'border-[#B4761A] bg-[#FDF7EA] text-[#6B470E]'
            : 'border-[#D8D3C8] bg-white text-slate-700 hover:border-[#B4761A]'
        }`}
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</span>
        <span className="truncate font-semibold">{summary}</span>
        <span className="text-[10px] text-slate-400">▾</span>
      </button>

      {open && (
        <div
          className="absolute left-0 top-[calc(100%+6px)] z-[60] rounded-xl border border-[#E2DFD8] bg-white p-2 shadow-xl"
          style={{ width }}
        >
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher…"
            className="mb-2 h-8 w-full rounded-lg border border-[#E2DFD8] px-2.5 text-[13px] outline-none focus:border-[#B4761A]"
          />
          <div className="mb-1 flex items-center justify-between px-1 text-[11px]">
            <button type="button" onClick={() => onChange(Array.from(new Set([...selected, ...visible.map((o) => o.value)])))} className="font-semibold text-[#8A5A11] hover:underline">
              Tout cocher
            </button>
            <button type="button" onClick={() => onChange([])} className="font-semibold text-slate-500 hover:underline">
              Effacer ({allLabel.toLowerCase()})
            </button>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {visible.length === 0 && <div className="px-2 py-3 text-center text-xs text-slate-400">Aucun résultat</div>}
            {visible.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-[#FAF9F7]"
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(option.value)}
                  onChange={() => toggle(option.value)}
                  className="h-3.5 w-3.5 accent-[#B4761A]"
                />
                <span className={`flex-1 truncate ${option.muted ? 'text-slate-400' : 'text-slate-800'}`}>{option.label}</span>
                {option.hint && <span className="shrink-0 text-[10px] text-slate-400">{option.hint}</span>}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
