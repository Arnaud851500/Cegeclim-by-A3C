-- ============================================================================
-- 20/10/2026 — Correctif n°4 « Date de livraison interdite » : délais
--   • 150 références Hitachi (fournisseur H0001) : 180 jours, sans sécurité ;
--   • toutes les autres références : 90 jours (+ 7 j de sécurité pour la
--     date proposée, comme avant).
--   Le délai sert (1) à exclure les CDC dont la rupture tombe après
--   création + délai (« appro possible »), (2) à la date proposée au plus
--   court : aujourd'hui + délai + sécurité.
--   Table modifiable : public.cdc_promesses_delais (une ligne par référence) ;
--   défauts : appro_parametres promesses_delai_defaut_jours (90) et
--   promesses_securite_defaut_jours (7).
-- À exécuter en entier dans l'éditeur SQL Supabase (quelques secondes ;
-- le recalcul complet se fera au prochain passage horaire, à hh:35).
-- ============================================================================

create table if not exists public.cdc_promesses_delais (
  reference_article text primary key,
  delai_jours integer not null check (delai_jours >= 0),
  securite_jours integer not null default 0 check (securite_jours >= 0),
  fournisseur text,
  maj_le timestamptz not null default now()
);
alter table public.cdc_promesses_delais enable row level security;
drop policy if exists cdc_promesses_delais_select on public.cdc_promesses_delais;
create policy cdc_promesses_delais_select on public.cdc_promesses_delais for select to authenticated using (true);
grant select on public.cdc_promesses_delais to authenticated;

insert into public.cdc_promesses_delais (reference_article, delai_jours, securite_jours, fournisseur) values
  ('SPX-WTA1', 180, 0, 'H0001'),
  ('RAW-35RHC', 180, 0, 'H0001'),
  ('TAW-270RHC', 180, 0, 'H0001'),
  ('RAK-DJ18RHAE', 180, 0, 'H0001'),
  ('RAK-DJ35RHAE', 180, 0, 'H0001'),
  ('RAK-DJ25RHAE', 180, 0, 'H0001'),
  ('RAK-DJ15QHAE', 180, 0, 'H0001'),
  ('TAW-190RHC', 180, 0, 'H0001'),
  ('RAK-DJ50RHAE', 180, 0, 'H0001'),
  ('RAC-DJ35WHAE', 180, 0, 'H0001'),
  ('SPX-URFG1', 180, 0, 'H0001'),
  ('RAC-DJ50WHAE', 180, 0, 'H0001'),
  ('RAK-VJ18RHAE', 180, 0, 'H0001'),
  ('RAK-VJ35RHAE', 180, 0, 'H0001'),
  ('SPX-URFG', 180, 0, 'H0001'),
  ('RAK-18RPE', 180, 0, 'H0001'),
  ('RAK-VJ25RHAE', 180, 0, 'H0001'),
  ('SPX-WKT5M', 180, 0, 'H0001'),
  ('RAM-53NYP3E', 180, 0, 'H0001'),
  ('RAM-G68N3HCE', 180, 0, 'H0001'),
  ('RAK-VJ15QHAE', 180, 0, 'H0001'),
  ('RAC-DJ25WHAE', 180, 0, 'H0001'),
  ('RAM-Y53N3HAE', 180, 0, 'H0001'),
  ('RAC-DJ18WHAE', 180, 0, 'H0001'),
  ('RAM-G55N2HCE', 180, 0, 'H0001'),
  ('RAK-CJ35PHAE', 180, 0, 'H0001'),
  ('TAW-270RHD', 180, 0, 'H0001'),
  ('RAK-VJ50RHAE', 180, 0, 'H0001'),
  ('RAK-35RPE', 180, 0, 'H0001'),
  ('RAM-G55N3HCE', 180, 0, 'H0001'),
  ('TAW-190RHD', 180, 0, 'H0001'),
  ('RAK-15QPE', 180, 0, 'H0001'),
  ('RAM-G85N5HCE', 180, 0, 'H0001'),
  ('RAD-50RPE', 180, 0, 'H0001'),
  ('RAC-CJ35WHAE', 180, 0, 'H0001'),
  ('RAM-G43N2HCE', 180, 0, 'H0001'),
  ('RAM-G68N3HAE', 180, 0, 'H0001'),
  ('RAK-CJ25PHAE', 180, 0, 'H0001'),
  ('RAC-VJ35WHAE', 180, 0, 'H0001'),
  ('RAM-G70N4HCE', 180, 0, 'H0001'),
  ('RAM-G85N5HAE', 180, 0, 'H0001'),
  ('RAK-VJ42RHAE', 180, 0, 'H0001'),
  ('RAK-XJ35RHAE', 180, 0, 'H0001'),
  ('RAM-90NYP5E', 180, 0, 'H0001'),
  ('RAC-VJ50WHAE', 180, 0, 'H0001'),
  ('RAM-70NYP4E', 180, 0, 'H0001'),
  ('RAM-G36N2HCE', 180, 0, 'H0001'),
  ('RAM-G55N3HAE', 180, 0, 'H0001'),
  ('RAM-G55N2HBE', 180, 0, 'H0001'),
  ('RAM-G70N4HAE', 180, 0, 'H0001'),
  ('RAM-Y85N5HAE', 180, 0, 'H0001'),
  ('RAD-DJ35QHAE', 180, 0, 'H0001'),
  ('RAD-DJ50QHAE', 180, 0, 'H0001'),
  ('RAM-Y70N4HAE', 180, 0, 'H0001'),
  ('RAD-60RPE', 180, 0, 'H0001'),
  ('RAC-XJ35WHAE', 180, 0, 'H0001'),
  ('RAD-35RPE', 180, 0, 'H0001'),
  ('RAK-DJ60RHAE', 180, 0, 'H0001'),
  ('RAC-60NPE', 180, 0, 'H0001'),
  ('RAM-G110N5HCE', 180, 0, 'H0001'),
  ('RAC-CJ25WHAE', 180, 0, 'H0001'),
  ('RAC-VJ25WHAE', 180, 0, 'H0001'),
  ('RAM-G55N2HAE', 180, 0, 'H0001'),
  ('RAF-XJ25RHAE', 180, 0, 'H0001'),
  ('RAF-XJ35RHAE', 180, 0, 'H0001'),
  ('RAK-XJ25RHAE', 180, 0, 'H0001'),
  ('RAF-XJ50RHAE', 180, 0, 'H0001'),
  ('RAK-XJ50RHAE', 180, 0, 'H0001'),
  ('HAQ-RTU-01', 180, 0, 'H0001'),
  ('RAC-VJ42WHAE', 180, 0, 'H0001'),
  ('RAC-35NPE', 180, 0, 'H0001'),
  ('RAM-G110N5HAE', 180, 0, 'H0001'),
  ('RAC-50FXE', 180, 0, 'H0001'),
  ('RAM-G43N2HBE', 180, 0, 'H0001'),
  ('RAF-50RXE', 180, 0, 'H0001'),
  ('RAC-DJ60WHAE', 180, 0, 'H0001'),
  ('RAM-G36N2HBE', 180, 0, 'H0001'),
  ('RAD-DJ25QHAE', 180, 0, 'H0001'),
  ('RAK-CJ20PHAE', 180, 0, 'H0001'),
  ('RAC-VJ60NHAE', 180, 0, 'H0001'),
  ('RAD-DJ60QHAE', 180, 0, 'H0001'),
  ('RAK-XJ18QHAE', 180, 0, 'H0001'),
  ('RAD-VJ50RHAE', 180, 0, 'H0001'),
  ('RAD-VJ60RHAE', 180, 0, 'H0001'),
  ('RAD-DJ18QHAE', 180, 0, 'H0001'),
  ('RAK-VJ60RHAE', 180, 0, 'H0001'),
  ('HAQ-WTS-01', 180, 0, 'H0001'),
  ('RAC-VJ50NHAE', 180, 0, 'H0001'),
  ('RAC-XJ50WHAE', 180, 0, 'H0001'),
  ('RAC-VJ35NHAE', 180, 0, 'H0001'),
  ('RAC-XJ25WHAE', 180, 0, 'H0001'),
  ('RAF-XJ25QHAE', 180, 0, 'H0001'),
  ('HZKF12KSE-Q', 180, 0, 'H0001'),
  ('RAM-G43N2HAE', 180, 0, 'H0001'),
  ('HZKF08KSE-Q', 180, 0, 'H0001'),
  ('RAC-XJ35FHAE', 180, 0, 'H0001'),
  ('RAC-XJ50FHAE', 180, 0, 'H0001'),
  ('RAC-VJ60WHAE', 180, 0, 'H0001'),
  ('RAM-G36N2HAE', 180, 0, 'H0001'),
  ('RAC-70NPD', 180, 0, 'H0001'),
  ('RAC-VJ70NHAE', 180, 0, 'H0001'),
  ('RAK-DJ70RHAE', 180, 0, 'H0001'),
  ('RAC-CJ20WHAE', 180, 0, 'H0001'),
  ('RAF-XJ50QHAE', 180, 0, 'H0001'),
  ('RAC-XJ25FHAE', 180, 0, 'H0001'),
  ('RAF-XJ35QHAE', 180, 0, 'H0001'),
  ('RAD-VJ35RHAE', 180, 0, 'H0001'),
  ('RAC-VJ18WHAE', 180, 0, 'H0001'),
  ('RAC-25NPE', 180, 0, 'H0001'),
  ('RAK-XJ50RHBEG', 180, 0, 'H0001'),
  ('HZKF12KIE-Q', 180, 0, 'H0001'),
  ('RAC-VJ25NHAE', 180, 0, 'H0001'),
  ('HZKF08KIE-Q', 180, 0, 'H0001'),
  ('RAK-XJ50RHBE', 180, 0, 'H0001'),
  ('HZKF16KSE-Q', 180, 0, 'H0001'),
  ('RAK-XJ35RHBEG', 180, 0, 'H0001'),
  ('RAC-XJ50WHBE', 180, 0, 'H0001'),
  ('RAD-VJ25RHAE', 180, 0, 'H0001'),
  ('RAC-25FXE', 180, 0, 'H0001'),
  ('RAC-DJ70WHAE', 180, 0, 'H0001'),
  ('HZKF12KSO-Q', 180, 0, 'H0001'),
  ('RAD-VJ18QHAE', 180, 0, 'H0001'),
  ('RAD-VJ70RHAE', 180, 0, 'H0001'),
  ('HZKF12KW230E-Q', 180, 0, 'H0001'),
  ('RAF-35RXE', 180, 0, 'H0001'),
  ('RAK-XJ25RHBEG', 180, 0, 'H0001'),
  ('RAK-VJ70RHAE', 180, 0, 'H0001'),
  ('HZKF08KW230E-Q', 180, 0, 'H0001'),
  ('RAC-XJ35WHBE', 180, 0, 'H0001'),
  ('RAC-35FXE', 180, 0, 'H0001'),
  ('HZKF16KIE-Q', 180, 0, 'H0001'),
  ('RAK-XJ35RHBE', 180, 0, 'H0001'),
  ('HZKF12KIO-Q', 180, 0, 'H0001'),
  ('RAD-DJ70QHAE', 180, 0, 'H0001'),
  ('RAC-XJ25WHBE', 180, 0, 'H0001'),
  ('RAC-VJ70WHAE', 180, 0, 'H0001'),
  ('HZKF16KW230E-Q', 180, 0, 'H0001'),
  ('HZKF16KW230O-Q', 180, 0, 'H0001'),
  ('RAK-XJ25RHBE', 180, 0, 'H0001'),
  ('HZKF12KW230O-Q', 180, 0, 'H0001'),
  ('HZKF16KIO-Q', 180, 0, 'H0001'),
  ('HZKF16KSO-Q', 180, 0, 'H0001'),
  ('RAK-XJ18QHBEG', 180, 0, 'H0001'),
  ('RAK-XJ18QHBE', 180, 0, 'H0001'),
  ('RAK-18QXE', 180, 0, 'H0001'),
  ('ATW-CKS-04', 180, 0, 'H0001'),
  ('RAD-18QPE', 180, 0, 'H0001'),
  ('PDF-71C1', 180, 0, 'H0001'),
  ('PSC-5HR1', 180, 0, 'H0001'),
  ('RAS-5FSXNP2E', 180, 0, 'H0001')
on conflict (reference_article) do update set
  delai_jours = excluded.delai_jours, securite_jours = excluded.securite_jours,
  fournisseur = excluded.fournisseur, maj_le = now();

insert into public.appro_parametres (cle, valeur, description) values
  ('promesses_delai_defaut_jours', 90, 'Dates de livraison interdites : délai par défaut (jours) hors table cdc_promesses_delais'),
  ('promesses_securite_defaut_jours', 7, 'Dates de livraison interdites : sécurité par défaut (jours) ajoutée à la date proposée')
on conflict (cle) do update set valeur = excluded.valeur, description = excluded.description;

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
  v_delai_defaut integer := coalesce((select valeur from public.appro_parametres where cle = 'promesses_delai_defaut_jours'), 90)::int;
  v_secu_defaut integer := coalesce((select valeur from public.appro_parametres where cle = 'promesses_securite_defaut_jours'), 7)::int;
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

  -- Exclusions (mêmes règles que le Portefeuille livraison). Délai de
  -- référence (20/10/2026) : table cdc_promesses_delais (Hitachi H0001 :
  -- 180 j sans sécurité), sinon 90 j + 7 j de sécurité (paramètres
  -- promesses_delai_defaut_jours / promesses_securite_defaut_jours).
  -- L'arrêt appro reste lu dans v_appro_delai_article.
  update _pc_anal a set
    arret_appro = coalesce(d.arret_appro, false),
    date_appro = case when coalesce(d.arret_appro, false) then null
                      else current_date + d.delai + d.secu end,
    motif_exclusion = case
      when not exists (select 1 from sage.stock_depot sd where sd.sto_art_num = a.ref) then 'HORS_STOCK'
      -- La rupture créée (ou, à défaut, la date promise) tombe après la
      -- période figée (création + délai) : un appro passé à la saisie
      -- arrive avant que quiconque manque de stock.
      when not coalesce(d.arret_appro, false)
           and coalesce(a.date_rupture, a.echeance) >= a.date_bc + d.delai then 'APPRO_POSSIBLE'
    end
  from (select r.ref, dl.arret_appro,
               coalesce(pd.delai_jours, v_delai_defaut) delai,
               case when pd.reference_article is not null then pd.securite_jours else v_secu_defaut end secu
        from (select distinct ref from _pc_anal) r
        left join public.v_appro_delai_article dl on dl.reference_article = r.ref
        left join public.cdc_promesses_delais pd on pd.reference_article = r.ref) d
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

-- Application immédiate aux lignes déjà calculées (sans attendre hh:35).
update public.cdc_promesses_controle c set
  arret_appro = coalesce(d.arret_appro, false),
  date_appro = case when coalesce(d.arret_appro, false) then null else current_date + d.delai + d.secu end,
  motif_exclusion = case
    when not exists (select 1 from sage.stock_depot sd where sd.sto_art_num = c.reference_article) then 'HORS_STOCK'
    when not coalesce(d.arret_appro, false)
         and coalesce(c.date_rupture, c.echeance) >= c.date_creation + d.delai then 'APPRO_POSSIBLE'
  end
from (select r.reference_article, dl.arret_appro,
             coalesce(pd.delai_jours, 90) delai,
             case when pd.reference_article is not null then pd.securite_jours else 7 end secu
      from (select distinct reference_article from public.cdc_promesses_controle) r
      left join public.v_appro_delai_article dl on dl.reference_article = r.reference_article
      left join public.cdc_promesses_delais pd on pd.reference_article = r.reference_article) d
where d.reference_article = c.reference_article and c.verdict <> 'OK';

update public.cdc_promesses_controle set premiere_detection = coalesce(premiere_detection, now())
where verdict <> 'OK' and motif_exclusion is null;

-- Contrôle : 150 délais, ~198 CDC interdites attendues.
select (select count(*) from public.cdc_promesses_delais) refs_hitachi,
       count(distinct numero_document) filter (where verdict <> 'OK' and motif_exclusion is null and ouverte) cdc_interdites
from public.cdc_promesses_controle;
