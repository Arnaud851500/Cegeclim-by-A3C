-- ============================================================================
-- 20261104d_plan_expedition_fms.sql
-- ----------------------------------------------------------------------------
-- Écran « Plan d'expédition FMS » (/stock/plan-expedition-fms), demandé par
-- Arnaud le 04/11/2026 — arrivages containers Asie à Fos (5, 6, 7 novembre),
-- réceptions FMS la semaine prochaine et le début de la suivante, capacité FMS
-- ~100 palettes / jour et en gros une expédition par destinataire et par jour.
--
-- Objectif : dès la semaine prochaine, saturer FMS avec ce qui est DÉJÀ dispo
-- (groupes extérieurs, cuivre, volumineux) pour les commandes qui attendent
-- les containers, puis compléter / expédier le reste à réception.
--
-- Règles :
--  1. Périmètre = lignes de CDC ouvertes (interne.v_couverture_stock_global)
--     à livrer d'ici la fin de l'horizon (retards compris).
--  2. Destinataire = le client pour une CDC départ FMS ; l'AGENCE pour une CDC
--     départ agence (palette de transfert multi-clients, préparation finie en
--     agence).
--  3. CDC départ agence : le stock de l'agence (+ son dépôt TRANSIT) sert
--     d'abord, par date de livraison puis ancienneté ; le reste est demandé à FMS.
--  4. Stock FMS libre (sto_qte − sto_prepa) servi dans le même ordre à toutes
--     les demandes FMS ; le manque est rattaché à la réception FMS qui le comble
--     (FIFO par référence, réceptions triées par date de dispo).
--  5. Date de dispo FMS d'une réception = date de RDV de déchargement saisie
--     (appro_cdf_rdv_fms, écran Portefeuille CDF ou ce plan). Container « CONT »
--     sans RDV : date inconnue, ou RDV SIMULÉ à ETA port + N jours ouvrés si la
--     simulation est cochée (affiché comme tel). Autre CDF : date retenue.
--  6. Palettes : volume BLG (longueur × largeur × hauteur ; unité déduite de la
--     dimension du milieu : > 2 = dm, > 20 = cm) / volume utile palette (1,3 m³,
--     repère : 18 murales RAK-VJ18 par palette), ou poids / poids max palette, le
--     plus grand des deux. Sans dimensions ni poids : médiane de la famille.
--  7. Catégories par destinataire :
--       COMPLET    tout est dispo à FMS                 → expédier
--       ANTICIPER  il manque des articles, mais le dispo contient un groupe
--                  extérieur ou fait au moins le seuil de palettes → envoi
--                  anticipé, puis complément à réception ;
--       ATTENDRE   dispo trop maigre → un seul envoi à réception ;
--       RECEPTION  rien de dispo → envoi à réception.
--  8. Planning : jours ouvrés à partir du 1er jour du plan, plafond de palettes
--     par jour, au plus un envoi par destinataire et par jour (un gros envoi
--     s'étale sur les jours suivants). Vague 1 = COMPLET + ANTICIPER par date de
--     livraison ; vague 2 = envois à réception des lignes dont la réception est
--     datée dans la fenêtre, à partir de la dernière date + délai de mise en stock.
--     Le reste (réception plus tardive, inconnue ou absente) = reliquat.
--
-- 05/11/2026 : RDV effectif = saisi dans le compagnon sinon lu dans SAGE (v_appro_cdf_rdv_fms_effectif),
-- buffer de 3 jours ouvrés réception → expédition inclus dans la date de dispo, destinataire FMS = client × lieu
-- de livraison (chez le pro / chaque chantier). Prérequis : 20261105b_rdv_fms_sage_lieu_livraison.sql.
--
-- Calcul matérialisé par refresh_plan_expedition_fms() (bouton « Recalculer »
-- de l'écran, rappelé après chaque saisie de RDV), lu par get_plan_expedition_fms()
-- et get_plan_expedition_fms_detail(). Accès réservé à Arnaud (plan_exp_autorise()).
-- ============================================================================

-- ─── Accès ───────────────────────────────────────────────────────────────────
create or replace function public.plan_exp_autorise()
returns boolean
language sql
stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email'), '') in ('a.valanchauskas@cegeclim-energies.com', 'valancha@gmail.com')
      or auth.jwt() is null   -- éditeur SQL / tâches planifiées
$$;
revoke all on function public.plan_exp_autorise() from public, anon;
grant execute on function public.plan_exp_autorise() to authenticated;

-- ─── Paramètres ─────────────────────────────────────────────────────────────
insert into public.appro_parametres (cle, valeur, description) values
  ('plan_exp_capacite_palettes_jour', 100, 'Plan d''expédition FMS : palettes préparées / expédiées par jour'),
  ('plan_exp_horizon_jours', 21, 'Plan d''expédition FMS : CDC à livrer d''ici N jours (retards compris)'),
  ('plan_exp_seuil_palettes_anticipation', 1, 'Plan d''expédition FMS : palettes dispo à partir desquelles un envoi anticipé vaut le coup (sans groupe extérieur)'),
  ('plan_exp_delai_mise_en_stock_jours', 1, 'Plan d''expédition FMS : jours ouvrés entre le RDV de déchargement et la première expédition possible'),
  ('plan_exp_volume_utile_palette_m3', 1.3, 'Plan d''expédition FMS : volume utile d''une palette (repère Arnaud : 18 murales RAK-VJ18 de 0,072 m³ par palette)'),
  ('plan_exp_poids_max_palette_kg', 600, 'Plan d''expédition FMS : poids max d''une palette'),
  ('plan_exp_fenetre_jours_ouvres', 20, 'Plan d''expédition FMS : nombre de jours ouvrés planifiés')
on conflict (cle) do nothing;
update public.appro_parametres set valeur = 1.3,
  description = 'Plan d''expédition FMS : volume utile d''une palette (repère Arnaud : 18 murales RAK-VJ18 de 0,072 m³ par palette)'
where cle = 'plan_exp_volume_utile_palette_m3' and valeur = 1.2;

-- ─── Familles : groupes extérieurs et cuivre ────────────────────────────────
create table if not exists public.appro_plan_exp_familles (
  famille    text primary key,
  role       text not null check (role in ('GROUPE_EXT', 'CUIVRE', 'VOLUMINEUX')),
  updated_at timestamptz not null default now()
);
alter table public.appro_plan_exp_familles enable row level security;
drop policy if exists appro_plan_exp_familles_sel on public.appro_plan_exp_familles;
create policy appro_plan_exp_familles_sel on public.appro_plan_exp_familles for select to authenticated using (true);
drop policy if exists appro_plan_exp_familles_all on public.appro_plan_exp_familles;
create policy appro_plan_exp_familles_all on public.appro_plan_exp_familles for all to authenticated
  using (public.plan_exp_autorise()) with check (public.plan_exp_autorise());
grant select, insert, update, delete on public.appro_plan_exp_familles to authenticated;

insert into public.appro_plan_exp_familles (famille, role) values
  ('00RAMUE', 'GROUPE_EXT'), ('00RACUE', 'GROUPE_EXT'), ('00TRIPLCUE', 'GROUPE_EXT'),
  ('00DRVUE', 'GROUPE_EXT'), ('00RORASUE', 'GROUPE_EXT'), ('00YUTAMPUE', 'GROUPE_EXT'),
  ('00ROH2OUE', 'GROUPE_EXT'), ('00DODAIRAC', 'GROUPE_EXT'), ('00RORASM', 'GROUPE_EXT'),
  ('01COURONNE', 'CUIVRE'), ('01BARRE', 'CUIVRE')
on conflict (famille) do nothing;

-- ─── Tables de calcul (lecture uniquement via les RPC, recréées à chaque version) ───
drop table if exists public.appro_plan_exp_meta, public.appro_plan_exp_lignes, public.appro_plan_exp_unites,
  public.appro_plan_exp_envois, public.appro_plan_exp_receptions;

create table public.appro_plan_exp_meta (
  id          integer primary key default 1 check (id = 1),
  genere_le   timestamptz not null,
  genere_par  text,
  debut       date not null,
  fin_horizon date not null,
  fin_fenetre date not null,
  simuler_rdv boolean not null,
  parametres  jsonb not null
);

create table public.appro_plan_exp_lignes (
  ligne_id         uuid primary key,
  cle              text not null,          -- destinataire : C:<tiers> ou A:<agence>
  numero_document  text, numero_tiers text, nom_tiers text, representant text, agence_commerciale text,
  depot_expedition text, date_livraison date, date_creation date,
  reference_article text, designation text, famille text, famille_macro text, role_famille text,
  quantite numeric, montant_ht numeric,
  qte_agence numeric, qte_fms_dispo numeric, qte_attente numeric,
  numero_cdf text, container text, est_cont boolean,
  date_dispo date,                          -- date de dispo FMS retenue (RDV saisi, RDV simulé, date CDF)
  rdv_simule boolean, sans_reception boolean,
  dans_vague boolean,                       -- manque comblé par une réception datée dans la fenêtre planifiée
  vol_unitaire numeric, poids_unitaire numeric, dim_manquante boolean,
  palettes_dispo numeric, palettes_attente numeric,
  statut text,                              -- AGENCE | FMS_DISPO | PARTIEL | ATTENTE
  lieu_type text, lieu_sage text, lieu_cle text, lieu_libelle text, chantier text,
  palette_unitaire numeric, regle_palette text, -- fraction de palette par unité, règle appliquée
  cp_livraison text, ville_livraison text
);
create index appro_plan_exp_lignes_cle_idx on public.appro_plan_exp_lignes (cle);
create index appro_plan_exp_lignes_cdf_idx on public.appro_plan_exp_lignes (numero_cdf);

create table public.appro_plan_exp_unites (
  cle text primary key,
  type_destinataire text not null,          -- CLIENT | AGENCE
  libelle text, numero_tiers text, agence text,
  nb_cdc integer, nb_lignes integer, montant_ht numeric, date_livraison_min date,
  nb_lignes_dispo integer, nb_lignes_attente integer, nb_lignes_vague integer, nb_lignes_reliquat integer,
  palettes_dispo numeric, palettes_attente numeric, palettes_vague numeric, poids_dispo numeric,
  nb_groupes_ext_dispo numeric, nb_groupes_ext_attente numeric, cuivre_dispo boolean, dim_manquante boolean,
  date_complete_vague date, rdv_simule boolean, date_inconnue boolean, sans_reception boolean,
  containers text[], categorie text,
  anticipation_debut date, anticipation_fin date, anticipation_palettes integer,
  reception_debut date, reception_fin date, reception_palettes integer, reception_type text,
  cp_livraison text, ville_livraison text
);

create table public.appro_plan_exp_envois (
  id serial primary key,
  jour date not null, cle text not null,
  vague text not null,                      -- ANTICIPATION (dispo maintenant) | RECEPTION (après containers)
  type_envoi text not null,                 -- COMPLET | ANTICIPATION | COMPLEMENT | UNIQUE
  palettes integer not null, partie integer not null default 1, nb_parties integer not null default 1
);

create table public.appro_plan_exp_receptions (
  numero_cdf text primary key,
  fournisseur text, est_cont boolean, container text, navire text, eta_port date, statut_suivi text,
  rdv_date date, rdv_heure time, rdv_simule boolean, date_reception_sage date, date_dispo date,
  nb_refs integer, qte numeric, palettes numeric,
  nb_lignes_cdc integer, nb_destinataires integer, qte_cdc numeric
);

do $$ declare t text; begin
  foreach t in array array['appro_plan_exp_meta','appro_plan_exp_lignes','appro_plan_exp_unites','appro_plan_exp_envois','appro_plan_exp_receptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ─── Utilitaires ─────────────────────────────────────────────────────────────
create or replace function public.plan_exp_depot_cle(p text)
returns text language sql immutable as $$
  select nullif(replace(btrim(regexp_replace(replace(upper(coalesce(p, '')), 'CEGECLIM', ''), '^\s*TRANSIT\s+', '')), 'LA ROCHELLE', 'LAROCHELLE'), '')
$$;

-- Volume en m³ d'après les dimensions BLG : saisies en m, parfois 10 fois trop grandes
-- sur tout l'article (ex. RAK-DJ saisies 8 200 × 3 300 × 2 600 mm au lieu de 820 × 330 × 260).
-- L'unité est déduite de la dimension du MILIEU (un vrai carton n'a jamais deux côtés > 2 m) :
-- > 20 = cm, > 2 = dm ; un rail de 3,65 m reste en m. Fiches bouche-trou (0,001 m) ignorées.
drop function if exists public.plan_exp_dim_m(numeric);
drop function if exists public.plan_exp_dim_m(double precision);
create or replace function public.plan_exp_vol_m3(l double precision, w double precision, h double precision)
returns numeric language sql immutable as $$
  select case
    when coalesce(l, 0) <= 0 or coalesce(w, 0) <= 0 or coalesce(h, 0) <= 0 then null
    when greatest(l, w, h) < 0.02 then null
    else (l * w * h)::numeric * case when (l + w + h - greatest(l, w, h) - least(l, w, h)) > 20 then 0.000001
                                     when (l + w + h - greatest(l, w, h) - least(l, w, h)) > 2 then 0.001 else 1 end
  end
$$;

-- jour ouvré + n (lundi–vendredi ; un samedi / dimanche de départ compte comme le lundi)
create or replace function public.plan_exp_jour_ouvre(p date, n integer)
returns date language plpgsql immutable as $$
declare d date := p; k integer := 0;
begin
  while extract(isodow from d) > 5 loop d := d + 1; end loop;
  while k < n loop
    d := d + 1;
    if extract(isodow from d) <= 5 then k := k + 1; end if;
  end loop;
  return d;
end $$;

insert into public.appro_parametres (cle, valeur, description) values
  ('plan_exp_rdv_simule_jours_apres_eta', 5, 'Plan d''expédition FMS : container sans RDV saisi, RDV simulé N jours ouvrés après l''ETA port (si la simulation est activée)')
on conflict (cle) do nothing;

-- ─── Calcul ──────────────────────────────────────────────────────────────────
drop function if exists public.refresh_plan_expedition_fms(date, integer);
create or replace function public.refresh_plan_expedition_fms(p_debut date default null, p_horizon_jours integer default null, p_simuler_rdv boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, sage, interne
set statement_timeout = '120s'
as $$
declare
  v_auj date := (now() at time zone 'Europe/Paris')::date;
  v_debut date;
  v_horizon integer := coalesce(p_horizon_jours, (select valeur from appro_parametres where cle = 'plan_exp_horizon_jours')::int, 21);
  v_cap integer := coalesce((select valeur from appro_parametres where cle = 'plan_exp_capacite_palettes_jour')::int, 100);
  v_seuil numeric := coalesce((select valeur from appro_parametres where cle = 'plan_exp_seuil_palettes_anticipation'), 1);
  v_delai integer := coalesce((select valeur from appro_parametres where cle = 'plan_exp_delai_mise_en_stock_jours')::int, 1);
  v_vol_pal numeric := coalesce((select valeur from appro_parametres where cle = 'plan_exp_volume_utile_palette_m3'), 1.3);
  v_poids_pal numeric := coalesce((select valeur from appro_parametres where cle = 'plan_exp_poids_max_palette_kg'), 600);
  v_fenetre integer := coalesce((select valeur from appro_parametres where cle = 'plan_exp_fenetre_jours_ouvres')::int, 20);
  v_sim_jours integer := coalesce((select valeur from appro_parametres where cle = 'plan_exp_rdv_simule_jours_apres_eta')::int, 5);
  v_fin date;
  v_fin_fenetre date;
  v_jours date[];
  v_charge integer[];
  v_parts date[];
  v_pals integer[];
  u record;
  i integer;
  n_part integer;
  v_reste integer;
  v_prise integer;
  v_min date;
begin
  if not plan_exp_autorise() then raise exception 'Accès réservé'; end if;

  v_debut := coalesce(p_debut, plan_exp_jour_ouvre(v_auj, 1));
  v_debut := plan_exp_jour_ouvre(v_debut, 0);
  v_fin := v_debut + v_horizon;
  v_jours := array(select plan_exp_jour_ouvre(v_debut, g.n) from generate_series(0, v_fenetre - 1) as g(n));
  v_fin_fenetre := v_jours[v_fenetre];

  -- 1. Lignes de CDC dans l'horizon (retards compris)
  create temp table _l on commit drop as
  select g.id as ligne_id, g.numero_document, g.numero_tiers, g.nom_tiers, g.representant, g.agence as agence_commerciale,
         g.date_livraison, g.date_creation_document as date_creation, g.reference_article, g.designation_article as designation,
         g.famille, g.famille_macro, f.role as role_famille,
         greatest(coalesce(g.quantite, 0), 0) as quantite, g.montant_ht,
         upper(btrim(coalesce(a.depot, 'FMS'))) as depot_brut,
         plan_exp_depot_cle(coalesce(a.depot, 'FMS')) as depot_cle,
         nullif(btrim(e.reference), '') as chantier,
         nullif(btrim(e.lieu_livraison), '') as lieu_libelle,
         -- lieu de livraison SAGE = nom du client → chez le pro, sinon → chantier
         case when e.lieu_livraison is null or upper(btrim(e.lieu_livraison)) = upper(btrim(coalesce(e.intitule_tiers, g.nom_tiers))) then 'PRO' else 'CHANTIER' end as lieu_sage,
         lv.livraison_type as lieu_force
  from interne.v_couverture_stock_global g
  join activite_lignes a on a.id = g.id
  left join appro_plan_exp_familles f on f.famille = g.famille
  left join activite_entete e on e.numero_piece = g.numero_document
  left join lateral (select x.livraison_type from appro_plan_exp_actions x
                     where x.numero_document = g.numero_document and x.type_action = 'LIVRAISON' and x.statut <> 'ANNULE'
                     order by x.created_at desc, x.id desc limit 1) lv on true
  where g.date_livraison <= v_fin and coalesce(g.quantite, 0) > 0;

  -- 2. Stock libre par dépôt (agence + son TRANSIT) et CDF livrées en direct en agence
  create temp table _stk on commit drop as
  select plan_exp_depot_cle(s.sto_dep) as depot_cle, upper(btrim(s.sto_art_num)) as ref,
         sum(greatest(coalesce(s.sto_qte, 0) - coalesce(s.sto_prepa, 0), 0)) as qte
  from sage.stock_depot s
  where upper(btrim(s.sto_dep)) <> 'TRANSIT FMS'
  group by 1, 2;

  insert into _stk
  select plan_exp_depot_cle(r.depot_reception), upper(btrim(r.reference_article)), sum(r.quantite_attendue)
  from v_couverture_stock_receptions r
  where plan_exp_depot_cle(r.depot_reception) is not null and plan_exp_depot_cle(r.depot_reception) <> 'FMS'
    and r.date_reception_retenue <= v_fin + 30
  group by 1, 2;

  create temp table _l2 on commit drop as
  with x as (
    select l.*,
           coalesce(sum(l.quantite) over (partition by l.depot_cle, upper(btrim(l.reference_article))
             order by l.date_livraison, l.date_creation, l.ligne_id rows between unbounded preceding and 1 preceding), 0) as cum_avant
    from _l l
  )
  select x.*,
         case when x.depot_cle = 'FMS' then 0
              else least(x.quantite, greatest(coalesce(s.qte, 0) - x.cum_avant, 0)) end as qte_agence
  from x
  left join (select depot_cle, ref, sum(qte) as qte from _stk group by 1, 2) s
    on s.depot_cle = x.depot_cle and s.ref = upper(btrim(x.reference_article)) and x.depot_cle <> 'FMS';

  -- 3. Stock FMS libre servi à toutes les demandes FMS (date de livraison puis ancienneté)
  create temp table _l3 on commit drop as
  with x as (
    select l.*, l.quantite - l.qte_agence as besoin_fms,
           coalesce(sum(l.quantite - l.qte_agence) over (partition by upper(btrim(l.reference_article))
             order by l.date_livraison, l.date_creation, l.ligne_id rows between unbounded preceding and 1 preceding), 0) as cum_fms_avant
    from _l2 l
  )
  select x.*,
         least(x.besoin_fms, greatest(coalesce(s.qte, 0) - x.cum_fms_avant, 0)) as qte_fms_dispo
  from x
  left join (select ref, sum(qte) as qte from _stk where depot_cle = 'FMS' group by 1) s on s.ref = upper(btrim(x.reference_article));

  -- 4. Réceptions FMS : date de dispo = RDV saisi ; container sans RDV = inconnue
  --    (ou RDV simulé à ETA + N jours ouvrés) ; autre CDF = date retenue
  create temp table _rec on commit drop as
  with cdf as (
    select b.al_docnum as numero_cdf, bool_or(b.al_doref ilike 'CONT%') as est_cont, max(b.al_ctnum) as fournisseur_code,
           max(nullif(btrim(b.al_doref), '')) as reference_cdf
    from sage.bdcf b where b.al_doctype = '12' group by 1
  ),
  rel as (
    select distinct on (cdf_numero) cdf_numero, container_numero, navire, eta_port, statut
    from appro_container_releves order by cdf_numero, created_at desc, id desc
  ),
  r as (
    select v.*, c.reference_cdf, coalesce(c.est_cont, false) as est_cont, coalesce(t.ti_intitule, v.nom_fournisseur) as fournisseur,
           coalesce(rel.container_numero, rdv.container_numero) as container, rel.navire, rel.eta_port, rel.statut as statut_suivi,
           rdv.rdv_date, rdv.rdv_heure,
           (rdv.rdv_date is null and coalesce(c.est_cont, false) and p_simuler_rdv and rel.eta_port is not null) as rdv_simule,
           rdv.source as rdv_source,
           case when rdv.rdv_date is not null then rdv.rdv_date
                when coalesce(c.est_cont, false) then
                  case when p_simuler_rdv and rel.eta_port is not null then plan_exp_jour_ouvre(greatest(rel.eta_port, v_auj), v_sim_jours) end
                else v.date_reception_retenue end as rdv_retenu,
           -- dispo à l'expédition = réception (RDV) + buffer en jours ouvrés, jamais avant aujourd'hui
           case when rdv.rdv_date is not null then greatest(plan_exp_jour_ouvre(rdv.rdv_date, v_delai), v_auj)
                when coalesce(c.est_cont, false) then
                  case when p_simuler_rdv and rel.eta_port is not null then plan_exp_jour_ouvre(plan_exp_jour_ouvre(greatest(rel.eta_port, v_auj), v_sim_jours), v_delai) end
                else greatest(plan_exp_jour_ouvre(v.date_reception_retenue, v_delai), v_auj) end as date_dispo
    from v_couverture_stock_receptions v
    left join cdf c on c.numero_cdf = v.numero_cdf
    left join sage.tiers t on t.ti_num = c.fournisseur_code
    left join rel on rel.cdf_numero = v.numero_cdf
    left join v_appro_cdf_rdv_fms_effectif rdv on rdv.cdf_numero = v.numero_cdf
    where plan_exp_depot_cle(coalesce(v.depot_reception, 'FMS')) = 'FMS'
  )
  select r.*,
         coalesce(sum(r.quantite_attendue) over w_avant, 0) as cum_avant,
         sum(r.quantite_attendue) over w_fin as cum_fin
  from r
  window w_avant as (partition by upper(btrim(r.reference_article)) order by coalesce(r.date_dispo, r.date_reception_retenue), r.numero_cdf, r.ligne_cdf_id rows between unbounded preceding and 1 preceding),
         w_fin   as (partition by upper(btrim(r.reference_article)) order by coalesce(r.date_dispo, r.date_reception_retenue), r.numero_cdf, r.ligne_cdf_id rows between unbounded preceding and current row);

  -- 5. Manque rattaché à la réception qui le comble (FIFO par référence)
  create temp table _l4 on commit drop as
  with x as (
    select l.*, l.besoin_fms - l.qte_fms_dispo as qte_attente,
           sum(l.besoin_fms - l.qte_fms_dispo) over (partition by upper(btrim(l.reference_article))
             order by l.date_livraison, l.date_creation, l.ligne_id rows between unbounded preceding and current row) as cum_manque_fin
    from _l3 l
  )
  select x.*, r.numero_cdf, r.container, coalesce(r.est_cont, false) as est_cont, r.date_dispo,
         coalesce(r.rdv_simule, false) as rdv_simule,
         (x.qte_attente > 0 and r.numero_cdf is null) as sans_reception
  from x
  left join lateral (
    select r.* from _rec r
    where x.qte_attente > 0
      and upper(btrim(r.reference_article)) = upper(btrim(x.reference_article))
      and r.cum_fin >= x.cum_manque_fin
    order by r.cum_fin limit 1
  ) r on true;

  -- 6. Dimensions BLG
  create temp table _dim on commit drop as
  select distinct on (k.cle) k.cle,
         plan_exp_vol_m3(p.length, p.width, p.height) as vol,
         case when p.weight > 0.05 then p.weight::numeric end as poids
  from v_appro_article_blg_cles k
  join blg.article_part p on p.id = k.part_id
  order by k.cle, (k.appariement_via = 'reference') desc;

  -- Références sans dimensions ni poids dans BLG : médiane de leur famille (signalé « dim. estimée »)
  create temp table _fam on commit drop as
  select x.famille,
         percentile_cont(0.5) within group (order by d.vol)::numeric as vol,
         percentile_cont(0.5) within group (order by d.poids)::numeric as poids
  from (select distinct famille, upper(btrim(reference_article)) as ref from _l) x
  join _dim d on d.cle = x.ref
  group by x.famille;

  delete from appro_plan_exp_lignes where true;
  insert into appro_plan_exp_lignes
  select l.ligne_id,
         -- départ FMS : un destinataire par client ET par lieu de livraison (chez le pro, ou chaque chantier)
         case when l.depot_cle = 'FMS' then 'C:' || coalesce(l.numero_tiers, '?')
                || case when coalesce(l.lieu_force, l.lieu_sage) = 'CHANTIER'
                        then '|' || coalesce(case when l.lieu_sage = 'CHANTIER' then left(regexp_replace(upper(l.lieu_libelle), '[^A-Z0-9]', '', 'g'), 60) end, l.numero_document)
                        else '' end
              else 'A:' || l.depot_cle end,
         l.numero_document, l.numero_tiers, l.nom_tiers, l.representant, l.agence_commerciale,
         l.depot_brut, l.date_livraison, l.date_creation, l.reference_article, l.designation, l.famille, l.famille_macro, l.role_famille,
         l.quantite, l.montant_ht, l.qte_agence, l.qte_fms_dispo, l.qte_attente,
         l.numero_cdf, l.container, l.est_cont, l.date_dispo, l.rdv_simule, l.sans_reception,
         (l.qte_attente > 0 and l.date_dispo is not null and l.date_dispo <= v_fin_fenetre),
         coalesce(d.vol, f.vol), coalesce(d.poids, f.poids), (d.vol is null and d.poids is null),
         pu.pu * l.qte_fms_dispo,
         pu.pu * l.qte_attente,
         case when l.qte_agence >= l.quantite then 'AGENCE'
              when l.qte_attente <= 0 then 'FMS_DISPO'
              when l.qte_fms_dispo > 0 then 'PARTIEL'
              else 'ATTENTE' end,
         coalesce(l.lieu_force, l.lieu_sage), l.lieu_sage,
         case when coalesce(l.lieu_force, l.lieu_sage) = 'CHANTIER'
              then coalesce(case when l.lieu_sage = 'CHANTIER' then left(regexp_replace(upper(l.lieu_libelle), '[^A-Z0-9]', '', 'g'), 60) end, l.numero_document)
              else 'PRO' end,
         l.lieu_libelle, l.chantier, pu.pu, pu.regle, cp.cp, cp.ville
  from _l4 l
  left join _dim d on d.cle = upper(btrim(l.reference_article))
  left join _fam f on f.famille = l.famille and d.vol is null and d.poids is null
  -- palettes par unité : règle fixe (ECS, GE R/O, GE R/R…) sinon volume / poids
  cross join lateral (
    select coalesce(1.0 / nullif(r.unites_par_palette, 0),
                    greatest(coalesce(d.vol, f.vol, 0) / v_vol_pal, coalesce(d.poids, f.poids, 0) / v_poids_pal)) as pu,
           r.libelle as regle
    from (select 1) z
    left join lateral (
      select x.unites_par_palette, x.libelle from appro_plan_exp_palettisation x
      where (x.type_regle = 'PREFIXE' and upper(btrim(l.reference_article)) like upper(x.valeur) || '%')
         or (x.type_regle = 'FAMILLE' and x.valeur = l.famille)
      order by (x.type_regle = 'PREFIXE') desc, length(x.valeur) desc
      limit 1
    ) r on true
  ) pu
  -- code postal / ville de livraison : chez le pro → adresse du client ; chantier → fin de l'adresse du lieu de livraison
  left join activite_entete ee on ee.numero_piece = l.numero_document
  cross join lateral (
    select substring(a.v from '^(\d{5})') as cp,
           nullif(regexp_replace(btrim(substring(a.v from '^\d{5}\s*(.*)$')), '\s+', ' ', 'g'), '') as ville
    from (select case when coalesce(l.lieu_force, l.lieu_sage) = 'PRO'
                      then substring(btrim(ee.cp_ville) from '^(\d{5}.*)$')
                      else coalesce(substring(ee.lieu_livraison from '.*\m(\d{5}\s+[^,0-9]+?)\s*$'),
                                    substring(ee.lieu_livraison from '.*\m(\d{5})\M')) end as v) a
  ) cp;

  -- 7. Destinataires (seules les lignes qui passent par FMS)
  delete from appro_plan_exp_unites where true;
  insert into appro_plan_exp_unites (cle, type_destinataire, libelle, numero_tiers, agence,
    nb_cdc, nb_lignes, montant_ht, date_livraison_min, nb_lignes_dispo, nb_lignes_attente, nb_lignes_vague, nb_lignes_reliquat,
    palettes_dispo, palettes_attente, palettes_vague, poids_dispo, nb_groupes_ext_dispo, nb_groupes_ext_attente, cuivre_dispo, dim_manquante,
    date_complete_vague, rdv_simule, date_inconnue, sans_reception, containers, categorie)
  select l.cle,
         case when l.cle like 'C:%' then 'CLIENT' else 'AGENCE' end,
         case when l.cle like 'C:%|%' then max(l.nom_tiers) || ' · chantier ' || coalesce(max(l.chantier), max(l.lieu_libelle), '')
              when l.cle like 'C:%' then max(l.nom_tiers) else 'Transfert ' || substr(l.cle, 3) end,
         case when l.cle like 'C:%' then max(l.numero_tiers) end,
         case when l.cle like 'C:%' then max(l.agence_commerciale) else substr(l.cle, 3) end,
         count(distinct l.numero_document), count(*), sum(l.montant_ht), min(l.date_livraison),
         count(*) filter (where l.qte_fms_dispo > 0), count(*) filter (where l.qte_attente > 0),
         count(*) filter (where l.dans_vague), count(*) filter (where l.qte_attente > 0 and not l.dans_vague),
         round(sum(l.palettes_dispo), 2), round(sum(l.palettes_attente), 2),
         round(coalesce(sum(l.palettes_attente) filter (where l.dans_vague), 0), 2),
         round(sum(coalesce(l.poids_unitaire, 0) * l.qte_fms_dispo), 0),
         coalesce(sum(l.qte_fms_dispo) filter (where l.role_famille = 'GROUPE_EXT'), 0),
         coalesce(sum(l.qte_attente) filter (where l.role_famille = 'GROUPE_EXT'), 0),
         coalesce(bool_or(l.role_famille = 'CUIVRE' and l.qte_fms_dispo > 0), false),
         coalesce(bool_or(l.dim_manquante and (l.qte_fms_dispo > 0 or l.qte_attente > 0)), false),
         max(l.date_dispo) filter (where l.dans_vague),
         coalesce(bool_or(l.dans_vague and l.rdv_simule), false),
         coalesce(bool_or(l.qte_attente > 0 and l.date_dispo is null and not l.sans_reception), false),
         coalesce(bool_or(l.sans_reception), false),
         array_remove(array_agg(distinct coalesce(l.container, l.numero_cdf)) filter (where l.qte_attente > 0), null),
         null
  from appro_plan_exp_lignes l
  where l.statut <> 'AGENCE'
  group by l.cle;

  -- code postal de livraison du destinataire client (le plus fréquent de ses lignes)
  update appro_plan_exp_unites un set cp_livraison = split_part(x.k, '|', 1), ville_livraison = nullif(split_part(x.k, '|', 2), '')
  from (select cle, mode() within group (order by cp_livraison || '|' || coalesce(ville_livraison, '')) as k
        from appro_plan_exp_lignes where cp_livraison is not null group by cle) x
  where un.cle = x.cle and un.type_destinataire = 'CLIENT';

  update appro_plan_exp_unites set categorie = case
      when nb_lignes_attente = 0 then 'COMPLET'
      when nb_lignes_dispo = 0 then 'RECEPTION'
      when nb_groupes_ext_dispo > 0 or palettes_dispo >= v_seuil then 'ANTICIPER'
      else 'ATTENDRE' end
  where true;

  -- 8. Planning : jours ouvrés, plafond de palettes par jour, au plus un envoi par
  --    destinataire et par jour ; un envoi plus gros que la place restante est
  --    étalé sur les jours suivants.
  delete from appro_plan_exp_envois where true;
  v_charge := array_fill(0, array[v_fenetre]);

  -- 8a. Vague 1 — dès maintenant : COMPLET (tout) et ANTICIPER (partie dispo)
  for u in
    select * from appro_plan_exp_unites where categorie in ('COMPLET', 'ANTICIPER')
    order by date_livraison_min nulls last, palettes_dispo desc
  loop
    v_reste := greatest(ceil(u.palettes_dispo), 1);
    v_parts := '{}'; v_pals := '{}';
    for i in 1 .. v_fenetre loop
      exit when v_reste <= 0;
      v_prise := least(v_reste, v_cap - v_charge[i]);
      continue when v_prise <= 0;
      v_charge[i] := v_charge[i] + v_prise;
      v_reste := v_reste - v_prise;
      v_parts := v_parts || v_jours[i]; v_pals := v_pals || v_prise;
    end loop;
    for n_part in 1 .. coalesce(array_length(v_parts, 1), 0) loop
      insert into appro_plan_exp_envois (jour, cle, vague, type_envoi, palettes, partie, nb_parties)
      values (v_parts[n_part], u.cle, 'ANTICIPATION', case when u.categorie = 'COMPLET' then 'COMPLET' else 'ANTICIPATION' end,
              v_pals[n_part], n_part, array_length(v_parts, 1));
    end loop;
  end loop;

  -- 8b. Vague 2 — à réception : complément (ANTICIPER) ou envoi unique (ATTENDRE, RECEPTION),
  --     limité aux lignes dont la réception est datée dans la fenêtre ; à partir de la dernière
  --     de ces dates + délai de mise en stock, jamais le même jour qu'un envoi de vague 1.
  for u in
    select * from appro_plan_exp_unites
    where categorie in ('ANTICIPER', 'ATTENDRE', 'RECEPTION') and nb_lignes_vague > 0 and date_complete_vague is not null
    order by date_complete_vague, date_livraison_min nulls last
  loop
    v_min := u.date_complete_vague;  -- buffer réception → expédition déjà inclus dans la date de dispo
    v_reste := greatest(ceil(case when u.categorie = 'ANTICIPER' then u.palettes_vague else u.palettes_dispo + u.palettes_vague end), 1);
    v_parts := '{}'; v_pals := '{}';
    for i in 1 .. v_fenetre loop
      exit when v_reste <= 0;
      continue when v_jours[i] < v_min
        or exists (select 1 from appro_plan_exp_envois e where e.cle = u.cle and e.jour >= v_jours[i]);
      v_prise := least(v_reste, v_cap - v_charge[i]);
      continue when v_prise <= 0;
      v_charge[i] := v_charge[i] + v_prise;
      v_reste := v_reste - v_prise;
      v_parts := v_parts || v_jours[i]; v_pals := v_pals || v_prise;
    end loop;
    for n_part in 1 .. coalesce(array_length(v_parts, 1), 0) loop
      insert into appro_plan_exp_envois (jour, cle, vague, type_envoi, palettes, partie, nb_parties)
      values (v_parts[n_part], u.cle, 'RECEPTION', case when u.categorie = 'ANTICIPER' then 'COMPLEMENT' else 'UNIQUE' end,
              v_pals[n_part], n_part, array_length(v_parts, 1));
    end loop;
  end loop;

  update appro_plan_exp_unites un set
    anticipation_debut = a.debut, anticipation_fin = a.fin, anticipation_palettes = a.pal,
    reception_debut = r.debut, reception_fin = r.fin, reception_palettes = r.pal, reception_type = r.typ
  from appro_plan_exp_unites x
  left join lateral (select min(jour) debut, max(jour) fin, sum(palettes)::int pal from appro_plan_exp_envois e where e.cle = x.cle and e.vague = 'ANTICIPATION') a on true
  left join lateral (select min(jour) debut, max(jour) fin, sum(palettes)::int pal, max(type_envoi) typ from appro_plan_exp_envois e where e.cle = x.cle and e.vague = 'RECEPTION') r on true
  where un.cle = x.cle;

  -- 9. Réceptions FMS attendues (containers et autres CDF)
  delete from appro_plan_exp_receptions where true;
  insert into appro_plan_exp_receptions
  select r.numero_cdf, max(r.fournisseur), bool_or(r.est_cont), max(r.container), max(r.navire), max(r.eta_port), max(r.statut_suivi),
         max(r.rdv_date), max(r.rdv_heure), bool_or(r.rdv_simule), min(r.date_reception_retenue), max(r.date_dispo),
         count(distinct r.reference_article), sum(r.quantite_attendue),
         round(sum(r.quantite_attendue * coalesce(pr.pu, greatest(coalesce(d.vol, 0) / v_vol_pal, coalesce(d.poids, 0) / v_poids_pal))), 1),
         (select count(*) from appro_plan_exp_lignes l where l.numero_cdf = r.numero_cdf and l.qte_attente > 0),
         (select count(distinct l.cle) from appro_plan_exp_lignes l where l.numero_cdf = r.numero_cdf and l.qte_attente > 0),
         (select sum(l.qte_attente) from appro_plan_exp_lignes l where l.numero_cdf = r.numero_cdf and l.qte_attente > 0),
         max(r.rdv_source),
         (select count(distinct l.numero_document) from appro_plan_exp_lignes l where l.numero_cdf = r.numero_cdf and l.qte_attente > 0),
         max(r.rdv_retenu), max(r.reference_cdf)
  from _rec r
  left join _dim d on d.cle = upper(btrim(r.reference_article))
  left join lateral (  -- règle de palettisation (préfixe de référence, sinon famille SAGE de l'article)
    select 1.0 / x.unites_par_palette as pu from appro_plan_exp_palettisation x
    where (x.type_regle = 'PREFIXE' and upper(btrim(r.reference_article)) like upper(x.valeur) || '%')
       or (x.type_regle = 'FAMILLE' and x.valeur = (select max(sa.art_facodefamille) from sage.articles sa
                                                    where upper(btrim(sa.art_num)) = upper(btrim(r.reference_article))))
    order by (x.type_regle = 'PREFIXE') desc, length(x.valeur) desc
    limit 1
  ) pr on true
  where (r.est_cont and coalesce(r.date_dispo, r.eta_port, r.date_reception_retenue) <= v_fin_fenetre + 30)
     or coalesce(r.date_dispo, r.date_reception_retenue) <= v_fin_fenetre
     or exists (select 1 from appro_plan_exp_lignes l where l.numero_cdf = r.numero_cdf)
  group by r.numero_cdf;

  insert into appro_plan_exp_meta (id, genere_le, genere_par, debut, fin_horizon, fin_fenetre, simuler_rdv, parametres)
  values (1, now(), auth.jwt() ->> 'email', v_debut, v_fin, v_fin_fenetre, p_simuler_rdv, jsonb_build_object(
    'horizon_jours', v_horizon, 'capacite_palettes_jour', v_cap, 'seuil_palettes_anticipation', v_seuil,
    'delai_mise_en_stock_jours', v_delai, 'volume_utile_palette_m3', v_vol_pal, 'poids_max_palette_kg', v_poids_pal,
    'fenetre_jours_ouvres', v_fenetre, 'rdv_simule_jours_apres_eta', v_sim_jours))
  on conflict (id) do update set genere_le = excluded.genere_le, genere_par = excluded.genere_par,
    debut = excluded.debut, fin_horizon = excluded.fin_horizon, fin_fenetre = excluded.fin_fenetre,
    simuler_rdv = excluded.simuler_rdv, parametres = excluded.parametres;

  return public.get_plan_expedition_fms();
end $$;

revoke all on function public.refresh_plan_expedition_fms(date, integer, boolean) from public, anon;
grant execute on function public.refresh_plan_expedition_fms(date, integer, boolean) to authenticated;

-- ─── Lecture ─────────────────────────────────────────────────────────────────
create or replace function public.get_plan_expedition_fms()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not plan_exp_autorise() then raise exception 'Accès réservé'; end if;
  return jsonb_build_object(
    'meta', (select to_jsonb(m) from appro_plan_exp_meta m where id = 1),
    'unites', coalesce((select jsonb_agg(to_jsonb(u) order by u.date_livraison_min nulls last, u.cle) from appro_plan_exp_unites u), '[]'::jsonb),
    'envois', coalesce((select jsonb_agg(jsonb_build_object('jour', e.jour, 'cle', e.cle, 'vague', e.vague, 'type_envoi', e.type_envoi,
                          'palettes', e.palettes, 'partie', e.partie, 'nb_parties', e.nb_parties) order by e.jour, e.id) from appro_plan_exp_envois e), '[]'::jsonb),
    'receptions', coalesce((select jsonb_agg(to_jsonb(r) order by coalesce(r.date_dispo, r.eta_port, r.date_reception_sage) nulls last, r.numero_cdf) from appro_plan_exp_receptions r), '[]'::jsonb),
    'familles', coalesce((select jsonb_agg(jsonb_build_object('famille', f.famille, 'role', f.role) order by f.role, f.famille) from appro_plan_exp_familles f), '[]'::jsonb)
  );
end $$;

create or replace function public.get_plan_expedition_fms_detail(p_cle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not plan_exp_autorise() then raise exception 'Accès réservé'; end if;
  return coalesce((select jsonb_agg(to_jsonb(l) order by l.date_livraison, l.numero_document, l.reference_article)
                   from appro_plan_exp_lignes l where l.cle = p_cle and l.statut <> 'AGENCE'), '[]'::jsonb);
end $$;

-- Lignes d'une agence ou de tout le plan (export Excel)
create or replace function public.get_plan_expedition_fms_lignes(p_agence text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not plan_exp_autorise() then raise exception 'Accès réservé'; end if;
  return coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object('categorie', u.categorie, 'libelle', u.libelle,
                     'agence', u.agence, 'anticipation_debut', u.anticipation_debut, 'reception_debut', u.reception_debut)
                   order by u.agence, u.libelle, l.date_livraison, l.numero_document)
                   from appro_plan_exp_lignes l join appro_plan_exp_unites u on u.cle = l.cle
                   where l.statut <> 'AGENCE' and (p_agence is null or u.agence = p_agence)), '[]'::jsonb);
end $$;

revoke all on function public.get_plan_expedition_fms() from public, anon;
revoke all on function public.get_plan_expedition_fms_detail(text) from public, anon;
revoke all on function public.get_plan_expedition_fms_lignes(text) from public, anon;
grant execute on function public.get_plan_expedition_fms() to authenticated;
grant execute on function public.get_plan_expedition_fms_detail(text) to authenticated;
grant execute on function public.get_plan_expedition_fms_lignes(text) to authenticated;
