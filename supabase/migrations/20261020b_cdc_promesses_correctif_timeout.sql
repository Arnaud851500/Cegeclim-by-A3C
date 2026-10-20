-- ============================================================================
-- 20/10/2026 — Correctif « Date de livraison interdite »
-- 1. Réceptions fournisseurs lues directement dans les tables BLG (la vue
--    v_appro_cdf_lignes dépassait le plafond de 2 minutes).
-- 2. Tâche horaire : plafond porté à 15 minutes dans la commande pg_cron
--    (le réglage dans la fonction ne lève pas le plafond de l'instruction).
-- 3. Premier calcul lancé dans la minute qui suit, une seule fois.
-- À exécuter en entier dans l'éditeur SQL Supabase (réponse immédiate).
-- ============================================================================

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
         0::int nb_victimes, 0::numeric q_victimes, null::text victimes
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

  -- ── Écriture du résultat ──
  -- Les CDC sorties du périmètre (livrées, soldées, hors fenêtre sans action) disparaissent.
  delete from public.cdc_promesses_controle c
  where not exists (select 1 from _pc_anal a where a.bc = c.numero_document and a.ref = c.reference_article);

  insert into public.cdc_promesses_controle as c (
    numero_document, reference_article, numero_tiers, nom_tiers, collaborateur, representant, agence,
    date_creation, date_livraison, echeance, date_bl, ouverte, quantite, quantite_ouverte,
    stock_phys, promesses_ouvertes, stock_projete_creation, solde_echeance, atp_echeance,
    verdict, q_manque, date_exacte, date_rupture, nb_victimes, q_victimes, victimes,
    premiere_analyse, premiere_detection, calcule_le)
  select a.bc, a.ref, a.tiers, a.nom, a.collaborateur, rt.representant,
         coalesce(ag.agence, 'NON AFFECTE'),
         a.date_bc, a.date_livraison, a.echeance, a.date_bl, a.ouverte, a.q, a.q_ouverte,
         a.stock_phys, a.promesses_ouvertes, a.stock_phys - a.promesses_ouvertes, a.solde_echeance, a.atp_echeance,
         a.verdict, a.q_manque, a.date_exacte, a.date_rupture, a.nb_victimes, a.q_victimes, a.victimes,
         now(), case when a.verdict <> 'OK' then now() end, now()
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
    q_victimes = excluded.q_victimes, victimes = excluded.victimes,
    premiere_detection = coalesce(c.premiere_detection, excluded.premiere_detection),
    calcule_le = excluded.calcule_le;

  -- ── Vérification des actions ──
  select max(s.last_synced_at + make_interval(secs => coalesce(s.duration_seconds, 0)))
    into v_sync_fin
  from public.sage_sync_status s where s.status = 'succes';

  with etat as (
    select a.numero_document,
           exists (select 1 from public.cdc_promesses_controle c where c.numero_document = a.numero_document and c.ouverte) ouverte,
           not exists (select 1 from public.cdc_promesses_controle c where c.numero_document = a.numero_document and c.verdict <> 'OK') cdc_ok,
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
  from public.cdc_promesses_controle where verdict <> 'OK' and ouverte;

  return jsonb_build_object(
    'depuis', v_d0, 'references', v_nb_refs, 'lignes_analysees', v_nb_anal,
    'cdc_interdites', v_nb_interdites,
    'duree_s', round(extract(epoch from clock_timestamp() - t0)::numeric, 1));
end;
$function$;


revoke all on function public.refresh_cdc_promesses_controle(integer) from public, anon, authenticated;

-- Tâche horaire (h+35) : 7 jours, plafond 15 minutes.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'cdc-promesses-controle-hourly'),
  command := $cmd$SET statement_timeout = '900s'; select public.refresh_cdc_promesses_controle(7);$cmd$
);

-- Premier calcul : programmé à la minute suivante (heure UTC de pg_cron),
-- une seule fois ; la tâche est à supprimer ensuite (voir plus bas).
select cron.unschedule(jobid) from cron.job where jobname = 'cdc-promesses-run-now';
select cron.schedule(
  'cdc-promesses-run-now',
  to_char((now() at time zone 'UTC') + interval '1 minute', 'FMMI FMHH24 FMDD FMMM') || ' *',
  $cmd$SET statement_timeout = '900s'; select public.refresh_cdc_promesses_controle(7);$cmd$
);

-- Suivi (relancer jusqu'à « succeeded ») :
-- select status, return_message, end_time - start_time as duree
-- from cron.job_run_details
-- where jobid = (select jobid from cron.job where jobname = 'cdc-promesses-run-now')
-- order by start_time desc limit 1;
--
-- Une fois terminé, supprimer la tâche ponctuelle :
-- select cron.unschedule('cdc-promesses-run-now');
