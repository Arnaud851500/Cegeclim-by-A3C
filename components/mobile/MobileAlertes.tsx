'use client'

export interface AlertDetailItem {
  label: string
  count: number
  status: 'red' | 'orange' | 'green'
  onOpen?: () => void
}

export default function MobileAlertes({
  detail,
  loading,
}: {
  detail: AlertDetailItem[]
  loading: boolean
}) {
  const active = detail.filter((d) => d.count > 0)

  return (
    <div style={{ flex: 1, padding: '18px 16px 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {loading && <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Chargement…</div>}

      {!loading && active.length === 0 && (
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Aucune alerte en cours 🎉</div>
      )}

      {active.map((d) => (
        <button
          key={d.label}
          onClick={d.onOpen}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            textAlign: 'left',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 14,
            padding: '14px 16px',
            background: d.status === 'red' ? 'rgba(193,104,60,0.12)' : 'rgba(214,154,74,0.10)',
            color: '#fff',
          }}
        >
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>{d.label}</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 16,
              fontWeight: 700,
              color: d.status === 'red' ? '#C1683C' : '#D69A4A',
            }}
          >
            {d.count}
          </span>
        </button>
      ))}
    </div>
  )
}
