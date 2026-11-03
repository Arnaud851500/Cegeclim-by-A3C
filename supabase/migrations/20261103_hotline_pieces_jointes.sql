-- ============================================================================
-- 20261103_hotline_pieces_jointes.sql — Hotline : pièces jointes des tickets
-- (03/11/2026, demande d'Arnaud : attacher des mails et des photos à un ticket
-- depuis sa boîte de réception ou son PC)
-- ----------------------------------------------------------------------------
-- - Bucket privé « hotline-pieces » (25 Mo par fichier), chemin
--   <ticket_id>/<horodatage>-<nom>. Lecture / dépôt réservés aux droits
--   hotline ; suppression : auteur du dépôt ou expert hotline.
-- - Table hotline_ticket_pieces : fichier, origine (PC, MAIL glissé depuis la
--   messagerie, PRESSE_PAPIER pour une capture collée), et pour un mail
--   (.eml / .msg) son objet, son expéditeur et sa date quand ils sont lisibles.
-- - Nouveau type d'étape PIECE_JOINTE dans la chronologie du ticket.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('hotline-pieces', 'hotline-pieces', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create table if not exists public.hotline_ticket_pieces (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.hotline_tickets(id) on delete cascade,
  chemin      text not null unique,
  nom         text not null,
  type_mime   text,
  taille      bigint,
  origine     text not null default 'PC' check (origine in ('PC', 'MAIL', 'PRESSE_PAPIER')),
  mail_objet  text,
  mail_de     text,
  mail_date   timestamptz,
  ajoute_par  text not null default public.current_user_email(),
  ajoute_le   timestamptz not null default now()
);
create index if not exists hotline_ticket_pieces_ticket_idx on public.hotline_ticket_pieces(ticket_id, ajoute_le);

alter table public.hotline_ticket_pieces enable row level security;
drop policy if exists hotline_pieces_lecture on public.hotline_ticket_pieces;
create policy hotline_pieces_lecture on public.hotline_ticket_pieces for select to authenticated using (public.hotline_peut_acceder());
drop policy if exists hotline_pieces_ajout on public.hotline_ticket_pieces;
create policy hotline_pieces_ajout on public.hotline_ticket_pieces for insert to authenticated with check (public.hotline_peut_acceder());
drop policy if exists hotline_pieces_suppression on public.hotline_ticket_pieces;
create policy hotline_pieces_suppression on public.hotline_ticket_pieces for delete to authenticated
  using (public.hotline_peut_acceder() and (ajoute_par = public.current_user_email() or public.hotline_est_expert()));
grant select, insert, delete on public.hotline_ticket_pieces to authenticated;

-- Fichiers du bucket
drop policy if exists hotline_pieces_objets_lecture on storage.objects;
create policy hotline_pieces_objets_lecture on storage.objects for select to authenticated
  using (bucket_id = 'hotline-pieces' and public.hotline_peut_acceder());
drop policy if exists hotline_pieces_objets_ajout on storage.objects;
create policy hotline_pieces_objets_ajout on storage.objects for insert to authenticated
  with check (bucket_id = 'hotline-pieces' and public.hotline_peut_acceder());
drop policy if exists hotline_pieces_objets_suppression on storage.objects;
create policy hotline_pieces_objets_suppression on storage.objects for delete to authenticated
  using (bucket_id = 'hotline-pieces' and public.hotline_peut_acceder()
         and (owner_id = auth.uid()::text or public.hotline_est_expert()));

-- Nouveau type d'étape
alter table public.hotline_ticket_etapes drop constraint if exists hotline_ticket_etapes_type_check;
alter table public.hotline_ticket_etapes add constraint hotline_ticket_etapes_type_check
  check (type in ('OUVERTURE', 'IDENTIFICATION', 'QUESTION', 'DOCUMENT', 'COMMENTAIRE', 'ESCALADE',
                  'PRECONISATION', 'RESOLUTION', 'CLOTURE', 'REOUVERTURE', 'PIECE_JOINTE'));
