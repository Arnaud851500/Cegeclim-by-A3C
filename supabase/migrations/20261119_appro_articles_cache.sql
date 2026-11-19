-- 19/11/2026 — Cache du calcul de besoin (écran /stock/calcul-besoin).
-- v_appro_controle_article_sage_blg (~6 000 lignes, 117 colonnes) se recalcule entièrement à chaque
-- page : ~2 s au calme, 20 s et plus pendant la synchro SAGE (h+10 → h+15). Lue en 6 pages, l'écran
-- restait sur « Chargement… 2 000 articles » puis tombait en timeout (500).
-- L'écran lit désormais appro_articles_cache (lignes de la vue en jsonb), rafraîchi toutes les 10 min
-- (pg_cron « appro-articles-cache-refresh ») et par référence après chaque enregistrement
-- (appro_articles_cache_maj_refs). Appliqué en production le 19/11/2026.
create table if not exists public.appro_articles_cache (
  reference_article text primary key,
  ligne jsonb not null
);
create table if not exists public.appro_articles_cache_meta (
  id integer primary key default 1 check (id = 1),
  refreshed_at timestamptz,
  duree_s numeric,
  nb integer
);
alter table public.appro_articles_cache enable row level security;
alter table public.appro_articles_cache_meta enable row level security;
drop policy if exists appro_articles_cache_select on public.appro_articles_cache;
create policy appro_articles_cache_select on public.appro_articles_cache for select to authenticated using (true);
drop policy if exists appro_articles_cache_meta_select on public.appro_articles_cache_meta;
create policy appro_articles_cache_meta_select on public.appro_articles_cache_meta for select to authenticated using (true);
grant select on public.appro_articles_cache, public.appro_articles_cache_meta to authenticated;

create or replace function public.refresh_appro_articles_cache()
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_t0 timestamptz := clock_timestamp();
  v_nb integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('refresh_appro_articles_cache')) then
    return jsonb_build_object('statut', 'deja_en_cours');
  end if;
  create temp table appro_cache_tmp on commit drop as
  select v.reference_article, to_jsonb(v) as ligne from public.v_appro_controle_article_sage_blg v
  where v.reference_article is not null;
  delete from public.appro_articles_cache c where not exists (select 1 from appro_cache_tmp t where t.reference_article = c.reference_article);
  insert into public.appro_articles_cache (reference_article, ligne)
  select distinct on (reference_article) reference_article, ligne from appro_cache_tmp order by reference_article
  on conflict (reference_article) do update set ligne = excluded.ligne
  where public.appro_articles_cache.ligne is distinct from excluded.ligne;
  select count(*) into v_nb from appro_cache_tmp;
  insert into public.appro_articles_cache_meta (id, refreshed_at, duree_s, nb)
  values (1, now(), round(extract(epoch from clock_timestamp() - v_t0)::numeric, 1), v_nb)
  on conflict (id) do update set refreshed_at = excluded.refreshed_at, duree_s = excluded.duree_s, nb = excluded.nb;
  return jsonb_build_object('statut', 'ok', 'nb', v_nb, 'duree_s', round(extract(epoch from clock_timestamp() - v_t0)::numeric, 1));
end;
$$;
revoke all on function public.refresh_appro_articles_cache() from public, anon;
grant execute on function public.refresh_appro_articles_cache() to authenticated;

create or replace function public.appro_articles_cache_maj_refs(p_refs text[])
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare v_nb integer;
begin
  if p_refs is null or cardinality(p_refs) = 0 then return 0; end if;
  insert into public.appro_articles_cache (reference_article, ligne)
  select v.reference_article, to_jsonb(v) from public.v_appro_controle_article_sage_blg v
  where v.reference_article = any(p_refs)
  on conflict (reference_article) do update set ligne = excluded.ligne;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;
revoke all on function public.appro_articles_cache_maj_refs(text[]) from public, anon;
grant execute on function public.appro_articles_cache_maj_refs(text[]) to authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'appro-articles-cache-refresh';
select cron.schedule('appro-articles-cache-refresh', '*/10 4-21 * * *',
  $$SET statement_timeout = '300s'; select public.refresh_appro_articles_cache();$$);
