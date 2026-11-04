-- ============================================================================
-- 20261104_hotline_gamme_vues_eclatees.sql — Hotline technique (04/11/2026)
-- ----------------------------------------------------------------------------
-- 1. Gamme thermique : GAINABLE, RR (air/air), RO (air/eau) sur les parcours et
--    les tickets ; la console demande la gamme après « Thermie ». Les parcours
--    PAC existants passent en RO. Import Excel : colonne « Gamme ».
-- 2. Vues éclatées interactives : une image par référence article
--    (hotline_vues_eclatees) et ses repères (hotline_vue_pieces : position du
--    numéro et de la pièce en % de l'image, libellé, référence pièce, stock).
--    Les données de RAK-DJ35RHAE sont une DÉMONSTRATION (simulation = true) :
--    image fournie par Arnaud, nomenclature, références et stocks fictifs.
-- 3. Demandes de pièces au SAV (hotline_demandes_pieces) + étape DEMANDE_PIECE.
-- 4. Profils « Hotline niveau 1 » (can_hotline) et « Hotline niveau 2 »
--    (can_hotline + can_hotline_expert, atterrissage /hotline/escalades).
-- 5. Parcours de démonstration TH-RR-EXP-1 (Mural Airhome 400) qui propose la
--    vue éclatée RAK-DJ35RHAE (document de type VUE_ECLATEE, url vue:<réf>).
-- ============================================================================

-- 1. Gamme ---------------------------------------------------------------------
alter table public.hotline_arbres add column if not exists gamme text;
alter table public.hotline_arbres drop constraint if exists hotline_arbres_gamme_check;
alter table public.hotline_arbres add constraint hotline_arbres_gamme_check check (gamme is null or gamme in ('GAINABLE', 'RR', 'RO'));
alter table public.hotline_tickets add column if not exists gamme text;
alter table public.hotline_tickets drop constraint if exists hotline_tickets_gamme_check;
alter table public.hotline_tickets add constraint hotline_tickets_gamme_check check (gamme is null or gamme in ('GAINABLE', 'RR', 'RO'));

update public.hotline_arbres set gamme = 'RO'
where filiere = 'THERMIQUE' and gamme is null and (famille ilike '%PAC%' or nom ilike '%air/eau%' or nom ilike '%PAC%');

-- 2. Vues éclatées ---------------------------------------------------------------
create table if not exists public.hotline_vues_eclatees (
  id                uuid primary key default gen_random_uuid(),
  reference_article text not null,
  titre             text not null,
  image_url         text not null,
  largeur           int not null,
  hauteur           int not null,
  simulation        boolean not null default true,
  updated_at        timestamptz not null default now()
);
create unique index if not exists ux_hotline_vues_ref on public.hotline_vues_eclatees (upper(reference_article));

create table if not exists public.hotline_vue_pieces (
  id              uuid primary key default gen_random_uuid(),
  vue_id          uuid not null references public.hotline_vues_eclatees(id) on delete cascade,
  repere          text not null,
  libelle         text not null,
  reference_piece text,
  label_x         numeric not null,
  label_y         numeric not null,
  cible_x         numeric not null,
  cible_y         numeric not null,
  prix_ht         numeric,
  stock_fms       int,
  stock_agence    int,
  delai_reappro   text,
  ordre           int not null default 0
);
create unique index if not exists ux_hotline_vue_pieces on public.hotline_vue_pieces (vue_id, repere);

alter table public.hotline_vues_eclatees enable row level security;
alter table public.hotline_vue_pieces enable row level security;
drop policy if exists hotline_vues_lecture on public.hotline_vues_eclatees;
create policy hotline_vues_lecture on public.hotline_vues_eclatees for select to authenticated using (public.hotline_peut_acceder());
drop policy if exists hotline_vues_expert on public.hotline_vues_eclatees;
create policy hotline_vues_expert on public.hotline_vues_eclatees for all to authenticated using (public.hotline_est_expert()) with check (public.hotline_est_expert());
drop policy if exists hotline_vue_pieces_lecture on public.hotline_vue_pieces;
create policy hotline_vue_pieces_lecture on public.hotline_vue_pieces for select to authenticated using (public.hotline_peut_acceder());
drop policy if exists hotline_vue_pieces_expert on public.hotline_vue_pieces;
create policy hotline_vue_pieces_expert on public.hotline_vue_pieces for all to authenticated using (public.hotline_est_expert()) with check (public.hotline_est_expert());
grant select, insert, update, delete on public.hotline_vues_eclatees, public.hotline_vue_pieces to authenticated;

-- 3. Demandes de pièces ----------------------------------------------------------
create table if not exists public.hotline_demandes_pieces (
  id              uuid primary key default gen_random_uuid(),
  ticket_id       uuid references public.hotline_tickets(id) on delete set null,
  reference_article text,
  repere          text,
  libelle         text not null,
  reference_piece text,
  quantite        int not null default 1 check (quantite > 0),
  numero_tiers    text,
  intitule_tiers  text,
  chantier        text,
  destinataire    text,
  commentaire     text,
  statut          text not null default 'DEMANDEE' check (statut in ('DEMANDEE', 'EXPEDIEE', 'ANNULEE')),
  simulation      boolean not null default true,
  demande_par     text not null default public.current_user_email(),
  demande_le      timestamptz not null default now()
);
create index if not exists idx_hotline_demandes_ticket on public.hotline_demandes_pieces (ticket_id);
alter table public.hotline_demandes_pieces enable row level security;
drop policy if exists hotline_demandes_acces on public.hotline_demandes_pieces;
create policy hotline_demandes_acces on public.hotline_demandes_pieces for all to authenticated
  using (public.hotline_peut_acceder()) with check (public.hotline_peut_acceder());
grant select, insert, update on public.hotline_demandes_pieces to authenticated;

alter table public.hotline_ticket_etapes drop constraint if exists hotline_ticket_etapes_type_check;
alter table public.hotline_ticket_etapes add constraint hotline_ticket_etapes_type_check
  check (type in ('OUVERTURE', 'IDENTIFICATION', 'QUESTION', 'DOCUMENT', 'COMMENTAIRE', 'ESCALADE',
                  'PRECONISATION', 'RESOLUTION', 'CLOTURE', 'REOUVERTURE', 'PIECE_JOINTE', 'DEMANDE_PIECE'));

-- 4. Profils ---------------------------------------------------------------------
insert into public.access_profiles (code, name, description, is_active, can_hotline, can_hotline_expert, default_landing_page)
values
  ('hotline-n1', 'Hotline niveau 1', 'Technicien hotline niveau 1 : console d’appel, tickets, diagnostic guidé, vues éclatées et demandes de pièces.', true, true, false, '/hotline'),
  ('hotline-n2', 'Hotline niveau 2', 'Technicien hotline niveau 2 / 3 : synthèse des tickets escaladés N2 et N3, console, tickets, éditeur de diagnostic et statistiques.', true, true, true, '/hotline/escalades')
on conflict do nothing;


-- Données de démonstration : vue éclatée RAK-DJ35RHAE ---------------------------
insert into public.hotline_vues_eclatees (reference_article, titre, image_url, largeur, hauteur, simulation)
values ('RAK-DJ35RHAE', 'Vue éclatée RAK-DJ35RHAE (démonstration)', '/hotline/vues/rak-dj35rhae.png', 1000, 760, true)
on conflict ((upper(reference_article))) do update set titre = excluded.titre, image_url = excluded.image_url,
  largeur = excluded.largeur, hauteur = excluded.hauteur, simulation = excluded.simulation, updated_at = now();

with v as (select id from public.hotline_vues_eclatees where upper(reference_article) = 'RAK-DJ35RHAE'),
p (ordre, repere, libelle, lx, ly, cx, cy, prix, fms, agence, delai) as (values
  (1,  '1',    'Capot supérieur',                    6, 22, 232, 22, 48, 6, 0, null),
  (2,  '2',    'Couvercle du coffret électrique',     6, 111, 415, 111, 22, 9, 1, null),
  (3,  '3',    'Cornière de fixation supérieure',     6, 148, 288, 174, 9, 14, 2, null),
  (4,  '4',    'Grille de protection arrière',        6, 175, 148, 175, 31, 3, 0, null),
  (5,  '5',    'Évaporateur (batterie à ailettes)',   6, 217, 240, 217, 186, 0, 0, '3 semaines'),
  (6,  '6',    'Couvercle intermédiaire',             6, 253, 320, 253, 18, 5, 0, null),
  (7,  '7',    'Cloison de séparation',               6, 316, 485, 316, 27, 4, 0, null),
  (8,  '8',    'Moteur de ventilateur',               6, 358, 333, 390, 94, 7, 1, null),
  (9,  '9',    'Hélice de ventilateur',               6, 393, 240, 393, 36, 11, 2, null),
  (10, '10',   'Support moteur',                      12, 428, 485, 447, 15, 8, 0, null),
  (11, '11',   'Façade avant',                        12, 530, 83, 530, 54, 2, 0, null),
  (12, '12',   'Grille de ventilateur',               12, 625, 105, 625, 19, 12, 1, null),
  (13, '13',   'Plot antivibratile du compresseur',   935, 668, 602, 640, 6, 40, 4, null),
  (14, '14',   'Compresseur',                         935, 625, 587, 570, 312, 0, 0, '6 semaines'),
  (15, '15',   'Échangeur à eau (condenseur)',        935, 575, 720, 543, 228, 1, 0, null),
  (16, '16',   'Condensateur de démarrage',           935, 532, 570, 530, 12, 25, 3, null),
  (17, '17',   'Vanne 4 voies',                       935, 492, 597, 495, 64, 2, 0, null),
  (18, '18',   'Panneau latéral droit',               935, 455, 815, 454, 41, 3, 0, null),
  (19, '19',   'Détendeur électronique',              935, 420, 545, 418, 88, 0, 0, '10 jours'),
  (20, '20',   'Cache-bornier',                       935, 385, 850, 385, 8, 15, 2, null),
  (21, '21',   'Bornier de raccordement',             935, 355, 772, 354, 14, 18, 2, null),
  (22, '22',   'Manomètre',                           935, 295, 760, 295, 23, 6, 0, null),
  (23, '23',   'Contrôleur / afficheur',              945, 258, 800, 258, 76, 4, 1, null),
  (24, '23.1', 'Câble de l’afficheur',                975, 258, 800, 258, 11, 10, 0, null),
  (25, '24',   'Pressostat HP / BP',                  935, 222, 710, 260, 29, 9, 1, null),
  (26, '25',   'Filtre déshydrateur',                 935, 170, 625, 350, 17, 20, 2, null),
  (27, '26',   'Carte électronique principale',       945, 135, 542, 228, 164, 2, 0, null),
  (28, '26.1', 'Coffret électrique',                  980, 135, 542, 228, 58, 3, 0, null)
)
insert into public.hotline_vue_pieces (vue_id, repere, libelle, reference_piece, label_x, label_y, cible_x, cible_y, prix_ht, stock_fms, stock_agence, delai_reappro, ordre)
select v.id, p.repere, p.libelle, 'SAV-DJ35-' || lpad(replace(p.repere, '.', ''), 3, '0'),
       round(p.lx / 10.0, 2), round(p.ly / 7.6, 2), round(p.cx / 10.0, 2), round(p.cy / 7.6, 2),
       p.prix, p.fms, p.agence, p.delai, p.ordre
from v, p
on conflict (vue_id, repere) do update set libelle = excluded.libelle, reference_piece = excluded.reference_piece,
  label_x = excluded.label_x, label_y = excluded.label_y, cible_x = excluded.cible_x, cible_y = excluded.cible_y,
  prix_ht = excluded.prix_ht, stock_fms = excluded.stock_fms, stock_agence = excluded.stock_agence,
  delai_reappro = excluded.delai_reappro, ordre = excluded.ordre;

-- 5. Parcours de démonstration TH-RR-EXP-1 -----------------------------------------
do $do$
declare
  v_arbre uuid;
  q1 uuid; q2 uuid; q3 uuid; q4 uuid;
  v_vue jsonb := jsonb_build_array(jsonb_build_object('titre', 'Vue éclatée RAK-DJ35RHAE', 'type', 'VUE_ECLATEE', 'url', 'vue:RAK-DJ35RHAE'));
begin
  insert into public.hotline_arbres as a (code, filiere, motif, gamme, nom, famille, actif, publie_extranet, updated_at, updated_by)
  values ('TH-RR-EXP-1', 'THERMIQUE', 'EXPLOITATION', 'RR', 'Mural Airhome 400 — panne ou pièce détachée', 'Mural Airhome 400', true, false, now(), 'démonstration')
  on conflict ((upper(code))) do update set gamme = 'RR', nom = excluded.nom, famille = excluded.famille, actif = true, updated_at = now()
  returning a.id into v_arbre;

  delete from public.hotline_noeuds where arbre_id = v_arbre;

  insert into public.hotline_noeuds (arbre_id, code, ordre, question, aide, documents, choix)
  values (v_arbre, 'Q1', 1, 'Quel est le modèle de l’unité intérieure ?',
          'Lire l’étiquette signalétique sous le capot, ou retrouver le modèle dans la commande du chantier (pavé Dossiers de vente).', '[]', '[]')
  returning id into q1;
  insert into public.hotline_noeuds (arbre_id, code, ordre, question, aide, documents, choix)
  values (v_arbre, 'Q2', 2, 'Quel symptôme décrit l’appelant ?',
          'La vue éclatée est proposée à droite : cliquer un repère pour voir la pièce, contrôler le stock et demander l’envoi.', v_vue, '[]')
  returning id into q2;
  insert into public.hotline_noeuds (arbre_id, code, ordre, question, aide, documents, choix)
  values (v_arbre, 'Q3', 3, 'L’hélice tourne-t-elle librement à la main (appareil hors tension) ?', null, '[]', '[]')
  returning id into q3;
  insert into public.hotline_noeuds (arbre_id, code, ordre, question, aide, documents, choix)
  values (v_arbre, 'Q4', 4, 'Quel code défaut est affiché ?', 'Faire lire le code clignotant sur l’afficheur ou la télécommande.', '[]', '[]')
  returning id into q4;

  update public.hotline_noeuds set choix = jsonb_build_array(
    jsonb_build_object('libelle', 'RAK-DJ35RHAE', 'suivant', q2, 'preconisation', '', 'escalade', false),
    jsonb_build_object('libelle', 'Autre modèle Airhome 400', 'suivant', null,
      'preconisation', 'Pas encore de vue éclatée pour ce modèle : relever la référence et le n° de série, puis escalader au niveau 2.', 'escalade', true))
  where id = q1;
  update public.hotline_noeuds set choix = jsonb_build_array(
    jsonb_build_object('libelle', 'Ventilateur bruyant ou à l’arrêt', 'suivant', q3, 'preconisation', '', 'escalade', false),
    jsonb_build_object('libelle', 'Pièce cassée ou manquante', 'suivant', null,
      'preconisation', 'Identifier la pièce sur la vue éclatée (repère), contrôler le stock, puis demander au SAV l’envoi de la pièce au pro.', 'escalade', false),
    jsonb_build_object('libelle', 'Code défaut affiché', 'suivant', q4, 'preconisation', '', 'escalade', false))
  where id = q2;
  update public.hotline_noeuds set choix = jsonb_build_array(
    jsonb_build_object('libelle', 'Oui, elle tourne librement', 'suivant', null,
      'preconisation', 'Moteur de ventilateur probable (repère 8) : contrôler le stock de la pièce et demander au SAV l’envoi au pro.', 'escalade', false),
    jsonb_build_object('libelle', 'Non, elle frotte ou elle est bloquée', 'suivant', null,
      'preconisation', 'Contrôler le montage de l’hélice et du support moteur (repères 9 et 10) ; si une pièce est endommagée, demander au SAV son envoi au pro.', 'escalade', false))
  where id = q3;
  update public.hotline_noeuds set choix = jsonb_build_array(
    jsonb_build_object('libelle', 'Défaut de communication', 'suivant', null,
      'preconisation', 'Contrôler le bornier de raccordement (repère 21) et le câble de liaison ; remplacer le bornier si des bornes sont brûlées.', 'escalade', false),
    jsonb_build_object('libelle', 'Autre code', 'suivant', null,
      'preconisation', 'Relever le code exact et escalader au niveau 2.', 'escalade', true))
  where id = q4;

  update public.hotline_arbres set noeud_racine = q1 where id = v_arbre;
end
$do$;

-- Import Excel : la gamme ---------------------------------------------------------
create or replace function public.hotline_importer_parcours(p_parcours jsonb, p_simulation boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_err text[] := '{}';
  v_p jsonb;
  v_q jsonb;
  v_r jsonb;
  v_code text;
  v_codes_p text[] := '{}';
  v_codes_q text[];
  v_departs int;
  v_arbre uuid;
  v_ids jsonb;
  v_choix jsonb;
  v_racine uuid;
  v_crees int := 0;
  v_maj int := 0;
  v_nb_q int := 0;
  v_nb_r int := 0;
  v_nb_d int := 0;
  v_suppr int := 0;
  v_existe boolean;
  v_lot int;
begin
  if not public.hotline_est_expert() then
    raise exception 'Import des parcours réservé aux experts hotline.';
  end if;
  if jsonb_typeof(p_parcours) <> 'array' or jsonb_array_length(p_parcours) = 0 then
    return jsonb_build_object('ok', false, 'erreurs', jsonb_build_array('Aucun parcours dans le fichier (onglet « Parcours » vide).'));
  end if;

  -- 1. Contrôles ---------------------------------------------------------------
  for v_p in select * from jsonb_array_elements(p_parcours) loop
    v_code := upper(trim(coalesce(v_p->>'code', '')));
    if v_code = '' then
      v_err := v_err || format('Parcours « %s » : code parcours manquant.', coalesce(v_p->>'nom', '?'));
      continue;
    end if;
    if v_code = any (v_codes_p) then
      v_err := v_err || format('Parcours %s : code présent deux fois dans l''onglet Parcours.', v_code);
    end if;
    v_codes_p := v_codes_p || v_code;
    if coalesce(v_p->>'filiere', '') not in ('PV', 'THERMIQUE') then
      v_err := v_err || format('Parcours %s : filière « %s » inconnue (PV ou THERMIQUE).', v_code, coalesce(v_p->>'filiere', ''));
    end if;
    if coalesce(v_p->>'motif', '') not in ('MISE_EN_SERVICE', 'EXPLOITATION') then
      v_err := v_err || format('Parcours %s : motif « %s » inconnu (MISE_EN_SERVICE ou EXPLOITATION).', v_code, coalesce(v_p->>'motif', ''));
    end if;
    if coalesce(v_p->>'gamme', '') <> '' and coalesce(v_p->>'gamme', '') not in ('GAINABLE', 'RR', 'RO') then
      v_err := v_err || format('Parcours %s : gamme « %s » inconnue (GAINABLE, RR ou RO).', v_code, v_p->>'gamme');
    end if;
    if coalesce(trim(v_p->>'nom'), '') = '' then
      v_err := v_err || format('Parcours %s : nom manquant.', v_code);
    end if;
    if jsonb_array_length(coalesce(v_p->'questions', '[]'::jsonb)) = 0 then
      v_err := v_err || format('Parcours %s : aucune question (onglet Questions).', v_code);
      continue;
    end if;

    v_codes_q := '{}';
    v_departs := 0;
    for v_q in select * from jsonb_array_elements(v_p->'questions') loop
      if coalesce(trim(v_q->>'code'), '') = '' then
        v_err := v_err || format('Parcours %s : une question sans code.', v_code);
        continue;
      end if;
      if upper(trim(v_q->>'code')) = any (v_codes_q) then
        v_err := v_err || format('Parcours %s : question %s présente deux fois.', v_code, upper(trim(v_q->>'code')));
      end if;
      v_codes_q := v_codes_q || upper(trim(v_q->>'code'));
      if coalesce(trim(v_q->>'question'), '') = '' then
        v_err := v_err || format('Parcours %s, question %s : texte de la question manquant.', v_code, upper(trim(v_q->>'code')));
      end if;
      if coalesce((v_q->>'depart')::boolean, false) then v_departs := v_departs + 1; end if;
    end loop;
    if v_departs > 1 then
      v_err := v_err || format('Parcours %s : %s questions marquées « Départ » (une seule attendue).', v_code, v_departs);
    end if;

    for v_q in select * from jsonb_array_elements(v_p->'questions') loop
      for v_r in select * from jsonb_array_elements(coalesce(v_q->'reponses', '[]'::jsonb)) loop
        if coalesce(trim(v_r->>'libelle'), '') = '' then
          v_err := v_err || format('Parcours %s, question %s : réponse sans libellé.', v_code, upper(trim(v_q->>'code')));
        end if;
        if coalesce(trim(v_r->>'suivant'), '') <> '' and not (upper(trim(v_r->>'suivant')) = any (v_codes_q)) then
          v_err := v_err || format('Parcours %s, question %s, réponse « %s » : question suivante %s introuvable dans ce parcours.',
                                   v_code, upper(trim(v_q->>'code')), v_r->>'libelle', upper(trim(v_r->>'suivant')));
        end if;
      end loop;
    end loop;
  end loop;

  if array_length(v_err, 1) > 0 then
    return jsonb_build_object('ok', false, 'erreurs', to_jsonb(v_err[1:200]));
  end if;

  -- Bilan (simulation et import)
  for v_p in select * from jsonb_array_elements(p_parcours) loop
    select exists (select 1 from public.hotline_arbres where upper(code) = upper(trim(v_p->>'code'))) into v_existe;
    if v_existe then v_maj := v_maj + 1; else v_crees := v_crees + 1; end if;
    v_nb_q := v_nb_q + jsonb_array_length(v_p->'questions');
    select coalesce(sum(jsonb_array_length(coalesce(q->'reponses', '[]'::jsonb))), 0), coalesce(sum(jsonb_array_length(coalesce(q->'documents', '[]'::jsonb))), 0)
      into v_lot, v_departs from jsonb_array_elements(v_p->'questions') q;
    v_nb_r := v_nb_r + v_lot;
    v_nb_d := v_nb_d + v_departs;
    if v_existe then
      select count(*) into v_lot from public.hotline_noeuds n
      join public.hotline_arbres a on a.id = n.arbre_id
      where upper(a.code) = upper(trim(v_p->>'code'))
        and not (upper(n.code) in (select upper(trim(q->>'code')) from jsonb_array_elements(v_p->'questions') q));
      v_suppr := v_suppr + v_lot;
    end if;
  end loop;

  if p_simulation then
    return jsonb_build_object('ok', true, 'simulation', true, 'parcours_crees', v_crees, 'parcours_maj', v_maj,
      'questions', v_nb_q, 'reponses', v_nb_r, 'documents', v_nb_d, 'questions_supprimees', v_suppr);
  end if;

  -- 2. Application ---------------------------------------------------------------
  for v_p in select * from jsonb_array_elements(p_parcours) loop
    v_code := upper(trim(v_p->>'code'));
    insert into public.hotline_arbres as a (code, filiere, motif, gamme, nom, famille, actif, publie_extranet, updated_at, updated_by)
    values (v_code, v_p->>'filiere', v_p->>'motif',
            case when v_p->>'filiere' = 'THERMIQUE' then nullif(v_p->>'gamme', '') end,
            trim(v_p->>'nom'), nullif(trim(coalesce(v_p->>'famille', '')), ''),
            coalesce((v_p->>'actif')::boolean, true), coalesce((v_p->>'publie_extranet')::boolean, false), now(), public.current_user_email())
    on conflict ((upper(code))) do update set
      filiere = excluded.filiere, motif = excluded.motif, gamme = excluded.gamme, nom = excluded.nom, famille = excluded.famille,
      actif = excluded.actif, publie_extranet = excluded.publie_extranet, updated_at = now(), updated_by = excluded.updated_by
    returning a.id into v_arbre;

    -- questions (sans les réponses : les identifiants des questions suivantes
    -- ne sont connus qu'après ce premier passage)
    insert into public.hotline_noeuds as n (arbre_id, code, question, aide, ordre, documents, choix, updated_at)
    select v_arbre, upper(trim(q->>'code')), trim(q->>'question'), nullif(trim(coalesce(q->>'aide', '')), ''),
           coalesce(nullif(q->>'ordre', '')::int, o.i::int),
           coalesce((select jsonb_agg(jsonb_build_object('titre', trim(d->>'titre'), 'type', coalesce(nullif(trim(d->>'type'), ''), 'PDF'), 'url', coalesce(trim(d->>'url'), '')))
                     from jsonb_array_elements(coalesce(q->'documents', '[]'::jsonb)) d where coalesce(trim(d->>'titre'), '') <> ''), '[]'::jsonb),
           '[]'::jsonb, now()
    from jsonb_array_elements(v_p->'questions') with ordinality o(q, i)
    on conflict (arbre_id, (upper(code))) do update set
      question = excluded.question, aide = excluded.aide, ordre = excluded.ordre, documents = excluded.documents, updated_at = now();

    delete from public.hotline_noeuds n
    where n.arbre_id = v_arbre
      and not (upper(n.code) in (select upper(trim(q->>'code')) from jsonb_array_elements(v_p->'questions') q));

    select jsonb_object_agg(upper(code), id) into v_ids from public.hotline_noeuds where arbre_id = v_arbre;

    for v_q in select * from jsonb_array_elements(v_p->'questions') loop
      select coalesce(jsonb_agg(jsonb_build_object(
               'libelle', trim(r->>'libelle'),
               'suivant', case when coalesce(trim(r->>'suivant'), '') <> '' then v_ids->>upper(trim(r->>'suivant')) end,
               'preconisation', coalesce(trim(r->>'preconisation'), ''),
               'escalade', coalesce((r->>'escalade')::boolean, false))), '[]'::jsonb)
      into v_choix
      from jsonb_array_elements(coalesce(v_q->'reponses', '[]'::jsonb)) r;
      update public.hotline_noeuds set choix = v_choix
      where arbre_id = v_arbre and upper(code) = upper(trim(v_q->>'code'));
    end loop;

    select (v_ids->>upper(trim(q->>'code')))::uuid into v_racine
    from jsonb_array_elements(v_p->'questions') with ordinality o(q, i)
    order by coalesce((q->>'depart')::boolean, false) desc, o.i
    limit 1;
    update public.hotline_arbres set noeud_racine = v_racine where id = v_arbre;
  end loop;

  return jsonb_build_object('ok', true, 'simulation', false, 'parcours_crees', v_crees, 'parcours_maj', v_maj,
    'questions', v_nb_q, 'reponses', v_nb_r, 'documents', v_nb_d, 'questions_supprimees', v_suppr);
end
$function$;


grant execute on function public.hotline_importer_parcours(jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
