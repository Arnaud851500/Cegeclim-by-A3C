'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export type TaskRow = {
  id: string
  description_action: string | null
  status: string
  due_date: string | null
  numero_tiers: string | null
  assigned_to: string | null
}

const STATUS_OPTIONS = ['Non débuté', 'En cours', 'Terminé']

/**
 * Fiche tâche éditable en bottom-sheet — variante de MobileDetailSheet
 * dédiée à todo_actions. Contrairement à MobileDetailSheet (lecture seule,
 * partagé par MobileClients/MobileRdv), ce composant permet de modifier
 * assigned_to / status / due_date / description_action et de sauvegarder
 * directement via Supabase.
 *
 * onSaved(updatedTask) est appelé après une sauvegarde réussie, pour que le
 * parent puisse mettre à jour sa liste localement sans refaire un fetch complet.
 */
export default function MobileTaskDetailSheet({
  task,
  onClose,
  onSaved,
}: {
  task: TaskRow
  onClose: () => void
  onSaved?: (updated: TaskRow) => void
}) {
  const [description, setDescription] = useState(task.description_action || '')
  const [status, setStatus] = useState(task.status || 'Non débuté')
  const [dueDate, setDueDate] = useState(task.due_date || '')
  const [assignedTo, setAssignedTo] = useState(task.assigned_to || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty =
    description !== (task.description_action || '') ||
    status !== (task.status || 'Non débuté') ||
    dueDate !== (task.due_date || '') ||
    assignedTo !== (task.assigned_to || '')

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        description_action: description.trim() || null,
        status,
        due_date: dueDate || null,
        assigned_to: assignedTo.trim() || null,
      }
      const { error: updateError } = await supabase
        .from('todo_actions')
        .update(payload)
        .eq('id', task.id)

      if (updateError) throw updateError

      onSaved?.({ ...task, ...payload })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(6,10,18,0.62)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 480, maxHeight: '86vh', overflowY: 'auto',
          background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          border: '1px solid rgba(255,255,255,0.08)', borderBottom: 'none',
          padding: '12px 18px 26px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 14px' }} />

        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Modifier la tâche</div>
        {task.numero_tiers && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Client {task.numero_tiers}</div>
        )}

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Action">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={inputStyle}
            />
          </Field>

          <Field label="Assigné à">
            <input
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              placeholder="Nom du collaborateur"
              style={inputStyle}
            />
          </Field>

          <Field label="Statut">
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s} style={{ color: '#000' }}>
                  {s}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Échéance">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              style={inputStyle}
            />
          </Field>
        </div>

        {error && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#e0a685' }}>
            Échec de l'enregistrement : {error}
          </div>
        )}

        <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              flex: 1, padding: '11px', borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)',
              fontSize: 13, fontWeight: 600,
            }}
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            style={{
              flex: 1, padding: '11px', borderRadius: 12,
              border: '1px solid rgba(166,161,129,0.4)',
              background: dirty ? 'rgba(166,161,129,0.2)' : 'rgba(166,161,129,0.08)',
              color: dirty ? '#e4dfc9' : 'rgba(228,223,201,0.4)',
              fontSize: 13, fontWeight: 600,
            }}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
        {label}
      </span>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  padding: '10px 12px',
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
  resize: 'vertical',
}
