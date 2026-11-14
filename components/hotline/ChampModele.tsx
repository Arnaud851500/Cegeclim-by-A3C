'use client'

/**
 * Saisie d'un modèle GE / UI avec les modèles disponibles au fur et à mesure
 * de la frappe (14/11/2026, retours d'ergonomie) : catalogue Hi-Parts et
 * modèles déjà rencontrés dans les tickets (RPC hotline_modeles_connus).
 * Un modèle de l'autre type (ex. un GE choisi depuis le champ UI) est remonté
 * avec son type : la console le range automatiquement au bon endroit.
 */

import { useEffect, useState } from 'react'
import { chargerModelesConnus, type ModeleConnu } from '@/lib/hotline'

export default function ChampModele({
  value,
  onChange,
  onChoisir,
  typePrefere,
  placeholder,
  className,
}: {
  value: string
  onChange: (v: string) => void
  onChoisir: (m: ModeleConnu) => void
  typePrefere: 'GE' | 'UI'
  placeholder?: string
  className: string
}) {
  const [saisie, setSaisie] = useState<string | null>(null)
  const [resultats, setResultats] = useState<ModeleConnu[]>([])
  const [ouvert, setOuvert] = useState(false)
  const [actif, setActif] = useState(0)

  useEffect(() => {
    if (saisie === null) return
    const q = saisie.trim()
    const handle = window.setTimeout(async () => {
      if (q.replace(/[^A-Za-z0-9]/g, '').length < 2) {
        setResultats([])
        setOuvert(false)
        return
      }
      try {
        const liste = await chargerModelesConnus(q)
        liste.sort((a, b) => Number(b.type === typePrefere) - Number(a.type === typePrefere) || b.n - a.n)
        setResultats(liste)
        setActif(0)
        setOuvert(liste.length > 0)
      } catch {
        setResultats([])
      }
    }, 250)
    return () => window.clearTimeout(handle)
  }, [saisie, typePrefere])

  function choisir(m: ModeleConnu) {
    onChoisir(m)
    setOuvert(false)
    setSaisie(null)
  }

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase())
          setSaisie(e.target.value)
        }}
        onFocus={() => resultats.length && setOuvert(true)}
        onBlur={() => window.setTimeout(() => setOuvert(false), 150)}
        onKeyDown={(e) => {
          if (!ouvert || !resultats.length) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActif((i) => Math.min(resultats.length - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActif((i) => Math.max(0, i - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            choisir(resultats[actif])
          } else if (e.key === 'Escape') {
            setOuvert(false)
          }
        }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {ouvert && resultats.length ? (
        <div className="absolute left-0 z-30 mt-1 max-h-72 w-[min(360px,90vw)] overflow-auto rounded-xl border border-[#E2DFD8] bg-white shadow-lg">
          <div className="border-b border-[#EFEDE8] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400">Modèles disponibles pour « {saisie?.trim().toUpperCase()}… »</div>
          {resultats.map((m, i) => (
            <button
              key={`${m.type}-${m.modele}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                choisir(m)
              }}
              className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] ${i === actif ? 'bg-[#FDF7EA]' : 'hover:bg-[#FAF9F7]'}`}
            >
              <span className="min-w-0">
                <span className="block truncate font-bold text-slate-900">{m.modele}</span>
                <span className="block truncate text-[11px] text-slate-500">
                  {m.source}
                  {m.n ? ` · ${m.n} ticket${m.n > 1 ? 's' : ''}` : ''}
                </span>
              </span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${m.type === 'GE' ? 'bg-[#E3ECF8] text-[#1E4E8C]' : m.type === 'UI' ? 'bg-[#E6F2E8] text-[#2F6B3A]' : 'bg-[#F1EFEA] text-slate-500'}`}>
                {m.type}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
