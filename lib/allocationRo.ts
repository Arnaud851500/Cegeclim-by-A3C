// ============================================================================
// lib/allocationRo.ts — écran « Allocation AirH2O 600 / 800 » (24/10/2026)
// ----------------------------------------------------------------------------
// Accès réservé pour l'instant à Julien Ithurbide, Stéphane Chanteau,
// Jean-Marc Ladeuix et Arnaud Valanchauskas.
//
// Cette liste ne sert qu'à afficher (ou non) l'écran dans le menu : la vraie
// barrière est côté base (table public.stock_alloc_ro_acces, vérifiée par
// get_allocation_ro / set_allocation_ro — supabase/sql/20261024_allocation_airh2o.sql).
// Pour ouvrir l'écran à quelqu'un : ajouter son e-mail ici ET dans la table.
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
