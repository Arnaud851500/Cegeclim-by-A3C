-- =============================================================================
-- Analyse stock dépôt — ventes immédiates (22/11/2026, demandé par Arnaud)
-- -----------------------------------------------------------------------------
-- Constat : une partie des sorties d'un dépôt provient de commandes passées bien
-- avant la sortie (le dépôt a eu le temps de se faire livrer). Le stock agence doit
-- servir les ventes quasi immédiates : ce sont elles qui décident « stocker ou non »
-- et qui alimentent μ / σ / pics / MIN / MAX.
--
-- Règle : une sortie est IMMÉDIATE si
--   - la ligne de BL ne porte aucune commande (numero_piece_bc vide : vente comptoir / BL direct), ou
--   - date_bl − date_bc ≤ delai_vente_immediate_jours (10 j par défaut, paramètre de l'écran).
-- Les retours sans commande sont déduits des ventes immédiates.
-- Le total des sorties (immédiates + sur commande) reste affiché et sert à l'ABC / XYZ.
-- =============================================================================

insert into public.stock_agence_parametres (cle, valeur, description)
values ('delai_vente_immediate_jours', 10, 'Vente immédiate : BL sans commande ou commande ≤ N jours avant le BL')
on conflict (cle) do nothing;

-- -----------------------------------------------------------------------------
-- MIN / MAX FIGÉS par dépôt (22/11/2026, demandé par Arnaud)
-- Les MIN / MAX ne doivent pas bouger à chaque ouverture de l'écran : ils sont figés
-- sur demande (bouton « Figer / mettre à jour les MIN/MAX »), servent de référence à
-- l'écran (statuts, excédent, à appro.) et au fichier d'extraction BLG.
-- Une saisie manuelle (décision forcée / MIN / MAX retenus) met à jour la seule référence.
-- -----------------------------------------------------------------------------
alter table public.stock_agence_depots add column if not exists blg_warehouse_id integer;
update public.stock_agence_depots d
   set blg_warehouse_id = (select w.id from blg.article_warehouse w
                           where upper(trim(w.title)) = upper(trim(d.libelle))
                           order by (w.type = 'centralWarehouse') desc, w.active desc, w.id limit 1)
 where d.blg_warehouse_id is null;

create table if not exists public.stock_agence_minmax_fige_entete (
  depot_num   text primary key,
  fige_le     timestamptz not null default now(),
  fige_par    text,
  maj_le      timestamptz,
  maj_par     text,
  nb_refs     integer,
  nb_stocker  integer
);
create table if not exists public.stock_agence_minmax_fige (
  depot_num          text not null,
  reference_article  text not null,
  decision           text not null,           -- STOCKER | SURVEILLER | NE_PAS_STOCKER
  smin               numeric not null default 0,
  smax               numeric not null default 0,
  min_calc           numeric,
  max_calc           numeric,
  nb_sem             integer,
  mu_sem             numeric,
  manuel             boolean not null default false,
  fige_le            timestamptz not null default now(),
  fige_par           text,
  primary key (depot_num, reference_article)
);
alter table public.stock_agence_minmax_fige_entete enable row level security;
alter table public.stock_agence_minmax_fige enable row level security;
drop policy if exists stock_agence_minmax_fige_entete_select on public.stock_agence_minmax_fige_entete;
create policy stock_agence_minmax_fige_entete_select on public.stock_agence_minmax_fige_entete for select to authenticated using (true);
drop policy if exists stock_agence_minmax_fige_select on public.stock_agence_minmax_fige;
create policy stock_agence_minmax_fige_select on public.stock_agence_minmax_fige for select to authenticated using (true);

drop function if exists public.stock_agence_sorties(text, date);

create or replace function public.stock_agence_sorties(p_libelle text, p_depuis date, p_delai_imm int default 10)
returns table(ref text, d date, bl text, tiers text, q numeric, m numeric, mg numeric, bc text, d_bc date, imm boolean)
language sql
stable
set search_path to 'public'
as $function$
  select upper(trim(f.reference_article)), f.date_bl, coalesce(f.numero_piece_bl, f.numero_piece), f.numero_tiers_entete,
         case when coalesce(f.quantite, 0) < 0 or (coalesce(f.quantite, 0) = 0 and coalesce(f.montant_ht, 0) < 0) then -1 else 1 end
           * abs(coalesce(nullif(f.qte_livree, 0), nullif(f.quantite, 0), 0)),
         coalesce(f.montant_ht, 0), coalesce(f.marge_valeur, 0),
         nullif(trim(f.numero_piece_bc), ''),
         case when nullif(trim(f.numero_piece_bc), '') is not null then f.date_bc end,
         nullif(trim(f.numero_piece_bc), '') is null or f.date_bc is null or f.date_bl - f.date_bc <= p_delai_imm
  from facture_lignes f
  where f.depot = p_libelle and f.date_bl >= p_depuis
    and nullif(trim(f.reference_article), '') is not null
  union all
  select upper(trim(a.reference_article)), a.date_bl, a.numero_piece, a.numero_tiers_entete,
         case when a.type_document = 'Bon de retour' then -1 else 1 end * abs(coalesce(nullif(a.qte_livree, 0), nullif(a.quantite, 0), 0)),
         case when a.type_document = 'Bon de retour' then -abs(coalesce(a.montant_ht, 0)) else coalesce(a.montant_ht, 0) end,
         coalesce(a.marge_valeur, 0),
         nullif(trim(a.numero_piece_bc), ''),
         case when nullif(trim(a.numero_piece_bc), '') is not null then a.date_bc end,
         nullif(trim(a.numero_piece_bc), '') is null or a.date_bc is null or a.date_bl - a.date_bc <= p_delai_imm
  from activite_lignes a
  where a.depot = p_libelle and a.type_document in ('Bon de livraison', 'Bon de retour') and a.date_bl >= p_depuis
    and nullif(trim(a.reference_article), '') is not null
    and not exists (select 1 from facture_lignes f
                    where f.numero_piece_bl = a.numero_piece and f.reference_article = a.reference_article and f.date_bl is not null)
$function$;

-- -----------------------------------------------------------------------------
-- Analyse dépôt
-- -----------------------------------------------------------------------------
create or replace function public.get_stock_agence_analyse(p_depot_num text, p_depuis date default '2025-01-01'::date)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'sage'
set statement_timeout to '120s'
set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  d        public.stock_agence_depots%rowtype;
  v_w1     date := date_trunc('week', current_date)::date;   -- lundi de la semaine en cours (exclu)
  v_m1     date := date_trunc('month', current_date)::date;  -- 1er du mois en cours (exclu)
  v_nsem   int;
  v_w0     date;
  v_m0     date;
  v_deb    date;
  p_l_my   numeric; p_c_my numeric; p_l_hm numeric; p_c_hm numeric;
  p_z      numeric; p_st numeric; p_su numeric; p_k numeric; p_di numeric;
  v_rows   jsonb;
begin
  -- 27/10/2026 : analyse figée sur le dépôt de l'agence du collaborateur
  if public.stock_agence_depots_user() is not null and not (p_depot_num = any(public.stock_agence_depots_user())) then
    raise exception 'Dépôt non autorisé : l''analyse est limitée au dépôt de votre agence' using errcode = '42501';
  end if;
  select * into d from stock_agence_depots where depot_num = p_depot_num;
  if not found then raise exception 'Dépôt % inconnu (stock_agence_depots)', p_depot_num; end if;

  select coalesce(max(valeur) filter (where cle = 'periode_semaines'), 52)::int,
         coalesce(max(valeur) filter (where cle = 'delai_mystock_jours'), 7),
         coalesce(max(valeur) filter (where cle = 'cycle_mystock_jours'), 3.5),
         coalesce(max(valeur) filter (where cle = 'delai_hors_mystock_defaut_jours'), 21),
         coalesce(max(valeur) filter (where cle = 'cycle_hors_mystock_jours'), 14),
         coalesce(max(valeur) filter (where cle = 'niveau_service_z'), 1.65),
         coalesce(max(valeur) filter (where cle = 'seuil_semaines_stocker'), 8),
         coalesce(max(valeur) filter (where cle = 'seuil_semaines_surveiller'), 3),
         coalesce(max(valeur) filter (where cle = 'pic_mad_k'), 3),
         coalesce(max(valeur) filter (where cle = 'delai_vente_immediate_jours'), 10)
    into v_nsem, p_l_my, p_c_my, p_l_hm, p_c_hm, p_z, p_st, p_su, p_k, p_di
  from stock_agence_parametres;

  v_w0  := v_w1 - v_nsem * 7;
  v_m0  := (v_m1 - interval '12 months')::date;
  v_deb := least(p_depuis, v_w0, v_m0);

  drop table if exists _sa_s, _sa_sem, _sa_st, _sa_mois, _sa_ref;

  create temp table _sa_s on commit drop as
    select * from stock_agence_sorties(d.libelle, v_deb, p_di::int);

  -- 22/11/2026 : q = ventes IMMÉDIATES (BL sans commande ou commande ≤ p_di jours), qt = toutes les sorties
  create temp table _sa_sem on commit drop as
    select ref, date_trunc('week', s.d)::date w, coalesce(sum(q) filter (where imm), 0) q, sum(q) qt
    from _sa_s s where s.d >= v_w0 and s.d < v_w1 group by 1, 2;

  -- Statistiques hebdomadaires sur les ventes immédiates, avec écrêtage des pics exceptionnels
  create temp table _sa_st on commit drop as
  with refs as (select distinct ref from _sa_sem),
  grid as (
    select r.ref, g.w::date w, coalesce(s.q, 0) q, coalesce(s.qt, 0) qt
    from refs r
    cross join generate_series(v_w0, v_w1 - 7, interval '7 days') g(w)
    left join _sa_sem s on s.ref = r.ref and s.w = g.w::date),
  med as (
    select ref, percentile_cont(0.5) within group (order by q) med_pos, count(*) nb_pos
    from grid where q > 0 group by ref),
  mad as (
    select g.ref, percentile_cont(0.5) within group (order by abs(g.q - m.med_pos)) mad_pos
    from grid g join med m using (ref) where g.q > 0 group by g.ref),
  cap as (
    select m.ref, m.nb_pos, m.med_pos,
           case when m.nb_pos >= 4 then (m.med_pos + p_k * 1.4826 * greatest(a.mad_pos, 0.5))::numeric end plafond
    from med m join mad a using (ref))
  select g.ref,
         sum(g.q) q_per,
         count(*) filter (where g.q > 0) nb_sem,
         sum(g.qt) q_per_tot,
         count(*) filter (where g.qt > 0) nb_sem_tot,
         max(g.q) pic_sem,
         max(c.plafond) plafond,
         max(c.med_pos) med_pos,
         count(*) filter (where c.plafond is not null and g.q > c.plafond) nb_pics,
         avg(greatest(least(g.q, coalesce(c.plafond, g.q)), 0)) mu_sem,
         stddev_pop(greatest(least(g.q, coalesce(c.plafond, g.q)), 0)) sigma_sem,
         percentile_cont(0.9) within group (order by g.q) p90_sem
  from grid g left join cap c using (ref)
  group by g.ref;

  -- Série mensuelle 12 mois complets (classe XYZ, sur toutes les sorties)
  create temp table _sa_mois on commit drop as
  with mm as (select ref, date_trunc('month', s.d)::date mo, sum(q) q, sum(m) m, sum(mg) mg,
                     sum(q) filter (where q > 0) qb, sum(m) filter (where q > 0) mb   -- sorties brutes (hors retours / avoirs)
              from _sa_s s where s.d >= v_m0 and s.d < v_m1 group by 1, 2),
  refs as (select distinct ref from mm),
  grid as (select r.ref, g.mo::date mo, coalesce(mm.q, 0) q, coalesce(mm.m, 0) m, coalesce(mm.mg, 0) mg,
                  coalesce(mm.qb, 0) qb, coalesce(mm.mb, 0) mb
           from refs r cross join generate_series(v_m0, (v_m1 - interval '1 month')::date, interval '1 month') g(mo)
           left join mm on mm.ref = r.ref and mm.mo = g.mo::date)
  select ref, sum(q) q12, sum(m) ca12, sum(mg) marge12, sum(qb) q12_brut, sum(mb) ca12_brut,
         case when avg(qb) > 0 then stddev_pop(qb) / avg(qb) end cv
  from grid group by ref;

  -- Univers : vendu depuis le début de l'historique, ou en stock / réservé dans le dépôt
  create temp table _sa_ref on commit drop as
  with st as (
    select upper(trim(sto_art_num)) ref, sum(sto_qte) qte, sum(sto_prepa) prepa, sum(sto_dispo) dispo,
           sum(sto_res) res, sum(sto_cde) cde, sum(sto_aterme) aterme, sum(sto_montant) montant,
           max(sto_qtemini) sage_min, max(sto_qtemaxi) sage_max, max(sto_emplacement_pr_lib) emplacement
    from sage.stock_depot where sto_dep_num = d.depot_num and nullif(trim(sto_art_num), '') is not null group by 1),
  tr as (
    select upper(trim(sto_art_num)) ref, sum(sto_qte) qte
    from sage.stock_depot where d.depot_transit_num is not null and sto_dep_num = d.depot_transit_num group by 1),
  fms as (
    select upper(trim(sto_art_num)) ref, sum(sto_dispo) dispo, sum(sto_res) res
    from sage.stock_depot where sto_dep_num = '3' group by 1),
  tot as (
    select ref, sum(q) filter (where s.d >= p_depuis) q_depuis, sum(m) filter (where s.d >= p_depuis) ca_depuis,
           max(s.d) filter (where q > 0) derniere_sortie,
           count(distinct bl) filter (where s.d >= v_w0 and q > 0 and imm) nb_bl_per,
           count(distinct tiers) filter (where s.d >= v_w0 and q > 0 and imm) nb_clients_per,
           count(distinct bl) filter (where s.d >= v_w0 and q > 0) nb_bl_tot,
           count(distinct tiers) filter (where s.d >= v_w0 and q > 0) nb_clients_tot,
           count(distinct bc) filter (where s.d >= v_w0 and q > 0 and not imm) nb_cde_longues
    from _sa_s s group by ref),
  rec as (
    select upper(trim(ap.reference)) ref,
           max((l.delivery_date_actual at time zone 'Europe/Paris')::date) filter (where l.quantity_delivered > 0) derniere_reception,
           sum(l.quantity_to_deliver::numeric) filter (where l.quantity_to_deliver > 0) encours_cdf
    from blg.partner_base_partner p
    join blg.sale_quote sq on sq.delivery_fk = p.id and sq.type = 'purchase'
    join blg.sale_quote_line l on l.quote_fk = sq.id
    join blg.article_part ap on ap.id = l.article_fk
    where p.company_name = d.lieu_cdf and ap.reference is not null group by 1),
  cdc as (
    select upper(trim(reference_article)) ref,
           sum(quantite) filter (where date_livraison <= current_date + 7) cdc_7j,
           sum(quantite) cdc_total
    from activite_lignes where depot = d.libelle and type_document = 'Bon de commande'
      and nullif(trim(reference_article), '') is not null group by 1),
  u as (
    select ref from st where qte <> 0 or res <> 0
    union select ref from tot),
  art as (
    select upper(trim(ar_ref)) ref, ar_design, fa_codefamille, upper(coalesce(mystock, '')) = 'OUI' mystock,
           coalesce(ar_sommeil::text, '0') = '1' sommeil, coalesce(ar_interdirecommande::text, '0') = '1' blocage,
           coalesce(ar_exclure::text, '0') = '1' exclu, nullif(trim(vie_produit), '') vie_produit,
           sage.to_numeric_safe(ar_prixach::text) prix_achat
    from sage.article_bis),
  fia as (
    select distinct on (upper(trim(ar_ref))) upper(trim(ar_ref)) ref, ct_num,
           sage.to_numeric_safe(af_delaiappro::text) delai, sage.to_numeric_safe(af_prixach::text) prix
    from sage.fia where af_principal::text = '1' order by upper(trim(ar_ref)), ct_num)
  select u.ref,
         coalesce(a.ar_design, ra.designation) designation,
         coalesce(ra.famille, a.fa_codefamille) famille,
         rf.famille_macro,
         coalesce(fi.ct_num, ra.fournisseur_principal) fournisseur,
         coalesce(a.mystock, false) mystock,
         coalesce(a.sommeil, ra.mise_en_sommeil, false) sommeil,
         coalesce(a.blocage, false) blocage, coalesce(a.exclu, false) exclu, a.vie_produit,
         coalesce(st.qte, 0) qte, coalesce(st.prepa, 0) prepa, coalesce(st.dispo, 0) dispo, coalesce(st.res, 0) res,
         coalesce(st.cde, 0) cde, coalesce(st.aterme, 0) aterme, coalesce(st.montant, 0) montant,
         st.sage_min, st.sage_max, st.emplacement,
         coalesce(tr.qte, 0) transit, fms.dispo fms_dispo, fms.res fms_res,
         case when coalesce(st.qte, 0) > 0 and coalesce(st.montant, 0) > 0 then st.montant / st.qte
              else coalesce(nullif(fi.prix, 0), nullif(a.prix_achat, 0), nullif(ra.prix_achat, 0)) end pu,
         fi.delai delai_fia,
         coalesce(tot.q_depuis, 0) q_depuis, coalesce(tot.ca_depuis, 0) ca_depuis, tot.derniere_sortie,
         coalesce(tot.nb_bl_per, 0) nb_bl, coalesce(tot.nb_clients_per, 0) nb_clients,
         coalesce(tot.nb_bl_tot, 0) nb_bl_tot, coalesce(tot.nb_clients_tot, 0) nb_clients_tot,
         coalesce(tot.nb_cde_longues, 0) nb_cde_longues,
         coalesce(x.q_per, 0) q_per, coalesce(x.nb_sem, 0) nb_sem,
         coalesce(x.q_per_tot, 0) q_per_tot, coalesce(x.nb_sem_tot, 0) nb_sem_tot,
         coalesce(x.pic_sem, 0) pic_sem, x.plafond, x.med_pos,
         coalesce(x.nb_pics, 0) nb_pics, coalesce(x.mu_sem, 0) mu_sem, coalesce(x.sigma_sem, 0) sigma_sem, coalesce(x.p90_sem, 0) p90_sem,
         coalesce(mo.q12, 0) q12, coalesce(mo.ca12, 0) ca12, coalesce(mo.marge12, 0) marge12, mo.cv,
         coalesce(mo.q12_brut, 0) q12_brut, coalesce(mo.ca12_brut, 0) ca12_brut,
         rec.derniere_reception, coalesce(rec.encours_cdf, 0) encours_cdf,
         coalesce(cdc.cdc_7j, 0) cdc_7j, coalesce(cdc.cdc_total, 0) cdc_total,
         ch.decision_forcee, ch.min_retenu, ch.max_retenu, ch.commentaire, ch.maj_par, ch.maj_le,
         k.part_id blg_id
  from u
  left join v_appro_article_blg_cles k on k.cle = u.ref
  left join st on st.ref = u.ref
  left join tr on tr.ref = u.ref
  left join fms on fms.ref = u.ref
  left join tot on tot.ref = u.ref
  left join _sa_st x on x.ref = u.ref
  left join _sa_mois mo on mo.ref = u.ref
  left join rec on rec.ref = u.ref
  left join cdc on cdc.ref = u.ref
  left join art a on a.ref = u.ref
  left join ref_articles ra on upper(trim(ra.reference_article)) = u.ref
  left join ref_familles rf on rf.famille = coalesce(ra.famille, a.fa_codefamille)
  left join fia fi on fi.ref = u.ref
  left join stock_agence_article_choix ch on ch.depot_num = d.depot_num and upper(trim(ch.reference_article)) = u.ref;

  -- Classes, décision, MIN / MAX, valorisations
  with cl as (
    select r.*,
           sum(greatest(ca12_brut, 0)) over (order by greatest(ca12_brut, 0) desc, ref rows between unbounded preceding and current row) - greatest(ca12_brut, 0) cum_avant,
           sum(greatest(ca12_brut, 0)) over () ca_total
    from _sa_ref r),
  p as (
    select c.*,
           case when q12_brut <= 0 then 'N' when ca12_brut > 0 and cum_avant < 0.80 * ca_total then 'A'
                when ca12_brut > 0 and cum_avant < 0.95 * ca_total then 'B' else 'C' end abc,
           case when q12_brut <= 0 or cv is null then 'N' when cv <= 0.5 then 'X' when cv <= 1.0 then 'Y' else 'Z' end xyz,
           case when mystock and not d.central then p_l_my else coalesce(nullif(delai_fia, 0), p_l_hm) end l_jours,
           case when mystock and not d.central then p_c_my else p_c_hm end r_jours,
           (sommeil or blocage or exclu or coalesce(vie_produit, '') ilike 'fin%vie%') hors_appro,
           -- 22/11/2026 : décision sur les semaines de ventes IMMÉDIATES
           case when nb_sem >= p_st then 'STOCKER' when nb_sem >= p_su then 'SURVEILLER' else 'NE_PAS_STOCKER' end decision_calc
    from cl c),
  q as (
    select p.*,
           case when hors_appro then 'NE_PAS_STOCKER' else coalesce(decision_forcee, decision_calc) end decision_eff,
           ceil(mu_sem * l_jours / 7.0 + p_z * sigma_sem * sqrt(l_jours / 7.0) - 1e-9) min_calc,
           ceil(mu_sem * r_jours / 7.0 - 1e-9) cycle_calc
    from p),
  f0 as (
    select q.*, case when decision_eff = 'STOCKER' then coalesce(min_retenu, greatest(min_calc, 1)) else 0 end smin
    from q),
  f as (
    select f0.*,
           case when decision_eff = 'STOCKER' then greatest(coalesce(max_retenu, smin + greatest(cycle_calc, 1)), smin) else 0 end smax
    from f0),
  -- 22/11/2026 : f = PROPOSITION (calcul du jour + saisies manuelles) ; h = valeurs EFFECTIVES,
  -- c.-à-d. les MIN / MAX figés du dépôt quand ils existent (sinon la proposition)
  h as (
    select f.*,
           f.decision_eff prop_decision, f.smin prop_min, f.smax prop_max,
           (fe.depot_num is not null) a_fige, fz.reference_article is not null fz_present,
           fz.decision fz_decision, fz.smin fz_min, fz.smax fz_max
    from f
    left join stock_agence_minmax_fige_entete fe on fe.depot_num = d.depot_num
    left join stock_agence_minmax_fige fz on fz.depot_num = d.depot_num and fz.reference_article = f.ref),
  h2 as (
    select h.ref, h.designation, h.famille, h.famille_macro, h.fournisseur, h.mystock, h.sommeil, h.blocage, h.exclu, h.vie_produit,
           h.qte, h.prepa, h.dispo, h.res, h.cde, h.aterme, h.montant, h.sage_min, h.sage_max, h.emplacement, h.transit,
           h.fms_dispo, h.fms_res, h.pu, h.q_depuis, h.ca_depuis, h.derniere_sortie, h.nb_bl, h.nb_clients, h.nb_bl_tot,
           h.nb_clients_tot, h.nb_cde_longues, h.q_per, h.nb_sem, h.q_per_tot, h.nb_sem_tot, h.pic_sem, h.plafond,
           h.nb_pics, h.mu_sem, h.sigma_sem, h.p90_sem, h.q12, h.ca12, h.marge12, h.cv, h.q12_brut, h.ca12_brut,
           h.derniere_reception, h.encours_cdf, h.cdc_7j, h.cdc_total, h.decision_forcee, h.min_retenu, h.max_retenu,
           h.commentaire, h.maj_par, h.maj_le, h.blg_id, h.abc, h.xyz, h.l_jours, h.r_jours, h.hors_appro, h.decision_calc,
           h.min_calc, h.cycle_calc, h.prop_decision, h.prop_min, h.prop_max, h.a_fige, h.fz_present,
           case when h.hors_appro then 'NE_PAS_STOCKER'
                when h.a_fige then coalesce(h.fz_decision, 'NE_PAS_STOCKER') else h.decision_eff end decision_eff,
           case when h.hors_appro then 0 when h.a_fige then coalesce(h.fz_min, 0) else h.smin end smin,
           case when h.hors_appro then 0 when h.a_fige then coalesce(h.fz_max, 0) else h.smax end smax
    from h),
  g as (
    select f.*,
           greatest(qte - greatest(res, 0), 0) libre,
           case when mu_sem > 0 then dispo / mu_sem end couv_sem,
           case when decision_eff = 'STOCKER' and smin > 0 then
             (select count(*) from _sa_sem s where s.ref = f.ref and s.q > f.smin) end nb_sem_sup_min
    from h2 f)
  select coalesce(jsonb_agg(jsonb_build_object(
      'ref', ref, 'designation', designation, 'famille', famille, 'famille_macro', famille_macro,
      'fournisseur', fournisseur, 'mystock', mystock, 'sommeil', sommeil, 'blocage', blocage, 'exclu', exclu, 'vie_produit', vie_produit,
      'qte', qte, 'prepa', prepa, 'dispo', dispo, 'res', res, 'cde', cde, 'aterme', aterme, 'transit', transit,
      'valeur', round(case when montant > 0 then montant else greatest(qte, 0) * coalesce(pu, 0) end, 2),
      'pu', round(pu::numeric, 4), 'sage_min', sage_min, 'sage_max', sage_max, 'emplacement', emplacement,
      'fms_dispo', fms_dispo, 'fms_res', fms_res
    ) || jsonb_build_object(
      'q_depuis', q_depuis, 'ca_depuis', round(ca_depuis, 2), 'q12', q12, 'ca12', round(ca12, 2), 'marge12', round(marge12, 2),
      'q12_brut', q12_brut, 'ca12_brut', round(ca12_brut, 2),
      'q_per', q_per, 'nb_sem', nb_sem, 'nb_bl', nb_bl, 'nb_clients', nb_clients,
      'q_per_tot', q_per_tot, 'nb_sem_tot', nb_sem_tot, 'nb_bl_tot', nb_bl_tot, 'nb_clients_tot', nb_clients_tot,
      'q_per_cde', q_per_tot - q_per, 'nb_cde_longues', nb_cde_longues,
      'mu_sem', round(mu_sem::numeric, 3), 'sigma_sem', round(sigma_sem::numeric, 3), 'pic_sem', pic_sem, 'p90_sem', round(p90_sem::numeric, 2),
      'plafond_pic', round(plafond::numeric, 2), 'nb_pics', nb_pics, 'cv', round(cv::numeric, 3),
      'derniere_sortie', derniere_sortie, 'derniere_reception', derniere_reception,
      'dernier_mvt', greatest(derniere_sortie, derniere_reception),
      'encours_cdf', encours_cdf, 'cdc_7j', cdc_7j, 'cdc_total', cdc_total
    ) || jsonb_build_object(
      'abc', abc, 'xyz', xyz, 'l_jours', l_jours, 'r_jours', r_jours,
      'decision_calc', case when hors_appro then 'NE_PAS_STOCKER' else decision_calc end,
      'hors_appro', hors_appro,
      'decision', case when decision_eff = 'NE_PAS_STOCKER' and qte > 0 then 'NE_PLUS_STOCKER' else decision_eff end,
      'min_calc', case when prop_decision = 'STOCKER' then greatest(min_calc, 1) else 0 end,
      'max_calc', case when prop_decision = 'STOCKER' then greatest(min_calc, 1) + greatest(cycle_calc, 1) else 0 end,
      'smin', smin, 'smax', smax, 'couv_sem', round(couv_sem::numeric, 2), 'nb_sem_sup_min', nb_sem_sup_min,
      'statut', case
          when decision_eff = 'STOCKER' and dispo <= 0 then 'A_STOCKER_SANS_STOCK'
          when decision_eff = 'STOCKER' and dispo < smin then 'SOUS_MIN'
          when decision_eff = 'STOCKER' and libre > smax then 'SUR_STOCK'
          when decision_eff = 'STOCKER' then 'OK'
          when decision_eff = 'SURVEILLER' then 'SURVEILLER'
          when qte > 0 then 'A_DESTOCKER'
          else 'HORS_STOCK' end,
      'excedent_qte', case when decision_eff = 'STOCKER' then greatest(libre - smax, 0)
                           when decision_eff = 'NE_PAS_STOCKER' then libre else 0 end,
      'excedent_valeur', round(coalesce(pu, 0) * case when decision_eff = 'STOCKER' then greatest(libre - smax, 0)
                                                      when decision_eff = 'NE_PAS_STOCKER' then libre else 0 end, 2),
      'manque_qte', case when decision_eff = 'STOCKER' and aterme + transit < smin then smax - greatest(aterme + transit, 0) else 0 end,
      'manque_valeur', round(coalesce(pu, 0) * case when decision_eff = 'STOCKER' and aterme + transit < smin then smax - greatest(aterme + transit, 0) else 0 end, 2),
      'decision_forcee', decision_forcee, 'min_retenu', min_retenu, 'max_retenu', max_retenu,
      'commentaire', commentaire, 'maj_par', maj_par, 'maj_le', maj_le
    ) || jsonb_build_object(
      'blg_id', blg_id,
      'fige', a_fige and fz_present,
      'prop_decision', prop_decision, 'prop_min', prop_min, 'prop_max', prop_max,
      'ecart_fige', a_fige and (prop_decision is distinct from decision_eff or prop_min <> smin or prop_max <> smax)
    ) order by ca12 desc nulls last, ref), '[]'::jsonb)
  into v_rows from g;

  return jsonb_build_object(
    'meta', jsonb_build_object(
      'depot_num', d.depot_num, 'depot', d.libelle, 'nom', d.nom_court, 'central', d.central,
      'depuis', p_depuis, 'semaines_debut', v_w0, 'semaines_fin', v_w1 - 1, 'nb_semaines', v_nsem,
      'mois_debut', v_m0, 'mois_fin', (v_m1 - 1),
      'calcule_le', now(),
      'stock_charge_le', (select max(loaded_at) from sage.stock_depot where sto_dep_num = d.depot_num),
      'blg_warehouse_id', d.blg_warehouse_id,
      'fige', (select to_jsonb(fe) from stock_agence_minmax_fige_entete fe where fe.depot_num = d.depot_num)),
    'parametres', jsonb_build_object(
      'delai_mystock_jours', p_l_my, 'cycle_mystock_jours', p_c_my, 'delai_hors_mystock_defaut_jours', p_l_hm,
      'cycle_hors_mystock_jours', p_c_hm, 'niveau_service_z', p_z, 'seuil_semaines_stocker', p_st,
      'seuil_semaines_surveiller', p_su, 'pic_mad_k', p_k, 'delai_vente_immediate_jours', p_di),
    'rows', v_rows);
end $function$;

-- -----------------------------------------------------------------------------
-- Fenêtre article : semaines / mois / clients / lignes avec la part immédiate
-- -----------------------------------------------------------------------------
create or replace function public.get_stock_agence_article(p_depot_num text, p_ref text, p_depuis date default '2025-01-01'::date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'sage'
set statement_timeout to '60s'
set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  d      public.stock_agence_depots%rowtype;
  v_ref  text := upper(trim(p_ref));
  v_w1   date := date_trunc('week', current_date)::date;
  v_nsem int;
  v_di   int;
  v_w0   date;
  v_deb  date;
begin
  if public.stock_agence_depots_user() is not null and not (p_depot_num = any(public.stock_agence_depots_user())) then
    raise exception 'Dépôt non autorisé : l''analyse est limitée au dépôt de votre agence' using errcode = '42501';
  end if;
  select * into d from stock_agence_depots where depot_num = p_depot_num;
  if not found then raise exception 'Dépôt % inconnu', p_depot_num; end if;
  select coalesce(max(valeur) filter (where cle = 'periode_semaines'), 52)::int,
         coalesce(max(valeur) filter (where cle = 'delai_vente_immediate_jours'), 10)::int
    into v_nsem, v_di from stock_agence_parametres;
  v_w0 := v_w1 - v_nsem * 7;
  v_deb := least(p_depuis, v_w0);

  return (
    with s as (
      select * from stock_agence_sorties(d.libelle, v_deb, v_di) x where x.ref = v_ref),
    noms as (select ct_num, max(ct_intitule) nom from sage.tiers_complet group by 1)
    select jsonb_build_object(
      'delai_vente_immediate_jours', v_di,
      'mois', (
        select coalesce(jsonb_agg(jsonb_build_object('mois', g.mo::date, 'qte', coalesce(m.q, 0), 'qte_imm', coalesce(m.qi, 0),
                                                     'ca', round(coalesce(m.m, 0), 2),
                                                     'nb_bl', coalesce(m.nb_bl, 0), 'nb_clients', coalesce(m.nb_cl, 0)) order by g.mo), '[]'::jsonb)
        from generate_series(date_trunc('month', p_depuis)::date, date_trunc('month', current_date)::date, interval '1 month') g(mo)
        left join (select date_trunc('month', s.d)::date mo, sum(q) q, coalesce(sum(q) filter (where imm), 0) qi, sum(m) m,
                          count(distinct bl) filter (where q > 0) nb_bl, count(distinct tiers) filter (where q > 0) nb_cl
                   from s where s.d >= p_depuis group by 1) m on m.mo = g.mo::date),
      'semaines', (
        select coalesce(jsonb_agg(jsonb_build_object('semaine', g.w::date, 'qte', coalesce(w.q, 0), 'qte_imm', coalesce(w.qi, 0),
                                                     'nb_bl', coalesce(w.nb_bl, 0)) order by g.w), '[]'::jsonb)
        from generate_series(v_w0, v_w1, interval '7 days') g(w)
        left join (select date_trunc('week', s.d)::date w, sum(q) q, coalesce(sum(q) filter (where imm), 0) qi,
                          count(distinct bl) filter (where q > 0) nb_bl
                   from s group by 1) w on w.w = g.w::date),
      'clients', (
        select coalesce(jsonb_agg(to_jsonb(c) order by c.qte desc), '[]'::jsonb) from (
          select s.tiers numero_tiers, max(n.nom) intitule, sum(q) qte, coalesce(sum(q) filter (where imm), 0) qte_imm,
                 round(sum(m), 2) ca, count(distinct bl) filter (where q > 0) nb_bl, max(s.d) derniere
          from s left join noms n on n.ct_num = s.tiers
          where s.d >= v_w0 group by s.tiers order by sum(q) desc limit 15) c),
      'lignes', (
        select coalesce(jsonb_agg(to_jsonb(l) order by l.d desc, l.bl), '[]'::jsonb) from (
          select s.d, s.bl, s.tiers numero_tiers, n.nom intitule, s.q qte, round(s.m, 2) ca,
                 s.bc, s.d_bc date_bc, case when s.d_bc is not null then s.d - s.d_bc end delai_cde, s.imm
          from s left join noms n on n.ct_num = s.tiers order by s.d desc limit 60) l),
      'cdc', (
        select coalesce(jsonb_agg(to_jsonb(c) order by c.date_livraison nulls last), '[]'::jsonb) from (
          select a.numero_piece, a.type_document, a.date_piece, a.date_livraison, a.numero_tiers_entete numero_tiers, a.intitule_tiers_entete intitule,
                 a.quantite qte, e.expedition, a.collaborateur
          from activite_lignes a left join activite_entete e on e.numero_piece = a.numero_piece
          where a.depot = d.libelle and a.type_document in ('Bon de commande', 'Préparation de livraison')
            and upper(trim(a.reference_article)) = v_ref limit 100) c),
      'cdf', (
        select coalesce(jsonb_agg(to_jsonb(c) order by c.cdf_order_date desc, c.cdf_reference desc), '[]'::jsonb) from (
          select sq.reference cdf_reference, sq.order_date cdf_order_date,
                 'https://app.blgcloud.com/dakar-11/?app/purchase/order/edit/' || sq.document_id || '#' cdf_lien_blg,
                 f.nom_fournisseur, l.quantity quantite_commandee, l.quantity_delivered quantite_livree,
                 l.quantity_to_deliver quantite_ral, l.delivery_date_required date_livraison_demandee, l.delivery_date_actual date_livraison
          from blg.partner_base_partner p
          join blg.sale_quote sq on sq.delivery_fk = p.id and sq.type = 'purchase'
          join blg.sale_quote_line l on l.quote_fk = sq.id
          join blg.article_part ap on ap.id = l.article_fk
          left join lateral (select vf.nom_fournisseur from v_appro_fournisseurs vf where vf.supplier_id = sq.supplier_fk limit 1) f on true
          where p.company_name = d.lieu_cdf and upper(trim(ap.reference)) = v_ref
          order by sq.order_date desc, sq.reference desc limit 20) c),
      'stocks', (
        select coalesce(jsonb_agg(to_jsonb(x) order by x.ordre nulls last, x.depot), '[]'::jsonb) from (
          select sd.sto_dep_num depot_num, trim(max(sd.sto_dep)) depot, max(sad.ordre) ordre,
                 sum(sd.sto_qte) qte, sum(sd.sto_prepa) prepa, sum(sd.sto_dispo) dispo, sum(sd.sto_res) res,
                 sum(sd.sto_cde) cde, sum(sd.sto_aterme) aterme, max(sd.sto_qtemini) sage_min, max(sd.sto_qtemaxi) sage_max
          from sage.stock_depot sd left join stock_agence_depots sad on sad.depot_num = sd.sto_dep_num
          where upper(trim(sd.sto_art_num)) = v_ref
          group by sd.sto_dep_num
          having sum(abs(sd.sto_qte)) + sum(abs(sd.sto_res)) + sum(abs(sd.sto_cde)) > 0) x)
    ));
end $function$;

-- -----------------------------------------------------------------------------
-- Figer (ou mettre à jour) les MIN / MAX d'un dépôt.
--   p_ref NULL  → recalcule et fige tout le dépôt (remplace le jeu précédent)
--   p_ref donné → refige la seule référence (après une saisie manuelle), si le dépôt est déjà figé
-- -----------------------------------------------------------------------------
create or replace function public.stock_agence_figer_minmax(p_depot_num text, p_ref text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'sage'
set statement_timeout to '180s'
as $function$
declare
  v       jsonb;
  v_ref   text := nullif(upper(trim(p_ref)), '');
  v_email text := coalesce(auth.jwt() ->> 'email', current_user);
begin
  if v_ref is not null and not exists (select 1 from stock_agence_minmax_fige_entete where depot_num = p_depot_num) then
    return jsonb_build_object('fige', false);
  end if;

  -- contrôle du dépôt autorisé + calcul de la proposition
  v := public.get_stock_agence_analyse(p_depot_num, '2025-01-01'::date);

  if v_ref is null then
    delete from stock_agence_minmax_fige where depot_num = p_depot_num;
  else
    delete from stock_agence_minmax_fige where depot_num = p_depot_num and reference_article = v_ref;
  end if;

  insert into stock_agence_minmax_fige (depot_num, reference_article, decision, smin, smax, min_calc, max_calc, nb_sem, mu_sem, manuel, fige_le, fige_par)
  select p_depot_num, r ->> 'ref',
         case when (r ->> 'hors_appro')::boolean then 'NE_PAS_STOCKER' else r ->> 'prop_decision' end,
         case when (r ->> 'hors_appro')::boolean then 0 else coalesce((r ->> 'prop_min')::numeric, 0) end,
         case when (r ->> 'hors_appro')::boolean then 0 else coalesce((r ->> 'prop_max')::numeric, 0) end,
         (r ->> 'min_calc')::numeric, (r ->> 'max_calc')::numeric, (r ->> 'nb_sem')::int, (r ->> 'mu_sem')::numeric,
         (r ->> 'decision_forcee') is not null or (r ->> 'min_retenu') is not null or (r ->> 'max_retenu') is not null,
         now(), v_email
  from jsonb_array_elements(v -> 'rows') r
  where v_ref is null or r ->> 'ref' = v_ref;

  if v_ref is null then
    insert into stock_agence_minmax_fige_entete (depot_num, fige_le, fige_par, maj_le, maj_par, nb_refs, nb_stocker)
    select p_depot_num, now(), v_email, null, null, count(*), count(*) filter (where decision = 'STOCKER')
    from stock_agence_minmax_fige where depot_num = p_depot_num
    on conflict (depot_num) do update set fige_le = excluded.fige_le, fige_par = excluded.fige_par, maj_le = null, maj_par = null,
                                          nb_refs = excluded.nb_refs, nb_stocker = excluded.nb_stocker;
  else
    update stock_agence_minmax_fige_entete e
       set maj_le = now(), maj_par = v_email,
           nb_refs = (select count(*) from stock_agence_minmax_fige where depot_num = p_depot_num),
           nb_stocker = (select count(*) from stock_agence_minmax_fige where depot_num = p_depot_num and decision = 'STOCKER')
     where e.depot_num = p_depot_num;
  end if;

  return (select to_jsonb(e) || jsonb_build_object('fige', true) from stock_agence_minmax_fige_entete e where e.depot_num = p_depot_num);
end $function$;

-- -----------------------------------------------------------------------------
-- Fichier MIN / MAX pour BLG (et rappel SAGE) à partir des valeurs FIGÉES.
-- Lignes : références figées « à stocker » + références portant aujourd'hui un MIN ou un MAX
-- dans l'entrepôt BLG ou le dépôt SAGE (celles qui sortent du stock passent à 0 / 0).
-- -----------------------------------------------------------------------------
create or replace function public.get_stock_agence_minmax_export(p_depot_num text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'sage'
set statement_timeout to '60s'
as $function$
declare
  d  public.stock_agence_depots%rowtype;
  fe public.stock_agence_minmax_fige_entete%rowtype;
  w  blg.article_warehouse%rowtype;
  v_rows jsonb;
begin
  if public.stock_agence_depots_user() is not null and not (p_depot_num = any(public.stock_agence_depots_user())) then
    raise exception 'Dépôt non autorisé : l''analyse est limitée au dépôt de votre agence' using errcode = '42501';
  end if;
  select * into d from stock_agence_depots where depot_num = p_depot_num;
  if not found then raise exception 'Dépôt % inconnu', p_depot_num; end if;
  select * into fe from stock_agence_minmax_fige_entete where depot_num = p_depot_num;
  if not found then raise exception 'Les MIN / MAX du dépôt % ne sont pas encore figés : utilisez « Figer les MIN/MAX » avant d''extraire.', d.nom_court; end if;
  select * into w from blg.article_warehouse where id = d.blg_warehouse_id;

  with fz as (
    select reference_article ref, decision, smin, smax, manuel from stock_agence_minmax_fige where depot_num = p_depot_num),
  blg as (
    select ap.id part_id, s.id stock_id,
           s.quantity_min, s.quantity_max
    from blg.article_part_stock s join blg.article_part ap on ap.id = s.part_fk
    where s.warehouse_fk = d.blg_warehouse_id),
  sg as (
    select upper(trim(sto_art_num)) ref, max(sto_qtemini) sage_min, max(sto_qtemaxi) sage_max, sum(sto_qte) qte
    from sage.stock_depot where sto_dep_num = p_depot_num and nullif(trim(sto_art_num), '') is not null group by 1),
  u as (
    select ref from fz where decision = 'STOCKER' and (smin > 0 or smax > 0)
    union
    select k.cle from blg b join v_appro_article_blg_cles k on k.part_id = b.part_id
     where coalesce(b.quantity_min, 0) > 0 or coalesce(b.quantity_max, 0) > 0
    union
    select ref from sg where coalesce(sage_min, 0) > 0 or coalesce(sage_max, 0) > 0),
  x as (
    select u.ref, coalesce(a.ar_design, ap.label) designation, k.part_id blg_id, ap.reference blg_reference, ap.internal_reference blg_internal_reference,
           b.stock_id blg_stock_id, b.quantity_min blg_min, b.quantity_max blg_max,
           sg.sage_min, sg.sage_max, coalesce(sg.qte, 0) stock_sage,
           coalesce(fz.decision, 'NE_PAS_STOCKER') decision, coalesce(fz.manuel, false) manuel,
           case when fz.decision = 'STOCKER' then fz.smin else 0 end new_min,
           case when fz.decision = 'STOCKER' then fz.smax else 0 end new_max
    from u
    left join fz on fz.ref = u.ref
    left join v_appro_article_blg_cles k on k.cle = u.ref
    left join blg.article_part ap on ap.id = k.part_id
    left join blg b on b.part_id = k.part_id
    left join sg on sg.ref = u.ref
    left join (select distinct on (upper(trim(ar_ref))) upper(trim(ar_ref)) ref, ar_design from sage.article_bis order by upper(trim(ar_ref))) a on a.ref = u.ref)
  select coalesce(jsonb_agg(jsonb_build_object(
           'ref', ref, 'designation', designation, 'blg_id', blg_id, 'blg_reference', blg_reference,
           'blg_internal_reference', blg_internal_reference, 'blg_stock_id', blg_stock_id,
           'blg_min', blg_min, 'blg_max', blg_max, 'sage_min', sage_min, 'sage_max', sage_max, 'stock_sage', stock_sage,
           'decision', decision, 'manuel', manuel, 'new_min', new_min, 'new_max', new_max,
           'action_blg', case when blg_id is null then 'Article absent de BLG'
                              when new_min = 0 and new_max = 0 and (coalesce(blg_min, 0) > 0 or coalesce(blg_max, 0) > 0) then 'Mettre à 0'
                              when (coalesce(blg_min, 0) = 0 and coalesce(blg_max, 0) = 0) and (new_min > 0 or new_max > 0) then 'Nouveau'
                              when coalesce(blg_min, 0) = new_min and coalesce(blg_max, 0) = new_max then 'Inchangé'
                              else 'Modifier' end,
           'action_sage', case when new_min = 0 and new_max = 0 and (coalesce(sage_min, 0) > 0 or coalesce(sage_max, 0) > 0) then 'Mettre à 0'
                               when (coalesce(sage_min, 0) = 0 and coalesce(sage_max, 0) = 0) and (new_min > 0 or new_max > 0) then 'Nouveau'
                               when coalesce(sage_min, 0) = new_min and coalesce(sage_max, 0) = new_max then 'Inchangé'
                               else 'Modifier' end
         ) order by (new_min = 0 and new_max = 0), ref), '[]'::jsonb)
    into v_rows from x;

  return jsonb_build_object(
    'meta', jsonb_build_object('depot_num', d.depot_num, 'depot', d.libelle, 'nom', d.nom_court,
                               'blg_warehouse_id', w.id, 'blg_warehouse_code', w.code, 'blg_warehouse_title', w.title,
                               'fige_le', fe.fige_le, 'fige_par', fe.fige_par, 'maj_le', fe.maj_le, 'maj_par', fe.maj_par,
                               'extrait_le', now()),
    'rows', v_rows);
end $function$;

grant execute on function public.stock_agence_figer_minmax(text, text) to authenticated;
grant execute on function public.get_stock_agence_minmax_export(text) to authenticated;
grant execute on function public.get_stock_agence_analyse(text, date) to authenticated;
grant execute on function public.get_stock_agence_article(text, text, date) to authenticated;
