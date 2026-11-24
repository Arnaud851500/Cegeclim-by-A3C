'use client'

// ============================================================================
// app/accueil/page.tsx — Page d'entrée desktop, même expérience que le mobile
// ----------------------------------------------------------------------------
// ÉVOLUTION (2026-09-15) : la grille de liens « Accès rapide » (fond clair,
// sections Base clients / Territoire / Pilotage) est remplacée par les blocs
// colorés de MobileHome. Un bloc regroupe plusieurs écrans (lib/navigation.ts) :
//   - 1 écran autorisé  → le clic ouvre directement l'écran ;
//   - 2 écrans et plus  → le clic ouvre un panneau listant les écrans du bloc.
// Le retour ici se fait par le bouton MENU du bandeau (ClientRootShell) ; le
// volet « Arborescence » du même bandeau permet de changer d'écran sans
// repasser par cette page. Pour la mettre par défaut à tout le monde :
// default_landing_page = /accueil sur les profils (écran Autorisations).
// ============================================================================

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { useRouter } from 'next/navigation'
import { useAccess } from '@/components/AccessContext'
import { useViewport } from '@/lib/useViewport'
import MobileShell from '@/components/mobile/MobileShell'
import { getVisibleBlocs, type NavBloc, type NavPage } from '@/lib/navigation'
import { useAlerts, type AlertItem } from '@/components/AlertsContext'
import { useTheme } from '@/components/ThemeContext'
import { themed } from '@/lib/theme'

// ÉVOLUTION (2026-10-13) : les pastilles d'alerte ont quitté le bandeau ; le
// bloc « Mes alertes » affiche désormais chaque compteur en grand (rouge = à
// traiter, vert = OK, objectif 0). Un clic sur un compteur ouvre directement
// la liste concernée ; un clic sur le titre ouvre le Centre d'alertes.
// Mode clair : les blocs passent en teintes claires (couleur du bloc sur
// l'icône), via useTheme() ; le reste suit les variables de lib/theme.ts.
// ÉVOLUTION (2026-11-20) : raccourci « Quand puis-je livrer ? » (mini bloc pleine
// largeur sous le titre, droit can_stocks) : n° de devis → /quand-livrer?devis=…,
// ou « Coller une liste » → /quand-livrer en mode liste.
// ÉVOLUTION (2026-11-23) : libellés précisés — devis créés au plus tard la veille,
// liste collée / photo / capture d'écran, date de livraison client = dispo dépôt + 7 j.
// ÉVOLUTION (2026-11-24) : tout tient sur une page, quel que soit le nombre de blocs
// autorisés. La grille occupe la hauteur restante de la fenêtre (mesurée sous le
// bandeau) ; le nombre de colonnes dépend du nombre de blocs et de la largeur
// (1 à 5), la hauteur des lignes se partage l'espace. Le contenu d'un bloc
// s'adapte à sa taille : « grand » (icônes, titre, sous-titre, liste des écrans),
// « moyen » (icônes réduites) ou « compact » (icône à gauche, texte à droite) —
// textes jamais sous 12 px. En-tête et raccourci « Quand puis-je livrer ? » sur une
// ligne. Écran très bas (< 380 px utiles) : la page défile plutôt que d'écraser.
// ÉVOLUTION (2026-09-15 soir) : bloc « Mes alertes » — pas une page mais la
// fenêtre flottante « Centre d'alertes » (ClientRootShell), qui reprend en
// grand les pastilles du bandeau. Il apparaît après « Mes tâches » dès que le
// profil a au moins une alerte activée, avec le nombre d'alertes à traiter.

export default function AccueilPage() {
  const router = useRouter()
  const { rights, email } = useAccess()
  const { isMobile } = useViewport()
  const alerts = useAlerts()
  const { theme } = useTheme()
  const light = theme === 'light'

  // Couleurs d'un bloc : dégradé saturé en sombre, teinte claire en clair.
  const blocColors = useCallback(
    (gradient: [string, string]) =>
      light
        ? {
            background: `color-mix(in srgb, ${gradient[0]} 18%, #FFFFFF)`,
            border: `1px solid color-mix(in srgb, ${gradient[0]} 38%, #FFFFFF)`,
            boxShadow: '0 8px 22px rgba(11,18,32,0.08)',
            color: `color-mix(in srgb, ${gradient[1]} 88%, #000000)`,
            subtitle: `color-mix(in srgb, ${gradient[1]} 72%, #000000)`,
            count: `color-mix(in srgb, ${gradient[1]} 62%, #000000)`,
            chevron: `color-mix(in srgb, ${gradient[1]} 55%, #FFFFFF)`,
            iconBg: gradient[0],
          }
        : {
            background: `linear-gradient(180deg, ${gradient[0]} 0%, ${gradient[1]} 100%)`,
            border: undefined,
            boxShadow: undefined,
            color: undefined,
            subtitle: undefined,
            count: undefined,
            chevron: undefined,
            iconBg: undefined,
          },
    [light]
  )

  const [openBloc, setOpenBloc] = useState<NavBloc | null>(null)


  const blocs = useMemo(() => getVisibleBlocs(rights), [rights])
  const nbEcrans = blocs.reduce((sum, bloc) => sum + bloc.pages.length, 0)

  // Espace disponible pour la grille (sous le bandeau, l'en-tête et le raccourci)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [zone, setZone] = useState<{ w: number; h: number }>({ w: 1200, h: 640 })
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    const mesurer = () => {
      const r = el.getBoundingClientRect()
      const h = Math.max(380, Math.floor(window.innerHeight - r.top - 18))
      setZone((z) => (Math.abs(z.w - r.width) < 2 && Math.abs(z.h - h) < 2 ? z : { w: r.width, h }))
    }
    mesurer()
    const ro = new ResizeObserver(mesurer)
    ro.observe(el)
    window.addEventListener('resize', mesurer)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', mesurer)
    }
  }, [blocs.length, isMobile])

  // Position du bloc « Mes alertes » dans la grille : juste après « Mes tâches »
  // (comme sur le mobile « Mes tâches - alertes »), sinon en tête.
  const alertBlocIndex = useMemo(() => {
    const idx = blocs.findIndex((bloc) => bloc.id === 'taches')
    return idx >= 0 ? idx + 1 : 0
  }, [blocs])
  const showAlertBloc = alerts.items.length > 0

  // Tuiles affichées : blocs + « Mes alertes » à sa place
  const tuiles = useMemo(() => {
    const t: ({ kind: 'bloc'; bloc: NavBloc } | { kind: 'alertes' })[] = blocs.map((bloc) => ({ kind: 'bloc' as const, bloc }))
    if (showAlertBloc) t.splice(Math.min(alertBlocIndex, t.length), 0, { kind: 'alertes' })
    return t
  }, [blocs, showAlertBloc, alertBlocIndex])

  const GAP = 14
  const disposition = useMemo(() => {
    const n = Math.max(1, tuiles.length)
    const maxCols = zone.w < 760 ? 2 : zone.w < 1050 ? 3 : zone.w < 1400 ? 4 : 5
    const prefer: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 3, 10: 5, 11: 4, 12: 4 }
    const cols = Math.min(maxCols, prefer[n] ?? 5, n)
    const rows = Math.ceil(n / cols)
    const rowH = (zone.h - GAP * (rows - 1)) / rows
    const colW = (zone.w - GAP * (cols - 1)) / cols
    const taille: Taille = rowH >= 215 && colW >= 260 ? 'grand' : rowH >= 150 ? 'moyen' : 'compact'
    return { cols, rows, rowH, taille }
  }, [tuiles.length, zone])

  const displayName =
    String(rights.display_name || '').trim() ||
    String(email || '').split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ||
    ''

  const goTo = useCallback(
    (page: NavPage) => {
      setOpenBloc(null)
      router.push(page.path)
    },
    [router]
  )

  const onBlocClick = useCallback(
    (bloc: NavBloc) => {
      if (bloc.pages.length === 1) {
        goTo(bloc.pages[0])
        return
      }
      setOpenBloc(bloc)
    },
    [goTo]
  )

  useEffect(() => {
    if (!openBloc) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenBloc(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openBloc])

  if (isMobile) {
    return <MobileShell />
  }

  return (
    <div style={styles.page}>
      <style>{`
        .cgcBloc { transition: transform 0.16s ease, box-shadow 0.16s ease, filter 0.16s ease; }
        .cgcBloc:hover { transform: translateY(-2px); filter: brightness(1.08); box-shadow: 0 16px 36px rgba(0,0,0,calc(0.42 * var(--cg-shadow-k))); }
        [data-theme="light"] .cgcBloc:hover { filter: brightness(0.98); }
        .cgcBloc { overflow: hidden; min-height: 0; min-width: 0; }
        .cgcBloc:focus-visible, .cgcAlertCounter:focus-visible, .cgcAlertHead:focus-visible { outline: 2px solid var(--cg-ink-soft); outline-offset: 3px; }
        .cgcAlertCounter:hover { filter: brightness(1.08); transform: translateY(-1px); }
        [data-theme="light"] .cgcAlertCounter:hover { filter: brightness(0.97); }
        .cgcBlocPage:hover { background: rgba(var(--cg-ink-rgb),0.09); border-color: rgba(var(--cg-ink-rgb),0.22); }
        .cgcBlocPage:focus-visible { outline: 2px solid var(--cg-ink-soft); outline-offset: 2px; }
        .cgcPanelClose:hover { background: rgba(255,255,255,0.10); color: #fff; }
        @media (prefers-reduced-motion: reduce) { .cgcBloc { transition: none; } .cgcBloc:hover { transform: none; } }
      `}</style>

      <div style={styles.hero}>
        <h1 style={styles.title}>Bonjour{displayName ? `, ${displayName}` : ''}.</h1>
        <div style={styles.lead}>
          {nbEcrans} écran{nbEcrans > 1 ? 's' : ''} dans {blocs.length} bloc{blocs.length > 1 ? 's' : ''} — choisissez un bloc ; le bouton MENU du bandeau vous ramène ici.
        </div>
      </div>

      {rights.can_stocks && <RaccourciQuandLivrer onOpen={(url) => router.push(url)} />}

      {blocs.length === 0 ? (
        <div style={styles.empty}>
          Aucun écran n’est ouvert sur votre profil. Rapprochez-vous d’un administrateur pour obtenir des accès.
        </div>
      ) : (
        <div
          ref={gridRef}
          style={{
            ...styles.grid,
            gridTemplateColumns: `repeat(${disposition.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${disposition.rows}, minmax(0, 1fr))`,
            gap: GAP,
            height: zone.h,
          }}
        >
          {tuiles.map((tuile) =>
            tuile.kind === 'alertes' ? (
              <AlertsBloc
                key="alertes"
                items={alerts.items}
                activeCount={alerts.activeCount}
                onOpenCenter={alerts.openAlertCenter}
                light={light}
                taille={disposition.taille}
                colors={blocColors(alerts.activeCount > 0 ? ALERT_GRADIENT_ACTIVE : ALERT_GRADIENT_OK)}
              />
            ) : (
              <BlocTuile
                key={tuile.bloc.id}
                bloc={tuile.bloc}
                taille={disposition.taille}
                light={light}
                colors={blocColors(tuile.bloc.gradient)}
                onClick={() => onBlocClick(tuile.bloc)}
              />
            )
          )}
        </div>
      )}

      {openBloc && (
        <div
          style={styles.panelBackdrop}
          onClick={() => setOpenBloc(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={openBloc.label}
            style={styles.panel}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              style={{
                ...styles.panelHeader,
                background: blocColors(openBloc.gradient).background,
              }}
            >
              <span style={{ ...styles.panelIcon, background: light ? blocColors(openBloc.gradient).iconBg : openBloc.iconBg }}>{openBloc.icon}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ ...styles.panelTitle, ...(light ? { color: blocColors(openBloc.gradient).color } : {}) }}>{openBloc.label}</div>
                <div style={{ ...styles.panelSubtitle, ...(light ? { color: blocColors(openBloc.gradient).subtitle } : {}) }}>{openBloc.subtitle}</div>
              </div>
              <button
                type="button"
                className="cgcPanelClose"
                onClick={() => setOpenBloc(null)}
                style={{ ...styles.panelClose, ...(light ? styles.panelCloseLight : {}) }}
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>

            <div style={styles.panelBody}>
              {openBloc.pages.map((page, index) => (
                <button
                  key={page.path}
                  type="button"
                  className="cgcBlocPage"
                  onClick={() => goTo(page)}
                  style={styles.panelPage}
                >
                  <span style={styles.panelPageIndex}>{index + 1}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={styles.panelPageLabel}>{page.label}</span>
                    {page.description ? (
                      <span style={styles.panelPageDescription}>{page.description}</span>
                    ) : null}
                  </span>
                  <span style={styles.panelPageChevron} aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = themed({
  page: {
    maxWidth: 1560,
    margin: '0 auto',
    padding: '12px 8px 0',
    color: '#F5F3EC',
    fontFamily: 'var(--font-body)',
  },

  hero: {
    display: 'flex',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: '4px 18px',
    marginBottom: 10,
  },

  kicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    letterSpacing: '0.32em',
    color: 'rgba(245,243,236,0.55)',
    marginBottom: 8,
  },

  title: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 28,
    fontWeight: 800,
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
    color: '#ffffff',
  },

  lead: {
    fontSize: 14,
    lineHeight: 1.4,
    color: 'rgba(245,243,236,0.62)',
  },

  empty: {
    padding: 28,
    borderRadius: 20,
    border: '1px dashed rgba(255,255,255,0.22)',
    color: 'rgba(245,243,236,0.7)',
    fontSize: 15,
  },

  grid: {
    display: 'grid',
  },

  bloc: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '16px 18px',
    borderRadius: 22,
    border: '1px solid rgba(255,255,255,0.12)',
    boxShadow: '0 10px 28px rgba(0,0,0,0.32)',
    color: '#ffffff',
    cursor: 'pointer',
    textAlign: 'center',
    fontFamily: 'inherit',
  },

  blocChevron: {
    position: 'absolute',
    top: 16,
    right: 20,
    fontSize: 24,
    lineHeight: 1,
    color: 'rgba(255,255,255,0.7)',
  },

  blocIcons: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },

  blocIcon: {
    width: 68,
    height: 68,
    borderRadius: 18,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 34,
    lineHeight: 1,
    marginBottom: 6,
  },

  blocLabel: {
    fontFamily: 'var(--font-display)',
    fontSize: 27,
    fontWeight: 800,
    lineHeight: 1.1,
    letterSpacing: '-0.01em',
  },

  blocSubtitle: {
    fontSize: 14.5,
    lineHeight: 1.35,
    color: 'rgba(255,255,255,0.78)',
  },

  blocCount: {
    marginTop: 6,
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.55)',
  },

  blocPages: {
    marginTop: 4,
    fontSize: 12.5,
    lineHeight: 1.4,
    color: 'rgba(255,255,255,0.72)',
    maxWidth: 520,
  },

  panelBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 900,
    background: 'rgba(6,10,18,0.72)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  panel: {
    width: 'min(720px, 96vw)',
    maxHeight: '86vh',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 24,
    overflow: 'hidden',
    background: '#101A2E',
    border: '1px solid rgba(255,255,255,0.14)',
    boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
    color: '#F5F3EC',
  },

  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '18px 20px',
  },

  panelIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    flexShrink: 0,
  },

  panelTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 22,
    fontWeight: 800,
    lineHeight: 1.1,
    color: '#ffffff',
  },

  panelSubtitle: {
    marginTop: 3,
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.75)',
  },

  panelClose: {
    marginLeft: 'auto',
    width: 36,
    height: 36,
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.22)',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    cursor: 'pointer',
    flexShrink: 0,
  },

  panelBody: {
    padding: 12,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },

  panelPage: {
    display: 'grid',
    gridTemplateColumns: '34px minmax(0, 1fr) 20px',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: '12px 14px',
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.10)',
    background: 'rgba(255,255,255,0.045)',
    color: '#F5F3EC',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
    transition: 'background 0.14s ease, border-color 0.14s ease',
  },

  panelPageIndex: {
    width: 34,
    height: 34,
    borderRadius: 10,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    fontWeight: 700,
    color: '#A6A181',
    background: 'rgba(166,161,129,0.12)',
    border: '1px solid rgba(166,161,129,0.35)',
  },

  panelPageLabel: {
    display: 'block',
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.2,
    color: '#ffffff',
  },

  panelPageDescription: {
    display: 'block',
    marginTop: 3,
    fontSize: 13,
    lineHeight: 1.4,
    color: 'rgba(245,243,236,0.6)',
  },

  panelPageChevron: {
    fontSize: 22,
    lineHeight: 1,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'right',
  },

  panelCloseLight: {
    border: '1px solid rgba(11,18,32,0.18)',
    background: 'rgba(255,255,255,0.6)',
    color: '#0B1220',
  },

  // ── Bloc « Mes alertes » (13/10/2026, v2) : même gabarit que les autres
  // blocs, compteurs en pastilles compactes ─────────────────────────────
  alertChips: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
    maxWidth: '100%',
  },

  alertChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '5px 10px 5px 8px',
    borderRadius: 999,
    fontFamily: 'inherit',
    fontSize: 12,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    transition: 'filter 0.14s ease, transform 0.14s ease',
  },

  alertChipDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    flexShrink: 0,
  },

  alertChipValue: {
    fontFamily: 'var(--font-display)',
    fontSize: 15,
    fontWeight: 800,
    fontVariantNumeric: 'tabular-nums',
  },
}, ['bloc', 'blocChevron', 'blocIcon', 'blocLabel', 'blocSubtitle', 'blocCount', 'blocPages', 'panelHeader', 'panelIcon', 'panelTitle', 'panelSubtitle', 'panelClose', 'panelCloseLight', 'alertChip', 'alertChipValue'])

// ── Bloc « Mes alertes » (13/10/2026, v2) ───────────────────────────────────
// Même gabarit que les autres blocs (dégradé, icône, titre, sous-titre), avec
// une pastille par alerte : point rouge + compteur = à traiter, point vert + OK.
// Clic sur une pastille rouge = liste à traiter (même action que l'ancienne
// pastille du bandeau) ; clic ailleurs sur le bloc = Centre d'alertes.
const ALERT_GRADIENT_ACTIVE: [string, string] = ['#A5482A', '#6E2E19']
const ALERT_GRADIENT_OK: [string, string] = ['#2F6B4C', '#1B3D2C']

const ALERT_SHORT_LABELS: Record<string, string> = {
  cerfa: 'CERFA',
  'cdc-retard': 'CDC liv < M-2',
  'couverture-stock': 'Cde non complètes',
  'frais-port': 'Frais de port',
  'capacite-gaz': 'Capacité gaz',
  todo: 'À faire',
  coherence: 'Cohérence',
}

type Taille = 'grand' | 'moyen' | 'compact'

// Dimensions du contenu d'un bloc selon la place disponible (textes ≥ 12 px)
const TAILLES: Record<Taille, { icon: number; iconFont: number; label: number; subtitle: number; count: number }> = {
  grand: { icon: 60, iconFont: 30, label: 25, subtitle: 14.5, count: 11.5 },
  moyen: { icon: 46, iconFont: 23, label: 21, subtitle: 13.5, count: 11 },
  compact: { icon: 44, iconFont: 22, label: 18, subtitle: 12.5, count: 11 },
}

const clamp = (lines: number): React.CSSProperties => ({
  display: '-webkit-box',
  WebkitLineClamp: lines,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
})

function BlocTuile({
  bloc,
  taille,
  light,
  colors,
  onClick,
}: {
  bloc: NavBloc
  taille: Taille
  light: boolean
  colors: BlocColors
  onClick: () => void
}) {
  const t = TAILLES[taille]
  const compact = taille === 'compact'
  const icons = bloc.icons && bloc.icons.length > 0 ? bloc.icons : [bloc.icon]
  const ecrans =
    bloc.pages.length === 1 ? bloc.pages[0].label : `${bloc.pages.length} écrans`
  return (
    <button
      type="button"
      className="cgcBloc"
      onClick={onClick}
      title={bloc.pages.map((p) => p.label).join(' · ')}
      style={{
        ...styles.bloc,
        ...(compact ? { flexDirection: 'row', justifyContent: 'flex-start', textAlign: 'left', gap: 14, padding: '12px 34px 12px 16px' } : {}),
        background: colors.background,
        ...(colors.border ? { border: colors.border } : {}),
        ...(colors.boxShadow ? { boxShadow: colors.boxShadow } : {}),
        ...(colors.color ? { color: colors.color } : {}),
      }}
    >
      <span style={{ ...styles.blocChevron, top: compact ? '50%' : 12, right: 14, transform: compact ? 'translateY(-50%)' : undefined, ...(light ? { color: colors.chevron } : {}) }} aria-hidden="true">›</span>
      <span style={{ ...styles.blocIcons, gap: 8, flexShrink: 0, ...(compact && icons.length > 1 ? { flexDirection: 'column', gap: 4 } : {}) }}>
        {(compact ? icons.slice(0, 1) : icons).map((icon, i) => (
          <span
            key={`${bloc.id}-icon-${i}`}
            style={{ ...styles.blocIcon, width: t.icon, height: t.icon, fontSize: t.iconFont, borderRadius: Math.round(t.icon * 0.27), marginBottom: 0, background: light ? colors.iconBg : bloc.iconBg }}
          >
            {icon}
          </span>
        ))}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: compact ? 'flex-start' : 'center', gap: compact ? 2 : 4, minWidth: 0, maxWidth: '100%' }}>
        <span style={{ ...styles.blocLabel, fontSize: t.label, ...clamp(2) }}>{bloc.label}</span>
        <span style={{ ...styles.blocSubtitle, fontSize: t.subtitle, ...clamp(compact ? 1 : 2), ...(light ? { color: colors.subtitle } : {}) }}>{bloc.subtitle}</span>
        {taille === 'grand' && bloc.pages.length > 1 ? (
          <span style={{ ...styles.blocPages, ...clamp(2), ...(light ? { color: colors.count } : {}) }}>
            {bloc.pages.map((p) => p.label).join(' · ')}
          </span>
        ) : (
          <span style={{ ...styles.blocCount, fontSize: t.count, marginTop: compact ? 1 : 2, ...(light ? { color: colors.count } : {}) }}>{ecrans}</span>
        )}
      </span>
    </button>
  )
}

type BlocColors = {
  background: string
  border?: string
  boxShadow?: string
  color?: string
  subtitle?: string
  count?: string
  chevron?: string
  iconBg?: string
}

function AlertsBloc({
  items,
  activeCount,
  onOpenCenter,
  light,
  colors,
  taille,
}: {
  items: AlertItem[]
  activeCount: number
  onOpenCenter: () => void
  light: boolean
  colors: BlocColors
  taille: Taille
}) {
  const t = TAILLES[taille]
  // Peu de hauteur ou beaucoup de compteurs : on retire l'icône et le sous-titre pour garder les pastilles lisibles
  const petit = taille === 'compact' || (taille === 'moyen' && items.length > 4)
  return (
    <div
      className="cgcBloc"
      role="group"
      aria-label="Mes alertes"
      onClick={onOpenCenter}
      style={{
        ...styles.bloc,
        cursor: 'pointer',
        gap: petit ? 4 : 6,
        padding: petit ? '10px 14px' : styles.bloc.padding,
        background: colors.background,
        ...(colors.border ? { border: colors.border } : {}),
        ...(colors.boxShadow ? { boxShadow: colors.boxShadow } : {}),
        ...(colors.color ? { color: colors.color } : {}),
      }}
    >
      <span style={{ ...styles.blocChevron, top: 12, right: 14, ...(light ? { color: colors.chevron } : {}) }} aria-hidden="true">›</span>
      {!petit && (
        <span style={{ ...styles.blocIcon, width: t.icon, height: t.icon, fontSize: t.iconFont, borderRadius: Math.round(t.icon * 0.27), marginBottom: 0, background: light ? colors.iconBg : 'rgba(255,255,255,0.18)' }} aria-hidden="true">🔔</span>
      )}
      <button
        type="button"
        className="cgcAlertHead"
        onClick={(event) => {
          event.stopPropagation()
          onOpenCenter()
        }}
        style={{ ...styles.blocLabel, fontSize: t.label, border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0 }}
        title="Ouvrir le Centre d’alertes (objectifs et actions attendues)"
      >
        {petit ? '🔔 ' : ''}Mes alertes{activeCount > 0 ? ` (${activeCount})` : ''}
      </button>
      {!petit && (
        <span style={{ ...styles.blocSubtitle, fontSize: t.subtitle, ...(light ? { color: colors.subtitle } : {}) }}>
          {activeCount > 0 ? 'À traiter en priorité · objectif 0' : 'Rien à traiter pour le moment'}
        </span>
      )}

      <span style={{ ...styles.alertChips, ...(petit ? { gap: 4, marginTop: 0 } : {}) }}>
        {items.map((item) => {
          const toTreat = item.count > 0
          const label = ALERT_SHORT_LABELS[item.key] || item.label
          return (
            <button
              key={item.key}
              type="button"
              className="cgcAlertCounter"
              onClick={(event) => {
                event.stopPropagation()
                if (toTreat && item.clickable) item.onOpen()
                else onOpenCenter()
              }}
              title={toTreat ? `${item.count.toLocaleString('fr-FR')} ${item.unit} — ${item.description}` : `${item.label} : rien à traiter`}
              style={{
                ...styles.alertChip,
                ...(petit ? { padding: '3px 8px 3px 6px', gap: 5 } : {}),
                ...(light
                  ? { background: '#FFFFFF', border: `1px solid ${toTreat ? '#F3C5C1' : '#B9DFC6'}`, color: '#2A3142' }
                  : { background: 'rgba(11,18,32,0.28)', border: '1px solid rgba(255,255,255,0.22)', color: 'rgba(255,255,255,0.92)' }),
              }}
            >
              <span
                aria-hidden="true"
                style={{ ...styles.alertChipDot, background: toTreat ? (light ? '#C4321F' : '#FF6B5B') : light ? '#1F8A4C' : '#4ADE80' }}
              />
              <span
                style={{
                  ...styles.alertChipValue,
                  color: light ? (toTreat ? '#B42318' : '#17673A') : '#FFFFFF',
                }}
              >
                {toTreat ? item.count.toLocaleString('fr-FR') : 'OK'}
              </span>
              <span>{label}</span>
            </button>
          )
        })}
      </span>
    </div>
  )
}

// ── Raccourci « Quand puis-je livrer ? » (20/11/2026) ───────────────────────
function RaccourciQuandLivrer({ onOpen }: { onOpen: (url: string) => void }) {
  const [numero, setNumero] = useState('')
  return (
    <form
      className="cgcQlBar"
      onSubmit={(e) => {
        e.preventDefault()
        const n = numero.trim()
        onOpen(n ? `/quand-livrer?devis=${encodeURIComponent(n.toUpperCase())}` : '/quand-livrer')
      }}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px 12px',
        margin: '0 0 12px',
        padding: '10px 16px',
        borderRadius: 18,
        background: 'linear-gradient(120deg, #C1683C 0%, #8E4524 100%)',
        color: '#fff',
        boxShadow: '0 10px 28px rgba(0,0,0,calc(0.28 * var(--cg-shadow-k)))',
      }}
    >
      <span style={{ fontSize: 24, lineHeight: 1 }} aria-hidden="true">🚚</span>
      <span
        style={{ display: 'flex', flexDirection: 'column', flex: '1 1 260px', minWidth: 0 }}
        title="Avant de créer la commande : date de livraison client au plus tôt (dispo au dépôt + 7 j de logistique) d’un devis créé au plus tard la veille, ou d’une liste d’articles — collée, photographiée ou en capture d’écran."
      >
        <span style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>Quand puis-je livrer ?</span>
        <span style={{ fontSize: 12.5, opacity: 0.88, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          Date de livraison client au plus tôt (dispo dépôt + 7 j) d’un devis créé au plus tard la veille, ou d’une liste d’articles
        </span>
      </span>
      <input
        value={numero}
        onChange={(e) => setNumero(e.target.value)}
        placeholder="N° de devis (créé hier ou avant)…"
        aria-label="N° de devis, créé au plus tard la veille"
        style={{ flex: '0 1 240px', minWidth: 160, font: 'inherit', fontSize: 15, padding: '8px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.14)', color: '#fff', outline: 'none' }}
      />
      <button type="submit" style={{ font: 'inherit', fontSize: 14.5, fontWeight: 700, padding: '8px 16px', borderRadius: 12, border: 0, background: '#fff', color: '#8E4524', cursor: 'pointer' }}>
        Contrôler
      </button>
      <button
        type="button"
        onClick={() => onOpen('/quand-livrer?liste=')}
        style={{ font: 'inherit', fontSize: 14, fontWeight: 600, padding: '8px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.5)', background: 'transparent', color: '#fff', cursor: 'pointer' }}
      >
        📋 Liste, photo ou capture
      </button>
    </form>
  )
}
