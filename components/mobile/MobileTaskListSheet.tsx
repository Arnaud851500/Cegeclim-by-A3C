'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export type TaskListItem = {
  id: string
  description_action: string | null
  status: string
  due_date: string | null
  numero_tiers: string | null
  assigned_to: string | null
  /** Optionnels : rechargés par ce composant s'ils ne sont pas fournis. */
  category_id?: string | null
  team_id?: string | null
  concerned_person?: string | null
}

/**
 * Liste de tâches en bottom-sheet, mise en page en colonnes (n° client /
 * pastille de couleur / désignation / échéance) avec une case à cocher
 * pour terminer une tâche directement depuis la liste, sans ouvrir sa
 * fiche complète.
 *
 * Remplace MobileListSheet spécifiquement pour l'affichage des tâches
 * (todo_actions). Alimenté directement par fetchTodoList() de
 * useMobileAlertsCount.tsx.
 *
 * Couleur de la pastille : rouge si l'échéance est dépassée, orange si elle
 * tombe aujourd'hui ou dans les 4 prochains jours, vert au-delà ou sans
 * échéance.
 *
 * MODIF 2026-09-24 :
 *   - Présentation « Liste / Par catégorie / Par personne concernée »
 *     (groupes non vides uniquement, choix mémorisé sur le téléphone).
 *   - Bouton « + Tâche » par groupe (pré-remplissage du groupe) et
 *     « + Nouvelle tâche » dans l'en-tête.
 *
 * MODIF 2026-10-06 (demande d'Arnaud) :
 *   - Nouveau tri « Par projet / équipe » (todo_teams, ordre du paramétrage),
 *     le « + Tâche » du groupe pré-remplit le projet / équipe.
 *   - Lecture : chaque ligne affiche sa catégorie, son projet / équipe et
 *     « Concerne : <personne> » (sauf la dimension déjà utilisée pour
 *     regrouper).
 *   - Création : ajout du projet / équipe ; « Confiée à » devient une liste
 *     déroulante (droit can_todo) comme dans la fiche ; formulaire séparé en
 *     « Classement » / « Réalisation ».
 *   - Personne concernée : rappel explicite qu'il s'agit d'un classement et
 *     non d'une affectation ; suggestions des noms déjà saisis.
 *
 *   Rappel : une tâche créée avec un n° client et sans catégorie est rangée
 *   automatiquement dans « Affectées à 1 client » (trigger en base
 *   todo_actions_sync_category, migration todo_categorie_defaut_affectees_client).
 */

type GroupMode = 'liste' | 'categorie' | 'equipe' | 'personne'
type RefItem = { id: string; name: string; color: string; is_active: boolean; sort_order: number }
type Meta = { category_id: string | null; team_id: string | null; concerned_person: string | null }
type Defaults = { category_id: string | null; team_id: string | null; concerned_person: string | null }
type Group = {
  key: string
  label: string
  color: string
  tasks: TaskListItem[]
  defaults: Defaults
}
type AssigneeOption = { email: string; label: string }

const MODE_STORAGE_KEY = 'cegeclim:mobile-task-list-mode'
const NO_CATEGORY = '__none_category__'
const NO_TEAM = '__none_team__'
const NO_PERSON = '__none_person__'
const EMPTY_DEFAULTS: Defaults = { category_id: null, team_id: null, concerned_person: null }
const PERSON_COLORS = ['#7A5EA8', '#3F7FA6', '#B4761A', '#3F9142', '#C1683C', '#5E8C87', '#A6A181', '#9A4F7A']

const MODE_OPTIONS: Array<[GroupMode, string]> = [
  ['liste', 'Liste'],
  ['categorie', 'Catégorie'],
  ['equipe', 'Projet / équipe'],
  ['personne', 'Personne'],
]

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

function safeColor(color: string | null | undefined, fallback = '#8A8375') {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback
}

function normalize(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

/** Couleur stable pour une personne (ne change pas quand les groupes bougent). */
function personColor(key: string) {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return PERSON_COLORS[Math.abs(hash) % PERSON_COLORS.length]
}

function readStoredMode(): GroupMode {
  try {
    const value = window.localStorage.getItem(MODE_STORAGE_KEY)
    if (value === 'liste' || value === 'categorie' || value === 'equipe' || value === 'personne') return value
  } catch {
    /* stockage indisponible (navigation privée…) : présentation par défaut */
  }
  return 'liste'
}

function storeMode(mode: GroupMode) {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode)
  } catch {
    /* sans effet si le stockage est indisponible */
  }
}

/** Personnes concernées déjà saisies, dédoublonnées (accents / casse ignorés). */
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
    const key = normalize(value)
    if (!map.has(key)) map.set(key, value)
  })
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
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
  onTaskCreated,
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
   * retire de sa liste locale (compteur inclus) sans refaire un fetch complet. */
  onTaskCompleted?: (id: string) => void
  /** Notifie le parent qu'une tâche vient d'être créée depuis ce tiroir. */
  onTaskCreated?: (task: TaskListItem) => void
}) {
  // Tâches dont la case vient d'être cochée : grisées immédiatement, puis
  // retirées de la liste (par le parent via onTaskCompleted, ou localement
  // pour les tâches créées dans ce tiroir).
  const [enCours, setEnCours] = useState<Set<string>>(new Set())
  const [enErreur, setEnErreur] = useState<Set<string>>(new Set())
  const [retirees, setRetirees] = useState<Set<string>>(new Set())

  const [mode, setMode] = useState<GroupMode>('liste')
  const [categories, setCategories] = useState<RefItem[]>([])
  const [teams, setTeams] = useState<RefItem[]>([])
  const [personSuggestions, setPersonSuggestions] = useState<string[]>([])
  const [meta, setMeta] = useState<Map<string, Meta>>(new Map())
  const [metaLoading, setMetaLoading] = useState(false)
  const [creees, setCreees] = useState<TaskListItem[]>([])
  const [replies, setReplies] = useState<Set<string>>(new Set())
  const [creation, setCreation] = useState<Defaults | null>(null)

  useEffect(() => {
    setMode(readStoredMode())
  }, [])

  function changeMode(next: GroupMode) {
    setMode(next)
    setReplies(new Set())
    storeMode(next)
  }

  // Tâches affichées = liste du parent + tâches créées ici (sans doublon),
  // moins celles terminées localement.
  const allTasks = useMemo(() => {
    const seen = new Set<string>()
    const list: TaskListItem[] = []
    ;[...creees, ...tasks].forEach((task) => {
      if (seen.has(task.id) || retirees.has(task.id)) return
      seen.add(task.id)
      list.push(task)
    })
    return list
  }, [tasks, creees, retirees])

  const idsKey = useMemo(() => allTasks.map((t) => t.id).sort().join(','), [allTasks])

  // Référentiels (une fois) : catégories, projets / équipes, personnes déjà saisies.
  useEffect(() => {
    let cancelled = false
    async function loadRefs() {
      const [{ data: cats }, { data: tms }, persons] = await Promise.all([
        supabase.from('todo_categories').select('id, name, color, is_active, sort_order').order('sort_order'),
        supabase.from('todo_teams').select('id, name, color, is_active, sort_order').order('sort_order'),
        fetchConcernedPersons(),
      ])
      if (cancelled) return
      setCategories((cats || []) as RefItem[])
      setTeams((tms || []) as RefItem[])
      setPersonSuggestions(persons)
    }
    void loadRefs()
    return () => {
      cancelled = true
    }
  }, [])

  // Catégorie / projet-équipe / personne concernée des tâches affichées.
  useEffect(() => {
    let cancelled = false
    const ids = idsKey ? idsKey.split(',') : []
    if (ids.length === 0) {
      setMeta(new Map())
      return
    }

    async function loadMeta() {
      setMetaLoading(true)
      const next = new Map<string, Meta>()
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200)
        const { data, error } = await supabase
          .from('todo_actions')
          .select('id, category_id, team_id, concerned_person')
          .in('id', chunk)
        if (error) {
          console.error('[MobileTaskListSheet] chargement du classement des tâches', error)
          continue
        }
        ;(data || []).forEach(
          (row: { id: string; category_id: string | null; team_id: string | null; concerned_person: string | null }) =>
            next.set(row.id, {
              category_id: row.category_id,
              team_id: row.team_id,
              concerned_person: row.concerned_person,
            })
        )
      }
      if (!cancelled) {
        setMeta(next)
        setMetaLoading(false)
      }
    }

    void loadMeta()
    return () => {
      cancelled = true
    }
    // tasks : rechargé aussi quand le parent met à jour une tâche (fiche modifiée)
  }, [idsKey, tasks])

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams])

  function metaOf(task: TaskListItem): Meta {
    const fromDb = meta.get(task.id)
    if (fromDb) return fromDb
    return {
      category_id: task.category_id ?? null,
      team_id: task.team_id ?? null,
      concerned_person: task.concerned_person ?? null,
    }
  }

  // Groupes non vides uniquement.
  const groups = useMemo<Group[]>(() => {
    if (mode === 'liste') return []

    if (mode === 'categorie' || mode === 'equipe') {
      const isCat = mode === 'categorie'
      const refs = isCat ? categories : teams
      const noneKey = isCat ? NO_CATEGORY : NO_TEAM
      const pick = (m: Meta) => (isCat ? m.category_id : m.team_id)
      const toDefaults = (id: string): Defaults =>
        isCat ? { ...EMPTY_DEFAULTS, category_id: id } : { ...EMPTY_DEFAULTS, team_id: id }

      const byRef = new Map<string, TaskListItem[]>()
      allTasks.forEach((task) => {
        const key = pick(metaOf(task)) || noneKey
        if (!byRef.has(key)) byRef.set(key, [])
        byRef.get(key)!.push(task)
      })

      const result: Group[] = []
      refs.forEach((ref) => {
        const list = byRef.get(ref.id)
        if (list && list.length > 0) {
          result.push({
            key: ref.id,
            label: ref.name,
            color: safeColor(ref.color),
            tasks: list,
            defaults: toDefaults(ref.id),
          })
          byRef.delete(ref.id)
        }
      })
      // Tâches dont la référence n'est pas (encore) dans la liste chargée, puis sans valeur
      const orphans = Array.from(byRef.entries())
        .filter(([key]) => key !== noneKey)
        .flatMap(([, list]) => list)
      const none = [...(byRef.get(noneKey) || []), ...orphans]
      if (none.length > 0) {
        result.push({
          key: noneKey,
          label: isCat ? 'Sans catégorie' : 'Sans projet / équipe',
          color: '#B8B2A5',
          tasks: none,
          defaults: EMPTY_DEFAULTS,
        })
      }
      return result
    }

    // Par personne concernée
    const byPerson = new Map<string, { label: string; tasks: TaskListItem[] }>()
    allTasks.forEach((task) => {
      const label = String(metaOf(task).concerned_person || '').trim()
      const key = label ? normalize(label) : NO_PERSON
      if (!byPerson.has(key)) byPerson.set(key, { label: label || 'Sans personne concernée', tasks: [] })
      byPerson.get(key)!.tasks.push(task)
    })
    return Array.from(byPerson.entries())
      .sort((a, b) =>
        a[0] === NO_PERSON ? 1 : b[0] === NO_PERSON ? -1 : a[1].label.localeCompare(b[1].label, 'fr', { sensitivity: 'base' })
      )
      .map(([key, value]) => ({
        key,
        label: value.label,
        color: key === NO_PERSON ? '#B8B2A5' : personColor(key),
        tasks: value.tasks,
        defaults: { ...EMPTY_DEFAULTS, concerned_person: key === NO_PERSON ? null : value.label },
      }))
    // metaOf lit meta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, allTasks, categories, teams, meta])

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
      if (creees.some((t) => t.id === task.id)) {
        setRetirees((prev) => new Set(prev).add(task.id))
      }
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

  function toggleGroup(key: string) {
    setReplies((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleCreated(task: TaskListItem) {
    setCreees((prev) => [task, ...prev])
    setMeta((prev) => {
      const next = new Map(prev)
      next.set(task.id, {
        category_id: task.category_id ?? null,
        team_id: task.team_id ?? null,
        concerned_person: task.concerned_person ?? null,
      })
      return next
    })
    const person = String(task.concerned_person || '').trim()
    if (person && !personSuggestions.some((p) => normalize(p) === normalize(person))) {
      setPersonSuggestions((prev) => [...prev, person].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })))
    }
    onTaskCreated?.(task)
  }

  const renderTask = (task: TaskListItem) => {
    const m = metaOf(task)
    const category = mode !== 'categorie' && m.category_id ? catById.get(m.category_id) ?? null : null
    const team = mode !== 'equipe' && m.team_id ? teamById.get(m.team_id) ?? null : null
    const person = mode !== 'personne' ? String(m.concerned_person || '').trim() || null : null
    return (
      <TaskRowItem
        key={task.id}
        task={task}
        category={category}
        team={team}
        person={person}
        termine={enCours.has(task.id)}
        echec={enErreur.has(task.id)}
        onOpen={onOpenTask}
        onTerminer={terminer}
      />
    )
  }

  return (
    <>
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

          <div style={{ padding: '0 18px 10px', flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{title}</div>
              {subtitle && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{subtitle}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setCreation(EMPTY_DEFAULTS)}
                style={{
                  borderRadius: 999, padding: '6px 12px',
                  border: '1px solid rgba(180,118,26,0.6)', background: 'rgba(180,118,26,0.25)',
                  color: '#F5F3EC', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                }}
              >
                + Nouvelle tâche
              </button>
              <button onClick={onClose} style={{ color: 'rgba(255,255,255,0.4)', fontSize: 20, lineHeight: 1, background: 'none', border: 'none' }}>✕</button>
            </div>
          </div>

          {/* Sélecteur de tri / regroupement */}
          <div style={{ padding: '0 18px 12px', flexShrink: 0 }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.35)', marginBottom: 5 }}>
              Trier par
            </div>
            <div
              style={{
                display: 'flex', gap: 4, padding: 3, borderRadius: 12,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {MODE_OPTIONS.map(([value, label]) => {
                const active = mode === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => changeMode(value)}
                    style={{
                      flex: 1, padding: '7px 4px', borderRadius: 9, border: 'none',
                      background: active ? 'rgba(166,161,129,0.25)' : 'transparent',
                      color: active ? '#F5F3EC' : 'rgba(255,255,255,0.55)',
                      fontSize: 11.5, fontWeight: 600, lineHeight: 1.2,
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {mode === 'personne' && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 6, lineHeight: 1.35 }}>
                Classement par personne concernée (de qui parle la tâche) — ce n&apos;est pas la personne à qui la tâche est confiée.
              </div>
            )}
          </div>

          {/*
            Padding bas de 100px : le bouton flottant "+" de MobileAlertes.tsx
            reste affiché par-dessus ce tiroir et recouvrirait sinon la case à
            cocher de la dernière tâche visible.
          */}
          <div style={{ overflowY: 'auto', padding: '0 18px 100px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {loading ? (
              <div style={emptyStyle}>Chargement…</div>
            ) : allTasks.length === 0 ? (
              <div style={emptyStyle}>{emptyText}</div>
            ) : mode === 'liste' ? (
              allTasks.map(renderTask)
            ) : metaLoading && meta.size === 0 ? (
              <div style={emptyStyle}>Chargement des regroupements…</div>
            ) : (
              groups.map((group) => {
                const replie = replies.has(group.key)
                return (
                  <div key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px 2px' }}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.key)}
                        style={{
                          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
                          background: 'none', border: 'none', padding: 0, textAlign: 'left',
                        }}
                      >
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', width: 10 }}>{replie ? '▸' : '▾'}</span>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: group.color, flexShrink: 0 }} />
                        <span
                          style={{
                            fontSize: 13, fontWeight: 700, color: '#F5F3EC',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}
                        >
                          {group.label}
                        </span>
                        <span
                          style={{
                            fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)',
                            background: 'rgba(255,255,255,0.08)', borderRadius: 999, padding: '1px 8px', flexShrink: 0,
                          }}
                        >
                          {group.tasks.length}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setCreation(group.defaults)}
                        aria-label={`Nouvelle tâche dans ${group.label}`}
                        style={{
                          flexShrink: 0, borderRadius: 999, padding: '4px 10px',
                          border: `1px solid ${group.color}`, background: `${group.color}26`,
                          color: '#F5F3EC', fontSize: 12, fontWeight: 700,
                        }}
                      >
                        + Tâche
                      </button>
                    </div>
                    {!replie && group.tasks.map(renderTask)}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {creation && (
        <NewTaskSheet
          categories={categories}
          teams={teams}
          personSuggestions={personSuggestions}
          defaults={creation}
          onClose={() => setCreation(null)}
          onCreated={(task) => {
            handleCreated(task)
            setCreation(null)
          }}
        />
      )}
    </>
  )
}

const emptyStyle: React.CSSProperties = {
  fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '20px 0', textAlign: 'center',
}

/* ------------------------------------------------------------------ */
/* Ligne de tâche                                                       */
/* ------------------------------------------------------------------ */

function TaskRowItem({
  task,
  category,
  team,
  person,
  termine,
  echec,
  onOpen,
  onTerminer,
}: {
  task: TaskListItem
  category: RefItem | null
  team: RefItem | null
  person: string | null
  termine: boolean
  echec: boolean
  onOpen?: (task: TaskListItem) => void
  onTerminer: (task: TaskListItem) => void
}) {
  const hasTags = !!category || !!team || !!person
  return (
    <div
      onClick={() => onOpen?.(task)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 5,
        borderRadius: 12,
        border: `1px solid ${echec ? 'rgba(193,104,60,0.4)' : 'rgba(255,255,255,0.08)'}`,
        background: 'rgba(255,255,255,0.03)',
        padding: '10px 12px',
        cursor: onOpen ? 'pointer' : 'default',
        opacity: termine ? 0.45 : 1,
        transition: 'opacity 0.15s ease',
      }}
    >
      {/* Ligne 1 : n° client, pastille, échéance, case à cocher */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            fontSize: 12, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.55)',
            flexShrink: 0, minWidth: 48, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {task.numero_tiers || '—'}
        </span>

        <span
          aria-hidden="true"
          style={{ width: 8, height: 8, borderRadius: '50%', background: pastilleCouleur(task), flexShrink: 0 }}
        />

        <span style={{ flex: 1 }} />

        {task.due_date && (
          <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {formatDateFr(task.due_date)}
          </span>
        )}

        <input
          type="checkbox"
          checked={termine}
          disabled={termine}
          onClick={(e) => e.stopPropagation()}
          onChange={() => void onTerminer(task)}
          aria-label={`Terminer la tâche : ${task.description_action || ''}`}
          style={{ width: 18, height: 18, flexShrink: 0, accentColor: '#3F9142', cursor: termine ? 'default' : 'pointer' }}
        />
      </div>

      {/* Ligne 2 : désignation complète, sans troncature */}
      <div
        style={{
          fontSize: 13.5, color: '#fff', lineHeight: 1.4,
          wordBreak: 'break-word',
          textDecoration: termine ? 'line-through' : 'none',
        }}
      >
        {task.description_action || '(sans libellé)'}
      </div>

      {/* Ligne 3 : classement (catégorie, projet / équipe, personne concernée) */}
      {hasTags && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 1 }}>
          {category && <RefTag color={category.color}>{category.name}</RefTag>}
          {team && <RefTag color={team.color} square>{team.name}</RefTag>}
          {person && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>
              Concerne : <span style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>{person}</span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function RefTag({ color, square, children }: { color: string; square?: boolean; children: React.ReactNode }) {
  const safe = safeColor(color)
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.75)',
        border: `1px solid ${safe}66`, background: `${safe}1A`,
        borderRadius: 999, padding: '1px 8px', maxWidth: '100%',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: square ? 2 : '50%', background: safe, flexShrink: 0 }} />
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Création d'une tâche                                                 */
/* ------------------------------------------------------------------ */

function NewTaskSheet({
  categories,
  teams,
  personSuggestions,
  defaults,
  onClose,
  onCreated,
}: {
  categories: RefItem[]
  teams: RefItem[]
  personSuggestions: string[]
  defaults: Defaults
  onClose: () => void
  onCreated: (task: TaskListItem) => void
}) {
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState<string>(defaults.category_id || '')
  const [teamId, setTeamId] = useState<string>(defaults.team_id || '')
  const [concernedPerson, setConcernedPerson] = useState(defaults.concerned_person || '')
  const [assignedTo, setAssignedTo] = useState('')
  const [numeroTiers, setNumeroTiers] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [me, setMe] = useState<{ email: string; name: string } | null>(null)
  const [assignees, setAssignees] = useState<AssigneeOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Utilisateur connecté (créateur, « Confiée à » par défaut) et liste des
  // utilisateurs ayant le droit Todo pour « Confiée à ».
  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ data: auth }, { data: users }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('user_page_access').select('email, display_name').eq('can_todo', true),
      ])
      if (cancelled) return
      const options = ((users || []) as Array<{ email: string | null; display_name: string | null }>)
        .filter((u) => !!u.email)
        .map((u) => ({ email: String(u.email).trim(), label: (u.display_name || '').trim() || String(u.email) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }))
      setAssignees(options)

      const email = auth.user?.email || ''
      if (!email) return
      let name = options.find((o) => o.email.toLowerCase() === email.toLowerCase())?.label || ''
      if (!name) {
        const { data: access } = await supabase
          .from('user_page_access')
          .select('display_name')
          .eq('email', email)
          .maybeSingle<{ display_name: string | null }>()
        if (cancelled) return
        name = access?.display_name?.trim() || email.split('@')[0]
      }
      setMe({ email, name })
      setAssignedTo((prev) => prev || email)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const visibleCategories = categories.filter((c) => c.is_active || c.id === categoryId)
  const visibleTeams = teams.filter((t) => t.is_active || t.id === teamId)

  const assigneeHorsListe =
    !!assignedTo && !assignees.some((a) => a.email.toLowerCase() === assignedTo.toLowerCase())
  const assigneeSelectValue =
    assignees.find((a) => a.email.toLowerCase() === assignedTo.toLowerCase())?.email ?? assignedTo

  async function create() {
    if (!description.trim()) {
      setError('Saisis l’action à réaliser.')
      return
    }
    if (!me) {
      setError('Utilisateur non identifié, reconnecte-toi puis réessaie.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const category = categories.find((c) => c.id === categoryId)
      const payload = {
        created_by_email: me.email,
        created_by_name: me.name,
        description_action: description.trim(),
        status: 'Non débuté',
        category_id: categoryId || null,
        mission_project: category ? category.name : null,
        team_id: teamId || null,
        concerned_person: concernedPerson.trim() || null,
        assigned_to: assignedTo.trim() || null,
        numero_tiers: numeroTiers.trim() || null,
        due_date: dueDate || null,
      }
      const { data, error: insertError } = await supabase
        .from('todo_actions')
        .insert(payload)
        .select('id, description_action, status, due_date, numero_tiers, assigned_to, category_id, team_id, concerned_person')
        .single<TaskListItem>()
      if (insertError) throw insertError
      onCreated(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 215, background: 'rgba(6,10,18,0.62)',
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
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Nouvelle tâche</div>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Action">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Que faut-il faire ?"
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
              list="concerned-person-suggestions-new"
              autoComplete="off"
              style={inputStyle}
            />
            <datalist id="concerned-person-suggestions-new">
              {personSuggestions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>

          <SectionTitle title="Réalisation" hint="Qui fait la tâche, et pour quand" />

          <Field label="Confiée à">
            <select value={assigneeSelectValue} onChange={(e) => setAssignedTo(e.target.value)} style={inputStyle}>
              <option value="" style={{ color: '#000' }}>Non attribuée</option>
              {assigneeHorsListe && (
                <option value={assignedTo} style={{ color: '#000' }}>
                  {assignedTo}
                </option>
              )}
              {assignees.map((a) => (
                <option key={a.email} value={a.email} style={{ color: '#000' }}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="N° client" hint="Facultatif — sans catégorie, la tâche ira dans « Affectées à 1 client »">
            <input
              value={numeroTiers}
              onChange={(e) => setNumeroTiers(e.target.value.toUpperCase())}
              placeholder="Ex. T0075"
              style={inputStyle}
            />
          </Field>

          <Field label="Échéance">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={inputStyle} />
          </Field>
        </div>

        {error && <div style={{ marginTop: 12, fontSize: 12, color: '#e0a685' }}>{error}</div>}

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
            onClick={create}
            disabled={saving}
            style={{
              flex: 1, padding: '11px', borderRadius: 12,
              border: '1px solid rgba(166,161,129,0.4)', background: 'rgba(166,161,129,0.2)', color: '#e4dfc9',
              fontSize: 13, fontWeight: 600,
            }}
          >
            {saving ? 'Création…' : 'Créer la tâche'}
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
  const safe = safeColor(color)
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
