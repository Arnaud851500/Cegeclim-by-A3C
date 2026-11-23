-- =============================================================================
-- « Quand puis-je livrer ? » — date de livraison prévue d'un devis (23/11/2026, demandé par Arnaud)
-- -----------------------------------------------------------------------------
-- L'écran compare la date de livraison client au plus tôt à la date de livraison
-- prévue (devis, commande collée / photographiée, ou saisie) pour dire si elle est
-- tenable. Pour un devis, la date vient de SAGE (sage.devis_hier_aujourdhui.vl_dodatelivr,
-- date de livraison de l'entête). Elle n'est retenue que si elle est postérieure à la
-- date du devis : sinon c'est la valeur par défaut de SAGE (date du devis, 01/01/1753
-- ou date passée), pas une date annoncée au client.
-- Périmètre : même contrôle que get_quand_livrer_devis (ql_peut_voir_tiers).
-- =============================================================================

create or replace function public.get_quand_livrer_devis_date_livraison(p_numero text)
returns date
language plpgsql
stable security definer
set search_path to 'public', 'sage'
as $function$
declare
  v_num text := upper(trim(coalesce(p_numero, '')));
  v_tiers text;
  v_collab text;
  v_date_devis date;
  v_res date;
begin
  if v_num = '' then return null; end if;
  select e.numero_tiers, e.collaborateur, e.date_devis into v_tiers, v_collab, v_date_devis
  from devis_entetes_cache e where e.numero_piece = v_num order by e.date_devis desc nulls last limit 1;
  if not found then
    select max(l.numero_tiers_entete), max(l.collaborateur), min(l.date_devis) into v_tiers, v_collab, v_date_devis
    from devis_lignes l where l.numero_piece = v_num;
  end if;
  if v_tiers is not null and not ql_peut_voir_tiers(v_tiers, v_collab) then return null; end if;

  select max(x.dl) into v_res
  from (select sage_date_text_to_date(d.vl_dodatelivr) dl, sage_date_text_to_date(d.date_piece) dp
        from sage.devis_hier_aujourdhui d where d.vl_docnum = v_num) x
  where x.dl > coalesce(v_date_devis, x.dp) and x.dl > '2000-01-01';
  return v_res;
end;
$function$;

grant execute on function public.get_quand_livrer_devis_date_livraison(text) to authenticated;
