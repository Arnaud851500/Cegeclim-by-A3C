'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'
import type { AlertDetailItem } from './MobileAlertes'

/**
 * ⚠️ Version simplifiée (comptages uniquement, sans filtrage fin par
 * agence/collaborateur) d'une partie de la logique déjà présente dans
 * AppShell : refreshTodoSignal, refreshCerfaKo, refreshCdcLivAvant2026Signal,
 * refreshControleFraisPortSignal, refreshCertificationSignals.
 *
 * Recommandation pour la suite : extraire cette logique dans un hook
 * partagé (ex: useAlertSignals) consommé à la fois par AppShell (desktop)
 * et ce hook, pour ne pas maintenir deux implémentations qui risquent de
 * diverger. Pour ce premier jet, seuls TODO et CERFA KO sont branchés — les
 * trois autres signaux (CDC < 2026, frais de port, capacité gaz) suivent
 * le même principe mais nécessitent la logique de périmètre agence/
 * collaborateur, plus lourde, qu'on pourra ajouter une fois cette V1
 * validée.
 *
 * CORRECTIF : `assigned_to` peut contenir soit l'email soit le nom affiché
 * selon l'ancienneté de la ligne (même souci que côté desktop TodoPage.tsx,
 * cf. resolveAssignee/assigneeIdentityValues) — ne filtrer que sur l'email
 * faisait donc disparaître certaines tâches pourtant bien ouvertes et
 * assignées à l'utilisateur. On résout maintenant email ET nom affiché.
 *
 * CORRECTIF : les compteurs se rafraîchissent désormais à chaque
 * changement de page (pathname en dépendance), avec un garde-fou de 15s
 * minimum entre deux rafraîchissements pour ne pas ralentir une navigation
 * rapide entre plusieurs écrans.
 */
export function useMobileAlertsCount() {
  const { rights, email } = useAccess()
  const pathname = usePathname()
  const [detail, setDetail] = useState<AlertDetailItem[]>([])
  const [loading, setLoading] = useState(true)

  // Identités (email + nom affiché) résolues une fois et réutilisées par
  // fetchTodoList — évite de re-résoudre le nom à chaque appel du tiroir.
  const identitiesRef = useRef<string[]>([])
  const lastLoadRef = useRef(0)

  async function resolveIdentities(): Promise<string[]> {
    if (identitiesRef.current.length > 0) return identitiesRef.current
    const { data: access } = await supabase
      .from('user_page_access')
      .select('display_name')
      .eq('email', email)
      .maybeSingle()
    const displayName = String(access?.display_name || '').trim()
    const identities = Array.from(new Set([email, displayName].map((v) => String(v || '').trim()).filter(Boolean)))
    identitiesRef.current = identities
    return identities
  }

  function buildAssignedFilter(identities: string[]) {
    return identities.map((v) => `assigned_to.eq.${String(v).replace(/,/g, '\\,')}`).join(',')
  }

  useEffect(() => {
    if (!email) return
    let cancelled = false

    async function load(force?: boolean) {
      const now = Date.now()
      if (!force && now - lastLoadRef.current < 15_000) return
      lastLoadRef.current = now

      setLoading(true)
      const items: AlertDetailItem[] = []

      try {
        const identities = await resolveIdentities()
        const assignedFilter = buildAssignedFilter(identities)

        if (rights.show_alert_todo) {
          const { count } = await supabase
            .from('todo_actions')
            .select('id', { count: 'exact', head: true })
            .or(assignedFilter)
            .not('status', 'in', '("Terminé","Annulé")')
          items.push({
            label: 'À faire',
            count: count || 0,
            status: (count || 0) > 0 ? 'orange' : 'green',
          })
        }

        if (rights.show_alert_cerfa_ko) {
          const { data } = await supabase.rpc('get_cerfa_ko_count_for_user', {
            p_email: email,
            p_allowed_agences: null,
          })
          const countValue = Array.isArray(data) ? Number((data[0] as any)?.count ?? 0) : Number(data ?? 0)
          items.push({
            label: 'CERFA à régulariser',
            count: Number.isFinite(countValue) ? countValue : 0,
            status: countValue > 0 ? 'red' : 'green',
          })
        }

        if (!cancelled) setDetail(items)
      } catch (e) {
        console.error('useMobileAlertsCount', e)
        if (!cancelled) setDetail([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    // Premier chargement de la page : toujours forcé (ignore le
    // garde-fou de 15s), sinon changer de page trop vite après le
    // montage initial pourrait laisser des compteurs vides affichés.
    void load(true)
    return () => {
      cancelled = true
    }
    // pathname en dépendance = rafraîchit à chaque changement de page,
    // avec le garde-fou de 15s ci-dessus pour amortir une navigation très
    // rapide entre plusieurs écrans sans la ralentir.
  }, [email, rights.show_alert_todo, rights.show_alert_cerfa_ko, pathname])

  const total = detail.reduce((sum, d) => sum + d.count, 0)

  /** Liste complète des tâches TODO ouvertes — pour le tiroir de détail.
   * Toutes les tâches non terminées sont incluses, qu'elles soient en
   * retard ou non (aucun filtre sur due_date) — seul le statut
   * Terminé/Annulé exclut une tâche de cette liste. */
  async function fetchTodoList() {
    if (!email) return []
    const identities = await resolveIdentities()
    const assignedFilter = buildAssignedFilter(identities)

    const { data, error } = await supabase
      .from('todo_actions')
      .select('id,description_action,status,due_date,numero_tiers,assigned_to')
      .or(assignedFilter)
      .not('status', 'in', '("Terminé","Annulé")')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(200)
    if (error) {
      console.error('fetchTodoList', error)
      return []
    }
    return (data || []) as {
      id: string
      description_action: string | null
      status: string
      due_date: string | null
      numero_tiers: string | null
      assigned_to: string | null
    }[]
  }

  /** Liste complète des CERFA KO — même RPC que le panneau desktop (AppShell). */
  async function fetchCerfaList() {
    if (!email) return []
    const { data, error } = await supabase.rpc('get_cerfa_ko_rows_for_user', {
      p_email: email,
      p_allowed_agences: null,
      p_limit: 200,
    })
    if (error) {
      console.error('fetchCerfaList', error)
      return []
    }
    return (data || []) as Record<string, any>[]
  }

  return { total, detail, loading, fetchTodoList, fetchCerfaList }
}
