'use client'

/**
 * Saisie d'un n° de série avec les modèles possibles (12/11/2026).
 * Dès 3 caractères, liste déroulante des modèles GE / UI déjà rencontrés dans
 * l'historique des tickets pour des n° de série commençant ainsi (ex. 4KE053
 * → tous les modèles dont un n° de série commence par 4KE053). Choisir une
 * ligne renseigne le modèle. RPC hotline_modeles_par_serie.
 */

import { useEffect, useState } from 'react'
import { chargerModelesParSerie, fmtDate, type ModeleSerie } from '@/lib/hotline'

export default function ChampSerie({
  value,
  onChange,
  onModele,
  placeholder,
  typePrefere,
  className,
}: {
  value: string
  onChange: (v: string) => void
  onModele: (modele: string, type: 'GE' | 'UI') => void
  placeholder?: string
  typePrefere: 'GE' | 'UI'
  className: string
}) {
  const [saisie, setSaisie] = useState<string | null>(null)
  const [resultats, setResultats] = useState<ModeleSerie[]>([])
  const [ouvert, setOuvert] = useState(false)
  const [actif, setActif] = useState(0)
  const [chargement, setChargement] = useState(false)

  useEffect(() => {
    if (saisie === null) return
    const q = saisie.trim()
    const handle = window.setTimeout(async () => {
      if (q.replace(/\s/g, '').length < 3) {
        setResultats([])
        setOuvert(false)
        return
      }
      setChargement(true)
      try {
        const liste = await chargerModelesParSerie(q)
        liste.sort((a, b) => Number(b.type === typePrefere) - Number(a.type === typePrefere) || b.n - a.n)
        setResultats(liste)
        setActif(0)
        setOuvert(liste.length > 0)
      } catch {
        setResultats([])
      } finally {
        setChargement(false)
      }
    }, 300)
    return () => window.clearTimeout(handle)
  }, [saisie, typePrefere])

  function choisir(m: ModeleSerie) {
    onModele(m.modele, m.type)
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
        autoComplete="off"
        className={className}
        title="Dès 3 caractères : modèles déjà rencontrés pour ce début de n° de série"
      />
      {chargement ? <span className="pointer-events-none absolute right-2 top-2 text-[11px] text-slate-400">…</span> : null}
      {ouvert && resultats.length ? (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-[280px] w-[340px] overflow-y-auto rounded-lg border border-[#D8D3C8] bg-white py-1 shadow-lg">
          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.05em] text-slate-400">Modèles connus pour « {value.trim()}… »</div>
          {resultats.map((m, i) => (
            <button
              key={`${m.type}-${m.modele}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                choisir(m)
              }}
              onMouseEnter={() => setActif(i)}
              className={`block w-full px-3 py-1.5 text-left text-[12px] ${i === actif ? 'bg-[#FDF7EA]' : ''}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-slate-900">{m.modele}</span>
                <span className={`rounded px-1.5 text-[10px] font-bold ${m.type === 'GE' ? 'bg-[#E6EEF9] text-[#1E4E8C]' : 'bg-[#EEEDEA] text-slate-600'}`}>{m.type}</span>
              </div>
              <div className="text-[11px] text-slate-500">
                {m.n} ticket{m.n > 1 ? 's' : ''} · dernier le {fmtDate(m.dernier)}
                {m.exemples?.length ? ` · ex. ${m.exemples.slice(0, 2).join(', ')}` : ''}
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
