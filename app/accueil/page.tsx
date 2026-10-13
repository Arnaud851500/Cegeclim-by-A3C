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

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
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

  // Position du bloc « Mes alertes » dans la grille : juste après « Mes tâches »
  // (comme sur le mobile « Mes tâches - alertes »), sinon en tête.
  const alertBlocIndex = useMemo(() => {
    const idx = blocs.findIndex((bloc) => bloc.id === 'taches')
    return idx >= 0 ? idx + 1 : 0
  }, [blocs])
  const showAlertBloc = alerts.items.length > 0

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
        .cgcBloc:focus-visible, .cgcAlertCounter:focus-visible, .cgcAlertHead:focus-visible { outline: 2px solid var(--cg-ink-soft); outline-offset: 3px; }
        .cgcAlertCounter:hover { filter: brightness(1.08); transform: translateY(-1px); }
        [data-theme="light"] .cgcAlertCounter:hover { filter: brightness(0.97); }
        .cgcBlocPage:hover { background: rgba(var(--cg-ink-rgb),0.09); border-color: rgba(var(--cg-ink-rgb),0.22); }
        .cgcBlocPage:focus-visible { outline: 2px solid var(--cg-ink-soft); outline-offset: 2px; }
        .cgcPanelClose:hover { background: rgba(255,255,255,0.10); color: #fff; }
        @media (max-width: 1240px) { .cgcBlocGrid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }
        @media (prefers-reduced-motion: reduce) { .cgcBloc { transition: none; } .cgcBloc:hover { transform: none; } }
      `}</style>

      <div style={styles.hero}>
        <div style={styles.kicker}>CEGECLIM</div>
        <h1 style={styles.title}>Bonjour{displayName ? `, ${displayName}` : ''}.</h1>
        <div style={styles.lead}>
          {nbEcrans} écran{nbEcrans > 1 ? 's' : ''} accessible{nbEcrans > 1 ? 's' : ''} dans {blocs.length} bloc{blocs.length > 1 ? 's' : ''}.
          Choisissez un bloc pour ouvrir un écran ; le bouton MENU du bandeau vous ramène ici.
        </div>
      </div>

      {blocs.length === 0 ? (
        <div style={styles.empty}>
          Aucun écran n’est ouvert sur votre profil. Rapprochez-vous d’un administrateur pour obtenir des accès.
        </div>
      ) : (
        <div className="cgcBlocGrid" style={styles.grid}>
          {blocs.map((bloc, index) => (
            <Fragment key={bloc.id}>
            {showAlertBloc && index === alertBlocIndex && (
              <AlertsBloc items={alerts.items} activeCount={alerts.activeCount} onOpenCenter={alerts.openAlertCenter} light={light} colors={blocColors(alerts.activeCount > 0 ? ALERT_GRADIENT_ACTIVE : ALERT_GRADIENT_OK)} />
            )}
            <button
              type="button"
              className="cgcBloc"
              onClick={() => onBlocClick(bloc)}
              style={(() => {
                const c = blocColors(bloc.gradient)
                return {
                  ...styles.bloc,
                  background: c.background,
                  ...(c.border ? { border: c.border } : {}),
                  ...(c.boxShadow ? { boxShadow: c.boxShadow } : {}),
                  ...(c.color ? { color: c.color } : {}),
                }
              })()}
            >
              <span style={{ ...styles.blocChevron, ...(light ? { color: blocColors(bloc.gradient).chevron } : {}) }} aria-hidden="true">›</span>
              <span style={styles.blocIcons}>
                {(bloc.icons && bloc.icons.length > 0 ? bloc.icons : [bloc.icon]).map((icon, iconIndex) => (
                  <span key={`${bloc.id}-icon-${iconIndex}`} style={{ ...styles.blocIcon, background: light ? blocColors(bloc.gradient).iconBg : bloc.iconBg }}>{icon}</span>
                ))}
              </span>
              <span style={styles.blocLabel}>{bloc.label}</span>
              <span style={{ ...styles.blocSubtitle, ...(light ? { color: blocColors(bloc.gradient).subtitle } : {}) }}>{bloc.subtitle}</span>
              <span style={{ ...styles.blocCount, ...(light ? { color: blocColors(bloc.gradient).count } : {}) }}>
                {bloc.pages.length === 1
                  ? bloc.pages[0].label
                  : `${bloc.pages.length} écrans`}
              </span>
            </button>
            </Fragment>
          ))}
          {showAlertBloc && alertBlocIndex >= blocs.length && (
            <AlertsBloc items={alerts.items} activeCount={alerts.activeCount} onOpenCenter={alerts.openAlertCenter} light={light} colors={blocColors(alerts.activeCount > 0 ? ALERT_GRADIENT_ACTIVE : ALERT_GRADIENT_OK)} />
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
    maxWidth: 1360,
    margin: '0 auto',
    padding: '18px 8px 40px',
    color: '#F5F3EC',
    fontFamily: 'var(--font-body)',
  },

  hero: {
    marginBottom: 22,
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
    fontSize: 38,
    fontWeight: 800,
    lineHeight: 1.05,
    letterSpacing: '-0.02em',
    color: '#ffffff',
  },

  lead: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 1.5,
    color: 'rgba(245,243,236,0.62)',
    maxWidth: 720,
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
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 16,
  },

  bloc: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 228,
    padding: '26px 22px 22px',
    borderRadius: 26,
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
    marginTop: 8,
    maxWidth: 380,
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
}, ['bloc', 'blocChevron', 'blocIcon', 'blocLabel', 'blocSubtitle', 'blocCount', 'panelHeader', 'panelIcon', 'panelTitle', 'panelSubtitle', 'panelClose', 'panelCloseLight', 'alertChip', 'alertChipValue'])

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
}: {
  items: AlertItem[]
  activeCount: number
  onOpenCenter: () => void
  light: boolean
  colors: BlocColors
}) {
  return (
    <div
      className="cgcBloc"
      role="group"
      aria-label="Mes alertes"
      onClick={onOpenCenter}
      style={{
        ...styles.bloc,
        background: colors.background,
        ...(colors.border ? { border: colors.border } : {}),
        ...(colors.boxShadow ? { boxShadow: colors.boxShadow } : {}),
        ...(colors.color ? { color: colors.color } : {}),
      }}
    >
      <span style={{ ...styles.blocChevron, ...(light ? { color: colors.chevron } : {}) }} aria-hidden="true">›</span>
      <span style={{ ...styles.blocIcon, background: light ? colors.iconBg : 'rgba(255,255,255,0.18)' }} aria-hidden="true">🔔</span>
      <button
        type="button"
        className="cgcAlertHead"
        onClick={(event) => {
          event.stopPropagation()
          onOpenCenter()
        }}
        style={{ ...styles.blocLabel, border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0 }}
        title="Ouvrir le Centre d’alertes (objectifs et actions attendues)"
      >
        Mes alertes{activeCount > 0 ? ` (${activeCount})` : ''}
      </button>
      <span style={{ ...styles.blocSubtitle, ...(light ? { color: colors.subtitle } : {}) }}>
        {activeCount > 0 ? 'À traiter en priorité · objectif 0' : 'Rien à traiter pour le moment'}
      </span>

      <span style={styles.alertChips}>
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
