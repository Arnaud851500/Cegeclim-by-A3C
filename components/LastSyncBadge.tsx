'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type SyncStatus = {
  last_synced_at: string | null
  duration_seconds: number | null
  activite_lignes_total: number | null
  status: string | null
  minutes_ago: number | null
}

function formatRelative(minutesAgo: number | null): string {
  if (minutesAgo === null || !Number.isFinite(minutesAgo)) return ''
  if (minutesAgo < 1) return "à l'instant"
  if (minutesAgo < 60) return `il y a ${Math.round(minutesAgo)} min`
  const hours = Math.floor(minutesAgo / 60)
  const mins = Math.round(minutesAgo % 60)
  return `il y a ${hours} h${mins > 0 ? ` ${mins} min` : ''}`
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Badge "Dernière synchro SAGE : 16h10 (il y a 8 min)" — lit
 * public.sage_sync_status via la RPC get_sage_sync_status(). Auto-refresh
 * toutes les 60s tant que l'onglet est visible, pour rester à jour sans
 * recharger la page.
 *
 * Passe > 30 min sans synchro réussie -> passe en orange (signal visuel
 * qu'un maillon de la chaîne SAGE->Supabase est probablement en panne).
 */
export default function LastSyncBadge({
  compact = false,
  className = '',
}: {
  compact?: boolean
  className?: string
}) {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error } = await supabase.rpc('get_sage_sync_status')
      if (cancelled) return
      if (!error && data) {
        const row = Array.isArray(data) ? data[0] : data
        setStatus(row || null)
      }
      setLoading(false)
    }

    void load()
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 60_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (loading || !status || !status.last_synced_at) return null

  const isStale = (status.minutes_ago ?? 0) > 30 || status.status === 'erreur'
  const color = isStale ? '#D69A4A' : 'rgba(255,255,255,0.4)'
  const dotColor = isStale ? '#D69A4A' : '#3F9142'

  const label = compact
    ? `Synchro ${formatTime(status.last_synced_at)}`
    : `Der. sync. SAGE : ${formatTime(status.last_synced_at)} (${formatRelative(status.minutes_ago)})`

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: compact ? 10.5 : 11,
        color,
        fontFamily: 'var(--font-mono, monospace)',
      }}
      title={
        status.status === 'erreur'
          ? "Dernière tentative de synchro en erreur"
          : `Durée du dernier cycle : ${status.duration_seconds ? Math.round(status.duration_seconds) : '—'}s · ${status.activite_lignes_total ?? '—'} lignes d'activité`
      }
    >
      <span style={{ width: 6, height: 6, borderRadius: 3, background: dotColor, flexShrink: 0 }} />
      {label}
    </div>
  )
}
