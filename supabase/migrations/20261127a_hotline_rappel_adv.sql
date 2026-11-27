-- ============================================================================
-- 20261127a_hotline_rappel_adv.sql — (27/11/2026, demande d'Arnaud)
-- « Client à rappeler par » accepte l'entrée « ADV » (rappel_par = 'ADV') :
-- c'est un service, pas une personne, donc aucune alerte individuelle n'est
-- créée (le notifieur ignore les destinataires sans adresse e-mail).
-- ============================================================================

do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.hotline_etape_notifier()'::regprocedure) into v_def;
  if v_def not like '%not like ''%@%''%' then
    v_def := replace(v_def,
      'if v_dest is null or v_dest = lower(coalesce(new.auteur, '''')) then',
      'if v_dest is null or v_dest not like ''%@%'' or v_dest = lower(coalesce(new.auteur, '''')) then');
    if v_def not like '%not like ''%@%''%' then
      raise exception 'Patch de hotline_etape_notifier impossible';
    end if;
    execute v_def;
  end if;
end
$$;
