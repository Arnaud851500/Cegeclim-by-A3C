'use client'

// ============================================================================
// components/mobile/MobileNouveautes.tsx — « Nouveau dans votre compagnon »
// sur le téléphone (14/10/2026)
// ----------------------------------------------------------------------------
// Icône dans la barre du haut (MobileBrandBar), à côté de « Déconnexion » :
// elle clignote avec le nombre de nouveautés non lues. Le toucher ouvre un
// panneau qui monte du bas de l'écran (même style que « Voix & lecture »).
//
// Ouverture automatique : à l'ouverture du Compagnon, s'il existe des
// nouveautés mobiles non lues, le panneau s'ouvre tout seul, une fois.
// Ouvrir le panneau les marque lues : il ne se rouvrira donc qu'à la
// prochaine publication. Pas d'ouverture automatique sur PC.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import ActualiteContent from '@/components/actualites/ActualiteContent'
import { ouvrirActualitesMobile } from '@/components/mobile/MobileFilActu'
import {
  ACTUALITES_CHANGED_EVENT,
  fetchFlux,
  formatDateLongue,
  marquerActualites,
  type Actualite,
} from '@/lib/actualites'

const REFRESH_MS = 10 * 60 * 1000
const AUTO_KEY = 'cegeclim.nouveautes.autoOuvert'

function SparkIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.8 4.6 4.7 1.9-4.7 1.9L12 16l-1.8-4.6-4.7-1.9 4.7-1.9z" />
      <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </svg>
  )
}

function dejaOuvertAutomatiquement(ids: string[]) {
  try {
    const vus = new Set((window.sessionStorage.getItem(AUTO_KEY) || '').split(',').filter(Boolean))
    return ids.every((id) => vus.has(id))
  } catch {
    return false
  }
}

function noterOuvertureAutomatique(ids: string[]) {
  try {
    const vus = new Set((window.sessionStorage.getItem(AUTO_KEY) || '').split(',').filter(Boolean))
    ids.forEach((id) => vus.add(id))
    window.sessionStorage.setItem(AUTO_KEY, [...vus].join(','))
  } catch {
    // stockage indisponible : l'ouverture marque de toute façon les nouveautés lues
  }
}

export default function MobileNouveautes() {
  const router = useRouter()
  const [items, setItems] = useState<Actualite[]>([])
  const [open, setOpen] = useState(false)
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const autoTente = useRef(false)

  const openSheet = useCallback((rows: Actualite[]) => {
    const unreadIds = rows.filter((row) => !row.lu).map((row) => row.id)
    setFreshIds(new Set(unreadIds))
    setExpanded(new Set(unreadIds.length > 0 ? unreadIds.slice(0, 1) : rows.slice(0, 1).map((row) => row.id)))
    setOpen(true)
    if (unreadIds.length > 0) {
      setItems((current) => current.map((row) => (unreadIds.includes(row.id) ? { ...row, lu: true } : row)))
      void marquerActualites(unreadIds, { lu: true }).catch(() => {})
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const rows = await fetchFlux({ type: 'nouveaute', plateforme: 'mobile' })
      setItems(rows)
      // Ouverture automatique : une fois, au premier chargement, s'il y a du nouveau.
      if (!autoTente.current) {
        autoTente.current = true
        const unreadIds = rows.filter((row) => !row.lu).map((row) => row.id)
        if (unreadIds.length > 0 && !dejaOuvertAutomatiquement(unreadIds)) {
          noterOuvertureAutomatique(unreadIds)
          window.setTimeout(() => openSheet(rows), 600)
        }
      }
    } catch {
      setItems([])
    }
  }, [openSheet])

  useEffect(() => {
    // Chargement asynchrone : les setState ont lieu après la réponse réseau.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    const interval = window.setInterval(() => void load(), REFRESH_MS)
    const onChange = () => void load()
    window.addEventListener(ACTUALITES_CHANGED_EVENT, onChange)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener(ACTUALITES_CHANGED_EVENT, onChange)
    }
  }, [load])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (items.length === 0) return null

  const unread = items.filter((row) => !row.lu).length

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const voirFil = () => {
    setOpen(false)
    ouvrirActualitesMobile({ onglet: 'nouveaute' }, (href) => router.push(href))
  }

  return (
    <>
      <button
        type="button"
        onClick={() => openSheet(items)}
        className={unread > 0 ? 'cgcNewsPulse' : undefined}
        aria-label={unread > 0 ? `Nouveau dans votre compagnon : ${unread} nouveauté${unread > 1 ? 's' : ''}` : 'Nouveautés de votre compagnon'}
        style={{ ...styles.trigger, ...(unread > 0 ? styles.triggerActive : {}) }}
      >
        <SparkIcon />
        {unread > 0 ? <span style={styles.badge}>{unread}</span> : null}
      </button>

      {open
        ? createPortal(
            <div style={styles.backdrop} onClick={() => setOpen(false)} role="presentation">
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Nouveau dans votre compagnon"
                style={styles.sheet}
                onClick={(event) => event.stopPropagation()}
              >
                <div style={styles.handle} aria-hidden="true" />
                <div style={styles.header}>
                  <span style={styles.headerIcon}><SparkIcon size={20} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.title}>Nouveau dans votre compagnon</div>
                    <div style={styles.subtitle}>
                      {items.length} nouveauté{items.length > 1 ? 's' : ''}, la plus récente en premier
                    </div>
                  </div>
                  <button type="button" onClick={() => setOpen(false)} style={styles.close} aria-label="Fermer">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>

                <div style={styles.body}>
                  {items.map((item) => {
                    const isOpen = expanded.has(item.id)
                    const fresh = freshIds.has(item.id)
                    return (
                      <article key={item.id} style={{ ...styles.card, ...(fresh ? styles.cardFresh : {}) }}>
                        <button type="button" onClick={() => toggle(item.id)} aria-expanded={isOpen} style={styles.cardHead}>
                          <span style={styles.cardMeta}>
                            {fresh ? <span style={styles.freshTag}>Nouveau</span> : null}
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
                  <button type="button" onClick={voirFil} style={styles.filLink}>
                    Voir dans le fil d’actu ›
                  </button>
                </div>

                <div style={styles.footer}>
                  <button type="button" onClick={() => setOpen(false)} style={styles.ok}>
                    J’ai compris
                  </button>
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
    position: 'relative',
    flexShrink: 0,
    width: 40,
    height: 34,
    borderRadius: 9,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.8)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerActive: {
    border: '1px solid rgba(193,104,60,0.75)',
    background: 'rgba(193,104,60,0.2)',
    color: '#fff',
  },
  badge: {
    position: 'absolute',
    top: -7,
    right: -7,
    minWidth: 18,
    height: 18,
    padding: '0 5px',
    boxSizing: 'border-box',
    borderRadius: 999,
    background: '#A9542C',
    color: '#fff',
    fontSize: 10.5,
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 2300,
    background: 'rgba(6,10,18,0.72)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '86dvh',
    display: 'flex',
    flexDirection: 'column',
    background: '#141A26',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    border: '1px solid rgba(193,104,60,0.45)',
    borderBottom: 'none',
    color: '#fff',
    fontFamily: 'var(--font-body)',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    background: 'rgba(255,255,255,0.25)',
    margin: '10px auto 4px',
    flexShrink: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 16px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    background: 'rgba(193,104,60,0.25)',
    color: '#F0B08F',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    fontWeight: 700,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.62)',
  },
  close: {
    width: 44,
    height: 44,
    flexShrink: 0,
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.8)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 12px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    WebkitOverflowScrolling: 'touch',
  },
  card: {
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.03)',
  },
  cardFresh: {
    border: '1px solid rgba(193,104,60,0.5)',
    background: 'rgba(193,104,60,0.10)',
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
    color: '#fff',
    textAlign: 'left',
    fontFamily: 'inherit',
  },
  cardMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.62)',
  },
  freshTag: {
    fontFamily: 'var(--font-body)',
    fontSize: 10.5,
    fontWeight: 700,
    color: '#fff',
    background: '#A9542C',
    borderRadius: 4,
    padding: '2px 7px',
  },
  cardTitle: {
    fontSize: 15.5,
    fontWeight: 700,
    lineHeight: 1.3,
  },
  cardResume: {
    fontSize: 13,
    lineHeight: 1.45,
    color: 'rgba(255,255,255,0.68)',
  },
  cardToggle: {
    position: 'absolute',
    top: 12,
    right: 14,
    fontSize: 20,
    lineHeight: 1,
    color: 'rgba(255,255,255,0.5)',
  },
  cardBody: {
    padding: '0 14px 8px',
  },
  filLink: {
    alignSelf: 'flex-start',
    minHeight: 40,
    padding: '0 4px',
    border: 'none',
    background: 'transparent',
    color: '#7FB3FF',
    fontFamily: 'inherit',
    fontSize: 13.5,
    fontWeight: 600,
  },
  footer: {
    padding: '10px 16px calc(16px + env(safe-area-inset-bottom))',
    borderTop: '1px solid rgba(255,255,255,0.08)',
  },
  ok: {
    width: '100%',
    minHeight: 48,
    borderRadius: 12,
    border: 'none',
    background: '#fff',
    color: '#0B1220',
    fontFamily: 'inherit',
    fontSize: 15,
    fontWeight: 700,
  },
}
