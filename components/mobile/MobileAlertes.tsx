'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import MobileListSheet, { type ListSheetItem } from './MobileListSheet'
import MobileDetailSheet, { type DetailField } from './MobileDetailSheet'
import MobileTaskDetailSheet, { type TaskRow } from './MobileTaskDetailSheet'
import VoiceReportButtons from './VoiceReportButtons'

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
 * Pastille de couleur devant la description d'une tâche, basée sur
 * l'échéance :
 * - rouge : échéance strictement dans le passé (échue)
 * - orange : échéance aujourd'hui ou dans les 4 prochains jours
 * - verte : échéance au-delà de 4 jours, ou pas d'échéance renseignée
 * NOTE : le statut "En cours" ne prime plus sur la date -- la pastille
 * reflète désormais uniquement l'urgence de l'échéance (demande explicite).
 */
function statutPastille(row: TodoRow): string {
  if (!row.due_date) return '🟢'
  const iso = normalizeDateIso(row.due_date)
  if (!iso) return '🟢'

  const echeance = new Date(`${iso}T00:00:00`)
  const aujourdHui = new Date()
  aujourdHui.setHours(0, 0, 0, 0)

  const diffJours = Math.round((echeance.getTime() - aujourdHui.getTime()) / (1000 * 60 * 60 * 24))

  if (diffJours < 0) return '🔴'
  if (diffJours <= 4) return '🟠'
  return '🟢'
}

export default function MobileAlertes({
  detail,
  loading,
  fetchTodoList,
  fetchCerfaList,
  fetchCdcAvant2026List,
  fetchFraisPortList,
  fetchCapaciteGazList,
  userEmail,
  userName,
}: {
  detail: AlertDetailItem[]
  loading: boolean
  fetchTodoList: () => Promise<TodoRow[]>
  fetchCerfaList: () => Promise<Record<string, any>[]>
  fetchCdcAvant2026List: () => Promise<Record<string, any>[]>
  fetchFraisPortList: () => Promise<Record<string, any>[]>
  fetchCapaciteGazList: () => Promise<Record<string, any>[]>
  userEmail: string
  userName: string
}) {
  const active = detail.filter((d) => d.count > 0)

  const [listOpen, setListOpen] = useState<{ title: string; items: ListSheetItem[] } | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [openDetail, setOpenDetail] = useState<{ title: string; subtitle?: string; fields: DetailField[] } | null>(null)
  const [openTask, setOpenTask] = useState<TaskRow | null>(null)
  const [todoRows, setTodoRows] = useState<TodoRow[]>([])
  const [ajoutMode, setAjoutMode] = useState<'menu' | 'manuel' | 'vocal' | null>(null)
  const [nouvelleDescription, setNouvelleDescription] = useState('')
  const [nouvelleEcheance, setNouvelleEcheance] = useState('')
  const [nouvelleCategorie, setNouvelleCategorie] = useState('')
  const [nouveauClientTexte, setNouveauClientTexte] = useState('')
  const [nouveauClientNumero, setNouveauClientNumero] = useState<string | null>(null)
  const [suggestionsClient, setSuggestionsClient] = useState<{ numero: string; nom: string }[]>([])
  const [assigneesDisponibles, setAssigneesDisponibles] = useState<{ email: string; nom: string }[]>([])
  const [nouvelAssigne, setNouvelAssigne] = useState('')
  const [ajoutEnCours, setAjoutEnCours] = useState(false)
  const [ajoutErreur, setAjoutErreur] = useState('')

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

  /** Recharge la liste après un ajout (manuel ou vocal), sans fermer le
   * tiroir "À faire" qui reste ouvert derrière le panneau d'ajout. */
  async function rafraichirApresAjout() {
    setListLoading(true)
    const rows = await fetchTodoList()
    setListLoading(false)
    setTodoRows(rows)
    setListOpen({ title: 'À faire', items: buildTodoItems(rows) })
  }

  /** Suggestions client au fil de la saisie -- numéro ou nom, comme la
   * recherche du compte-rendu vocal (MobileHomeSummary). Champ optionnel :
   * pas de suggestion trouvée ou champ vide n'empêche jamais de créer la
   * tâche, numero_tiers part juste à null dans ce cas. */
  useEffect(() => {
    const q = nouveauClientTexte.trim()
    if (!q || nouveauClientNumero) { setSuggestionsClient([]); return }
    let cancelled = false
    const t = window.setTimeout(async () => {
      const { data } = await supabase
        .from('ref_tiers')
        .select('numero, intitule')
        .or(`numero.ilike.${q}%,intitule.ilike.%${q}%`)
        .limit(8)
      if (!cancelled) {
        setSuggestionsClient(((data || []) as any[]).map((r) => ({ numero: String(r.numero || ''), nom: String(r.intitule || '') })))
      }
    }, 250)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [nouveauClientTexte, nouveauClientNumero])

  /** Liste des collaborateurs à qui une tâche peut être affectée (même
   * source que la structuration IA côté vocal : user_page_access,
   * can_todo=true), chargée une fois. Par défaut, la tâche s'affecte à
   * soi-même -- initialisé dès que userEmail est connu. */
  useEffect(() => {
    let cancelled = false
    async function charger() {
      const { data } = await supabase.from('user_page_access').select('email, display_name').eq('can_todo', true)
      if (cancelled) return
      setAssigneesDisponibles(
        ((data || []) as any[]).map((a) => ({ email: String(a.email || '').toLowerCase(), nom: String(a.display_name || a.email || '') })),
      )
    }
    void charger()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (userEmail && !nouvelAssigne) setNouvelAssigne(userEmail.toLowerCase())
  }, [userEmail, nouvelAssigne])

  async function creerTacheManuelle() {
    const description = nouvelleDescription.trim()
    if (!description) {
      setAjoutErreur('Décris la tâche avant de valider.')
      return
    }
    setAjoutEnCours(true)
    setAjoutErreur('')
    try {
      const { error } = await supabase.from('todo_actions').insert({
        // CORRECTIF : created_by_email/created_by_name sont NOT NULL en
        // base -- absents ici, ils faisaient échouer systématiquement la
        // création manuelle ("null value in column created_by_email").
        created_by_email: userEmail || null,
        created_by_name: userName || userEmail || 'Mobile',
        description_action: description,
        due_date: nouvelleEcheance || null,
        status: 'Non débuté',
        assigned_to: nouvelAssigne || userEmail || userName || null,
        mission_project: nouvelleCategorie.trim() || null,
        numero_tiers: nouveauClientNumero || null,
      })
      if (error) throw error
      setNouvelleDescription('')
      setNouvelleEcheance('')
      setNouvelleCategorie('')
      setNouveauClientTexte('')
      setNouveauClientNumero(null)
      setNouvelAssigne(userEmail ? userEmail.toLowerCase() : '')
      setAjoutMode(null)
      await rafraichirApresAjout()
    } catch (e: any) {
      setAjoutErreur(e?.message || "Erreur lors de la création de la tâche.")
    } finally {
      setAjoutEnCours(false)
    }
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

  async function openCdcDrawer() {
    setListOpen({ title: 'CDC < 2026', items: [] })
    setListLoading(true)
    const rows = await fetchCdcAvant2026List()
    setListLoading(false)
    setListOpen({
      title: 'CDC < 2026',
      items: rows.map((row, i) => {
        const numeroDocument = safeText(pick(row, ['numero_document']))
        const numeroTiers = safeText(pick(row, ['numero_tiers']))
        const agence = safeText(pick(row, ['agence']))
        const representant = safeText(pick(row, ['representant']))
        const dateLivraison = pick(row, ['date_livraison'])
        const moisLivraison = safeText(pick(row, ['mois_livraison']))

        return {
          id: numeroDocument || String(i),
          primary: numeroDocument || '(sans numéro)',
          secondary: [numeroTiers && `Client ${numeroTiers}`, agence].filter(Boolean).join(' · '),
          trailing: dateLivraison ? formatDateFr(dateLivraison) : moisLivraison,
          onClick: () =>
            setOpenDetail({
              title: numeroDocument || '(sans numéro)',
              subtitle: 'CDC avec livraison avant 2026',
              fields: [
                { label: 'Client', value: numeroTiers },
                { label: 'Date de livraison', value: dateLivraison ? formatDateFr(dateLivraison) : moisLivraison },
                { label: 'Agence', value: agence },
                { label: 'Représentant', value: representant },
              ],
            }),
        }
      }),
    })
  }

  async function openFraisPortDrawer() {
    setListOpen({ title: 'Frais de port', items: [] })
    setListLoading(true)
    const rows = await fetchFraisPortList()
    setListLoading(false)
    setListOpen({
      title: 'Frais de port',
      items: rows.map((row, i) => {
        const agences = safeText(pick(row, ['agences']))
        const representants = safeText(pick(row, ['representants']))
        const statut = safeText(pick(row, ['statut_groupe']))
        const nbBlASupprimer = Number(row.nb_bl_a_supprimer || 0)
        const nbActions = Number(row.nb_actions || 0)

        const statutLabel = statut === 'FRAIS_PORT_MANQUANT' ? 'Frais de port manquant' : statut || 'À vérifier'

        return {
          id: String(i),
          primary: agences || '(agence non renseignée)',
          secondary: representants,
          trailing: statutLabel,
          onClick: () =>
            setOpenDetail({
              title: agences || '(agence non renseignée)',
              subtitle: 'Contrôle frais de port',
              fields: [
                { label: 'Représentant(s)', value: representants },
                { label: 'Statut', value: statutLabel },
                { label: 'BL à supprimer', value: String(nbBlASupprimer) },
                { label: "Nombre d'actions", value: String(nbActions) },
              ],
            }),
        }
      }),
    })
  }

  async function openCapaciteGazDrawer() {
    setListOpen({ title: 'Capacité gaz', items: [] })
    setListLoading(true)
    const rows = await fetchCapaciteGazList()
    setListLoading(false)
    setListOpen({
      title: 'Capacité gaz',
      items: rows.map((row, i) => {
        const numeroTiers = safeText(pick(row, ['numero_tiers']))
        const designation = safeText(pick(row, ['designation']))
        const agence = safeText(pick(row, ['agence', 'agence_rattachement', 'agence_collaborateur']))
        const representant = safeText(pick(row, ['representant']))
        const dateValidite = pick(row, ['date_validite_client', 'date_validite'])
        const alertStatus = safeText(pick(row, ['alert_status']))
        const joursEcart = Number(row.jours_ecart || 0)
        const siret = safeText(pick(row, ['siret']))

        const statutLabel = alertStatus.toLowerCase() === 'expired' ? 'Expirée' : `Expire dans ${joursEcart} j`

        return {
          id: numeroTiers || String(i),
          primary: designation || numeroTiers || '(client)',
          secondary: numeroTiers ? `Client ${numeroTiers}` : '',
          trailing: statutLabel,
          onClick: () =>
            setOpenDetail({
              title: designation || '(client)',
              subtitle: 'Capacité gaz',
              fields: [
                { label: 'Client', value: numeroTiers },
                { label: 'Date de validité', value: dateValidite ? formatDateFr(dateValidite) : '' },
                { label: 'Statut', value: statutLabel },
                { label: 'Agence', value: agence },
                { label: 'Représentant', value: representant },
                { label: 'SIRET', value: siret },
              ],
            }),
        }
      }),
    })
  }

  function handleOpen(label: string) {
    if (label === 'À faire') void openTodoDrawer()
    else if (label === 'CERFA à régulariser') void openCerfaDrawer()
    else if (label === 'CDC < 2026') void openCdcDrawer()
    else if (label === 'Frais de port') void openFraisPortDrawer()
    else if (label === 'Capacité gaz') void openCapaciteGazDrawer()
  }

  return (
    <div style={{ flex: 1, padding: '18px 3px 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
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
          <span style={{ fontSize: 15.5, fontWeight: 600 }}>{d.label}</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 17,
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

      {/* ---- Bouton flottant "Ajouter", visible au-dessus du tiroir "À faire" ---- */}
      {listOpen?.title === 'À faire' && !ajoutMode && (
        <button
          type="button"
          onClick={() => { setAjoutErreur(''); setAjoutMode('menu') }}
          aria-label="Ajouter une tâche"
          style={{
            position: 'fixed', right: 20, bottom: 28, zIndex: 245,
            width: 56, height: 56, borderRadius: '50%', border: 'none',
            background: '#A6A181', color: '#141A26', fontSize: 28, fontWeight: 700,
            boxShadow: '0 4px 14px rgba(0,0,0,0.4)', lineHeight: 1,
          }}
        >
          +
        </button>
      )}

      {/* ---- Menu de choix : manuelle ou vocale ---- */}
      {ajoutMode === 'menu' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 250, background: 'rgba(6,10,18,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setAjoutMode(null)}>
          <div style={{ width: '100%', maxWidth: 480, background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.08)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 10 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 6px' }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Nouvelle tâche</div>
            <button type="button" onClick={() => setAjoutMode('manuel')} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 15, fontWeight: 600, textAlign: 'left' }}>
              ✍️ Saisie manuelle
            </button>
            <button type="button" onClick={() => setAjoutMode('vocal')} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 12px', borderRadius: 12, border: '1px solid rgba(166,161,129,0.35)', background: 'rgba(166,161,129,0.12)', color: '#fff', fontSize: 15, fontWeight: 600, textAlign: 'left' }}>
              🎙️ Dictée vocale
            </button>
            <button type="button" onClick={() => setAjoutMode(null)} style={{ marginTop: 4, padding: '11px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* ---- Formulaire manuel ---- */}
      {ajoutMode === 'manuel' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 250, background: 'rgba(6,10,18,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => !ajoutEnCours && setAjoutMode(null)}>
          <div style={{ width: '100%', maxWidth: 480, background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.08)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 12 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 6px' }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Nouvelle tâche</div>

            <div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Description</div>
              <textarea
                value={nouvelleDescription}
                onChange={(e) => setNouvelleDescription(e.target.value)}
                rows={3}
                placeholder="Ex. : Relancer client pour devis PAC…"
                autoFocus
                style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '10px', fontSize: 14.5, resize: 'vertical' }}
              />
            </div>

            <div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Échéance (facultatif)</div>
              <input
                type="date"
                value={nouvelleEcheance}
                onChange={(e) => setNouvelleEcheance(e.target.value)}
                style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5 }}
              />
            </div>

            <div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Affecter à</div>
              <select
                value={nouvelAssigne}
                onChange={(e) => setNouvelAssigne(e.target.value)}
                style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5 }}
              >
                {userEmail && !assigneesDisponibles.some((a) => a.email === userEmail.toLowerCase()) && (
                  <option value={userEmail.toLowerCase()}>Moi-même ({userName || userEmail})</option>
                )}
                {assigneesDisponibles.map((a) => (
                  <option key={a.email} value={a.email}>
                    {a.email === userEmail?.toLowerCase() ? `${a.nom} (moi-même)` : a.nom}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Catégorie (facultatif)</div>
              <input
                type="text"
                value={nouvelleCategorie}
                onChange={(e) => setNouvelleCategorie(e.target.value)}
                placeholder="Ex. : Relance, Devis, SAV…"
                style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5 }}
              />
            </div>

            <div style={{ position: 'relative' }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Client (facultatif)</div>
              <input
                type="text"
                value={nouveauClientTexte}
                onChange={(e) => { setNouveauClientTexte(e.target.value); setNouveauClientNumero(null) }}
                placeholder="Nom ou numéro du client…"
                style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5 }}
              />
              {nouveauClientNumero && (
                <div style={{ fontSize: 11.5, color: '#8fd4a8', marginTop: 4 }}>✓ Client sélectionné : {nouveauClientNumero}</div>
              )}
              {suggestionsClient.length > 0 && !nouveauClientNumero && (
                <div style={{ marginTop: 6, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: '#0B1220', overflow: 'hidden' }}>
                  {suggestionsClient.map((s) => (
                    <button
                      key={s.numero}
                      type="button"
                      onClick={() => { setNouveauClientNumero(s.numero); setNouveauClientTexte(`${s.nom} (${s.numero})`); setSuggestionsClient([]) }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: '#fff', fontSize: 13.5 }}
                    >
                      <span style={{ color: '#E8A96A', fontWeight: 700 }}>{s.numero}</span> · {s.nom}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {ajoutErreur && <div style={{ fontSize: 13, color: '#e0a685' }}>{ajoutErreur}</div>}

            <button
              type="button"
              onClick={() => void creerTacheManuelle()}
              disabled={ajoutEnCours}
              style={{ padding: '13px', borderRadius: 12, border: 'none', background: '#A6A181', color: '#141A26', fontSize: 14.5, fontWeight: 700 }}
            >
              {ajoutEnCours ? 'Création…' : 'Créer la tâche'}
            </button>
            <button
              type="button"
              onClick={() => !ajoutEnCours && setAjoutMode(null)}
              style={{ padding: '11px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* ---- Dictée vocale (plein écran, mêmes composants que l'accueil) ---- */}
      {ajoutMode === 'vocal' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 250 }}>
          <VoiceReportButtons
            modeUnique="tache"
            labelBouton="Nouvelle tâche"
            pleinEcran
            userEmail={userEmail}
            userName={userName}
          />
          <button
            type="button"
            onClick={() => { setAjoutMode(null); void rafraichirApresAjout() }}
            aria-label="Fermer"
            style={{
              position: 'fixed', top: 18, right: 18, zIndex: 260,
              width: 40, height: 40, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.25)',
              background: 'rgba(20,26,38,0.9)', color: '#fff', fontSize: 20, lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
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
