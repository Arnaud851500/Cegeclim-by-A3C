-- 20261103h_guides_blg_icone.sql — icône du pavé de chaque chapitre (vide = icône automatique)
alter table public.guides_blg add column if not exists icone text;
