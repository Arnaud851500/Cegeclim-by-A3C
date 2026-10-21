-- ============================================================================
-- 20261021b_equivalences_ro.sql
-- ----------------------------------------------------------------------------
-- Écran « Équivalences R/O AirH2O 600 / 800 » (/stock/equivalences-ro).
-- Appliquée en base le 21/10/2026.
--
-- Pour chaque groupe extérieur AirH2O 600 (RAS-xWH(V)RP2E) et 800 (RASM-x(V)TW2E),
-- des groupes « backup » d'anciennes générations (Premium, S-Combi, Yutaki M/H,
-- AirH2O 400…) que les commerciaux peuvent proposer à la place.
-- Règle d'Arnaud : stock de puissance équivalente ou supérieure, gestion commerciale
-- et marge, sans passer par le technique. Les associations se modifient à l'écran
-- (glisser-déposer) ; le pré-remplissage ci-dessous n'est qu'un point de départ.
-- ============================================================================

-- 1. Associations cible → backup ---------------------------------------------
create table if not exists public.stock_equivalences (
  id uuid primary key default gen_random_uuid(),
  groupe text not null default 'RO_AIRH2O',
  ref_cible text not null,
  ref_backup text not null,
  rang integer not null default 1,
  origine text not null default 'manuel' check (origine in ('auto', 'manuel')),
  commentaire text,
  created_by uuid default auth.uid(),
  created_by_email text default (auth.jwt() ->> 'email'),
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (groupe, ref_cible, ref_backup),
  check (ref_cible <> ref_backup)
);
create index if not exists stock_equivalences_backup_idx on public.stock_equivalences (groupe, ref_backup);

create or replace function public.stock_equivalences_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by_email := coalesce(auth.jwt() ->> 'email', new.updated_by_email);
  return new;
end $$;
drop trigger if exists stock_equivalences_touch on public.stock_equivalences;
create trigger stock_equivalences_touch before update on public.stock_equivalences
  for each row execute function public.stock_equivalences_touch();

alter table public.stock_equivalences enable row level security;
drop policy if exists stock_equivalences_all_authenticated on public.stock_equivalences;
create policy stock_equivalences_all_authenticated on public.stock_equivalences
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.stock_equivalences to authenticated;

-- 2. Données de l'écran ------------------------------------------------------
--    cibles : groupes AirH2O 600/800, taille (code Hitachi), alimentation,
--             prix public (ar_prixven), stock, arrivages / CDC / non tenables par mois
--    pool   : groupes extérieurs R/O d'anciennes générations (familles U.E split,
--             monobloc, AirH2O 400) + toute référence déjà utilisée en backup
--    liens  : associations de stock_equivalences
create or replace function public.get_equivalences_ro()
returns jsonb
language sql stable security definer set search_path = public, interne, sage
as $$
with proj as materialized (select * from get_penurie_projection_mensuelle(6)),
pen as materialized (select * from get_references_penurie(false)),
prix as (
  select distinct on (ab.ar_ref) ab.ar_ref ref, ab.ar_prixven prix, ab.ar_design design, ab.ar_sommeil
  from sage.article_bis ab order by ab.ar_ref, ab.loaded_at desc nulls last
),
cibles as (
  select p.reference_article ref, p.designation, p.famille, p.famille_macro,
         case when p.reference_article like 'RASM-%' then '800' else '600' end gamme,
         substring(p.reference_article from '^RASM?-([0-9.]+)') taille,
         case when p.reference_article ~ '^RASM-[0-9.]+VTW2E$' or p.reference_article ~ '^RAS-[0-9.]+WHVRP2E$' then '230 V mono' else '400 V' end alim,
         pr.prix, p.stock_reel, p.stock_disponible, pe.qte_dispo_aujourdhui, pe.besoin_cdc_total, pe.nb_cdc,
         pe.date_prochaine_dispo, p.mois
  from proj p
  left join pen pe on pe.reference_article = p.reference_article
  left join prix pr on pr.ref = p.reference_article
  where p.reference_article ~ '^(RAS-[0-9.]+WHV?RP2E|RASM-[0-9.]+V?TW2E)$'
),
liens as (
  select e.* from stock_equivalences e where e.groupe = 'RO_AIRH2O'
),
pool_refs as (
  select pe.reference_article ref from pen pe
  where pe.famille in ('00RORASUE', '00RORASM', '00ROH2OUE')
    and pe.reference_article !~ '^(RAS-[0-9.]+WHV?RP2E|RASM-[0-9.]+V?TW2E)$'
    and not coalesce(pe.sommeil, false)
  union
  select ref_backup from liens
),
pool as (
  select r.ref, coalesce(pe.designation, pr.design) designation, pe.famille, pe.famille_macro, pr.prix,
         pe.stock_reel, pe.stock_disponible, pe.qte_dispo_aujourdhui, pe.besoin_cdc_total, pe.nb_cdc,
         pe.receptions_total, pe.prochaine_reception_date, pe.date_prochaine_dispo, coalesce(pe.sommeil, pr.ar_sommeil = '1', false) sommeil
  from pool_refs r
  left join pen pe on pe.reference_article = r.ref
  left join prix pr on pr.ref = r.ref
)
select jsonb_build_object(
  'calcule_le', now(),
  'cibles', coalesce((select jsonb_agg(to_jsonb(c) order by c.taille::numeric, c.gamme, c.alim) from cibles c), '[]'::jsonb),
  'pool', coalesce((select jsonb_agg(to_jsonb(p) order by p.ref) from pool p), '[]'::jsonb),
  'liens', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ref_cible', l.ref_cible, 'ref_backup', l.ref_backup,
            'rang', l.rang, 'origine', l.origine, 'commentaire', l.commentaire,
            'modifie_par', coalesce(l.updated_by_email, l.created_by_email), 'modifie_le', l.updated_at)
            order by l.ref_cible, l.rang, l.created_at) from liens l), '[]'::jsonb)
);
$$;
grant execute on function public.get_equivalences_ro() to authenticated;

-- 3. Recherche d'une référence à ajouter en backup ----------------------------
create or replace function public.rechercher_article_equivalence(p_q text)
returns table(ref text, designation text, famille text, prix numeric, stock_disponible numeric)
language sql stable security definer set search_path = public, sage
as $$
  with ab as (
    select distinct on (ar_ref) ar_ref, ar_design, fa_codefamille, ar_prixven, ar_sommeil
    from sage.article_bis order by ar_ref, loaded_at desc nulls last
  ),
  stk as (
    select sto_art_num, sum(coalesce(sto_qte, 0) - coalesce(sto_prepa, 0)) s
    from sage.stock_depot group by sto_art_num
  )
  select ab.ar_ref, ab.ar_design, ab.fa_codefamille, ab.ar_prixven, coalesce(stk.s, 0)
  from ab left join stk on stk.sto_art_num = ab.ar_ref
  where length(trim(coalesce(p_q, ''))) >= 2
    and coalesce(ab.ar_sommeil, '0') <> '1'
    and (ab.ar_ref ilike '%' || trim(p_q) || '%' or ab.ar_design ilike '%' || trim(p_q) || '%')
  order by (ab.ar_ref ilike trim(p_q) || '%') desc, coalesce(stk.s, 0) desc, ab.ar_ref
  limit 25;
$$;
grant execute on function public.rechercher_article_equivalence(text) to authenticated;

-- 4. Pré-remplissage (une fois) -----------------------------------------------
--    Même technologie (split / monobloc), même alimentation, puissance ≥ et ≤ +6 kW,
--    stock dispo > 0 ; 3 backups au plus par cible, du plus proche en puissance.
with cible(ref, techno, alim, kw) as (values
  ('RAS-1.5WHVRP2E','split','230',3.5), ('RAS-2WHVRP2E','split','230',4), ('RAS-2.5WHVRP2E','split','230',6),
  ('RAS-3WHVRP2E','split','230',8), ('RAS-3.5WHVRP2E','split','230',8.5), ('RAS-3.5WHRP2E','split','400',8.5),
  ('RAS-4WHVRP2E','split','230',10), ('RAS-4WHRP2E','split','400',10), ('RAS-5WHVRP2E','split','230',12),
  ('RAS-5WHRP2E','split','400',12), ('RAS-6WHVRP2E','split','230',14), ('RAS-6WHRP2E','split','400',14),
  ('RASM-2VTW2E','mono','230',4), ('RASM-3VTW2E','mono','230',6), ('RASM-3.5VTW2E','mono','230',8),
  ('RASM-4VTW2E','mono','230',10), ('RASM-4TW2E','mono','400',10), ('RASM-5VTW2E','mono','230',12),
  ('RASM-5TW2E','mono','400',12), ('RASM-6VTW2E','mono','230',14), ('RASM-6TW2E','mono','400',14)
),
ancien(ref, techno, alim, kw) as (values
  ('RAS-2WHVN','split','230',4), ('RAS-2.5WHVN','split','230',6), ('RAS-2WHVRP1','split','230',4),
  ('RAS-2.5WHVRP1','split','230',6), ('RAS-3WHVRP1','split','230',8),
  ('RAS-4WHVNPE','split','230',11), ('RAS-4WHNPE','split','400',11), ('RAS-5WHVNPE','split','230',14),
  ('RAS-5WHNPE','split','400',14), ('RAS-6WHVNPE','split','230',16), ('RAS-6WHNPE','split','400',16),
  ('RAS-8WHNPE','split','400',20), ('RAS-10WHNPE','split','400',24),
  ('HZKF08KSE-Q','split','230',8), ('HZKF12KSE-Q','split','230',12), ('HZKF12KSO-Q','split','400',12),
  ('HZKF16KSE-Q','split','230',16), ('HZKF16KSO-Q','split','400',16),
  ('RASM-2VR2E','mono','230',4.3), ('RASM-3VR2E','mono','230',8), ('RASM-4VR1E','mono','230',11),
  ('RASM-4R1E','mono','400',11), ('RASM-4VRW1E','mono','230',11), ('RASM-4RW1E','mono','400',11),
  ('RASM-5VR1E','mono','230',12), ('RASM-5R1E','mono','400',12), ('RASM-5VRW1E','mono','230',12),
  ('RASM-5RW1E','mono','400',12), ('RASM-5NE','mono','400',14), ('RASM-6VR1E','mono','230',13),
  ('RASM-6R1E','mono','400',13), ('RASM-6RW1E','mono','400',13), ('RASM-7R1E','mono','400',16),
  ('RASM-7RW1E','mono','400',16)
),
stk as (
  select sto_art_num ref, sum(coalesce(sto_qte, 0) - coalesce(sto_prepa, 0)) s
  from sage.stock_depot group by sto_art_num
),
cand as (
  select c.ref cible, a.ref backup,
         row_number() over (partition by c.ref order by a.kw - c.kw, coalesce(s.s, 0) desc, a.ref) rg
  from cible c
  join ancien a on a.techno = c.techno and a.alim = c.alim and a.kw >= c.kw and a.kw <= c.kw + 6
  join stk s on s.ref = a.ref and s.s > 0
)
insert into public.stock_equivalences (groupe, ref_cible, ref_backup, rang, origine, created_by, created_by_email)
select 'RO_AIRH2O', cible, backup, rg, 'auto', null, 'pré-remplissage (puissance ≥, même alimentation)'
from cand where rg <= 3
on conflict (groupe, ref_cible, ref_backup) do nothing;
