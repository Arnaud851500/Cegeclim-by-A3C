'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'
import type { AlertDetailItem } from './MobileAlertes'

/**
 * ⚠️ Version simplifiée (comptages SANS filtrage fin par agence/
 * collaborateur, contrairement à AppShell desktop qui restreint via
 * allowed_agences/allowed_collaborateurs du profil) d'une partie de la
 * logique déjà présente dans AppShell : refreshTodoSignal, refreshCerfaKo,
 * refreshCdcLivAvant2026Signal, refreshControleFraisPortSignal,
 * refreshCertificationSignals.
 *
 * Les 5 signaux desktop sont maintenant tous branchés ici (À faire, CERFA,
 * CDC livraison avant 2026, Frais de port, Capacité gaz), chacun visible
 * uniquement si le droit correspondant (show_alert_*) est activé pour le
 * profil de l'utilisateur — exactement comme le bandeau du haut côté PC.
 *
 * Recommandation pour la suite : extraire cette logique dans un hook
 * partagé (ex: useAlertSignals) consommé à la fois par AppShell (desktop)
 * et ce hook, pour ne pas maintenir deux implémentations qui risquent de
 * diverger, et pour récupérer le filtrage fin par agence/collaborateur
 * (actuellement absent ici : chaque signal remonte le total non filtré par
 * périmètre, ce qui peut afficher un chiffre plus large que côté desktop
 * pour un profil restreint à certaines agences).
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

        if (rights.show_alert_cdc_liv_avant_2026) {
          try {
            const { data, error } = await supabase
              .from('v_portefeuille_livraison_lignes')
              .select('type_document,numero_document,numero_tiers')
              .eq('type_document', 'CDC')
              .or('mois_livraison.eq.AVANT_2026,date_livraison.lt.2026-01-01')
              .limit(50000)
            if (error) throw error

            const distinctDocuments = new Set(
              ((data || []) as Record<string, any>[]).map((row) =>
                [row.type_document, row.numero_document, row.numero_tiers].map((v) => String(v ?? '').trim()).join('::'),
              ),
            )
            const countValue = distinctDocuments.size
            items.push({
              label: 'CDC < 2026',
              count: countValue,
              status: countValue > 0 ? 'red' : 'green',
            })
          } catch (e) {
            console.error('CDC livraison avant 2026 (mobile)', e)
          }
        }

        if (rights.show_alert_controle_frais_port) {
          try {
            const { data, error } = await supabase
              .from('v_controle_frais_port_groupes')
              .select('statut_groupe,nb_bl_a_supprimer')
              .neq('statut_groupe', 'OK')
              .limit(20000)
            if (error) throw error

            const rows = (data || []) as Record<string, any>[]
            const missingGroups = rows.filter((r) => String(r.statut_groupe || '').trim() === 'FRAIS_PORT_MANQUANT').length
            const blToRemove = rows.reduce((sum, r) => sum + Number(r.nb_bl_a_supprimer || 0), 0)
            const otherGroups = rows.filter((r) => {
              const status = String(r.statut_groupe || '').trim()
              return status !== 'FRAIS_PORT_MANQUANT' && Number(r.nb_bl_a_supprimer || 0) <= 0
            }).length
            const countValue = missingGroups + blToRemove + otherGroups

            items.push({
              label: 'Frais de port',
              count: countValue,
              status: missingGroups > 0 || blToRemove > 0 ? 'red' : otherGroups > 0 ? 'orange' : 'green',
            })
          } catch (e) {
            console.error('Contrôle frais de port (mobile)', e)
          }
        }

        if (rights.show_alert_capacite_gaz) {
          try {
            const { data, error } = await supabase.rpc('get_client_certification_alert_rows', {
              p_kind: 'capacite',
              p_limit: 10000,
            })
            if (error) throw error

            const rows = (data || []) as Record<string, any>[]
            const expiredCount = rows.filter((r) => String(r.alert_status || '').toLowerCase() === 'expired').length
            const countValue = rows.length

            items.push({
              label: 'Capacité gaz',
              count: countValue,
              status: expiredCount > 0 ? 'red' : countValue > 0 ? 'orange' : 'green',
            })
          } catch (e) {
            console.error('Capacité gaz (mobile)', e)
          }
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
  }, [
    email,
    rights.show_alert_todo,
    rights.show_alert_cerfa_ko,
    rights.show_alert_cdc_liv_avant_2026,
    rights.show_alert_controle_frais_port,
    rights.show_alert_capacite_gaz,
    pathname,
  ])

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

  /** Liste des CDC dont la date de livraison est antérieure à 2026. */
  async function fetchCdcAvant2026List() {
    if (!email) return []
    const { data, error } = await supabase
      .from('v_portefeuille_livraison_lignes')
      .select('numero_document,numero_tiers,agence,representant,mois_livraison,date_livraison')
      .eq('type_document', 'CDC')
      .or('mois_livraison.eq.AVANT_2026,date_livraison.lt.2026-01-01')
      .order('date_livraison', { ascending: true })
      .limit(500)
    if (error) {
      console.error('fetchCdcAvant2026List', error)
      return []
    }
    return (data || []) as Record<string, any>[]
  }

  /** Liste des groupes en écart sur le contrôle des frais de port. */
  async function fetchFraisPortList() {
    if (!email) return []
    const { data, error } = await supabase
      .from('v_controle_frais_port_groupes')
      .select('agences,representants,statut_groupe,nb_bl_a_supprimer,nb_actions')
      .neq('statut_groupe', 'OK')
      .order('nb_actions', { ascending: false })
      .limit(500)
    if (error) {
      console.error('fetchFraisPortList', error)
      return []
    }
    return (data || []) as Record<string, any>[]
  }

  /** Liste des clients avec une capacité gaz expirée ou arrivant à
   * échéance — même RPC que le panneau desktop (AppShell). */
  async function fetchCapaciteGazList() {
    if (!email) return []
    const { data, error } = await supabase.rpc('get_client_certification_alert_rows', {
      p_kind: 'capacite',
      p_limit: 500,
    })
    if (error) {
      console.error('fetchCapaciteGazList', error)
      return []
    }
    return (data || []) as Record<string, any>[]
  }

  return {
    total,
    detail,
    loading,
    fetchTodoList,
    fetchCerfaList,
    fetchCdcAvant2026List,
    fetchFraisPortList,
    fetchCapaciteGazList,
  }
}
