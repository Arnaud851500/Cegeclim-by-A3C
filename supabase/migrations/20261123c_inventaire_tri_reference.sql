-- Inventaire — tri des listes sur la seule référence CEGECLIM (23/11/2026, demandé par Arnaud)
-- ---------------------------------------------------------------------------
-- La notion de famille (famille macro, famille) disparaît de l'ordre des listes :
-- saisie, pilotage d'un dépôt et écarts de campagne sont triés par référence.
-- Seule la section « En transit » (dépôt SAGE TRANSIT de l'agence) reste en tête.
-- Les fonctions sont réécrites en place (même corps, seul l'ORDER BY change).

do $$
declare
  f text;
  def text;
begin
  foreach f in array array['inv_saisie_liste(uuid)', 'inv_depot_pilotage(uuid)', 'inv_campagne_ecarts(uuid,uuid[])'] loop
    def := pg_get_functiondef(('public.' || f)::regprocedure);
    def := replace(def, 'l.transit desc, l.famille_macro nulls last, l.famille nulls last, l.reference', 'l.transit desc, l.reference');
    execute def;
  end loop;
end $$;

notify pgrst, 'reload schema';
