import { supabase } from '@/lib/supabaseClient'

export async function logUserEvent(payload: {
  user_email?: string | null
  event_type: string
  pathname?: string | null
  entity_type?: string | null
  entity_id?: string | null
  entity_label?: string | null
  field_name?: string | null
  old_value?: string | null
  new_value?: string | null
  metadata?: Record<string, unknown> | null
}) {
  try {
    await supabase.from('user_activity_log').insert({
      user_email: payload.user_email ?? null,
      event_type: payload.event_type,
      pathname: payload.pathname ?? null,
      entity_type: payload.entity_type ?? null,
      entity_id: payload.entity_id ?? null,
      entity_label: payload.entity_label ?? null,
      field_name: payload.field_name ?? null,
      old_value: payload.old_value ?? null,
      new_value: payload.new_value ?? null,
      metadata: payload.metadata ?? null,
    })
  } catch (error) {
    console.error('Erreur audit log:', error)
  }
}
type DiffAuditParams = {
  user_email?: string | null
  pathname?: string | null
  event_type: 'client_update' | 'client_cegeclim_update'
  entity_type: 'clients' | 'clients_cegeclim'
  entity_id?: string | null
  entity_label?: string | null
  before: Record<string, unknown>
  after: Record<string, unknown>
  trackedFields?: string[]
}

function normalizeAuditValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

export async function logRecordDiff(params: DiffAuditParams) {
  const {
    user_email,
    pathname,
    event_type,
    entity_type,
    entity_id,
    entity_label,
    before,
    after,
    trackedFields,
  } = params

  const keys = trackedFields && trackedFields.length > 0
    ? trackedFields
    : Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]))

  const rows = keys
    .map((fieldName) => {
      const oldValue = normalizeAuditValue(before?.[fieldName])
      const newValue = normalizeAuditValue(after?.[fieldName])

      if (oldValue === newValue) return null

      return {
        user_email: user_email ?? null,
        event_type,
        pathname: pathname ?? null,
        entity_type,
        entity_id: entity_id ?? null,
        entity_label: entity_label ?? null,
        field_name: fieldName,
        old_value: oldValue || null,
        new_value: newValue || null,
        metadata: null,
      }
    })
    .filter(Boolean)

  if (!rows.length) return

  try {
    const { error } = await supabase.from('user_activity_log').insert(rows)
    if (error) {
      console.error('Erreur audit diff:', error)
    }
  } catch (error) {
    console.error('Erreur audit diff:', error)
  }
}