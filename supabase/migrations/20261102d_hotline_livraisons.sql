-- ============================================================================
-- 20261102d_hotline_livraisons.sql — Hotline : commande initiale et livraison
-- (02/11/2026, demande d'Arnaud)
-- ----------------------------------------------------------------------------
-- Quand on saisit un chantier / une référence, une référence produit ou un
-- numéro de série dans la console, on retrouve les EXPÉDITIONS concernées
-- (bons de livraison) avec, pour chacune :
--   - la commande initiale (CDC, numéro et date),
--   - la date d'expédition (BL),
--   - la ou les factures,
--   - TOUS les produits livrés avec ce BL (les lignes qui correspondent à la
--     recherche sont signalées).
-- Source : facture_lignes (5 dernières années, lignes facturées).
-- Une référence produit seule n'est cherchée que chez le client identifié
-- (sinon elle remonterait les livraisons de tous les clients).
-- ============================================================================

create index if not exists idx_facture_lignes_numero_piece_bl
  on public.facture_lignes (numero_piece_bl)
  where numero_piece_bl is not null;

create or replace function public.hotline_livraisons(
  p_numero_tiers      text default null,
  p_chantier          text default null,
  p_reference_article text default null,
  p_numero_serie      text default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tiers   text := nullif(trim(coalesce(p_numero_tiers, '')), '');
  v_chant   text := nullif(trim(coalesce(p_chantier, '')), '');
  v_article text := nullif(trim(coalesce(p_reference_article, '')), '');
  v_serie   text := nullif(trim(coalesce(p_numero_serie, '')), '');
  v_bls     text[];
  v_res     jsonb;
begin
  if not public.hotline_peut_acceder() then
    raise exception 'Accès hotline refusé (droit can_hotline).';
  end if;
  if v_chant is not null and length(v_chant) < 3 then v_chant := null; end if;
  if v_article is not null and length(v_article) < 3 then v_article := null; end if;
  if v_serie is not null and length(v_serie) < 4 then v_serie := null; end if;
  if v_article is not null and v_tiers is null and v_chant is null and v_serie is null then
    v_article := null;
  end if;
  if v_chant is null and v_article is null and v_serie is null then
    return '[]'::jsonb;
  end if;

  -- BL concernés : la ligne doit répondre à TOUS les critères saisis.
  select array_agg(bl) into v_bls
  from (
    select f.numero_piece_bl as bl, max(f.date_bl) as d
    from public.facture_lignes f
    where f.date_facture >= current_date - interval '5 years'
      and f.numero_piece_bl is not null and f.numero_piece_bl <> ''
      and (v_tiers is null or f.numero_tiers_entete = v_tiers)
      and (v_chant is null or f.reference ilike '%' || v_chant || '%' or f.projet ilike '%' || v_chant || '%')
      and (v_article is null or f.reference_article ilike v_article || '%' or f.designation ilike '%' || v_article || '%'
           or coalesce(f.designation_article, '') ilike '%' || v_article || '%')
      and (v_serie is null or f.numero_serie_lot ilike '%' || v_serie || '%' or f.complement_serie_lot ilike '%' || v_serie || '%')
    group by f.numero_piece_bl
    order by max(f.date_bl) desc nulls last
    limit 8
  ) s;

  if v_bls is null then
    return '[]'::jsonb;
  end if;

  with l as (
    select f.*,
           ((v_article is not null and (f.reference_article ilike v_article || '%' or f.designation ilike '%' || v_article || '%'
              or coalesce(f.designation_article, '') ilike '%' || v_article || '%'))
            or (v_serie is not null and (f.numero_serie_lot ilike '%' || v_serie || '%' or f.complement_serie_lot ilike '%' || v_serie || '%'))) as correspond
    from public.facture_lignes f
    where f.numero_piece_bl = any (v_bls)
  ),
  produits as (
    select numero_piece_bl,
           jsonb_agg(jsonb_build_object(
             'reference_article', reference_article,
             'designation', designation,
             'quantite', quantite,
             'series', series,
             'correspond', correspond) order by correspond desc, reference_article) as lignes
    from (
      select numero_piece_bl, reference_article,
             max(coalesce(nullif(designation_article, ''), designation)) as designation,
             sum(coalesce(nullif(qte_livree, 0), quantite)) as quantite,
             array_remove(array_agg(distinct nullif(numero_serie_lot, '')), null) as series,
             bool_or(correspond) as correspond
      from l
      where coalesce(reference_article, '') <> '' or coalesce(designation, '') <> ''
      group by numero_piece_bl, reference_article
      having sum(coalesce(nullif(qte_livree, 0), quantite)) <> 0 or bool_or(correspond)
    ) p
    group by numero_piece_bl
  ),
  entetes as (
    select numero_piece_bl,
           max(date_bl) as date_bl,
           max(numero_piece_bc) as numero_cdc,
           min(date_bc) as date_cdc,
           array_remove(array_agg(distinct nullif(numero_piece, '')), null) as factures,
           max(numero_tiers_entete) as numero_tiers,
           max(intitule_tiers_entete) as intitule,
           max(nullif(reference, '')) as chantier,
           max(nullif(projet, '')) as projet,
           max(nullif(depot, '')) as depot,
           max(nullif(collaborateur, '')) as collaborateur
    from l
    group by numero_piece_bl
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'numero_bl', e.numero_piece_bl,
           'date_bl', e.date_bl,
           'numero_cdc', e.numero_cdc,
           'date_cdc', e.date_cdc,
           'factures', e.factures,
           'numero_tiers', e.numero_tiers,
           'intitule', e.intitule,
           'chantier', e.chantier,
           'projet', e.projet,
           'depot', e.depot,
           'collaborateur', e.collaborateur,
           'lignes', coalesce(p.lignes, '[]'::jsonb)) order by e.date_bl desc nulls last), '[]'::jsonb)
  into v_res
  from entetes e
  left join produits p using (numero_piece_bl);

  return v_res;
end
$function$;

grant execute on function public.hotline_livraisons(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
