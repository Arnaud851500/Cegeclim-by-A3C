'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type UserPageAccess = {
  email: string
  display_name: string | null
  can_todo: boolean
}

type TodoRow = {
  id: string
  created_at: string
  updated_at: string
  created_by_email: string
  created_by_name: string
  mission_project: string | null
  description_action: string | null
  assigned_to: string | null
  due_date: string | null
  status: 'Non débuté' | 'En cours' | 'Terminé' | 'Annulé'
  comment_progress: string | null
  sort_order: number
}

const STATUS_OPTIONS: TodoRow['status'][] = [
  'Non débuté',
  'En cours',
  'Terminé',
  'Annulé',
]

export default function TodoPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const [currentEmail, setCurrentEmail] = useState('')
  const [currentDisplayName, setCurrentDisplayName] = useState('')

  const [canTodo, setCanTodo] = useState(false)
  const [assignees, setAssignees] = useState<string[]>([])
  const [rows, setRows] = useState<TodoRow[]>([])

  const autosaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    init()
  }, [])

  async function init() {
    setLoading(true)

    const { data: authData } = await supabase.auth.getUser()
    const user = authData?.user

    if (!user?.email) {
      router.push('/login')
      return
    }

    const email = user.email
    setCurrentEmail(email)

    const { data: access, error: accessError } = await supabase
      .from('user_page_access')
      .select('email, display_name, can_todo')
      .eq('email', email)
      .maybeSingle<UserPageAccess>()

    if (accessError || !access?.can_todo) {
      router.push('/')
      return
    }

    const displayName = access.display_name?.trim() || email.split('@')[0]
    setCurrentDisplayName(displayName)
    setCanTodo(true)

    const { data: usersData } = await supabase
      .from('user_page_access')
      .select('display_name, email, can_todo')
      .eq('can_todo', true)
      .order('display_name', { ascending: true })

    const assigneeNames =
      (usersData || [])
        .map((u: any) => (u.display_name?.trim() || u.email?.split('@')[0] || '').trim())
        .filter(Boolean)

    setAssignees(Array.from(new Set(assigneeNames)))

    await loadRows()

    setLoading(false)
  }

  async function loadRows() {
    const { data, error } = await supabase
      .from('todo_actions')
      .select('*')
      .order('status', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })

    if (error) {
      console.error(error)
      return
    }

    setRows((data || []) as TodoRow[])
  }

  function sortRows(list: TodoRow[]) {
    return [...list].sort((a, b) => {
      const aDone = a.status === 'Terminé' || a.status === 'Annulé'
      const bDone = b.status === 'Terminé' || b.status === 'Annulé'

      if (aDone !== bDone) return aDone ? 1 : -1

      const da = a.due_date || '9999-12-31'
      const db = b.due_date || '9999-12-31'
      if (da !== db) return da.localeCompare(db)

      return (a.sort_order || 0) - (b.sort_order || 0)
    })
  }

  const activeRows = useMemo(
    () => sortRows(rows.filter(r => r.status !== 'Terminé' && r.status !== 'Annulé')),
    [rows]
  )

  const closedRows = useMemo(
    () => sortRows(rows.filter(r => r.status === 'Terminé' || r.status === 'Annulé')),
    [rows]
  )

  async function addRow() {
    if (!canTodo) return

    const maxSort = rows.reduce((m, r) => Math.max(m, r.sort_order || 0), 0)

    const payload = {
      created_by_email: currentEmail,
      created_by_name: currentDisplayName,
      mission_project: '',
      description_action: '',
      assigned_to: '',
      due_date: null,
      status: 'Non débuté' as TodoRow['status'],
      comment_progress: '',
      sort_order: maxSort + 1,
    }

    const { data, error } = await supabase
      .from('todo_actions')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      console.error(error)
      alert("Impossible de créer la tâche.")
      return
    }

    setRows(prev => sortRows([data as TodoRow, ...prev]))
  }

  async function deleteRow(id: string) {
    const ok = window.confirm('Supprimer cette tâche ?')
    if (!ok) return

    const { error } = await supabase.from('todo_actions').delete().eq('id', id)
    if (error) {
      console.error(error)
      alert("Impossible de supprimer la tâche.")
      return
    }

    setRows(prev => prev.filter(r => r.id !== id))
  }

  function updateLocal(id: string, patch: Partial<TodoRow>) {
    setRows(prev =>
      prev.map(r => (r.id === id ? { ...r, ...patch } : r))
    )
  }

  function queueSave(id: string, patch: Partial<TodoRow>) {
    updateLocal(id, patch)

    if (autosaveTimers.current[id]) {
      clearTimeout(autosaveTimers.current[id])
    }

    autosaveTimers.current[id] = setTimeout(() => {
      saveRow(id, patch)
    }, 350)
  }

  async function saveRow(id: string, patch: Partial<TodoRow>) {
    setSavingId(id)

    const { error } = await supabase
      .from('todo_actions')
      .update(patch)
      .eq('id', id)

    setSavingId(prev => (prev === id ? null : prev))

    if (error) {
      console.error(error)
      alert("Erreur lors de l'enregistrement.")
    }
  }

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          Chargement...
        </div>
      </div>
    )
  }

  if (!canTodo) return null

  return (
    <div className="p-4 md:p-6">
      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-bold">TODO List</h1>
            <p className="text-sm text-slate-500">
              Gestion des actions avec séparation automatique des tâches en cours et clôturées
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={addRow}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              + Nouvelle tâche
            </button>
          </div>
        </div>

        <div className="p-4 md:p-6">
          <TodoSection
            title="TODO LIST (tâches non terminées)"
            rows={activeRows}
            assignees={assignees}
            savingId={savingId}
            queueSave={queueSave}
            deleteRow={deleteRow}
            autoResize={autoResize}
          />

          <div className="h-8" />

          <TodoSection
            title="Liste des tâches terminées ou annulées"
            rows={closedRows}
            assignees={assignees}
            savingId={savingId}
            queueSave={queueSave}
            deleteRow={deleteRow}
            autoResize={autoResize}
          />
        </div>
      </div>
    </div>
  )
}

function TodoSection({
  title,
  rows,
  assignees,
  savingId,
  queueSave,
  deleteRow,
  autoResize,
}: {
  title: string
  rows: TodoRow[]
  assignees: string[]
  savingId: string | null
  queueSave: (id: string, patch: Partial<TodoRow>) => void
  deleteRow: (id: string) => void
  autoResize: (el: HTMLTextAreaElement) => void
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold">{title}</h2>
        <div className="text-xs text-slate-500">{rows.length} tâche(s)</div>
      </div>

      <div className="overflow-x-auto rounded-2xl border">
        <table className="min-w-[1500px] w-full border-collapse text-sm">
          <colgroup>
            <col style={{ width: '140px' }} />
            <col style={{ width: '220px' }} />
            <col style={{ width: '420px' }} />
            <col style={{ width: '220px' }} />
            <col style={{ width: '140px' }} />
            <col style={{ width: '150px' }} />
            <col style={{ width: '420px' }} />
            <col style={{ width: '90px' }} />
          </colgroup>

          <thead className="bg-slate-100">
            <tr>
              <Th>Créée par</Th>
              <Th>Mission / Projet</Th>
              <Th>Description action</Th>
              <Th>Assignée à</Th>
              <Th>Pour le :</Th>
              <Th>Statut</Th>
              <Th>Commentaire - avancement</Th>
              <Th></Th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                  Aucune tâche dans cette section
                </td>
              </tr>
            ) : (
              rows.map(row => (
                <tr key={row.id} className="align-top odd:bg-white even:bg-slate-50/50">
                  <Td>
                    <div className="min-h-[42px] px-2 py-2 font-medium">
                      {row.created_by_name}
                    </div>
                  </Td>

                  <Td>
                    <input
                      value={row.mission_project || ''}
                      onChange={e => queueSave(row.id, { mission_project: e.target.value })}
                      className="min-h-[42px] w-full border-0 bg-transparent px-2 py-2 outline-none"
                      style={{
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    />
                  </Td>

                  <Td>
                    <textarea
                      value={row.description_action || ''}
                      onChange={e => queueSave(row.id, { description_action: e.target.value })}
                      onInput={e => autoResize(e.currentTarget)}
                      rows={1}
                      className="w-full resize-none border-0 bg-transparent px-2 py-2 leading-5 outline-none"
                      style={{
                        overflow: 'hidden',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    />
                  </Td>

                  <Td>
                    <select
                      value={row.assigned_to || ''}
                      onChange={e => queueSave(row.id, { assigned_to: e.target.value })}
                      className="min-h-[42px] w-full border-0 bg-transparent px-2 py-2 outline-none"
                    >
                      <option value="">--</option>
                      {assignees.map(name => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </Td>

                  <Td>
                    <input
                      type="date"
                      value={row.due_date || ''}
                      onChange={e => queueSave(row.id, { due_date: e.target.value || null })}
                      className="min-h-[42px] w-full border-0 bg-transparent px-2 py-2 outline-none"
                    />
                  </Td>

                  <Td>
                    <select
                      value={row.status}
                      onChange={e => queueSave(row.id, { status: e.target.value as TodoRow['status'] })}
                      className="min-h-[42px] w-full border-0 bg-transparent px-2 py-2 outline-none"
                    >
                      {STATUS_OPTIONS.map(status => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </Td>

                  <Td>
                    <textarea
                      value={row.comment_progress || ''}
                      onChange={e => queueSave(row.id, { comment_progress: e.target.value })}
                      onInput={e => autoResize(e.currentTarget)}
                      rows={1}
                      className="w-full resize-none border-0 bg-transparent px-2 py-2 leading-5 outline-none"
                      style={{
                        overflow: 'hidden',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    />
                  </Td>

                  <Td>
                    <div className="flex min-h-[42px] items-start justify-center px-2 py-2">
                      <button
                        onClick={() => deleteRow(row.id)}
                        className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-100"
                        title="Supprimer"
                      >
                        🗑
                      </button>
                    </div>
                    {savingId === row.id && (
                      <div className="pb-2 text-center text-[10px] text-slate-400">
                        Enreg.
                      </div>
                    )}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="border-b border-r px-3 py-3 text-left font-bold last:border-r-0">
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="border-r border-b align-top last:border-r-0">{children}</td>
}