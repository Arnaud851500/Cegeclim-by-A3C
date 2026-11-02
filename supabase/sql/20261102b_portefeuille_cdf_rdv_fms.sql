-- 02/11/2026 — Portefeuille commandes fournisseurs : RDV de déchargement chez FMS par container.
-- Saisie libre par l'utilisateur (date, heure facultative, commentaire), historisée : chaque
-- modification ajoute une ligne, la plus récente fait foi. Retirer un RDV = ligne avec rdv_date NULL.
-- Les contrôles de cohérence (RDV avant l'ETA, week-end, après la date de livraison SAGE, passé…)
-- sont calculés dans l'écran (app/stock/portefeuille-cdf/page.tsx).

create table if not exists public.appro_cdf_rdv_fms (
  id               bigserial primary key,
  cdf_numero       text not null,
  container_numero text,
  rdv_date         date,
  rdv_heure        time,
  commentaire      text,
  created_at       timestamptz not null default now(),
  created_by       text default (auth.jwt() ->> 'email')
);
create index if not exists appro_cdf_rdv_fms_cdf_idx on public.appro_cdf_rdv_fms (cdf_numero, created_at desc, id desc);

alter table public.appro_cdf_rdv_fms enable row level security;
drop policy if exists appro_cdf_rdv_fms_select on public.appro_cdf_rdv_fms;
create policy appro_cdf_rdv_fms_select on public.appro_cdf_rdv_fms for select to authenticated using (true);
drop policy if exists appro_cdf_rdv_fms_insert on public.appro_cdf_rdv_fms;
create policy appro_cdf_rdv_fms_insert on public.appro_cdf_rdv_fms for insert to authenticated with check (true);
grant select, insert on public.appro_cdf_rdv_fms to authenticated;
grant usage, select on sequence public.appro_cdf_rdv_fms_id_seq to authenticated;

-- RDV en vigueur par CDF (dernière saisie, RDV retirés exclus)
create or replace view public.v_appro_cdf_rdv_fms_actuel
with (security_invoker = true) as
select *
from (
  select distinct on (cdf_numero) id, cdf_numero, container_numero, rdv_date, rdv_heure, commentaire, created_at, created_by
  from public.appro_cdf_rdv_fms
  order by cdf_numero, created_at desc, id desc
) d
where rdv_date is not null;

grant select on public.v_appro_cdf_rdv_fms_actuel to authenticated;
