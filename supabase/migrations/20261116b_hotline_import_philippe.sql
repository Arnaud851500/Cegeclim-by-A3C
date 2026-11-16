-- ============================================================================
-- 20261116b_hotline_import_philippe.sql — (16/11/2026, demande d'Arnaud)
-- L'import CSV des tickets de l'ancien outil (reprise de l'historique, gestion
-- des doublons) est ouvert à Philippe VERGES.
-- ============================================================================

do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.hotline_importer_historique(jsonb,boolean)'::regprocedure) into v_def;
  if v_def not like '%p.verges@cegeclim-energies.com%' then
    v_def := replace(v_def,
      $a$not in ('valancha@gmail.com', 'a.valanchauskas@cegeclim-energies.com')$a$,
      $a$not in ('valancha@gmail.com', 'a.valanchauskas@cegeclim-energies.com', 'p.verges@cegeclim-energies.com')$a$);
    if v_def not like '%p.verges@cegeclim-energies.com%' then
      raise exception 'Patch de hotline_importer_historique impossible';
    end if;
    execute v_def;
  end if;
end
$$;
