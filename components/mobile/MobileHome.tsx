'use client'

import type { AccessRights } from '@/components/AccessContext'
import type { MobileScreen } from './MobileShell'
import LastSyncBadge from '@/components/LastSyncBadge'
import VoiceReportButtons from './VoiceReportButtons'
import MobileHomeSummary from './MobileHomeSummary'

type ButtonConfig = {
  key: MobileScreen
  label: string
  sub: string
  accessKey?: keyof AccessRights
}

const BUTTONS: ButtonConfig[] = [
  { key: 'activite', label: 'Mon activité', sub: 'Devis · CDC · BL · Factures · Marge', accessKey: 'can_dashboard' },
  { key: 'clients', label: 'Mes clients', sub: 'Fiches et suivi client', accessKey: 'can_dashboard' },
  { key: 'rdv', label: 'Mes rdv', sub: 'Agenda, comptes rendus, recherche documents' },
  { key: 'alertes', label: 'Mes tâches - alertes', sub: 'À traiter en priorité' },
  { key: 'prospects', label: 'Prospects', sub: 'Trouver un prospect autour de moi' },
]

// Marge horizontale de l'écran -- réduite (18px -> 10px de chaque côté) :
// avec l'ancienne valeur, les cartes perdaient près d'un centimètre cumulé
// entre les deux bords de l'écran (18px de marge + leur propre padding
// interne), ce qui gâchait de la largeur utile sur un petit écran.
const MARGE_ECRAN = 10

export default function MobileHome({
  email,
  rights,
  alertsCount,
  onNavigate,
}: {
  email?: string | null
  rights: AccessRights
  alertsCount: number
  onNavigate: (screen: MobileScreen) => void
}) {
  const visibleButtons = BUTTONS.filter((b) => !b.accessKey || rights[b.accessKey])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: `28px ${MARGE_ECRAN}px`, gap: 14 }}>
      <div style={{ marginBottom: 10, padding: '0 4px' }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.4)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          CEGECLIM
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 700, marginTop: 4 }}>
          Bonjour{email ? `, ${email.split('@')[0]}` : ''}
        </div>
        <div style={{ marginTop: 8 }}>
          <LastSyncBadge />
        </div>
      </div>

      {/* ---- Actions rapides : nouvelle tâche vocale + résumé vocal ---- */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <VoiceReportButtons
            modeUnique="tache"
            labelBouton="Nouvelle tâche"
            userEmail={email || ''}
            userName={email ? email.split('@')[0] : ''}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <MobileHomeSummary userEmail={email} />
        </div>
      </div>

      {/* Grille 2 colonnes, cartes plus hautes -- cible tactile plus
         généreuse que l'ancien empilement plein-largeur. Si le nombre de
         cartes est impair, la dernière prend toute la largeur pour ne pas
         laisser une case à moitié vide. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {visibleButtons.map((b, i) => {
          const seule = i === visibleButtons.length - 1 && visibleButtons.length % 2 !== 0
          return (
            <button
              key={b.key}
              onClick={() => onNavigate(b.key)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                textAlign: 'left',
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.045)',
                borderRadius: 18,
                padding: '18px 16px',
                minHeight: 128,
                color: '#fff',
                fontFamily: 'var(--font-body)',
                gridColumn: seule ? '1 / -1' : undefined,
              }}
            >
              <span style={{ fontSize: 22, color: 'rgba(255,255,255,0.3)', alignSelf: 'flex-end' }}>›</span>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, lineHeight: 1.25 }}>
                  {b.label}
                  {b.key === 'alertes' && alertsCount > 0 ? ` (${alertsCount})` : ''}
                </div>
                <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>{b.sub}</div>
              </div>
            </button>
          )
        })}
      </div>

      {visibleButtons.length === 0 && (
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 20 }}>
          Aucun accès activé pour ce profil.
        </div>
      )}
    </div>
  )
}
