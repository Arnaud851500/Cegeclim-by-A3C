'use client'

import { useEffect, useState } from 'react'
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
 */
export function useMobileAlertsCount() {
  const { rights, email } = useAccess()
  const [detail, setDetail] = useState<AlertDetailItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!email) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const items: AlertDetailItem[] = []

      try {
        if (rights.show_alert_todo) {
          const today = new Date().toISOString().slice(0, 10)
          const { count } = await supabase
            .from('todo_actions')
            .select('id', { count: 'exact', head: true })
            .or(`assigned_to.eq.${email}`)
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

    void load()
    return () => {
      cancelled = true
    }
  }, [email, rights.show_alert_todo, rights.show_alert_cerfa_ko])

  const total = detail.reduce((sum, d) => sum + d.count, 0)

  /** Liste complète des tâches TODO ouvertes — pour le tiroir de détail. */
  async function fetchTodoList() {
    if (!email) return []
    const { data, error } = await supabase
      .from('todo_actions')
      .select('id,description_action,status,due_date,numero_tiers,assigned_to')
      .or(`assigned_to.eq.${email}`)
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
