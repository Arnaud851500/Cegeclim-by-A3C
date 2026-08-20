'use client'

export type ListSheetItem = {
  id: string
  primary: string
  secondary?: string
  trailing?: string
  trailingColor?: string
  onClick?: () => void
}

/**
 * Fenêtre "liste" en bottom-sheet — étape intermédiaire entre un compteur
 * (ex. "À faire : 12") et le détail d'un élément (MobileDetailSheet).
 * Chaque ligne peut avoir son propre onClick pour ouvrir le détail par
 *-dessus cette liste (empilement de sheets, navigation fluide sans
 * changement d'écran).
 */
export default function MobileListSheet({
  title, subtitle, items, loading, emptyText = 'Aucun élément.', onClose,
}: {
  title: string
  subtitle?: string
  items: ListSheetItem[]
  loading?: boolean
  emptyText?: string
  onClose: () => void
}) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 205, background: 'rgba(6,10,18,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 480, maxHeight: '82vh', display: 'flex', flexDirection: 'column',
          background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          border: '1px solid rgba(255,255,255,0.08)', borderBottom: 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '12px auto 10px' }} />

        <div style={{ padding: '0 18px 12px', flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ color: 'rgba(255,255,255,0.4)', fontSize: 20, lineHeight: 1, background: 'none', border: 'none', flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', padding: '0 18px 24px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading ? (
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '20px 0', textAlign: 'center' }}>Chargement…</div>
          ) : items.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '20px 0', textAlign: 'center' }}>{emptyText}</div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                onClick={item.onClick}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                  borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)',
                  padding: '10px 12px', cursor: item.onClick ? 'pointer' : 'default',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.primary}
                  </div>
                  {item.secondary && (
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.secondary}
                    </div>
                  )}
                </div>
                {item.trailing && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: item.trailingColor || 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {item.trailing}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
