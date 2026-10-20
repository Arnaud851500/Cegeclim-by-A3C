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

// Retour de public.get_sage_import_statut() (publication atomique par lot,
// migration 20261020f_sage_import_lots_publication_atomique.sql)
type ImportStatut = {
  dernier_lot_publie: {
    id: number
    publie_at: string
    soumis_at: string | null
    duree_publication_s: number | null
    tables: Record<string, number> | null
  } | null
  dernier_lot: {
    id: number
    statut: 'chargement' | 'soumis' | 'publie' | 'rejete' | 'abandonne' | 'remplace'
    ouvert_at: string
    soumis_at: string | null
    message: string | null
  } | null
  publication_en_attente: boolean
}

function minutesSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, (Date.now() - t) / 60_000)
}

function formatRelative(minutesAgo: number | null): string {
  if (minutesAgo === null || !Number.isFinite(minutesAgo)) return ''
  if (minutesAgo < 1) return "à l'instant"
  if (minutesAgo < 60) return `il y a ${Math.round(minutesAgo)} min`
  const hours = Math.floor(minutesAgo / 60)
  const mins = Math.round(minutesAgo % 60)
  return `il y a ${hours} h${mins > 0 ? ` ${mins} min` : ''}`
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Badge de fraîcheur des données SAGE.
 *
 * Depuis le 20/10/2026, les données SAGE sont publiées par LOT complet et
 * cohérent (stock, CDF, portefeuille CDC et tables d'activité visibles
 * ensemble). Le badge affiche donc l'heure du dernier lot publié
 * (get_sage_import_statut) :
 *   - point vert  : « Données SAGE : 14:11 (il y a 8 min) »
 *   - point bleu  : un nouveau lot est en cours de publication (les écrans
 *                   montrent encore le lot précédent, complet)
 *   - point orange: le dernier import a été rejeté / abandonné (les écrans
 *                   montrent le lot précédent), ou données anciennes en
 *                   journée, ou synchro en erreur
 * Tant qu'aucun lot n'a encore été publié (transition), repli sur l'ancien
 * affichage get_sage_sync_status.
 *
 * Auto-refresh toutes les 60 s tant que l'onglet est visible.
 */
export default function LastSyncBadge({
  compact = false,
  className = '',
}: {
  compact?: boolean
  className?: string
}) {
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [lots, setLots] = useState<ImportStatut | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [syncRes, lotsRes] = await Promise.all([
        supabase.rpc('get_sage_sync_status'),
        supabase.rpc('get_sage_import_statut'),
      ])
      if (cancelled) return
      if (!syncRes.error && syncRes.data) {
        const row = Array.isArray(syncRes.data) ? syncRes.data[0] : syncRes.data
        setSync(row || null)
      }
      if (!lotsRes.error && lotsRes.data) {
        setLots(lotsRes.data as ImportStatut)
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

  if (loading) return null

  const publie = lots?.dernier_lot_publie ?? null
  const dernier = lots?.dernier_lot ?? null

  // ---- Repli : aucun lot publié pour l'instant -> ancien badge ----
  if (!publie) {
    if (!sync || !sync.last_synced_at) return null
    const isStale = (sync.minutes_ago ?? 0) > 30 || sync.status === 'erreur'
    const color = isStale ? 'var(--cg-warn)' : 'rgba(var(--cg-ink-rgb), 0.4)'
    const dotColor = isStale ? '#D69A4A' : '#3F9142'
    const label = compact
      ? `Synchro ${formatTime(sync.last_synced_at)}`
      : `Der. sync. SAGE : ${formatTime(sync.last_synced_at)} (${formatRelative(sync.minutes_ago)})`
    return (
      <Badge
        className={className}
        compact={compact}
        color={color}
        dotColor={dotColor}
        label={label}
        title={
          sync.status === 'erreur'
            ? 'Dernière tentative de synchro en erreur'
            : `Durée du dernier cycle : ${sync.duration_seconds ? Math.round(sync.duration_seconds) : '—'}s · ${sync.activite_lignes_total ?? '—'} lignes d'activité`
        }
      />
    )
  }

  // ---- Badge par lot publié ----
  const age = minutesSince(publie.publie_at)
  const heure = new Date().getHours()
  const enJournee = heure >= 8 && heure < 20
  // imports environ toutes les 2 h en journée : au-delà de 3 h sans lot, on alerte
  const ancien = enJournee && (age ?? 0) > 180

  const echecRecent =
    !!dernier && dernier.id > publie.id && (dernier.statut === 'rejete' || dernier.statut === 'abandonne')
  const enCours = !!lots?.publication_en_attente || (!!dernier && dernier.id > publie.id && dernier.statut === 'chargement')
  const syncErreur = sync?.status === 'erreur'

  const alerte = echecRecent || ancien || syncErreur

  const color = alerte ? 'var(--cg-warn)' : 'rgba(var(--cg-ink-rgb), 0.4)'
  const dotColor = alerte ? '#D69A4A' : enCours ? '#4A7FD6' : '#3F9142'

  let label = compact
    ? `SAGE ${formatTime(publie.publie_at)}`
    : `Données SAGE : ${formatTime(publie.publie_at)} (${formatRelative(age)})`
  if (!compact && enCours && !alerte) label += ' · mise à jour en cours'
  if (!compact && echecRecent) label += ' · dernier import rejeté'

  const lignesTitre: string[] = [
    `Lot #${publie.id} publié le ${formatDateTime(publie.publie_at)}` +
      (publie.duree_publication_s ? ` (publication ${Math.round(publie.duree_publication_s)} s)` : ''),
    'Stock, commandes fournisseurs et portefeuille clients sont issus du même import.',
  ]
  if (enCours) {
    lignesTitre.push("Un nouvel import est en cours : les chiffres affichés restent ceux du lot ci-dessus jusqu'à sa publication.")
  }
  if (echecRecent && dernier) {
    lignesTitre.push(
      `Import #${dernier.id} du ${formatDateTime(dernier.ouvert_at)} ${dernier.statut === 'rejete' ? 'rejeté' : 'abandonné'} : ${dernier.message ?? 'motif non précisé'}.`,
      'Les données affichées sont celles du dernier lot complet.'
    )
  }
  if (ancien) {
    lignesTitre.push("Aucun nouvel import publié depuis plus de 3 h : vérifier l'export SAGE / l'import VPS.")
  }
  if (syncErreur) {
    lignesTitre.push('Dernière synchro vers les tables d\'activité en erreur.')
  }

  return (
    <Badge
      className={className}
      compact={compact}
      color={color}
      dotColor={dotColor}
      label={label}
      title={lignesTitre.join('\n')}
    />
  )
}

function Badge({
  className,
  compact,
  color,
  dotColor,
  label,
  title,
}: {
  className: string
  compact: boolean
  color: string
  dotColor: string
  label: string
  title: string
}) {
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
      title={title}
    >
      <span style={{ width: 6, height: 6, borderRadius: 3, background: dotColor, flexShrink: 0 }} />
      {label}
    </div>
  )
}
