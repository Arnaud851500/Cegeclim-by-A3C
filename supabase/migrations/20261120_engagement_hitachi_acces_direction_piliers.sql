-- 20/11/2026 : écran Engagement Hitachi ouvert en lecture au profil Direction, au profil
-- « Piliers et visu large » et aux membres des Piliers (piliers_est_membre).
-- Les règles de rattachement restent modifiables par Arnaud seul (hitachi_engagement_editeur).
-- Appliqué en production le 20/11/2026.
create or replace function public.hitachi_engagement_editeur()
returns boolean
language sql
stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email'), '') in ('a.valanchauskas@cegeclim-energies.com', 'valancha@gmail.com')
      or auth.jwt() is null
$$;

create or replace function public.hitachi_engagement_autorise()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.hitachi_engagement_editeur()
      or coalesce(public.piliers_est_membre(), false)
      or exists (
        select 1
        from public.user_page_access u
        join public.access_profiles p
          on p.id = u.access_profile_id or p.id = any(coalesce(u.profils_complementaires, '{}'::uuid[]))
        where lower(u.email) = lower(auth.jwt() ->> 'email')
          and coalesce(p.is_active, true)
          and p.name in ('Direction', 'Piliers et visu large')
      )
$$;
grant execute on function public.hitachi_engagement_autorise() to authenticated;
grant execute on function public.hitachi_engagement_editeur() to authenticated;

-- save / delete des règles : contrôle editeur au lieu d'autorise
do $$
declare f text;
begin
  foreach f in array array['save_hitachi_engagement_regle(bigint,integer,text,text,text,text,text,text,boolean,integer,text)', 'delete_hitachi_engagement_regle(bigint)'] loop
    execute (select replace(pg_get_functiondef(f::regprocedure), 'if not public.hitachi_engagement_autorise() then', 'if not public.hitachi_engagement_editeur() then'));
  end loop;
end $$;
