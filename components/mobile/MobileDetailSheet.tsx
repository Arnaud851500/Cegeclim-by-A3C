'use client'

export type DetailField = { label: string; value: string }

/**
 * Fenêtre de détail générique en "bottom sheet", ouverte au tap sur une
 * ligne de liste (document, action...) — réutilisée par MobileClients et
 * MobileRdv plutôt que dupliquée.
 */
export default function MobileDetailSheet({
  title, subtitle, fields, onClose,
}: {
  title: string
  subtitle?: string
  fields: DetailField[]
  onClose: () => void
}) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(6,10,18,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 480, maxHeight: '80vh', overflowY: 'auto',
          background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          border: '1px solid rgba(255,255,255,0.08)', borderBottom: 'none',
          padding: '12px 18px 26px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 14px' }} />

        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{subtitle}</div>}

        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map((f) => (
            <div
              key={f.label}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 8 }}
            >
              <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.5)', flexShrink: 0 }}>{f.label}</span>
              <span style={{ fontSize: 13.5, color: '#fff', fontWeight: 600, textAlign: 'right' }}>{f.value || '—'}</span>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: 18, width: '100%', padding: '11px', borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)',
            fontSize: 13, fontWeight: 600,
          }}
        >
          Fermer
        </button>
      </div>
    </div>
  )
}
