-- =============================================================================
-- Photo quotidienne du stock SAGE par dépôt (12/11/2026)
-- -----------------------------------------------------------------------------
-- Sert au contrôle « Stock FMS SAGE ↔ MyStock » (/stock/controle-mystock) :
-- l'image MyStock est un stock de fin de journée J. Le dernier import SAGE du
-- jour J (≈ 23h05 Paris) donne le stock SAGE de fin de journée J. On garde donc,
-- pour chaque jour, la dernière photo de sage.stock_depot publiée ce jour-là
-- (date = date de chargement à l'heure de Paris, la photo est écrasée par chaque
-- import suivant du même jour, la dernière de la journée l'emporte).
--
-- Job pg_cron « stock-depot-snapshot-journalier » : toutes les heures à h+20
-- (les lots d'import sont publiés à h+10). Purge au-delà de 400 jours.
-- =============================================================================

create table if not exists public.stock_depot_snapshot_journalier (
  date_stock   date        not null,
  sto_dep_num  text        not null,
  sto_dep      text,
  reference    text        not null,
  sto_qte      numeric     not null default 0,
  sto_prepa    numeric     not null default 0,
  sto_res      numeric     not null default 0,
  loaded_at    timestamptz,
  captured_at  timestamptz not null default now(),
  primary key (date_stock, sto_dep_num, reference)
);

alter table public.stock_depot_snapshot_journalier enable row level security;
revoke all on public.stock_depot_snapshot_journalier from anon, authenticated;

create or replace function public.capture_stock_depot_snapshot_journalier()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_loaded timestamptz;
  v_jour   date;
  v_n      integer;
begin
  select max(loaded_at) into v_loaded from sage.stock_depot;
  if v_loaded is null then
    return jsonb_build_object('statut', 'vide');
  end if;
  v_jour := (v_loaded at time zone 'Europe/Paris')::date;

  -- Photo déjà prise pour ce chargement : rien à faire.
  if exists (select 1 from public.stock_depot_snapshot_journalier
             where date_stock = v_jour and loaded_at = v_loaded limit 1) then
    return jsonb_build_object('statut', 'deja_a_jour', 'date_stock', v_jour, 'loaded_at', v_loaded);
  end if;

  delete from public.stock_depot_snapshot_journalier where date_stock = v_jour;

  insert into public.stock_depot_snapshot_journalier
    (date_stock, sto_dep_num, sto_dep, reference, sto_qte, sto_prepa, sto_res, loaded_at)
  select v_jour, s.sto_dep_num, max(trim(s.sto_dep)), upper(trim(s.sto_art_num)),
         coalesce(sum(s.sto_qte), 0), coalesce(sum(s.sto_prepa), 0), coalesce(sum(s.sto_res), 0), v_loaded
  from sage.stock_depot s
  where s.sto_art_num is not null and trim(s.sto_art_num) <> ''
  group by s.sto_dep_num, upper(trim(s.sto_art_num));
  get diagnostics v_n = row_count;

  delete from public.stock_depot_snapshot_journalier where date_stock < current_date - 400;

  return jsonb_build_object('statut', 'capture', 'date_stock', v_jour, 'loaded_at', v_loaded, 'lignes', v_n);
end;
$$;

revoke all on function public.capture_stock_depot_snapshot_journalier() from public, anon, authenticated;

-- Première photo immédiate (stock chargé par le dernier import de la veille).
select public.capture_stock_depot_snapshot_journalier();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'stock-depot-snapshot-journalier') then
    perform cron.unschedule('stock-depot-snapshot-journalier');
  end if;
  perform cron.schedule('stock-depot-snapshot-journalier', '20 * * * *',
                        'select public.capture_stock_depot_snapshot_journalier();');
end $$;
