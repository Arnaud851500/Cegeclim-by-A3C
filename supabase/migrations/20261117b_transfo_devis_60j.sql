-- ============================================================================
-- 20261117b_transfo_devis_60j.sql
-- Taux de transformation des devis : base de calcul unique à 60 jours
-- (demandé par Arnaud le 17/11/2026).
--
-- L'écran « Mes agences » (get_suivi_transfo_devis) calcule déjà le taux à
-- 60 j ; les contrats d'objectifs (get_obj_contrat, primes 'evol_transfo')
-- le calculaient à 120 j. Ils passent à 60 j, avec la même règle que
-- l'écran Mes agences :
--   - devis du 1er janvier jusqu'au dernier jour où ils ont 60 j
--     (current_date - 60, borné par la fin d'année / la date de fin de contrat),
--     comparés aux devis des mêmes dates N-1 ;
--   - transformé = commande passée entre 0 et 60 jours après le devis
--     (delai_devis_cdc between 0 and 60) ;
--   - le délai utilisé est renvoyé dans 'transfo' (clé 'delai') pour l'affichage.
--
-- La fonction est modifiée en place à partir de sa définition en base
-- (pg_get_functiondef + remplacements contrôlés) pour ne rien perdre des
-- évolutions successives de get_obj_contrat ; chaque remplacement est vérifié.
-- ============================================================================

do $mig$
declare
  v_def text := pg_get_functiondef('public.get_obj_contrat(integer,text)'::regprocedure);
  v_new text;
begin
  if position('x.d between 0 and 60' in v_def) > 0 then
    raise notice 'get_obj_contrat déjà à 60 j : rien à faire';
    return;
  end if;

  v_new := v_def;

  -- 1. Date limite : devis âgés d'au moins 60 j
  if position('current_date - 120' in v_new) = 0 then
    raise exception 'get_obj_contrat : « current_date - 120 » introuvable';
  end if;
  v_new := replace(v_new, 'current_date - 120', 'current_date - 60');

  -- 2. Transformé = commande dans les 60 j (0 à 60, comme get_suivi_transfo_devis)
  if (length(v_new) - length(replace(v_new, 'x.d <= 120', ''))) / length('x.d <= 120') <> 2 then
    raise exception 'get_obj_contrat : 2 occurrences de « x.d <= 120 » attendues';
  end if;
  v_new := replace(v_new, 'x.d <= 120', 'x.d between 0 and 60');

  -- 3. Délai renvoyé avec le résultat (affichage « Taux de transfo à 60 j »)
  if position('''date_limite'', v_lim))' in v_new) = 0 then
    raise exception 'get_obj_contrat : « ''date_limite'', v_lim)) » introuvable';
  end if;
  v_new := replace(v_new, '''date_limite'', v_lim))', '''date_limite'', v_lim, ''delai'', 60))');

  -- 4. Commentaires
  v_new := replace(v_new, 'commande à 120 j', 'commande à 60 j');
  v_new := replace(v_new, 'où ils ont 120 j', 'où ils ont 60 j');

  execute v_new;
end
$mig$;
