'use client'

// ============================================================================
// app/agenda/page.tsx — Mes rdv (desktop)
// ----------------------------------------------------------------------------
// ÉVOLUTION (2026-09-15 soir) : page cible du bloc « Mes rdv ». Version
// d'attente : le planning et les fonctions de la Vision ONE PAGE (rendez-vous,
// comptes rendus, documents liés) seront branchés ici à partir du composant
// planning de /tableaux-de-bord/vision-tci et de components/mobile/MobileRdv.
// ============================================================================

import type React from 'react'
import { useRouter } from 'next/navigation'

export default function AgendaPage() {
  const router = useRouter()

  return (
    <div style={styles.page}>
      <div style={styles.kicker}>Mes rdv</div>
      <h1 style={styles.title}>Agenda</h1>
      <p style={styles.lead}>
        Le planning des rendez-vous et les fonctions de la Vision ONE PAGE (comptes rendus, recherche de documents)
        arrivent sur cet écran. En attendant, le planning reste accessible depuis la Vision ONE PAGE.
      </p>
      <div style={styles.actions}>
        <button type="button" onClick={() => router.push('/tableaux-de-bord/vision-tci')} style={styles.primary}>
          Ouvrir la Vision ONE PAGE
        </button>
        <button type="button" onClick={() => router.push('/accueil')} style={styles.secondary}>
          Retour au menu
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 860,
    margin: '40px auto',
    padding: '32px 36px',
    borderRadius: 24,
    background: 'linear-gradient(180deg, #5B4BC4 0%, #3A2E8A 100%)',
    color: '#F5F3EC',
    fontFamily: 'var(--font-body)',
    boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
  },
  kicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.24em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.6)',
  },
  title: {
    margin: '8px 0 0',
    fontFamily: 'var(--font-display)',
    fontSize: 34,
    fontWeight: 800,
    color: '#ffffff',
  },
  lead: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 1.5,
    color: 'rgba(255,255,255,0.8)',
  },
  actions: {
    display: 'flex',
    gap: 10,
    marginTop: 22,
    flexWrap: 'wrap',
  },
  primary: {
    padding: '10px 16px',
    borderRadius: 12,
    border: 'none',
    background: '#F5F3EC',
    color: '#141A26',
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondary: {
    padding: '10px 16px',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.35)',
    background: 'transparent',
    color: '#ffffff',
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
}
