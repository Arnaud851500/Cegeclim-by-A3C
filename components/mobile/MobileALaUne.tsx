'use client'

// ============================================================================
// components/mobile/MobileALaUne.tsx — carte « À la une » de l'accueil mobile
// (14/10/2026)
// ----------------------------------------------------------------------------
// Équivalent téléphone du bandeau défilant du PC : les actualités publiées
// pour le mobile et encore « à afficher » (même règle que le bandeau :
// dans_bandeau) se feuillettent une à une (glisser, ou toucher les points).
//   - « Lire » / toucher l'actualité : ouvre la lecture dans le Compagnon ;
//   - « Ne plus afficher » : la retire de l'accueil (et du bandeau PC) pour
//     cet utilisateur ; elle reste lisible dans le fil d'actu.
// Rien à afficher : une fine ligne « Fil d'actu · à jour ».
// Fil indisponible (script SQL absent, réseau) : rien n'est affiché.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { useRouter } from 'next/navigation'
import { ouvrirActualitesMobile } from '@/components/mobile/MobileFilActu'
import {
  ACTUALITES_CHANGED_EVENT,
  categoryTone,
  fetchFlux,
  formatDateCourte,
  marquerActualites,
  resumeOf,
  type Actualite,
} from '@/lib/actualites'

const MAX_UNE = 5
const REFRESH_MS = 5 * 60 * 1000

function MegaphoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" />
      <path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" />
    </svg>
  )
}

export default function MobileALaUne() {
  const router = useRouter()
  const [items, setItems] = useState<Actualite[]>([])
  const [loaded, setLoaded] = useState(false)
  const [available, setAvailable] = useState(true)
  const [index, setIndex] = useState(0)
  const trackRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    try {
      const rows = await fetchFlux({ type: 'actualite', plateforme: 'mobile' })
      setItems(rows.filter((row) => row.dans_bandeau).slice(0, MAX_UNE))
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
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    window.addEventListener(ACTUALITES_CHANGED_EVENT, onChange)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener(ACTUALITES_CHANGED_EVENT, onChange)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const current = Math.min(index, Math.max(0, items.length - 1))

  const goTo = (i: number) => {
    const track = trackRef.current
    if (track) track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' })
    setIndex(i)
  }

  const onScroll = () => {
    const track = trackRef.current
    if (!track || track.clientWidth === 0) return
    const i = Math.round(track.scrollLeft / track.clientWidth)
    if (i !== index) setIndex(i)
  }

  const open = (id?: string) => ouvrirActualitesMobile({ id, onglet: 'actualite' }, (href) => router.push(href))

  const hide = (item: Actualite) => {
    setItems((list) => list.filter((row) => row.id !== item.id))
    setIndex((i) => Math.max(0, Math.min(i, items.length - 2)))
    void marquerActualites([item.id], { lu: null, masque: true }).catch(() => {})
  }

  if (!loaded || !available) return null

  if (items.length === 0) {
    return (
      <button type="button" onClick={() => open()} style={styles.slim}>
        <span style={styles.kickerIcon}><MegaphoneIcon /></span>
        <span style={styles.kicker}>Fil d’actu</span>
        <span style={styles.slimText}>à jour</span>
        <span style={styles.slimLink}>Ouvrir ›</span>
      </button>
    )
  }

  return (
    <section aria-label="À la une" style={styles.card}>
      <div style={styles.head}>
        <span style={styles.kickerIcon}><MegaphoneIcon /></span>
        <span style={styles.kicker}>À la une</span>
        {items.length > 1 ? <span style={styles.position}>{current + 1} / {items.length}</span> : null}
        <button type="button" onClick={() => open()} style={styles.allLink}>Tout le fil ›</button>
      </div>

      <div ref={trackRef} onScroll={onScroll} style={styles.track}>
        {items.map((item) => {
          const tone = categoryTone(item.categorie, 'dark')
          return (
            <button key={item.id} type="button" onClick={() => open(item.id)} style={styles.slide}>
              <span style={styles.meta}>
                {item.categorie ? <span style={{ ...styles.tag, background: tone.bg, color: tone.fg }}>{item.categorie}</span> : null}
                <span>Diffusé le {formatDateCourte(item.date_diffusion)}</span>
                {!item.lu ? <span style={styles.unread}>● Nouveau</span> : null}
              </span>
              <span style={styles.title}>{item.titre}</span>
              <span style={styles.resume}>{resumeOf(item, 110)}</span>
            </button>
          )
        })}
      </div>

      <div style={styles.footer}>
        {items.length > 1
          ? items.map((item, i) => (
              <button key={item.id} type="button" onClick={() => goTo(i)} aria-label={`Actualité ${i + 1}`} style={styles.dotButton}>
                <span style={{ ...styles.dot, ...(i === current ? styles.dotActive : {}) }} />
              </button>
            ))
          : null}
        <button type="button" onClick={() => hide(items[current])} style={styles.secondary}>
          Ne plus afficher
        </button>
        <button type="button" onClick={() => open(items[current].id)} style={styles.primary}>
          Lire
        </button>
      </div>
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    margin: '0 4px',
    padding: '12px 0 12px',
    borderRadius: 18,
    border: '1px solid #2B3A55',
    background: '#111B2D',
    color: '#fff',
    fontFamily: 'var(--font-body)',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 14px',
  },
  kickerIcon: {
    display: 'inline-flex',
    color: '#7FB3FF',
  },
  kicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: '#7FB3FF',
  },
  position: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
  },
  allLink: {
    marginLeft: 'auto',
    minHeight: 36,
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: '#7FB3FF',
    fontSize: 12.5,
    fontWeight: 600,
  },
  track: {
    display: 'flex',
    overflowX: 'auto',
    scrollSnapType: 'x mandatory',
    scrollbarWidth: 'none',
    WebkitOverflowScrolling: 'touch',
  },
  slide: {
    flex: '0 0 100%',
    scrollSnapAlign: 'start',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 5,
    padding: '6px 14px 4px',
    border: 'none',
    background: 'transparent',
    color: '#fff',
    textAlign: 'left',
    fontFamily: 'inherit',
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.65)',
  },
  tag: {
    fontFamily: 'var(--font-body)',
    fontSize: 10.5,
    fontWeight: 700,
    borderRadius: 4,
    padding: '2px 7px',
  },
  unread: {
    color: '#7FB3FF',
    fontWeight: 600,
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.3,
  },
  resume: {
    fontSize: 13,
    lineHeight: 1.45,
    color: 'rgba(255,255,255,0.72)',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: '6px 14px 0',
  },
  dotButton: {
    width: 24,
    height: 32,
    padding: 0,
    border: 'none',
    background: 'transparent',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    background: 'rgba(255,255,255,0.3)',
    transition: 'width 0.15s ease',
  },
  dotActive: {
    width: 18,
    background: '#7FB3FF',
  },
  secondary: {
    marginLeft: 'auto',
    minHeight: 38,
    padding: '0 12px',
    borderRadius: 9,
    border: '1px solid #2B3A55',
    background: 'transparent',
    color: 'rgba(255,255,255,0.82)',
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: 600,
  },
  primary: {
    marginLeft: 8,
    minHeight: 38,
    padding: '0 16px',
    borderRadius: 9,
    border: 'none',
    background: '#7FB3FF',
    color: '#0B1220',
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: 700,
  },
  slim: {
    margin: '0 4px',
    minHeight: 44,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 14px',
    borderRadius: 12,
    border: '1px solid #2B3A55',
    background: '#111B2D',
    color: '#fff',
    fontFamily: 'var(--font-body)',
    textAlign: 'left',
  },
  slimText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  slimLink: {
    marginLeft: 'auto',
    color: '#7FB3FF',
    fontSize: 13,
    fontWeight: 600,
  },
}
