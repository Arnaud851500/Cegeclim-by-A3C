-- ============================================================================
-- 20261116c_requeteur_metier.sql — Requêteur métier (Admin › Requêteur)
-- ----------------------------------------------------------------------------
-- Demandé par Arnaud le 16/11/2026 : un écran de requête « à la volée » simple,
-- tourné métier : on choisit une source (BL, commandes, factures…), des
-- colonnes et des filtres, avec une alerte quand la requête est trop lourde.
-- Test d'acceptation : Laure produit seule la liste des BL du jour (agence,
-- client, CDC d'origine, dépôt, nb lignes, valeur, représentant, dates).
--
-- Objets :
--   - v_req_client_rep : client + représentant de la fiche + agence
--     (agence du représentant, repli sur l'agence de la fiche client) ;
--   - vues sources v_req_* (security_invoker : le RLS des tables s'applique) ;
--   - catalogue requeteur_sources / requeteur_champs (libellés métier, types,
--     listes de valeurs) — seule la migration l'alimente ;
--   - requeteur_modeles : requêtes enregistrées (personnelles ou partagées) ;
--   - RPC requeteur_catalogue(), requeteur_valeurs(), requeteur_executer().
-- Accès : droit can_autorisation (utilisateur ou profil), comme le bloc Admin.
-- La requête n'est jamais écrite par l'utilisateur : colonnes et filtres sont
-- validés contre le catalogue, les valeurs passent par quote_literal.
-- ============================================================================

-- ── Droit d'accès ───────────────────────────────────────────────────────────
create or replace function public.requeteur_autorise()
returns boolean
language sql stable security definer
set search_path = public, auth
set row_security = off
as $$
  select coalesce((
    select bool_or(coalesce(u.can_autorisation, false))
    from public.user_page_access u
    where lower(trim(u.email)) = lower(trim(auth.jwt() ->> 'email'))
  ), false) or public.current_user_can_manage_access();
$$;
grant execute on function public.requeteur_autorise() to authenticated;

-- ── Vues sources ────────────────────────────────────────────────────────────
create or replace view public.v_req_client_rep with (security_invoker = true) as
select
  t.numero                               as code_client,
  t.intitule                             as nom_client,
  t.representant                         as code_representant,
  coalesce(c.nom_prenom, t.representant) as representant,
  coalesce(c.agence, t.agence_rattachement) as agence,
  t.agence_rattachement                  as agence_fiche_client,
  t.code_postal,
  t.ville,
  t.famille                              as famille_client
from public.ref_tiers t
left join (
  select distinct on (upper(trim(nom))) upper(trim(nom)) as cle, nom_prenom, agence
  from public.ref_collaborateurs
  order by upper(trim(nom)), coalesce(mise_en_sommeil, false)
) c on c.cle = upper(trim(t.representant));

-- 1. Documents de vente en cours (une ligne par document, non facturés)
create or replace view public.v_req_documents_vente with (security_invoker = true) as
select
  case e.type_document
    when '1' then 'Commande client (CDC)'
    when '2' then 'Préparation de livraison (PL)'
    when '3' then 'Bon de livraison (BL)'
    when '4' then 'Bon de retour (BR)'
    when '5' then 'Bon d''avoir (BA)'
    else e.type_document end            as type_document,
  e.numero_piece,
  e.date_piece,
  e.date_livraison,
  e.date_livraison_realisee,
  e.reference                            as reference_client,
  e.numero_tiers                         as code_client,
  e.intitule_tiers                       as nom_client,
  cr.representant,
  cr.agence,
  cr.agence_fiche_client,
  cr.ville                               as ville_client,
  e.depot_stockage                       as depot,
  e.expedition                           as mode_expedition,
  e.lieu_livraison,
  e.collaborateur                        as saisi_par,
  l.nb_lignes,
  e.montant_ht,
  l.marge,
  l.cdc_origine,
  l.date_cdc,
  l.devis_origine,
  l.date_devis
from public.activite_entete e
left join public.v_req_client_rep cr on cr.code_client = e.numero_tiers
left join lateral (
  select
    count(*) filter (where coalesce(al.reference_article, '') <> '')                 as nb_lignes,
    sum(al.marge_valeur)                                                            as marge,
    string_agg(distinct al.numero_piece_bc, ', ')                                   as cdc_origine,
    min(al.date_bc) filter (where al.numero_piece_bc is not null)                   as date_cdc,
    string_agg(distinct al.numero_piece_devis, ', ')                                as devis_origine,
    min(al.date_devis) filter (where al.numero_piece_devis is not null)             as date_devis
  from public.activite_lignes al
  where al.numero_piece = e.numero_piece
) l on true;

-- 2. Lignes des documents de vente en cours
create or replace view public.v_req_lignes_documents_vente with (security_invoker = true) as
select
  al.type_document,
  al.numero_piece,
  al.date_piece,
  al.numero_tiers_entete                 as code_client,
  al.intitule_tiers_entete               as nom_client,
  cr.representant,
  cr.agence,
  al.depot,
  al.reference_article,
  coalesce(a.designation, al.designation) as designation,
  a.famille                              as famille_article,
  a.marque,
  al.quantite,
  al.pu_net,
  al.montant_ht,
  al.marge_valeur                        as marge,
  al.marge_pourcent,
  al.date_livraison,
  al.numero_piece_bc                     as numero_cdc,
  al.date_bc                             as date_cdc,
  al.numero_piece_devis                  as numero_devis
from public.activite_lignes al
left join public.v_req_client_rep cr on cr.code_client = al.numero_tiers_entete
left join public.ref_articles a on a.reference_article = al.reference_article;

-- 3. Lignes de factures
create or replace view public.v_req_factures_lignes with (security_invoker = true) as
select
  f.type_document,
  f.numero_piece                         as numero_facture,
  f.date_facture,
  f.numero_tiers_entete                  as code_client,
  f.intitule_tiers_entete                as nom_client,
  cr.representant,
  cr.agence,
  f.depot,
  f.reference_article,
  coalesce(a.designation, f.designation) as designation,
  a.famille                              as famille_article,
  a.marque,
  f.quantite,
  f.pu_net,
  f.montant_ht,
  f.marge_valeur                         as marge,
  f.marge_pourcent,
  f.numero_piece_bl                      as numero_bl,
  f.date_bl,
  f.numero_piece_bc                      as numero_cdc,
  f.date_bc                              as date_cdc,
  f.numero_piece_devis                   as numero_devis
from public.facture_lignes f
left join public.v_req_client_rep cr on cr.code_client = f.numero_tiers_entete
left join public.ref_articles a on a.reference_article = f.reference_article;

-- 4. Lignes de devis
create or replace view public.v_req_devis_lignes with (security_invoker = true) as
select
  d.numero_piece                         as numero_devis,
  d.date_devis,
  d.numero_tiers_entete                  as code_client,
  d.intitule_tiers_entete                as nom_client,
  cr.representant,
  cr.agence,
  d.depot,
  d.reference_article,
  coalesce(a.designation, d.designation) as designation,
  a.famille                              as famille_article,
  a.marque,
  d.quantite,
  d.pu_net,
  d.montant_ht,
  d.marge_valeur                         as marge,
  d.marge_pourcent
from public.devis_lignes d
left join public.v_req_client_rep cr on cr.code_client = d.numero_tiers_entete
left join public.ref_articles a on a.reference_article = d.reference_article
where d.type_document = 'Devis';

-- 5. Clients
create or replace view public.v_req_clients with (security_invoker = true) as
select
  t.numero                               as code_client,
  t.intitule                             as nom_client,
  case when t.prospect then 'Prospect' else 'Client' end as statut,
  cr.representant,
  cr.agence,
  cr.agence_fiche_client,
  t.adresse,
  t.code_postal,
  t.ville,
  t.telephone,
  t.email,
  t.siret,
  t.famille                              as famille_client,
  t.categorie_tarifaire,
  t.encours_autorise,
  t.solde_comptable,
  t.depot_rattachement,
  t.convention_cee,
  t.rge,
  t.date_creation,
  case when coalesce(t.mise_en_sommeil, false) then 'Oui' else 'Non' end as en_sommeil
from public.ref_tiers t
left join public.v_req_client_rep cr on cr.code_client = t.numero;

-- 6. Stock par dépôt
create or replace view public.v_req_stock_depot with (security_invoker = true) as
select
  s.reference_article,
  a.designation,
  a.famille                              as famille_article,
  a.marque,
  a.fournisseur_principal,
  s.depot,
  s.stock_reel,
  s.stock_reserve,
  s.stock_prepare,
  s.stock_disponible,
  s.stock_commande_fournisseur,
  s.stock_a_terme,
  case when coalesce(a.mise_en_sommeil, false) then 'Oui' else 'Non' end as en_sommeil,
  s.derniere_maj
from public.v_stock_par_depot_article s
left join public.ref_articles a on a.reference_article = s.reference_article;

grant select on public.v_req_client_rep, public.v_req_documents_vente, public.v_req_lignes_documents_vente,
  public.v_req_factures_lignes, public.v_req_devis_lignes, public.v_req_clients, public.v_req_stock_depot
  to authenticated;

-- ── Catalogue ───────────────────────────────────────────────────────────────
create table if not exists public.requeteur_sources (
  code         text primary key,
  libelle      text not null,
  description  text,
  icone        text,
  vue          text not null,
  ordre        int  not null default 100,
  tri_defaut   text,           -- code du champ de tri par défaut
  tri_sens     text not null default 'desc',
  actif        boolean not null default true
);

create table if not exists public.requeteur_champs (
  source          text not null references public.requeteur_sources(code) on delete cascade,
  code            text not null,          -- nom de colonne de la vue
  libelle         text not null,
  groupe          text not null default 'Général',
  type            text not null check (type in ('texte', 'liste', 'nombre', 'montant', 'pourcent', 'date')),
  description     text,
  ordre           int  not null default 100,
  par_defaut      boolean not null default false,
  valeurs_requete text,                   -- SQL de confiance (migration) donnant la liste de choix
  primary key (source, code)
);

alter table public.requeteur_sources enable row level security;
alter table public.requeteur_champs enable row level security;
drop policy if exists requeteur_sources_lecture on public.requeteur_sources;
create policy requeteur_sources_lecture on public.requeteur_sources for select to authenticated using (true);
drop policy if exists requeteur_champs_lecture on public.requeteur_champs;
create policy requeteur_champs_lecture on public.requeteur_champs for select to authenticated using (true);
grant select on public.requeteur_sources, public.requeteur_champs to authenticated;

-- Les sources sont mises à jour (upsert) pour ne pas supprimer les requêtes enregistrées.
delete from public.requeteur_champs where true;

insert into public.requeteur_sources (code, libelle, description, icone, vue, ordre, tri_defaut, tri_sens) values
  ('documents_vente', 'Documents de vente en cours',
   'Une ligne par document non facturé : commandes clients (CDC), préparations (PL), bons de livraison (BL), retours, avoirs. Avec la CDC d''origine, le nombre de lignes et la valeur.',
   '📄', 'v_req_documents_vente', 10, 'numero_piece', 'asc'),
  ('lignes_documents_vente', 'Lignes des documents en cours',
   'Le détail article par article des CDC, PL et BL non facturés.',
   '🧾', 'v_req_lignes_documents_vente', 20, 'date_piece', 'desc'),
  ('factures_lignes', 'Lignes de factures',
   'Le détail article par article de tout ce qui a été facturé (historique depuis 2023). Pensez à filtrer sur une période.',
   '💶', 'v_req_factures_lignes', 30, 'date_facture', 'desc'),
  ('devis_lignes', 'Lignes de devis',
   'Le détail article par article des devis. Pensez à filtrer sur une période.',
   '📝', 'v_req_devis_lignes', 40, 'date_devis', 'desc'),
  ('clients', 'Clients et prospects',
   'La fiche client : coordonnées, représentant, agence, encours, conventions.',
   '👥', 'v_req_clients', 50, 'nom_client', 'asc'),
  ('stock_depot', 'Stock par dépôt',
   'Stock réel, réservé, préparé, disponible et à terme de chaque article dans chaque dépôt.',
   '📦', 'v_req_stock_depot', 60, 'reference_article', 'asc')
on conflict (code) do update set libelle = excluded.libelle, description = excluded.description, icone = excluded.icone,
  vue = excluded.vue, ordre = excluded.ordre, tri_defaut = excluded.tri_defaut, tri_sens = excluded.tri_sens, actif = true;

-- Listes de choix réutilisées
-- (le texte $L$…$L$ est du SQL de confiance exécuté par requeteur_valeurs)
insert into public.requeteur_champs (source, code, libelle, groupe, type, ordre, par_defaut, description, valeurs_requete) values
  -- 1. Documents de vente en cours
  ('documents_vente', 'type_document', 'Type de document', 'Document', 'liste', 10, true, 'CDC, PL, BL, retour, avoir.',
   $L$select unnest(array['Commande client (CDC)','Préparation de livraison (PL)','Bon de livraison (BL)','Bon de retour (BR)','Bon d''avoir (BA)'])$L$),
  ('documents_vente', 'numero_piece', 'N° de document', 'Document', 'texte', 20, true, null, null),
  ('documents_vente', 'date_piece', 'Date du document', 'Document', 'date', 30, true, 'Date de création du document dans SAGE.', null),
  ('documents_vente', 'date_livraison', 'Date de livraison prévue', 'Document', 'date', 40, false, null, null),
  ('documents_vente', 'date_livraison_realisee', 'Date de livraison réalisée', 'Document', 'date', 45, false, null, null),
  ('documents_vente', 'reference_client', 'Référence client', 'Document', 'texte', 50, false, 'Référence saisie sur le document (chantier, n° de commande du client…).', null),
  ('documents_vente', 'agence', 'Agence', 'Client', 'liste', 60, true, 'Agence du représentant de la fiche client (à défaut, agence de la fiche client).',
   $L$select distinct agence from public.v_req_client_rep where agence is not null$L$),
  ('documents_vente', 'agence_fiche_client', 'Agence de la fiche client', 'Client', 'liste', 65, false, 'Agence de rattachement saisie sur la fiche client SAGE.',
   $L$select distinct agence_rattachement from public.ref_tiers where agence_rattachement is not null$L$),
  ('documents_vente', 'code_client', 'Code client', 'Client', 'texte', 70, true, null, null),
  ('documents_vente', 'nom_client', 'Nom du client', 'Client', 'texte', 80, true, null, null),
  ('documents_vente', 'ville_client', 'Ville du client', 'Client', 'texte', 85, false, null, null),
  ('documents_vente', 'representant', 'Représentant', 'Client', 'liste', 90, true, 'Représentant actuel de la fiche client.',
   $L$select distinct representant from public.v_req_client_rep where representant is not null$L$),
  ('documents_vente', 'cdc_origine', 'CDC d''origine', 'Origine', 'texte', 100, false, 'Commande(s) client livrée(s) ou préparée(s) par ce document. Vide pour un BL direct (comptoir).', null),
  ('documents_vente', 'date_cdc', 'Date de la CDC', 'Origine', 'date', 110, false, null, null),
  ('documents_vente', 'devis_origine', 'Devis d''origine', 'Origine', 'texte', 120, false, null, null),
  ('documents_vente', 'date_devis', 'Date du devis', 'Origine', 'date', 130, false, null, null),
  ('documents_vente', 'depot', 'Dépôt', 'Logistique', 'liste', 140, true, 'Dépôt de stockage du document.',
   $L$select distinct depot_stockage from public.activite_entete where depot_stockage is not null$L$),
  ('documents_vente', 'mode_expedition', 'Mode d''expédition', 'Logistique', 'liste', 150, false, null,
   $L$select distinct expedition from public.activite_entete where expedition is not null$L$),
  ('documents_vente', 'lieu_livraison', 'Lieu de livraison', 'Logistique', 'texte', 160, false, null, null),
  ('documents_vente', 'nb_lignes', 'Nombre de lignes', 'Chiffres', 'nombre', 170, false, 'Lignes article (hors lignes de commentaire).', null),
  ('documents_vente', 'montant_ht', 'Valeur HT', 'Chiffres', 'montant', 180, true, 'Total HT net du document (port compris).', null),
  ('documents_vente', 'marge', 'Marge', 'Chiffres', 'montant', 190, false, null, null),
  ('documents_vente', 'saisi_par', 'Saisi par', 'Document', 'texte', 200, false, 'Auteur du document dans SAGE (texte libre).', null),

  -- 2. Lignes des documents en cours
  ('lignes_documents_vente', 'type_document', 'Type de document', 'Document', 'liste', 10, true, null,
   $L$select distinct type_document from public.activite_lignes where type_document is not null$L$),
  ('lignes_documents_vente', 'numero_piece', 'N° de document', 'Document', 'texte', 20, true, null, null),
  ('lignes_documents_vente', 'date_piece', 'Date du document', 'Document', 'date', 30, true, null, null),
  ('lignes_documents_vente', 'date_livraison', 'Date de livraison prévue', 'Document', 'date', 40, false, null, null),
  ('lignes_documents_vente', 'numero_cdc', 'N° de CDC', 'Origine', 'texte', 50, false, null, null),
  ('lignes_documents_vente', 'date_cdc', 'Date de la CDC', 'Origine', 'date', 55, false, null, null),
  ('lignes_documents_vente', 'numero_devis', 'N° de devis', 'Origine', 'texte', 58, false, null, null),
  ('lignes_documents_vente', 'agence', 'Agence', 'Client', 'liste', 60, false, 'Agence du représentant de la fiche client.',
   $L$select distinct agence from public.v_req_client_rep where agence is not null$L$),
  ('lignes_documents_vente', 'code_client', 'Code client', 'Client', 'texte', 70, true, null, null),
  ('lignes_documents_vente', 'nom_client', 'Nom du client', 'Client', 'texte', 80, true, null, null),
  ('lignes_documents_vente', 'representant', 'Représentant', 'Client', 'liste', 90, false, null,
   $L$select distinct representant from public.v_req_client_rep where representant is not null$L$),
  ('lignes_documents_vente', 'depot', 'Dépôt', 'Logistique', 'liste', 100, false, null,
   $L$select distinct depot from public.activite_lignes where depot is not null$L$),
  ('lignes_documents_vente', 'reference_article', 'Référence article', 'Article', 'texte', 110, true, null, null),
  ('lignes_documents_vente', 'designation', 'Désignation', 'Article', 'texte', 120, true, null, null),
  ('lignes_documents_vente', 'famille_article', 'Famille article', 'Article', 'liste', 130, false, null,
   $L$select distinct famille from public.ref_articles where famille is not null$L$),
  ('lignes_documents_vente', 'marque', 'Marque', 'Article', 'liste', 140, false, null,
   $L$select distinct marque from public.ref_articles where marque is not null$L$),
  ('lignes_documents_vente', 'quantite', 'Quantité', 'Chiffres', 'nombre', 150, true, null, null),
  ('lignes_documents_vente', 'pu_net', 'Prix unitaire net', 'Chiffres', 'montant', 160, false, null, null),
  ('lignes_documents_vente', 'montant_ht', 'Montant HT', 'Chiffres', 'montant', 170, true, null, null),
  ('lignes_documents_vente', 'marge', 'Marge', 'Chiffres', 'montant', 180, false, null, null),
  ('lignes_documents_vente', 'marge_pourcent', 'Taux de marge', 'Chiffres', 'pourcent', 190, false, null, null),

  -- 3. Lignes de factures
  ('factures_lignes', 'type_document', 'Type', 'Facture', 'liste', 10, false, null,
   $L$select unnest(array['Facture','Facture comptabilisée'])$L$),
  ('factures_lignes', 'numero_facture', 'N° de facture', 'Facture', 'texte', 20, true, null, null),
  ('factures_lignes', 'date_facture', 'Date de facture', 'Facture', 'date', 30, true, null, null),
  ('factures_lignes', 'numero_bl', 'N° de BL', 'Origine', 'texte', 40, false, null, null),
  ('factures_lignes', 'date_bl', 'Date du BL', 'Origine', 'date', 45, false, null, null),
  ('factures_lignes', 'numero_cdc', 'N° de CDC', 'Origine', 'texte', 50, false, null, null),
  ('factures_lignes', 'date_cdc', 'Date de la CDC', 'Origine', 'date', 55, false, null, null),
  ('factures_lignes', 'numero_devis', 'N° de devis', 'Origine', 'texte', 58, false, null, null),
  ('factures_lignes', 'agence', 'Agence', 'Client', 'liste', 60, true, 'Agence du représentant actuel de la fiche client.',
   $L$select distinct agence from public.v_req_client_rep where agence is not null$L$),
  ('factures_lignes', 'code_client', 'Code client', 'Client', 'texte', 70, true, null, null),
  ('factures_lignes', 'nom_client', 'Nom du client', 'Client', 'texte', 80, true, null, null),
  ('factures_lignes', 'representant', 'Représentant', 'Client', 'liste', 90, true, 'Représentant actuel de la fiche client.',
   $L$select distinct representant from public.v_req_client_rep where representant is not null$L$),
  ('factures_lignes', 'depot', 'Dépôt', 'Logistique', 'liste', 100, false, null,
   $L$select distinct depot_stockage from public.activite_entete where depot_stockage is not null$L$),
  ('factures_lignes', 'reference_article', 'Référence article', 'Article', 'texte', 110, true, null, null),
  ('factures_lignes', 'designation', 'Désignation', 'Article', 'texte', 120, true, null, null),
  ('factures_lignes', 'famille_article', 'Famille article', 'Article', 'liste', 130, false, null,
   $L$select distinct famille from public.ref_articles where famille is not null$L$),
  ('factures_lignes', 'marque', 'Marque', 'Article', 'liste', 140, false, null,
   $L$select distinct marque from public.ref_articles where marque is not null$L$),
  ('factures_lignes', 'quantite', 'Quantité', 'Chiffres', 'nombre', 150, true, null, null),
  ('factures_lignes', 'pu_net', 'Prix unitaire net', 'Chiffres', 'montant', 160, false, null, null),
  ('factures_lignes', 'montant_ht', 'Montant HT', 'Chiffres', 'montant', 170, true, null, null),
  ('factures_lignes', 'marge', 'Marge', 'Chiffres', 'montant', 180, false, null, null),
  ('factures_lignes', 'marge_pourcent', 'Taux de marge', 'Chiffres', 'pourcent', 190, false, null, null),

  -- 4. Lignes de devis
  ('devis_lignes', 'numero_devis', 'N° de devis', 'Devis', 'texte', 10, true, null, null),
  ('devis_lignes', 'date_devis', 'Date du devis', 'Devis', 'date', 20, true, null, null),
  ('devis_lignes', 'agence', 'Agence', 'Client', 'liste', 30, true, null,
   $L$select distinct agence from public.v_req_client_rep where agence is not null$L$),
  ('devis_lignes', 'code_client', 'Code client', 'Client', 'texte', 40, true, null, null),
  ('devis_lignes', 'nom_client', 'Nom du client', 'Client', 'texte', 50, true, null, null),
  ('devis_lignes', 'representant', 'Représentant', 'Client', 'liste', 60, true, null,
   $L$select distinct representant from public.v_req_client_rep where representant is not null$L$),
  ('devis_lignes', 'depot', 'Dépôt', 'Logistique', 'liste', 70, false, null,
   $L$select distinct depot_stockage from public.activite_entete where depot_stockage is not null$L$),
  ('devis_lignes', 'reference_article', 'Référence article', 'Article', 'texte', 80, true, null, null),
  ('devis_lignes', 'designation', 'Désignation', 'Article', 'texte', 90, true, null, null),
  ('devis_lignes', 'famille_article', 'Famille article', 'Article', 'liste', 100, false, null,
   $L$select distinct famille from public.ref_articles where famille is not null$L$),
  ('devis_lignes', 'marque', 'Marque', 'Article', 'liste', 110, false, null,
   $L$select distinct marque from public.ref_articles where marque is not null$L$),
  ('devis_lignes', 'quantite', 'Quantité', 'Chiffres', 'nombre', 120, true, null, null),
  ('devis_lignes', 'pu_net', 'Prix unitaire net', 'Chiffres', 'montant', 130, false, null, null),
  ('devis_lignes', 'montant_ht', 'Montant HT', 'Chiffres', 'montant', 140, true, null, null),
  ('devis_lignes', 'marge', 'Marge', 'Chiffres', 'montant', 150, false, null, null),
  ('devis_lignes', 'marge_pourcent', 'Taux de marge', 'Chiffres', 'pourcent', 160, false, null, null),

  -- 5. Clients
  ('clients', 'code_client', 'Code client', 'Client', 'texte', 10, true, null, null),
  ('clients', 'nom_client', 'Nom du client', 'Client', 'texte', 20, true, null, null),
  ('clients', 'statut', 'Client / prospect', 'Client', 'liste', 30, false, null, $L$select unnest(array['Client','Prospect'])$L$),
  ('clients', 'agence', 'Agence', 'Suivi commercial', 'liste', 40, true, 'Agence du représentant de la fiche client.',
   $L$select distinct agence from public.v_req_client_rep where agence is not null$L$),
  ('clients', 'agence_fiche_client', 'Agence de la fiche client', 'Suivi commercial', 'liste', 45, false, null,
   $L$select distinct agence_rattachement from public.ref_tiers where agence_rattachement is not null$L$),
  ('clients', 'representant', 'Représentant', 'Suivi commercial', 'liste', 50, true, null,
   $L$select distinct representant from public.v_req_client_rep where representant is not null$L$),
  ('clients', 'famille_client', 'Famille client', 'Suivi commercial', 'liste', 60, false, null,
   $L$select distinct famille from public.ref_tiers where famille is not null$L$),
  ('clients', 'categorie_tarifaire', 'Catégorie tarifaire', 'Suivi commercial', 'liste', 70, false, null,
   $L$select distinct categorie_tarifaire from public.ref_tiers where categorie_tarifaire is not null$L$),
  ('clients', 'adresse', 'Adresse', 'Coordonnées', 'texte', 80, false, null, null),
  ('clients', 'code_postal', 'Code postal', 'Coordonnées', 'texte', 90, true, null, null),
  ('clients', 'ville', 'Ville', 'Coordonnées', 'texte', 100, true, null, null),
  ('clients', 'telephone', 'Téléphone', 'Coordonnées', 'texte', 110, false, null, null),
  ('clients', 'email', 'E-mail', 'Coordonnées', 'texte', 120, false, null, null),
  ('clients', 'siret', 'SIRET', 'Coordonnées', 'texte', 130, false, null, null),
  ('clients', 'encours_autorise', 'Encours autorisé', 'Finances', 'montant', 140, false, null, null),
  ('clients', 'solde_comptable', 'Solde comptable', 'Finances', 'montant', 150, false, null, null),
  ('clients', 'depot_rattachement', 'Dépôt de rattachement', 'Logistique', 'liste', 160, false, null,
   $L$select distinct depot_rattachement from public.ref_tiers where depot_rattachement is not null$L$),
  ('clients', 'convention_cee', 'Convention CEE', 'Conventions', 'liste', 170, false, null,
   $L$select distinct convention_cee from public.ref_tiers where convention_cee is not null$L$),
  ('clients', 'rge', 'RGE', 'Conventions', 'liste', 180, false, null,
   $L$select distinct rge from public.ref_tiers where rge is not null$L$),
  ('clients', 'date_creation', 'Date de création', 'Client', 'date', 190, false, null, null),
  ('clients', 'en_sommeil', 'En sommeil', 'Client', 'liste', 200, false, null, $L$select unnest(array['Oui','Non'])$L$),

  -- 6. Stock par dépôt
  ('stock_depot', 'reference_article', 'Référence article', 'Article', 'texte', 10, true, null, null),
  ('stock_depot', 'designation', 'Désignation', 'Article', 'texte', 20, true, null, null),
  ('stock_depot', 'famille_article', 'Famille article', 'Article', 'liste', 30, false, null,
   $L$select distinct famille from public.ref_articles where famille is not null$L$),
  ('stock_depot', 'marque', 'Marque', 'Article', 'liste', 40, false, null,
   $L$select distinct marque from public.ref_articles where marque is not null$L$),
  ('stock_depot', 'fournisseur_principal', 'Fournisseur principal', 'Article', 'texte', 50, false, null, null),
  ('stock_depot', 'en_sommeil', 'Article en sommeil', 'Article', 'liste', 55, false, null, $L$select unnest(array['Oui','Non'])$L$),
  ('stock_depot', 'depot', 'Dépôt', 'Stock', 'liste', 60, true, null,
   $L$select distinct depot from public.v_stock_par_depot_article where depot is not null$L$),
  ('stock_depot', 'stock_reel', 'Stock réel', 'Stock', 'nombre', 70, true, null, null),
  ('stock_depot', 'stock_reserve', 'Réservé (CDC)', 'Stock', 'nombre', 80, false, null, null),
  ('stock_depot', 'stock_prepare', 'Préparé (PL)', 'Stock', 'nombre', 90, false, null, null),
  ('stock_depot', 'stock_disponible', 'Disponible', 'Stock', 'nombre', 100, true, null, null),
  ('stock_depot', 'stock_commande_fournisseur', 'En commande fournisseur', 'Stock', 'nombre', 110, false, null, null),
  ('stock_depot', 'stock_a_terme', 'Stock à terme', 'Stock', 'nombre', 120, false, null, null);

-- ── Requêtes enregistrées ───────────────────────────────────────────────────
create table if not exists public.requeteur_modeles (
  id           uuid primary key default gen_random_uuid(),
  nom          text not null,
  description  text,
  source       text not null references public.requeteur_sources(code) on delete cascade,
  definition   jsonb not null,         -- { champs: [], filtres: [], tri: [] }
  partage      boolean not null default false,
  created_by   text not null default lower(auth.jwt() ->> 'email'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.requeteur_modeles enable row level security;
drop policy if exists requeteur_modeles_lecture on public.requeteur_modeles;
create policy requeteur_modeles_lecture on public.requeteur_modeles for select to authenticated
  using (public.requeteur_autorise() and (partage or created_by = lower(auth.jwt() ->> 'email')));
drop policy if exists requeteur_modeles_ecriture on public.requeteur_modeles;
create policy requeteur_modeles_ecriture on public.requeteur_modeles for all to authenticated
  using (public.requeteur_autorise() and created_by = lower(auth.jwt() ->> 'email'))
  with check (public.requeteur_autorise() and created_by = lower(auth.jwt() ->> 'email'));
grant select, insert, update, delete on public.requeteur_modeles to authenticated;

-- ── RPC : catalogue ─────────────────────────────────────────────────────────
create or replace function public.requeteur_catalogue()
returns jsonb
language plpgsql stable security invoker
set search_path = public
as $$
begin
  if not public.requeteur_autorise() then
    raise exception 'Requêteur réservé aux administrateurs du compagnon.';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'code', s.code, 'libelle', s.libelle, 'description', s.description, 'icone', s.icone,
      'tri_defaut', s.tri_defaut, 'tri_sens', s.tri_sens,
      'champs', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'code', c.code, 'libelle', c.libelle, 'groupe', c.groupe, 'type', c.type,
          'description', c.description, 'par_defaut', c.par_defaut,
          'a_valeurs', c.valeurs_requete is not null
        ) order by c.ordre), '[]'::jsonb)
        from public.requeteur_champs c where c.source = s.code
      )
    ) order by s.ordre), '[]'::jsonb)
    from public.requeteur_sources s where s.actif
  );
end;
$$;
grant execute on function public.requeteur_catalogue() to authenticated;

-- ── RPC : valeurs proposées pour un champ « liste » ─────────────────────────
create or replace function public.requeteur_valeurs(p_source text, p_champ text)
returns text[]
language plpgsql stable security invoker
set search_path = public
as $$
declare
  v_sql text;
  v_res text[];
begin
  if not public.requeteur_autorise() then
    raise exception 'Requêteur réservé aux administrateurs du compagnon.';
  end if;
  select valeurs_requete into v_sql from public.requeteur_champs where source = p_source and code = p_champ;
  if v_sql is null then return array[]::text[]; end if;
  execute format('select array(select v from (select trim(x::text) as v from (%s) q(x)) z where v <> '''' group by v order by v limit 500)', v_sql)
    into v_res;
  return coalesce(v_res, array[]::text[]);
end;
$$;
grant execute on function public.requeteur_valeurs(text, text) to authenticated;

-- ── Traduction d'un filtre en condition SQL ─────────────────────────────────
-- filtre = { champ, operateur, valeur, valeur2, valeurs[] }
create or replace function public.requeteur_condition(p_type text, p_champ text, p_filtre jsonb)
returns text
language plpgsql stable
set search_path = public
as $$
declare
  col  text := format('%I', p_champ);
  op   text := coalesce(p_filtre ->> 'operateur', '');
  v1   text := nullif(trim(coalesce(p_filtre ->> 'valeur', '')), '');
  v2   text := nullif(trim(coalesce(p_filtre ->> 'valeur2', '')), '');
  vals text[];
  j    date := (now() at time zone 'Europe/Paris')::date;
  d1   date;
  d2   date;
  cast_num text;
begin
  select array_agg(trim(x)) into vals
  from jsonb_array_elements_text(coalesce(p_filtre -> 'valeurs', '[]'::jsonb)) x
  where trim(x) <> '';

  if op = 'vide' then
    return case when p_type in ('texte', 'liste') then format('coalesce(trim(%s::text), '''') = ''''', col) else format('%s is null', col) end;
  elsif op = 'non_vide' then
    return case when p_type in ('texte', 'liste') then format('coalesce(trim(%s::text), '''') <> ''''', col) else format('%s is not null', col) end;
  end if;

  -- Texte / liste
  if p_type in ('texte', 'liste') then
    if op in ('parmi', 'hors') then
      if vals is null then return null; end if;
      return format('%s %s (%s)', case when op = 'hors' then format('coalesce(upper(trim(%s::text)), '''')', col) else format('upper(trim(%s::text))', col) end,
                    case when op = 'hors' then 'not in' else 'in' end,
                    (select string_agg(quote_literal(upper(x)), ', ') from unnest(vals) x));
    end if;
    if v1 is null then return null; end if;
    return case op
      when 'est'       then format('upper(trim(%s::text)) = upper(%L)', col, v1)
      when 'n_est_pas' then format('coalesce(upper(trim(%s::text)), '''') <> upper(%L)', col, v1)
      when 'contient'  then format('%s::text ilike %L', col, '%' || v1 || '%')
      when 'ne_contient_pas' then format('coalesce(%s::text, '''') not ilike %L', col, '%' || v1 || '%')
      when 'commence'  then format('%s::text ilike %L', col, v1 || '%')
      else null end;
  end if;

  -- Nombres
  if p_type in ('nombre', 'montant', 'pourcent') then
    if v1 is not null and replace(v1, ',', '.') !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'Valeur numérique invalide : %', v1; end if;
    if v2 is not null and replace(v2, ',', '.') !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'Valeur numérique invalide : %', v2; end if;
    v1 := replace(v1, ',', '.'); v2 := replace(v2, ',', '.');
    if v1 is null then return null; end if;
    return case op
      when 'egal'     then format('%s = %s', col, v1)
      when 'different' then format('%s is distinct from %s', col, v1)
      when 'sup'      then format('%s > %s', col, v1)
      when 'sup_egal' then format('%s >= %s', col, v1)
      when 'inf'      then format('%s < %s', col, v1)
      when 'inf_egal' then format('%s <= %s', col, v1)
      when 'entre'    then case when v2 is null then null else format('%s between %s and %s', col, v1, v2) end
      else null end;
  end if;

  -- Dates
  if p_type = 'date' then
    if op = 'periode' then
      case v1
        when 'aujourdhui'          then d1 := j; d2 := j;
        when 'hier'                then d1 := j - 1; d2 := j - 1;
        when 'demain'              then d1 := j + 1; d2 := j + 1;
        when '7_derniers_jours'    then d1 := j - 6; d2 := j;
        when '30_derniers_jours'   then d1 := j - 29; d2 := j;
        when 'semaine_en_cours'    then d1 := date_trunc('week', j)::date; d2 := d1 + 6;
        when 'semaine_derniere'    then d1 := date_trunc('week', j)::date - 7; d2 := d1 + 6;
        when 'mois_en_cours'       then d1 := date_trunc('month', j)::date; d2 := (d1 + interval '1 month')::date - 1;
        when 'mois_dernier'        then d1 := (date_trunc('month', j) - interval '1 month')::date; d2 := date_trunc('month', j)::date - 1;
        when '3_derniers_mois'     then d1 := (date_trunc('month', j) - interval '2 months')::date; d2 := j;
        when 'annee_en_cours'      then d1 := date_trunc('year', j)::date; d2 := (d1 + interval '1 year')::date - 1;
        when 'annee_derniere'      then d1 := (date_trunc('year', j) - interval '1 year')::date; d2 := date_trunc('year', j)::date - 1;
        when '7_prochains_jours'   then d1 := j; d2 := j + 6;
        when 'mois_prochain'       then d1 := (date_trunc('month', j) + interval '1 month')::date; d2 := (date_trunc('month', j) + interval '2 months')::date - 1;
        else return null;
      end case;
      return format('%s between %L::date and %L::date', col, d1, d2);
    end if;
    if v1 is null then return null; end if;
    return case op
      when 'le'     then format('%s = %L::date', col, v1::date)
      when 'depuis' then format('%s >= %L::date', col, v1::date)
      when 'avant'  then format('%s <= %L::date', col, v1::date)
      when 'entre'  then case when v2 is null then null else format('%s between %L::date and %L::date', col, v1::date, v2::date) end
      else null end;
  end if;

  return null;
end;
$$;

-- ── RPC : exécution ─────────────────────────────────────────────────────────
-- Retour : { colonnes:[{code,libelle,type}], lignes:[[...]], nb, tronque,
--            estimation:{lignes, cout}, alerte:{niveau,message} | null, duree_ms }
-- Si la requête est jugée lourde et p_forcer = false, aucune donnée n'est
-- renvoyée : seulement l'alerte, que l'écran affiche avec « Lancer quand même ».
create or replace function public.requeteur_executer(
  p_source  text,
  p_champs  text[],
  p_filtres jsonb   default '[]'::jsonb,
  p_tri     jsonb   default '[]'::jsonb,
  p_limite  int     default 5000,
  p_forcer  boolean default false
)
returns jsonb
language plpgsql volatile security invoker
set search_path = public
as $$
declare
  v_src     public.requeteur_sources%rowtype;
  v_cols    jsonb;
  v_select  text;
  v_where   text := 'true';
  v_order   text := '';
  v_sql     text;
  v_plan    json;
  v_cout    numeric;
  v_est     numeric;
  v_res     jsonb;
  v_nb      int;
  v_limite  int := least(greatest(coalesce(p_limite, 5000), 1), 20000);
  v_debut   timestamptz := clock_timestamp();
  v_alerte  jsonb := null;
  f         jsonb;
  t         jsonb;
  v_type    text;
  v_cond    text;
  v_sens    text;
  -- Seuils d'alerte (coût du plan Postgres, lignes estimées)
  c_cout_lourd    constant numeric := 400000;
  c_cout_bloquant constant numeric := 4000000;
  c_lignes_lourd  constant numeric := 20000;
begin
  if not public.requeteur_autorise() then
    raise exception 'Requêteur réservé aux administrateurs du compagnon.';
  end if;

  select * into v_src from public.requeteur_sources where code = p_source and actif;
  if not found then raise exception 'Source inconnue : %', p_source; end if;

  -- Colonnes demandées, dans l'ordre choisi, validées par le catalogue
  select jsonb_agg(jsonb_build_object('code', c.code, 'libelle', c.libelle, 'type', c.type) order by x.ord),
         string_agg(format('%I', c.code), ', ' order by x.ord)
    into v_cols, v_select
  from unnest(p_champs) with ordinality x(code, ord)
  join public.requeteur_champs c on c.source = p_source and c.code = x.code;
  if v_select is null then raise exception 'Choisissez au moins une colonne.'; end if;

  -- Filtres
  for f in select * from jsonb_array_elements(coalesce(p_filtres, '[]'::jsonb)) loop
    select type into v_type from public.requeteur_champs where source = p_source and code = f ->> 'champ';
    if v_type is null then raise exception 'Filtre sur un champ inconnu : %', f ->> 'champ'; end if;
    v_cond := public.requeteur_condition(v_type, f ->> 'champ', f);
    if v_cond is not null then v_where := v_where || ' and ' || v_cond; end if;
  end loop;

  -- Tri
  for t in select * from jsonb_array_elements(coalesce(p_tri, '[]'::jsonb)) loop
    if exists (select 1 from public.requeteur_champs where source = p_source and code = t ->> 'champ') then
      v_sens := case when lower(t ->> 'sens') = 'desc' then 'desc nulls last' else 'asc nulls last' end;
      v_order := v_order || case when v_order = '' then '' else ', ' end || format('%I %s', t ->> 'champ', v_sens);
    end if;
  end loop;
  if v_order = '' and v_src.tri_defaut is not null then
    v_order := format('%I %s nulls last', v_src.tri_defaut, case when v_src.tri_sens = 'desc' then 'desc' else 'asc' end);
  end if;

  v_sql := format('select %s from public.%I where %s', v_select, v_src.vue, v_where)
           || case when v_order <> '' then ' order by ' || v_order else '' end;

  -- Estimation (plan Postgres, sans exécuter)
  execute 'explain (format json) ' || v_sql into v_plan;
  v_cout := (v_plan -> 0 -> 'Plan' ->> 'Total Cost')::numeric;
  v_est  := (v_plan -> 0 -> 'Plan' ->> 'Plan Rows')::numeric;

  if v_cout > c_cout_bloquant then
    v_alerte := jsonb_build_object('niveau', 'bloquant',
      'message', format('Requête beaucoup trop lourde (environ %s lignes à parcourir). Ajoutez un filtre, par exemple une période sur une date, ou un client, une agence, un article.',
                        to_char(v_est, 'FM999G999G999')));
  elsif v_cout > c_cout_lourd or v_est > c_lignes_lourd then
    v_alerte := jsonb_build_object('niveau', 'lourd',
      'message', format('Requête lourde : environ %s lignes attendues. Elle peut prendre jusqu''à 30 secondes et la liste sera limitée à %s lignes. Un filtre supplémentaire (période, agence, client…) la rendra plus rapide.',
                        to_char(v_est, 'FM999G999G999'), to_char(v_limite, 'FM999G999')));
  end if;

  if v_alerte is not null and ((v_alerte ->> 'niveau') = 'bloquant' or not p_forcer) then
    return jsonb_build_object('colonnes', v_cols, 'lignes', '[]'::jsonb, 'nb', 0, 'tronque', false,
      'executee', false, 'alerte', v_alerte,
      'estimation', jsonb_build_object('lignes', v_est, 'cout', round(v_cout)),
      'duree_ms', round(extract(epoch from clock_timestamp() - v_debut) * 1000));
  end if;

  execute format('select coalesce(jsonb_agg(jsonb_build_array(%s)), ''[]''::jsonb) from (%s limit %s) q',
                 v_select, v_sql, v_limite + 1)
    into v_res;
  v_nb := jsonb_array_length(v_res);
  if v_nb > v_limite then
    v_res := v_res - v_limite;   -- retire la ligne témoin
  end if;

  return jsonb_build_object(
    'colonnes', v_cols,
    'lignes', v_res,
    'nb', least(v_nb, v_limite),
    'tronque', v_nb > v_limite,
    'limite', v_limite,
    'executee', true,
    'alerte', v_alerte,
    'estimation', jsonb_build_object('lignes', v_est, 'cout', round(v_cout)),
    'duree_ms', round(extract(epoch from clock_timestamp() - v_debut) * 1000));
end;
$$;
grant execute on function public.requeteur_executer(text, text[], jsonb, jsonb, int, boolean) to authenticated;
