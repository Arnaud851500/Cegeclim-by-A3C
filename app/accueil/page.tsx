'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Montserrat } from 'next/font/google'
import { useAccess, type AccessRights } from '@/components/AccessContext'
import { useSocieteFilter } from '@/components/SocieteFilterContext'

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

type MenuAccessKey = Exclude<keyof AccessRights, 'allowed_scopes' | 'can_change_scope'>

type QuickLink = {
  label: string
  path: string
  accessKey?: MenuAccessKey
  description: string
}

type QuickLinkSection = {
  title: string
  subtitle?: string
  columns?: number
  items: QuickLink[]
}

export default function AccueilPage() {
  const router = useRouter()
  const { rights } = useAccess()
  const { societeFilter } = useSocieteFilter()

  const quickLinkSections = useMemo<QuickLinkSection[]>(() => {
    const sections: QuickLinkSection[] = [
      {
        title: 'Base clients',
        subtitle: 'Accès aux écrans de consultation, cartographie et suivi commercial.',
        columns: 4,
        items: [
          {
            label: 'Liste globale',
            path: '/clients',
            accessKey: 'can_clients',
            description:
              'Consulter et filtrer la base clients et prospects. Accéder aux informations utiles comme l’adresse, le site web et le téléphone.',
          },
          {
            label: 'Carte',
            path: '/carte',
            accessKey: 'can_carte',
            description:
              'Visualiser les clients et prospects sur une carte pour faciliter les analyses géographiques.',
          },
          {
            label: 'Clients CEGECLIM',
            path: '/clients_cegeclim',
            accessKey: 'can_clients_cegeclim',
            description:
              'Afficher les clients présents dans la base CEGECLIM et naviguer dans les informations de rattachement.',
          },
          {
            label: 'Suivi prospects',
            path: '/suivi_prospects',
            accessKey: 'can_suivi_prospects',
            description:
              'Piloter l’avancement des prospects et les prochaines actions commerciales.',
          },
        ],
      },
      {
        title: 'Territoire',
        subtitle: 'Vision géographique, structure réseau et pilotage territorial.',
        columns: 4,
        items: [
          {
            label: 'Territoire',
            path: '/territoire',
            accessKey: 'can_territoire',
            description:
              'Analyser les territoires, les potentiels PAC et l’attractivité par département et par région.',
          },
          {
            label: 'Agences',
            path: '/agences',
            accessKey: 'can_agences',
            description:
              'Visualiser les agences, leurs effectifs, surfaces, rattachements et caractéristiques principales.',
          },
          {
            label: 'Cartographie',
            path: '/cartographie',
            accessKey: 'can_cartographie',
            description:
              'Explorer la représentation géographique des données sur fond de carte.',
          },
        ],
      },
      {
        title: 'Pilotage & administration',
        subtitle: 'Fonctions support, droits d’accès et outils de gestion transverses.',
        columns: 4,
        items: [
          {
            label: 'Documents',
            path: '/documents',
            accessKey: 'can_documents',
            description:
              'Accéder aux documents, dossiers et pièces partagées selon les droits attribués.',
          },
                    {
            label: 'Activités - CA',
            path: '/activites',
            accessKey: 'can_activites',
            description:
              'Suivre les activités et les indicateurs de chiffre d’affaires.',
          },
                              {
            label: 'Indicateurs',
            path: '/indicateurs',
            accessKey: 'can_dashboard',
            description:
              'Principaux indicateurs de performances (Commerce / Services / Coûts / Stocks/ ).',
          },
          {
            label: 'Autorisations',
            path: '/autorisation',
            accessKey: 'can_autorisation',
            description:
              'Gérer les accès utilisateurs, les scopes, agences autorisées et départements visibles.',
          },

          {
            label: 'Stocks et flux log',
            path: '/stocks',
            accessKey: 'can_stocks',
            description:
              'Piloter les flux logistiques et les stocks.',
          },
        ],
      },
    ]

    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.accessKey || !!rights[item.accessKey]),
      }))
      .filter((section) => section.items.length > 0)
  }, [rights])

  const nbRubriques = quickLinkSections.reduce((sum, section) => sum + section.items.length, 0)

  return (
    <div className={montserrat.className} style={styles.page}>
      <div style={styles.hero}>
        <div style={styles.overlay}>
          <div style={styles.topBlock}>
            <div style={styles.kicker}>Accueil intranet</div>
            <h1 style={styles.title}>Bienvenue sur l’environnement CEGECLIM</h1>
            <p style={styles.subtitle}>
              Accédez rapidement à vos écrans autorisés depuis cette page d’entrée, également
              disponibles via le bandeau supérieur.
            </p>
          </div>

          <div style={styles.mainPanel}>
            <div style={styles.panelHeader}>
              <div style={styles.panelTitle}>Accès rapide</div>
              <div style={styles.panelSubtitle}>

              </div>
              <div style={styles.counterPill}>{nbRubriques} écran(s) accessible(s)</div>
            </div>

            <div style={styles.sectionsWrapper}>
              {quickLinkSections.map((section) => (
                <div key={section.title} style={styles.sectionBlock}>
                  <div style={styles.sectionHeader}>
                    <div style={styles.sectionTitle}>{section.title}</div>
                    {section.subtitle ? (
                      <div style={styles.sectionSubtitle}>{section.subtitle}</div>
                    ) : null}
                  </div>

                  <div
                    style={{
                      ...styles.linksGrid,
                      gridTemplateColumns: `repeat(${section.columns || 4}, minmax(0, 1fr))`,
                    }}
                  >
                    {section.items.map((item) => (
                      <button
                        key={item.path}
                        onClick={() => router.push(item.path)}
                        style={styles.linkCard}
                      >
                        <div style={styles.linkTopRow}>
                          <div style={styles.linkTitle}>{item.label}</div>
                          <div style={styles.linkCta}>OUVRIR</div>
                        </div>

                        <div style={styles.linkDescription}>{item.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100%',
  },

  hero: {
    minHeight: 'calc(100vh - 160px)',
    backgroundImage:
      'url("https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/public/Agences/maison-login.jpg")',
    backgroundSize: 'cover',
    backgroundPosition: 'center center',
    backgroundRepeat: 'no-repeat',
    borderRadius: 24,
    overflow: 'hidden',
  },

  overlay: {
    minHeight: 'calc(100vh - 160px)',
    background:
      'linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.88) 100%)',
    padding: 28,
    boxSizing: 'border-box',
  },

  topBlock: {
    marginBottom: 24,
  },

  kicker: {
    fontSize: 13,
    fontWeight: 800,
    color: '#5ea7c3',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 10,
  },

  title: {
    margin: 0,
    fontSize: 34,
    fontWeight: 800,
    color: '#17344d',
    letterSpacing: '-0.03em',
    lineHeight: 1.05,
  },

  subtitle: {
    margin: '10px 0 0 0',
    fontSize: 17,
    color: '#475467',
    maxWidth: 1520,
    lineHeight: 1.5,
  },

  contextBadge: {
    display: 'inline-flex',
    marginTop: 14,
    padding: '8px 12px',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.75)',
    border: '1px solid #dbe4ea',
    color: '#17344d',
    fontSize: 13,
    fontWeight: 700,
  },

  mainPanel: {
    background: 'rgba(255,255,255,0.94)',
    border: '1px solid #dbe4ea',
    borderRadius: 24,
    padding: 24,
    boxShadow: '0 10px 28px rgba(16,24,40,0.07)',
  },

  panelHeader: {
    marginBottom: 18,
  },

  panelTitle: {
    fontSize: 20,
    fontWeight: 800,
    color: '#17344d',
    letterSpacing: '-0.02em',
  },

  panelSubtitle: {
    marginTop: 6,
    fontSize: 14,
    color: '#667085',
    lineHeight: 1.45,
    maxWidth: 980,
  },

  counterPill: {
    display: 'inline-flex',
    marginTop: 12,
    padding: '8px 12px',
    borderRadius: 999,
    background: '#eef7fb',
    border: '1px solid #cfe4ed',
    color: '#17344d',
    fontSize: 13,
    fontWeight: 800,
  },

  sectionsWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },

  sectionBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },

  sectionHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: 800,
    color: '#17344d',
    letterSpacing: '-0.02em',
  },

  sectionSubtitle: {
    fontSize: 14,
    color: '#667085',
    lineHeight: 1.4,
  },

  linksGrid: {
    display: 'grid',
    gap: 12,
  },

  linkCard: {
    textAlign: 'left',
    border: '1px solid #dbe4ea',
    background: '#ffffff',
    borderRadius: 28,
    padding: '22px 22px 18px',
    cursor: 'pointer',
    boxShadow: '0 2px 10px rgba(16,24,40,0.04)',
    minHeight: 100,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },

  linkTopRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },

  linkTitle: {
    fontSize: 20,
    fontWeight: 800,
    color: '#17344d',
    lineHeight: 1.05,
    letterSpacing: '-0.02em',
    maxWidth: '75%',
  },

  linkDescription: {
    fontSize: 12,
    lineHeight: 1.45,
    color: '#475467',
    marginTop: 2,
  },

  linkCta: {
    fontSize: 13,
    fontWeight: 800,
    color: '#5ea7c3',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    paddingTop: 2,
  },
}
