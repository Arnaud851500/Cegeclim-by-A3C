-- Appliquée via MCP le 10/11/2026 (nom : 20261110c_vision_bis_preferences).
create table if not exists public.vision_tci_bis_preferences (
  user_email text primary key,
  widgets jsonb not null default '[]'::jsonb,
  reglages jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.vision_tci_bis_preferences enable row level security;
create policy vision_tci_bis_preferences_own_row on public.vision_tci_bis_preferences
  for all to authenticated
  using (user_email = current_user_email())
  with check (user_email = current_user_email());
grant select, insert, update on public.vision_tci_bis_preferences to authenticated;
