-- ============================================================================
-- 20261120c_quand_puis_je_livrer.sql — « Quand puis-je livrer ? » (20/11/2026)
-- ----------------------------------------------------------------------------
-- Contrôle avant commande, en libre-service : à partir d'un n° de devis ou d'une
-- liste articles + quantités collée, chaque ligne reçoit sa date au plus tôt
-- (get_dispo_lignes_quantites, migration du même jour), le statut de l'article
-- (sommeil, non stocké, inconnu) et, pour un devis, l'écart entre le prix du
-- devis et le prix actuel (tarif de base de vente et prix de revient / PUMP).
--
-- Objets :
--   ql_peut_voir_tiers(tiers, collaborateur)   même règle que devis_lignes_select_scoped
--   ql_article_infos(refs[])                   fiche article + prix actuels
--   get_quand_livrer_articles(refs[])          jsonb, pour la saisie collée / photo
--   get_quand_livrer_devis(numero)             jsonb : entête, blocs, lignes
--   get_quand_livrer_devis_recherche(q, n)     derniers devis visibles / recherche
--
-- Blocs du devis : sage.devis_lignes_structure (ordre dl_ligne, depuis 01/2025) ;
-- une ligne sans référence article = commentaire ; un commentaire qui suit une
-- ligne article ouvre un nouveau bloc ; libellé du bloc = dernier commentaire
-- non vide avant ses articles. Devis plus anciens : devis_lignes, un seul bloc.
-- Prix actuels : PV = article_bis.ar_prixven (repli articles.art_prix) ;
-- PR actuel = PUMP tous dépôts (sto_montant / sto_qte) sinon dernier prix d'achat.
-- PR du devis : devis_lignes.prix_revient_unitaire porte le PR TOTAL de la ligne
-- (vérifié sur 2025-2026 : ratio / quantité ≈ 1), d'où la division par la quantité.
-- ============================================================================

create or replace function public.ql_peut_voir_tiers(p_tiers text, p_collab text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select
    exists (select 1 from user_page_access upa
             where upa.email = current_user_email()
               and (coalesce(upa.can_autorisation,false) or coalesce(upa.can_change_scope,false)))
    or not exists (select 1 from my_allowed_collaborateurs_set())
    or p_tiers in (select my_allowed_tiers_set())
    or (p_tiers in (select my_non_affecte_tiers_set())
        and collab_key(p_collab) in (select my_allowed_collaborateurs_keys()));
$$;

create or replace function public.ql_article_infos(p_refs text[])
returns table(
  reference_article text, connu boolean, designation text, famille text,
  type_ligne text, sommeil boolean, pu_vente_actuel numeric, pr_actuel numeric,
  pr_actuel_source text
)
language sql stable security definer
set search_path to 'public'
as $$
  with r as (select distinct upper(trim(x)) ref from unnest(coalesce(p_refs,'{}'::text[])) x where coalesce(trim(x),'')<>''),
  st as (
    select upper(trim(s.sto_art_num)) ref,
           sum(case when s.sto_qte > 0 then s.sto_montant end) mt,
           sum(case when s.sto_qte > 0 then s.sto_qte end) q
    from sage.stock_depot s join r on r.ref = upper(trim(s.sto_art_num))
    group by 1
  )
  select r.ref,
         a.art_num is not null,
         coalesce(b.ar_design, a.art_lib),
         a.art_facodefamille,
         case when a.art_num is null then 'INCONNU'
              when a.art_suivistock = 'Aucun' then 'NON_STOCKE'
              else 'ARTICLE' end,
         coalesce(a.art_sommeil = 'En sommeil', false),
         round(coalesce(nullif(b.ar_prixven,0), nullif(a.art_prix,0)), 4),
         round(coalesce(case when st.q > 0 then st.mt / st.q end, nullif(a.art_derprixach,0)), 4),
         case when st.q > 0 then 'PUMP' when nullif(a.art_derprixach,0) is not null then 'DERNIER_ACHAT' end
  from r
  left join sage.articles a on upper(trim(a.art_num)) = r.ref
  left join sage.article_bis b on b.ar_ref = a.art_num
  left join st on st.ref = r.ref;
$$;

create or replace function public.get_quand_livrer_articles(p_refs text[])
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from ql_article_infos(p_refs) i;
$$;

create or replace function public.get_quand_livrer_devis(p_numero text)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  v_num text := upper(trim(coalesce(p_numero,'')));
  v_ent record;
  v_src text;
  v_lignes jsonb;
  v_blocs jsonb;
begin
  if v_num = '' then return jsonb_build_object('trouve', false); end if;

  select e.numero_piece, e.date_devis, e.numero_tiers, e.intitule_tiers, e.collaborateur, e.reference, e.ca_ht
    into v_ent
  from devis_entetes_cache e where e.numero_piece = v_num
  order by e.date_devis desc nulls last limit 1;

  if not found then
    select l.numero_piece, min(l.date_devis) date_devis, max(l.numero_tiers_entete) numero_tiers,
           max(l.intitule_tiers_entete) intitule_tiers, max(l.collaborateur) collaborateur,
           max(l.reference) reference, sum(l.montant_ht) ca_ht
      into v_ent
    from devis_lignes l where l.numero_piece = v_num group by l.numero_piece;
    if not found then return jsonb_build_object('trouve', false, 'numero', v_num); end if;
  end if;

  if not ql_peut_voir_tiers(v_ent.numero_tiers, v_ent.collaborateur) then
    return jsonb_build_object('trouve', false, 'refuse', true, 'numero', v_num);
  end if;

  if exists (select 1 from sage.devis_lignes_structure where numero_piece = v_num) then
    v_src := 'STRUCTURE';
    with s0 as (
      select distinct on (s.dl_ligne) s.dl_ligne, nullif(upper(trim(s.ar_ref)),'') ref,
             nullif(trim(s.dl_design),'') design, coalesce(s.dl_qte,0) qte,
             s.dl_prixunitaire pu, s.dl_remise remise, s.dl_montantht mt
      from sage.devis_lignes_structure s where s.numero_piece = v_num
      order by s.dl_ligne, s.id desc
    ),
    s1 as (
      select s0.*, case when ref is null and lag(ref) over (order by dl_ligne) is not null then 1 else 0 end nb
      from s0
    ),
    s2 as (select s1.*, 1 + sum(nb) over (order by dl_ligne rows unbounded preceding) bloc from s1),
    pr as (
      select upper(trim(reference_article)) ref,
             round(sum(prix_revient_unitaire) / nullif(sum(case when prix_revient_unitaire is not null then quantite end),0), 4) prd
      from devis_lignes where numero_piece = v_num group by 1
    ),
    inf as (select * from ql_article_infos(array(select distinct ref from s2 where ref is not null)))
    select
      jsonb_agg(jsonb_build_object(
        'ordre', s2.dl_ligne, 'bloc', s2.bloc,
        'type', case when s2.ref is null then 'COMMENTAIRE' else i.type_ligne end,
        'ref', s2.ref, 'designation', coalesce(s2.design, i.designation),
        'qte', s2.qte, 'pu_devis', s2.pu, 'remise_pct', s2.remise, 'montant_ht', s2.mt,
        'pu_actuel', i.pu_vente_actuel, 'pr_devis', pr.prd, 'pr_actuel', i.pr_actuel,
        'pr_actuel_source', i.pr_actuel_source, 'sommeil', coalesce(i.sommeil,false), 'famille', i.famille
      ) order by s2.dl_ligne),
      (select jsonb_agg(jsonb_build_object('bloc', b.bloc, 'libelle', b.lib) order by b.bloc)
         from (select bloc, (array_agg(design order by dl_ligne desc) filter (where ref is null and design is not null))[1] lib
                 from s2 group by bloc) b)
      into v_lignes, v_blocs
    from s2
    left join inf i on i.reference_article = s2.ref
    left join pr on pr.ref = s2.ref;
  else
    v_src := 'LIGNES';
    with l as (
      select upper(trim(d.reference_article)) ref, d.designation, coalesce(d.quantite,0) qte, d.pu_ht,
             case when d.remise is not null and d.remise <= 1 then d.remise * 100 else d.remise end remise,
             d.montant_ht, round(d.prix_revient_unitaire / nullif(d.quantite,0), 4) prd,
             row_number() over (order by d.reference_article, d.id) rn
      from devis_lignes d where d.numero_piece = v_num and coalesce(trim(d.reference_article),'') <> ''
    ),
    inf as (select * from ql_article_infos(array(select distinct ref from l)))
    select jsonb_agg(jsonb_build_object(
             'ordre', l.rn, 'bloc', 1, 'type', i.type_ligne, 'ref', l.ref,
             'designation', coalesce(l.designation, i.designation), 'qte', l.qte,
             'pu_devis', l.pu_ht, 'remise_pct', l.remise, 'montant_ht', l.montant_ht,
             'pu_actuel', i.pu_vente_actuel, 'pr_devis', l.prd, 'pr_actuel', i.pr_actuel,
             'pr_actuel_source', i.pr_actuel_source, 'sommeil', coalesce(i.sommeil,false), 'famille', i.famille
           ) order by l.rn),
           jsonb_build_array(jsonb_build_object('bloc', 1, 'libelle', null))
      into v_lignes, v_blocs
    from l left join inf i on i.reference_article = l.ref;
  end if;

  return jsonb_build_object(
    'trouve', true,
    'source', v_src,
    'entete', jsonb_build_object(
      'numero', v_ent.numero_piece, 'date_devis', v_ent.date_devis,
      'numero_tiers', v_ent.numero_tiers, 'client', v_ent.intitule_tiers,
      'collaborateur', v_ent.collaborateur, 'reference', v_ent.reference, 'montant_ht', v_ent.ca_ht,
      'age_jours', (now() at time zone 'Europe/Paris')::date - v_ent.date_devis),
    'blocs', coalesce(v_blocs, '[]'::jsonb),
    'lignes', coalesce(v_lignes, '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_quand_livrer_devis_recherche(p_q text default null, p_limit integer default 15)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  v_q text := nullif(trim(coalesce(p_q,'')),'');
  v_tout boolean;
  v_res jsonb;
begin
  v_tout := exists (select 1 from user_page_access upa
                     where upa.email = current_user_email()
                       and (coalesce(upa.can_autorisation,false) or coalesce(upa.can_change_scope,false)))
            or not exists (select 1 from my_allowed_collaborateurs_set());

  with tiers_ok as (select my_allowed_tiers_set() t),
  na as (select my_non_affecte_tiers_set() t),
  ck as (select my_allowed_collaborateurs_keys() k),
  e as (
    select distinct on (d.numero_piece) d.numero_piece, d.date_devis, d.numero_tiers, d.intitule_tiers,
           d.collaborateur, d.reference, d.ca_ht, d.nb_lignes
    from devis_entetes_cache d
    where (v_q is null and d.date_devis >= (now() at time zone 'Europe/Paris')::date - 120
           or d.numero_piece ilike v_q || '%'
           or d.intitule_tiers ilike '%' || v_q || '%'
           or d.reference ilike '%' || v_q || '%'
           or d.numero_tiers ilike v_q || '%')
      and (v_tout
           or d.numero_tiers in (select t from tiers_ok)
           or (d.numero_tiers in (select t from na) and collab_key(d.collaborateur) in (select k from ck)))
    order by d.numero_piece, d.date_devis desc
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.date_devis desc, x.numero_piece desc), '[]'::jsonb)
    into v_res
  from (select * from e order by date_devis desc, numero_piece desc limit greatest(1, least(coalesce(p_limit,15), 50))) x;
  return v_res;
end;
$$;

revoke all on function public.ql_peut_voir_tiers(text, text) from public, anon;
revoke all on function public.ql_article_infos(text[]) from public, anon;
revoke all on function public.get_quand_livrer_articles(text[]) from public, anon;
revoke all on function public.get_quand_livrer_devis(text) from public, anon;
revoke all on function public.get_quand_livrer_devis_recherche(text, integer) from public, anon;
grant execute on function public.ql_peut_voir_tiers(text, text) to authenticated;
grant execute on function public.ql_article_infos(text[]) to authenticated;
grant execute on function public.get_quand_livrer_articles(text[]) to authenticated;
grant execute on function public.get_quand_livrer_devis(text) to authenticated;
grant execute on function public.get_quand_livrer_devis_recherche(text, integer) to authenticated;
grant execute on function public.get_dispo_lignes_quantites(jsonb) to authenticated;
