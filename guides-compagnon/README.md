# Guide utilisateur « Mon Compagnon »

Un dossier par pavé de la page d'accueil (id du pavé dans `lib/navigation.ts`).
Chaque chapitre est un fichier HTML autonome (`CHAPITRE-xxx.html`, captures intégrées),
au format des guides BLG : une `section.intro` par mode opératoire, une `section.step`
par étape (`data-m` = id du mode opératoire).

Publication : à l'ouverture de **/guides-compagnon** par un administrateur, les fichiers
nouveaux ou modifiés de ce dossier sont publiés automatiquement (images extraites dans le
bucket privé `guides-blg`, sous `compagnon/`) ; un fichier supprimé ici est retiré du guide.
Migration : `supabase/migrations/20261115a_guides_compagnon.sql`.

| Dossier | Pavé |
|---|---|
| `activite/` | Mon activité |
| `clients/` | Mes clients |
| `agences-commerciaux/` | Mes agences / Mes commerciaux |
| `territoire/` | Territoire |
| `taches/` | Mes tâches / Mes RDV |
| `logistique/` | Stocks & logistique |
| `financement/` | Financement |
| `hotline/` | Hotline technique |
| `blg/` | Projet BLG |
| `admin/` | Admin |
