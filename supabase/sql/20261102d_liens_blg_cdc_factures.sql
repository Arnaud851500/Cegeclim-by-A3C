-- 02/11/2026 — Liens BLG faux sur les commandes clients et les factures clients (« Page non trouvée »).
-- Adresses vérifiées dans BLG (production, dakar-11) le 02/11/2026 :
--   commande client (sale_quote type sale)  : ?app/sale/quote/edit/<document_id>#   (et non sale/order/edit)
--   facture client                           : ?app/invoice/edit/<document_id>#        (et non invoice/invoice/edit)
--   inchangés, déjà bons : purchase/order/edit (CDF), logistics/order/edit (BL), invoice/edit (factures
--   fournisseurs), article/part, crm/company.
-- Corrige les fonctions et vues qui fabriquent ces liens, puis les liens déjà stockés
-- (rappro_ecarts, portefeuille_blg_sage_cache) ; mv_cdc_comparaison est rafraîchie ensuite.
do $fix$
declare
  r record;
  d text;
  opts text;
begin
  -- Fonctions
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
             and (pg_get_functiondef(p.oid) like '%?app/sale/order/edit/%' or pg_get_functiondef(p.oid) like '%?app/invoice/invoice/edit/%')
  loop
    d := pg_get_functiondef(r.oid);
    d := replace(replace(d, '?app/sale/order/edit/', '?app/sale/quote/edit/'), '?app/invoice/invoice/edit/', '?app/invoice/edit/');
    execute d;
  end loop;

  -- Vues (options conservées, ex. security_invoker)
  for r in select c.oid, n.nspname, c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'v'
             and (pg_get_viewdef(c.oid) like '%?app/sale/order/edit/%' or pg_get_viewdef(c.oid) like '%?app/invoice/invoice/edit/%')
  loop
    d := pg_get_viewdef(r.oid);
    d := replace(replace(d, '?app/sale/order/edit/', '?app/sale/quote/edit/'), '?app/invoice/invoice/edit/', '?app/invoice/edit/');
    opts := case when r.reloptions is null then '' else ' with (' || array_to_string(r.reloptions, ', ') || ')' end;
    execute format('create or replace view %I.%I%s as %s', r.nspname, r.relname, opts, d);
  end loop;

  -- Liens déjà stockés
  update public.rappro_ecarts
     set lien_blg = replace(replace(lien_blg, '?app/sale/order/edit/', '?app/sale/quote/edit/'), '?app/invoice/invoice/edit/', '?app/invoice/edit/')
   where lien_blg like '%?app/sale/order/edit/%' or lien_blg like '%?app/invoice/invoice/edit/%';
  update public.portefeuille_blg_sage_cache
     set lien_blg = replace(replace(lien_blg, '?app/sale/order/edit/', '?app/sale/quote/edit/'), '?app/invoice/invoice/edit/', '?app/invoice/edit/')
   where lien_blg like '%?app/sale/order/edit/%' or lien_blg like '%?app/invoice/invoice/edit/%';
end $fix$;
