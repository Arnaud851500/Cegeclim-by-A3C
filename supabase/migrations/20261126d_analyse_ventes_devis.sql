-- ============================================================================
-- 20261126d_analyse_ventes_devis.sql — « Analyse des ventes & devis » (Mon activité)
-- ----------------------------------------------------------------------------
-- Demande de Michaël G. (26/11/2026) relayée par Arnaud : sortir rapidement, pour
-- un ou plusieurs clients et une période, le CA par catégorie (famille macro /
-- famille) et par article, en quantité et en valeur HT, avec export Excel — et
-- la même lecture sur les devis (références / familles les plus devisées et les
-- mieux transformées).
--
-- Construit sur le moteur du Requêteur (Admin) : catalogue de champs métier,
-- filtres validés côté serveur (public.requeteur_condition), alerte de requête
-- lourde. Ajouts :
--   - un choix du niveau de lecture : « Regrouper par » (dimensions) + « Mesures »
--     (agrégats du catalogue) + Top N, avec sous-totaux (ROLLUP) ;
--   - quatre sources choisies dès le départ (règle d'Arnaud) :
--       factures  = lignes de factures, lues à la date de facture ;
--       bl        = lignes de BL (BL facturés + BL / retours non facturés), date du BL ;
--       cdc       = lignes de commandes clients (CDC en cours + parties déjà livrées
--                   ou facturées), date de la CDC — même règle que l'Activité
--                   quotidienne : les lignes livrées / facturées d'une CDC encore
--                   présente en « Bon de commande » ne sont pas recomptées ;
--       devis     = lignes de devis avec leur transformation (n° de devis repris
--                   sur une ligne de CDC / BL / facture pour la même référence) ;
--   - famille macro ET famille disponibles en regroupement comme en filtre
--     (pas de table de correspondance : décision d'Arnaud) ;
--   - sélection de plusieurs clients (pas de notion de payeur pour l'instant).
--
-- Droits (gestion des accès, profils) :
--   - can_analyse_ventes : ouvre l'écran ;
--   - can_voir_marge     : affiche les mesures de marge (sinon retirées du
--                          catalogue ET refusées par le RPC).
-- Périmètre : le RLS des tables de lignes s'applique (vues security_invoker) et
-- le périmètre agences / collaborateurs de public.suivi_perimetre() est ajouté
-- par le RPC sur le représentant effectif (règle B pour les clients NON AFFECTE).
-- ============================================================================

-- ── 1. Droits ───────────────────────────────────────────────────────────────
alter table public.access_profiles  add column if not exists can_analyse_ventes boolean not null default false;
alter table public.access_profiles  add column if not exists can_voir_marge     boolean not null default false;
alter table public.user_page_access add column if not exists can_analyse_ventes boolean not null default false;
alter table public.user_page_access add column if not exists can_voir_marge     boolean not null default false;

create or replace function public.user_page_access_droits_depuis_profils()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
begin
  select
    coalesce(bool_or(p.can_dashboard), false)         as can_dashboard,
    coalesce(bool_or(p.can_territoire), false)        as can_territoire,
    coalesce(bool_or(p.can_cartographie), false)      as can_cartographie,
    coalesce(bool_or(p.can_clients), false)           as can_clients,
    coalesce(bool_or(p.can_carte), false)             as can_carte,
    coalesce(bool_or(p.can_todo), false)              as can_todo,
    coalesce(bool_or(p.can_clients_cegeclim), false)  as can_clients_cegeclim,
    coalesce(bool_or(p.can_suivi_prospects), false)   as can_suivi_prospects,
    coalesce(bool_or(p.can_agences), false)           as can_agences,
    coalesce(bool_or(p.can_autorisation), false)      as can_autorisation,
    coalesce(bool_or(p.can_documents), false)         as can_documents,
    coalesce(bool_or(p.can_stocks), false)            as can_stocks,
    coalesce(bool_or(p.can_activites), false)         as can_activites,
    coalesce(bool_or(p.can_change_scope), false)      as can_change_scope,
    coalesce(bool_or(p.can_objectifs), false)         as can_objectifs,
    coalesce(bool_or(p.can_suivi_agences), false)     as can_suivi_agences,
    coalesce(bool_or(p.can_financement), false)       as can_financement,
    coalesce(bool_or(p.can_allocation_airh2o), false) as can_allocation_airh2o,
    coalesce(bool_or(p.can_appro), false)             as can_appro,
    coalesce(bool_or(p.can_superuser), false)         as can_superuser,
    coalesce(bool_or(p.can_projetblg), false)         as can_projetblg,
    coalesce(bool_or(p.can_paiement), false)          as can_paiement,
    coalesce(bool_or(p.can_hotline), false)           as can_hotline,
    coalesce(bool_or(p.can_hotline_expert), false)    as can_hotline_expert,
    coalesce(bool_or(p.can_hotline_editeur), false)   as can_hotline_editeur,
    coalesce(bool_or(p.can_guides_blg), false)        as can_guides_blg,
    coalesce(bool_or(p.can_contrats_objectifs), false) as can_contrats_objectifs,
    coalesce(bool_or(p.can_analyse_ventes), false)    as can_analyse_ventes,
    coalesce(bool_or(p.can_voir_marge), false)        as can_voir_marge
  into r
  from public.access_profiles p
  where p.id = any (public.profils_de(new.access_profile_id, new.profils_complementaires))
    and coalesce(p.is_active, true);

  new.can_dashboard          := r.can_dashboard;
  new.can_territoire         := r.can_territoire;
  new.can_cartographie       := r.can_cartographie;
  new.can_clients            := r.can_clients;
  new.can_carte              := r.can_carte;
  new.can_todo               := r.can_todo;
  new.can_clients_cegeclim   := r.can_clients_cegeclim;
  new.can_suivi_prospects    := r.can_suivi_prospects;
  new.can_agences            := r.can_agences;
  new.can_autorisation       := r.can_autorisation;
  new.can_documents          := r.can_documents;
  new.can_stocks             := r.can_stocks;
  new.can_activites          := r.can_activites;
  new.can_change_scope       := r.can_change_scope;
  new.can_objectifs          := r.can_objectifs;
  new.can_suivi_agences      := r.can_suivi_agences;
  new.can_financement        := r.can_financement;
  new.can_allocation_airh2o  := r.can_allocation_airh2o;
  new.can_appro              := r.can_appro;
  new.can_superuser          := r.can_superuser;
  new.can_projetblg          := r.can_projetblg;
  new.can_paiement           := r.can_paiement;
  new.can_hotline            := r.can_hotline;
  new.can_hotline_expert     := r.can_hotline_expert;
  new.can_hotline_editeur    := r.can_hotline_editeur;
  new.can_guides_blg         := r.can_guides_blg;
  -- exclusion individuelle (25/11/2026) : profil Direction / Administrateur sans les contrats
  new.can_contrats_objectifs := r.can_contrats_objectifs and not coalesce(new.sans_contrats_objectifs, false);
  -- (26/11/2026) Analyse des ventes & devis, marge
  new.can_analyse_ventes     := r.can_analyse_ventes;
  new.can_voir_marge         := r.can_voir_marge;
  return new;
end
$function$;

-- Ouverture initiale : Direction et Administrateur (à étendre dans la gestion des accès)
update public.access_profiles
   set can_analyse_ventes = (name in ('Direction', 'Administrateur')),
       can_voir_marge     = (name in ('Direction', 'Administrateur'))
 where true;
update public.user_page_access set email = email where true;

create or replace function public.analyse_autorise()
returns boolean
language sql stable security definer
set search_path = public, auth
set row_security = off
as $$
  select exists (
    select 1 from public.user_page_access u
    where lower(trim(u.email)) = lower(trim(auth.jwt() ->> 'email'))
      and (coalesce(u.can_analyse_ventes, false) or coalesce(u.can_autorisation, false))
  ) or public.current_user_can_manage_access();
$$;
grant execute on function public.analyse_autorise() to authenticated;

create or replace function public.analyse_voir_marge()
returns boolean
language sql stable security definer
set search_path = public, auth
set row_security = off
as $$
  select exists (
    select 1 from public.user_page_access u
    where lower(trim(u.email)) = lower(trim(auth.jwt() ->> 'email'))
      and coalesce(u.can_voir_marge, false)
  );
$$;
grant execute on function public.analyse_voir_marge() to authenticated;

-- ── 2. Index de transformation des devis ────────────────────────────────────
create index if not exists idx_facture_lignes_devis_ref
  on public.facture_lignes (numero_piece_devis, reference_article) where numero_piece_devis is not null;
create index if not exists idx_activite_lignes_devis_ref
  on public.activite_lignes (numero_piece_devis, reference_article) where numero_piece_devis is not null;

-- ── 3. Vues ─────────────────────────────────────────────────────────────────
-- Annuaire des collaborateurs (une ligne par code, actifs d'abord)
create or replace view public.v_av_collaborateurs with (security_invoker = true) as
select distinct on (upper(btrim(nom)))
  upper(btrim(nom)) as cle, nom_prenom, agence
from public.ref_collaborateurs
where nullif(btrim(nom), '') is not null
order by upper(btrim(nom)), coalesce(mise_en_sommeil, false);

-- Lignes brutes des trois flux de vente
create or replace view public.v_av_ventes_base with (security_invoker = true) as
-- Factures, à la date de facture
select 'FACTURE'::text as flux, f.date_facture as date_ref,
       f.date_facture, f.date_bl, f.date_bc as date_cdc, f.date_devis,
       f.numero_piece as numero_document, f.numero_piece as numero_facture, f.numero_piece_bl as numero_bl,
       f.numero_piece_bc as numero_cdc, f.numero_piece_devis as numero_devis,
       f.numero_tiers_entete as numero_tiers, f.intitule_tiers_entete as intitule_tiers, f.collaborateur as collab_piece,
       f.depot, f.reference_article, coalesce(nullif(btrim(f.designation_article), ''), f.designation) as designation,
       f.quantite, f.montant_ht, f.marge_valeur as marge
from public.facture_lignes f
where f.date_facture is not null and nullif(btrim(f.reference_article), '') is not null
union all
-- BL facturés, à la date du BL
select 'BL', f.date_bl,
       f.date_facture, f.date_bl, f.date_bc, f.date_devis,
       coalesce(nullif(btrim(f.numero_piece_bl), ''), f.numero_piece), f.numero_piece, f.numero_piece_bl,
       f.numero_piece_bc, f.numero_piece_devis,
       f.numero_tiers_entete, f.intitule_tiers_entete, f.collaborateur,
       f.depot, f.reference_article, coalesce(nullif(btrim(f.designation_article), ''), f.designation),
       f.quantite, f.montant_ht, f.marge_valeur
from public.facture_lignes f
where f.date_bl is not null and nullif(btrim(f.reference_article), '') is not null
union all
-- BL et retours non encore facturés
select 'BL', coalesce(a.date_bl, a.date_piece),
       null::date, coalesce(a.date_bl, a.date_piece), a.date_bc, a.date_devis,
       a.numero_piece, null::text, a.numero_piece,
       a.numero_piece_bc, a.numero_piece_devis,
       a.numero_tiers_entete, a.intitule_tiers_entete, a.collaborateur,
       a.depot, a.reference_article, coalesce(nullif(btrim(a.designation_article), ''), a.designation),
       coalesce(nullif(a.qte_livree, 0), a.quantite), a.montant_ht, a.marge_valeur
from public.activite_lignes a
where a.type_document in ('Bon de livraison', 'Bon de retour')
  and nullif(btrim(a.reference_article), '') is not null
union all
-- CDC encore en « Bon de commande », à la date de la CDC
select 'CDC', a.date_piece,
       null::date, null::date, a.date_piece, a.date_devis,
       a.numero_piece, null::text, null::text,
       a.numero_piece, a.numero_piece_devis,
       a.numero_tiers_entete, a.intitule_tiers_entete, a.collaborateur,
       a.depot, a.reference_article, coalesce(nullif(btrim(a.designation_article), ''), a.designation),
       a.quantite, a.montant_ht, a.marge_valeur
from public.activite_lignes a
where a.type_document = 'Bon de commande'
  and nullif(btrim(a.reference_article), '') is not null
union all
-- Parties de CDC en préparation / livrées non facturées (CDC sortie du portefeuille)
select 'CDC', a.date_bc,
       null::date, case when a.type_document <> 'Préparation de livraison' then coalesce(a.date_bl, a.date_piece) end, a.date_bc, a.date_devis,
       a.numero_piece_bc, null::text, case when a.type_document <> 'Préparation de livraison' then a.numero_piece end,
       a.numero_piece_bc, a.numero_piece_devis,
       a.numero_tiers_entete, a.intitule_tiers_entete, a.collaborateur,
       a.depot, a.reference_article, coalesce(nullif(btrim(a.designation_article), ''), a.designation),
       coalesce(nullif(a.qte_livree, 0), a.quantite), a.montant_ht, a.marge_valeur
from public.activite_lignes a
where a.type_document in ('Préparation de livraison', 'Bon de livraison', 'Bon de retour')
  and a.date_bc is not null and nullif(btrim(a.numero_piece_bc), '') is not null
  and nullif(btrim(a.reference_article), '') is not null
  and not exists (select 1 from public.activite_lignes c
                  where c.numero_piece = a.numero_piece_bc and c.type_document = 'Bon de commande')
union all
-- Parties de CDC facturées (CDC sortie du portefeuille)
select 'CDC', f.date_bc,
       f.date_facture, f.date_bl, f.date_bc, f.date_devis,
       f.numero_piece_bc, f.numero_piece, f.numero_piece_bl,
       f.numero_piece_bc, f.numero_piece_devis,
       f.numero_tiers_entete, f.intitule_tiers_entete, f.collaborateur,
       f.depot, f.reference_article, coalesce(nullif(btrim(f.designation_article), ''), f.designation),
       f.quantite, f.montant_ht, f.marge_valeur
from public.facture_lignes f
where f.date_bc is not null and nullif(btrim(f.numero_piece_bc), '') is not null
  and nullif(btrim(f.reference_article), '') is not null
  and not exists (select 1 from public.activite_lignes c
                  where c.numero_piece = f.numero_piece_bc and c.type_document = 'Bon de commande');

-- Lignes enrichies : client, représentant effectif (règle B), agence, article, familles
create or replace view public.v_av_ventes with (security_invoker = true) as
select
  b.flux,
  b.date_ref,
  to_char(b.date_ref, 'YYYY')     as annee,
  to_char(b.date_ref, 'YYYY-MM')  as mois,
  b.date_facture, b.date_bl, b.date_cdc, b.date_devis,
  b.numero_document, b.numero_facture, b.numero_bl, b.numero_cdc, b.numero_devis,
  btrim(b.numero_tiers)                               as code_client,
  coalesce(rt.intitule, b.intitule_tiers)             as nom_client,
  rt.ville                                            as ville_client,
  rt.famille                                          as famille_client,
  k.rep_code                                          as code_representant,
  coalesce(rc.nom_prenom, k.rep_code)                 as representant,
  coalesce(nullif(btrim(rc.agence), ''),
           case when k.na then public.collab_piece_agence(b.collab_piece) end,
           nullif(btrim(rt.agence_rattachement), ''), 'NON AFFECTE') as agence,
  coalesce(nullif(btrim(b.depot), ''), 'NON RENSEIGNE') as depot,
  btrim(b.reference_article)                          as reference_article,
  coalesce(ra.designation, b.designation)             as designation,
  coalesce(nullif(btrim(ra.famille), ''), 'NON RENSEIGNE')          as famille,
  coalesce(nullif(btrim(rf.libelle_famille), ''), ra.famille)       as libelle_famille,
  coalesce(nullif(btrim(rf.famille_macro), ''), 'NON RENSEIGNE')    as famille_macro,
  coalesce(nullif(btrim(ra.marque), ''), 'NON RENSEIGNE')           as marque,
  case when coalesce(ra.hors_statistique, false) then 'Oui' else 'Non' end as hors_statistique,
  coalesce(b.quantite, 0)   as quantite,
  coalesce(b.montant_ht, 0) as montant_ht,
  coalesce(b.marge, 0)      as marge
from public.v_av_ventes_base b
left join public.ref_tiers rt on rt.numero = btrim(b.numero_tiers)
cross join lateral (
  select public.tiers_non_affecte(rt.representant::text) as na,
         case when public.tiers_non_affecte(rt.representant::text)
              then coalesce(public.collab_piece_code(b.collab_piece), 'NON AFFECTE')
              else upper(btrim(rt.representant)) end as rep_code
) k
left join public.v_av_collaborateurs rc on rc.cle = upper(k.rep_code)
left join public.ref_articles ra on ra.reference_article = btrim(b.reference_article)
left join public.ref_familles rf on rf.famille = ra.famille;

create or replace view public.v_av_factures with (security_invoker = true) as
  select * from public.v_av_ventes where flux = 'FACTURE';
create or replace view public.v_av_bl with (security_invoker = true) as
  select * from public.v_av_ventes where flux = 'BL';
create or replace view public.v_av_cdc with (security_invoker = true) as
  select * from public.v_av_ventes where flux = 'CDC';

-- Devis et transformation
-- Table de transformation devis → commande : 1re CDC / BL / facture reprenant le
-- n° de devis pour la même référence. Le calcul à la volée (sous-requête par ligne
-- de devis) prenait ~25 s sur 10 mois ; la table est reconstruite au plus toutes
-- les heures par analyse_executer (ou à la main : select refresh_analyse_devis_transfo()).
create table if not exists public.analyse_devis_transfo (
  numero_devis      text not null,
  reference_article text not null,
  date_transfo      date,
  primary key (numero_devis, reference_article)
);
alter table public.analyse_devis_transfo enable row level security;
drop policy if exists analyse_devis_transfo_lecture on public.analyse_devis_transfo;
create policy analyse_devis_transfo_lecture on public.analyse_devis_transfo for select to authenticated using (true);
grant select on public.analyse_devis_transfo to authenticated;

create table if not exists public.analyse_devis_transfo_etat (
  id          int primary key default 1 check (id = 1),
  refreshed_at timestamptz,
  nb_lignes   int
);
alter table public.analyse_devis_transfo_etat enable row level security;
drop policy if exists analyse_devis_transfo_etat_lecture on public.analyse_devis_transfo_etat;
create policy analyse_devis_transfo_etat_lecture on public.analyse_devis_transfo_etat for select to authenticated using (true);
grant select on public.analyse_devis_transfo_etat to authenticated;

create or replace function public.refresh_analyse_devis_transfo()
returns int
language plpgsql security definer
set search_path = public
as $$
declare v_nb int;
begin
  perform pg_advisory_xact_lock(hashtext('refresh_analyse_devis_transfo'));
  -- un autre appel vient peut-être de rafraîchir pendant l'attente du verrou
  if exists (select 1 from public.analyse_devis_transfo_etat where refreshed_at > now() - interval '5 minutes') then
    return null;
  end if;
  truncate public.analyse_devis_transfo;
  insert into public.analyse_devis_transfo (numero_devis, reference_article, date_transfo)
  select numero_devis, reference_article, min(dt)
  from (
    select btrim(al.numero_piece_devis) as numero_devis, btrim(al.reference_article) as reference_article,
           coalesce(al.date_bc, al.date_piece) as dt
    from public.activite_lignes al
    where nullif(btrim(al.numero_piece_devis), '') is not null and nullif(btrim(al.reference_article), '') is not null
    union all
    select btrim(fl.numero_piece_devis), btrim(fl.reference_article), coalesce(fl.date_bc, fl.date_bl, fl.date_facture)
    from public.facture_lignes fl
    where nullif(btrim(fl.numero_piece_devis), '') is not null and nullif(btrim(fl.reference_article), '') is not null
  ) x
  group by 1, 2;
  get diagnostics v_nb = row_count;
  insert into public.analyse_devis_transfo_etat (id, refreshed_at, nb_lignes) values (1, now(), v_nb)
  on conflict (id) do update set refreshed_at = excluded.refreshed_at, nb_lignes = excluded.nb_lignes;
  analyze public.analyse_devis_transfo;
  return v_nb;
end;
$$;
revoke all on function public.refresh_analyse_devis_transfo() from public, anon;
grant execute on function public.refresh_analyse_devis_transfo() to authenticated;

select public.refresh_analyse_devis_transfo();

create or replace view public.v_av_devis with (security_invoker = true) as
select
  'DEVIS'::text                                       as flux,
  d.date_devis                                        as date_ref,
  to_char(d.date_devis, 'YYYY')                       as annee,
  to_char(d.date_devis, 'YYYY-MM')                    as mois,
  d.numero_piece                                      as numero_document,
  btrim(d.numero_tiers_entete)                        as code_client,
  coalesce(rt.intitule, d.intitule_tiers_entete)      as nom_client,
  rt.ville                                            as ville_client,
  rt.famille                                          as famille_client,
  k.rep_code                                          as code_representant,
  coalesce(rc.nom_prenom, k.rep_code)                 as representant,
  coalesce(nullif(btrim(rc.agence), ''),
           case when k.na then public.collab_piece_agence(d.collaborateur) end,
           nullif(btrim(rt.agence_rattachement), ''), 'NON AFFECTE') as agence,
  coalesce(nullif(btrim(d.depot), ''), 'NON RENSEIGNE') as depot,
  btrim(d.reference_article)                          as reference_article,
  coalesce(ra.designation, d.designation)             as designation,
  coalesce(nullif(btrim(ra.famille), ''), 'NON RENSEIGNE')          as famille,
  coalesce(nullif(btrim(rf.libelle_famille), ''), ra.famille)       as libelle_famille,
  coalesce(nullif(btrim(rf.famille_macro), ''), 'NON RENSEIGNE')    as famille_macro,
  coalesce(nullif(btrim(ra.marque), ''), 'NON RENSEIGNE')           as marque,
  case when coalesce(ra.hors_statistique, false) then 'Oui' else 'Non' end as hors_statistique,
  t.date_transfo,
  (t.date_transfo is not null)                        as transforme,
  greatest(t.date_transfo - d.date_devis, 0)          as delai_transfo,
  ((now() at time zone 'Europe/Paris')::date - d.date_devis) as age_jours,
  case when t.date_transfo is not null then 'Transformé'
       when (now() at time zone 'Europe/Paris')::date - d.date_devis < 60 then 'En cours (moins de 60 j)'
       else 'Non transformé' end                      as statut_transfo,
  coalesce(d.quantite, 0)   as quantite,
  coalesce(d.montant_ht, 0) as montant_ht,
  coalesce(d.marge_valeur, 0) as marge
from public.devis_lignes d
left join public.ref_tiers rt on rt.numero = btrim(d.numero_tiers_entete)
cross join lateral (
  select public.tiers_non_affecte(rt.representant::text) as na,
         case when public.tiers_non_affecte(rt.representant::text)
              then coalesce(public.collab_piece_code(d.collaborateur), 'NON AFFECTE')
              else upper(btrim(rt.representant)) end as rep_code
) k
left join public.v_av_collaborateurs rc on rc.cle = upper(k.rep_code)
left join public.ref_articles ra on ra.reference_article = btrim(d.reference_article)
left join public.ref_familles rf on rf.famille = ra.famille
left join public.analyse_devis_transfo t
  on t.numero_devis = btrim(d.numero_piece) and t.reference_article = btrim(d.reference_article)
where d.type_document = 'Devis'
  and d.date_devis is not null
  and nullif(btrim(d.reference_article), '') is not null;

grant select on public.v_av_collaborateurs, public.v_av_ventes_base, public.v_av_ventes,
  public.v_av_factures, public.v_av_bl, public.v_av_cdc, public.v_av_devis to authenticated;

-- ── 4. Catalogue ────────────────────────────────────────────────────────────
create table if not exists public.analyse_sources (
  code         text primary key,
  libelle      text not null,
  description  text,
  icone        text,
  vue          text not null,
  date_libelle text not null,
  famille      text not null check (famille in ('ventes', 'devis')),
  ordre        int  not null default 100,
  actif        boolean not null default true
);

create table if not exists public.analyse_champs (
  source          text not null references public.analyse_sources(code) on delete cascade,
  code            text not null,
  libelle         text not null,
  groupe          text not null default 'Général',
  role            text not null check (role in ('dimension', 'mesure', 'filtre')),
  type            text not null check (type in ('texte', 'liste', 'nombre', 'montant', 'pourcent', 'date')),
  expr            text,                      -- mesures : agrégat SQL de confiance (migration)
  marge           boolean not null default false,
  description     text,
  ordre           int not null default 100,
  valeurs_requete text,
  primary key (source, code)
);

alter table public.analyse_sources enable row level security;
alter table public.analyse_champs  enable row level security;
drop policy if exists analyse_sources_lecture on public.analyse_sources;
create policy analyse_sources_lecture on public.analyse_sources for select to authenticated using (true);
drop policy if exists analyse_champs_lecture on public.analyse_champs;
create policy analyse_champs_lecture on public.analyse_champs for select to authenticated using (true);
grant select on public.analyse_sources, public.analyse_champs to authenticated;

insert into public.analyse_sources (code, libelle, description, icone, vue, date_libelle, famille, ordre) values
  ('factures', 'Lignes de factures', 'Ce qui a été facturé, lu à la date de facture. La facturation SAGE se fait en lot en fin de mois : pour le mois en cours, préférez les BL.', '💶', 'v_av_factures', 'Date de facture', 'ventes', 10),
  ('bl', 'Lignes de BL', 'Ce qui a été livré, lu à la date du BL : BL facturés et BL (et retours) pas encore facturés.', '🚚', 'v_av_bl', 'Date du BL', 'ventes', 20),
  ('cdc', 'Lignes de commandes clients', 'Ce qui a été commandé, lu à la date de la CDC : commandes en cours et parties déjà livrées ou facturées.', '🛒', 'v_av_cdc', 'Date de la CDC', 'ventes', 30),
  ('devis', 'Lignes de devis', 'Ce qui a été devisé, lu à la date du devis, avec la transformation en commande (n° de devis repris sur la CDC, le BL ou la facture, pour la même référence).', '📝', 'v_av_devis', 'Date du devis', 'devis', 40)
on conflict (code) do update set libelle = excluded.libelle, description = excluded.description, icone = excluded.icone,
  vue = excluded.vue, date_libelle = excluded.date_libelle, famille = excluded.famille, ordre = excluded.ordre, actif = true;

delete from public.analyse_champs where true;

-- Champs communs (ventes et devis)
insert into public.analyse_champs (source, code, libelle, groupe, role, type, ordre, description, valeurs_requete)
select s.code, c.code,
       case when c.code = 'date_ref' then s.date_libelle
            when c.code = 'numero_document' then case s.code when 'factures' then 'N° de facture' when 'bl' then 'N° de BL'
                                                                 when 'cdc' then 'N° de CDC' else 'N° de devis' end
            else c.libelle end,
       c.groupe, c.role, c.type, c.ordre, c.description, c.valeurs_requete
from public.analyse_sources s
cross join (values
  ('annee', 'Année', 'Période', 'dimension', 'texte', 10, null::text, null::text),
  ('mois', 'Mois', 'Période', 'dimension', 'texte', 20, 'Au format AAAA-MM.', null),
  ('date_ref', 'Date', 'Période', 'dimension', 'date', 30, null, null),
  ('code_client', 'Code client', 'Client', 'dimension', 'texte', 40, null, null),
  ('nom_client', 'Nom du client', 'Client', 'dimension', 'texte', 50, null, null),
  ('ville_client', 'Ville du client', 'Client', 'dimension', 'texte', 60, null, null),
  ('famille_client', 'Famille client', 'Client', 'dimension', 'liste', 70, null,
     $L$select distinct famille from public.ref_tiers where famille is not null$L$),
  ('agence', 'Agence', 'Suivi commercial', 'dimension', 'liste', 80, 'Agence du représentant de la fiche client (règle B pour les clients NON AFFECTE).',
     $L$select distinct agence from public.ref_collaborateurs where agence is not null$L$),
  ('representant', 'Représentant', 'Suivi commercial', 'dimension', 'liste', 90, 'Représentant actuel de la fiche client (règle B pour les clients NON AFFECTE).',
     $L$select distinct nom_prenom from public.ref_collaborateurs where nom_prenom is not null$L$),
  ('famille_macro', 'Famille macro', 'Article', 'dimension', 'liste', 100, 'R/R, R/O, PV, SAV, ACC…',
     $L$select distinct famille_macro from public.ref_familles where famille_macro is not null$L$),
  ('famille', 'Famille', 'Article', 'dimension', 'liste', 110, 'Code famille SAGE.',
     $L$select distinct famille from public.ref_familles where famille is not null$L$),
  ('libelle_famille', 'Libellé famille', 'Article', 'dimension', 'texte', 115, null, null),
  ('marque', 'Marque', 'Article', 'dimension', 'liste', 120, null,
     $L$select distinct marque from public.ref_articles where marque is not null$L$),
  ('reference_article', 'Référence article', 'Article', 'dimension', 'texte', 130, null, null),
  ('designation', 'Désignation', 'Article', 'dimension', 'texte', 140, null, null),
  ('hors_statistique', 'Article hors statistique', 'Article', 'dimension', 'liste', 150, 'Port, prestations, articles exclus des statistiques.',
     $L$select unnest(array['Oui','Non'])$L$),
  ('depot', 'Dépôt', 'Logistique', 'dimension', 'liste', 160, null,
     $L$select distinct depot_stockage from public.activite_entete where depot_stockage is not null$L$),
  ('numero_document', 'N° de document', 'Document', 'dimension', 'texte', 170, null, null)
) as c(code, libelle, groupe, role, type, ordre, description, valeurs_requete);

-- Dates et numéros d'origine (ventes)
insert into public.analyse_champs (source, code, libelle, groupe, role, type, ordre)
select s.code, c.code, c.libelle, 'Document', 'filtre', c.type, c.ordre
from public.analyse_sources s
cross join (values
  ('date_facture', 'Date de facture', 'date', 200),
  ('date_bl', 'Date du BL', 'date', 210),
  ('date_cdc', 'Date de la CDC', 'date', 220),
  ('date_devis', 'Date du devis', 'date', 230),
  ('numero_facture', 'N° de facture', 'texte', 240),
  ('numero_bl', 'N° de BL', 'texte', 250),
  ('numero_cdc', 'N° de CDC', 'texte', 260),
  ('numero_devis', 'N° de devis', 'texte', 270)
) as c(code, libelle, type, ordre)
where s.famille = 'ventes';

-- Mesures des ventes
insert into public.analyse_champs (source, code, libelle, groupe, role, type, expr, marge, ordre, description)
select s.code, m.code, m.libelle, 'Mesures', 'mesure', m.type, m.expr, m.marge, m.ordre, m.description
from public.analyse_sources s
cross join (values
  ('quantite', 'Quantité', 'nombre', 'sum(quantite)', false, 300, null::text),
  ('montant_ht', 'CA HT', 'montant', 'sum(montant_ht)', false, 310, 'Montant HT net des lignes.'),
  ('marge', 'Marge', 'montant', 'sum(marge)', true, 320, null),
  ('taux_marge', 'Taux de marge', 'pourcent', 'round(100 * sum(marge) / nullif(sum(montant_ht), 0), 1)', true, 330, 'Marge / CA HT.'),
  ('pu_moyen', 'Prix moyen unitaire', 'montant', 'round(sum(montant_ht) / nullif(sum(quantite), 0), 2)', false, 340, 'CA HT / quantité.'),
  ('nb_clients', 'Nombre de clients', 'nombre', 'count(distinct code_client)', false, 350, null),
  ('nb_documents', 'Nombre de documents', 'nombre', 'count(distinct numero_document)', false, 360, null),
  ('nb_articles', 'Nombre de références', 'nombre', 'count(distinct reference_article)', false, 370, null),
  ('nb_lignes', 'Nombre de lignes', 'nombre', 'count(*)', false, 380, null)
) as m(code, libelle, type, expr, marge, ordre, description)
where s.famille = 'ventes';

-- Champs et mesures des devis
insert into public.analyse_champs (source, code, libelle, groupe, role, type, ordre, description, valeurs_requete) values
  ('devis', 'statut_transfo', 'Statut de transformation', 'Transformation', 'dimension', 'liste', 180,
   'Transformé ; En cours (devis de moins de 60 jours non transformé) ; Non transformé.',
   $L$select unnest(array['Transformé','En cours (moins de 60 j)','Non transformé'])$L$),
  ('devis', 'date_transfo', 'Date de transformation', 'Transformation', 'filtre', 'date', 190, 'Date de la première CDC reprenant la ligne de devis.', null),
  ('devis', 'delai_transfo', 'Délai de transformation (jours)', 'Transformation', 'filtre', 'nombre', 200, null, null),
  ('devis', 'age_jours', 'Âge du devis (jours)', 'Transformation', 'filtre', 'nombre', 210, null, null);

insert into public.analyse_champs (source, code, libelle, groupe, role, type, expr, marge, ordre, description) values
  ('devis', 'nb_devis', 'Nombre de devis', 'Mesures', 'mesure', 'nombre', 'count(distinct numero_document)', false, 300, null),
  ('devis', 'nb_devis_transformes', 'Devis transformés', 'Mesures', 'mesure', 'nombre', 'count(distinct case when transforme then numero_document end)', false, 305, 'Devis dont au moins une ligne est transformée.'),
  ('devis', 'quantite', 'Quantité devisée', 'Mesures', 'mesure', 'nombre', 'sum(quantite)', false, 310, null),
  ('devis', 'montant_ht', 'Montant devisé HT', 'Mesures', 'mesure', 'montant', 'sum(montant_ht)', false, 320, null),
  ('devis', 'qte_transformee', 'Quantité transformée', 'Mesures', 'mesure', 'nombre', 'sum(case when transforme then quantite else 0 end)', false, 330, null),
  ('devis', 'montant_transforme', 'Montant transformé HT', 'Mesures', 'mesure', 'montant', 'sum(case when transforme then montant_ht else 0 end)', false, 340, 'Montant des lignes de devis reprises en commande.'),
  ('devis', 'taux_transfo', 'Taux de transformation', 'Mesures', 'mesure', 'pourcent',
   'round(100 * sum(case when transforme then montant_ht else 0 end) / nullif(sum(montant_ht), 0), 1)', false, 350, 'Montant transformé / montant devisé, quel que soit le délai.'),
  ('devis', 'taux_transfo_60j', 'Taux de transformation à 60 j', 'Mesures', 'mesure', 'pourcent',
   'round(100 * sum(case when age_jours >= 60 and transforme and delai_transfo <= 60 then montant_ht else 0 end) / nullif(sum(case when age_jours >= 60 then montant_ht else 0 end), 0), 1)', false, 360,
   'En montant, sur les devis de plus de 60 jours : part transformée dans les 60 jours (base des contrats d''objectifs et de Mes agences).'),
  ('devis', 'taux_transfo_nb', 'Taux de transformation (en nombre de devis)', 'Mesures', 'mesure', 'pourcent',
   'round(100.0 * count(distinct case when transforme then numero_document end) / nullif(count(distinct numero_document), 0), 1)', false, 370, null),
  ('devis', 'delai_moyen', 'Délai moyen de transformation (j)', 'Mesures', 'mesure', 'nombre', 'round(avg(delai_transfo), 0)', false, 380, null),
  ('devis', 'nb_clients', 'Nombre de clients', 'Mesures', 'mesure', 'nombre', 'count(distinct code_client)', false, 390, null),
  ('devis', 'nb_articles', 'Nombre de références', 'Mesures', 'mesure', 'nombre', 'count(distinct reference_article)', false, 395, null),
  ('devis', 'marge', 'Marge devisée', 'Mesures', 'mesure', 'montant', 'sum(marge)', true, 400, null),
  ('devis', 'taux_marge', 'Taux de marge devisé', 'Mesures', 'mesure', 'pourcent', 'round(100 * sum(marge) / nullif(sum(montant_ht), 0), 1)', true, 410, null),
  ('devis', 'nb_lignes', 'Nombre de lignes', 'Mesures', 'mesure', 'nombre', 'count(*)', false, 420, null);

-- ── 5. Requêtes enregistrées ────────────────────────────────────────────────
create table if not exists public.analyse_modeles (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null,
  description text,
  source      text not null references public.analyse_sources(code) on delete cascade,
  definition  jsonb not null,  -- { dimensions, mesures, filtres, tri, top, sous_totaux, part_ca }
  partage     boolean not null default false,
  ordre       int not null default 100,
  created_by  text not null default lower(auth.jwt() ->> 'email'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.analyse_modeles enable row level security;
drop policy if exists analyse_modeles_lecture on public.analyse_modeles;
create policy analyse_modeles_lecture on public.analyse_modeles for select to authenticated
  using (public.analyse_autorise() and (partage or created_by = lower(auth.jwt() ->> 'email')));
drop policy if exists analyse_modeles_ecriture on public.analyse_modeles;
create policy analyse_modeles_ecriture on public.analyse_modeles for all to authenticated
  using (public.analyse_autorise() and (created_by = lower(auth.jwt() ->> 'email') or public.current_user_can_manage_access()))
  with check (public.analyse_autorise()
              and (created_by = lower(auth.jwt() ->> 'email') or public.current_user_can_manage_access())
              and (not partage or public.current_user_can_manage_access()));
grant select, insert, update, delete on public.analyse_modeles to authenticated;

delete from public.analyse_modeles where created_by = 'compagnon';
insert into public.analyse_modeles (nom, description, source, definition, partage, ordre, created_by) values
  ('CA d''un client par famille macro', 'Le cas « SMER » : choisissez le ou les clients et la période, le CA et les quantités sortent par famille macro.',
   'factures', $J${"dimensions":["famille_macro"],"mesures":["quantite","montant_ht"],"filtres":[{"champ":"date_ref","operateur":"periode","valeur":"annee_en_cours","valeur2":"","valeurs":[]},{"champ":"code_client","operateur":"parmi","valeur":"","valeur2":"","valeurs":[]},{"champ":"hors_statistique","operateur":"est","valeur":"Non","valeur2":"","valeurs":[]}],"tri":[{"champ":"montant_ht","sens":"desc"}],"top":null,"sous_totaux":true,"part_ca":true}$J$::jsonb,
   true, 10, 'compagnon'),
  ('Détail articles d''un client', 'Famille macro › famille › article, avec sous-totaux, pour un ou plusieurs clients.',
   'factures', $J${"dimensions":["famille_macro","famille","reference_article","designation"],"mesures":["quantite","montant_ht"],"filtres":[{"champ":"date_ref","operateur":"periode","valeur":"annee_en_cours","valeur2":"","valeurs":[]},{"champ":"code_client","operateur":"parmi","valeur":"","valeur2":"","valeurs":[]},{"champ":"hors_statistique","operateur":"est","valeur":"Non","valeur2":"","valeurs":[]}],"tri":[{"champ":"montant_ht","sens":"desc"}],"top":null,"sous_totaux":true,"part_ca":true}$J$::jsonb,
   true, 20, 'compagnon'),
  ('Top 50 articles', 'Les 50 références les plus vendues en valeur sur la période.',
   'factures', $J${"dimensions":["reference_article","designation","famille_macro"],"mesures":["quantite","montant_ht","nb_clients"],"filtres":[{"champ":"date_ref","operateur":"periode","valeur":"annee_en_cours","valeur2":"","valeurs":[]},{"champ":"hors_statistique","operateur":"est","valeur":"Non","valeur2":"","valeurs":[]}],"tri":[{"champ":"montant_ht","sens":"desc"}],"top":50,"sous_totaux":false,"part_ca":true}$J$::jsonb,
   true, 30, 'compagnon'),
  ('CA par famille macro et par mois', 'Évolution mensuelle de chaque famille macro.',
   'factures', $J${"dimensions":["famille_macro","mois"],"mesures":["quantite","montant_ht"],"filtres":[{"champ":"date_ref","operateur":"periode","valeur":"annee_en_cours","valeur2":"","valeurs":[]},{"champ":"hors_statistique","operateur":"est","valeur":"Non","valeur2":"","valeurs":[]}],"tri":[],"top":null,"sous_totaux":true,"part_ca":false}$J$::jsonb,
   true, 40, 'compagnon'),
  ('Livraisons du mois par client', 'BL facturés et non facturés du mois en cours, par client.',
   'bl', $J${"dimensions":["code_client","nom_client"],"mesures":["nb_documents","quantite","montant_ht"],"filtres":[{"champ":"date_ref","operateur":"periode","valeur":"mois_en_cours","valeur2":"","valeurs":[]}],"tri":[{"champ":"montant_ht","sens":"desc"}],"top":null,"sous_totaux":false,"part_ca":true}$J$::jsonb,
   true, 50, 'compagnon'),
  ('Références les plus devisées', 'Top 50 des références devisées, avec leur taux de transformation à 60 jours.',
   'devis', $J${"dimensions":["reference_article","designation","famille_macro"],"mesures":["nb_devis","quantite","montant_ht","montant_transforme","taux_transfo_60j"],"filtres":[{"champ":"date_ref","operateur":"periode","valeur":"annee_en_cours","valeur2":"","valeurs":[]},{"champ":"hors_statistique","operateur":"est","valeur":"Non","valeur2":"","valeurs":[]}],"tri":[{"champ":"montant_ht","sens":"desc"}],"top":50,"sous_totaux":false,"part_ca":false}$J$::jsonb,
   true, 60, 'compagnon'),
  ('Transformation des devis par famille', 'Montant devisé, transformé et taux de transformation par famille macro et famille.',
   'devis', $J${"dimensions":["famille_macro","famille"],"mesures":["nb_devis","montant_ht","montant_transforme","taux_transfo","taux_transfo_60j","delai_moyen"],"filtres":[{"champ":"date_ref","operateur":"periode","valeur":"annee_en_cours","valeur2":"","valeurs":[]},{"champ":"hors_statistique","operateur":"est","valeur":"Non","valeur2":"","valeurs":[]}],"tri":[{"champ":"montant_ht","sens":"desc"}],"top":null,"sous_totaux":true,"part_ca":false}$J$::jsonb,
   true, 70, 'compagnon');

-- ── 6. RPC ──────────────────────────────────────────────────────────────────
create or replace function public.analyse_catalogue()
returns jsonb
language plpgsql stable security invoker
set search_path = public
as $$
declare
  v_marge boolean := public.analyse_voir_marge();
  v_per   record;
begin
  if not public.analyse_autorise() then
    raise exception 'Écran « Analyse des ventes & devis » non ouvert pour ce compte.';
  end if;
  select * into v_per from public.suivi_perimetre();
  return jsonb_build_object(
    'droits', jsonb_build_object(
      'voir_marge', v_marge,
      'partager', public.current_user_can_manage_access(),
      'perimetre_limite', not coalesce(v_per.illimite, false)),
    'sources', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', s.code, 'libelle', s.libelle, 'description', s.description, 'icone', s.icone,
        'date_libelle', s.date_libelle, 'famille', s.famille,
        'champs', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'code', c.code, 'libelle', c.libelle, 'groupe', c.groupe, 'role', c.role, 'type', c.type,
            'description', c.description, 'a_valeurs', c.valeurs_requete is not null
          ) order by c.ordre), '[]'::jsonb)
          from public.analyse_champs c
          where c.source = s.code and (v_marge or not c.marge)
        )
      ) order by s.ordre), '[]'::jsonb)
      from public.analyse_sources s where s.actif
    ));
end;
$$;
grant execute on function public.analyse_catalogue() to authenticated;

create or replace function public.analyse_valeurs(p_source text, p_champ text)
returns text[]
language plpgsql stable security invoker
set search_path = public
as $$
declare
  v_sql text;
  v_res text[];
begin
  if not public.analyse_autorise() then
    raise exception 'Écran « Analyse des ventes & devis » non ouvert pour ce compte.';
  end if;
  select valeurs_requete into v_sql from public.analyse_champs where source = p_source and code = p_champ;
  if v_sql is null then return array[]::text[]; end if;
  execute format('select array(select v from (select trim(x::text) as v from (%s) q(x)) z where v <> '''' group by v order by v limit 500)', v_sql)
    into v_res;
  return coalesce(v_res, array[]::text[]);
end;
$$;
grant execute on function public.analyse_valeurs(text, text) to authenticated;

-- Recherche de clients (code, nom, ville), limitée au périmètre de la personne
create or replace function public.analyse_clients(p_recherche text, p_codes text[] default null)
returns jsonb
language plpgsql stable security invoker
set search_path = public
as $$
declare
  v_per record;
  v_q   text := nullif(btrim(coalesce(p_recherche, '')), '');
begin
  if not public.analyse_autorise() then
    raise exception 'Écran « Analyse des ventes & devis » non ouvert pour ce compte.';
  end if;
  select * into v_per from public.suivi_perimetre();
  return (
    select coalesce(jsonb_agg(jsonb_build_object('code', z.numero, 'nom', z.intitule, 'ville', z.ville) order by z.intitule), '[]'::jsonb)
    from (
      select t.numero, t.intitule, t.ville
      from public.ref_tiers t
      where nullif(btrim(t.numero), '') is not null
        and (
          (p_codes is not null and t.numero = any (p_codes))
          or (p_codes is null and v_q is not null
              and (t.numero ilike v_q || '%' or t.intitule ilike '%' || v_q || '%' or t.ville ilike v_q || '%'))
        )
        and (coalesce(v_per.illimite, false)
             or upper(btrim(coalesce(t.representant, ''))) = any (coalesce(v_per.codes, '{}'))
             or public.tiers_non_affecte(t.representant::text))
      order by t.intitule
      limit 40
    ) z
  );
end;
$$;
grant execute on function public.analyse_clients(text, text[]) to authenticated;

-- Exécution
-- Retour : { dimensions:[{code,libelle,type}], mesures:[{code,libelle,type}],
--            lignes:[[dims..., mesures...]], sous_totaux:[[dims..., mesures..., grouping]],
--            total:[mesures...], nb, tronque, executee, alerte, estimation, duree_ms }
create or replace function public.analyse_executer(
  p_source      text,
  p_dimensions  text[],
  p_mesures     text[],
  p_filtres     jsonb   default '[]'::jsonb,
  p_tri         jsonb   default '[]'::jsonb,
  p_top         int     default null,
  p_sous_totaux boolean default true,
  p_forcer      boolean default false
)
returns jsonb
language plpgsql volatile security invoker
set search_path = public
set work_mem = '64MB'
as $$
declare
  v_src      public.analyse_sources%rowtype;
  v_marge    boolean := public.analyse_voir_marge();
  v_per      record;
  v_dims     jsonb;
  v_mes      jsonb;
  v_dim_cols text;
  v_mes_cols text;
  v_nb_dims  int;
  v_where    text := 'true';
  v_group    text := '';
  v_order    text := '';
  v_sql      text;
  v_plan     json;
  v_cout     numeric;
  v_alerte   jsonb := null;
  v_lignes   jsonb;
  v_st       jsonb := '[]'::jsonb;
  v_total    jsonb;
  v_nb       int;
  v_limite   int;
  v_debut    timestamptz := clock_timestamp();
  v_rollup   boolean;
  v_all_mask int;
  f          jsonb;
  t          jsonb;
  v_type     text;
  v_role     text;
  v_flag     boolean;
  v_cond     text;
  v_sens     text;
  c_cout_lourd    constant numeric := 1500000;
  c_cout_bloquant constant numeric := 25000000;
  c_limite_max    constant int := 20000;
begin
  if not public.analyse_autorise() then
    raise exception 'Écran « Analyse des ventes & devis » non ouvert pour ce compte.';
  end if;

  select * into v_src from public.analyse_sources where code = p_source and actif;
  if not found then raise exception 'Source inconnue : %', p_source; end if;

  -- Devis : table de transformation rafraîchie au plus toutes les heures
  if v_src.famille = 'devis' and not exists (
       select 1 from public.analyse_devis_transfo_etat where refreshed_at > now() - interval '1 hour') then
    perform public.refresh_analyse_devis_transfo();
  end if;

  -- Dimensions (ordre de l'utilisateur)
  select jsonb_agg(jsonb_build_object('code', c.code, 'libelle', c.libelle, 'type', c.type) order by x.ord),
         string_agg(format('%I', c.code), ', ' order by x.ord),
         count(*)
    into v_dims, v_dim_cols, v_nb_dims
  from unnest(coalesce(p_dimensions, '{}')) with ordinality x(code, ord)
  join public.analyse_champs c on c.source = p_source and c.code = x.code and c.role = 'dimension'
  where v_marge or not c.marge;
  v_nb_dims := coalesce(v_nb_dims, 0);
  if v_nb_dims <> coalesce(cardinality(p_dimensions), 0) then
    raise exception 'Regroupement inconnu ou non autorisé.';
  end if;

  -- Mesures
  select jsonb_agg(jsonb_build_object('code', c.code, 'libelle', c.libelle, 'type', c.type) order by x.ord),
         string_agg(c.expr || ' as ' || format('%I', c.code), ', ' order by x.ord)
    into v_mes, v_mes_cols
  from unnest(coalesce(p_mesures, '{}')) with ordinality x(code, ord)
  join public.analyse_champs c on c.source = p_source and c.code = x.code and c.role = 'mesure';
  if exists (select 1 from unnest(coalesce(p_mesures, '{}')) x(code)
             left join public.analyse_champs c on c.source = p_source and c.code = x.code and c.role = 'mesure'
             where c.code is null or (c.marge and not v_marge)) then
    raise exception 'Mesure inconnue ou non autorisée (la marge dépend d''un droit dédié).';
  end if;
  if v_mes_cols is null and v_nb_dims = 0 then
    raise exception 'Choisissez au moins un regroupement ou une mesure.';
  end if;

  -- Filtres (dimensions et champs de filtre ; marge interdite sans droit)
  for f in select * from jsonb_array_elements(coalesce(p_filtres, '[]'::jsonb)) loop
    select type, role, marge into v_type, v_role, v_flag
    from public.analyse_champs where source = p_source and code = f ->> 'champ';
    if v_type is null or v_role = 'mesure' or (v_flag and not v_marge) then
      raise exception 'Filtre sur un champ inconnu : %', f ->> 'champ';
    end if;
    v_cond := public.requeteur_condition(v_type, f ->> 'champ', f);
    if v_cond is not null then v_where := v_where || ' and ' || v_cond; end if;
  end loop;

  -- Périmètre agences / collaborateurs (en plus du RLS des lignes)
  select * into v_per from public.suivi_perimetre();
  if not coalesce(v_per.illimite, false) then
    v_where := v_where || format(' and upper(btrim(code_representant)) = any (%L::text[])', coalesce(v_per.codes, '{}'));
  end if;

  -- Tri (dimension ou mesure choisie)
  for t in select * from jsonb_array_elements(coalesce(p_tri, '[]'::jsonb)) loop
    if (t ->> 'champ') = any (coalesce(p_dimensions, '{}')) or (t ->> 'champ') = any (coalesce(p_mesures, '{}')) then
      v_sens := case when lower(t ->> 'sens') = 'desc' then 'desc nulls last' else 'asc nulls last' end;
      v_order := v_order || case when v_order = '' then '' else ', ' end || format('%I %s', t ->> 'champ', v_sens);
    end if;
  end loop;
  if v_order = '' then
    v_order := coalesce(v_dim_cols, '1');
  end if;

  v_limite := least(greatest(coalesce(p_top, c_limite_max), 1), c_limite_max);
  v_rollup := v_nb_dims >= 2 and p_top is null and coalesce(p_sous_totaux, true);
  v_all_mask := (1 << v_nb_dims) - 1;

  if v_nb_dims = 0 then
    v_sql := format('select %s, 0 as _g from public.%I where %s', v_mes_cols, v_src.vue, v_where);
  else
    v_group := case when v_rollup then format('rollup (%s)', v_dim_cols)
                    else format('grouping sets ((%s), ())', v_dim_cols) end;
    v_sql := format('select %s%s, grouping(%s) as _g from public.%I where %s group by %s',
                    v_dim_cols, case when v_mes_cols is null then '' else ', ' || v_mes_cols end,
                    v_dim_cols, v_src.vue, v_where, v_group);
  end if;

  -- Estimation (plan Postgres, sans exécuter)
  execute 'explain (format json) ' || v_sql into v_plan;
  v_cout := (v_plan -> 0 -> 'Plan' ->> 'Total Cost')::numeric;
  if v_cout > c_cout_bloquant then
    v_alerte := jsonb_build_object('niveau', 'bloquant',
      'message', 'Analyse beaucoup trop lourde. Réduisez la période ou ajoutez un filtre (client, agence, famille…).');
  elsif v_cout > c_cout_lourd then
    v_alerte := jsonb_build_object('niveau', 'lourd',
      'message', 'Analyse lourde : elle peut prendre jusqu''à 30 secondes. Une période plus courte ou un filtre (client, agence, famille…) la rendra plus rapide.');
  end if;
  if v_alerte is not null and ((v_alerte ->> 'niveau') = 'bloquant' or not p_forcer) then
    return jsonb_build_object('dimensions', coalesce(v_dims, '[]'::jsonb), 'mesures', coalesce(v_mes, '[]'::jsonb),
      'lignes', '[]'::jsonb, 'sous_totaux', '[]'::jsonb, 'total', null, 'nb', 0, 'tronque', false,
      'executee', false, 'alerte', v_alerte, 'estimation', jsonb_build_object('cout', round(v_cout)),
      'duree_ms', round(extract(epoch from clock_timestamp() - v_debut) * 1000));
  end if;

  -- Exécution : résultat matérialisé une fois, puis découpé
  execute 'drop table if exists _analyse_res';
  execute format('create temp table _analyse_res on commit drop as %s', v_sql);

  if v_nb_dims = 0 then
    execute format('select jsonb_build_array(%s) from _analyse_res limit 1',
                   (select string_agg(format('%I', x), ', ') from unnest(p_mesures) x))
      into v_total;
    v_lignes := '[]'::jsonb; v_nb := 0;
  else
    execute format('select coalesce(jsonb_agg(jsonb_build_array(%s) order by rn), ''[]''::jsonb) from (select *, row_number() over (order by %s) rn from _analyse_res where _g = 0 order by %s limit %s) q',
                   v_dim_cols || case when v_mes_cols is null then '' else ', ' || (select string_agg(format('%I', x), ', ') from unnest(p_mesures) x) end,
                   v_order, v_order, v_limite + 1)
      into v_lignes;
    v_nb := jsonb_array_length(v_lignes);
    if v_nb > v_limite then v_lignes := v_lignes - v_limite; end if;

    if v_mes_cols is not null then
      execute format('select jsonb_build_array(%s) from _analyse_res where _g = %s limit 1',
                     (select string_agg(format('%I', x), ', ') from unnest(p_mesures) x), v_all_mask)
        into v_total;
    end if;

    if v_rollup then
      execute format('select coalesce(jsonb_agg(jsonb_build_array(%s, _g)), ''[]''::jsonb) from (select * from _analyse_res where _g <> 0 and _g <> %s limit %s) q',
                     v_dim_cols || case when v_mes_cols is null then '' else ', ' || (select string_agg(format('%I', x), ', ') from unnest(p_mesures) x) end,
                     v_all_mask, c_limite_max)
        into v_st;
    end if;
  end if;

  return jsonb_build_object(
    'dimensions', coalesce(v_dims, '[]'::jsonb),
    'mesures', coalesce(v_mes, '[]'::jsonb),
    'lignes', v_lignes,
    'sous_totaux', coalesce(v_st, '[]'::jsonb),
    'total', v_total,
    'nb', least(v_nb, v_limite),
    'tronque', v_nb > v_limite and p_top is null,
    'limite', v_limite,
    'executee', true,
    'alerte', v_alerte,
    'perimetre_limite', not coalesce(v_per.illimite, false),
    'estimation', jsonb_build_object('cout', round(v_cout)),
    'duree_ms', round(extract(epoch from clock_timestamp() - v_debut) * 1000));
end;
$$;
grant execute on function public.analyse_executer(text, text[], text[], jsonb, jsonb, int, boolean, boolean) to authenticated;
