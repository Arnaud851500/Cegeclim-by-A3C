// =============================================================================
// Affectation des tâches (2026-10-15) — règles communes mobile / PC
// =============================================================================
// * « Assignée à » = liste déroulante : GROUPES en premier, puis utilisateurs.
// * Groupe = équipe todo_teams (membres gérés dans Paramétrage de la page
//   Tâches par l'Administrateur). Affecter à un groupe = team_id renseigné et
//   assigned_to vide : tous les membres la voient « à faire ».
// * La première personne qui traite la tâche (« Je la prends » ou changement
//   de statut) la prend : assigned_to = son email, elle disparaît chez les
//   autres membres (règle SQL todo_est_a_faire_pour + trigger de prise).
// * Échéance par défaut : vendredi de la semaine en cours (le samedi et le
//   dimanche, vendredi suivant).
// =============================================================================

import { supabase } from '@/lib/supabaseClient'

export const GROUP_PREFIX = 'groupe:'

export type AssignmentGroup = { id: string; name: string; color: string | null; memberEmails: string[] }
export type AssignmentUser = { email: string; label: string }
export type AssignmentOptions = { groups: AssignmentGroup[]; users: AssignmentUser[] }

function iso(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const j = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${j}`
}

/** Vendredi de la semaine en cours (samedi / dimanche → vendredi suivant), en date locale. */
export function finDeSemaineIso(from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const jour = d.getDay() // 0 = dimanche … 6 = samedi
  const delta = jour === 6 ? 6 : jour === 0 ? 5 : 5 - jour
  d.setDate(d.getDate() + delta)
  return iso(d)
}

/** Groupes actifs (avec leurs membres) puis utilisateurs ayant le droit Tâches. */
export async function loadAssignmentOptions(): Promise<AssignmentOptions> {
  const [{ data: teams }, { data: members }, { data: users }] = await Promise.all([
    supabase.from('todo_teams').select('id, name, color, is_active, sort_order').order('sort_order'),
    supabase.from('todo_team_members').select('team_id, email'),
    supabase.from('user_page_access').select('email, display_name').eq('can_todo', true),
  ])

  const membersByTeam = new Map<string, string[]>()
  ;((members || []) as Array<{ team_id: string; email: string | null }>).forEach((m) => {
    const email = String(m.email || '').trim().toLowerCase()
    if (!email) return
    const list = membersByTeam.get(m.team_id) || []
    list.push(email)
    membersByTeam.set(m.team_id, list)
  })

  const groups: AssignmentGroup[] = ((teams || []) as Array<{ id: string; name: string; color: string | null; is_active: boolean | null; sort_order: number | null }>)
    .filter((t) => t.is_active !== false)
    .map((t) => ({ id: t.id, name: t.name, color: t.color, memberEmails: membersByTeam.get(t.id) || [] }))

  const byEmail = new Map<string, AssignmentUser>()
  ;((users || []) as Array<{ email: string | null; display_name: string | null }>).forEach((u) => {
    const email = String(u.email || '').trim().toLowerCase()
    if (!email) return
    byEmail.set(email, { email, label: String(u.display_name || '').trim() || email.split('@')[0] })
  })
  const usersSorted = Array.from(byEmail.values()).sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }))

  return { groups, users: usersSorted }
}

/** Valeur de la liste déroulante pour une tâche existante. */
export function assignmentValueOf(
  assignedTo: string | null | undefined,
  teamId: string | null | undefined,
  users: AssignmentUser[]
): string {
  const raw = String(assignedTo || '').trim()
  if (!raw) return teamId ? `${GROUP_PREFIX}${teamId}` : ''
  const lower = raw.toLowerCase()
  const byEmail = users.find((u) => u.email === lower)
  if (byEmail) return byEmail.email
  // Ancien format : nom affiché (« Camille A. ») au lieu de l'email.
  const byName = users.find((u) => u.label.toLowerCase() === lower)
  return byName ? byName.email : raw
}

/**
 * Champs à écrire dans todo_actions pour une valeur de la liste.
 * Pour un utilisateur, team_id n'est pas touché (le classement projet / équipe
 * reste celui choisi par ailleurs) sauf si `currentTeamId` est un groupe en
 * attente qu'on remplace — dans ce cas on le conserve aussi (historique).
 */
export function assignmentPatch(value: string): { assigned_to: string | null; team_id?: string | null } {
  if (value.startsWith(GROUP_PREFIX)) {
    return { assigned_to: null, team_id: value.slice(GROUP_PREFIX.length) || null }
  }
  return { assigned_to: value.trim() || null }
}

export function isGroupValue(value: string) {
  return value.startsWith(GROUP_PREFIX)
}

/** Libellé lisible d'une affectation (liste, fiche…). */
export function assignmentLabel(
  assignedTo: string | null | undefined,
  teamId: string | null | undefined,
  options: AssignmentOptions
): string {
  const value = assignmentValueOf(assignedTo, teamId, options.users)
  if (!value) return 'Non assignée'
  if (isGroupValue(value)) {
    const g = options.groups.find((x) => `${GROUP_PREFIX}${x.id}` === value)
    return g ? `Groupe ${g.name} (à prendre)` : 'Groupe (à prendre)'
  }
  return options.users.find((u) => u.email === value)?.label || value
}

/**
 * « Je la prends » : premier arrivé. Renvoie null si c'est bon, sinon un
 * message (tâche déjà prise par quelqu'un d'autre…). Repli sans la RPC
 * (migration pas encore appliquée) : mise à jour conditionnelle directe.
 */
export async function prendreTacheGroupe(todoId: string, myEmail: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('prendre_tache_groupe', { p_todo_id: todoId })
  if (!error) {
    if (data === 'ok') return null
    return data === 'introuvable' ? 'Tâche introuvable.' : `Déjà prise par ${String(data)}.`
  }
  const { data: rows, error: err2 } = await supabase
    .from('todo_actions')
    .update({ assigned_to: myEmail })
    .eq('id', todoId)
    .is('assigned_to', null)
    .select('id')
  if (err2) return err2.message
  return rows && rows.length > 0 ? null : 'Déjà prise par un autre membre du groupe.'
}
