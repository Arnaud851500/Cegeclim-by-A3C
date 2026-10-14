'use client'

// ============================================================================
// components/mobile/MobileFilActu.tsx — Fil d'actu dans le Compagnon (14/10/2026)
// ----------------------------------------------------------------------------
// Version téléphone de l'écran /actualites, en lecture seule (la publication
// reste sur PC) :
//   - MobileFilActu          : liste (onglets Actualités / Nouveautés,
//                              recherche, catégories à faire glisser) ;
//   - MobileActualiteLecture : lecture d'une publication, bouton bas d'écran
//                              « Ne plus afficher sur l'accueil » ;
//   - MobileActualitesStandalone : les deux avec leur propre retour, utilisé
//                              par app/actualites/page.tsx quand la page est
//                              ouverte directement sur un téléphone.
// Dans le Compagnon, la navigation passe par la pile de MobileShell : la
// liste et chaque lecture sont des entrées de pile (écran 'actualites'), donc
// « ← Retour » et le retour du téléphone fonctionnent comme ailleurs.
// ouvrirActualitesMobile() est le point d'entrée commun (carte « À la une »,
// fenêtre des nouveautés dans la barre du haut).
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import ActualiteContent from '@/components/actualites/ActualiteContent'
import {
  ACTUALITES_CHANGED_EVENT,
  ACTUALITES_PATH,
  categoryTone,
  fetchActualite,
  fetchFlux,
  formatDateDiffusion,
  formatDateLongue,
  marquerActualites,
  resumeOf,
  tempsLecture,
  type Actualite,
  type ActualiteType,
} from '@/lib/actualites'

// ── Navigation commune ──────────────────────────────────────────────────────
export const MOBILE_OPEN_ACTUALITES_EVENT = 'cegeclim:mobile-open-actualites'
export type MobileOpenActualitesDetail = { id?: string; onglet?: ActualiteType }

declare global {
  interface Window {
    /** Posé par MobileShell quand il est monté : il prend en charge l'ouverture. */
    __cgcMobileShellActualites?: boolean
  }
}

/** Ouvre le fil d'actu (ou une publication) dans le Compagnon ; à défaut
 * (MobileShell non monté), bascule sur la page /actualites. */
export function ouvrirActualitesMobile(detail: MobileOpenActualitesDetail, push: (href: string) => void) {
  if (typeof window !== 'undefined' && window.__cgcMobileShellActualites) {
    window.dispatchEvent(new CustomEvent<MobileOpenActualitesDetail>(MOBILE_OPEN_ACTUALITES_EVENT, { detail }))
    return
  }
  const params = new URLSearchParams()
  if (detail.id) params.set('id', detail.id)
  if (detail.onglet) params.set('type', detail.onglet)
  const qs = params.toString()
  push(`${ACTUALITES_PATH}${qs ? `?${qs}` : ''}`)
}

// ── Liste ───────────────────────────────────────────────────────────────────
export function MobileFilActu({
  initialTab = 'actualite',
  onOpenItem,
}: {
  initialTab?: ActualiteType
  onOpenItem: (id: string) => void
}) {
  const [tab, setTab] = useState<ActualiteType>(initialTab)
  const [items, setItems] = useState<Actualite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categorie, setCategorie] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setItems(await fetchFlux({ plateforme: 'mobile' }))
      setError(null)
    } catch (err) {
      setError(`Chargement impossible : ${(err as Error)?.message || err}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const onChange = () => void load()
    window.addEventListener(ACTUALITES_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(ACTUALITES_CHANGED_EVENT, onChange)
  }, [load])

  const counts = useMemo(
    () => ({
      actualite: items.filter((i) => i.type === 'actualite' && !i.lu).length,
      nouveaute: items.filter((i) => i.type === 'nouveaute' && !i.lu).length,
    }),
    [items]
  )

  const categories = useMemo(
    () => [...new Set(items.filter((i) => i.type === tab && i.categorie).map((i) => i.categorie as string))],
    [items, tab]
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (item.type !== tab) return false
      if (categorie && item.categorie !== categorie) return false
      if (!q) return true
      return `${item.titre} ${item.categorie || ''} ${resumeOf(item, 2000)}`.toLowerCase().includes(q)
    })
  }, [items, tab, categorie, search])

  return (
    <div style={styles.screen}>
      <div role="tablist" aria-label="Type de publication" style={styles.tabs}>
        {(['actualite', 'nouveaute'] as ActualiteType[]).map((value) => {
          const active = tab === value
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setTab(value)
                setCategorie(null)
              }}
              style={{ ...styles.tab, ...(active ? styles.tabActive : {}) }}
            >
              {value === 'actualite' ? 'Actualités' : 'Nouveautés'}
              {counts[value] > 0 ? <span style={styles.tabBadge}>{counts[value]}</span> : null}
            </button>
          )
        })}
      </div>

      <label style={{ display: 'block' }}>
        <span style={styles.srOnly}>Rechercher</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher : référence, opération…"
          style={styles.search}
        />
      </label>

      {categories.length > 0 ? (
        <div style={styles.chips}>
          <button type="button" onClick={() => setCategorie(null)} style={{ ...styles.chip, ...(categorie === null ? styles.chipAll : styles.chipIdle) }}>
            Toutes
          </button>
          {categories.map((c) => {
            const tone = categoryTone(c, 'dark')
            const active = categorie === c
            return (
              <button
                key={c}
                type="button"
                aria-pressed={active}
                onClick={() => setCategorie(active ? null : c)}
                style={{ ...styles.chip, background: tone.bg, color: tone.fg, ...(active ? styles.chipPicked : {}) }}
              >
                {c}
              </button>
            )
          })}
        </div>
      ) : null}

      <div style={styles.list}>
        {loading ? <div style={styles.muted}>Chargement…</div> : null}
        {!loading && error ? <div style={styles.error}>{error}</div> : null}
        {!loading && !error && visible.length === 0 ? (
          <div style={styles.muted}>{search || categorie ? 'Aucune publication ne correspond.' : 'Aucune publication pour le moment.'}</div>
        ) : null}
        {visible.map((item) => {
          const tone = categoryTone(item.categorie, 'dark')
          return (
            <button key={item.id} type="button" onClick={() => onOpenItem(item.id)} style={styles.item}>
              <span style={styles.itemMeta}>
                {item.categorie ? <span style={{ ...styles.tag, background: tone.bg, color: tone.fg }}>{item.categorie}</span> : null}
                <span>Diffusé le {formatDateDiffusion(item.date_diffusion)}</span>
                {!item.lu ? <span style={styles.unread}>● Non lu</span> : null}
              </span>
              <span style={{ ...styles.itemTitle, fontWeight: item.lu ? 600 : 700 }}>{item.titre}</span>
              <span style={styles.itemResume}>{resumeOf(item, 120)}</span>
              {item.type === 'actualite' && item.masque_bandeau ? <span style={styles.itemFlag}>Masquée de l’accueil</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Lecture ─────────────────────────────────────────────────────────────────
export function MobileActualiteLecture({ id }: { id: string }) {
  const [item, setItem] = useState<Actualite | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await fetchFlux({ plateforme: 'mobile' })
        const found = rows.find((row) => row.id === id) || (await fetchActualite(id))
        if (cancelled) return
        setItem(found)
        if (found && !found.lu && found.statut === 'publie') {
          void marquerActualites([found.id], { lu: true }).catch(() => {})
        }
      } catch {
        if (!cancelled) setItem(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const toggleAccueil = async () => {
    if (!item) return
    const masque = !item.masque_bandeau
    setItem({ ...item, masque_bandeau: masque })
    try {
      await marquerActualites([item.id], { lu: null, masque })
    } catch {
      setItem({ ...item, masque_bandeau: !masque })
    }
  }

  if (loading) return <div style={{ ...styles.screen, ...styles.muted }}>Chargement…</div>
  if (!item) return <div style={{ ...styles.screen, ...styles.muted }}>Cette publication n’est plus disponible.</div>

  const tone = categoryTone(item.categorie, 'dark')
  const peutMasquer = item.type === 'actualite' && item.statut === 'publie'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <article style={styles.article}>
        <div style={styles.itemMeta}>
          {item.categorie ? <span style={{ ...styles.tag, background: tone.bg, color: tone.fg }}>{item.categorie}</span> : null}
          <span>Diffusé le {formatDateLongue(item.date_diffusion)}</span>
        </div>
        <h1 style={styles.h1}>{item.titre}</h1>
        <div style={styles.byline}>
          {item.auteur_nom || item.auteur_email || '—'} · lecture {tempsLecture(item)}
        </div>
        {item.contenu.length > 0 ? (
          <ActualiteContent blocks={item.contenu} style={{ fontSize: 16.5, lineHeight: 1.65 }} />
        ) : (
          <p style={styles.muted}>Cette publication n’a pas encore de contenu.</p>
        )}
      </article>

      {peutMasquer ? (
        <div style={styles.actionBar}>
          <button type="button" onClick={() => void toggleAccueil()} style={styles.actionButton}>
            {item.masque_bandeau ? 'Réafficher sur l’accueil' : 'Ne plus afficher sur l’accueil'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

// ── Page /actualites ouverte sur un téléphone ───────────────────────────────
export function MobileActualitesStandalone({
  initialId,
  initialTab,
  onExit,
}: {
  initialId?: string | null
  initialTab?: ActualiteType
  onExit: () => void
}) {
  const [openId, setOpenId] = useState<string | null>(initialId || null)

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: '#0B1220', color: '#fff' }}>
      <div style={styles.topBar}>
        <button type="button" onClick={() => (openId ? setOpenId(null) : onExit())} style={styles.topButton}>
          {openId ? '← Retour' : '← Menu'}
        </button>
        <span style={styles.topTitle}>Fil d’actu</span>
      </div>
      {openId ? (
        <MobileActualiteLecture key={openId} id={openId} />
      ) : (
        <MobileFilActu initialTab={initialTab} onOpenItem={setOpenId} />
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  screen: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '14px 3px 24px',
    color: '#fff',
    fontFamily: 'var(--font-body)',
  },
  tabs: {
    display: 'flex',
    padding: 4,
    borderRadius: 12,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  tab: {
    flex: 1,
    minHeight: 42,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    border: 'none',
    borderRadius: 9,
    background: 'transparent',
    color: 'rgba(255,255,255,0.75)',
    fontFamily: 'inherit',
    fontSize: 14.5,
    fontWeight: 600,
  },
  tabActive: {
    background: '#fff',
    color: '#0B1220',
  },
  tabBadge: {
    minWidth: 20,
    height: 20,
    padding: '0 6px',
    boxSizing: 'border-box',
    borderRadius: 999,
    background: '#A9542C',
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
  },
  search: {
    width: '100%',
    boxSizing: 'border-box',
    height: 44,
    padding: '0 12px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(255,255,255,0.04)',
    color: '#fff',
    fontFamily: 'inherit',
    fontSize: 16,
  },
  chips: {
    display: 'flex',
    gap: 6,
    overflowX: 'auto',
    paddingBottom: 2,
    scrollbarWidth: 'none',
  },
  chip: {
    flex: '0 0 auto',
    minHeight: 34,
    padding: '0 13px',
    borderRadius: 999,
    border: '2px solid transparent',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600,
  },
  chipAll: {
    background: '#fff',
    color: '#0B1220',
  },
  chipIdle: {
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
  },
  chipPicked: {
    borderColor: '#fff',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    marginTop: 2,
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 6,
    width: '100%',
    padding: '13px 14px',
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.035)',
    color: '#fff',
    textAlign: 'left',
    fontFamily: 'inherit',
  },
  itemMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.62)',
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
  itemTitle: {
    fontSize: 15.5,
    lineHeight: 1.35,
  },
  itemResume: {
    fontSize: 13,
    lineHeight: 1.45,
    color: 'rgba(255,255,255,0.68)',
  },
  itemFlag: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
  },
  muted: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    padding: '12px 4px',
  },
  error: {
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid #5C2A2E',
    background: '#2A1619',
    color: '#E4C7C9',
    fontSize: 13.5,
  },
  article: {
    flex: 1,
    padding: '16px 6px 24px',
    color: '#fff',
    fontFamily: 'var(--font-body)',
  },
  h1: {
    margin: '12px 0 6px',
    fontFamily: 'var(--font-display)',
    fontSize: 24,
    fontWeight: 700,
    lineHeight: 1.2,
  },
  byline: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.62)',
    paddingBottom: 14,
    marginBottom: 16,
    borderBottom: '1px solid rgba(255,255,255,0.10)',
  },
  actionBar: {
    position: 'sticky',
    bottom: 0,
    padding: '10px 3px calc(14px + env(safe-area-inset-bottom))',
    background: 'linear-gradient(rgba(11,18,32,0), #0B1220 30%)',
  },
  actionButton: {
    width: '100%',
    minHeight: 48,
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.2)',
    background: '#0B1220',
    color: '#fff',
    fontFamily: 'inherit',
    fontSize: 15,
    fontWeight: 600,
  },
  topBar: {
    position: 'sticky',
    top: 0,
    zIndex: 20,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    background: 'rgba(11,18,32,0.96)',
    borderBottom: '1px solid rgba(255,255,255,0.10)',
  },
  topButton: {
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'transparent',
    color: '#fff',
    borderRadius: 12,
    padding: '12px 16px',
    minHeight: 44,
    fontSize: 16,
    fontWeight: 600,
    fontFamily: 'var(--font-body)',
  },
  topTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    fontWeight: 700,
    marginLeft: 4,
  },
}
