'use client'

// En-tête commun aux écrans Hotline technique (/hotline/*) : surtitre, titre,
// onglets entre les écrans du module (seuls ceux autorisés sont affichés).
// Même charte que Suivi agences – commerciaux (variables --cg-hdr-*).

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import type React from 'react'
import { useAccess } from '@/components/AccessContext'
import { supabase } from '@/lib/supabaseClient'

const ONGLETS: Array<{ href: string; label: string; expert?: boolean }> = [
  { href: '/hotline', label: 'Console d’appel' },
  { href: '/hotline/tickets', label: 'Tickets' },
  { href: '/hotline/escalades', label: 'Synthèse N2 / N3', expert: true },
  { href: '/hotline/diagnostic', label: 'Éditeur de diagnostic', expert: true },
  { href: '/hotline/stats', label: 'Statistiques', expert: true },
]

export default function HotlineHeader({
  titre,
  sousTitre,
  actions,
}: {
  titre: string
  sousTitre?: React.ReactNode
  actions?: React.ReactNode
}) {
  const pathname = usePathname()
  const { rights, email } = useAccess()
  const expert = Boolean(rights.can_hotline_expert || rights.can_autorisation)
  // (12/11/2026) Clients que l'utilisateur doit rappeler (tickets non résolus).
  const [rappels, setRappels] = useState(0)
  useEffect(() => {
    if (!email) return
    let vivant = true
    const lire = () =>
      supabase
        .from('hotline_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('rappel_par', email)
        .neq('statut', 'RESOLU')
        .then(({ count }) => vivant && setRappels(count || 0))
    void lire()
    const t = window.setInterval(lire, 60_000)
    return () => {
      vivant = false
      window.clearInterval(t)
    }
  }, [email, pathname])

  return (
    <header className="border-b border-[color:var(--cg-hdr-border)] bg-[color:var(--cg-hdr-bg)]">
      <div className="mx-auto flex w-full max-w-[1760px] flex-wrap items-end justify-between gap-4 px-4 pt-4 md:px-8">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#B4761A]">Hotline technique · SAV</div>
          <h1 className="mt-1 text-[24px] font-bold leading-tight text-[color:var(--cg-hdr-ink)] md:text-[28px]">{titre}</h1>
          {sousTitre ? <p className="mt-1 text-[12px] text-[color:var(--cg-hdr-muted)]">{sousTitre}</p> : null}
        </div>
        {actions || rappels ? (
          <div className="flex items-center gap-2 pb-1">
            {rappels ? (
              <Link
                href="/hotline/tickets?rappels=1"
                className="rounded-lg bg-[#7A5EA8] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#5B3F8C]"
                title="Tickets dont le client est à rappeler par vous"
              >
                📞 {rappels} client{rappels > 1 ? 's' : ''} à rappeler
              </Link>
            ) : null}
            {actions}
          </div>
        ) : null}
      </div>
      <nav className="mx-auto mt-3 flex w-full max-w-[1760px] gap-1 overflow-x-auto px-4 md:px-8">
        {ONGLETS.filter((o) => !o.expert || expert).map((o) => {
          const actif = o.href === '/hotline' ? pathname === '/hotline' : pathname === o.href || pathname.startsWith(`${o.href}/`)
          return (
            <Link
              key={o.href}
              href={o.href}
              className={`whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-[13px] font-semibold ${
                actif
                  ? 'border-[#B4761A] text-[color:var(--cg-hdr-ink)]'
                  : 'border-transparent text-[color:var(--cg-hdr-muted)] hover:text-[color:var(--cg-hdr-ink)]'
              }`}
            >
              {o.label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}

/** Bandeau d'erreur commun. */
export function HotlineErreur({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-[#F0C5BE] bg-[#FCEFEC] px-4 py-2.5 text-[13px] text-[#7F1D1D]">
      <span>{message}</span>
      {onClose ? (
        <button type="button" onClick={onClose} className="font-semibold underline">
          Fermer
        </button>
      ) : null}
    </div>
  )
}

export function Pastille({ label, tone, bg }: { label: string; tone: string; bg: string }) {
  return (
    <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: tone, background: bg }}>
      {label}
    </span>
  )
}
