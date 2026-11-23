// lib/prospectSuivi.ts
//
// Enregistrement du suivi prospect (statut + commentaire) d'une entreprise de
// public.clients, partagé par l'écran Prospects / Clients (PC) et la fiche
// prospect mobile.
//
// FIX (2026-11-23) : les commerciaux (profils TCI/TCS) n'ont pas le droit
// d'UPDATE direct sur clients (policy clients_write_admin) -> l'update était
// filtré à 0 ligne SANS erreur et la saisie était perdue au rechargement.
// On passe désormais par la RPC save_client_prospect_suivi (migration
// 20261123c) qui n'ouvre que ces deux champs, sur le périmètre de l'utilisateur.
// Tant que la RPC n'est pas déployée, repli sur l'update direct avec contrôle
// du nombre de lignes modifiées : plus aucune perte silencieuse.

import { supabase } from '@/lib/supabaseClient'

export type ProspectSuiviPatch = {
  prospect_status?: string | null
  prospect_comment?: string | null
}

export type ProspectSuiviResult = {
  prospect_status: string | null
  prospect_comment: string | null
}

function isRpcMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /could not find the function|does not exist/i.test(error.message || '')
  )
}

export async function saveProspectSuivi(id: string, patch: ProspectSuiviPatch): Promise<ProspectSuiviResult> {
  const setStatus = Object.prototype.hasOwnProperty.call(patch, 'prospect_status')
  const setComment = Object.prototype.hasOwnProperty.call(patch, 'prospect_comment')

  const { data, error } = await supabase.rpc('save_client_prospect_suivi', {
    p_id: id,
    p_set_status: setStatus,
    p_status: setStatus ? patch.prospect_status ?? null : null,
    p_set_comment: setComment,
    p_comment: setComment ? patch.prospect_comment ?? null : null,
  })

  if (!error) {
    const row = (data || {}) as Partial<ProspectSuiviResult>
    return {
      prospect_status: row.prospect_status ?? null,
      prospect_comment: row.prospect_comment ?? null,
    }
  }

  if (!isRpcMissing(error)) {
    throw new Error(error.message || "Erreur lors de l'enregistrement du suivi prospect")
  }

  // Repli : update direct, en vérifiant qu'une ligne a réellement été modifiée.
  const payload: Record<string, string | null> = {}
  if (setStatus) payload.prospect_status = patch.prospect_status ?? null
  if (setComment) payload.prospect_comment = patch.prospect_comment ?? null

  const { data: rows, error: updError } = await supabase
    .from('clients')
    .update(payload)
    .eq('id', id)
    .select('prospect_status, prospect_comment')

  if (updError) throw new Error(updError.message)
  if (!rows || rows.length === 0) {
    throw new Error(
      "Enregistrement refusé : vous n'avez pas le droit de modifier cette fiche. Contactez l'administrateur.",
    )
  }

  const row = rows[0] as ProspectSuiviResult
  return { prospect_status: row.prospect_status ?? null, prospect_comment: row.prospect_comment ?? null }
}
