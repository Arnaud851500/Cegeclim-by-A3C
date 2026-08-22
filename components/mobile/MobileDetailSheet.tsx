'use client'

export type DetailField = { label: string; value: string }

/**
 * Fenêtre de détail générique en "bottom sheet", ouverte au tap sur une
 * ligne de liste (document, action...) — réutilisée par MobileClients et
 * MobileRdv plutôt que dupliquée.
 *
 * Layout empilé (libellé au-dessus, valeur en dessous) plutôt que côte à
 * côte : sur les lignes de documents commerciaux, le libellé (référence +
 * désignation article) peut être long, et un layout en colonnes forçait la
 * valeur ("30 × 296 €") dans une colonne trop étroite qui cassait mot par
 * mot / chiffre par chiffre. Empilé, chaque ligne s'étale sur toute la
 * largeur et reste lisible quelle que soit sa longueur, sans scroll horizontal.
 */
export default function MobileDetailSheet({
  title, subtitle, fields, footer, onClose,
}: {
  title: string
  subtitle?: string
  fields: DetailField[]
  /** Contenu optionnel affiché sous la liste des champs, avant "Fermer" —
   * utilisé pour les boutons vocaux sur les RDV, sans impact sur les autres
   * usages (documents, contacts) qui ne passent pas cette prop. */
  footer?: React.ReactNode
  onClose: () => void
}) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(6,10,18,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto',
          background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          border: '1px solid rgba(255,255,255,0.08)', borderBottom: 'none',
          padding: '12px 18px 26px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 14px' }} />

        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>{subtitle}</div>}

        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map((f, i) => (
            <div
              key={`${f.label}-${i}`}
              style={{
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(255,255,255,0.03)',
                padding: '8px 10px',
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.4,
                  color: 'rgba(255,255,255,0.55)',
                  wordBreak: 'break-word',
                }}
              >
                {f.label}
              </div>
              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.4,
                  color: '#fff',
                  fontWeight: 600,
                  marginTop: 3,
                  wordBreak: 'break-word',
                }}
              >
                {f.value || '—'}
              </div>
            </div>
          ))}
        </div>

        {footer}

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
