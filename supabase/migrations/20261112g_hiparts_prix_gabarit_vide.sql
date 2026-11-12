-- ============================================================================
-- 20261112g_hiparts_prix_gabarit_vide.sql — Prix Hi-Parts non remontés (12/11/2026)
-- À partir de 12:34 UTC, la session Hi-Parts du copieur a été perdue : la page
-- de prix renvoyait son gabarit vide « [LabelPUHT.Text]… », enregistré tel quel
-- (≈ 10 000 références sans prix, désignation « [LabelTitle.Text] »).
-- Correctif côté code (lib/server/hiparts.ts : estGabaritVide → reconnexion,
-- sinon échec et nouvel essai). Ici : on efface ces lignes et on remet leurs
-- prix dans la file, en priorité 4 (avec les vues éclatées).
-- ============================================================================
update public.hiparts_file f
set statut = 'A_FAIRE', priorite = 4, essais = 0, erreur = null, verrou_jusqua = null
where f.type = 'PRIX'
  and f.cle in (
    select reference from public.hiparts_articles
    where designation like '[Label%' or ref_remplacement like '%[Label%'
  );

delete from public.hiparts_articles
where designation like '[Label%' or ref_remplacement like '%[Label%';
