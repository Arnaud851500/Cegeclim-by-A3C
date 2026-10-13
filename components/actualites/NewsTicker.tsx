'use client'

// ============================================================================
// components/actualites/NewsTicker.tsx — Fil d'actualité du bandeau (PC)
// ----------------------------------------------------------------------------
// Occupe la place libérée par les pastilles d'alerte (13/10/2026). Les
// actualités publiées et « à afficher dans le bandeau » défilent ; le survol
// met en pause. Un clic ouvre l'actualité dans l'écran Fil d'actualité ; la
// croix « Ne plus afficher » la retire du bandeau pour cet utilisateur (elle
// reste lisible dans le fil).
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/components/ThemeContext'
import {
  ACTUALITES_CHANGED_EVENT,
  ACTUALITES_PATH,
  categoryTone,
  fetchFlux,
  formatDateCourte,
  marquerActualites,
  type Actualite,
} from '@/lib/actualites'

const REFRESH_MS = 5 * 60 * 1000

function MegaphoneIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" />
      <path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" />
    </svg>
  )
}

export default function NewsTicker() {
  const router = useRouter()
  const { theme } = useTheme()
  const [items, setItems] = useState<Actualite[]>([])
  const [available, setAvailable] = useState(true)

  const load = useCallback(async () => {
    try {
      const rows = await fetchFlux({ type: 'actualite' })
      setItems(rows.filter((row) => row.dans_bandeau))
      setAvailable(true)
    } catch {
      // Tables pas encore créées ou réseau : le bandeau reste discret.
      setAvailable(false)
    }
  }, [])

  useEffect(() => {
    // Chargement asynchrone : les setState ont lieu après la réponse réseau.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    const interval = window.setInterval(() => void load(), REFRESH_MS)
    const onChange = () => void load()
    const onFocus = () => void load()
    window.addEventListener(ACTUALITES_CHANGED_EVENT, onChange)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener(ACTUALITES_CHANGED_EVENT, onChange)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  const open = useCallback(
    (item: Actualite) => {
      void marquerActualites([item.id], { lu: true }).catch(() => {})
      router.push(`${ACTUALITES_PATH}?id=${item.id}`)
    },
    [router]
  )

  const dismiss = useCallback((item: Actualite) => {
    setItems((current) => current.filter((row) => row.id !== item.id))
    void marquerActualites([item.id], { lu: null, masque: true }).catch(() => {})
  }, [])

  const unread = items.filter((item) => !item.lu).length
  const countLabel = items.length === 0 ? 'à jour' : unread > 0 ? `${unread} nouvelle${unread > 1 ? 's' : ''}` : `${items.length} en cours`

  // Durée de défilement proportionnelle à la longueur du texte (vitesse constante).
  const duration = useMemo(() => {
    const chars = items.reduce((sum, item) => sum + item.titre.length + 18, 0)
    return Math.max(24, Math.round(chars * 0.22))
  }, [items])

  const loop = items.length > 0 ? [...items, ...items] : []

  return (
    <div style={styles.wrap}>
      <button type="button" onClick={() => router.push(ACTUALITES_PATH)} style={styles.label} title="Ouvrir le fil d’actualité">
        <span style={styles.labelIcon}><MegaphoneIcon /></span>
        <span style={styles.labelText}>
          <span style={styles.labelTitle}>Fil d’actu</span>
          <span style={styles.labelCount}>{available ? countLabel : '—'}</span>
        </span>
      </button>

      <div className="cgcTickerWrap" style={styles.viewport}>
        {items.length === 0 ? (
          <span style={styles.empty}>
            {available ? 'Aucune nouvelle actualité dans le bandeau — ' : 'Fil d’actualité indisponible pour le moment — '}
            <button type="button" onClick={() => router.push(ACTUALITES_PATH)} style={styles.emptyLink}>ouvrir le fil</button>
          </span>
        ) : (
          <div
            className="cgcTickerTrack"
            style={{ ...styles.track, ['--cg-ticker-duration' as string]: `${duration}s` } as React.CSSProperties}
          >
            {loop.map((item, index) => {
              const tone = categoryTone(item.categorie, theme)
              const duplicate = index >= items.length
              return (
                <span key={`${item.id}-${index}`} style={styles.item} aria-hidden={duplicate || undefined}>
                  <button
                    type="button"
                    onClick={() => open(item)}
                    style={styles.itemButton}
                    tabIndex={duplicate ? -1 : 0}
                    title={`Diffusé le ${formatDateCourte(item.date_diffusion)} — ouvrir`}
                  >
                    <span style={styles.itemDate}>{formatDateCourte(item.date_diffusion)}</span>
                    {item.categorie ? (
                      <span style={{ ...styles.itemTag, background: tone.bg, color: tone.fg }}>{item.categorie}</span>
                    ) : null}
                    <span style={{ ...styles.itemTitle, fontWeight: item.lu ? 500 : 700 }}>{item.titre}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => dismiss(item)}
                    style={styles.dismiss}
                    tabIndex={duplicate ? -1 : 0}
                    title="Ne plus afficher dans le bandeau (reste dans le fil d’actualité)"
                    aria-label={`Ne plus afficher « ${item.titre} » dans le bandeau`}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </span>
              )
            })}
          </div>
        )}
      </div>

      <button type="button" onClick={() => router.push(ACTUALITES_PATH)} style={styles.all}>
        Tout voir ›
      </button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    flex: '1 1 420px',
    minWidth: 0,
    display: 'flex',
    alignItems: 'stretch',
    height: 40,
    borderRadius: 10,
    border: '1px solid var(--cg-accent-border)',
    background: 'var(--cg-accent-bg)',
    overflow: 'hidden',
    pointerEvents: 'auto',
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '0 14px',
    border: 'none',
    borderRight: '1px solid var(--cg-accent-border)',
    background: 'transparent',
    color: 'var(--cg-accent)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  labelIcon: {
    display: 'inline-flex',
  },
  labelText: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    lineHeight: 1.15,
  },
  labelTitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
  },
  labelCount: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    color: 'rgba(var(--cg-ink-rgb), 0.6)',
  },
  viewport: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    overflow: 'hidden',
    maskImage: 'linear-gradient(90deg, transparent, #000 32px, #000 calc(100% - 32px), transparent)',
    WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 32px, #000 calc(100% - 32px), transparent)',
  },
  track: {
    paddingLeft: 24,
  },
  item: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    whiteSpace: 'nowrap',
  },
  itemButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 9,
    padding: '4px 2px',
    border: 'none',
    background: 'transparent',
    color: 'var(--cg-ink)',
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  },
  itemDate: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5,
    color: 'rgba(var(--cg-ink-rgb), 0.6)',
  },
  itemTag: {
    fontSize: 10.5,
    fontWeight: 700,
    borderRadius: 4,
    padding: '2px 7px',
  },
  itemTitle: {
    fontSize: 13.5,
  },
  dismiss: {
    width: 26,
    height: 26,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    border: '1px solid var(--cg-accent-border)',
    background: 'transparent',
    color: 'rgba(var(--cg-ink-rgb), 0.6)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  empty: {
    paddingLeft: 18,
    fontSize: 13,
    color: 'rgba(var(--cg-ink-rgb), 0.6)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  emptyLink: {
    border: 'none',
    background: 'transparent',
    padding: 0,
    color: 'var(--cg-accent)',
    fontSize: 13,
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  all: {
    padding: '0 14px',
    border: 'none',
    borderLeft: '1px solid var(--cg-accent-border)',
    background: 'transparent',
    color: 'var(--cg-accent)',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
}
