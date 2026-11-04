-- ============================================================================
-- 20261102e_hotline_chantier_ou_produit.sql — Hotline (02/11/2026)
-- ----------------------------------------------------------------------------
-- Le champ « Chantier / référence » de la console est utilisé comme recherche
-- libre (ex. « YUTAKI ») : quand le client est identifié, il cherche aussi dans
-- la référence et la désignation des produits, en plus de la référence
-- chantier / projet SAGE. Sans client identifié, il reste limité au chantier
-- (sinon il remonterait les ventes de tous les clients).
-- Concerne hotline_livraisons et les documents de vente de hotline_contexte.
-- ============================================================================

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

  select array_agg(bl) into v_bls
  from (
    select f.numero_piece_bl as bl
    from public.facture_lignes f
    where f.date_facture >= current_date - interval '5 years'
      and f.numero_piece_bl is not null and f.numero_piece_bl <> ''
      and (v_tiers is null or f.numero_tiers_entete = v_tiers)
      and (v_chant is null
           or f.reference ilike '%' || v_chant || '%'
           or f.projet ilike '%' || v_chant || '%'
           or (v_tiers is not null and (f.reference_article ilike v_chant || '%'
                                        or f.designation ilike '%' || v_chant || '%'
                                        or coalesce(f.designation_article, '') ilike '%' || v_chant || '%')))
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
            or (v_chant is not null and v_tiers is not null and (f.reference_article ilike v_chant || '%' or f.designation ilike '%' || v_chant || '%'
              or coalesce(f.designation_article, '') ilike '%' || v_chant || '%'))
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

create or replace function public.hotline_contexte(
  p_numero_tiers text default null,
  p_telephone    text default null,
  p_chantier     text default null,
  p_numero_serie text default null,
  p_contact_nom  text default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tiers   text := nullif(trim(coalesce(p_numero_tiers, '')), '');
  v_cle     text := public.hotline_tel_cle(p_telephone);
  v_chant   text := nullif(trim(coalesce(p_chantier, '')), '');
  v_serie   text := nullif(trim(coalesce(p_numero_serie, '')), '');
  v_contact text := nullif(trim(coalesce(p_contact_nom, '')), '');
  v_client  jsonb;
  v_contact_tickets jsonb;
  v_chantier jsonb;
  v_docs    jsonb;
begin
  if not public.hotline_peut_acceder() then
    raise exception 'Accès hotline refusé (droit can_hotline).';
  end if;

  if v_cle is not null and length(v_cle) < 9 then
    v_cle := null;
  end if;

  select coalesce(jsonb_agg(x order by x->>'opened_at' desc), '[]'::jsonb) into v_client
  from (
    select public.hotline_ticket_resume(t) x
    from public.hotline_tickets t
    where v_tiers is not null and t.numero_tiers = v_tiers
    order by t.opened_at desc limit 15
  ) s;

  select coalesce(jsonb_agg(x order by x->>'opened_at' desc), '[]'::jsonb) into v_contact_tickets
  from (
    select public.hotline_ticket_resume(t) x
    from public.hotline_tickets t
    where (v_cle is not null and public.hotline_tel_cle(t.telephone_appelant) = v_cle)
       or (v_contact is not null and v_tiers is not null and t.numero_tiers = v_tiers and lower(trim(t.contact_nom)) = lower(v_contact))
    order by t.opened_at desc limit 15
  ) s;

  select coalesce(jsonb_agg(x order by x->>'opened_at' desc), '[]'::jsonb) into v_chantier
  from (
    select public.hotline_ticket_resume(t) x
    from public.hotline_tickets t
    where (v_chant is not null and (t.chantier ilike '%' || v_chant || '%' or t.reference_article ilike '%' || v_chant || '%'))
       or (v_serie is not null and t.numero_serie ilike '%' || v_serie || '%')
    order by t.opened_at desc limit 15
  ) s;

  if v_tiers is null and v_serie is null then
    v_docs := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(d order by d->>'date' desc), '[]'::jsonb) into v_docs
    from (
      select jsonb_build_object(
               'numero_piece', f.numero_piece,
               'numero_bl', max(f.numero_piece_bl),
               'date', max(f.date_facture),
               'numero_tiers', max(f.numero_tiers_entete),
               'reference', max(f.reference),
               'projet', max(f.projet),
               'montant_ht', round(sum(f.montant_ht)::numeric, 2),
               'articles', (array_agg(distinct coalesce(nullif(f.designation_article, ''), f.designation)
                              order by coalesce(nullif(f.designation_article, ''), f.designation)))[1:6],
               'series', array_remove(array_agg(distinct nullif(f.numero_serie_lot, '')), null)
             ) d
      from public.facture_lignes f
      where (v_tiers is null or f.numero_tiers_entete = v_tiers)
        and (v_chant is null
             or f.reference ilike '%' || v_chant || '%'
             or f.projet ilike '%' || v_chant || '%'
             or (v_tiers is not null and (f.reference_article ilike v_chant || '%'
                                          or f.designation ilike '%' || v_chant || '%'
                                          or coalesce(f.designation_article, '') ilike '%' || v_chant || '%')))
        and (v_serie is null or f.numero_serie_lot ilike '%' || v_serie || '%')
        and f.date_facture >= current_date - interval '36 months'
      group by f.numero_piece
      order by max(f.date_facture) desc
      limit 25
    ) s;
  end if;

  return jsonb_build_object(
    'tickets', v_client,
    'tickets_client', v_client,
    'tickets_contact', v_contact_tickets,
    'tickets_chantier', v_chantier,
    'documents', v_docs
  );
end
$function$;

notify pgrst, 'reload schema';
