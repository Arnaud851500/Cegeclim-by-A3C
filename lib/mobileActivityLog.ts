'use client'

import { supabase } from '@/lib/supabaseClient'

/**
 * Journal d'usage du Compagnon mobile (2026-09-29).
 *
 * Le Compagnon s'affiche entièrement sur /accueil : sans ce module, la table
 * user_activity_log ne voit qu'une page vue « /accueil » et rien de ce que
 * l'utilisateur consulte ensuite (clients, devis, tâches, stock...).
 *
 * logMobileView('clients/fiche', { type: 'client', id: 'SB0053', label: 'SANMARTIN' })
 *   -> insère dans user_activity_log :
 *      event_type = 'page_view', pathname = '/m/clients/fiche',
 *      entity_type / entity_id / entity_label, metadata = { source: 'mobile' }
 *
 * Tous les chemins mobiles commencent par /m/ : la synthèse hebdomadaire les
 * distingue ainsi des écrans PC.
 *
 * - Ne bloque jamais l'interface (appel « fire and forget », erreurs avalées).
 * - Anti-doublon : même écran + même entité ignoré pendant 5 s (double
 *   rendu React, double tap).
 * - Email lu une fois via supabase.auth, remis à zéro à chaque changement de
 *   session (déconnexion / changement de compte).
 */

let emailCache: string | null | undefined
let ecouteAuth = false
const derniersEnvois = new Map<string, number>()
const ANTI_DOUBLON_MS = 5000

async function emailCourant(): Promise<string | null> {
  if (!ecouteAuth) {
    ecouteAuth = true
    supabase.auth.onAuthStateChange(() => {
      emailCache = undefined
    })
  }
  if (emailCache === undefined) {
    const { data } = await supabase.auth.getUser()
    emailCache = data.user?.email ?? null
  }
  return emailCache
}

export type MobileLogEntity = { type: string; id: string; label?: string | null }

export function logMobileView(ecran: string, entity?: MobileLogEntity): void {
  void (async () => {
    try {
      const chemin = `/m/${ecran.replace(/^\/+/, '')}`
      const cle = `${chemin}|${entity?.id ?? ''}`
      const maintenant = Date.now()
      if ((derniersEnvois.get(cle) ?? 0) > maintenant - ANTI_DOUBLON_MS) return
      derniersEnvois.set(cle, maintenant)

      const email = await emailCourant()
      if (!email) return

      await supabase.from('user_activity_log').insert({
        user_email: email,
        event_type: 'page_view',
        pathname: chemin,
        entity_type: entity?.type ?? null,
        entity_id: entity?.id ?? null,
        entity_label: entity?.label ?? null,
        metadata: { source: 'mobile' },
      })
    } catch {
      // le journal d'usage ne doit jamais gêner l'utilisateur
    }
  })()
}
