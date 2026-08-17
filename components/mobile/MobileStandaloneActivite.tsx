'use client'

import Link from 'next/link'
import MobileActivite from './MobileActivite'

/**
 * Version « autonome » de l'écran Mon activité, utilisée quand une page
 * desktop (focus_mensuel3, vision-tci…) est ouverte directement sur mobile
 * — par un lien partagé, un favori, un raccourci d'écran d'accueil — plutôt
 * que via le menu MobileShell.
 *
 * Même contenu que MobileActivite (composant réutilisé tel quel, pas
 * dupliqué), avec juste un lien de retour vers l'accueil mobile : on n'est
 * pas dans la state machine de MobileShell ici, donc pas de bouton "← Menu"
 * qui changerait un état local — un vrai lien de navigation vers /accueil.
 */
export default function MobileStandaloneActivite() {
  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#0B1220',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 16px',
          background: 'rgba(11,18,32,0.96)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          borderBottom: '1px solid rgba(255,255,255,0.10)',
        }}
      >
        <Link
          href="/accueil"
          style={{
            border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: 10,
            padding: '8px 12px',
            fontSize: 14,
            color: '#fff',
            textDecoration: 'none',
            fontFamily: 'var(--font-body)',
          }}
        >
          ← Accueil
        </Link>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>
          Mon activité
        </div>
      </div>

      <MobileActivite />
    </div>
  )
}
