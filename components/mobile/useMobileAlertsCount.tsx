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
 * AJOUT (2026-08-30) : signal "Cohérence données" (show_alert_data_coherence,
 * désormais déclaré nativement dans AccessContext.tsx), même table de
 * statut que le desktop (data_coherence_alert_status, déjà tenue à jour
 * par cron + hook de synchro Sage côté base -- simple lecture ici, aucun
 * recalcul). Pas de filtrage périmètre : c'est un statut global, identique
 * pour tout le monde, comme côté desktop.
 *
 * CORRECTIF (25/08) : CDC < 2026 et Capacité gaz appliquent désormais le
 * même filtrage périmètre que le desktop -- allowed_agences ET
 * allowed_collaborateurs du profil (user_page_access), restriction
 * cumulative (chaque liste non vide réduit encore le résultat). Avant ce
 * correctif, ces deux compteurs remontaient le total NON filtré, ce qui
 * pouvait afficher un chiffre plus large côté mobile que côté desktop
 * pour un profil restreint. Les deux tables/vues sous-jacentes stockent
 * déjà le collaborateur sous forme de CODE (ex. "MPEYRE"), identique au
 * format de allowed_collaborateurs -- pas de résolution de nom nécessaire
 * côté CDC. Côté capacité gaz (cache sans colonne agence), la RPC dédiée
 * get_client_certification_alert_rows_for_user fait la jointure vers
 * ref_collaborateurs pour déduire l'agence. À faire, CERFA et Frais de
 * port restent non filtrés par périmètre pour l'instant (hors demande).
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
 *
 * CORRECTIF (2026-09-02) : "À faire" utilisait deux requêtes indépendantes
 * pour la pastille (count exact en HEAD) et pour le tiroir de détail
 * (fetchTodoList, plafonné à 200 lignes) -- deux sources de vérité
 * distinctes qui pouvaient diverger (au minimum au-delà de 200 tâches
 * ouvertes ; potentiellement aussi en cas de décalage temporel entre les
 * deux appels). Le compteur "À faire" est désormais dérivé d'UNE seule
 * lecture (id + due_date, mêmes filtres que fetchTodoList), qui sert à la
 * fois à calculer le total et le sous-compteur "en retard" -- la pastille
 * ne peut plus diverger du tiroir puisqu'elle vient de la même requête.
 */
export function useMobileAlertsCount() {
  const { rights, email } = useAccess()
  const pathname = usePathname()
  const [detail, setDetail] = useState<AlertDetailItem[]>([])
  const [loading, setLoading] = useState(true)

  // Identités (email + nom affiché) résolues une fois et réutilisées par
  // fetchTodoList — évite de re-résoudre le nom à chaque appel du tiroir.
  const identitiesRef = useRef<string[]>([])
  // Périmètre agence/collaborateur (user_page_access.allowed_agences /
  // allowed_collaborateurs) résolu une fois en même temps que les
  // identités -- réutilisé par CDC<2026 et Capacité gaz (compteur ET
  // tiroir de détail), pour rester cohérent avec le filtrage desktop.
  const perimetreRef = useRef<{ agences: string[]; collaborateurs: string[] }>({ agences: [], collaborateurs: [] })
  const lastLoadRef = useRef(0)

  async function resolveIdentities(): Promise<string[]> {
    if (identitiesRef.current.length > 0) return identitiesRef.current
    const { data: access } = await supabase
      .from('user_page_access')
      .select('display_name, allowed_agences, allowed_collaborateurs')
      .eq('email', email)
      .maybeSingle()
    const displayName = String(access?.display_name || '').trim()
    const identities = Array.from(new Set([email, displayName].map((v) => String(v || '').trim()).filter(Boolean)))
    identitiesRef.current = identities
    perimetreRef.current = {
      agences: ((access?.allowed_agences || []) as string[]).map((v) => String(v || '').trim()).filter(Boolean),
      collaborateurs: ((access?.allowed_collaborateurs || []) as string[]).map((v) => String(v || '').trim()).filter(Boolean),
    }
    return identities
  }

  function buildAssignedFilter(identities: string[]) {
    return identities.map((v) => `assigned_to.eq.${String(v).replace(/,/g, '\\,')}`).join(',')
  }

  function todayIso() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
        const { agences: allowedAgences, collaborateurs: allowedCollaborateurs } = perimetreRef.current

        if (rights.show_alert_todo) {
          // CORRECTIF : une seule requête (id + due_date, mêmes filtres
          // que fetchTodoList ci-dessous), au lieu d'un count HEAD séparé
          // -- élimine toute possibilité de divergence entre la pastille
          // et le tiroir "À faire" (voir note en tête de fichier). Le
          // sous-compteur "en retard" (due_date < aujourd'hui) est calculé
          // sur ce même résultat.
          const { data, error } = await supabase
            .from('todo_actions')
            .select('id, due_date')
            .or(assignedFilter)
            .not('status', 'in', '("Terminé","Annulé")')
            .limit(5000)
          if (error) {
            console.error('À faire (mobile) — comptage', error)
            items.push({ label: 'À faire', count: 0, status: 'orange' })
          } else {
            const rows = (data || []) as { id: string; due_date: string | null }[]
            const today = todayIso()
            const enRetard = rows.filter((r) => r.due_date && r.due_date < today).length
            items.push({
              label: 'À faire',
              count: rows.length,
              status: rows.length > 0 ? 'orange' : 'green',
              subCount: enRetard,
              subLabel: 'en retard',
            })
          }
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
          // Toujours affichée, y compris à 0 (vert) -- avant, un compteur à
          // 0 s'affichait bien (le push a toujours lieu quel que soit
          // countValue), mais une ERREUR de requête faisait disparaître
          // l'alerte entièrement et silencieusement (rien qu'en console).
          // Le catch pousse maintenant un item quand même, avec un statut
          // "orange" neutre (pas vert, pour ne pas faire croire à tort que
          // tout va bien) plutôt que de la faire disparaître.
          try {
            let requete = supabase
              .from('v_portefeuille_livraison_lignes')
              .select('type_document,numero_document,numero_tiers')
              .eq('type_document', 'CDC')
              .or('mois_livraison.eq.AVANT_2026,date_livraison.lt.2026-01-01')
              .limit(50000)
            // Périmètre agence/collaborateur, comme le bandeau desktop --
            // agence et code_representant sont déjà dans le même format
            // que allowed_agences/allowed_collaborateurs, pas de
            // résolution de nom nécessaire.
            if (allowedAgences.length > 0) requete = requete.in('agence', allowedAgences)
            if (allowedCollaborateurs.length > 0) requete = requete.in('code_representant', allowedCollaborateurs)

            const { data, error } = await requete
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
            items.push({ label: 'CDC < 2026', count: 0, status: 'orange' })
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
          // Repli sur l'ancienne RPC non filtrée si la nouvelle (filtrée
          // périmètre) échoue -- ex. cache de schéma PostgREST pas encore
          // à jour juste après sa création. Mieux vaut un chiffre non
          // filtré que l'alerte qui disparaît entièrement.
          try {
            let data: Record<string, any>[] | null = null
            try {
              const res = await supabase.rpc('get_client_certification_alert_rows_for_user', {
                p_email: email,
                p_kind: 'capacite',
                p_limit: 10000,
              })
              if (res.error) throw res.error
              data = res.data
            } catch (erreurFiltree) {
              console.warn('Capacité gaz (mobile) — repli sur la RPC non filtrée', erreurFiltree)
              const res = await supabase.rpc('get_client_certification_alert_rows', {
                p_kind: 'capacite',
                p_limit: 10000,
              })
              if (res.error) throw res.error
              data = res.data
            }

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
            items.push({ label: 'Capacité gaz', count: 0, status: 'orange' })
          }
        }

        if (rights.show_alert_data_coherence) {
          // Simple lecture du statut singleton -- déjà tenu à jour côté
          // base (cron horaire + hook de fin de synchro Sage), aucun
          // recalcul ici. Pas de filtrage périmètre : statut global,
          // identique pour tout le monde (comme côté desktop).
          try {
            const { data, error } = await supabase
              .from('data_coherence_alert_status')
              .select('status,ko_months')
              .eq('singleton', true)
              .maybeSingle()
            if (error) throw error

            const isKo = String(data?.status || 'ok').toLowerCase() === 'ko'
            items.push({
              label: 'Cohérence données',
              count: Number(data?.ko_months || 0),
              status: isKo ? 'red' : 'green',
            })
          } catch (e) {
            console.error('Cohérence données (mobile)', e)
            items.push({ label: 'Cohérence données', count: 0, status: 'orange' })
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
    rights.show_alert_data_coherence,
    pathname,
  ])

  const total = detail.reduce((sum, d) => sum + d.count, 0)

  /** Liste complète des tâches TODO ouvertes — pour le tiroir de détail.
   * Toutes les tâches non terminées sont incluses, qu'elles soient en
   * retard ou non (aucun filtre sur due_date) — seul le statut
   * Terminé/Annulé exclut une tâche de cette liste.
   * CORRECTIF (2026-09-02) : plafond relevé de 200 à 5000, aligné sur le
   * plafond utilisé pour le comptage ci-dessus -- un plafond différent
   * entre les deux était une source possible de décalage entre la
   * pastille et le tiroir. */
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
      .limit(5000)
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

  /** Liste des CDC dont la date de livraison est antérieure à 2026 --
   * filtrée sur le même périmètre agence/collaborateur que le compteur
   * (voir load() ci-dessus). */
  async function fetchCdcAvant2026List() {
    if (!email) return []
    await resolveIdentities()
    const { agences: allowedAgences, collaborateurs: allowedCollaborateurs } = perimetreRef.current

    let requete = supabase
      .from('v_portefeuille_livraison_lignes')
      .select('numero_document,numero_tiers,nom_tiers,agence,representant,mois_livraison,date_livraison,reference,reference_article,designation_article,quantite,montant_ht')
      .eq('type_document', 'CDC')
      .or('mois_livraison.eq.AVANT_2026,date_livraison.lt.2026-01-01')
    if (allowedAgences.length > 0) requete = requete.in('agence', allowedAgences)
    if (allowedCollaborateurs.length > 0) requete = requete.in('code_representant', allowedCollaborateurs)

    const { data, error } = await requete
      .order('date_livraison', { ascending: true })
      .limit(2000)
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
   * échéance — RPC filtrée périmètre (agence + collaborateur), même
   * fonction que le compteur. */
  async function fetchCapaciteGazList() {
    if (!email) return []
    const { data, error } = await supabase.rpc('get_client_certification_alert_rows_for_user', {
      p_email: email,
      p_kind: 'capacite',
      p_limit: 500,
    })
    if (error) {
      console.warn('fetchCapaciteGazList — repli sur la RPC non filtrée', error)
      const { data: dataRepli, error: erreurRepli } = await supabase.rpc('get_client_certification_alert_rows', {
        p_kind: 'capacite',
        p_limit: 500,
      })
      if (erreurRepli) {
        console.error('fetchCapaciteGazList', erreurRepli)
        return []
      }
      return (dataRepli || []) as Record<string, any>[]
    }
    return (data || []) as Record<string, any>[]
  }

  /** Détail des mois en écart -- même RPC que la modale desktop
   * (get_monthly_data_reconciliation), rejouée sur la période stockée dans
   * data_coherence_alert_status, filtrée aux mois en écart côté client. */
  async function fetchDataCoherenceList() {
    if (!email) return []
    const { data: statusRow, error: statusError } = await supabase
      .from('data_coherence_alert_status')
      .select('date_debut,date_fin')
      .eq('singleton', true)
      .maybeSingle()
    if (statusError || !statusRow?.date_debut || !statusRow?.date_fin) {
      if (statusError) console.error('fetchDataCoherenceList (statut)', statusError)
      return []
    }

    const { data, error } = await supabase.rpc('get_monthly_data_reconciliation', {
      p_date_debut: statusRow.date_debut,
      p_date_fin: statusRow.date_fin,
    })
    if (error) {
      console.error('fetchDataCoherenceList', error)
      return []
    }

    const tolerance = 0.01
    return ((data || []) as Record<string, any>[])
      .map((row) => {
        const facturesLignes = Number(row.factures_lignes || 0)
        const devisLignes = Number(row.devis_lignes || 0)
        const issues: string[] = []
        if (Math.abs(Number(row.factures_cache || 0) - facturesLignes) > tolerance) issues.push('Factures cache')
        if (Math.abs(Number(row.factures_indicateur || 0) - facturesLignes) > tolerance) issues.push('Factures indicateur')
        if (Math.abs(Number(row.factures_flux || 0) - facturesLignes) > tolerance) issues.push('Factures flux')
        if (Math.abs(Number(row.devis_cache || 0) - devisLignes) > tolerance) issues.push('Devis cache')
        if (Math.abs(Number(row.devis_indicateur || 0) - devisLignes) > tolerance) issues.push('Devis indicateur')
        if (Math.abs(Number(row.devis_flux || 0) - devisLignes) > tolerance) issues.push('Devis flux')
        if (Math.abs(Number(row.ecart_cdc_source_vs_flux || 0)) > tolerance) issues.push('CDC flux')
        if (Math.abs(Number(row.ecart_bl_source_vs_flux || 0)) > tolerance) issues.push('BL flux')
        return { annee: Number(row.annee), mois: Number(row.mois), issues }
      })
      .filter((row) => row.issues.length > 0)
      .sort((a, b) => (a.annee - b.annee) || (a.mois - b.mois))
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
    fetchDataCoherenceList,
  }
}
