-- ============================================================================
-- 20261021c_solutions_ro.sql
-- ----------------------------------------------------------------------------
-- Écran « Équivalences R/O AirH2O 600 / 800 » (/stock/equivalences-ro), v2.
-- Appliquée en base le 21/10/2026 (en trois migrations : tables, RPC, pré-remplissage).
--
-- Validé par Arnaud sur l'exemple de la taille 3,5 : un groupe extérieur AirH2O ne
-- se vend pas seul, il entre dans une solution selon l'usage. Pour chaque groupe et
-- chaque usage :
--   - la solution actuelle (groupe AirH2O + module intérieur + ballon…) ;
--   - des solutions backup d'anciennes générations (groupe + module + accessoire).
-- Une solution n'est réalisable que si tous ses composants sont en stock : quantité
-- réalisable = min(libre du composant / quantité), écart de prix = somme des prix publics.
-- Usages : S (chauffage / réversible), S_ECS (S + ballon séparé), COMBI (S Combi 220 L),
--          MONO_H (AirH2O 800 H), MONO_H_COMBI (AirH2O 800 H Combi).
-- stock_equivalences (v1, groupe → groupe) reste en base : elle a servi de point de
-- départ aux backups ; l'écran v2 ne l'utilise plus.
-- ============================================================================

-- 1. Tables -------------------------------------------------------------------
create table if not exists public.stock_solutions (
  id uuid primary key default gen_random_uuid(),
  groupe text not null default 'RO_AIRH2O',
  ref_cible text not null,
  usage text not null check (usage in ('S', 'S_ECS', 'COMBI', 'MONO_H', 'MONO_H_COMBI')),
  role text not null check (role in ('actuelle', 'backup')),
  libelle text,
  rang integer not null default 1,
  origine text not null default 'manuel' check (origine in ('auto', 'manuel')),
  commentaire text,
  created_by_email text default (auth.jwt() ->> 'email'),
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stock_solutions_cible_idx on public.stock_solutions (groupe, ref_cible, usage);
create unique index if not exists stock_solutions_actuelle_uq on public.stock_solutions (groupe, ref_cible, usage) where role = 'actuelle';

create table if not exists public.stock_solution_composants (
  id uuid primary key default gen_random_uuid(),
  solution_id uuid not null references public.stock_solutions(id) on delete cascade,
  ref_article text not null,
  quantite numeric not null default 1 check (quantite > 0),
  rang integer not null default 1,
  created_at timestamptz not null default now(),
  unique (solution_id, ref_article)
);
create index if not exists stock_solution_composants_ref_idx on public.stock_solution_composants (ref_article);

create trigger stock_solutions_touch before update on public.stock_solutions
  for each row execute function public.stock_equivalences_touch();

alter table public.stock_solutions enable row level security;
create policy stock_solutions_all_authenticated on public.stock_solutions
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.stock_solutions to authenticated;

alter table public.stock_solution_composants enable row level security;
create policy stock_solution_composants_all_authenticated on public.stock_solution_composants
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.stock_solution_composants to authenticated;

-- 2. Données de l'écran -------------------------------------------------------
--    cibles    : groupes AirH2O 600/800 (taille, alimentation, prix, stock, arrivages / CDC par mois)
--    solutions : solutions actuelles et backups avec leurs composants
--    articles  : fiche de chaque référence utile (prix public, stock, libre = promettable
--                aujourd'hui, CDC, CDF) — composants + pool (U.E, U.I, ballons, accessoires R/O)
create or replace function public.get_solutions_ro()
returns jsonb
language sql stable security definer set search_path = public, interne, sage
as $$
with proj as materialized (
  select * from get_penurie_projection_mensuelle(6)
  where reference_article ~ '^(RAS-[0-9.]+WHV?RP2E|RASM-[0-9.]+V?TW2E)$'
),
pen as materialized (select * from get_references_penurie(false)),
ab as (
  select distinct on (ar_ref) ar_ref ref, ar_design design, fa_codefamille famille, ar_prixven prix, ar_sommeil
  from sage.article_bis order by ar_ref, loaded_at desc nulls last
),
stk as (
  select sto_art_num ref, sum(coalesce(sto_qte, 0) - coalesce(sto_prepa, 0)) s
  from sage.stock_depot group by sto_art_num
),
cibles as (
  select p.reference_article ref, p.designation, p.famille,
         case when p.reference_article like 'RASM-%' then '800' else '600' end gamme,
         substring(p.reference_article from '^RASM?-([0-9.]+)') taille,
         case when p.reference_article ~ '^RASM-[0-9.]+VTW2E$' or p.reference_article ~ '^RAS-[0-9.]+WHVRP2E$' then '230 V mono' else '400 V' end alim,
         a.prix, p.stock_reel, p.stock_disponible, pe.qte_dispo_aujourdhui, pe.besoin_cdc_total, pe.nb_cdc,
         pe.date_prochaine_dispo, p.mois
  from proj p
  left join pen pe on pe.reference_article = p.reference_article
  left join ab a on a.ref = p.reference_article
),
sols as (
  select s.*, coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'ref', c.ref_article, 'quantite', c.quantite, 'rang', c.rang) order by c.rang, c.created_at)
    from stock_solution_composants c where c.solution_id = s.id), '[]'::jsonb) composants
  from stock_solutions s where s.groupe = 'RO_AIRH2O'
),
pool_refs as (
  select a.ref from ab a
  where (a.famille in ('00RORASUE', '00RORASM', '00ROH2OUE', '00RORWMUI', '00RORWDUI', '00RORWHUI', '00ROHUI', '00ROH2OUI', '00ROECS')
         or (a.famille = '00ACC' and a.ref ~ '^(ATW-|PC-ARFH|WEH)'))
    and coalesce(a.ar_sommeil, '0') <> '1'
),
refs as (
  select ref from pool_refs
  union select c.ref_article from stock_solution_composants c join stock_solutions s on s.id = c.solution_id where s.groupe = 'RO_AIRH2O'
  union select ref from cibles
),
articles as (
  select r.ref, coalesce(pe.designation, a.design) designation, coalesce(pe.famille, a.famille) famille, a.prix,
         coalesce(pe.stock_disponible, st.s, 0) stock_disponible,
         coalesce(pe.qte_dispo_aujourdhui, greatest(coalesce(st.s, 0), 0)) libre,
         coalesce(pe.besoin_cdc_total, 0) cdc, coalesce(pe.receptions_total, 0) cdf,
         pe.prochaine_reception_date, pe.date_prochaine_dispo,
         (r.ref in (select ref from pool_refs)) pool,
         coalesce(pe.sommeil, a.ar_sommeil = '1', false) sommeil
  from refs r
  left join pen pe on pe.reference_article = r.ref
  left join ab a on a.ref = r.ref
  left join stk st on st.ref = r.ref
)
select jsonb_build_object(
  'calcule_le', now(),
  'cibles', coalesce((select jsonb_agg(to_jsonb(c) order by c.taille::numeric, c.gamme, c.alim) from cibles c), '[]'::jsonb),
  'solutions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'ref_cible', s.ref_cible, 'usage', s.usage, 'role', s.role,
        'libelle', s.libelle, 'rang', s.rang, 'origine', s.origine, 'commentaire', s.commentaire,
        'modifie_par', coalesce(s.updated_by_email, s.created_by_email), 'composants', s.composants)
        order by s.ref_cible, s.usage, s.role, s.rang, s.created_at) from sols s), '[]'::jsonb),
  'articles', coalesce((select jsonb_object_agg(a.ref, to_jsonb(a) - 'ref') from articles a), '{}'::jsonb)
);
$$;
grant execute on function public.get_solutions_ro() to authenticated;

-- 3. Pré-remplissage (une fois) -----------------------------------------------
--    Solution actuelle : 600 → RWM-xR3E (S), + DHWT200S (≤ 2,5) / DHWT300S (S_ECS), RWD-xRW3E-220S (Combi) ;
--                        800 → HWM-W2E (H), HWD-W2E-220S (H Combi).
--    Backups : groupes de stock_equivalences (puissance ≥, même alimentation, + corrections
--    manuelles) complétés de leur module : Premium → RWM-xN1E / RWD-xNW1E-220S (+ DHWT300S),
--    Premium R32 → RWD-xRW2E/RW1E-220S, S-Combi Lite → RWD-xNWLE-200S, AirH2O 400 → HZKF…KI / KW230,
--    Yutaki H → HWM-WE / HWD-WE-220S, Yutaki M → seul (commande à ajouter). 3 au plus par usage.
with arts as (select distinct ar_ref from sage.article_bis),
cib as (
  select ar_ref ref, case when ar_ref like 'RASM-%' then '800' else '600' end gamme,
         substring(ar_ref from '^RASM?-([0-9.]+)')::numeric sz
  from arts where ar_ref ~ '^(RAS-[0-9.]+WHV?RP2E|RASM-[0-9.]+V?TW2E)$'
),
cib2 as (select c.*, trim(to_char(c.sz, 'FM90.0')) n1 from cib c),
us(gamme, usage, lib) as (values
  ('600','S','AirH2O 600 S'), ('600','S_ECS','AirH2O 600 S + ballon ECS'), ('600','COMBI','AirH2O 600 S Combi'),
  ('800','MONO_H','AirH2O 800 H'), ('800','MONO_H_COMBI','AirH2O 800 H Combi')),
act as (
  select c.ref, u.usage, u.lib,
    array_remove(array[c.ref,
      case u.usage when 'S' then 'RWM-' || c.n1 || 'R3E' when 'S_ECS' then 'RWM-' || c.n1 || 'R3E'
        when 'COMBI' then 'RWD-' || c.n1 || 'RW3E-220S' when 'MONO_H' then 'HWM-W2E' when 'MONO_H_COMBI' then 'HWD-W2E-220S' end,
      case when u.usage = 'S_ECS' then case when c.sz <= 2.5 then 'DHWT200S-3.0H2E' else 'DHWT300S-3.0H2E' end end], null) comps
  from cib2 c join us u on u.gamme = c.gamme
),
old as (
  select e.ref_cible, e.ref_backup o, e.rang, substring(e.ref_backup from '^RASM?-([0-9.]+)') osz
  from stock_equivalences e where e.groupe = 'RO_AIRH2O'
),
old2 as (select o.*, case when o.osz ~ '^[0-9]+(\.[0-9]+)?$' then trim(to_char(o.osz::numeric, 'FM90.0')) end on1 from old o),
bk as (
  select o.ref_cible, u.usage, o.rang, o.o,
    case u.usage
      when 'S' then array[o.o, case when o.o ~ '^RAS-[0-9.]+WHV?NPE$' then 'RWM-' || o.on1 || 'N1E'
                                    when o.o ~ '^HZKF[0-9]+KS[EO]-Q$' then regexp_replace(o.o, 'KS([EO])-Q$', 'KI\1-Q') end, null]
      when 'S_ECS' then array[o.o, case when o.o ~ '^RAS-[0-9.]+WHV?NPE$' then 'RWM-' || o.on1 || 'N1E' end,
                                   case when o.o ~ '^RAS-[0-9.]+WHV?NPE$' then 'DHWT300S-3.0H2E' end]
      when 'COMBI' then array[o.o, case when o.o ~ '^RAS-[0-9.]+WHV?NPE$' then 'RWD-' || o.on1 || 'NW1E-220S'
             when o.o ~ '^RAS-[0-9.]+WHVRP1$' then (select x from unnest(array['RWD-' || o.on1 || 'RW2E-220S', 'RWD-' || o.on1 || 'RW1E-220S']) x where x in (select ar_ref from arts) limit 1)
             when o.o ~ '^RAS-[0-9.]+WHVN$' then 'RWD-' || o.on1 || 'NWLE-200S'
             when o.o ~ '^HZKF[0-9]+KS[EO]-Q$' then regexp_replace(o.o, 'KS([EO])-Q$', 'KW230\1-Q') end, null]
      when 'MONO_H' then array[o.o, case when o.o ~ '^RASM-[0-9.]+V?RW1E$' then 'HWM-WE' end, null]
      when 'MONO_H_COMBI' then array[o.o, case when o.o ~ '^RASM-[0-9.]+V?RW1E$' then 'HWD-WE-220S' end, null]
    end comps,
    case when u.usage = 'MONO_H' and o.o ~ '^RASM-' and o.o !~ 'RW1E$' then 'Yutaki M : commande à ajouter' end note,
    case when o.o ~ '^RAS-[0-9.]+WHV?NPE$' and o.o ~ '^RAS-(8|10)' then 'IVX'
         when o.o ~ '^RAS-[0-9.]+WHV?NPE$' then 'Premium'
         when o.o ~ '^RAS-[0-9.]+WHVRP1$' then 'Premium R32'
         when o.o ~ '^RAS-[0-9.]+WHVN$' then 'S-Combi Lite'
         when o.o ~ '^HZKF' then 'AirH2O 400'
         when o.o ~ 'RW1E$' then 'Yutaki H'
         when o.o ~ '^RASM-' then 'Yutaki M'
         else 'Ancienne génération' end lib
  from old2 o join cib2 c on c.ref = o.ref_cible join us u on u.gamme = c.gamme
),
bk_ok as (
  select * from bk
  where (comps[2] is not null and comps[2] in (select ar_ref from arts)
         and (comps[3] is null or comps[3] in (select ar_ref from arts)))
     or note is not null
),
bk_rk as (select b.*, row_number() over (partition by b.ref_cible, b.usage order by b.rang, b.o) rk from bk_ok b),
ins_act as (
  insert into stock_solutions (groupe, ref_cible, usage, role, libelle, rang, origine, created_by_email)
  select 'RO_AIRH2O', a.ref, a.usage, 'actuelle', a.lib, 0, 'auto', 'pré-remplissage' from act a
  on conflict do nothing
  returning id, ref_cible, usage
),
ins_bk as (
  insert into stock_solutions (groupe, ref_cible, usage, role, libelle, rang, origine, commentaire, created_by_email)
  select 'RO_AIRH2O', b.ref_cible, b.usage, 'backup', b.lib, b.rk, 'auto', b.note, 'pré-remplissage' from bk_rk b where b.rk <= 3
  returning id, ref_cible, usage, rang
)
insert into stock_solution_composants (solution_id, ref_article, quantite, rang)
select ia.id, x.ref, 1, x.ord
from ins_act ia join act a on a.ref = ia.ref_cible and a.usage = ia.usage
cross join lateral unnest(a.comps) with ordinality x(ref, ord)
where x.ref in (select ar_ref from arts)
union all
select ib.id, x.ref, 1, x.ord
from ins_bk ib join bk_rk b on b.ref_cible = ib.ref_cible and b.usage = ib.usage and b.rk = ib.rang
cross join lateral unnest(array_remove(b.comps, null)) with ordinality x(ref, ord);
