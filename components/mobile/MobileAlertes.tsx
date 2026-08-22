'use client'

import { useState } from 'react'
import MobileListSheet, { type ListSheetItem } from './MobileListSheet'
import MobileDetailSheet, { type DetailField } from './MobileDetailSheet'
import MobileTaskDetailSheet, { type TaskRow } from './MobileTaskDetailSheet'

export interface AlertDetailItem {
  label: string
  count: number
  status: 'red' | 'orange' | 'green'
  onOpen?: () => void
}

// NOTE : assigned_to ajouté -- si fetchTodoList() (défini côté parent, ex.
// MobileShell.tsx) ne sélectionne pas encore cette colonne dans sa requête
// Supabase, elle arrivera à `undefined`/`null` ici sans planter, mais il
// faut ajouter `assigned_to` au .select() côté parent pour qu'elle
// s'affiche réellement. Même chose pour `numero_tiers`, utilisé ci-dessous
// pour l'afficher juste après la date d'échéance.
type TodoRow = {
  id: string
  description_action: string | null
  status: string
  due_date: string | null
  numero_tiers: string | null
  assigned_to: string | null
}

function safeText(value: any) {
  return String(value ?? '').trim()
}
function pick(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const v = row?.[key]
    if (v !== null && v !== undefined && String(v).trim() !== '') return v
  }
  return null
}
function normalizeDateIso(value: any) {
  const text = safeText(value)
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const fr = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
  return ''
}
function formatDateFr(value: any) {
  const iso = normalizeDateIso(value)
  if (!iso) return safeText(value)
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
/** Format court jour/mois pour la colonne de droite de la liste "À faire". */
function formatDateCourte(value: any) {
  const iso = normalizeDateIso(value)
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

/**
 * Pastille de couleur devant la description d'une tâche :
 * - verte : tâche débutée ("En cours"), OU échéance dans le futur/aujourd'hui
 * - rouge : échéance dans le passé (et pas encore débutée)
 * - orange : pas d'échéance renseignée
 * "Débuté" est prioritaire sur la date : une tâche en cours reste verte
 * même si sa date est dépassée, elle n'est pas "en retard" au sens propre
 * puisqu'elle avance.
 */
function statutPastille(row: TodoRow): string {
  if (row.status === 'En cours') return '🟢'
  if (!row.due_date) return '🟠'
  const iso = normalizeDateIso(row.due_date)
  const today = new Date().toISOString().slice(0, 10)
  if (iso && iso < today) return '🔴'
  return '🟢'
}

export default function MobileAlertes({
  detail,
  loading,
  fetchTodoList,
  fetchCerfaList,
}: {
  detail: AlertDetailItem[]
  loading: boolean
  fetchTodoList: () => Promise<TodoRow[]>
  fetchCerfaList: () => Promise<Record<string, any>[]>
}) {
  const active = detail.filter((d) => d.count > 0)

  const [listOpen, setListOpen] = useState<{ title: string; items: ListSheetItem[] } | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [openDetail, setOpenDetail] = useState<{ title: string; subtitle?: string; fields: DetailField[] } | null>(null)
  const [openTask, setOpenTask] = useState<TaskRow | null>(null)
  const [todoRows, setTodoRows] = useState<TodoRow[]>([])

  function buildTodoItems(rows: TodoRow[]): ListSheetItem[] {
    return rows.map((r) => ({
      id: r.id,
      // Pastille de statut directement devant la description (voir
      // statutPastille ci-dessus) — remplace le badge de statut texte.
      primary: `${statutPastille(r)} ${r.description_action || '(sans libellé)'}`,
      secondary: r.assigned_to ? `Assigné : ${r.assigned_to}` : '',
      // À la place du statut : date d'échéance (jour/mois) puis code
      // client, dans cet ordre précis.
      trailing: [formatDateCourte(r.due_date) || '—', r.numero_tiers].filter(Boolean).join('  '),
      onClick: () => setOpenTask(r),
    }))
  }

  async function openTodoDrawer() {
    setListOpen({ title: 'À faire', items: [] })
    setListLoading(true)
    const rows = await fetchTodoList()
    setListLoading(false)
    setTodoRows(rows)
    setListOpen({ title: 'À faire', items: buildTodoItems(rows) })
  }

  // Mise à jour optimiste : après édition d'une tâche, on met à jour la
  // ligne concernée dans la liste déjà affichée sans tout recharger.
  function handleTaskSaved(updated: TaskRow) {
    setTodoRows((prev) => {
      const next = prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
      setListOpen((cur) => (cur ? { ...cur, items: buildTodoItems(next) } : cur))
      return next
    })
  }

  async function openCerfaDrawer() {
    setListOpen({ title: 'CERFA à régulariser', items: [] })
    setListLoading(true)
    const rows = await fetchCerfaList()
    setListLoading(false)
    setListOpen({
      title: 'CERFA à régulariser',
      items: rows.map((row, i) => {
        const numeroFacture = safeText(pick(row, ['numero_piece', 'num_piece', 'numero_facture', 'facture', 'piece']))
        const intituleTiers = safeText(pick(row, ['intitule_tiers', 'intitule_tiers_entete', 'nom_tiers', 'libelle_tiers', 'client', 'raison_sociale']))
        const numeroTiers = safeText(pick(row, ['numero_tiers', 'numero_tiers_entete', 'code_tiers', 'tiers']))
        const dateFacture = pick(row, ['date_facture', 'date_piece', 'date_document', 'date'])
        const reference = safeText(pick(row, ['reference_article', 'reference', 'code_article', 'article']))
        const projet = safeText(pick(row, ['projet', 'Projet']))
        const collaborateur = safeText(pick(row, ['collaborateur', 'collaborateur_tiers', 'collaborateur_facture', 'representant', 'commercial']))
        const agence = safeText(pick(row, ['agence_collaborateur', 'agence', 'depot', 'agence_document']))

        return {
          id: numeroFacture || String(i),
          primary: numeroFacture || '(sans numéro)',
          secondary: intituleTiers || numeroTiers,
          trailing: formatDateFr(dateFacture),
          onClick: () =>
            setOpenDetail({
              title: numeroFacture || '(sans numéro)',
              subtitle: 'CERFA à régulariser',
              fields: [
                { label: 'Client', value: `${intituleTiers}${numeroTiers ? ` (${numeroTiers})` : ''}` },
                { label: 'Date facture', value: formatDateFr(dateFacture) },
                { label: 'Référence', value: reference },
                { label: 'Projet', value: projet },
                { label: 'Collaborateur', value: collaborateur },
                { label: 'Agence', value: agence },
              ],
            }),
        }
      }),
    })
  }

  function handleOpen(label: string) {
    if (label === 'À faire') void openTodoDrawer()
    else if (label === 'CERFA à régulariser') void openCerfaDrawer()
  }

  return (
    <div style={{ flex: 1, padding: '18px 16px 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {loading && <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Chargement…</div>}

      {!loading && active.length === 0 && (
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Aucune alerte en cours 🎉</div>
      )}

      {active.map((d) => (
        <button
          key={d.label}
          onClick={() => handleOpen(d.label)}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            textAlign: 'left',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 14,
            padding: '14px 16px',
            background: d.status === 'red' ? 'rgba(193,104,60,0.12)' : 'rgba(214,154,74,0.10)',
            color: '#fff',
          }}
        >
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>{d.label}</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 16,
              fontWeight: 700,
              color: d.status === 'red' ? '#C1683C' : '#D69A4A',
            }}
          >
            {d.count}
          </span>
        </button>
      ))}

      {listOpen && (
        <MobileListSheet
          title={listOpen.title}
          items={listOpen.items}
          loading={listLoading}
          onClose={() => setListOpen(null)}
        />
      )}

      {openDetail && (
        <MobileDetailSheet
          title={openDetail.title}
          subtitle={openDetail.subtitle}
          fields={openDetail.fields}
          onClose={() => setOpenDetail(null)}
        />
      )}

      {openTask && (
        <MobileTaskDetailSheet
          task={openTask}
          onClose={() => setOpenTask(null)}
          onSaved={handleTaskSaved}
        />
      )}
    </div>
  )
}
