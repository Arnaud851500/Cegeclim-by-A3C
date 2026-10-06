'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
// ÉVOLUTION (2026-09-29) : journal d'usage mobile (/m/... dans user_activity_log)
import { logMobileView } from '@/lib/mobileActivityLog'

export type TaskRow = {
  id: string
  description_action: string | null
  status: string
  due_date: string | null
  numero_tiers: string | null
  assigned_to: string | null
  /** Optionnels : présents quand la ligne vient d'un select('*'), absents dans les listes d'alertes. */
  category_id?: string | null
  team_id?: string | null
  concerned_person?: string | null
}

type RefItem = { id: string; name: string; color: string; is_active: boolean; sort_order: number }
/** Utilisateur proposé dans « Confiée à » (user_page_access, droit can_todo). */
type AssigneeOption = { email: string; label: string }

const STATUS_OPTIONS = ['Non débuté', 'En cours', 'Terminé', 'Annulé']

function normalizeKey(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

/**
 * Personnes concernées déjà saisies sur les tâches (dédoublonnées sans tenir
 * compte des accents / majuscules) : proposées en suggestion pour éviter
 * « Kevin » / « kévin » / « Kevin  » qui créeraient des groupes distincts.
 */
async function fetchConcernedPersons(): Promise<string[]> {
  const { data, error } = await supabase
    .from('todo_actions')
    .select('concerned_person')
    .not('concerned_person', 'is', null)
    .limit(5000)
  if (error || !data) return []
  const map = new Map<string, string>()
  ;(data as Array<{ concerned_person: string | null }>).forEach((row) => {
    const value = String(row.concerned_person || '').trim()
    if (!value) return
    const key = normalizeKey(value)
    if (!map.has(key)) map.set(key, value)
  })
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
}

/**
 * Fiche tâche éditable en bottom-sheet — variante de MobileDetailSheet
 * dédiée à todo_actions. Permet de modifier description, catégorie,
 * projet / équipe, personne concernée, « Confiée à », statut et échéance.
 *
 * ÉVOLUTION (2026-10-06) : la fiche est séparée en deux blocs pour lever
 * l'ambiguïté entre classement et affectation :
 *   - « Classement » : catégorie, projet / équipe, personne concernée
 *     (la personne concernée sert uniquement à ranger / trier la tâche,
 *     elle ne la confie à personne) ;
 *   - « Réalisation » : confiée à, statut, échéance.
 * La personne concernée propose les noms déjà saisis (suggestions).
 *
 * Si la tâche reçue ne porte pas category_id / team_id / concerned_person
 * (listes d'alertes qui ne sélectionnent que quelques colonnes), ces trois
 * champs sont rechargés depuis la base à l'ouverture.
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
  const [categoryId, setCategoryId] = useState<string>(task.category_id || '')
  const [teamId, setTeamId] = useState<string>(task.team_id || '')
  const [concernedPerson, setConcernedPerson] = useState(task.concerned_person || '')
  const [initial, setInitial] = useState({
    category_id: task.category_id || '',
    team_id: task.team_id || '',
    concerned_person: task.concerned_person || '',
  })

  const [categories, setCategories] = useState<RefItem[]>([])
  const [teams, setTeams] = useState<RefItem[]>([])
  const [assignees, setAssignees] = useState<AssigneeOption[]>([])
  const [personSuggestions, setPersonSuggestions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ÉVOLUTION (2026-09-29) : journal d'usage -- ouverture d'une tâche
  useEffect(() => {
    logMobileView('taches/fiche', { type: 'tache', id: task.id, label: task.numero_tiers })
  }, [task.id, task.numero_tiers])

  useEffect(() => {
    let cancelled = false

    async function load() {
      // « Confiée à » : utilisateurs ayant le droit Todo (user_page_access.
      // can_todo), valeur enregistrée = email (format de assigned_to).
      const [{ data: cats }, { data: tms }, { data: users }, persons] = await Promise.all([
        supabase.from('todo_categories').select('id, name, color, is_active, sort_order').order('sort_order'),
        supabase.from('todo_teams').select('id, name, color, is_active, sort_order').order('sort_order'),
        supabase.from('user_page_access').select('email, display_name').eq('can_todo', true),
        fetchConcernedPersons(),
      ])
      if (cancelled) return
      setCategories((cats || []) as RefItem[])
      setTeams((tms || []) as RefItem[])
      setPersonSuggestions(persons)
      const options = ((users || []) as Array<{ email: string | null; display_name: string | null }>)
        .filter((u) => !!u.email)
        .map((u) => ({ email: String(u.email).trim(), label: (u.display_name || '').trim() || String(u.email) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }))
      setAssignees(options)

      // Les champs de classement ne sont pas toujours fournis par le parent.
      const missing = task.category_id === undefined || task.team_id === undefined || task.concerned_person === undefined
      if (missing) {
        const { data } = await supabase
          .from('todo_actions')
          .select('category_id, team_id, concerned_person')
          .eq('id', task.id)
          .maybeSingle<{ category_id: string | null; team_id: string | null; concerned_person: string | null }>()
        if (cancelled || !data) return
        const next = {
          category_id: data.category_id || '',
          team_id: data.team_id || '',
          concerned_person: data.concerned_person || '',
        }
        setInitial(next)
        setCategoryId(next.category_id)
        setTeamId(next.team_id)
        setConcernedPerson(next.concerned_person)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [task.id, task.category_id, task.team_id, task.concerned_person])

  const dirty =
    description !== (task.description_action || '') ||
    status !== (task.status || 'Non débuté') ||
    dueDate !== (task.due_date || '') ||
    assignedTo !== (task.assigned_to || '') ||
    categoryId !== initial.category_id ||
    teamId !== initial.team_id ||
    concernedPerson !== initial.concerned_person

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const category = categories.find((c) => c.id === categoryId)
      const payload = {
        description_action: description.trim() || null,
        status,
        due_date: dueDate || null,
        assigned_to: assignedTo.trim() || null,
        category_id: categoryId || null,
        // Le texte « mission » suit la catégorie, pour les écrans qui l'affichent encore.
        mission_project: category ? category.name : '',
        team_id: teamId || null,
        concerned_person: concernedPerson.trim() || null,
      }
      const { error: updateError } = await supabase.from('todo_actions').update(payload).eq('id', task.id)

      if (updateError) throw updateError

      onSaved?.({
        ...task,
        description_action: payload.description_action,
        status: payload.status,
        due_date: payload.due_date,
        assigned_to: payload.assigned_to,
        category_id: payload.category_id,
        team_id: payload.team_id,
        concerned_person: payload.concerned_person,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const visibleCategories = categories.filter((c) => c.is_active || c.id === categoryId)
  const visibleTeams = teams.filter((t) => t.is_active || t.id === teamId)

  // Valeur actuelle absente de la liste (anciennes saisies libres type
  // « Maxime.L », ou utilisateur sans droit Todo) : conservée comme option
  // pour ne rien modifier à l'insu de l'utilisateur.
  const assigneeCourantHorsListe =
    !!assignedTo && !assignees.some((a) => a.email.toLowerCase() === assignedTo.toLowerCase())
  const assigneeSelectValue =
    assignees.find((a) => a.email.toLowerCase() === assignedTo.toLowerCase())?.email ?? assignedTo

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
          width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto',
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

          <SectionTitle title="Classement" hint="Sert uniquement à ranger et trier la tâche" />

          <Field label="Catégorie">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <ChoiceChip active={!categoryId} color="#8A8375" onClick={() => setCategoryId('')}>
                Aucune
              </ChoiceChip>
              {visibleCategories.map((cat) => (
                <ChoiceChip key={cat.id} active={categoryId === cat.id} color={cat.color} onClick={() => setCategoryId(cat.id)}>
                  {cat.name}
                </ChoiceChip>
              ))}
            </div>
          </Field>

          <Field label="Projet / équipe">
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} style={inputStyle}>
              <option value="" style={{ color: '#000' }}>Aucun</option>
              {visibleTeams.map((team) => (
                <option key={team.id} value={team.id} style={{ color: '#000' }}>
                  {team.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Personne concernée"
            hint="Classement uniquement : de qui parle la tâche. Ne confie pas la tâche à cette personne (voir « Confiée à »)."
          >
            <input
              value={concernedPerson}
              onChange={(e) => setConcernedPerson(e.target.value)}
              placeholder="Ex. Kevin, Yoann (Angoulême)…"
              list="concerned-person-suggestions-detail"
              autoComplete="off"
              style={inputStyle}
            />
            <datalist id="concerned-person-suggestions-detail">
              {personSuggestions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>

          <SectionTitle title="Réalisation" hint="Qui fait la tâche, et pour quand" />

          <Field label="Confiée à">
            <select value={assigneeSelectValue} onChange={(e) => setAssignedTo(e.target.value)} style={inputStyle}>
              <option value="" style={{ color: '#000' }}>Non attribuée</option>
              {assigneeCourantHorsListe && (
                <option value={assignedTo} style={{ color: '#000' }}>
                  {assignedTo} (saisie libre)
                </option>
              )}
              {assignees.map((a) => (
                <option key={a.email} value={a.email} style={{ color: '#000' }}>
                  {a.label}
                </option>
              ))}
            </select>
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
            Échec de l&apos;enregistrement : {error}
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

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ marginTop: 4, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#e4dfc9' }}>{title}</div>
      {hint && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
        {label}
      </span>
      {hint && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: -3, lineHeight: 1.35 }}>{hint}</span>}
      {children}
    </div>
  )
}

function ChoiceChip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean
  color: string
  onClick: () => void
  children: React.ReactNode
}) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#8A8375'
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        borderRadius: 999,
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        border: active ? '1px solid transparent' : '1px solid rgba(255,255,255,0.18)',
        background: active ? safe : 'rgba(255,255,255,0.05)',
        color: active ? '#fff' : 'rgba(255,255,255,0.75)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {!active && <span style={{ width: 8, height: 8, borderRadius: '50%', background: safe, display: 'inline-block' }} />}
      {children}
    </button>
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
