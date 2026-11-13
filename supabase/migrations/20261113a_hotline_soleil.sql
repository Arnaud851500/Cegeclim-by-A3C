-- ============================================================================
-- 20261113a_hotline_soleil.sql — Hotline : environnement « Soleil » (13/11/2026)
-- ----------------------------------------------------------------------------
-- Demandes d'Arnaud (13/11/2026) :
--  - filière PV renommée « Soleil » (libellé seulement, code PV conservé) ;
--  - arborescence Soleil : NIV 1 = motif (mise en service / exploitation),
--    NIV 2 = marque de l'onduleur (Hoymiles, Solis, Autre), NIV 3 = équipement
--    selon la marque → hotline_tickets.pv_marque / pv_equipement ;
--  - documents Soleil : notices CEGECLIM rattachées à la marque (NIV 2, en tête
--    de liste) ; fiches techniques et notices fabricant rattachées à
--    marque × équipement (NIV 3, séparées visuellement) → hotline_docs_soleil,
--    fichiers dans le bucket public « hotline-documents » (liens envoyables) ;
--  - ticket Soleil : onduleur et batterie (modèle, n° de série) au lieu de GE /
--    UI, sévérité obligatoire (non bloquant / bloquant / critique) au lieu du
--    rappel N1, reprise du traitement (date + action) avec tâche créée ;
--  - fonction hotline : environnement Thermie / Soleil de l'utilisateur
--    (user_page_access.hotline_filiere) ;
--  - Thermie : suppression des parcours existants (à recréer).
-- ============================================================================

-- ── Ticket Soleil ────────────────────────────────────────────────────────────
alter table public.hotline_tickets add column if not exists pv_marque text;
alter table public.hotline_tickets add column if not exists pv_equipement text;
alter table public.hotline_tickets add column if not exists onduleur_modele text;
alter table public.hotline_tickets add column if not exists onduleur_serie text;
alter table public.hotline_tickets add column if not exists batterie_modele text;
alter table public.hotline_tickets add column if not exists batterie_serie text;
alter table public.hotline_tickets add column if not exists severite text;
alter table public.hotline_tickets add column if not exists reprise_le date;
alter table public.hotline_tickets add column if not exists reprise_action text;
alter table public.hotline_tickets add column if not exists reprise_precision text;
alter table public.hotline_tickets add column if not exists reprise_par text;
alter table public.hotline_tickets add column if not exists reprise_todo_id uuid;

alter table public.hotline_tickets drop constraint if exists hotline_tickets_pv_marque_check;
alter table public.hotline_tickets add constraint hotline_tickets_pv_marque_check
  check (pv_marque is null or pv_marque in ('HOYMILES', 'SOLIS', 'AUTRE'));
alter table public.hotline_tickets drop constraint if exists hotline_tickets_severite_check;
alter table public.hotline_tickets add constraint hotline_tickets_severite_check
  check (severite is null or severite in ('NON_BLOQUANT', 'BLOQUANT', 'CRITIQUE'));
alter table public.hotline_tickets drop constraint if exists hotline_tickets_reprise_action_check;
alter table public.hotline_tickets add constraint hotline_tickets_reprise_action_check
  check (reprise_action is null or reprise_action in ('RAPPELER', 'MAIL', 'AUTRE'));

-- Étape de suivi « reprise du traitement ».
alter table public.hotline_ticket_etapes drop constraint if exists hotline_ticket_etapes_type_check;
alter table public.hotline_ticket_etapes add constraint hotline_ticket_etapes_type_check check (type in (
  'OUVERTURE', 'IDENTIFICATION', 'NOTE_RAPIDE', 'QUESTION', 'DOCUMENT', 'COMMENTAIRE', 'COMMENTAIRE_INTERNE',
  'ESCALADE', 'REDESCENTE', 'RAPPEL', 'REPRISE', 'PRECONISATION', 'RESOLUTION', 'CLOTURE', 'REOUVERTURE',
  'PIECE_JOINTE', 'DEMANDE_PIECE'));

-- ── Documents Soleil ─────────────────────────────────────────────────────────
create table if not exists public.hotline_docs_soleil (
  id uuid primary key default gen_random_uuid(),
  marque text not null check (marque in ('HOYMILES', 'SOLIS', 'AUTRE')),
  -- null = document de la marque (NIV 2) ; sinon équipement NIV 3
  equipement text,
  categorie text not null check (categorie in ('NOTICE_CEGECLIM', 'FICHE_TECHNIQUE', 'NOTICE_FABRICANT')),
  titre text not null,
  url text not null,
  chemin text,
  ordre int not null default 0,
  created_at timestamptz not null default now(),
  created_by text default public.current_user_email()
);
create index if not exists hotline_docs_soleil_marque_idx on public.hotline_docs_soleil(marque, equipement);

alter table public.hotline_docs_soleil enable row level security;
drop policy if exists hotline_docs_soleil_lecture on public.hotline_docs_soleil;
create policy hotline_docs_soleil_lecture on public.hotline_docs_soleil for select to authenticated using (public.hotline_peut_acceder());
drop policy if exists hotline_docs_soleil_ecriture on public.hotline_docs_soleil;
create policy hotline_docs_soleil_ecriture on public.hotline_docs_soleil for all to authenticated
  using (public.hotline_est_expert()) with check (public.hotline_est_expert());
grant select, insert, update, delete on public.hotline_docs_soleil to authenticated;

-- Bucket public : les liens sont envoyés aux clients par mail.
insert into storage.buckets (id, name, public)
values ('hotline-documents', 'hotline-documents', true)
on conflict (id) do update set public = true;

drop policy if exists hotline_documents_lecture on storage.objects;
create policy hotline_documents_lecture on storage.objects for select
  using (bucket_id = 'hotline-documents');
drop policy if exists hotline_documents_ajout on storage.objects;
create policy hotline_documents_ajout on storage.objects for insert to authenticated
  with check (bucket_id = 'hotline-documents' and public.hotline_est_expert());
drop policy if exists hotline_documents_suppression on storage.objects;
create policy hotline_documents_suppression on storage.objects for delete to authenticated
  using (bucket_id = 'hotline-documents' and public.hotline_est_expert());

-- ── Environnement hotline de l'utilisateur ───────────────────────────────────
alter table public.user_page_access add column if not exists hotline_filiere text;
alter table public.user_page_access drop constraint if exists user_page_access_hotline_filiere_check;
alter table public.user_page_access add constraint user_page_access_hotline_filiere_check
  check (hotline_filiere is null or hotline_filiere in ('PV', 'THERMIQUE'));

update public.user_page_access set hotline_filiere = 'THERMIQUE'
where email in ('hotlinethermie1@cegeclim-energies.com', 'hotlinethermie2@cegeclim-energies.com') and hotline_filiere is null;

-- Environnement de l'utilisateur connecté (lu par les écrans hotline).
create or replace function public.hotline_mon_environnement()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce((
    select jsonb_build_object('filiere', u.hotline_filiere, 'niveau', u.hotline_niveau)
    from public.user_page_access u where lower(u.email) = lower(public.current_user_email()) limit 1
  ), jsonb_build_object('filiere', null, 'niveau', null));
$$;
grant execute on function public.hotline_mon_environnement() to authenticated;

-- ── Thermie : suppression des parcours existants (13/11/2026) ─────────────────
-- Les tickets gardent leur historique (étapes) ; leur arbre_id passe à null.
delete from public.hotline_arbres where filiere = 'THERMIQUE';

-- Collaborateurs hotline : avec leur environnement (escalade vers un N2 du même environnement).
create or replace function public.hotline_collaborateurs(p_numero_tiers text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_cp text;
  v_dep text;
  v_res jsonb;
begin
  if not public.hotline_peut_acceder() then
    raise exception 'Accès hotline refusé (droit can_hotline).';
  end if;

  if nullif(btrim(coalesce(p_numero_tiers, '')), '') is not null then
    select code_postal into v_cp from public.ref_tiers where numero = btrim(p_numero_tiers) limit 1;
    v_dep := public.hotline_departement(v_cp);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'email', u.email,
           'nom', coalesce(nullif(btrim(u.display_name), ''), split_part(u.email, '@', 1)),
           'niveau', u.hotline_niveau,
           'filiere', u.hotline_filiere,
           'departements', to_jsonb(coalesce(u.hotline_departements, '{}')),
           'par_defaut', v_dep is not null and u.hotline_niveau = 2 and (
               v_dep = any(u.hotline_departements)
               or (v_dep = '20' and (u.hotline_departements && array['2A', '2B'])))
         ) order by u.hotline_niveau, coalesce(nullif(btrim(u.display_name), ''), u.email)), '[]'::jsonb)
  into v_res
  from public.user_page_access u
  where u.hotline_niveau is not null
    and (coalesce(u.can_hotline, false) or coalesce(u.can_hotline_expert, false) or coalesce(u.can_autorisation, false));

  return jsonb_build_object('departement', v_dep, 'code_postal', v_cp, 'collaborateurs', v_res);
end
$$;
