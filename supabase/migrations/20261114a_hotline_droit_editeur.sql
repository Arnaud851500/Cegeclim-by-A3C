-- ============================================================================
-- 20261114a_hotline_droit_editeur.sql — Droit « Hotline – expert (éditeur) »
-- ----------------------------------------------------------------------------
-- (14/11/2026, demande d'Arnaud) L'éditeur de diagnostic (parcours, documents
-- Soleil, paramètres hotline, exports) sort du profil « Hotline niveau 2 » :
-- nouveau droit can_hotline_editeur, porté par le nouveau profil
-- « Hotline expert » et par les profils Administrateur, Direction et
-- « Piliers et visu large ». can_hotline_expert reste le droit niveau 2 / 3
-- (synthèse N2/N3, statistiques).
-- Les documents des parcours peuvent être déposés : bucket hotline-documents.
-- ============================================================================

alter table public.access_profiles add column if not exists can_hotline_editeur boolean not null default false;
alter table public.user_page_access add column if not exists can_hotline_editeur boolean not null default false;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'user_page_access_droits_depuis_profils';
  if v_def not like '%can_hotline_editeur%' then
    v_def := replace(v_def, 'coalesce(bool_or(p.can_hotline_expert), false)    as can_hotline_expert',
      'coalesce(bool_or(p.can_hotline_expert), false)    as can_hotline_expert,' || chr(10) || '    coalesce(bool_or(p.can_hotline_editeur), false)   as can_hotline_editeur');
    v_def := replace(v_def, 'new.can_hotline_expert    := r.can_hotline_expert;',
      'new.can_hotline_expert    := r.can_hotline_expert;' || chr(10) || '  new.can_hotline_editeur   := r.can_hotline_editeur;');
    if v_def not like '%r.can_hotline_editeur%' or v_def not like '%as can_hotline_editeur%' then
      raise exception 'Patch de user_page_access_droits_depuis_profils impossible';
    end if;
    execute v_def;
  end if;
end
$$;

update public.access_profiles set can_hotline_editeur = true
where name in ('Administrateur', 'Direction', 'Piliers et visu large');

insert into public.access_profiles (code, name, description, can_hotline, can_hotline_expert, can_hotline_editeur)
select 'hotline-expert', 'Hotline expert',
       'Expert hotline : éditeur des parcours de diagnostic et des documents, paramètres hotline, plus les droits niveau 2 / 3.',
       true, true, true
where not exists (select 1 from public.access_profiles where code = 'hotline-expert');

update public.access_profiles
set description = 'Technicien hotline niveau 2 / 3 : synthèse des tickets escaladés N2 et N3, console, tickets et statistiques.'
where code = 'hotline-n2';

-- Recalcul des droits des utilisateurs depuis leurs profils.
update public.user_page_access set email = email where email is not null;

create or replace function public.hotline_peut_editer()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.user_page_access u
    where u.email = public.current_user_email()
      and (coalesce(u.can_hotline_editeur, false) or coalesce(u.can_autorisation, false))
  );
$$;
grant execute on function public.hotline_peut_editer() to authenticated;

drop policy if exists hotline_arbres_expert on public.hotline_arbres;
create policy hotline_arbres_expert on public.hotline_arbres for all to authenticated using (public.hotline_peut_editer()) with check (public.hotline_peut_editer());
drop policy if exists hotline_noeuds_expert on public.hotline_noeuds;
create policy hotline_noeuds_expert on public.hotline_noeuds for all to authenticated using (public.hotline_peut_editer()) with check (public.hotline_peut_editer());
drop policy if exists hotline_lignes_expert on public.hotline_lignes;
create policy hotline_lignes_expert on public.hotline_lignes for all to authenticated using (public.hotline_peut_editer()) with check (public.hotline_peut_editer());
drop policy if exists hotline_docs_soleil_ecriture on public.hotline_docs_soleil;
create policy hotline_docs_soleil_ecriture on public.hotline_docs_soleil for all to authenticated using (public.hotline_peut_editer()) with check (public.hotline_peut_editer());
drop policy if exists hotline_parametres_ecriture on public.hotline_parametres;
create policy hotline_parametres_ecriture on public.hotline_parametres for update to authenticated using (public.hotline_peut_editer()) with check (public.hotline_peut_editer());
drop policy if exists hotline_exports_select on public.hotline_exports;
create policy hotline_exports_select on public.hotline_exports for select to authenticated using (public.hotline_peut_editer());

drop policy if exists hotline_documents_ajout on storage.objects;
create policy hotline_documents_ajout on storage.objects for insert to authenticated
  with check (bucket_id = 'hotline-documents' and public.hotline_peut_editer());
drop policy if exists hotline_documents_suppression on storage.objects;
create policy hotline_documents_suppression on storage.objects for delete to authenticated
  using (bucket_id = 'hotline-documents' and public.hotline_peut_editer());
drop policy if exists hotline_exports_lecture on storage.objects;
create policy hotline_exports_lecture on storage.objects for select to authenticated
  using (bucket_id = 'hotline-exports' and public.hotline_peut_editer());

-- Suppression des tickets de test : réservée aux mêmes personnes (onglet Paramètres).
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.hotline_supprimer_tickets_test()'::regprocedure) into v_def;
  execute replace(replace(v_def, 'public.hotline_est_expert()', 'public.hotline_peut_editer()'), 'réservée aux experts hotline', 'réservée aux experts hotline (éditeur)');
end
$$;
