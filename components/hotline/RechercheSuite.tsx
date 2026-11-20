'use client'

/**
 * Recherche intelligente d'un ticket existant (20/11/2026, demande d'Arnaud),
 * en tête de la zone « 1 · Appel » : n° de ticket, client, code tiers, contact,
 * chantier, n° de série, téléphone, code défaut — plusieurs mots possibles
 * (tous doivent être trouvés). Le ticket choisi sert de base au nouveau ticket
 * « Suite au ticket TICK… ».
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { fmtDate, styleStatut, type Ticket } from '@/lib/hotline'

const CHAMPS = ['numero', 'intitule_tiers', 'numero_tiers', 'contact_nom', 'chantier', 'numero_serie', 'serie_ge', 'telephone_appelant', 'code_defaut', 'onduleur_serie']

export default function RechercheSuite({ onChoisir, onVoir }: { onChoisir: (t: Ticket) => void; onVoir: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [resultats, setResultats] = useState<Ticket[] | null>(null)
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    const termes = q
      .replace(/[,()%*]/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
    let actif = true
    const h = window.setTimeout(async () => {
      if (!termes.length) {
        if (actif) setResultats(null)
        return
      }
      setEnCours(true)
      try {
        let requete = supabase.from('hotline_tickets').select('*')
        for (const t of termes) {
          const motif = /^\d[\d .]*$/.test(t) && t.replace(/\D/g, '').length >= 6 ? t.replace(/\D/g, '') : t
          requete = requete.or(CHAMPS.map((c) => `${c}.ilike.%${motif}%`).join(','))
        }
        const { data, error } = await requete.order('opened_at', { ascending: false }).limit(12)
        if (error) throw error
        if (actif) setResultats((data || []) as Ticket[])
      } catch {
        if (actif) setResultats([])
      } finally {
        if (actif) setEnCours(false)
      }
    }, 300)
    return () => {
      actif = false
      window.clearTimeout(h)
    }
  }, [q])

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQ('')}
        placeholder="🔎 Rechercher un ticket (n°, client, chantier, n° de série…)"
        className="h-9 w-full rounded-lg border-2 border-[#9DB6D9] bg-white px-2.5 text-[13px] text-slate-900 outline-none focus:border-[#1E4E8C]"
      />
      {resultats !== null ? (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-[360px] overflow-auto rounded-xl border border-[#9DB6D9] bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-[#EFEDE8] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400">
            <span>{enCours ? 'Recherche…' : `${resultats.length} ticket${resultats.length > 1 ? 's' : ''}`}</span>
            <button type="button" onClick={() => setQ('')} className="normal-case tracking-normal text-slate-500 underline">
              Fermer
            </button>
          </div>
          {resultats.map((t) => {
            const st = styleStatut(t.statut)
            return (
              <div key={t.id} className="border-b border-[#F1EFEA] px-3 py-2 text-[12px] last:border-b-0 hover:bg-[#F4F7FC]">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold text-slate-900">{t.numero}</span>
                    {t.chantier ? (
                      <>
                        <span className="text-slate-400"> · </span>
                        <span className="font-bold text-[#D9480F]">{t.chantier}</span>
                      </>
                    ) : null}
                    <span className="text-slate-600"> · {t.intitule_tiers || t.numero_tiers || '—'}</span>
                  </span>
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: st.bg, color: st.tone }}>
                    {st.label}
                  </span>
                </div>
                <div className="truncate text-slate-500">
                  {[fmtDate(t.opened_at), t.contact_nom, t.modele_ge || t.reference_article || t.onduleur_modele, t.description].filter(Boolean).join(' · ')}
                </div>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onChoisir(t)
                      setQ('')
                    }}
                    className="rounded-md bg-[#1E4E8C] px-2 py-1 text-[11px] font-bold text-white hover:bg-[#163B6B]"
                  >
                    ↪ Suite au ticket
                  </button>
                  <button type="button" onClick={() => onVoir(t.id)} className="rounded-md border border-[#D8D3C8] px-2 py-1 text-[11px] font-semibold text-slate-600">
                    Voir
                  </button>
                </div>
              </div>
            )
          })}
          {!enCours && !resultats.length ? <div className="px-3 py-2 text-[12px] text-slate-500">Aucun ticket trouvé.</div> : null}
        </div>
      ) : null}
    </div>
  )
}
