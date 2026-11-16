-- 16/11/2026 — Vues miroir BLG du schéma public en lecture seule
--
-- Constat : les vues public.* construites sur le schéma blg (182 vues, dont
-- 1 vue matérialisée) s'exécutent avec les droits de leur propriétaire
-- (postgres, security_invoker = off). Le rôle authenticated avait les droits
-- INSERT / UPDATE / DELETE / TRUNCATE dessus (grants par défaut de Supabase),
-- et 165 d'entre elles sont auto-modifiables : tout utilisateur connecté
-- pouvait donc modifier ou supprimer des données BLG via l'API REST, en
-- contournant le RLS du schéma blg (écriture réservée au rôle blg_sync).
--
-- Correctif : retrait de tous les droits d'écriture à anon et authenticated
-- sur ces vues, et de toute lecture à anon. La lecture par authenticated est
-- conservée (l'app lit BLG uniquement via ces vues ; le schéma blg n'a une
-- policy SELECT authenticated que sur une seule table).
-- Vérifié avant application : aucune écriture sur ces vues dans le code de
-- l'app ni dans les fonctions SQL ; la synchro BLG écrit directement dans
-- blg.* avec le rôle blg_sync.
--
-- Les default privileges du schéma public redonnent ALL à authenticated sur
-- toute nouvelle vue : relancer ce script après la création de nouvelles
-- vues miroir BLG (il est idempotent).

do $$
declare
  v record;
  n int := 0;
begin
  for v in
    select distinct c.oid::regclass as vue
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_rewrite r on r.ev_class = c.oid
    join pg_depend d on d.objid = r.oid
    join pg_class dc on dc.oid = d.refobjid
    join pg_namespace dn on dn.oid = dc.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('v', 'm')
      and dn.nspname = 'blg'
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on %s from anon, authenticated',
      v.vue);
    execute format('revoke select on %s from anon', v.vue);
    n := n + 1;
  end loop;
  raise notice 'Vues BLG passées en lecture seule : %', n;
end $$;
