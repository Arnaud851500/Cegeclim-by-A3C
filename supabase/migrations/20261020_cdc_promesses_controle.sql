-- ============================================================================
-- 20/10/2026 — Commandes clients à date de livraison interdite
-- ----------------------------------------------------------------------------
-- Même règle que l'écran « Reconstruction du stock projeté »
-- (get_stock_reconstruction), calculée d'un coup pour tout le portefeuille :
-- pour chaque CDC ouverte créée depuis 7 jours (et chaque CDC portant une
-- action non résolue), et pour chacune de ses références, on rejoue l'état de
-- fin de journée de saisie :
--   solde(t) = stock + réceptions ]saisie ; t] − promesses plus anciennes dues ≤ t
--   • OK          : min solde(t ≥ échéance) ≥ quantité ;
--   • INTENABLE   : solde(échéance) < quantité ;
--   • CREE_RETARD : livrable à l'échéance mais prend le stock d'une promesse
--                   plus lointaine qu'aucun arrivage ne recouvre à temps.
-- Résultat : table cdc_promesses_controle (une ligne par CDC × référence).
-- Les commerciaux saisissent une action + commentaire par CDC
-- (cdc_promesses_actions) ; chaque rafraîchissement vérifie l'action :
--   • décaler     : résolue quand la CDC n'est plus interdite ;
--   • déprioriser : résolue quand la CDC n'est plus interdite ET que la CDC
--                   dépriorisée est couverte à sa (nouvelle) date de livraison
--                   (aucune ligne RUPTURE / RECEPTION_TARDIVE) ;
--   • autre       : résolue quand la CDC n'est plus interdite ;
--   • si une synchro SAGE est passée depuis la saisie sans que ce soit le cas
--     → « non confirmée » (revient dans l'alerte).
-- Rafraîchi chaque heure à h+35 (pg_cron), soit après chaque synchro SAGE.
-- ============================================================================

-- ── Résultat du contrôle ────────────────────────────────────────────────────
create table if not exists public.cdc_promesses_controle (
  numero_document text not null,
  reference_article text not null,
  numero_tiers text,
  nom_tiers text,
  collaborateur text,
  representant text,
  agence text,
  date_creation date not null,
  date_livraison date,
  echeance date not null,
  date_bl date,
  ouverte boolean not null default true,
  quantite numeric not null default 0,
  quantite_ouverte numeric not null default 0,
  stock_phys numeric,
  promesses_ouvertes numeric,
  stock_projete_creation numeric,
  solde_echeance numeric,
  atp_echeance numeric,
  verdict text not null check (verdict in ('OK', 'INTENABLE', 'CREE_RETARD')),
  q_manque numeric not null default 0,
  date_exacte date,
  date_rupture date,
  nb_victimes integer not null default 0,
  q_victimes numeric not null default 0,
  victimes text,
  -- Exclusion (mêmes règles que le Portefeuille livraison, 20/10/2026) :
  --   HORS_STOCK     : référence absente de sage.stock_depot (non gérée en stock) ;
  --   APPRO_POSSIBLE : la rupture créée tombe après création + délai d'appro
  --                    de la référence (hors arrêt appro) -- un appro lancé à
  --                    la saisie arrive avant que quiconque manque de stock.
  -- Une ligne exclue est traitée comme tenable dans les écrans et l'alerte.
  motif_exclusion text,
  -- Date au plus court si un appro est lancé le jour du calcul (même règle que
  -- l'écran Stock articles : aujourd'hui + délai d'appro + 7 j de sécurité) ;
  -- null si la référence est en arrêt / blocage appro.
  date_appro date,
  arret_appro boolean,
  premiere_analyse timestamptz not null default now(),
  premiere_detection timestamptz,
  calcule_le timestamptz not null default now(),
  primary key (numero_document, reference_article)
);
create index if not exists idx_cdc_promesses_controle_tiers on public.cdc_promesses_controle (numero_tiers);
create index if not exists idx_cdc_promesses_controle_verdict on public.cdc_promesses_controle (verdict) where verdict <> 'OK';

-- ── Actions des commerciaux (une par CDC) ───────────────────────────────────
create table if not exists public.cdc_promesses_actions (
  numero_document text primary key,
  action text not null check (action in ('decaler', 'deprioriser', 'autre')),
  nouvelle_date date,
  cdc_depriorisee text,
  commentaire text not null check (nullif(btrim(commentaire), '') is not null),
  statut text not null default 'en_attente' check (statut in ('en_attente', 'non_confirmee', 'resolue')),
  verification text,
  verifie_le timestamptz,
  saisi_par_email text,
  saisi_par_nom text,
  saisi_le timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint cdc_promesses_actions_deprio_obligatoire
    check (action <> 'deprioriser' or nullif(btrim(coalesce(cdc_depriorisee, '')), '') is not null),
  constraint cdc_promesses_actions_decalage_date
    check (action <> 'decaler' or nouvelle_date is not null)
);

-- Toute modification de l'action par un utilisateur la remet « en attente »
-- de la prochaine synchro (la fonction de rafraîchissement, elle, ne touche
-- qu'aux colonnes statut / verification / verifie_le).
create or replace function public.cdc_promesses_actions_touch()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT'
     or new.action is distinct from old.action
     or new.nouvelle_date is distinct from old.nouvelle_date
     or new.cdc_depriorisee is distinct from old.cdc_depriorisee
     or new.commentaire is distinct from old.commentaire then
    new.saisi_le := now();
    new.statut := 'en_attente';
    new.verification := null;
    new.verifie_le := null;
  end if;
  new.numero_document := btrim(new.numero_document);
  new.cdc_depriorisee := nullif(upper(btrim(coalesce(new.cdc_depriorisee, ''))), '');
  if new.action <> 'deprioriser' then new.cdc_depriorisee := null; end if;
  if new.action <> 'decaler' then new.nouvelle_date := null; end if;
  return new;
end $$;

drop trigger if exists trg_cdc_promesses_actions_touch on public.cdc_promesses_actions;
create trigger trg_cdc_promesses_actions_touch
  before insert or update on public.cdc_promesses_actions
  for each row execute function public.cdc_promesses_actions_touch();

-- ── Périmètre : mêmes règles que activite_lignes_select_scoped ─────────────
alter table public.cdc_promesses_controle enable row level security;
alter table public.cdc_promesses_actions enable row level security;

drop policy if exists cdc_promesses_controle_select_scoped on public.cdc_promesses_controle;
create policy cdc_promesses_controle_select_scoped on public.cdc_promesses_controle
  for select to authenticated using (
    exists (select 1 from public.user_page_access upa
            where upa.email = public.current_user_email()
              and (coalesce(upa.can_autorisation, false) or coalesce(upa.can_change_scope, false)))
    or not exists (select 1 from public.my_allowed_collaborateurs_set())
    or numero_tiers in (select public.my_allowed_tiers_set())
    or (numero_tiers in (select public.my_non_affecte_tiers_set())
        and public.collab_key(collaborateur) in (select public.my_allowed_collaborateurs_keys()))
  );

-- Les actions suivent la visibilité de la commande (RLS du sous-select).
drop policy if exists cdc_promesses_actions_all_scoped on public.cdc_promesses_actions;
create policy cdc_promesses_actions_all_scoped on public.cdc_promesses_actions
  for all to authenticated
  using (numero_document in (select c.numero_document from public.cdc_promesses_controle c))
  with check (numero_document in (select c.numero_document from public.cdc_promesses_controle c));

grant select on public.cdc_promesses_controle to authenticated;
grant select, insert, update, delete on public.cdc_promesses_actions to authenticated;

-- ── Calcul ensembliste ──────────────────────────────────────────────────────
create or replace function public.refresh_cdc_promesses_controle(p_jours integer default 7)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'sage'
set statement_timeout to '900s'
as $function$
declare
  t0 timestamptz := clock_timestamp();
  v_d0 date;
  v_sync_fin timestamptz;
  v_nb_refs integer;
  v_nb_anal integer;
  v_nb_interdites integer;
  v_delai_defaut integer := coalesce((select valeur from public.appro_parametres where cle = 'delai_appro_defaut_jours'), 30)::int;
begin
  -- Un seul calcul à la fois.
  if not pg_try_advisory_xact_lock(hashtext('refresh_cdc_promesses_controle')) then
    return jsonb_build_object('skipped', true);
  end if;

  -- Fenêtre : 7 jours (30 à l'origine, réduite le 20/10/2026), étendue aux CDC portant une action non résolue.
  select least(current_date - p_jours,
               coalesce(min(c.date_creation), current_date - p_jours))
    into v_d0
  from public.cdc_promesses_actions a
  join public.cdc_promesses_controle c on c.numero_document = a.numero_document
  where a.statut <> 'resolue';

  drop table if exists _pc_bc; drop table if exists _pc_refs; drop table if exists _pc_cdc;
  drop table if exists _pc_rec; drop table if exists _pc_sor; drop table if exists _pc_stock;
  drop table if exists _pc_recall; drop table if exists _pc_anal; drop table if exists _pc_ev;
  drop table if exists _pc_bal;

  -- CDC à analyser : ouvertes créées dans la fenêtre + CDC avec action non résolue.
  create temp table _pc_bc on commit drop as
  select distinct coalesce(numero_piece_bc, numero_piece) bc
  from public.activite_lignes
  where type_document in ('Bon de commande', 'Préparation de livraison')
    and coalesce(date_bc, date_piece) between current_date - p_jours and current_date
  union
  select numero_document from public.cdc_promesses_actions where statut <> 'resolue';

  create temp table _pc_refs on commit drop as
  select distinct upper(btrim(reference_article)) ref
  from public.activite_lignes
  where coalesce(numero_piece_bc, numero_piece) in (select bc from _pc_bc)
    and type_document in ('Bon de commande', 'Préparation de livraison', 'Bon de livraison')
    and nullif(btrim(reference_article), '') is not null
  union
  select distinct reference_article from public.cdc_promesses_controle
  where numero_document in (select bc from _pc_bc);
  get diagnostics v_nb_refs = row_count;
  create unique index on _pc_refs (ref);

  -- Commandes clients de ces références : ouvertes + livrées depuis v_d0.
  create temp table _pc_cdc on commit drop as
  with lignes as (
    select upper(btrim(a.reference_article)) ref, coalesce(a.numero_piece_bc, a.numero_piece) bc,
           coalesce(a.date_bc, a.date_piece) date_bc, a.date_livraison, coalesce(a.quantite, 0) q,
           a.numero_tiers_entete tiers, a.intitule_tiers_entete nom, a.collaborateur, a.type_document,
           case when a.type_document = 'Bon de livraison' then coalesce(a.date_bl, a.date_piece) end date_bl
    from public.activite_lignes a
    join _pc_refs r on r.ref = upper(btrim(a.reference_article))
    where a.type_document in ('Bon de commande', 'Bon de livraison', 'Préparation de livraison')
      and (a.type_document <> 'Bon de livraison' or coalesce(a.date_bl, a.date_piece) >= v_d0)
    union all
    select upper(btrim(f.reference_article)), coalesce(f.numero_piece_bc, f.numero_piece),
           coalesce(f.date_bc, f.date_facture), f.date_livraison, coalesce(f.quantite, 0),
           f.numero_tiers_entete, f.intitule_tiers_entete, f.collaborateur, 'Facture',
           coalesce(f.date_bl, f.date_facture)
    from public.facture_lignes f
    join _pc_refs r on r.ref = upper(btrim(f.reference_article))
    where f.date_facture >= v_d0
      and coalesce(f.date_bl, f.date_facture) >= v_d0
      and f.quantite > 0
  )
  select ref, bc, min(date_bc) date_bc, min(date_livraison) date_livraison,
         max(tiers) tiers, max(nom) nom, max(collaborateur) collaborateur, sum(q) q,
         coalesce(sum(q) filter (where type_document in ('Bon de commande', 'Préparation de livraison')), 0) q_ouverte,
         max(date_bl) date_bl,
         bool_or(type_document in ('Bon de commande', 'Préparation de livraison')) ouverte,
         null::date echeance
  from lignes
  where bc is not null and date_bc is not null
  group by ref, bc;
  update _pc_cdc set echeance = greatest(coalesce(date_livraison, date_bc), date_bc) where bc is not null;
  create index on _pc_cdc (ref, date_bc);

  -- Flux réels depuis v_d0 (un seul passage pour toutes les références).
  -- Réceptions réelles = lignes de CDF BLG livrées. Lues directement dans
  -- les tables BLG (mêmes données que v_appro_cdf_lignes : sale_quote de type
  -- 'purchase', delivery_date_actual, quantity_delivered) : la vue, qui
  -- recalcule tout l'entête des CDF, dépasse à elle seule le plafond de
  -- 2 minutes des requêtes sur ~900 références (correctif du 20/10/2026).
  create temp table _pc_rec on commit drop as
  select upper(btrim(ap.reference)) ref, sl.delivery_date_actual::date d, sum(sl.quantity_delivered)::numeric q
  from blg.sale_quote_line sl
  join blg.sale_quote sq on sq.id = sl.quote_fk and sq.type = 'purchase'
  join blg.article_part ap on ap.id = sl.article_fk
  where sl.quantity_delivered > 0
    and sl.delivery_date_actual >= v_d0
    and sl.delivery_date_actual::date <= current_date
    and upper(btrim(ap.reference)) in (select ref from _pc_refs)
  group by 1, 2;

  create temp table _pc_sor on commit drop as
  select upper(btrim(s.reference_article)) ref, s.date_bl d, sum(s.quantite_sortie) q
  from public.v_stock_sorties_bl_base s
  where s.date_bl >= v_d0 and s.date_bl <= current_date
    and upper(btrim(s.reference_article)) in (select ref from _pc_refs)
  group by 1, 2;

  create temp table _pc_stock on commit drop as
  select r.ref, coalesce((select sum(sd.sto_qte) from sage.stock_depot sd where upper(btrim(sd.sto_art_num)) = r.ref), 0) stock_today
  from _pc_refs r;
  create unique index on _pc_stock (ref);

  -- Réceptions vues depuis une saisie : réelles jusqu'à aujourd'hui, puis
  -- CDF attendues (au plus tôt demain).
  create temp table _pc_recall on commit drop as
  select ref, d, q from _pc_rec
  union all
  select upper(btrim(v.reference_article)), greatest(v.date_reception_retenue::date, current_date + 1), sum(v.quantite_attendue)
  from public.v_couverture_stock_receptions v
  where v.quantite_attendue > 0 and upper(btrim(v.reference_article)) in (select ref from _pc_refs)
  group by 1, 2;
  create index on _pc_recall (ref, d);

  -- Commandes analysées (une ligne par CDC × référence).
  create temp table _pc_anal on commit drop as
  select i.ref, i.bc, i.date_bc, i.date_livraison, i.echeance, i.tiers, i.nom, i.collaborateur,
         i.q, i.q_ouverte, i.date_bl, i.ouverte,
         -- stock de fin de journée de saisie (si sortie le jour même, on la remet)
         st.stock_today
           - coalesce((select sum(x.q) from _pc_rec x where x.ref = i.ref and x.d > i.date_bc), 0)
           + coalesce((select sum(x.q) from _pc_sor x where x.ref = i.ref and x.d > i.date_bc), 0)
           + case when i.date_bl is not null and i.date_bl <= i.date_bc then i.q - i.q_ouverte else 0 end stock_phys,
         (select coalesce(sum(case when j.date_bl is null or j.date_bl > i.date_bc then j.q else j.q_ouverte end), 0)
            from _pc_cdc j where j.ref = i.ref and j.date_bc <= i.date_bc and j.bc <> i.bc) promesses_ouvertes,
         null::numeric solde_echeance, null::numeric atp_echeance,
         null::text verdict, null::numeric q_manque, null::date date_exacte, null::date date_rupture,
         0::int nb_victimes, 0::numeric q_victimes, null::text victimes, null::text motif_exclusion,
         null::date date_appro, null::boolean arret_appro
  from _pc_cdc i
  join _pc_stock st on st.ref = i.ref
  where i.bc in (select bc from _pc_bc)
    and i.date_bc >= v_d0 and i.date_bc <= current_date
    and (i.ouverte or i.bc in (select numero_document from public.cdc_promesses_actions where statut <> 'resolue'));
  get diagnostics v_nb_anal = row_count;
  create index on _pc_anal (ref, bc);

  -- Événements datés vus depuis chaque commande.
  create temp table _pc_ev on commit drop as
  select i.ref, i.bc, i.date_bc t, 0::numeric delta, null::text j_bc, null::date j_date_bc from _pc_anal i
  union all
  select i.ref, i.bc, i.echeance, 0, null, null from _pc_anal i
  union all
  select i.ref, i.bc, greatest(j.echeance, i.date_bc),
         -(case when j.date_bl is null or j.date_bl > i.date_bc then j.q else j.q_ouverte end), j.bc, j.date_bc
  from _pc_anal i
  join _pc_cdc j on j.ref = i.ref and j.bc <> i.bc and j.date_bc <= i.date_bc
  where (case when j.date_bl is null or j.date_bl > i.date_bc then j.q else j.q_ouverte end) > 0
  union all
  select i.ref, i.bc, r.d, r.q, null, null from _pc_anal i join _pc_recall r on r.ref = i.ref and r.d > i.date_bc;

  create temp table _pc_bal on commit drop as
  select ref, bc, t, b, min(b) over (partition by ref, bc order by t rows between current row and unbounded following) min_fwd
  from (
    select e.ref, e.bc, e.t, a.stock_phys + sum(sum(e.delta)) over (partition by e.ref, e.bc order by e.t) b
    from _pc_ev e join _pc_anal a on a.ref = e.ref and a.bc = e.bc
    group by e.ref, e.bc, e.t, a.stock_phys
  ) x;
  create index on _pc_bal (ref, bc, t);

  update _pc_anal a set
    solde_echeance = (select b from _pc_bal x where x.ref = a.ref and x.bc = a.bc and x.t = a.echeance),
    atp_echeance   = (select min_fwd from _pc_bal x where x.ref = a.ref and x.bc = a.bc and x.t = a.echeance),
    date_exacte    = (select min(x.t) from _pc_bal x where x.ref = a.ref and x.bc = a.bc and x.min_fwd >= a.q)
  where a.bc is not null;

  update _pc_anal set
    verdict = case when atp_echeance >= q then 'OK' when solde_echeance < q then 'INTENABLE' else 'CREE_RETARD' end,
    q_manque = case when atp_echeance >= q then 0 else least(q, q - atp_echeance) end
  where bc is not null;

  update _pc_anal a set date_rupture = (select min(x.t) from _pc_bal x where x.ref = a.ref and x.bc = a.bc and x.t >= a.echeance and x.b < a.q)
  where a.verdict <> 'OK';

  -- Promesses exposées : dues entre la rupture créée et la date exacte.
  update _pc_anal a set nb_victimes = v.nb, q_victimes = v.q, victimes = v.liste
  from (
    select a2.ref, a2.bc, count(*)::int nb, sum(-e.delta) q,
           (select string_agg(z.j_bc || ' (' || to_char(z.t, 'DD/MM') || ')', ', ')
              from (select e2.j_bc, e2.t from _pc_ev e2
                    where e2.ref = a2.ref and e2.bc = a2.bc and e2.j_bc is not null
                      and e2.t >= a2.date_rupture and (a2.date_exacte is null or e2.t < a2.date_exacte)
                    order by e2.t, e2.j_date_bc limit 5) z) liste
    from _pc_anal a2
    join _pc_ev e on e.ref = a2.ref and e.bc = a2.bc and e.j_bc is not null
     and e.t >= a2.date_rupture and (a2.date_exacte is null or e.t < a2.date_exacte)
    where a2.verdict = 'CREE_RETARD'
    group by a2.ref, a2.bc, a2.date_rupture, a2.date_exacte
  ) v
  where v.ref = a.ref and v.bc = a.bc;

  -- Exclusions (mêmes règles que le Portefeuille livraison).
  update _pc_anal a set
    arret_appro = coalesce(d.arret_appro, false),
    date_appro = case when coalesce(d.arret_appro, false) then null
                      else current_date + coalesce(d.delai_appro_jours, v_delai_defaut) + 7 end,
    motif_exclusion = case
      when not exists (select 1 from sage.stock_depot sd where sd.sto_art_num = a.ref) then 'HORS_STOCK'
      -- La rupture créée (ou, à défaut, la date promise) tombe après la
      -- période figée (création + délai d'appro) : un appro passé à la
      -- saisie arrive avant que quiconque manque de stock.
      when not coalesce(d.arret_appro, false)
           and coalesce(a.date_rupture, a.echeance) >= a.date_bc + coalesce(d.delai_appro_jours, v_delai_defaut) then 'APPRO_POSSIBLE'
    end
  from (select r.ref, dl.delai_appro_jours, dl.arret_appro
        from (select distinct ref from _pc_anal) r
        left join public.v_appro_delai_article dl on dl.reference_article = r.ref) d
  where d.ref = a.ref and a.verdict <> 'OK';

  -- ── Écriture du résultat ──
  -- Les CDC sorties du périmètre (livrées, soldées, hors fenêtre sans action) disparaissent.
  delete from public.cdc_promesses_controle c
  where not exists (select 1 from _pc_anal a where a.bc = c.numero_document and a.ref = c.reference_article);

  insert into public.cdc_promesses_controle as c (
    numero_document, reference_article, numero_tiers, nom_tiers, collaborateur, representant, agence,
    date_creation, date_livraison, echeance, date_bl, ouverte, quantite, quantite_ouverte,
    stock_phys, promesses_ouvertes, stock_projete_creation, solde_echeance, atp_echeance,
    verdict, q_manque, date_exacte, date_rupture, nb_victimes, q_victimes, victimes, motif_exclusion,
    date_appro, arret_appro, premiere_analyse, premiere_detection, calcule_le)
  select a.bc, a.ref, a.tiers, a.nom, a.collaborateur, rt.representant,
         coalesce(ag.agence, 'NON AFFECTE'),
         a.date_bc, a.date_livraison, a.echeance, a.date_bl, a.ouverte, a.q, a.q_ouverte,
         a.stock_phys, a.promesses_ouvertes, a.stock_phys - a.promesses_ouvertes, a.solde_echeance, a.atp_echeance,
         a.verdict, a.q_manque, a.date_exacte, a.date_rupture, a.nb_victimes, a.q_victimes, a.victimes, a.motif_exclusion,
         a.date_appro, a.arret_appro, now(), case when a.verdict <> 'OK' and a.motif_exclusion is null then now() end, now()
  from _pc_anal a
  left join public.ref_tiers rt on rt.numero = a.tiers
  left join lateral (
    select max(s.agence_collaborateur) agence from public.synthese_multi_clients_cache s
    where s.numero_tiers = a.tiers and s.annee = extract(year from current_date)::int and s.row_kind = 'client'
  ) ag on true
  on conflict (numero_document, reference_article) do update set
    numero_tiers = excluded.numero_tiers, nom_tiers = excluded.nom_tiers, collaborateur = excluded.collaborateur,
    representant = excluded.representant, agence = excluded.agence,
    date_creation = excluded.date_creation, date_livraison = excluded.date_livraison, echeance = excluded.echeance,
    date_bl = excluded.date_bl, ouverte = excluded.ouverte, quantite = excluded.quantite, quantite_ouverte = excluded.quantite_ouverte,
    stock_phys = excluded.stock_phys, promesses_ouvertes = excluded.promesses_ouvertes,
    stock_projete_creation = excluded.stock_projete_creation, solde_echeance = excluded.solde_echeance,
    atp_echeance = excluded.atp_echeance, verdict = excluded.verdict, q_manque = excluded.q_manque,
    date_exacte = excluded.date_exacte, date_rupture = excluded.date_rupture, nb_victimes = excluded.nb_victimes,
    q_victimes = excluded.q_victimes, victimes = excluded.victimes, motif_exclusion = excluded.motif_exclusion,
    date_appro = excluded.date_appro, arret_appro = excluded.arret_appro,
    premiere_detection = coalesce(c.premiere_detection, excluded.premiere_detection),
    calcule_le = excluded.calcule_le;

  -- ── Vérification des actions ──
  select max(s.last_synced_at + make_interval(secs => coalesce(s.duration_seconds, 0)))
    into v_sync_fin
  from public.sage_sync_status s where s.status = 'succes';

  with etat as (
    select a.numero_document,
           exists (select 1 from public.cdc_promesses_controle c where c.numero_document = a.numero_document and c.ouverte) ouverte,
           not exists (select 1 from public.cdc_promesses_controle c where c.numero_document = a.numero_document and c.verdict <> 'OK' and c.motif_exclusion is null) cdc_ok,
           case when a.action = 'deprioriser' then
             not exists (select 1 from public.alerte_couverture_stock_cache k
                         where upper(btrim(k.numero_document)) = a.cdc_depriorisee
                           and k.statut_couverture in ('RUPTURE', 'RECEPTION_TARDIVE'))
           else true end dep_ok
    from public.cdc_promesses_actions a
    where a.statut <> 'resolue'
  )
  update public.cdc_promesses_actions a set
    statut = case
      when not e.ouverte then 'resolue'
      when e.cdc_ok and e.dep_ok then 'resolue'
      when v_sync_fin is not null and v_sync_fin > a.saisi_le then 'non_confirmee'
      else 'en_attente' end,
    verification = case
      when not e.ouverte then 'Commande livrée ou soldée'
      when e.cdc_ok and e.dep_ok then 'Date de livraison désormais tenable'
      when not e.cdc_ok and not e.dep_ok then 'Date toujours interdite et CDC dépriorisée non couverte à sa date'
      when not e.cdc_ok then 'Date de livraison toujours interdite après synchro'
      else 'CDC dépriorisée ' || coalesce(a.cdc_depriorisee, '') || ' pas couverte à sa date de livraison' end,
    verifie_le = now()
  from etat e
  where e.numero_document = a.numero_document;

  select count(distinct numero_document) into v_nb_interdites
  from public.cdc_promesses_controle where verdict <> 'OK' and motif_exclusion is null and ouverte;

  return jsonb_build_object(
    'depuis', v_d0, 'references', v_nb_refs, 'lignes_analysees', v_nb_anal,
    'cdc_interdites', v_nb_interdites,
    'duree_s', round(extract(epoch from clock_timestamp() - t0)::numeric, 1));
end;
$function$;

revoke all on function public.refresh_cdc_promesses_controle(integer) from public, anon, authenticated;

-- ── Lecture pour les écrans (RLS appliquée : security invoker) ──────────────
drop view if exists public.v_cdc_promesses_interdites;
create view public.v_cdc_promesses_interdites
with (security_invoker = true) as
select c.numero_document, c.reference_article, c.numero_tiers, c.nom_tiers, c.collaborateur, c.representant, c.agence,
       c.date_creation, c.date_livraison, c.echeance, c.date_bl, c.ouverte, c.quantite, c.quantite_ouverte,
       c.stock_phys, c.promesses_ouvertes, c.stock_projete_creation, c.solde_echeance, c.atp_echeance,
       -- Verdict effectif : une ligne exclue (hors stock / appro possible) est tenable.
       case when c.motif_exclusion is null then c.verdict else 'OK' end verdict,
       c.q_manque, c.date_exacte, c.date_rupture, c.nb_victimes, c.q_victimes, c.victimes,
       c.premiere_analyse, c.premiere_detection, c.calcule_le, c.motif_exclusion, c.verdict verdict_brut,
       c.date_appro, c.arret_appro,
       -- Date proposée au commercial : la date exacte (stock + arrivages connus)
       -- si elle est plus proche, sinon la date au plus court avec un appro
       -- lancé aujourd'hui ; null = aucune date possible (arrêt appro).
       case when c.date_exacte is null then c.date_appro
            when c.date_appro is null then c.date_exacte
            else least(c.date_exacte, c.date_appro) end date_proposee,
       a.action, a.nouvelle_date, a.cdc_depriorisee, a.commentaire, a.statut statut_action,
       a.verification, a.verifie_le, a.saisi_par_nom, a.saisi_par_email, a.saisi_le,
       case
         when a.statut = 'resolue' then 'resolue'
         when a.statut = 'non_confirmee' then 'non_confirmee'
         when a.statut = 'en_attente' then 'en_attente'
         else 'a_traiter' end statut_traitement
from public.cdc_promesses_controle c
left join public.cdc_promesses_actions a on a.numero_document = c.numero_document
where c.ouverte
  and ((c.verdict <> 'OK' and c.motif_exclusion is null) or (a.numero_document is not null and a.statut <> 'resolue'));

grant select on public.v_cdc_promesses_interdites to authenticated;

-- Compteur de l'alerte : CDC encore à traiter (sans action, ou action non confirmée).
create or replace function public.get_cdc_promesses_alerte()
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  select jsonb_build_object(
    'a_traiter', count(distinct numero_document) filter (where statut_traitement in ('a_traiter', 'non_confirmee')),
    'en_attente', count(distinct numero_document) filter (where statut_traitement = 'en_attente'),
    'non_confirmee', count(distinct numero_document) filter (where statut_traitement = 'non_confirmee'),
    'calcule_le', (select max(calcule_le) from public.cdc_promesses_controle))
  from public.v_cdc_promesses_interdites
  where verdict <> 'OK' or statut_traitement <> 'resolue';
$$;
grant execute on function public.get_cdc_promesses_alerte() to authenticated;

-- Liste d'aide « CDC à déprioriser » : CDC ouvertes plus anciennes, sur les
-- mêmes références, qui consomment le stock avant la date exacte de la CDC
-- interdite. Celles du même représentant en premier.
create or replace function public.get_cdc_promesses_candidats(p_numero_document text)
returns table (
  numero_document text, numero_tiers text, nom_tiers text, representant text, meme_representant boolean,
  date_creation date, date_livraison date, references_communes text, quantite numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with cible as (
    select c.reference_article, c.date_creation, coalesce(c.date_exacte, c.echeance + 365) horizon,
           (select rt.representant from public.ref_tiers rt where rt.numero = c.numero_tiers) representant
    from public.cdc_promesses_controle c
    where c.numero_document = btrim(p_numero_document) and c.verdict <> 'OK' and c.motif_exclusion is null
  ), lignes as (
    select coalesce(a.numero_piece_bc, a.numero_piece) bc, a.numero_tiers_entete tiers, a.intitule_tiers_entete nom,
           upper(btrim(a.reference_article)) ref, coalesce(a.date_bc, a.date_piece) date_bc,
           a.date_livraison, coalesce(a.quantite, 0) q
    from public.activite_lignes a
    where a.type_document in ('Bon de commande', 'Préparation de livraison')
      and upper(btrim(a.reference_article)) in (select reference_article from cible)
  )
  select l.bc, max(l.tiers), max(l.nom), max(rt.representant),
         bool_or(rt.representant is not distinct from ci.representant),
         min(l.date_bc), min(l.date_livraison),
         string_agg(distinct l.ref, ', '), sum(l.q)
  from lignes l
  join cible ci on ci.reference_article = l.ref
  left join public.ref_tiers rt on rt.numero = l.tiers
  where l.bc <> btrim(p_numero_document)
    and l.date_bc <= ci.date_creation
    and coalesce(l.date_livraison, l.date_bc) <= ci.horizon
  group by l.bc
  order by bool_or(rt.representant is not distinct from ci.representant) desc, min(l.date_livraison) nulls last, l.bc
  limit 200;
$$;
grant execute on function public.get_cdc_promesses_candidats(text) to authenticated;

-- ── Planification : chaque heure à h+35 (après chaque synchro SAGE) ─────────
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'cdc-promesses-controle-hourly';
  -- Le plafond de 2 minutes s'applique à toute l'instruction lancée par
  -- pg_cron : le « set statement_timeout » de la fonction ne le lève pas, il
  -- faut le poser dans la commande de la tâche (comme les synchros SAGE).
  perform cron.schedule('cdc-promesses-controle-hourly', '35 * * * *',
    $cmd$SET statement_timeout = '900s'; select public.refresh_cdc_promesses_controle(7);$cmd$);
end $$;
