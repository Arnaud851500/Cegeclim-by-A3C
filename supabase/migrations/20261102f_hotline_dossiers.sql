-- ============================================================================
-- 20261102f_hotline_dossiers.sql — Hotline : dossiers de vente du client
-- (02/11/2026, demande d'Arnaud : « en tapant PARISIO, retrouver le contenu de
-- la commande et du BL de ce dossier », choisir un dossier dans la liste)
-- ----------------------------------------------------------------------------
-- La référence chantier (DO_Ref SAGE, ex. « PARISIO* ») est portée par les
-- devis, commandes, préparations et l'en-tête des factures, pas par les lignes
-- de facture. On reprend donc la reconstitution des parcours de vente de
-- l'écran Clients Convention CEE (public.cee_lignes_client : devis, pièces en
-- cours, factures) pour regrouper, par client, les documents en DOSSIERS :
--   un dossier = une commande (CDC) avec ses devis (lien SAGE, sinon même
--   référence chantier), préparations, BL et factures ; à défaut de CDC, un BL,
--   une facture ou un devis seul.
-- hotline_dossiers(client, recherche) renvoie les dossiers du client (3 ans)
-- qui correspondent à la recherche — référence chantier, n° de pièce (DE, CDC,
-- PL, BL, FA), référence ou désignation produit — ou les plus récents sans
-- recherche, avec pour chacun : devis, commande, BL (date d'expédition et
-- produits livrés), reste à livrer, factures. 20 dossiers au plus.
-- Lecture seule, droits hotline ; n'utilise pas les droits Financement.
-- ============================================================================

create or replace function public.hotline_dossiers(
  p_numero_tiers text,
  p_recherche    text default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'sage', 'pg_temp'
as $function$
declare
  v_tiers text := nullif(trim(coalesce(p_numero_tiers, '')), '');
  v_q     text := nullif(trim(coalesce(p_recherche, '')), '');
  v_res   jsonb;
begin
  if not public.hotline_peut_acceder() then
    raise exception 'Accès hotline refusé (droit can_hotline).';
  end if;
  if v_tiers is null then
    return jsonb_build_object('total', 0, 'dossiers', '[]'::jsonb);
  end if;
  if v_q is not null and length(v_q) < 2 then
    v_q := null;
  end if;

  with
  l as materialized (
    select * from public.cee_lignes_client(v_tiers, current_date - 1095, 0)
  ),
  lien as (
    select distinct coalesce(case when x.type_document = 'Bon de commande' then x.numero_piece end, x.numero_piece_bc)::text as cdc,
           x.numero_piece_devis::text as devis
    from public.devis_lignes x
    where x.numero_tiers_entete = v_tiers
      and x.type_document in ('Bon de commande', 'Préparation de livraison', 'Bon de livraison')
      and nullif(trim(x.numero_piece_devis), '') is not null
  ),
  -- CDC de la ligne, sinon celle portée par une autre ligne de la même pièce,
  -- du même BL, ou le lien SAGE devis → commande
  pc as (select piece, typ, min(bc) as bc from l where bc is not null group by piece, typ),
  blc as (select bl, min(bc) as bc from l where bl is not null and bc is not null group by bl),
  dc as (select devis, min(cdc) as cdc from lien where cdc is not null group by devis),
  l2 as (
    select l.*,
      coalesce(l.bc, pc.bc, blc.bc, case when l.typ = 'DE' then dc.cdc end) as cdc
    from l
    left join pc on pc.piece = l.piece and pc.typ = l.typ
    left join blc on blc.bl = l.bl
    left join dc on dc.devis = l.piece
  ),
  k as (
    select l2.*,
      case
        when l2.cdc is not null then 'C:' || l2.cdc
        when l2.bl is not null then 'B:' || l2.bl
        else l2.typ || ':' || l2.piece
      end as cle
    from l2
  ),
  refs as (
    select cle,
      (array_agg(ref order by case typ when 'CDC' then 1 when 'PL' then 2 when 'BL' then 3 when 'FA' then 4 else 5 end, d)
         filter (where ref is not null))[1] as ref,
      min(d) as d0
    from k group by cle
  ),
  refs_n as (select r.*, public.cee_ref_norm(r.ref) as rn from refs r),
  -- devis isolés rattachés au dossier commande de même référence chantier
  fusion as (
    select r.cle,
      coalesce((select c.cle from refs_n c
                where r.cle like 'DE:%' and c.cle like 'C:%' and r.rn is not null
                  and not public.cee_ref_generique(r.rn) and c.rn = r.rn
                  and c.d0 >= r.d0 and c.d0 < r.d0 + 365
                order by c.d0 limit 1), r.cle) as dossier
    from refs_n r
  ),
  t as (
    select k.*, f.dossier,
      (v_q is not null and (k.art ilike v_q || '%' or k.designation ilike '%' || v_q || '%')) as produit_cherche
    from k join fusion f on f.cle = k.cle
  ),
  dossiers as (
    select t.dossier,
      bool_or(v_q is null
        or t.ref ilike '%' || v_q || '%'
        or t.piece ilike v_q || '%' or t.bc ilike v_q || '%' or t.bl ilike v_q || '%'
        or t.produit_cherche) as ok,
      min(coalesce(t.d_bc, t.d)) as d_debut,
      max(coalesce(t.d_bl, t.d)) as d_fin,
      bool_or(t.typ = 'FA') as facture,
      bool_or(t.bl is not null) as livre,
      bool_or(t.typ in ('CDC', 'PL') or t.cdc is not null) as commande
    from t group by t.dossier
  ),
  retenus as (
    select d.*, count(*) over () as total
    from dossiers d
    where d.ok
    order by d.d_fin desc nulls last
    limit 20
  ),
  j as (
    select r.dossier, r.total, r.d_fin,
      jsonb_build_object(
        'cle', r.dossier,
        'reference', coalesce((select x.ref from refs x where x.cle = r.dossier),
                              (select max(t.ref) from t where t.dossier = r.dossier)),
        'etape', case when r.facture then 'Facturé' when r.livre then 'Livré' when r.commande then 'Commandé' else 'Devis' end,
        'date_debut', r.d_debut,
        'date_fin', r.d_fin,
        'cdc', (select jsonb_build_object('piece', max(t.cdc), 'date', min(t.d_bc),
                        'en_cours', bool_or(t.typ in ('CDC', 'PL')))
                from t where t.dossier = r.dossier and t.cdc is not null),
        'devis', coalesce((select jsonb_agg(jsonb_build_object('piece', x.piece, 'date', x.d, 'ht', x.ht) order by x.d)
                  from (select t.piece, min(t.d) d, round(sum(coalesce(t.amt, 0)), 2) ht
                        from t where t.dossier = r.dossier and t.typ = 'DE' group by t.piece) x), '[]'::jsonb),
        'factures', coalesce((select jsonb_agg(jsonb_build_object('piece', x.piece, 'date', x.d, 'ht', x.ht) order by x.d)
                  from (select t.piece, min(t.d) d, round(sum(coalesce(t.amt, 0)), 2) ht
                        from t where t.dossier = r.dossier and t.typ = 'FA' group by t.piece) x), '[]'::jsonb),
        'bls', coalesce((select jsonb_agg(jsonb_build_object(
                    'piece', b.bl, 'date', b.d, 'facture', b.facture, 'factures', b.factures, 'lignes', b.lignes) order by b.d)
                  from (
                    select t.bl, max(t.d_bl) d, bool_or(t.typ = 'FA') facture,
                      array_remove(array_agg(distinct case when t.typ = 'FA' then t.piece end), null) factures,
                      (select jsonb_agg(jsonb_build_object('reference_article', p.art, 'designation', p.designation,
                                 'quantite', p.qty, 'correspond', p.correspond) order by p.correspond desc, p.art)
                       from (select t2.art, max(t2.designation) designation, sum(coalesce(t2.qty, 0)) qty, bool_or(t2.produit_cherche) correspond
                             from t t2
                             where t2.dossier = r.dossier and t2.bl = t.bl and t2.typ in ('BL', 'FA')
                             group by t2.art
                             having sum(coalesce(t2.qty, 0)) <> 0) p) lignes
                    from t where t.dossier = r.dossier and t.bl is not null and t.typ in ('BL', 'FA')
                    group by t.bl
                  ) b), '[]'::jsonb),
        'reste_a_livrer', coalesce((select jsonb_agg(jsonb_build_object('reference_article', p.art, 'designation', p.designation,
                    'quantite', p.qty, 'statut', p.statut, 'correspond', p.correspond) order by p.correspond desc, p.art)
                  from (select t.art, max(t.designation) designation, sum(coalesce(t.qty, 0)) qty,
                               case when bool_or(t.typ = 'PL') then 'En préparation' else 'À livrer' end statut,
                               bool_or(t.produit_cherche) correspond
                        from t where t.dossier = r.dossier and t.typ in ('CDC', 'PL')
                        group by t.art having sum(coalesce(t.qty, 0)) <> 0) p), '[]'::jsonb),
        'devis_lignes', case when r.commande then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('reference_article', p.art,
                    'designation', p.designation, 'quantite', p.qty, 'correspond', p.correspond) order by p.correspond desc, p.art)
                  from (select t.art, max(t.designation) designation, sum(coalesce(t.qty, 0)) qty, bool_or(t.produit_cherche) correspond
                        from t where t.dossier = r.dossier and t.typ = 'DE'
                        group by t.art having sum(coalesce(t.qty, 0)) <> 0) p), '[]'::jsonb) end
      ) as dossier_json
    from retenus r
  )
  select jsonb_build_object(
    'total', coalesce(max(j.total), 0),
    'dossiers', coalesce(jsonb_agg(j.dossier_json order by j.d_fin desc nulls last), '[]'::jsonb))
  into v_res
  from j;

  return v_res;
end
$function$;

grant execute on function public.hotline_dossiers(text, text) to authenticated;

notify pgrst, 'reload schema';
