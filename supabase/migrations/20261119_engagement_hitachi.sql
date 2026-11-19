-- ============================================================================
-- Engagement annuel HITACHI (annexe 6 « Objectifs du 1er janvier au 31 décembre »)
-- Écran /stock/engagement-hitachi — demandé par Arnaud le 19/11/2026, accès réservé.
--
--  * hitachi_engagement          : objectif CA de l'année (HT hors DEEE) + fournisseurs SAGE / BLG
--  * hitachi_engagement_gammes   : gammes de l'annexe (objectifs quantitatifs S1 / S2, réalisé N-1
--                                  communiqué par Hitachi, remises, BFA) ; lignes « total » (RAC Total,
--                                  Total PAC Air / Eau) qui portent l'objectif de leurs gammes filles
--  * hitachi_engagement_regles   : rattachement des articles aux gammes, éditable depuis l'écran :
--                                  famille SAGE et/ou famille + sous-famille BLG, motif de référence
--                                  (LIKE), « compté en unités » (l'objectif Hitachi compte les groupes
--                                  extérieurs ; System Free compte les UI DRV). Première règle qui
--                                  correspond (priorité croissante, la plus précise d'abord).
--  * refresh_hitachi_engagement(annee) : extraction stockée (hitachi_engagement_articles / _mesures),
--      pg_cron « hitachi-engagement-refresh » + bouton « Actualiser » ;
--    get_hitachi_engagement(annee) : rattachement par les règles + situation à date par gamme
--      Achats  : reçu sur l'année = lignes de CDF BLG du fournisseur (quantité livrée à la date de
--                livraison, valorisée au prix d'achat net) ; ferme = CDF SAGE ouvertes (sage.bdcf type 12,
--                date de livraison SAGE, en retard ou sans date = demain, comme la couverture stock).
--      Ventes  : BL de l'année (indicateur_flux_articles_mensuel, CA et coût = CA − marge) ; ferme =
--                CDC à livrer (interne.v_cdc_lignes_global) valorisées en CA et au prix d'achat.
--  * save / delete_hitachi_engagement_regle : édition des rattachements.
-- ============================================================================

create or replace function public.hitachi_engagement_autorise()
returns boolean
language sql
stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email'), '') in ('a.valanchauskas@cegeclim-energies.com', 'valancha@gmail.com')
      or auth.jwt() is null
$$;

create table if not exists public.hitachi_engagement (
  annee            integer primary key,
  libelle          text not null,
  fournisseur_sage text not null default 'H0001',
  fournisseur_blg  text not null default 'fH0001',
  objectif_ca      numeric,
  conditions       jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now(),
  updated_by       text
);

create table if not exists public.hitachi_engagement_gammes (
  annee          integer not null references public.hitachi_engagement(annee) on delete cascade,
  code           text not null,
  libelle        text not null,
  parent         text,
  est_total      boolean not null default false,
  ordre          integer not null default 100,
  unite          text,
  obj_s1         numeric,
  obj_s2         numeric,
  realise_n1_s1  numeric,
  realise_n1_s2  numeric,
  remises        text,
  bfa            text,
  primary key (annee, code)
);

create table if not exists public.hitachi_engagement_regles (
  id               bigserial primary key,
  annee            integer not null references public.hitachi_engagement(annee) on delete cascade,
  gamme_code       text not null,
  famille_sage     text,
  famille_blg      text,
  sous_famille_blg text,
  motif_reference  text,
  exclure_motif    text,
  compte_qte       boolean not null default false,
  priorite         integer not null default 100,
  commentaire      text,
  updated_at       timestamptz not null default now(),
  updated_by       text,
  constraint hitachi_regle_critere check (coalesce(famille_sage, famille_blg, motif_reference) is not null),
  constraint hitachi_regle_gamme foreign key (annee, gamme_code) references public.hitachi_engagement_gammes(annee, code) on delete cascade
);
create index if not exists hitachi_engagement_regles_annee on public.hitachi_engagement_regles (annee, priorite);

alter table public.hitachi_engagement enable row level security;
alter table public.hitachi_engagement_gammes enable row level security;
alter table public.hitachi_engagement_regles enable row level security;
-- pas de policy : lecture / écriture uniquement via les RPC SECURITY DEFINER ci-dessous

-- ----------------------------------------------------------------------------
-- Données 2026 (annexe 6 signée Hitachi le 18/06/2026)
-- ----------------------------------------------------------------------------
insert into public.hitachi_engagement (annee, libelle, objectif_ca, conditions)
values (2026, 'Objectifs du 1er janvier 2026 au 31 décembre 2026 (annexe 6)', 14486682,
  jsonb_build_object(
    'bfa_ca', 'BFA déclenchée à 100 % de l''objectif annuel de CA : 1 % du CA HT réalisé (hors commandes en dérogation YYTI-F), non plafonnée et évolutive (annexe 7). Ex. : 14,9 M€ (102,8 %) → 105,6 % de la bonification = 157 344 €.',
    'bfa_rac', 'S1 — BFA croissance RAC Total (mono + multi) à 100 % de l''objectif quantitatif (groupes extérieurs) : 1 % du CA HT RAC + Light commercial.',
    'bfa_setfree', 'S2 — BFA croissance Air 365 – Set Free Mini à 100 % de l''objectif quantitatif (groupes extérieurs) : 1 % × (CA GE Air 365 + GE Set Free Mini + 60 % CA UI DRV).',
    'budget_promotion', '1 % du CA réalisé du 01/01/2026 au 31/12/2026 (convention unique).',
    'reglement', '30 jours fin de mois le 15 par virement.'
  ))
on conflict (annee) do nothing;

insert into public.hitachi_engagement_gammes (annee, code, libelle, parent, est_total, ordre, unite, obj_s1, obj_s2, realise_n1_s1, realise_n1_s2, remises, bfa) values
 (2026, 'ACC',          'Accessoires',                         null,        false, 10, null,        null, null, null, null, '65,5 % std · 69 % stock M-3 · 74,5 % containers', null),
 (2026, 'RAC_TOTAL',    'RAC Total',                           null,        true,  20, 'groupes ext.', 4140, 1650, 3323, 1520, '65,5 % std · 69 % stock M-3 · 74,5 % containers', 'BFA S1 : 1 % CA RAC + Light commercial'),
 (2026, 'RAC_MONO',     'RAC Mono',                            'RAC_TOTAL', false, 21, 'groupes ext.', null, null, 2259, 264,  null, null),
 (2026, 'RAC_MULTI',    'RAC Multi (dont Triple C)',           'RAC_TOTAL', false, 22, 'groupes ext.', null, null, 1064, 1256, null, null),
 (2026, 'RAC_UI',       'RAC — unités intérieures',            'RAC_TOTAL', false, 23, null,        null, null, null, null, null, null),
 (2026, 'PAC_TOTAL',    'Total PAC Air / Eau',                 null,        true,  30, 'groupes ext.', 498,  647,  457,  612,  null, null),
 (2026, 'YUTAKI_S',     'Yutaki S / AirH2O 600',               'PAC_TOTAL', false, 31, 'groupes ext.', 344,  520,  306,  488,  '63,3 % std · 68,5 % stock M-3', null),
 (2026, 'YUTAKI_M',     'Yutaki-M / AirH2O 800',               'PAC_TOTAL', false, 32, 'groupes ext.', 122,  63,   119,  60,   '63,3 % std · 68,5 % stock M-3', null),
 (2026, 'AIRH2O400',    'AirH2O 400',                          'PAC_TOTAL', false, 33, 'groupes ext.', 32,   64,   32,   64,   '63,3 % std · 68,5 % containers', null),
 (2026, 'YUTAMPO',      'Yutampo',                             null,        false, 40, 'groupes ext.', 698,  882,  687,  877,  '63,3 % std · 68,5 % stock M-3 · 69,8 % containers', null),
 (2026, 'PACKAGE',      'Primairy / IVX / Utopia Prime',       null,        false, 50, 'groupes ext.', 320,  246,  312,  225,  '70 % std · 73 % (Package) / 76 % (IVX) stock M-3', null),
 (2026, 'SETFREE_MINI', 'Air 365 – Set Free Mini',             null,        false, 60, 'groupes ext.', 100,  76,   79,   65,   '70 % std · 76 % stock M-3', 'BFA S2 : 1 % (GE Air 365 + GE Set Free Mini + 60 % UI DRV)'),
 (2026, 'SYSTEM_FREE',  'System Free (UI DRV)',                null,        false, 70, 'UI',        1110, 890,  1072, 666,  '70 % std · 76 % stock M-3', null),
 (2026, 'AUTRES',       'Autres articles Hitachi (hors gammes)', null,      false, 90, null,        null, null, null, null, null, null)
on conflict (annee, code) do nothing;

-- Rattachements par défaut : familles SAGE (couvrent les ventes), affinés par les sous-familles BLG
-- et les motifs de référence. Contrôlés sur les réceptions 2025 face au « Réalisé CY 2025 » d'Hitachi.
insert into public.hitachi_engagement_regles (annee, gamme_code, famille_sage, famille_blg, sous_famille_blg, motif_reference, exclure_motif, compte_qte, priorite, commentaire)
select 2026, x.* from (values
 -- DRV : sous-familles BLG d'abord (Set Free Mini / Set Free 365 / IVX / Utopia / DXkit / Primairy)
 ('SETFREE_MINI', null, 'HIT R/R UE Tertiaire', 'DRV SET Free Mini',          null, null, true,  10, 'Groupes Set Free Mini (BLG)'),
 ('SYSTEM_FREE',  null, 'HIT R/R UE Tertiaire', 'DRV SET Free (365)',         null, null, false, 10, 'Groupes System Free : en euros, l''objectif compte les UI'),
 ('PACKAGE',      null, 'HIT R/R UE Tertiaire', 'Micro DRV IVX Prime',        null, null, true,  10, null),
 ('PACKAGE',      null, 'HIT R/R UE Tertiaire', 'Micro DRV IVX Confort',      null, null, true,  10, null),
 ('PACKAGE',      null, 'HIT R/R UE Tertiaire', 'Micro DRV IVX Centrifuge',   null, null, true,  10, null),
 ('PACKAGE',      null, 'HIT R/R UE Tertiaire', 'Utopia Prime',               null, null, true,  10, null),
 ('PACKAGE',      null, 'HIT R/R UE Tertiaire', 'UE DXkit',                   null, null, true,  10, 'IVX pour DX kit'),
 ('PACKAGE',      null, 'HIT Gamme Primary',    'UE Primary',                 null, null, true,  10, null),
 ('PACKAGE',      null, 'HIT Gamme Primary',    'UI Primary',                 null, null, false, 10, null),
 -- DRV : repli sur la famille SAGE quand l'article BLG est « À classifier »
 ('SETFREE_MINI', '00DRVUE',    null, null, 'RAS-%FS%NME%', null,   true,  50, 'Set Free Mini (motif RAS-xFS…NME)'),
 ('SYSTEM_FREE',  '00DRVUE',    null, null, 'RAS-%FSXN%',   null,   false, 50, 'Groupes System Free (motif FSXN)'),
 ('AUTRES',       '00DRVUE',    null, null, 'RHMA-%',       null,   false, 50, 'Samouraï : hors grille'),
 ('PACKAGE',      '00DRVUE',    null, null, null,           null,   true,  90, 'Autres groupes DRV : IVX / Utopia / Primairy'),
 ('PACKAGE',      '00PRIMAIRY', null, null, 'RAS-%',        null,   true,  50, 'Groupes Primairy'),
 ('PACKAGE',      '00PRIMAIRY', null, null, null,           null,   false, 90, 'UI Primairy'),
 ('PACKAGE',      '17UTOPIA',   null, null, null,           null,   true,  90, null),
 ('SYSTEM_FREE',  '00FREEUI',   null, null, null,           null,   true,  100, 'UI DRV : comptées (objectif en UI)'),
 -- RAC
 ('RAC_MONO',     '00RACUE',    null, null, null,           null,   true,  100, null),
 ('RAC_MONO',     '00DODAIRAC', null, null, null,           null,   true,  100, null),
 ('RAC_MONO',     '00AH200',    null, null, 'RAC-%',        null,   true,  50, 'Airhome 200 : groupes'),
 ('RAC_UI',       '00AH200',    null, null, null,           null,   false, 100, 'Airhome 200 : UI'),
 ('RAC_MONO',     '00SUMMIT',   null, null, 'RAC-%',        null,   true,  50, null),
 ('RAC_UI',       '00SUMMIT',   null, null, null,           null,   false, 100, null),
 ('RAC_MULTI',    '00RAMUE',    null, null, null,           null,   true,  100, null),
 ('RAC_MULTI',    '00DODAIRAM', null, null, null,           null,   true,  100, null),
 ('RAC_MULTI',    '00TRIPLCUE', null, null, null,           null,   true,  100, 'Triple C compté en RAC Multi'),
 ('RAC_UI',       '00RACRAMUI', null, null, null,           null,   false, 100, null),
 ('RAC_UI',       '00DODAIUI',  null, null, null,           null,   false, 100, null),
 -- PAC Air / Eau
 ('YUTAKI_S',     '00RORASUE',  null, null, null,           null,   true,  100, 'Groupes split AirH2O 600 / Yutaki S'),
 ('YUTAKI_S',     '00RORWMUI',  null, null, null,           null,   false, 100, null),
 ('YUTAKI_S',     '00RORWDUI',  null, null, null,           null,   false, 100, null),
 ('YUTAKI_S',     '00RORWHUI',  null, null, null,           null,   false, 100, null),
 ('YUTAKI_M',     '00RORASM',   null, null, null,           null,   true,  100, 'Monoblocs Yutaki M / AirH2O 800'),
 ('YUTAKI_M',     '00ROHUI',    null, null, null,           null,   false, 100, null),
 ('AIRH2O400',    '00ROH2OUE',  null, null, null,           null,   true,  100, null),
 ('AIRH2O400',    '00ROH2OUI',  null, null, null,           null,   false, 100, null),
 -- Yutampo : Hitachi compte les groupes (UE), pas les ballons
 ('YUTAMPO',      '00YUTAMPUE', null, null, null,           null,   true,  100, null),
 ('YUTAMPO',      '00YUTAMPUI', null, null, null,           null,   false, 100, 'Ballons : en euros seulement'),
 ('YUTAMPO',      '00YLAGON',   null, null, null,           null,   false, 100, null),
 -- Accessoires
 ('ACC',          '00ACC',      null, null, null,           null,   false, 100, null),
 ('ACC',          '00ROECS',    null, null, null,           null,   false, 100, 'Ballon ECS déporté (remise accessoires)')
) as x(gamme_code, famille_sage, famille_blg, sous_famille_blg, motif_reference, exclure_motif, compte_qte, priorite, commentaire)
where not exists (select 1 from public.hitachi_engagement_regles r where r.annee = 2026);

-- ----------------------------------------------------------------------------
-- Données préparées (rafraîchies par pg_cron et par le bouton « Actualiser »)
--   L'extraction des réceptions BLG et du flux BL coûte 10 à 20 s à froid : elle est
--   faite une fois et stockée ; l'écran ne fait que rattacher (règles) et agréger (< 1 s).
-- ----------------------------------------------------------------------------
create table if not exists public.hitachi_engagement_articles (
  annee            integer not null,
  ref_key          text not null,
  part_id          integer,
  famille_sage     text,
  famille_blg      text,
  sous_famille_blg text,
  designation      text,
  prix_achat       numeric,
  pertinent_sage   boolean,
  primary key (annee, ref_key)
);

create table if not exists public.hitachi_engagement_mesures (
  annee              integer not null,
  ref_key            text not null,
  ach_recu_q_s1      numeric, ach_recu_q_s2 numeric, ach_recu_v_s1 numeric, ach_recu_v_s2 numeric,
  ach_n1_q_s1        numeric, ach_n1_q_s2 numeric, ach_n1_v numeric,
  ach_ferme_q_s1     numeric, ach_ferme_q_s2 numeric, ach_ferme_v_s1 numeric, ach_ferme_v_s2 numeric,
  ach_ferme_q_apres  numeric, ach_ferme_v_apres numeric, ach_ferme_q_hyp numeric,
  ven_bl_q_s1        numeric, ven_bl_q_s2 numeric, ven_bl_ca_s1 numeric, ven_bl_ca_s2 numeric, ven_bl_cout_s1 numeric, ven_bl_cout_s2 numeric,
  ven_ferme_q_s1     numeric, ven_ferme_q_s2 numeric, ven_ferme_ca numeric, ven_ferme_cout numeric, ven_ferme_q_apres numeric, ven_ferme_ca_apres numeric,
  primary key (annee, ref_key)
);

create table if not exists public.hitachi_engagement_refresh (
  annee        integer primary key,
  refreshed_at timestamptz not null default now(),
  duree_s      numeric,
  sources      jsonb
);

alter table public.hitachi_engagement_articles enable row level security;
alter table public.hitachi_engagement_mesures enable row level security;
alter table public.hitachi_engagement_refresh enable row level security;

drop function if exists public.get_hitachi_engagement_refs(integer, text);

create or replace function public.refresh_hitachi_engagement(p_annee integer default extract(year from current_date)::integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_eng      public.hitachi_engagement%rowtype;
  v_t0       timestamptz := clock_timestamp();
  v_d1       date := make_date(p_annee + 1, 1, 1);
  v_s2       date := make_date(p_annee, 7, 1);
  v_demain   date := current_date + 1;
  v_supplier integer;
  v_sources  jsonb;
begin
  if not public.hitachi_engagement_autorise() then
    raise exception 'Accès réservé' using errcode = '42501';
  end if;
  select * into v_eng from public.hitachi_engagement where annee = p_annee;
  if not found then
    return jsonb_build_object('annee', p_annee, 'engagement', null);
  end if;
  perform pg_advisory_xact_lock(hashtext('refresh_hitachi_engagement'), p_annee);

  select id into v_supplier from blg.article_supplier where upper(name) = upper(v_eng.fournisseur_blg) limit 1;

  -- 1. Réceptions : lignes de CDF BLG du fournisseur, N et N-1 (quantité livrée à la date de livraison,
  --    valorisée au prix d'achat net de la ligne). Référence ramenée à la réf. SAGE quand elle existe.
  drop table if exists pg_temp.he_refs_sage;
  create temp table he_refs_sage on commit drop as
  select distinct upper(trim(reference_article)) as ref_sage from public.ref_articles;
  create index on he_refs_sage (ref_sage);

  drop table if exists pg_temp.he_recu;
  create temp table he_recu on commit drop as
  select coalesce(ra1.ref_sage, ra2.ref_sage, upper(trim(coalesce(ap.reference, l.reference)))) as ref_key,
         l.article_fk as part_id,
         extract(year from l.delivery_date_actual)::int as an,
         case when extract(month from l.delivery_date_actual) <= 6 then 1 else 2 end as sem,
         sum(coalesce(l.quantity_delivered, 0))::numeric as q,
         sum(coalesce(l.quantity_delivered, 0) * coalesce(l.purchase_price, 0))::numeric as v
  from blg.sale_quote sq
  join blg.sale_quote_line l on l.quote_fk = sq.id
  left join blg.article_part ap on ap.id = l.article_fk
  left join pg_temp.he_refs_sage ra1 on ra1.ref_sage = upper(trim(ap.reference))
  left join pg_temp.he_refs_sage ra2 on ra2.ref_sage = upper(trim(ap.internal_reference))
  where sq.type = 'purchase' and sq.supplier_fk = v_supplier
    and coalesce(l.type, '') <> 'comment'
    and l.delivery_date_actual >= make_date(p_annee - 1, 1, 1) and l.delivery_date_actual < v_d1
    and coalesce(l.quantity_delivered, 0) <> 0
  group by 1, 2, 3, 4;

  -- 2. CDF SAGE ouvertes (bdcf type 12) : en retard ou sans date = demain
  drop table if exists pg_temp.he_ferme_ach;
  create temp table he_ferme_ach on commit drop as
  select upper(trim(b.al_art_num)) as ref_key,
         case when d.dt is null or d.dt <= current_date then v_demain else d.dt end as dt,
         (d.dt is null or d.dt <= current_date) as hypothese,
         coalesce(b.qtevendues, 0)::numeric as q,
         coalesce(b.cahtnet, 0)::numeric as v
  from sage.bdcf b
  cross join lateral (select public.sage_date_text_to_date(b.al_dodatelivr) as dt) d
  where b.al_doctype = '12' and b.al_ctnum = v_eng.fournisseur_sage and coalesce(b.qtevendues, 0) > 0;

  -- 3. Univers articles
  drop table if exists pg_temp.he_art;
  create temp table he_art (
    ref_key text primary key, part_id integer, famille_sage text, famille_blg text, sous_famille_blg text,
    designation text, prix_achat numeric, pertinent_sage boolean
  ) on commit drop;

  insert into he_art (ref_key, famille_sage, designation, prix_achat)
  select distinct on (upper(trim(ra.reference_article))) upper(trim(ra.reference_article)), ra.famille, ra.designation, ra.prix_achat
  from public.ref_articles ra
  where upper(trim(coalesce(ra.fournisseur_principal, ''))) = upper(v_eng.fournisseur_sage)
     or ra.famille in (select r.famille_sage from public.hitachi_engagement_regles r where r.annee = p_annee and r.famille_sage is not null)
  order by upper(trim(ra.reference_article));

  insert into he_art (ref_key, famille_sage, designation, prix_achat)
  select k.ref_key, ra.famille, ra.designation, ra.prix_achat
  from (select ref_key from he_recu where ref_key is not null union select ref_key from he_ferme_ach) k
  left join lateral (select * from public.ref_articles ra where upper(trim(ra.reference_article)) = k.ref_key limit 1) ra on true
  where k.ref_key is not null and not exists (select 1 from he_art a where a.ref_key = k.ref_key);

  insert into he_art (ref_key, part_id)
  select distinct on (upper(trim(ap.reference))) upper(trim(ap.reference)), ap.id
  from blg.article_part ap
  where ap.supplier_fk = v_supplier and nullif(trim(ap.reference), '') is not null
    and not exists (select 1 from he_art a where a.ref_key = upper(trim(ap.reference)))
  order by upper(trim(ap.reference)), ap.id;

  -- article BLG des réceptions (prime), sinon par référence puis référence interne
  update he_art a set part_id = r.part_id
  from (select distinct on (ref_key) ref_key, part_id from he_recu where part_id is not null order by ref_key, an desc) r
  where a.part_id is null and r.ref_key = a.ref_key;
  update he_art a set part_id = ap.id
  from blg.article_part ap
  where a.part_id is null and upper(trim(ap.reference)) = a.ref_key;
  update he_art a set part_id = ap.id
  from blg.article_part ap
  where a.part_id is null and upper(trim(ap.internal_reference)) = a.ref_key;

  update he_art a set famille_blg = f.title, sous_famille_blg = s.title,
         designation = coalesce(a.designation, ap.label),
         prix_achat = coalesce(nullif(a.prix_achat, 0), nullif(ap.last_purchase_price, 0), nullif(ap.average_weighted_purchase_price, 0))
  from blg.article_part ap
  left join blg.article_subfamily s on s.id = ap.subfamily_fk
  left join blg.article_family f on f.id = s.family_fk
  where ap.id = a.part_id;

  update he_art a set pertinent_sage = (upper(coalesce(rf.quantite_pertinente, 'Oui')) <> 'NON')
  from public.ref_familles rf where rf.famille = a.famille_sage;

  -- 4. Ventes : BL de l'année (flux articles) et CDC à livrer
  drop table if exists pg_temp.he_bl;
  create temp table he_bl on commit drop as
  select upper(trim(f.reference_article)) as ref_key,
         case when f.mois <= 6 then 1 else 2 end as sem,
         sum(coalesce(f.quantite, 0))::numeric as q,
         sum(coalesce(f.ca_ht, 0))::numeric as ca,
         sum(coalesce(f.ca_ht, 0) - coalesce(f.marge_valeur, 0))::numeric as cout
  from public.indicateur_flux_articles_mensuel f
  where f.flux = 'BL' and f.annee = p_annee
    and upper(trim(f.reference_article)) in (select ref_key from he_art where famille_sage is not null)
  group by 1, 2;

  drop table if exists pg_temp.he_cdc;
  create temp table he_cdc on commit drop as
  select upper(trim(c.reference_article)) as ref_key,
         coalesce(c.date_livraison, current_date) as dt,
         sum(coalesce(c.quantite, 0))::numeric as q,
         sum(coalesce(c.montant_ht, 0))::numeric as ca
  from interne.v_cdc_lignes_global c
  where upper(trim(c.reference_article)) in (select ref_key from he_art)
  group by 1, 2;

  -- 5. Persistance
  delete from public.hitachi_engagement_mesures where annee = p_annee;
  insert into public.hitachi_engagement_mesures
  select p_annee, ref_key,
         round(sum(ach_recu_q_s1), 2), round(sum(ach_recu_q_s2), 2), round(sum(ach_recu_v_s1), 2), round(sum(ach_recu_v_s2), 2),
         round(sum(ach_n1_q_s1), 2), round(sum(ach_n1_q_s2), 2), round(sum(ach_n1_v), 2),
         round(sum(ach_ferme_q_s1), 2), round(sum(ach_ferme_q_s2), 2), round(sum(ach_ferme_v_s1), 2), round(sum(ach_ferme_v_s2), 2),
         round(sum(ach_ferme_q_apres), 2), round(sum(ach_ferme_v_apres), 2), round(sum(ach_ferme_q_hyp), 2),
         round(sum(ven_bl_q_s1), 2), round(sum(ven_bl_q_s2), 2), round(sum(ven_bl_ca_s1), 2), round(sum(ven_bl_ca_s2), 2),
         round(sum(ven_bl_cout_s1), 2), round(sum(ven_bl_cout_s2), 2),
         round(sum(ven_ferme_q_s1), 2), round(sum(ven_ferme_q_s2), 2), round(sum(ven_ferme_ca), 2), round(sum(ven_ferme_cout), 2),
         round(sum(ven_ferme_q_apres), 2), round(sum(ven_ferme_ca_apres), 2)
  from (
    select ref_key,
           sum(case when an = p_annee and sem = 1 then q end) ach_recu_q_s1,
           sum(case when an = p_annee and sem = 2 then q end) ach_recu_q_s2,
           sum(case when an = p_annee and sem = 1 then v end) ach_recu_v_s1,
           sum(case when an = p_annee and sem = 2 then v end) ach_recu_v_s2,
           sum(case when an = p_annee - 1 and sem = 1 then q end) ach_n1_q_s1,
           sum(case when an = p_annee - 1 and sem = 2 then q end) ach_n1_q_s2,
           sum(case when an = p_annee - 1 then v end) ach_n1_v,
           null::numeric ach_ferme_q_s1, null::numeric ach_ferme_q_s2, null::numeric ach_ferme_v_s1, null::numeric ach_ferme_v_s2,
           null::numeric ach_ferme_q_apres, null::numeric ach_ferme_v_apres, null::numeric ach_ferme_q_hyp,
           null::numeric ven_bl_q_s1, null::numeric ven_bl_q_s2, null::numeric ven_bl_ca_s1, null::numeric ven_bl_ca_s2, null::numeric ven_bl_cout_s1, null::numeric ven_bl_cout_s2,
           null::numeric ven_ferme_q_s1, null::numeric ven_ferme_q_s2, null::numeric ven_ferme_ca, null::numeric ven_ferme_cout, null::numeric ven_ferme_q_apres, null::numeric ven_ferme_ca_apres
    from he_recu where ref_key is not null group by ref_key
    union all
    select ref_key, null, null, null, null, null, null, null,
           sum(case when dt < v_d1 and dt < v_s2 then q end),
           sum(case when dt < v_d1 and dt >= v_s2 then q end),
           sum(case when dt < v_d1 and dt < v_s2 then v end),
           sum(case when dt < v_d1 and dt >= v_s2 then v end),
           sum(case when dt >= v_d1 then q end), sum(case when dt >= v_d1 then v end),
           sum(case when dt < v_d1 and hypothese then q end),
           null, null, null, null, null, null, null, null, null, null, null, null
    from he_ferme_ach group by ref_key
    union all
    select ref_key, null, null, null, null, null, null, null, null, null, null, null, null, null, null,
           sum(case when sem = 1 then q end), sum(case when sem = 2 then q end),
           sum(case when sem = 1 then ca end), sum(case when sem = 2 then ca end),
           sum(case when sem = 1 then cout end), sum(case when sem = 2 then cout end),
           null, null, null, null, null, null
    from he_bl group by ref_key
    union all
    select c.ref_key, null, null, null, null, null, null, null, null, null, null, null, null, null, null,
           null, null, null, null, null, null,
           sum(case when c.dt < v_d1 and c.dt < v_s2 then c.q end),
           sum(case when c.dt < v_d1 and c.dt >= v_s2 then c.q end),
           sum(case when c.dt < v_d1 then c.ca end),
           sum(case when c.dt < v_d1 then c.q * coalesce(a.prix_achat, 0) end),
           sum(case when c.dt >= v_d1 then c.q end),
           sum(case when c.dt >= v_d1 then c.ca end)
    from he_cdc c left join he_art a on a.ref_key = c.ref_key
    group by c.ref_key
  ) m
  group by ref_key;

  delete from public.hitachi_engagement_articles where annee = p_annee;
  insert into public.hitachi_engagement_articles (annee, ref_key, part_id, famille_sage, famille_blg, sous_famille_blg, designation, prix_achat, pertinent_sage)
  select p_annee, ref_key, part_id, famille_sage, famille_blg, sous_famille_blg, designation, prix_achat, pertinent_sage from he_art;

  v_sources := jsonb_build_object(
    'recus_blg', (select max(synced_at) from blg.sale_quote where supplier_fk = v_supplier),
    'cdf_sage', (select max(loaded_at) from sage.bdcf),
    'bl_flux', (select max(updated_at) from public.indicateur_flux_articles_mensuel where annee = p_annee and flux = 'BL')
  );
  insert into public.hitachi_engagement_refresh (annee, refreshed_at, duree_s, sources)
  values (p_annee, now(), round(extract(epoch from clock_timestamp() - v_t0)::numeric, 1), v_sources)
  on conflict (annee) do update set refreshed_at = excluded.refreshed_at, duree_s = excluded.duree_s, sources = excluded.sources;

  return jsonb_build_object('annee', p_annee, 'duree_s', round(extract(epoch from clock_timestamp() - v_t0)::numeric, 1),
                            'articles', (select count(*) from he_art), 'mesures', (select count(*) from public.hitachi_engagement_mesures where annee = p_annee));
end;
$$;

-- ----------------------------------------------------------------------------
-- Lecture : rattachement par les règles + agrégat par gamme × famille × règle
-- ----------------------------------------------------------------------------
create or replace function public.get_hitachi_engagement(p_annee integer default extract(year from current_date)::integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_eng public.hitachi_engagement%rowtype;
begin
  if not public.hitachi_engagement_autorise() then
    raise exception 'Accès réservé' using errcode = '42501';
  end if;
  select * into v_eng from public.hitachi_engagement where annee = p_annee;
  if not found then
    return jsonb_build_object('annee', p_annee, 'engagement', null);
  end if;

  drop table if exists pg_temp.he_rat;
  create temp table he_rat on commit drop as
  select a.*, r.gamme_code as gamme, r.id as regle_id, coalesce(r.compte_qte, false) as compte_qte
  from public.hitachi_engagement_articles a
  left join lateral (
    select r.* from public.hitachi_engagement_regles r
    where r.annee = p_annee
      and (r.famille_sage is null or r.famille_sage = a.famille_sage)
      and (r.famille_blg is null or r.famille_blg = a.famille_blg)
      and (r.sous_famille_blg is null or r.sous_famille_blg = a.sous_famille_blg)
      and (r.motif_reference is null or a.ref_key ilike r.motif_reference)
      and (r.exclure_motif is null or a.ref_key not ilike r.exclure_motif)
    order by r.priorite, (r.motif_reference is not null) desc, (r.sous_famille_blg is not null) desc, (r.famille_blg is not null) desc, r.id
    limit 1
  ) r on true
  where a.annee = p_annee;

  return jsonb_build_object(
    'annee', p_annee,
    'aujourdhui', current_date,
    'engagement', to_jsonb(v_eng),
    'refresh', (select to_jsonb(x) from public.hitachi_engagement_refresh x where x.annee = p_annee),
    'gammes', (select coalesce(jsonb_agg(to_jsonb(g) order by g.ordre), '[]'::jsonb) from public.hitachi_engagement_gammes g where g.annee = p_annee),
    'regles', (select coalesce(jsonb_agg(to_jsonb(r) order by r.gamme_code, r.priorite, r.id), '[]'::jsonb) from public.hitachi_engagement_regles r where r.annee = p_annee),
    'lignes', (
      select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from (
        select coalesce(a.gamme, 'AUTRES') as gamme, a.regle_id, a.famille_sage, a.famille_blg, a.sous_famille_blg,
               coalesce(a.compte_qte, false) as compte_qte, a.pertinent_sage, count(*) as nb_refs,
               sum(m.ach_recu_q_s1) ach_recu_q_s1, sum(m.ach_recu_q_s2) ach_recu_q_s2, sum(m.ach_recu_v_s1) ach_recu_v_s1, sum(m.ach_recu_v_s2) ach_recu_v_s2,
               sum(m.ach_n1_q_s1) ach_n1_q_s1, sum(m.ach_n1_q_s2) ach_n1_q_s2, sum(m.ach_n1_v) ach_n1_v,
               sum(m.ach_ferme_q_s1) ach_ferme_q_s1, sum(m.ach_ferme_q_s2) ach_ferme_q_s2, sum(m.ach_ferme_v_s1) ach_ferme_v_s1, sum(m.ach_ferme_v_s2) ach_ferme_v_s2,
               sum(m.ach_ferme_q_apres) ach_ferme_q_apres, sum(m.ach_ferme_v_apres) ach_ferme_v_apres, sum(m.ach_ferme_q_hyp) ach_ferme_q_hyp,
               sum(m.ven_bl_q_s1) ven_bl_q_s1, sum(m.ven_bl_q_s2) ven_bl_q_s2, sum(m.ven_bl_ca_s1) ven_bl_ca_s1, sum(m.ven_bl_ca_s2) ven_bl_ca_s2,
               sum(m.ven_bl_cout_s1) ven_bl_cout_s1, sum(m.ven_bl_cout_s2) ven_bl_cout_s2,
               sum(m.ven_ferme_q_s1) ven_ferme_q_s1, sum(m.ven_ferme_q_s2) ven_ferme_q_s2, sum(m.ven_ferme_ca) ven_ferme_ca, sum(m.ven_ferme_cout) ven_ferme_cout,
               sum(m.ven_ferme_q_apres) ven_ferme_q_apres, sum(m.ven_ferme_ca_apres) ven_ferme_ca_apres
        from public.hitachi_engagement_mesures m
        left join pg_temp.he_rat a on a.ref_key = m.ref_key
        where m.annee = p_annee
        group by 1, 2, 3, 4, 5, 6, 7
      ) l
    ),
    'catalogue', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'famille_sage', c.famille_sage, 'famille_blg', c.famille_blg, 'sous_famille_blg', c.sous_famille_blg,
        'gamme', c.gamme, 'regle_id', c.regle_id, 'compte_qte', c.compte_qte, 'pertinent_sage', c.pertinent_sage,
        'nb_refs', c.nb, 'nb_actifs', c.nb_actifs, 'exemples', c.ex) order by c.famille_sage nulls last, c.famille_blg, c.sous_famille_blg), '[]'::jsonb)
      from (
        select a.famille_sage, a.famille_blg, a.sous_famille_blg, coalesce(a.gamme, 'AUTRES') gamme, a.regle_id, a.compte_qte, a.pertinent_sage,
               count(*) nb, count(m.ref_key) nb_actifs,
               (array_agg(a.ref_key order by (m.ref_key is null), a.ref_key))[1:4] ex
        from pg_temp.he_rat a
        left join public.hitachi_engagement_mesures m on m.annee = p_annee and m.ref_key = a.ref_key
        group by 1, 2, 3, 4, 5, 6, 7
        having count(m.ref_key) > 0 or a.famille_sage is not null or a.famille_blg like 'HIT%'
      ) c
    )
  );
end;
$$;

-- Détail par référence d'une gamme (fenêtre de contrôle)
create or replace function public.get_hitachi_engagement_refs(p_annee integer, p_gamme text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  v := public.get_hitachi_engagement(p_annee);
  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.ref_key), '[]'::jsonb)
    from (
      select a.ref_key, a.designation, a.famille_sage, a.famille_blg, a.sous_famille_blg, a.compte_qte, a.regle_id, m.*
      from pg_temp.he_rat a
      join public.hitachi_engagement_mesures m on m.annee = p_annee and m.ref_key = a.ref_key
      where coalesce(a.gamme, 'AUTRES') = p_gamme
      union all
      select null, null, null, null, null, false, null, m.*
      from public.hitachi_engagement_mesures m
      where p_gamme = 'AUTRES' and m.annee = p_annee
        and not exists (select 1 from pg_temp.he_rat a where a.ref_key = m.ref_key)
    ) x
  );
end;
$$;

create or replace function public.save_hitachi_engagement_regle(
  p_id bigint, p_annee integer, p_gamme text, p_famille_sage text, p_famille_blg text, p_sous_famille_blg text,
  p_motif text, p_exclure text, p_compte_qte boolean, p_priorite integer, p_commentaire text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id bigint;
begin
  if not public.hitachi_engagement_autorise() then
    raise exception 'Accès réservé' using errcode = '42501';
  end if;
  if coalesce(nullif(trim(p_famille_sage), ''), nullif(trim(p_famille_blg), ''), nullif(trim(p_motif), '')) is null then
    raise exception 'Indiquer au moins une famille SAGE, une famille BLG ou un motif de référence.';
  end if;
  if p_id is null then
    insert into public.hitachi_engagement_regles (annee, gamme_code, famille_sage, famille_blg, sous_famille_blg, motif_reference, exclure_motif, compte_qte, priorite, commentaire, updated_by)
    values (p_annee, p_gamme, nullif(trim(p_famille_sage), ''), nullif(trim(p_famille_blg), ''), nullif(trim(p_sous_famille_blg), ''),
            nullif(trim(p_motif), ''), nullif(trim(p_exclure), ''), coalesce(p_compte_qte, false), coalesce(p_priorite, 100), nullif(trim(p_commentaire), ''),
            auth.jwt() ->> 'email')
    returning id into v_id;
  else
    update public.hitachi_engagement_regles set
      gamme_code = p_gamme, famille_sage = nullif(trim(p_famille_sage), ''), famille_blg = nullif(trim(p_famille_blg), ''),
      sous_famille_blg = nullif(trim(p_sous_famille_blg), ''), motif_reference = nullif(trim(p_motif), ''), exclure_motif = nullif(trim(p_exclure), ''),
      compte_qte = coalesce(p_compte_qte, false), priorite = coalesce(p_priorite, 100), commentaire = nullif(trim(p_commentaire), ''),
      updated_at = now(), updated_by = auth.jwt() ->> 'email'
    where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_hitachi_engagement_regle(p_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.hitachi_engagement_autorise() then
    raise exception 'Accès réservé' using errcode = '42501';
  end if;
  delete from public.hitachi_engagement_regles where id = p_id;
end;
$$;

revoke all on function public.refresh_hitachi_engagement(integer) from public, anon;
revoke all on function public.get_hitachi_engagement(integer) from public, anon;
revoke all on function public.get_hitachi_engagement_refs(integer, text) from public, anon;
revoke all on function public.save_hitachi_engagement_regle(bigint, integer, text, text, text, text, text, text, boolean, integer, text) from public, anon;
revoke all on function public.delete_hitachi_engagement_regle(bigint) from public, anon;
grant execute on function public.refresh_hitachi_engagement(integer) to authenticated;
grant execute on function public.get_hitachi_engagement(integer) to authenticated;
grant execute on function public.get_hitachi_engagement_refs(integer, text) to authenticated;
grant execute on function public.save_hitachi_engagement_regle(bigint, integer, text, text, text, text, text, text, boolean, integer, text) to authenticated;
grant execute on function public.delete_hitachi_engagement_regle(bigint) to authenticated;

-- Rafraîchissement : chaque heure ouvrée après les imports SAGE (h+05 → h+12), et à 04:10 après la synchro BLG.
-- Une seule instruction utile par job (voir incidents pg_cron multi-instructions).
select cron.unschedule(jobid) from cron.job where jobname = 'hitachi-engagement-refresh';
select cron.schedule('hitachi-engagement-refresh', '24 4,7-21 * * *',
  $$SET statement_timeout = '600s'; select public.refresh_hitachi_engagement(extract(year from current_date)::integer);$$);

-- ----------------------------------------------------------------------------
-- Explication de texte (demandée par Arnaud le 19/11/2026), portée en commentaires
-- de base pour rester lisible depuis le Requêteur / l'éditeur SQL.
-- ----------------------------------------------------------------------------
comment on table public.hitachi_engagement is
'Engagement annuel Hitachi (annexe 6 « Objectifs du 1er janvier au 31 décembre »). objectif_ca = objectif de CA achats HT hors DEEE, BFA 1 % du CA HT si 100 % atteint (barème évolutif annexe 7 non appliqué dans l''écran). Écran /stock/engagement-hitachi, accès réservé à Arnaud (hitachi_engagement_autorise).';

comment on table public.hitachi_engagement_gammes is
'Gammes de l''annexe 6. obj_s1 / obj_s2 = objectifs quantitatifs par semestre (groupes extérieurs ; UI DRV pour System Free). realise_n1_* = « Réalisé CY N-1 » communiqué par Hitachi. Les lignes est_total (RAC Total, Total PAC Air / Eau) portent l''objectif de leurs gammes filles (parent) : RAC Mono / Multi n''ont pas d''objectif propre. RAC_UI et AUTRES sont suivies en euros seulement.';

comment on table public.hitachi_engagement_regles is
'Rattachement des articles aux gammes, éditable depuis l''écran (clic sur une gamme). Critères cumulables : famille SAGE, famille et sous-famille BLG, motif de référence LIKE (ex. RAS-%FS%NME%), motif d''exclusion. Chaque article prend la première règle qui correspond, toutes gammes confondues : priorité croissante, puis la plus précise (motif, sous-famille BLG, famille BLG). compte_qte = article compté dans les unités de la gamme. Choix du 19/11/2026 : le comptage reproduit le « Réalisé 2025 » d''Hitachi (contrôlé sur nos réceptions 2025 : RAC Mono 2 243 vs 2 259, Multi 1 061 vs 1 064, Yutampo 687 vs 687) ; il diffère du drapeau « quantité pertinente » SAGE sur 4 familles : groupes Airhome 200 (00AH200) et Triple C (00TRIPLCUE) comptés bien que non pertinents SAGE, ballons Yutampo (00YUTAMPUI) non comptés car Hitachi ne compte que les groupes, UI System Free (00FREEUI) comptées car l''objectif est en UI. Écarts signalés en orange dans l''écran ; décocher « compter en unités » pour revenir au drapeau SAGE.';

comment on table public.hitachi_engagement_articles is
'Univers articles de l''engagement, reconstruit par refresh_hitachi_engagement : références SAGE du fournisseur (ou d''une famille SAGE citée dans les règles), références achetées / commandées au fournisseur, articles BLG du fournisseur. Porte la famille SAGE, la famille et sous-famille BLG (article BLG trouvé par la ligne de CDF, la référence ou la référence interne), le prix d''achat (SAGE, sinon dernier prix / PMP BLG) et le drapeau quantité pertinente de la famille SAGE.';

comment on table public.hitachi_engagement_mesures is
'Mesures par référence et par année, reconstruites par refresh_hitachi_engagement (pg_cron « hitachi-engagement-refresh » à h+24 de 7 h à 21 h et à 4 h 24 UTC, après la synchro BLG ; bouton « Actualiser »). Achats : ach_recu_* = lignes de CDF BLG du fournisseur livrées dans l''année (quantité livrée à sa date de livraison, valorisée au prix d''achat net de la ligne), S1 = janvier–juin ; ach_n1_* = idem N-1 ; ach_ferme_* = CDF SAGE ouvertes (sage.bdcf type 12, montant net cahtnet) à livrer d''ici le 31/12, celles en retard ou sans date étant supposées livrées demain (ach_ferme_q_hyp), _apres = livraison prévue après le 31/12 (ex. opération 2027). Ventes : ven_bl_* = BL de l''année (indicateur_flux_articles_mensuel, CA et coût = CA − marge) ; ven_ferme_* = CDC à livrer (interne.v_cdc_lignes_global) d''ici le 31/12, date passée = à livrer, valorisées en CA et au prix d''achat. Unités = articles comptés (compte_qte) ; euros = toutes familles, y compris les articles non rattachés (« Autres articles Hitachi », où tombent aussi les lignes négatives de régularisation : −353 k€ au 19/11/2026).';

comment on table public.hitachi_engagement_refresh is
'Horodatage et durée du dernier refresh_hitachi_engagement par année, avec la fraîcheur des sources (réceptions BLG, CDF SAGE, flux BL).';

comment on function public.refresh_hitachi_engagement(integer) is
'Reconstruit hitachi_engagement_articles et hitachi_engagement_mesures pour l''année (10 à 20 s à froid, l''extraction des réceptions BLG étant la partie lente). Appelée par pg_cron et par le bouton « Actualiser » de l''écran.';

comment on function public.get_hitachi_engagement(integer) is
'Lecture de l''écran Engagement Hitachi : applique les règles de rattachement aux articles stockés et agrège les mesures par gamme × famille SAGE × famille / sous-famille BLG × règle (< 1 s). Verdicts calculés dans l''écran : « Atteint » sur le réel seul, « Avec le ferme » si réel + ferme couvrent l''objectif, « Manque N » = reste à commander / vendre, « Manqué » = semestre clos sous l''objectif.';

comment on function public.get_hitachi_engagement_refs(integer, text) is
'Détail par référence d''une gamme (fenêtre de rattachement), mêmes règles que get_hitachi_engagement.';
