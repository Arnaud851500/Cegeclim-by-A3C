-- ============================================================================
-- 20261023b_rappro_cdf_prestations_60_jours.sql
-- ----------------------------------------------------------------------------
-- Rapprochement SAGE ↔ BLG, commandes fournisseurs. Appliquée en base le 23/10/2026,
-- après 20261023_rappro_cdf_reliquat_info_commande_en_cours.sql (validé par Arnaud).
--
-- Une commande fournisseur qui ne contient que des prestations (transport, mise en
-- service, bureau d'études, divers…) reste normalement ouverte dans SAGE jusqu'à sa
-- facturation : l'écart CDF_RELIQUAT_SAGE_NON_STOCKE n'est signalé qu'au-delà de 60 jours.
-- ============================================================================

do $do$
declare
  d text;
  v_old text := $q$           then 'OK' else 'CDF_RELIQUAT_SAGE_NON_STOCKE' end$q$;
  v_new text := $q$             -- (23/10/2026) commande de prestations seules : normalement ouverte jusqu'à sa facturation,
             -- signalée seulement au-delà de 60 jours.
             or coalesce(tmp_cdf.date_bc, tmp_cdf.order_date::date) > current_date - 60
           then 'OK' else 'CDF_RELIQUAT_SAGE_NON_STOCKE' end$q$;
begin
  d := pg_get_functiondef('public.rappro_build()'::regprocedure);
  if (length(d) - length(replace(d, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Règle CDF_RELIQUAT_SAGE_NON_STOCKE (version du 23/10) introuvable ou en double dans rappro_build()';
  end if;
  execute replace(d, v_old, v_new);
end
$do$;
