-- ============================================================================
-- 20261023_rappro_cdf_reliquat_info_commande_en_cours.sql
-- ----------------------------------------------------------------------------
-- Rapprochement SAGE ↔ BLG, commandes fournisseurs. Appliquée en base le 23/10/2026.
--
-- Faux écart signalé par Arnaud sur CDF033899 (Hitachi, ouverte des deux côtés, rien
-- de reçu) : les lignes d'information ou de prestation (REF, REGULTARIFHIT…) gardent un
-- reste à recevoir dans SAGE alors que BLG les marque « non livrables ». La règle
-- CDF_RELIQUAT_SAGE_NON_STOCKE (« Solder le reliquat dans SAGE ») les signalait même
-- quand la commande est encore en cours, donc aussi l'entête CDF_ENT_LIGNES_EN_ECART.
--
-- Correction : tant qu'une ligne article stockée de la commande est encore ouverte dans
-- SAGE, ses lignes d'information / prestation ne sont pas un écart (elles seront soldées
-- avec elle à la réception). L'écart reste signalé quand il ne reste plus qu'elles.
--
-- rappro_build() n'étant pas versionnée dans le dépôt, la règle est remplacée dans la
-- définition en base (le bloc échoue si la règle d'origine n'est pas trouvée une seule fois).
-- ============================================================================

do $do$
declare
  d text;
  v_old text := $q$when in_s and (ref in ('REF','FEDEX') or coalesce(b_nd,false)) then 'CDF_RELIQUAT_SAGE_NON_STOCKE'$q$;
  v_new text := $q$when in_s and (ref in ('REF','FEDEX') or coalesce(b_nd,false)) then
      -- (23/10/2026) commande encore en cours : une ligne article stockée est encore ouverte dans SAGE.
      -- Les lignes d'information / prestation (REF, régularisation tarifaire, port…) seront soldées
      -- avec elle à la réception : ce n'est pas un écart.
      case when exists (select 1 from tmp_cdf o
                        where o.cdf = tmp_cdf.cdf and o.in_s
                          and o.ref not in ('REF','FEDEX') and not coalesce(o.b_nd,false))
           then 'OK' else 'CDF_RELIQUAT_SAGE_NON_STOCKE' end$q$;
begin
  d := pg_get_functiondef('public.rappro_build()'::regprocedure);
  if (length(d) - length(replace(d, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Règle CDF_RELIQUAT_SAGE_NON_STOCKE introuvable ou en double dans rappro_build()';
  end if;
  execute replace(d, v_old, v_new);
end
$do$;
