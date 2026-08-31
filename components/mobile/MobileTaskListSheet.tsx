'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export type TaskListItem = {
  id: string
  description_action: string | null
  status: string
  due_date: string | null
  numero_tiers: string | null
  assigned_to: string | null
}

/**
 * Liste de tâches en bottom-sheet, mise en page en colonnes (n° client /
 * pastille de couleur / désignation / échéance) avec une case à cocher
 * pour terminer une tâche directement depuis la liste, sans ouvrir sa
 * fiche complète.
 *
 * Remplace MobileListSheet spécifiquement pour l'affichage des tâches
 * (todo_actions) : MobileListSheet reste utilisé tel quel pour les autres
 * types d'alertes (CERFA, CDC < 2026, frais de port, capacité gaz), dont
 * le contenu ne colle pas à ce format en colonnes. Alimenté directement
 * par fetchTodoList() de useMobileAlertsCount.tsx -- même forme de ligne
 * (id, description_action, status, due_date, numero_tiers, assigned_to),
 * aucune transformation nécessaire côté appelant.
 *
 * Couleur de la pastille : reprend exactement la même logique à 3 états
 * que statutPastille() dans MobileAlertes.tsx (🔴/🟠/🟢) -- rouge si
 * l'échéance est dépassée, orange si elle tombe aujourd'hui ou dans les 4
 * prochains jours, vert au-delà ou si aucune échéance n'est renseignée
 * (pas d'échéance = rien d'urgent, pas un état "neutre" à part).
 */

function formatDateFr(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

function pastilleCouleur(task: TaskListItem): string {
  if (!task.due_date) return '#3F9142' // pas d'échéance -- rien d'urgent
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const echeance = new Date(`${task.due_date}T00:00:00`)
  if (Number.isNaN(echeance.getTime())) return '#3F9142'
  const diffJours = Math.round((echeance.getTime() - today.getTime()) / 86400000)
  if (diffJours < 0) return '#C1683C' // en retard
  if (diffJours <= 4) return '#D69A4A' // aujourd'hui à 4 jours
  return '#3F9142' // au-delà de 4 jours
}

export default function MobileTaskListSheet({
  title,
  subtitle,
  tasks,
  loading,
  emptyText = 'Aucune tâche.',
  onClose,
  onOpenTask,
  onTaskCompleted,
}: {
  title: string
  subtitle?: string
  tasks: TaskListItem[]
  loading?: boolean
  emptyText?: string
  onClose: () => void
  /** Ouvre la fiche complète de la tâche (MobileTaskDetailSheet) -- tap sur
   * la ligne, en dehors de la case à cocher. */
  onOpenTask?: (task: TaskListItem) => void
  /** Notifie le parent qu'une tâche vient d'être terminée, pour qu'il la
   * retire de sa liste locale (compteur inclus) sans refaire un fetch
   * complet -- même logique que onActionSaved dans MobileClients. */
  onTaskCompleted?: (id: string) => void
}) {
  // Tâches dont la case vient d'être cochée : grisées immédiatement
  // (retour visuel instantané), puis effectivement retirées de la liste
  // par le parent via onTaskCompleted une fois l'écriture confirmée.
  const [enCours, setEnCours] = useState<Set<string>>(new Set())
  const [enErreur, setEnErreur] = useState<Set<string>>(new Set())

  async function terminer(task: TaskListItem) {
    if (enCours.has(task.id)) return
    setEnCours((prev) => new Set(prev).add(task.id))
    setEnErreur((prev) => {
      if (!prev.has(task.id)) return prev
      const next = new Set(prev)
      next.delete(task.id)
      return next
    })
    try {
      const { error } = await supabase.from('todo_actions').update({ status: 'Terminé' }).eq('id', task.id)
      if (error) throw error
      onTaskCompleted?.(task.id)
    } catch (err) {
      console.error('[MobileTaskListSheet] échec pour terminer la tâche', err)
      setEnCours((prev) => {
        const next = new Set(prev)
        next.delete(task.id)
        return next
      })
      setEnErreur((prev) => new Set(prev).add(task.id))
    }
  }

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
          ) : tasks.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '20px 0', textAlign: 'center' }}>{emptyText}</div>
          ) : (
            tasks.map((task) => {
              const termine = enCours.has(task.id)
              const echoueApresCochage = enErreur.has(task.id)
              return (
                <div
                  key={task.id}
                  onClick={() => onOpenTask?.(task)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    borderRadius: 12,
                    border: `1px solid ${echoueApresCochage ? 'rgba(193,104,60,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    background: 'rgba(255,255,255,0.03)',
                    padding: '10px 12px',
                    cursor: onOpenTask ? 'pointer' : 'default',
                    opacity: termine ? 0.45 : 1,
                    transition: 'opacity 0.15s ease',
                  }}
                >
                  {/* Colonne 1 : n° client */}
                  <span
                    style={{
                      fontSize: 12, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.55)',
                      flexShrink: 0, minWidth: 48, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}
                  >
                    {task.numero_tiers || '—'}
                  </span>

                  {/* Colonne 2 : pastille de couleur (urgence de l'échéance) */}
                  <span
                    aria-hidden="true"
                    style={{ width: 8, height: 8, borderRadius: '50%', background: pastilleCouleur(task), flexShrink: 0 }}
                  />

                  {/* Colonne 3 : désignation */}
                  <span
                    style={{
                      fontSize: 13.5, color: '#fff', flex: 1, minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      textDecoration: termine ? 'line-through' : 'none',
                    }}
                  >
                    {task.description_action || '(sans libellé)'}
                  </span>

                  {/* Colonne 4 : échéance */}
                  {task.due_date && (
                    <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {formatDateFr(task.due_date)}
                    </span>
                  )}

                  {/* Case à cocher : termine la tâche sans ouvrir sa fiche */}
                  <input
                    type="checkbox"
                    checked={termine}
                    disabled={termine}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => void terminer(task)}
                    aria-label={`Terminer la tâche : ${task.description_action || ''}`}
                    style={{ width: 18, height: 18, flexShrink: 0, accentColor: '#3F9142', cursor: termine ? 'default' : 'pointer' }}
                  />
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
