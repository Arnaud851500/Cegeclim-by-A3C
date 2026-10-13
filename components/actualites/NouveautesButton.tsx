'use client'

// ============================================================================
// components/actualites/NouveautesButton.tsx — « Nouveau dans votre compagnon »
// ----------------------------------------------------------------------------
// Icône en haut à droite du bandeau (13/10/2026). Elle clignote tant qu'il
// reste des nouveautés non lues ; un clic ouvre une fenêtre flottante listant
// toutes les nouveautés de l'application (publications de type « nouveauté »,
// rédigées avec l'éditeur du fil d'actualité). À l'ouverture, les nouveautés
// sont marquées lues : l'icône s'arrête de clignoter, le repère « Nouveau »
// reste visible jusqu'à la fermeture de la fenêtre.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import ActualiteContent from '@/components/actualites/ActualiteContent'
import {
  ACTUALITES_CHANGED_EVENT,
  ACTUALITES_EDIT_PATH,
  ACTUALITES_PATH,
  fetchFlux,
  formatDateLongue,
  marquerActualites,
  usePeutPublier,
  type Actualite,
} from '@/lib/actualites'

const REFRESH_MS = 10 * 60 * 1000

function SparkIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.8 4.6L18.5 9.5l-4.7 1.9L12 16l-1.8-4.6L5.5 9.5l4.7-1.9z" />
      <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </svg>
  )
}

export default function NouveautesButton() {
  const router = useRouter()
  const { peutPublier } = usePeutPublier()
  const [items, setItems] = useState<Actualite[]>([])
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [available, setAvailable] = useState(true)
  // Nouveautés non lues au moment de l'ouverture : gardent le repère « Nouveau ».
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const closeRef = useRef<HTMLButtonElement | null>(null)

  const load = useCallback(async () => {
    try {
      const rows = await fetchFlux({ type: 'nouveaute' })
      setItems(rows)
      setAvailable(true)
    } catch {
      setAvailable(false)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
    const interval = window.setInterval(() => void load(), REFRESH_MS)
    const onChange = () => void load()
    window.addEventListener(ACTUALITES_CHANGED_EVENT, onChange)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener(ACTUALITES_CHANGED_EVENT, onChange)
    }
  }, [load])

  const unread = items.filter((item) => !item.lu)

  const openWindow = useCallback(() => {
    const unreadIds = items.filter((item) => !item.lu).map((item) => item.id)
    setFreshIds(new Set(unreadIds))
    // Déplie les nouveautés non lues (ou la plus récente s'il n'y en a pas).
    setExpanded(new Set(unreadIds.length > 0 ? unreadIds : items.slice(0, 1).map((item) => item.id)))
    setOpen(true)
    if (unreadIds.length > 0) {
      setItems((current) => current.map((item) => (unreadIds.includes(item.id) ? { ...item, lu: true } : item)))
      void marquerActualites(unreadIds, { lu: true }).catch(() => {})
    }
  }, [items])

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Rien à montrer (tables absentes ou aucune nouveauté) et pas rédacteur : pas d'icône.
  if (!loaded || (!available && !peutPublier) || (items.length === 0 && !peutPublier)) return null

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const go = (path: string) => {
    setOpen(false)
    router.push(path)
  }

  return (
    <>
      <button
        type="button"
        onClick={openWindow}
        className={unread.length > 0 ? 'cgcNewsPulse' : undefined}
        style={{ ...styles.trigger, ...(unread.length > 0 ? styles.triggerActive : {}) }}
        title={unread.length > 0 ? `${unread.length} nouveauté${unread.length > 1 ? 's' : ''} dans votre compagnon` : 'Nouveautés de votre compagnon'}
        aria-haspopup="dialog"
      >
        <SparkIcon />
        <span style={styles.triggerText}>Nouveau dans votre compagnon</span>
        {unread.length > 0 ? <span style={styles.triggerBadge}>{unread.length}</span> : null}
      </button>

      {open
        ? createPortal(
            <div style={styles.backdrop} onClick={() => setOpen(false)} role="presentation">
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Nouveau dans votre compagnon"
                style={styles.dialog}
                onClick={(event) => event.stopPropagation()}
              >
                <div style={styles.header}>
                  <span style={styles.headerIcon}><SparkIcon size={22} /></span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={styles.title}>Nouveau dans votre compagnon</div>
                    <div style={styles.subtitle}>
                      {items.length === 0
                        ? 'Aucune nouveauté publiée pour le moment.'
                        : `${items.length} nouveauté${items.length > 1 ? 's' : ''}, de la plus récente à la plus ancienne.`}
                    </div>
                  </div>
                  <button ref={closeRef} type="button" onClick={() => setOpen(false)} style={styles.close} aria-label="Fermer">✕</button>
                </div>

                <div style={styles.body}>
                  {items.map((item) => {
                    const isOpen = expanded.has(item.id)
                    return (
                      <article key={item.id} style={{ ...styles.card, ...(freshIds.has(item.id) ? styles.cardFresh : {}) }}>
                        <button type="button" onClick={() => toggle(item.id)} style={styles.cardHead} aria-expanded={isOpen}>
                          <span style={styles.cardMeta}>
                            {freshIds.has(item.id) ? <span style={styles.freshTag}>Nouveau</span> : null}
                            {item.categorie ? <span style={styles.cardCategory}>{item.categorie}</span> : null}
                            <span>{formatDateLongue(item.date_diffusion)}</span>
                          </span>
                          <span style={styles.cardTitle}>{item.titre}</span>
                          {!isOpen && item.resume ? <span style={styles.cardResume}>{item.resume}</span> : null}
                          <span style={styles.cardToggle} aria-hidden="true">{isOpen ? '−' : '+'}</span>
                        </button>
                        {isOpen ? (
                          <div style={styles.cardBody}>
                            <ActualiteContent blocks={item.contenu} compact />
                          </div>
                        ) : null}
                      </article>
                    )
                  })}
                </div>

                <div style={styles.footer}>
                  <button type="button" onClick={() => go(`${ACTUALITES_PATH}?type=nouveaute`)} style={styles.footerLink}>
                    Voir dans le fil d’actualité ›
                  </button>
                  {peutPublier ? (
                    <button type="button" onClick={() => go(`${ACTUALITES_EDIT_PATH}?type=nouveaute`)} style={styles.footerPrimary}>
                      + Ajouter une nouveauté
                    </button>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '6px 11px',
    borderRadius: 999,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.16)',
    background: 'rgba(var(--cg-ink-rgb), 0.04)',
    color: 'rgba(var(--cg-ink-rgb), 0.78)',
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  triggerActive: {
    border: '1px solid rgba(193,104,60,0.7)',
    background: 'rgba(193,104,60,0.16)',
    color: 'var(--cg-ink)',
  },
  triggerText: {
    lineHeight: 1,
  },
  triggerBadge: {
    minWidth: 20,
    height: 20,
    padding: '0 6px',
    borderRadius: 999,
    background: '#A9542C',
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 1200,
    background: 'rgba(var(--cg-backdrop-rgb), calc(0.62 * var(--cg-backdrop-k)))',
    backdropFilter: 'blur(3px)',
    WebkitBackdropFilter: 'blur(3px)',
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    padding: '72px 22px 22px',
  },
  dialog: {
    width: 'min(560px, 100%)',
    maxHeight: 'calc(100vh - 100px)',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 20,
    overflow: 'hidden',
    background: 'var(--cg-surface)',
    border: '1px solid rgba(193,104,60,0.4)',
    boxShadow: '0 28px 70px rgba(0,0,0,calc(0.5 * var(--cg-shadow-k)))',
    color: 'var(--cg-ink)',
    fontFamily: 'var(--font-body)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '16px 18px',
    borderBottom: '1px solid rgba(var(--cg-ink-rgb), 0.10)',
    background: 'linear-gradient(180deg, rgba(193,104,60,0.16), rgba(193,104,60,0.04))',
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    background: 'rgba(193,104,60,0.22)',
    color: '#C1683C',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 19,
    fontWeight: 700,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 13,
    color: 'rgba(var(--cg-ink-rgb), 0.62)',
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 10,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.16)',
    background: 'transparent',
    color: 'rgba(var(--cg-ink-rgb), 0.75)',
    cursor: 'pointer',
    fontSize: 15,
    flexShrink: 0,
  },
  body: {
    padding: 14,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  card: {
    borderRadius: 14,
    border: '1px solid rgba(var(--cg-ink-rgb), 0.10)',
    background: 'rgba(var(--cg-ink-rgb), 0.03)',
  },
  cardFresh: {
    border: '1px solid rgba(193,104,60,0.45)',
    background: 'rgba(193,104,60,0.07)',
  },
  cardHead: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
    width: '100%',
    padding: '12px 44px 12px 14px',
    border: 'none',
    background: 'transparent',
    color: 'var(--cg-ink)',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  cardMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5,
    color: 'rgba(var(--cg-ink-rgb), 0.6)',
  },
  freshTag: {
    fontFamily: 'var(--font-body)',
    fontSize: 10.5,
    fontWeight: 700,
    color: '#ffffff',
    background: '#A9542C',
    borderRadius: 4,
    padding: '2px 7px',
  },
  cardCategory: {
    fontFamily: 'var(--font-body)',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--cg-accent)',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.3,
  },
  cardResume: {
    fontSize: 13.5,
    lineHeight: 1.45,
    color: 'rgba(var(--cg-ink-rgb), 0.68)',
  },
  cardToggle: {
    position: 'absolute',
    top: 12,
    right: 14,
    fontSize: 20,
    lineHeight: 1,
    color: 'rgba(var(--cg-ink-rgb), 0.5)',
  },
  cardBody: {
    padding: '0 16px 6px',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: '12px 16px',
    borderTop: '1px solid rgba(var(--cg-ink-rgb), 0.10)',
  },
  footerLink: {
    border: 'none',
    background: 'transparent',
    color: 'var(--cg-accent)',
    fontSize: 13.5,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '8px 0',
  },
  footerPrimary: {
    border: 'none',
    borderRadius: 9,
    background: '#A9542C',
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '9px 14px',
  },
}
