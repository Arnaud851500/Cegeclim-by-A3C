'use client'

/**
 * Petits tiroirs d'action réutilisables, partagés entre plusieurs écrans
 * mobiles (fiche client, contacts, prospects) :
 * - NavigationChoiceSheet : choix de l'app de navigation (Plans / Google
 *   Maps / Waze) vers une adresse ou des coordonnées GPS.
 * - PhoneChoiceSheet : choix entre appeler ou envoyer un SMS.
 *
 * Utilise des liens https:// universels (pas de schéma custom type
 * comgooglemaps://) : ça ouvre l'app native si elle est installée, sinon
 * bascule proprement sur la version web -- pas besoin de détecter quelles
 * apps sont présentes sur le téléphone.
 */

function sheetOverlayStyle(): React.CSSProperties {
  return { position: 'fixed', inset: 0, zIndex: 260, background: 'rgba(6,10,18,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }
}
function sheetPanelStyle(): React.CSSProperties {
  return { width: '100%', maxWidth: 480, background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.08)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 8 }
}
function optionBtnStyle(): React.CSSProperties {
  return { display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 15, fontWeight: 600, textAlign: 'left' }
}

export function NavigationChoiceSheet({
  adresse,
  lat,
  lon,
  onClose,
}: {
  /** Adresse texte complète (utilisée pour Waze et en secours si pas de coordonnées). */
  adresse: string
  lat?: number | null
  lon?: number | null
  onClose: () => void
}) {
  const aCoords = typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)
  const destCoord = aCoords ? `${lat},${lon}` : ''
  const destTexte = encodeURIComponent(adresse || '')

  const options = [
    { label: '🍏 Plans (Apple)', url: `https://maps.apple.com/?daddr=${aCoords ? destCoord : destTexte}` },
    { label: '🗺️ Google Maps', url: `https://www.google.com/maps/dir/?api=1&destination=${aCoords ? destCoord : destTexte}` },
    { label: '🚗 Waze', url: aCoords ? `https://waze.com/ul?ll=${destCoord}&navigate=yes` : `https://waze.com/ul?q=${destTexte}&navigate=yes` },
  ]

  return (
    <div style={sheetOverlayStyle()} onClick={onClose}>
      <div style={sheetPanelStyle()} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 6px' }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Naviguer vers</div>
        {adresse && <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>{adresse}</div>}
        {options.map((o) => (
          <a key={o.label} href={o.url} target="_blank" rel="noopener noreferrer" style={optionBtnStyle()} onClick={onClose}>
            {o.label}
          </a>
        ))}
        <button type="button" onClick={onClose} style={{ marginTop: 6, padding: '11px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}>
          Annuler
        </button>
      </div>
    </div>
  )
}

export function PhoneChoiceSheet({ telephone, onClose }: { telephone: string; onClose: () => void }) {
  const numeroPropre = telephone.replace(/[^\d+]/g, '')
  return (
    <div style={sheetOverlayStyle()} onClick={onClose}>
      <div style={sheetPanelStyle()} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 6px' }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{telephone}</div>
        <a href={`tel:${numeroPropre}`} style={optionBtnStyle()} onClick={onClose}>📞 Appeler</a>
        <a href={`sms:${numeroPropre}`} style={optionBtnStyle()} onClick={onClose}>💬 Envoyer un SMS</a>
        <button type="button" onClick={onClose} style={{ marginTop: 6, padding: '11px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}>
          Annuler
        </button>
      </div>
    </div>
  )
}
