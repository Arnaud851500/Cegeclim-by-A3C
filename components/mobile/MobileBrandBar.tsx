'use client'

const LOGO_CEGECLIM =
  'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/cegecilm%20officiel.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL2NlZ2VjaWxtIG9mZmljaWVsLmpwZyIsImlhdCI6MTc3NDY1MTM3OSwiZXhwIjo0ODk2NzE1Mzc5fQ.ePcMFHir7RsvdR-cR7nwh83H03S8oihNKwVgK2eCmy0'

/**
 * Remplace intégralement le bandeau desktop (menus déroulants, réglette
 * d'alertes) quand on est sur mobile — celui-ci ne tient pas sur un petit
 * écran et fait doublon avec la navigation propre à MobileShell /
 * MobileStandaloneActivite. Ne garde que l'essentiel : identité + déconnexion,
 * toujours visible en haut de chaque écran mobile.
 */
export default function MobileBrandBar({ onLogout }: { onLogout: () => void }) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '10px 14px',
        background: 'rgba(11,18,32,0.97)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.10)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <img
          src={LOGO_CEGECLIM}
          alt="CEGECLIM"
          style={{
            width: 30,
            height: 30,
            objectFit: 'contain',
            background: '#fff',
            borderRadius: 7,
            padding: 3,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 14.5,
            color: '#fff',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          Le compagnon CEGECLIM
        </span>
      </div>

      <button
        onClick={onLogout}
        style={{
          flexShrink: 0,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'transparent',
          color: 'rgba(255,255,255,0.75)',
          borderRadius: 9,
          padding: '6px 11px',
          fontFamily: 'var(--font-body)',
          fontSize: 12.5,
          fontWeight: 600,
        }}
      >
        Déconnexion
      </button>
    </div>
  )
}
