-- =============================================================================
-- Contrôle « Stock FMS SAGE ↔ MyStock » (12/11/2026, /stock/controle-mystock)
-- -----------------------------------------------------------------------------
-- FMS envoie une image MyStock de son stock, à considérer comme un stock de fin
-- de journée J (toutes réceptions et expéditions du jour passées). Le contrôle
-- est fait à J+1 / J+2 : on compare l'image au stock SAGE du dépôt FMS de fin de
-- journée J, pas au stock SAGE du moment.
--
-- Stock SAGE fin de J :
--   1. « photo » : photo quotidienne public.stock_depot_snapshot_journalier du
--      jour J (dernier import SAGE du jour, ≈ 23h05 Paris) — exact ;
--   2. « reconstitue » (pas de photo pour J) : stock SAGE actuel + sorties BL /
--      factures du dépôt datées après J (retours compris, quantités signées).
--      Les réceptions fournisseurs et les transferts de dépôt ne sont pas dans
--      les données SAGE importées : la reconstitution est signalée partielle.
--
-- Statuts par référence :
--   ok              stock identique
--   bl_jour         l'écart égale les BL SAGE des derniers jours non encore expédiés :
--                   cumul des BL datés de d à J pour un jour d entre J−7 et J (BL saisi J,
--                   parti le jour ouvré suivant ; jours fériés). bl_depuis = d le plus récent.
--   transit         l'écart égale le stock SAGE du dépôt « TRANSIT FMS » (arrivé
--                   physiquement chez FMS, pas encore réceptionné dans SAGE), seul ou
--                   avec des BL non expédiés comme ci-dessus.
--   absent_mystock  stock SAGE ≠ 0, référence absente du fichier MyStock
--   absent_sage     référence du fichier sans stock SAGE
--   ecart           écart à analyser
--
-- Accès : can_appro ou can_autorisation (user_page_access), contrôlé par chaque RPC.
-- =============================================================================

create table if not exists public.mystock_controles (
  id                 bigserial primary key,
  date_image         date        not null,
  depot_num          text        not null default '3',
  fichier_nom        text,
  colonne_reference  text,
  colonne_quantite   text,
  nb_lignes_fichier  integer,
  commentaire        text,
  resume             jsonb,
  cree_le            timestamptz not null default now(),
  cree_par           text
);

create table if not exists public.mystock_controle_lignes (
  controle_id  bigint  not null references public.mystock_controles(id) on delete cascade,
  reference    text    not null,
  designation  text,
  qte_mystock  numeric not null default 0,
  nb_lignes    integer not null default 1,
  primary key (controle_id, reference)
);

create table if not exists public.mystock_controle_suivi (
  controle_id  bigint not null references public.mystock_controles(id) on delete cascade,
  reference    text   not null,
  statut       text   not null default 'a_analyser' check (statut in ('a_analyser', 'explique', 'corrige')),
  commentaire  text,
  maj_le       timestamptz not null default now(),
  maj_par      text,
  primary key (controle_id, reference)
);

alter table public.mystock_controles        enable row level security;
alter table public.mystock_controle_lignes  enable row level security;
alter table public.mystock_controle_suivi   enable row level security;
revoke all on public.mystock_controles, public.mystock_controle_lignes, public.mystock_controle_suivi
  from anon, authenticated;

-- Droits ---------------------------------------------------------------------
create or replace function public.mystock_peut_controler()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.user_page_access u
    where u.email = public.current_user_email()
      and (coalesce(u.can_appro, false) or coalesce(u.can_autorisation, false))
  );
$$;

-- Sorties SAGE d'un dépôt (BL non facturés + lignes facturées), quantité signée
-- (BL > 0, retours < 0), à la date du BL.
create or replace function public.mystock_sorties_depot(p_depot text, p_du date, p_au date)
returns table (reference text, date_bl date, numero_bl text, client text, quantite numeric, source text)
language sql stable security definer
set search_path to 'public'
as $$
  select upper(trim(a.reference_article)), a.date_piece::date, a.numero_piece,
         a.intitule_tiers_entete, a.quantite, 'BL'
  from public.activite_lignes a
  where a.type_document in ('Bon de livraison', 'Bon de retour')
    and upper(trim(a.depot)) = upper(trim(p_depot))
    and a.date_piece::date between p_du and p_au
    and a.reference_article is not null
    and coalesce(a.quantite, 0) <> 0
  union all
  select upper(trim(f.reference_article)), coalesce(f.date_bl, f.date_facture)::date,
         coalesce(f.numero_piece_bl, f.numero_piece), f.intitule_tiers_entete, f.quantite, 'Facture'
  from public.facture_lignes f
  where upper(trim(f.depot)) = upper(trim(p_depot))
    and coalesce(f.date_bl, f.date_facture)::date between p_du and p_au
    and f.reference_article is not null
    and coalesce(f.quantite, 0) <> 0
    and not exists (
      select 1 from public.activite_lignes a2
      where a2.numero_piece = f.numero_piece_bl
        and upper(trim(a2.reference_article)) = upper(trim(f.reference_article))
    );
$$;
revoke all on function public.mystock_sorties_depot(text, date, date) from public, anon, authenticated;

-- Calcul du contrôle ------------------------------------------------------------
create or replace function public.mystock_controle_calcul(p_id bigint)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  c          public.mystock_controles%rowtype;
  v_depot    text;
  v_photo    timestamptz;
  v_actuel   timestamptz;
  v_source   text;
  v_lignes   jsonb;
  v_resume   jsonb;
begin
  select * into c from public.mystock_controles where id = p_id;
  if not found then
    raise exception 'Contrôle % introuvable', p_id;
  end if;

  select max(trim(sto_dep)), max(loaded_at) into v_depot, v_actuel
  from sage.stock_depot where sto_dep_num = c.depot_num;

  select max(loaded_at) into v_photo
  from public.stock_depot_snapshot_journalier
  where date_stock = c.date_image and sto_dep_num = c.depot_num;

  v_source := case when v_photo is not null then 'photo' else 'reconstitue' end;

  with
  actuel as (
    select upper(trim(sto_art_num)) as reference, sum(sto_qte) as qte, sum(sto_montant) as montant
    from sage.stock_depot
    where sto_dep_num = c.depot_num and sto_art_num is not null
    group by 1
  ),
  photo as (
    select reference, sto_qte as qte, sto_prepa as prepa
    from public.stock_depot_snapshot_journalier
    where date_stock = c.date_image and sto_dep_num = c.depot_num
  ),
  sorties as (
    select reference,
           sum(quantite) filter (where date_bl = c.date_image) as bl_jour,
           sum(quantite) filter (where date_bl > c.date_image) as bl_apres
    from public.mystock_sorties_depot(v_depot, c.date_image, current_date + 1)
    group by reference
  ),
  sorties_j as (
    select reference, date_bl, sum(quantite) as q
    from public.mystock_sorties_depot(v_depot, c.date_image - 7, c.date_image)
    group by reference, date_bl
    having sum(quantite) <> 0
  ),
  cumul_bl as (
    select reference, date_bl,
           sum(q) over (partition by reference order by date_bl desc) as cumul
    from sorties_j
  ),
  transit as (
    select upper(trim(s.sto_art_num)) as reference, sum(s.sto_qte) as qte
    from sage.stock_depot s
    where upper(trim(s.sto_dep)) = 'TRANSIT ' || upper(v_depot)
    group by 1
  ),
  fichier as (
    select reference, designation, qte_mystock, nb_lignes
    from public.mystock_controle_lignes where controle_id = p_id
  ),
  refs as (
    select reference from fichier
    union select reference from photo where v_source = 'photo' and qte <> 0
    union select reference from actuel where v_source = 'reconstitue'
    union select reference from sorties where v_source = 'reconstitue' and coalesce(bl_apres, 0) <> 0
  ),
  calc as (
    select r.reference,
           coalesce(ra.designation, f.designation) as designation,
           ra.famille,
           f.qte_mystock,
           coalesce(f.nb_lignes, 0) as nb_lignes_fichier,
           case when v_source = 'photo' then coalesce(p.qte, 0)
                else coalesce(a.qte, 0) + coalesce(s.bl_apres, 0) end as qte_sage,
           coalesce(a.qte, 0)         as qte_sage_actuel,
           coalesce(p.prepa, 0)       as prepa_fin_j,
           coalesce(s.bl_jour, 0)     as bl_jour,
           coalesce(s.bl_apres, 0)    as bl_apres,
           coalesce(t.qte, 0)         as transit,
           coalesce(case when a.qte > 0 and a.montant > 0 then a.montant / a.qte end,
                    nullif(ra.prix_achat, 0), 0) as pu,
           su.statut as suivi_statut, su.commentaire as suivi_commentaire,
           su.maj_par as suivi_par, su.maj_le as suivi_le
    from refs r
    left join fichier f on f.reference = r.reference
    left join photo p   on p.reference = r.reference
    left join actuel a  on a.reference = r.reference
    left join sorties s on s.reference = r.reference
    left join transit t on t.reference = r.reference
    left join public.ref_articles ra on upper(trim(ra.reference_article)) = r.reference
    left join public.mystock_controle_suivi su on su.controle_id = p_id and su.reference = r.reference
  ),
  res0 as (
    select calc.*, coalesce(qte_mystock, 0) - qte_sage as ecart
    from calc
  ),
  res1 as (
    select res0.*,
           (select max(cb.date_bl) from cumul_bl cb
             where cb.reference = res0.reference and cb.cumul = res0.ecart) as bl_depuis,
           (select max(cb.date_bl) from cumul_bl cb
             where cb.reference = res0.reference and cb.cumul + res0.transit = res0.ecart) as bl_transit_depuis
    from res0
  ),
  res as (
    select res1.*,
           case when bl_depuis is not null
                then (select cb.cumul from cumul_bl cb where cb.reference = res1.reference and cb.date_bl = res1.bl_depuis)
                when bl_transit_depuis is not null
                then (select cb.cumul from cumul_bl cb where cb.reference = res1.reference and cb.date_bl = res1.bl_transit_depuis)
                else 0 end as bl_non_expedies,
           case
             when qte_mystock is null and qte_sage = 0 then 'ok'
             when ecart = 0 then 'ok'
             when qte_mystock is null then 'absent_mystock'
             when bl_depuis is not null then 'bl_jour'
             when transit <> 0 and (ecart = transit or bl_transit_depuis is not null) then 'transit'
             when qte_sage = 0 then 'absent_sage'
             else 'ecart'
           end as statut
    from res1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'reference', reference, 'designation', designation, 'famille', famille,
           'qte_mystock', qte_mystock, 'nb_lignes_fichier', nb_lignes_fichier,
           'qte_sage', qte_sage, 'qte_sage_actuel', qte_sage_actuel, 'prepa_fin_j', prepa_fin_j,
           'bl_jour', bl_jour, 'bl_apres', bl_apres, 'transit', transit,
           'bl_non_expedies', bl_non_expedies, 'bl_depuis', coalesce(bl_depuis, bl_transit_depuis),
           'ecart', ecart, 'pu', round(pu, 4), 'ecart_valeur', round(ecart * pu, 2),
           'statut', statut,
           'suivi_statut', suivi_statut, 'suivi_commentaire', suivi_commentaire,
           'suivi_par', suivi_par, 'suivi_le', suivi_le
         ) order by (statut = 'ok'), abs(ecart * pu) desc, reference), '[]'::jsonb),
         jsonb_build_object(
           'nb_references', count(*),
           'nb_ok', count(*) filter (where statut = 'ok'),
           'nb_bl_jour', count(*) filter (where statut = 'bl_jour'),
           'nb_transit', count(*) filter (where statut = 'transit'),
           'valeur_bl_jour', coalesce(round(sum(ecart * pu) filter (where statut = 'bl_jour'), 2), 0),
           'valeur_transit', coalesce(round(sum(ecart * pu) filter (where statut = 'transit'), 2), 0),
           'nb_ecart', count(*) filter (where statut = 'ecart'),
           'nb_absent_mystock', count(*) filter (where statut = 'absent_mystock'),
           'nb_absent_sage', count(*) filter (where statut = 'absent_sage'),
           'nb_a_analyser', count(*) filter (where statut in ('ecart', 'absent_mystock', 'absent_sage')
                                              and coalesce(suivi_statut, 'a_analyser') = 'a_analyser'),
           'qte_mystock', coalesce(sum(qte_mystock), 0),
           'qte_sage', coalesce(sum(qte_sage), 0),
           'valeur_ecart_abs', coalesce(round(sum(abs(ecart * pu)) filter (where statut <> 'ok'), 2), 0),
           'valeur_a_analyser_abs', coalesce(round(sum(abs(ecart * pu)) filter (where statut in ('ecart', 'absent_mystock', 'absent_sage')), 2), 0),
           'valeur_ecart_net', coalesce(round(sum(ecart * pu), 2), 0)
         )
    into v_lignes, v_resume
  from res;

  return jsonb_build_object(
    'controle', to_jsonb(c) - 'resume',
    'meta', jsonb_build_object(
      'depot', v_depot,
      'source_sage', v_source,
      'photo_loaded_at', v_photo,
      'stock_actuel_loaded_at', v_actuel,
      'reconstitution_partielle', v_source = 'reconstitue'
    ),
    'resume', v_resume,
    'lignes', v_lignes
  );
end;
$$;
revoke all on function public.mystock_controle_calcul(bigint) from public, anon, authenticated;

-- RPC exposées ---------------------------------------------------------------------

-- Création d'un contrôle à partir du fichier lu dans le navigateur.
-- p_lignes = [{ "reference": "...", "designation": "...", "qte": 12, "nb": 1 }, ...]
create or replace function public.mystock_controle_creer(
  p_date_image date, p_fichier text, p_col_reference text, p_col_quantite text,
  p_nb_lignes_fichier integer, p_lignes jsonb, p_depot_num text default '3'
)
returns jsonb
language plpgsql security definer
set search_path to 'public'
set statement_timeout to '120s'
as $$
declare
  v_id     bigint;
  v_result jsonb;
begin
  if not public.mystock_peut_controler() then
    raise exception 'Accès refusé : droit Appro requis';
  end if;
  if p_date_image is null then
    raise exception 'Date de l''image MyStock obligatoire';
  end if;
  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Aucune ligne lue dans le fichier';
  end if;

  insert into public.mystock_controles
    (date_image, depot_num, fichier_nom, colonne_reference, colonne_quantite, nb_lignes_fichier, cree_par)
  values (p_date_image, coalesce(nullif(p_depot_num, ''), '3'), p_fichier, p_col_reference, p_col_quantite,
          p_nb_lignes_fichier, public.current_user_email())
  returning id into v_id;

  insert into public.mystock_controle_lignes (controle_id, reference, designation, qte_mystock, nb_lignes)
  select v_id, ref, max(des), sum(qte), sum(nb)::int
  from (
    select upper(trim(e->>'reference')) as ref,
           nullif(trim(e->>'designation'), '') as des,
           coalesce(nullif(replace(e->>'qte', ',', '.'), '')::numeric, 0) as qte,
           coalesce(nullif(e->>'nb', '')::int, 1) as nb
    from jsonb_array_elements(p_lignes) e
  ) x
  where ref is not null and ref <> ''
  group by ref;

  v_result := public.mystock_controle_calcul(v_id);
  update public.mystock_controles set resume = v_result->'resume' where id = v_id;
  return v_result;
end;
$$;

create or replace function public.mystock_controle_resultat(p_id bigint)
returns jsonb
language plpgsql security definer
set search_path to 'public'
set statement_timeout to '120s'
as $$
declare
  v_result jsonb;
begin
  if not public.mystock_peut_controler() then
    raise exception 'Accès refusé : droit Appro requis';
  end if;
  v_result := public.mystock_controle_calcul(p_id);
  update public.mystock_controles set resume = v_result->'resume' where id = p_id;
  return v_result;
end;
$$;

create or replace function public.mystock_controles_liste()
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  if not public.mystock_peut_controler() then
    raise exception 'Accès refusé : droit Appro requis';
  end if;
  return jsonb_build_object(
    'controles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'date_image', c.date_image, 'depot_num', c.depot_num,
               'fichier_nom', c.fichier_nom, 'nb_lignes_fichier', c.nb_lignes_fichier,
               'cree_le', c.cree_le, 'cree_par', c.cree_par, 'resume', c.resume,
               'photo_disponible', exists (select 1 from public.stock_depot_snapshot_journalier s
                                           where s.date_stock = c.date_image and s.sto_dep_num = c.depot_num)
             ) order by c.date_image desc, c.id desc)
      from (select * from public.mystock_controles order by date_image desc, id desc limit 100) c
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('date_stock', d.date_stock, 'loaded_at', d.loaded_at) order by d.date_stock desc)
      from (select date_stock, max(loaded_at) as loaded_at
            from public.stock_depot_snapshot_journalier
            where sto_dep_num = '3'
            group by date_stock order by date_stock desc limit 60) d
    ), '[]'::jsonb)
  );
end;
$$;

-- Mouvements SAGE d'une référence autour de J (J−3 → aujourd'hui).
create or replace function public.mystock_controle_mouvements(p_id bigint, p_reference text)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  c       public.mystock_controles%rowtype;
  v_depot text;
begin
  if not public.mystock_peut_controler() then
    raise exception 'Accès refusé : droit Appro requis';
  end if;
  select * into c from public.mystock_controles where id = p_id;
  if not found then
    raise exception 'Contrôle % introuvable', p_id;
  end if;
  select max(trim(sto_dep)) into v_depot from sage.stock_depot where sto_dep_num = c.depot_num;

  return jsonb_build_object(
    'mouvements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', m.date_bl, 'numero', m.numero_bl, 'client', m.client,
               'quantite', m.quantite, 'source', m.source,
               'position', case when m.date_bl < c.date_image then 'avant'
                                when m.date_bl = c.date_image then 'jour'
                                else 'apres' end
             ) order by m.date_bl, m.numero_bl)
      from public.mystock_sorties_depot(v_depot, c.date_image - 3, current_date + 1) m
      where m.reference = upper(trim(p_reference))
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('date_stock', s.date_stock, 'qte', s.sto_qte, 'prepa', s.sto_prepa)
                       order by s.date_stock)
      from public.stock_depot_snapshot_journalier s
      where s.sto_dep_num = c.depot_num and s.reference = upper(trim(p_reference))
        and s.date_stock between c.date_image - 3 and current_date
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.mystock_controle_annoter(
  p_id bigint, p_reference text, p_statut text, p_commentaire text
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not public.mystock_peut_controler() then
    raise exception 'Accès refusé : droit Appro requis';
  end if;
  insert into public.mystock_controle_suivi (controle_id, reference, statut, commentaire, maj_le, maj_par)
  values (p_id, upper(trim(p_reference)), coalesce(nullif(p_statut, ''), 'a_analyser'),
          nullif(trim(p_commentaire), ''), now(), public.current_user_email())
  on conflict (controle_id, reference) do update
    set statut = excluded.statut, commentaire = excluded.commentaire,
        maj_le = excluded.maj_le, maj_par = excluded.maj_par;
end;
$$;

create or replace function public.mystock_controle_supprimer(p_id bigint)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not public.mystock_peut_controler() then
    raise exception 'Accès refusé : droit Appro requis';
  end if;
  delete from public.mystock_controles where id = p_id;
end;
$$;

revoke all on function public.mystock_controle_creer(date, text, text, text, integer, jsonb, text) from public, anon;
revoke all on function public.mystock_controle_resultat(bigint) from public, anon;
revoke all on function public.mystock_controles_liste() from public, anon;
revoke all on function public.mystock_controle_mouvements(bigint, text) from public, anon;
revoke all on function public.mystock_controle_annoter(bigint, text, text, text) from public, anon;
revoke all on function public.mystock_controle_supprimer(bigint) from public, anon;
grant execute on function public.mystock_controle_creer(date, text, text, text, integer, jsonb, text) to authenticated;
grant execute on function public.mystock_controle_resultat(bigint) to authenticated;
grant execute on function public.mystock_controles_liste() to authenticated;
grant execute on function public.mystock_controle_mouvements(bigint, text) to authenticated;
grant execute on function public.mystock_controle_annoter(bigint, text, text, text) to authenticated;
grant execute on function public.mystock_controle_supprimer(bigint) to authenticated;
grant execute on function public.mystock_peut_controler() to authenticated;
