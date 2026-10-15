'use client'

// Liste déroulante « Assignée à » du Compagnon mobile (2026-10-15) :
// groupes en premier (la tâche part chez tous les membres, le premier qui la
// traite la prend), puis les utilisateurs ayant le droit Tâches.

import { useEffect, useState } from 'react'
import type React from 'react'
import {
  GROUP_PREFIX,
  loadAssignmentOptions,
  type AssignmentOptions,
} from '@/lib/taskAssignment'

let cache: Promise<AssignmentOptions> | null = null

/** Options partagées entre les tiroirs ouverts dans la session (rechargées au besoin). */
export function useAssignmentOptions(): AssignmentOptions | null {
  const [options, setOptions] = useState<AssignmentOptions | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!cache) cache = loadAssignmentOptions().catch((e) => { cache = null; throw e })
    cache
      .then((o) => { if (!cancelled) setOptions(o) })
      .catch(() => { if (!cancelled) setOptions({ groups: [], users: [] }) })
    return () => { cancelled = true }
  }, [])
  return options
}

export function invalidateAssignmentOptions() {
  cache = null
}

export const assigneeSelectStyle: React.CSSProperties = {
  width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5,
}

export default function AssigneeSelect({
  value,
  onChange,
  options,
  myEmail,
  allowEmpty = true,
  style,
}: {
  /** email, `groupe:<id>` ou '' (non assignée) */
  value: string
  onChange: (value: string) => void
  options: AssignmentOptions | null
  myEmail?: string
  allowEmpty?: boolean
  style?: React.CSSProperties
}) {
  const users = options?.users || []
  const groups = options?.groups || []
  const horsListe = !!value && !value.startsWith(GROUP_PREFIX) && !users.some((u) => u.email === value.toLowerCase())
  const me = (myEmail || '').toLowerCase()

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...assigneeSelectStyle, ...style }}
      disabled={!options}
    >
      {!options && <option value={value}>Chargement…</option>}
      {options && allowEmpty && <option value="" style={{ color: '#000' }}>Non assignée</option>}
      {options && horsListe && <option value={value} style={{ color: '#000' }}>{value}</option>}
      {groups.length > 0 && (
        <optgroup label="Groupes — le premier qui traite la prend" style={{ color: '#000' }}>
          {groups.map((g) => (
            <option key={g.id} value={`${GROUP_PREFIX}${g.id}`} style={{ color: '#000' }}>
              👥 {g.name}{g.memberEmails.length ? ` (${g.memberEmails.length})` : ' (aucun membre)'}
            </option>
          ))}
        </optgroup>
      )}
      {users.length > 0 && (
        <optgroup label="Personnes" style={{ color: '#000' }}>
          {users.map((u) => (
            <option key={u.email} value={u.email} style={{ color: '#000' }}>
              {u.label}{u.email === me ? ' (moi)' : ''}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  )
}
