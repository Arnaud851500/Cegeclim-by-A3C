'use client'

/**
 * Filtre "Collaborateur" mobile (2026-09-10) -- même composant sur
 * "Mon activité" et "Mes clients". La liste d'options vient de
 * useCollaborateursPerimetre (périmètre agence / collaborateurs de
 * l'utilisateur). Masqué quand il n'y a qu'un seul collaborateur possible
 * (le périmètre s'applique déjà de force, un filtre n'apporterait rien).
 */
export default function MobileCollaborateurFilter({
  value,
  options,
  loading,
  onChange,
}: {
  value: string
  options: string[]
  loading?: boolean
  onChange: (v: string) => void
}) {
  if (!loading && options.length <= 1 && !value) return null
  const actif = Boolean(value)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>
        Collaborateur
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
        style={{
          flex: 1, minWidth: 0, height: 38, borderRadius: 999, padding: '0 12px', fontSize: 13, fontWeight: 600,
          border: `1px solid ${actif ? 'rgba(75,146,172,0.5)' : 'rgba(255,255,255,0.15)'}`,
          background: actif ? 'rgba(75,146,172,0.18)' : 'rgba(255,255,255,0.04)',
          color: actif ? '#8FC7DA' : 'rgba(255,255,255,0.75)',
        }}
      >
        <option value="">{loading ? 'Chargement…' : 'Tous'}</option>
        {options.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      {actif && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Retirer le filtre collaborateur"
          style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(193,104,60,0.4)', background: 'rgba(193,104,60,0.10)', color: '#e0a685', fontSize: 13 }}
        >
          ✕
        </button>
      )}
    </div>
  )
}
