// ============================================================================
// lib/allocationRo.ts — écran « Allocation AirH2O 600 / 800 » (24/10/2026)
// ----------------------------------------------------------------------------
// Accès réservé pour l'instant à Julien Ithurbide, Stéphane Chanteau,
// Jean-Marc Ladeuix et Arnaud Valanchauskas.
//
// Cette liste ne sert qu'à afficher (ou non) l'écran dans le menu : la vraie
// barrière est côté base (table public.stock_alloc_ro_acces, vérifiée par
// get_allocation_ro / set_allocation_ro — supabase/sql/20261024_allocation_airh2o.sql).
// Pour ouvrir la vue complète à quelqu'un : ajouter son e-mail ici ET dans la table.
// (26/10/2026) Vue agence en lecture : toute personne ayant le droit can_dashboard (ou le droit de
// profil « Allocation AirH2O 600 / 800 »), sur l'agence qui lui est rattachée : périmètre agences
// de sa fiche, sinon agence objectif, sinon agence de ses collaborateurs
// (allocation_ro_blocs_user — supabase/sql/20261026_allocation_airh2o_vue_agence_dashboard.sql).
// Seules les personnes de cette liste (et de stock_alloc_ro_acces) modifient les allocations.
// ============================================================================

export const ALLOCATION_RO_EMAILS: readonly string[] = [
  'j.ithurbide@cegeclim-energies.com',
  's.chanteau@cegeclim-energies.com',
  'jm.ladeuix@cegeclim-energies.com',
  'a.valanchauskas@cegeclim-energies.com',
]

export function peutVoirAllocationRo(email: string | null | undefined): boolean {
  return !!email && ALLOCATION_RO_EMAILS.includes(email.toLowerCase().trim())
}
