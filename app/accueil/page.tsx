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

export default function AccueilPage() {
  const router = useRouter()
  const { rights, email } = useAccess()
  const { societeFilter } = useSocieteFilter()

  const quickLinks = useMemo<QuickLink[]>(() => {
    const links: QuickLink[] = [
      {
        label: 'Liste globale',
        path: '/clients',
        accessKey: 'can_clients',
        description: 'Consulter et filtrer la base clients et prospects.',
      },
      {
        label: 'Territoire',
        path: '/territoire',
        accessKey: 'can_territoire',
        description: 'Analyser les territoires, potentiels PAC et attractivité.',
      },
      {
        label: 'Agences',
        path: '/agences',
        accessKey: 'can_agences',
        description: 'Visualiser les agences, effectifs, surfaces et rattachements.',
      },
      {
        label: 'Cartographie',
        path: '/cartographie',
        accessKey: 'can_cartographie',
        description: 'Explorer la représentation géographique des données.',
      },
      {
        label: 'Documents',
        path: '/documents',
        accessKey: 'can_documents',
        description: 'Accéder aux documents, dossiers et pièces partagées.',
      },
      {
        label: 'Autorisations',
        path: '/autorisation',
        accessKey: 'can_autorisation',
        description: 'Gérer les accès utilisateurs et les droits de visibilité.',
      },
      {
        label: 'Activités - CA',
        path: '/activites',
        accessKey: 'can_activites',
        description: 'Suivre les activités et indicateurs de chiffre d’affaires.',
      },
      {
        label: 'Stocks et flux log',
        path: '/stocks',
        accessKey: 'can_stocks',
        description: 'Piloter les flux logistiques et les stocks.',
      },
    ]

    return links.filter((item) => !item.accessKey || !!rights[item.accessKey])
  }, [rights])

  const nbRubriques = quickLinks.length
  const allowedScopes = rights?.allowed_scopes?.length || 1

  return (
    <div className={montserrat.className} style={styles.page}>
      <div style={styles.hero}>
        <div style={styles.overlay}>
          <div style={styles.topBlock}>
            <div>
              <div style={styles.kicker}>Accueil intranet</div>
              <h1 style={styles.title}>Bienvenue sur l’environnement CEGECLIM</h1>
              <p style={styles.subtitle}>
                Accédez rapidement à vos écrans autorisés depuis cette page d’entrée.
              </p>
            </div>
          </div>

          <div style={styles.kpiGrid}>
            <div style={styles.kpiCard}>
              <div style={styles.kpiLabel}>Utilisateur connecté</div>
              <div style={styles.kpiValueSmall}>{email || '—'}</div>
            </div>

            <div style={styles.kpiCard}>
              <div style={styles.kpiLabel}>Vision active</div>
              <div style={styles.kpiValue}>{societeFilter || 'Global'}</div>
            </div>

            <div style={styles.kpiCard}>
              <div style={styles.kpiLabel}>Rubriques accessibles</div>
              <div style={styles.kpiValue}>{nbRubriques}</div>
            </div>

            <div style={styles.kpiCard}>
              <div style={styles.kpiLabel}>Scopes autorisés</div>
              <div style={styles.kpiValue}>{allowedScopes}</div>
            </div>
          </div>

          <div style={styles.mainPanel}>
            <div style={styles.panelHeader}>
              <div style={styles.panelTitle}>Accès rapide</div>
              <div style={styles.panelSubtitle}>
                Cliquez sur une rubrique pour ouvrir directement l’écran correspondant.
              </div>
            </div>

            <div style={styles.linksGrid}>
              {quickLinks.map((item) => (
                <button
                  key={item.path}
                  onClick={() => router.push(item.path)}
                  style={styles.linkCard}
                >
                  <div style={styles.linkTitle}>{item.label}</div>
                  <div style={styles.linkDescription}>{item.description}</div>
                  <div style={styles.linkCta}>Ouvrir</div>
                </button>
              ))}
            </div>
          </div>

          <div style={styles.bottomInfo}>
            La navigation haute reprend les mêmes regroupements que les rubriques métier.
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
    maxWidth: 820,
    lineHeight: 1.5,
  },

  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 16,
    marginBottom: 22,
  },

  kpiCard: {
    background: 'rgba(255,255,255,0.93)',
    border: '1px solid #dbe4ea',
    borderRadius: 18,
    padding: '18px 18px 16px',
    boxShadow: '0 8px 22px rgba(16,24,40,0.06)',
  },

  kpiLabel: {
    fontSize: 12,
    fontWeight: 800,
    color: '#667085',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 10,
  },

  kpiValue: {
    fontSize: 34,
    fontWeight: 800,
    color: '#101828',
    letterSpacing: '-0.03em',
    lineHeight: 1,
  },

  kpiValueSmall: {
    fontSize: 20,
    fontWeight: 800,
    color: '#101828',
    lineHeight: 1.2,
    wordBreak: 'break-word',
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
    fontSize: 24,
    fontWeight: 800,
    color: '#17344d',
    letterSpacing: '-0.02em',
  },

  panelSubtitle: {
    marginTop: 6,
    fontSize: 14,
    color: '#667085',
  },

  linksGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 16,
  },

  linkCard: {
    textAlign: 'left',
    border: '1px solid #dbe4ea',
    background: '#ffffff',
    borderRadius: 18,
    padding: 18,
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(16,24,40,0.04)',
  },

  linkTitle: {
    fontSize: 20,
    fontWeight: 800,
    color: '#17344d',
    marginBottom: 8,
  },

  linkDescription: {
    fontSize: 14,
    lineHeight: 1.45,
    color: '#475467',
    minHeight: 58,
  },

  linkCta: {
    marginTop: 16,
    fontSize: 13,
    fontWeight: 800,
    color: '#5ea7c3',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },

  bottomInfo: {
    marginTop: 18,
    background: 'rgba(23,52,77,0.92)',
    color: '#ffffff',
    borderRadius: 16,
    padding: '14px 18px',
    fontSize: 14,
    fontWeight: 600,
    maxWidth: 760,
  },
}