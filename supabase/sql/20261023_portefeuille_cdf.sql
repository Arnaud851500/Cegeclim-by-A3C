-- ============================================================================
-- 20261023_portefeuille_cdf.sql
-- Écran « Portefeuille commandes fournisseurs » (/stock/portefeuille-cdf)
-- ----------------------------------------------------------------------------
-- Pilotage des CDF SAGE ouvertes (sage.bdcf, type 12) : routines d'alerte,
-- de relance et de nettoyage, suivi des containers « CONT » Hitachi.
--
-- Règles (fixées avec Arnaud le 23/10/2026) :
--  - commande container = référence SAGE (DO_Ref) commençant par « CONT » ;
--    a priori un container par CDF ;
--  - n° de container saisi dans SAGE en ligne de commentaire de la CDF,
--    contrôlé par le chiffre de contrôle ISO 6346 ;
--  - AR = statut du document SAGE (« AR OK ») ;
--  - suivi bateau (armateur, navire, port, ETA) saisi à la main dans l'app
--    après consultation du site gratuit de l'armateur (pas d'API payante) ;
--  - marge = date de livraison de la CDF − ETA port → verdict
--    (en retard / intenable / très juste / juste / OK, seuils paramétrables).
--
-- Sources SAGE complémentaires (à alimenter par l'export TSE, voir
-- 20261023_export_sage_cdf_complements.sql) :
--  - sage.cdf_statut         : statut (DO_Statut) de chaque CDF ;
--  - sage.bdcf_commentaires  : lignes de commentaire des CDF.
-- Tant qu'elles sont vides, l'écran fonctionne : le n° de container peut être
-- saisi dans l'app et l'alerte « sans AR » est simplement inactive.
-- ============================================================================

-- ─── 1. Sources SAGE complémentaires ────────────────────────────────────────
create table if not exists sage.cdf_statut (
  do_piece   text primary key,
  ct_num     text,
  do_statut  smallint,
  loaded_at  timestamptz not null default now()
);
alter table sage.cdf_statut enable row level security;

create table if not exists sage.bdcf_commentaires (
  do_piece   text not null,
  dl_ligne   integer not null,
  ct_num     text,
  dl_design  text,
  loaded_at  timestamptz not null default now(),
  primary key (do_piece, dl_ligne)
);
alter table sage.bdcf_commentaires enable row level security;

-- Libellés des statuts SAGE des bons de commande achat (DO_Statut 0/1/2…).
-- À compléter après le premier export : le code de CDF032795 = « AR OK ».
create table if not exists public.appro_cdf_statuts (
  code      smallint primary key,
  libelle   text not null,
  ar_recu   boolean not null default false
);
alter table public.appro_cdf_statuts enable row level security;
drop policy if exists appro_cdf_statuts_select on public.appro_cdf_statuts;
create policy appro_cdf_statuts_select on public.appro_cdf_statuts for select to authenticated using (true);
grant select on public.appro_cdf_statuts to authenticated;

-- ─── 2. Armateurs : lien de suivi gratuit, préfixes propriétaires ───────────
-- url_suivi : {container} est remplacé par le n° s'il est présent ; sinon la
-- page s'ouvre et le n° est copié dans le presse-papiers (à coller).
-- Les préfixes de loueurs (TLLU, TXGU, TCNU, TGHU, SEGU…) ne désignent pas
-- l'armateur : il faut alors le choisir dans le relevé.
create table if not exists public.appro_armateurs (
  code       text primary key,
  nom        text not null,
  url_suivi  text not null,
  prefixes   text[] not null default '{}',
  ordre      integer not null default 100
);
alter table public.appro_armateurs enable row level security;
drop policy if exists appro_armateurs_select on public.appro_armateurs;
create policy appro_armateurs_select on public.appro_armateurs for select to authenticated using (true);
grant select on public.appro_armateurs to authenticated;

insert into public.appro_armateurs (code, nom, url_suivi, prefixes, ordre) values
  ('MSC',       'MSC',            'https://www.msc.com/en/track-a-shipment',                                    array['MSCU','MEDU','MSDU','MSMU','MSNU','MSGU','MSBU'], 10),
  ('CMA',       'CMA CGM',        'https://www.cma-cgm.com/ebusiness/tracking',                                 array['CMAU','CGMU','ECMU'], 20),
  ('MAERSK',    'Maersk',         'https://www.maersk.com/tracking/{container}',                                array['MAEU','MSKU','MRKU','MRSU'], 30),
  ('HAPAG',     'Hapag-Lloyd',    'https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html', array['HLXU','HLBU','HAMU'], 40),
  ('ONE',       'ONE',            'https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking',         array['ONEU','NYKU','MOLU','KKFU'], 50),
  ('EVERGREEN', 'Evergreen',      'https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do',                  array['EGHU','EGSU','EMCU','EITU'], 60),
  ('COSCO',     'COSCO / OOCL',   'https://elines.coscoshipping.com/ebusiness/cargoTracking',                   array['CSNU','CBHU','CCLU','OOLU'], 70),
  ('AUTRE',     'Autre (track-trace)', 'https://www.track-trace.com/container',                                 '{}', 999)
on conflict (code) do nothing;

-- ─── 3. Relevés de suivi container (saisie manuelle, historisée) ────────────
create table if not exists public.appro_container_releves (
  id               bigserial primary key,
  cdf_numero       text not null,
  container_numero text,
  armateur         text references public.appro_armateurs(code),
  navire           text,
  port_arrivee     text,
  eta_port         date,
  statut           text check (statut in ('booke','embarque','en_mer','arrive','decharge','livre')),
  commentaire      text,
  created_at       timestamptz not null default now(),
  created_by       text default (auth.jwt() ->> 'email')
);
create index if not exists idx_appro_container_releves_cdf on public.appro_container_releves (cdf_numero, created_at desc);
alter table public.appro_container_releves enable row level security;
drop policy if exists appro_container_releves_select on public.appro_container_releves;
create policy appro_container_releves_select on public.appro_container_releves for select to authenticated using (true);
drop policy if exists appro_container_releves_insert on public.appro_container_releves;
create policy appro_container_releves_insert on public.appro_container_releves for insert to authenticated with check (true);
grant select, insert on public.appro_container_releves to authenticated;
grant usage, select on sequence public.appro_container_releves_id_seq to authenticated;

-- ─── 4. Traitement des alertes (relance / confirmé / commentaire) ───────────
-- « confirme » masque l'alerte tant que la date de livraison de la CDF ne
-- change pas, et au plus cdf_confirmation_validite_jours jours.
create table if not exists public.appro_cdf_actions (
  id                 bigserial primary key,
  cdf_numero         text not null,
  alerte_code        text,
  action             text not null check (action in ('relance','confirme','commentaire')),
  commentaire        text,
  date_livraison_ref date,
  created_at         timestamptz not null default now(),
  created_by         text default (auth.jwt() ->> 'email')
);
create index if not exists idx_appro_cdf_actions_cdf on public.appro_cdf_actions (cdf_numero, created_at desc);
alter table public.appro_cdf_actions enable row level security;
drop policy if exists appro_cdf_actions_select on public.appro_cdf_actions;
create policy appro_cdf_actions_select on public.appro_cdf_actions for select to authenticated using (true);
drop policy if exists appro_cdf_actions_insert on public.appro_cdf_actions;
create policy appro_cdf_actions_insert on public.appro_cdf_actions for insert to authenticated with check (true);
grant select, insert on public.appro_cdf_actions to authenticated;
grant usage, select on sequence public.appro_cdf_actions_id_seq to authenticated;

-- ─── 5. Paramètres ──────────────────────────────────────────────────────────
insert into public.appro_parametres (cle, valeur, description) values
  ('cdf_cont_alerte_jours_avant',      70, 'Portefeuille CDF : contrôle container/booking à partir de N jours avant la livraison estimée d''une CDF CONT (9 à 10 semaines)'),
  ('cdf_cont_releve_max_jours',         7, 'Portefeuille CDF : un suivi bateau plus ancien que N jours (bateau pas encore arrivé) est à rafraîchir'),
  ('cdf_cont_marge_intenable',          2, 'Portefeuille CDF : marge (date livraison CDF − ETA port) ≤ N jours = intenable'),
  ('cdf_cont_marge_tres_juste',         4, 'Portefeuille CDF : marge ≤ N jours = très juste'),
  ('cdf_cont_marge_juste',              7, 'Portefeuille CDF : marge ≤ N jours = juste (au-delà = OK)'),
  ('cdf_sans_ar_jours',                 7, 'Portefeuille CDF : CDF à destination de FMS sans statut AR OK après N jours de création'),
  ('cdf_relance_cdc_horizon_jours',    21, 'Portefeuille CDF : relancer le fournisseur quand une CDF attendue par des CDC est due sous N jours'),
  ('cdf_confirmation_validite_jours',  14, 'Portefeuille CDF : durée de validité d''une confirmation fournisseur (masque l''alerte)')
on conflict (cle) do nothing;

-- ─── 6. Contrôle ISO 6346 du n° de container ────────────────────────────────
create or replace function public.appro_container_normaliser(p text)
returns text language sql immutable as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[\s\-./]', '', 'g')), '')
$$;

create or replace function public.appro_container_valide(p text)
returns boolean language plpgsql immutable as $$
declare
  s text := public.appro_container_normaliser(p);
  total integer := 0;
  i integer; c text; n integer; v integer;
begin
  if s is null or s !~ '^[A-Z]{3}[UJZ][0-9]{7}$' then return false; end if;
  for i in 1..10 loop
    c := substr(s, i, 1);
    if c ~ '[0-9]' then v := c::integer;
    else n := ascii(c) - 55; v := n + (n - 1) / 10;   -- A=10, B=12 … (multiples de 11 sautés)
    end if;
    total := total + v * (2 ^ (i - 1))::integer;
  end loop;
  return (total % 11) % 10 = substr(s, 11, 1)::integer;
end $$;

-- Candidats n° de container dans un texte libre (format ISO, espaces tolérés)
create or replace function public.appro_containers_dans_texte(p text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct public.appro_container_normaliser(m[1])), '{}')
  from regexp_matches(upper(coalesce(p, '')), '([A-Z]{3}[UJZ][\s]?[0-9]{6}[\s\-]?[0-9])', 'g') as m
$$;

-- ─── 7. Liste du portefeuille ───────────────────────────────────────────────
create or replace function public.get_appro_portefeuille_cdf()
returns jsonb
language plpgsql
security definer
set search_path = public, sage
set statement_timeout = '60s'
as $$
declare
  v_auj date := (now() at time zone 'Europe/Paris')::date;
  p_cont_jours   integer := coalesce((select valeur from appro_parametres where cle = 'cdf_cont_alerte_jours_avant'), 70);
  p_releve_max   integer := coalesce((select valeur from appro_parametres where cle = 'cdf_cont_releve_max_jours'), 7);
  p_m_intenable  integer := coalesce((select valeur from appro_parametres where cle = 'cdf_cont_marge_intenable'), 2);
  p_m_tres_juste integer := coalesce((select valeur from appro_parametres where cle = 'cdf_cont_marge_tres_juste'), 4);
  p_m_juste      integer := coalesce((select valeur from appro_parametres where cle = 'cdf_cont_marge_juste'), 7);
  p_sans_ar      integer := coalesce((select valeur from appro_parametres where cle = 'cdf_sans_ar_jours'), 7);
  p_cdc_horizon  integer := coalesce((select valeur from appro_parametres where cle = 'cdf_relance_cdc_horizon_jours'), 21);
  p_conf_valid   integer := coalesce((select valeur from appro_parametres where cle = 'cdf_confirmation_validite_jours'), 14);
  v_statut_dispo boolean := exists (select 1 from sage.cdf_statut) and exists (select 1 from appro_cdf_statuts);
  v_comm_dispo   boolean := exists (select 1 from sage.bdcf_commentaires);
  v_rows jsonb;
begin
  with cdf as (
    select b.al_docnum as numero,
           max(b.al_ctnum) as fournisseur_code,
           max(b.al_doref) as reference,
           max(nullif(btrim(b.al_deno), '')) as depot,
           min(sage_date_text_to_date(b.al_dldatebc)) as date_commande,
           min(sage_date_text_to_date(b.al_dodatelivr)) as date_livraison,
           count(*) as nb_lignes,
           sum(coalesce(b.qtevendues, 0)) as qte,
           sum(coalesce(b.cahtnet, 0)) as montant_ht,
           max(b.loaded_at) as loaded_at
    from sage.bdcf b
    where b.al_doctype = '12'
    group by b.al_docnum
  ),
  comm as (
    select c.do_piece,
           array_agg(c.dl_design order by c.dl_ligne) filter (where nullif(btrim(c.dl_design), '') is not null) as lignes,
           (select coalesce(array_agg(distinct x), '{}') from unnest(array_agg(c.dl_design)) d, unnest(appro_containers_dans_texte(d)) x) as candidats
    from sage.bdcf_commentaires c
    group by c.do_piece
  ),
  rel as (
    select distinct on (r.cdf_numero) r.*
    from appro_container_releves r
    order by r.cdf_numero, r.created_at desc, r.id desc
  ),
  rel_n as (select cdf_numero, count(*) as nb from appro_container_releves group by 1),
  dep as (
    select btrim(x) as numero,
           count(distinct v.numero_document) as nb_cdc,
           min(v.date_livraison) as premiere_livraison_cdc,
           sum(v.quantite) as qte_cdc,
           count(distinct v.numero_document) filter (where v.statut_couverture = 'RECEPTION_TARDIVE') as nb_cdc_tardives
    from v_portefeuille_couverture_stock v,
         unnest(string_to_array(v.prochaine_reception_cdf, ',')) x
    where v.statut_couverture in ('COUVERT_PAR_RECEPTION', 'RECEPTION_TARDIVE')
      and v.prochaine_reception_cdf is not null
    group by 1
  ),
  base as (
    select c.*,
           t.ti_intitule as fournisseur_nom,
           (c.reference ilike 'CONT%') as est_cont,
           (upper(coalesce(c.depot, '')) = 'FMS') as est_fms,
           (v_auj - c.date_commande) as age_jours,
           (c.date_livraison - v_auj) as jours_avant_livraison,
           s.do_statut as statut_code,
           st.libelle as statut_libelle,
           st.ar_recu,
           coalesce(cm.lignes, '{}') as commentaires,
           (select x from unnest(coalesce(cm.candidats, '{}')) x where appro_container_valide(x) limit 1) as container_sage,
           (select coalesce(array_agg(x), '{}') from unnest(coalesce(cm.candidats, '{}')) x where not appro_container_valide(x)) as containers_invalides,
           (select count(*) from unnest(coalesce(cm.candidats, '{}')) x where appro_container_valide(x)) as nb_containers_sage,
           r.container_numero as container_saisi, r.armateur, r.navire, r.port_arrivee, r.eta_port,
           r.statut as statut_suivi, r.commentaire as commentaire_suivi, r.created_at as releve_le, r.created_by as releve_par,
           coalesce(rn.nb, 0) as nb_releves,
           coalesce(d.nb_cdc, 0) as nb_cdc, d.premiere_livraison_cdc, d.qte_cdc, coalesce(d.nb_cdc_tardives, 0) as nb_cdc_tardives
    from cdf c
    left join sage.tiers t on t.ti_num = c.fournisseur_code
    left join sage.cdf_statut s on s.do_piece = c.numero
    left join appro_cdf_statuts st on st.code = s.do_statut
    left join comm cm on cm.do_piece = c.numero
    left join rel r on r.cdf_numero = c.numero
    left join rel_n rn on rn.cdf_numero = c.numero
    left join dep d on d.numero = c.numero
  ),
  calc as (
    select b.*,
           coalesce(b.container_sage, appro_container_normaliser(b.container_saisi)) as container,
           case when b.container_sage is not null then 'sage' when b.container_saisi is not null then 'saisie' end as container_source,
           (b.container_sage is not null and b.container_saisi is not null
              and b.container_sage <> appro_container_normaliser(b.container_saisi)) as container_ecart,
           (b.date_livraison - b.eta_port) as marge_jours
    from base b
  ),
  calc2 as (
    select c.*,
           appro_container_valide(c.container) as container_valide,
           (select a.code from appro_armateurs a where left(c.container, 4) = any(a.prefixes) limit 1) as armateur_suggere,
           case
             when c.eta_port is null or c.date_livraison is null then null
             when c.marge_jours < 0 then 'RETARD'
             when c.marge_jours <= p_m_intenable then 'INTENABLE'
             when c.marge_jours <= p_m_tres_juste then 'TRES_JUSTE'
             when c.marge_jours <= p_m_juste then 'JUSTE'
             else 'OK'
           end as verdict,
           (c.est_cont and c.date_livraison is not null and c.jours_avant_livraison <= p_cont_jours
              and coalesce(c.statut_suivi, '') <> 'livre') as cont_fenetre
    from calc c
  ),
  alertes as (
    select c.numero,
           array_remove(array[
             case when c.cont_fenetre and not coalesce(c.container_valide, false) and c.container is null then 'CONT_SANS_CONTAINER' end,
             case when c.est_cont and c.container is not null and not c.container_valide then 'CONT_CONTAINER_INVALIDE' end,
             case when c.est_cont and (cardinality(c.containers_invalides) > 0 and c.container_sage is null) and c.container is null then 'CONT_CONTAINER_INVALIDE' end,
             case when c.est_cont and c.container_ecart then 'CONT_CONTAINER_ECART' end,
             case when c.est_cont and c.nb_containers_sage > 1 then 'CONT_PLUSIEURS_CONTAINERS' end,
             case when c.cont_fenetre and c.container_valide and c.eta_port is null then 'CONT_SANS_SUIVI' end,
             case when c.cont_fenetre and c.eta_port is not null
                       and coalesce(c.statut_suivi, '') not in ('arrive', 'decharge', 'livre')
                       and c.releve_le < now() - make_interval(days => p_releve_max) then 'CONT_SUIVI_ANCIEN' end,
             case when c.verdict in ('RETARD', 'INTENABLE', 'TRES_JUSTE') then 'CONT_MARGE' end,
             case when v_statut_dispo and c.est_fms and c.statut_code is not null and not coalesce(c.ar_recu, false)
                       and c.age_jours >= p_sans_ar then 'SANS_AR' end,
             case when c.nb_cdc > 0 and c.date_livraison is not null and c.jours_avant_livraison between 0 and p_cdc_horizon then 'CDC_A_CONFIRMER' end,
             case when c.date_livraison is not null and c.date_livraison < v_auj then 'DATE_DEPASSEE' end,
             case when c.date_livraison is null then 'SANS_DATE' end
           ], null) as codes
    from calc2 c
  ),
  confirmations as (
    select distinct a.cdf_numero, a.alerte_code
    from appro_cdf_actions a
    join calc2 c on c.numero = a.cdf_numero
    where a.action = 'confirme'
      and a.created_at >= now() - make_interval(days => p_conf_valid)
      and a.date_livraison_ref is not distinct from c.date_livraison
  ),
  derniere_action as (
    select distinct on (a.cdf_numero) a.cdf_numero, a.action, a.alerte_code, a.commentaire, a.created_at, a.created_by
    from appro_cdf_actions a
    order by a.cdf_numero, a.created_at desc, a.id desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'numero', c.numero,
           'fournisseur_code', c.fournisseur_code,
           'fournisseur_nom', c.fournisseur_nom,
           'reference', c.reference,
           'depot', c.depot,
           'est_fms', c.est_fms,
           'est_cont', c.est_cont,
           'date_commande', c.date_commande,
           'date_livraison', c.date_livraison,
           'age_jours', c.age_jours,
           'jours_avant_livraison', c.jours_avant_livraison,
           'nb_lignes', c.nb_lignes,
           'qte', c.qte,
           'montant_ht', round(c.montant_ht::numeric, 2),
           'statut_code', c.statut_code,
           'statut_libelle', c.statut_libelle,
           'ar_recu', c.ar_recu,
           'commentaires', to_jsonb(c.commentaires),
           'container', c.container,
           'container_source', c.container_source,
           'container_valide', c.container_valide,
           'container_saisi', c.container_saisi,
           'containers_invalides', to_jsonb(c.containers_invalides),
           'armateur', c.armateur,
           'armateur_suggere', c.armateur_suggere,
           'navire', c.navire,
           'port_arrivee', c.port_arrivee,
           'eta_port', c.eta_port,
           'statut_suivi', c.statut_suivi,
           'commentaire_suivi', c.commentaire_suivi,
           'releve_le', c.releve_le,
           'releve_par', c.releve_par,
           'nb_releves', c.nb_releves,
           'marge_jours', c.marge_jours,
           'verdict', c.verdict,
           'nb_cdc', c.nb_cdc,
           'nb_cdc_tardives', c.nb_cdc_tardives,
           'qte_cdc', c.qte_cdc,
           'premiere_livraison_cdc', c.premiere_livraison_cdc,
           'alertes', to_jsonb(coalesce((select array_agg(x) from unnest(al.codes) x
                                         where not exists (select 1 from confirmations f where f.cdf_numero = c.numero and f.alerte_code = x)), '{}')),
           'alertes_confirmees', to_jsonb(coalesce((select array_agg(x) from unnest(al.codes) x
                                         where exists (select 1 from confirmations f where f.cdf_numero = c.numero and f.alerte_code = x)), '{}')),
           'derniere_action', case when da.cdf_numero is null then null else jsonb_build_object(
               'action', da.action, 'alerte_code', da.alerte_code, 'commentaire', da.commentaire,
               'le', da.created_at, 'par', da.created_by) end
         ) order by c.date_livraison nulls first, c.numero), '[]'::jsonb)
  into v_rows
  from calc2 c
  join alertes al on al.numero = c.numero
  left join derniere_action da on da.cdf_numero = c.numero;

  return jsonb_build_object(
    'genere_le', now(),
    'import_sage_le', (select max(loaded_at) from sage.bdcf),
    'sources', jsonb_build_object('statut_ar', v_statut_dispo, 'commentaires', v_comm_dispo),
    'parametres', jsonb_build_object(
      'cont_alerte_jours_avant', p_cont_jours, 'cont_releve_max_jours', p_releve_max,
      'marge_intenable', p_m_intenable, 'marge_tres_juste', p_m_tres_juste, 'marge_juste', p_m_juste,
      'sans_ar_jours', p_sans_ar, 'relance_cdc_horizon_jours', p_cdc_horizon, 'confirmation_validite_jours', p_conf_valid),
    'armateurs', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'nom', nom, 'url_suivi', url_suivi) order by ordre), '[]') from appro_armateurs),
    'rows', v_rows
  );
end $$;

revoke all on function public.get_appro_portefeuille_cdf() from public, anon;
grant execute on function public.get_appro_portefeuille_cdf() to authenticated;

-- ─── 8. Détail d'une CDF (lignes, CDC en attente, historique) ───────────────
create or replace function public.get_appro_cdf_detail(p_numero text)
returns jsonb
language plpgsql
security definer
set search_path = public, sage
set statement_timeout = '60s'
as $$
begin
  return jsonb_build_object(
    'lignes', (select coalesce(jsonb_agg(jsonb_build_object(
                 'ligne', b.al_dlno, 'reference_article', b.al_art_num, 'designation', b.al_dldesign,
                 'quantite', b.qtevendues, 'montant_ht', b.cahtnet,
                 'date_livraison', sage_date_text_to_date(b.al_dodatelivr)) order by b.al_dlno), '[]')
               from sage.bdcf b where b.al_doctype = '12' and b.al_docnum = p_numero),
    'commentaires', (select coalesce(jsonb_agg(c.dl_design order by c.dl_ligne), '[]')
               from sage.bdcf_commentaires c where c.do_piece = p_numero and nullif(btrim(c.dl_design), '') is not null),
    'cdc', (select coalesce(jsonb_agg(jsonb_build_object(
                 'numero_document', v.numero_document, 'nom_tiers', v.nom_tiers, 'numero_tiers', v.numero_tiers,
                 'representant', v.representant, 'agence', v.agence,
                 'reference_article', v.reference_article, 'quantite', v.quantite,
                 'date_livraison', v.date_livraison, 'statut_couverture', v.statut_couverture,
                 'retard_estime_jours', v.retard_estime_jours) order by v.date_livraison, v.numero_document), '[]')
            from v_portefeuille_couverture_stock v
            where v.statut_couverture in ('COUVERT_PAR_RECEPTION', 'RECEPTION_TARDIVE')
              and p_numero = any(string_to_array(replace(coalesce(v.prochaine_reception_cdf, ''), ' ', ''), ','))),
    'releves', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]')
                from appro_container_releves r where r.cdf_numero = p_numero),
    'actions', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]')
                from appro_cdf_actions a where a.cdf_numero = p_numero)
  );
end $$;

revoke all on function public.get_appro_cdf_detail(text) from public, anon;
grant execute on function public.get_appro_cdf_detail(text) to authenticated;
