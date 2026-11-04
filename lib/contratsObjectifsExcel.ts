// ============================================================================
// lib/contratsObjectifsExcel.ts — Classeur normé des contrats d'objectifs
// ----------------------------------------------------------------------------
// Créé le 04/11/2026 (demandé par Arnaud). Utilisé par app/objectifs/contrats.
//
// Un seul format Excel sert à trois usages :
//   1. export des contrats d'une année avec leur situation à date
//      (un onglet par commercial + onglet Synthèse) ;
//   2. travail des avenants par la direction : on modifie le classeur exporté
//      (zones blanches) puis on le réimporte — les primes gardent leur
//      identifiant, donc leurs évaluations sont conservées ;
//   3. préparation de l'année suivante (copie N+1) : même format, année N+1,
//      statut brouillon, marge N-1 estimée, primes sans évaluation.
//
// Règles du format (version 1) :
//   - chaque onglet commercial porte en A2 la marque « Format CEGECLIM … v1 » :
//     c'est elle qui fait basculer l'import en lecture normée (sinon lecture
//     libre historique de lib/contratsObjectifs.ts) ;
//   - bloc « Paramètres du contrat » : libellés en colonne A, valeurs en B ;
//     les lignes sont retrouvées par leur libellé, pas par leur numéro ;
//   - tableau « Primes annuelles » : colonnes retrouvées par leur en-tête ;
//     listes déroulantes alimentées par l'onglet Listes ;
//   - blocs gris « Situation au … » : informatifs, jamais importés (seuls
//     les CA / marges mensuels servent au contrôle Excel ↔ compagnon).
// ============================================================================

import {
  INDICATEUR_LIBELLES,
  MOIS,
  SECTION_LIBELLES,
  TRANCHES,
  TRIMESTRES,
  avanceTheorique,
  caObjectif,
  calculerContrat,
  etatPrime,
  norm,
  parseNombreFr,
  type FicheContrat,
  type Indicateur,
  type OngletLu,
  type Prime,
  type Section,
  type Tranche,
} from '@/lib/contratsObjectifs'

export const FORMAT_MARQUE = 'Format CEGECLIM – contrat d’objectifs v1'
const FORMAT_RE = /^format cegeclim .*contrat d.objectifs v(\d+)/

// ---------------------------------------------------------------------------
// Libellés courts des listes déroulantes (lecture tolérante : accents, casse)
// ---------------------------------------------------------------------------
const SECTIONS: Section[] = ['ca_perso', 'ca_agence', 'qualitatif', 'familles', 'transfo', 'clients', 'avenant', 'avril_n1']
const INDICATEURS: Indicateur[] = ['ca_perso', 'ca_agence', 'zero_impaye_45j', 'cerfa_complet', 'manuel', 'evol_familles', 'evol_transfo', 'nb_clients']
export const INDICATEUR_COURT: Record<Indicateur, string> = {
  ca_perso: 'CA HT perso (auto)',
  ca_agence: 'CA HT agence (auto)',
  zero_impaye_45j: 'Zéro impayé > 45 j (auto)',
  cerfa_complet: 'Cerfa complet (direction)',
  manuel: 'Évaluée par la direction',
  evol_familles: 'Évolution CA familles vs N-1 (auto)',
  evol_transfo: 'Évolution taux de transfo vs N-1 (auto)',
  nb_clients: 'Nb clients par tranche de CA (auto)',
}
const MODES = { forfait: 'Forfait', paliers: 'Paliers' } as const
const ECHEANCES = { '31/12': 'Au 31/12', avril_n1: 'Avril N+1' } as const
const BASES = { perso: 'CA perso', agence: 'CA agence' } as const
const STATUTS = { brouillon: 'Brouillon', valide: 'Validé', signe: 'Signé' } as const
const TRANCHES_L: Tranche[] = ['t400', 't200', 't100', 't50', 't20']
const NB_PALIERS = 5

function inverse<K extends string>(m: Record<K, string>, extra: Record<string, K> = {}) {
  const r = new Map<string, K>()
  for (const [k, v] of Object.entries(m) as Array<[K, string]>) {
    r.set(norm(v), k)
    r.set(norm(k), k)
  }
  for (const [k, v] of Object.entries(extra)) r.set(norm(k), v)
  return (s: string | null | undefined): K | null => (s ? r.get(norm(s)) ?? null : null)
}
const lireSection = inverse(SECTION_LIBELLES)
const lireIndicateur = inverse({ ...INDICATEUR_COURT } as Record<Indicateur, string>, Object.fromEntries(INDICATEURS.map((i) => [INDICATEUR_LIBELLES[i], i])))
const lireMode = inverse(MODES as Record<'forfait' | 'paliers', string>)
const lireEcheance = inverse(ECHEANCES as Record<'31/12' | 'avril_n1', string>, { '31/12': '31/12', 'avril n+1': 'avril_n1', avril: 'avril_n1' })
const lireBase = inverse(BASES as Record<'perso' | 'agence', string>)
const lireStatut = inverse(STATUTS as Record<'brouillon' | 'valide' | 'signe', string>, { valide: 'valide', signe: 'signe' })
const lireTranche = inverse(TRANCHES)

// ---------------------------------------------------------------------------
// Mise en forme
// ---------------------------------------------------------------------------
const C = {
  marine: 'FF0B1220',
  creme: 'FFF5F3EC',
  ocre: 'FFB4761A',
  saisie: 'FFFFFFFF',
  info: 'FFEDEBE6',
  infoTexte: 'FF5B6470',
  vert: 'FF2F7A4A',
  rouge: 'FFC1683C',
  orange: 'FFB4761A',
  bordure: 'FFD5D1C7',
}
const EUR = '#,##0 €;-#,##0 €;"—"'
const EUR2 = '#,##0.00 €;-#,##0.00 €;"—"'
const PCT = '0.0%'
const PCT2 = '0.00%'

/* eslint-disable @typescript-eslint/no-explicit-any */
type WS = any
type WB = any

function remplir(cell: any, argb: string) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}
function bordure(cell: any) {
  const s = { style: 'thin', color: { argb: C.bordure } }
  cell.border = { top: s, bottom: s, left: s, right: s }
}
function entete(cell: any, fond = C.marine) {
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
  remplir(cell, fond)
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  bordure(cell)
}
function titreBloc(ws: WS, r: number, texte: string, sous?: string) {
  const c = ws.getCell(r, 1)
  c.value = texte
  c.font = { bold: true, size: 12, color: { argb: C.marine } }
  if (sous) {
    const s = ws.getCell(r, 3)
    s.value = sous
    s.font = { italic: true, size: 9, color: { argb: C.infoTexte } }
  }
}
function nomOnglet(nom: string, code: string, pris: Set<string>) {
  const base = (nom || code).replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || code
  let n = base
  let i = 2
  while (pris.has(n.toLowerCase())) n = `${base.slice(0, 26)} ${i++}`
  pris.add(n.toLowerCase())
  return n
}
const plage = (feuille: string, col: string, n: number) => `'${feuille}'!$${col}$2:$${col}$${n + 1}`

// ---------------------------------------------------------------------------
// Onglet Listes (valeurs des listes déroulantes)
// ---------------------------------------------------------------------------
type Listes = { section: string; indicateur: string; mode: string; echeance: string; base: string; statut: string; tranche: string; perimetre: string }

const LISTES: Array<[string, string[]]> = [
  ['Type de prime', SECTIONS.map((s) => SECTION_LIBELLES[s])],
  ['Indicateur', INDICATEURS.map((i) => INDICATEUR_COURT[i])],
  ['Calcul', Object.values(MODES)],
  ['Versement', Object.values(ECHEANCES)],
  ['Base CA', Object.values(BASES)],
  ['Statut', Object.values(STATUTS)],
  ['Tranche', TRANCHES_L.map((t) => TRANCHES[t])],
  ['Objectif porté sur', Object.values(BASES)],
]

function listesRef(): Listes {
  const ref = (i: number) => plage('Listes', 'ABCDEFGH'[i], LISTES[i][1].length)
  return { section: ref(0), indicateur: ref(1), mode: ref(2), echeance: ref(3), base: ref(4), statut: ref(5), tranche: ref(6), perimetre: ref(7) }
}

function ajouterListes(wb: WB) {
  const ws = wb.addWorksheet('Listes', { state: 'hidden' })
  LISTES.forEach(([t, vals], i) => {
    ws.getCell(1, i + 1).value = t
    vals.forEach((v, j) => (ws.getCell(j + 2, i + 1).value = v))
    ws.getColumn(i + 1).width = 44
  })
}

function liste(cell: any, formule: string) {
  cell.dataValidation = { type: 'list', allowBlank: true, formulae: [formule], showErrorMessage: true, errorTitle: 'Valeur hors liste', error: 'Choisir une valeur de la liste.' }
}

// ---------------------------------------------------------------------------
// Colonnes du tableau des primes
// ---------------------------------------------------------------------------
type ColPrime = { cle: string; titre: string; largeur: number; info?: boolean }
const COLS_PRIMES: ColPrime[] = [
  { cle: 'ordre', titre: 'N°', largeur: 5 },
  { cle: 'section', titre: 'Type de prime', largeur: 30 },
  { cle: 'libelle', titre: 'Libellé', largeur: 30 },
  { cle: 'description', titre: 'Définition / condition', largeur: 42 },
  { cle: 'mode', titre: 'Calcul', largeur: 10 },
  { cle: 'indicateur', titre: 'Indicateur', largeur: 28 },
  { cle: 'echeance', titre: 'Versement', largeur: 11 },
  { cle: 'montant', titre: 'Montant forfait (€)', largeur: 12 },
  ...Array.from({ length: NB_PALIERS }, (_, i) => [
    { cle: `seuil${i + 1}`, titre: `Palier ${i + 1} – seuil`, largeur: 12 },
    { cle: `prime${i + 1}`, titre: `Palier ${i + 1} – prime (€)`, largeur: 11 },
  ]).flat(),
  { cle: 'base_ca', titre: 'Base CA', largeur: 10 },
  { cle: 'cible', titre: 'Cible (évol. % ou pts)', largeur: 11 },
  { cle: 'familles_macro', titre: 'Macro-familles (séparées par ;)', largeur: 26 },
  { cle: 'familles', titre: 'Familles (séparées par ;)', largeur: 26 },
  { cle: 'tranche', titre: 'Tranche clients', largeur: 18 },
  { cle: 'cible_nb', titre: 'Nb clients visé', largeur: 9 },
  { cle: 'id', titre: 'Identifiant (ne pas modifier)', largeur: 12 },
  { cle: 'sit_max', titre: 'Prime max (€)', largeur: 11, info: true },
  { cle: 'sit_date', titre: 'Acquise à date (€)', largeur: 11, info: true },
  { cle: 'sit_proj', titre: 'Projetée fin d’année (€)', largeur: 11, info: true },
  { cle: 'sit_eval', titre: 'Évaluation direction', largeur: 13, info: true },
  { cle: 'sit_retenu', titre: 'Montant retenu (€)', largeur: 11, info: true },
  { cle: 'sit_texte', titre: 'Situation / commentaire', largeur: 60, info: true },
]
const NB_LIGNES_PRIMES = 20 // lignes prêtes à saisir (listes déroulantes)

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
export type ModeExport = 'situation' | 'preparation'

export type OptionsExport = {
  /** situation = contrats de l'année avec situation à date ; preparation = copie N+1 */
  mode: ModeExport
  annee: number
  familles?: Array<{ macro: string; familles: string[] }>
}

function valeurCible(p: Prime) {
  if (p.indicateur === 'nb_clients') return null
  return p.cible_evol ?? null
}

function formatSeuil(p: Prime) {
  if (p.indicateur === 'evol_familles') return PCT
  if (p.indicateur === 'evol_transfo') return '0.0 "pts"'
  return EUR
}

function ecrireOnglet(ws: WS, f: FicheContrat, opt: OptionsExport, L: Listes) {
  const prep = opt.mode === 'preparation'
  const anneeCible = prep ? f.annee + 1 : f.annee
  const c = f.contrat
  const calc = calculerContrat(f)
  const obj = caObjectif(f, calc)
  const dateJour = new Date().toLocaleDateString('fr-FR')
  const moisClos = MOIS[f.mois_clos]?.toLowerCase() || '—'

  ws.properties.defaultRowHeight = 16
  ws.views = [{ showGridLines: false }]
  ws.getColumn(1).width = 34
  ws.getColumn(2).width = 22
  ws.getColumn(3).width = 30

  // En-tête
  ws.mergeCells(1, 1, 1, 8)
  const t = ws.getCell(1, 1)
  t.value = `Contrat d’objectifs ${anneeCible} — ${f.nom}`
  t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } }
  remplir(t, C.marine)
  t.alignment = { vertical: 'middle', indent: 1 }
  ws.getRow(1).height = 26
  const m = ws.getCell(2, 1)
  m.value = FORMAT_MARQUE
  m.font = { size: 8, color: { argb: C.infoTexte } }
  const l2 = ws.getCell(2, 3)
  l2.value = prep
    ? `Copie de préparation ${anneeCible} établie le ${dateJour} à partir du contrat ${f.annee}. Zones blanches = à travailler ; zones grises = informatif.`
    : `Export du ${dateJour} — réalisé à fin ${moisClos} ${f.annee}. Zones blanches = modifiables puis réimportables ; zones grises = informatif.`
  l2.font = { italic: true, size: 9, color: { argb: C.infoTexte } }

  // Paramètres
  let r = 4
  titreBloc(ws, r, 'PARAMÈTRES DU CONTRAT', 'Colonne B : valeur · colonne C : aide')
  r++
  const margeEstimee = prep ? (calc.part > 0 ? Math.round(calc.margeTotal / calc.part) : Math.round(calc.margeTotal)) : null
  const tauxBase = c?.taux_base ?? 0.08
  const tauxCom = c?.taux_commission ?? 0.01
  type Param = { lib: string; val: unknown; fmt?: string; aide?: string; saisie?: boolean; liste?: string; formule?: string }
  const params: Param[] = [
    { lib: 'Année', val: anneeCible, aide: 'Année du contrat (ne pas modifier)' },
    { lib: 'Code collaborateur', val: f.code, aide: 'Code SAGE du collaborateur (clé d’import)' },
    { lib: 'Nom', val: f.nom, aide: 'Information' },
    { lib: 'Agence', val: f.agence || '', aide: 'Information' },
    { lib: 'Objectif CA HT (€)', val: c?.objectif_caht ?? null, fmt: EUR, saisie: true, aide: prep ? `Objectif ${f.annee} repris : à revoir` : undefined },
    { lib: 'Objectif porté sur', val: BASES[c?.perimetre_objectif === 'agence' ? 'agence' : 'perso'], saisie: true, liste: L.perimetre, aide: 'CA perso ou CA de l’agence' },
    {
      lib: `Marge N-1 (€)`,
      val: prep ? margeEstimee : c?.marge_n1 ?? null,
      fmt: EUR,
      saisie: true,
      aide: prep ? `Estimation : marge ${f.annee} à fin ${moisClos} (${Math.round(calc.margeTotal).toLocaleString('fr-FR')} €) projetée sur l’année — à remplacer par la marge réelle ${f.annee}` : `Marge ${f.annee - 1} servant au calcul de l’avance`,
    },
    { lib: 'Taux de base avance', val: tauxBase, fmt: PCT, saisie: true, aide: '8 % par défaut' },
    { lib: 'Taux de commission', val: tauxCom, fmt: PCT2, saisie: true, aide: '1 % par défaut' },
    { lib: 'Avance mensuelle calculée (€)', val: null, fmt: EUR, aide: 'Marge N-1 × taux de base × taux de commission (calcul)' },
    { lib: 'Avance mensuelle saisie (€)', val: prep ? null : c?.avance_mensuelle_saisie ?? null, fmt: EUR, saisie: true, aide: 'Vide = avance calculée' },
    { lib: 'Date de fin de contrat', val: !prep && c?.date_fin ? new Date(c.date_fin) : null, fmt: 'dd/mm/yyyy', saisie: true, aide: 'Arrête le calcul et les avances au mois de cette date' },
    { lib: 'Statut', val: STATUTS[prep ? 'brouillon' : c?.statut || 'valide'], saisie: true, liste: L.statut },
    { lib: 'Commentaire / avenant', val: prep ? `Préparé à partir du contrat ${f.annee}` : c?.commentaire || '', saisie: true, aide: 'Ex. « Avenant n°1 du 15/03 : … »' },
  ]
  const ligne: Record<string, number> = {}
  for (const p of params) {
    ligne[p.lib] = r
    const a = ws.getCell(r, 1)
    a.value = p.lib
    a.font = { bold: true, size: 10 }
    bordure(a)
    remplir(a, C.creme)
    const b = ws.getCell(r, 2)
    b.value = p.val as any
    if (p.fmt) b.numFmt = p.fmt
    b.font = { size: 10, bold: p.saisie }
    remplir(b, p.saisie ? C.saisie : C.info)
    bordure(b)
    if (p.liste) liste(b, p.liste)
    if (p.aide) {
      const h = ws.getCell(r, 3)
      h.value = p.aide
      h.font = { italic: true, size: 9, color: { argb: C.infoTexte } }
    }
    r++
  }
  // Avance calculée en formule (suit les modifications de la direction)
  const rM = ligne['Marge N-1 (€)']
  const rB = ligne['Taux de base avance']
  const rT = ligne['Taux de commission']
  ws.getCell(ligne['Avance mensuelle calculée (€)'], 2).value = {
    formula: `ROUND(B${rM}*B${rB}*B${rT},0)`,
    result: avanceTheorique(prep ? margeEstimee : c?.marge_n1, tauxBase, tauxCom),
  }
  ws.getCell(ligne['Commentaire / avenant'], 2).alignment = { wrapText: true, vertical: 'top' }
  ws.mergeCells(ligne['Commentaire / avenant'], 2, ligne['Commentaire / avenant'], 8)
  ws.getRow(ligne['Commentaire / avenant']).height = 30

  // Primes
  r += 1
  titreBloc(ws, r, 'PRIMES ANNUELLES', 'Une ligne par prime · listes déroulantes · ajouter des lignes en dessous si besoin')
  r++
  const rHead = r
  COLS_PRIMES.forEach((col, i) => {
    const cell = ws.getCell(rHead, i + 1)
    cell.value = col.info ? `${col.titre}` : col.titre
    entete(cell, col.info ? 'FF6B7480' : C.marine)
    if (i >= 3) ws.getColumn(i + 1).width = Math.max(ws.getColumn(i + 1).width || 0, col.largeur)
  })
  ws.getRow(rHead).height = 42
  if (!prep) {
    const ci = COLS_PRIMES.findIndex((x) => x.info) + 1
    const s = ws.getCell(rHead - 1, ci)
    s.value = `Situation à fin ${moisClos} ${f.annee} — informatif, non importé`
    s.font = { italic: true, size: 9, color: { argb: C.infoTexte } }
  }
  const idx = (cle: string) => COLS_PRIMES.findIndex((x) => x.cle === cle) + 1
  const primes = f.primes || []
  const nbLignes = Math.max(NB_LIGNES_PRIMES, primes.length + 5)
  for (let k = 0; k < nbLignes; k++) {
    const rr = rHead + 1 + k
    const p = primes[k]
    const ep = p && !prep ? etatPrime(p, f, calc) : null
    const val: Record<string, unknown> = {}
    if (p) {
      val.ordre = k + 1
      val.section = SECTION_LIBELLES[p.section]
      val.libelle = p.libelle
      val.description = p.description || ''
      val.mode = MODES[p.mode]
      val.indicateur = INDICATEUR_COURT[p.indicateur]
      val.echeance = ECHEANCES[p.echeance] || ECHEANCES.avril_n1
      val.montant = p.mode === 'forfait' ? Number(p.montant || 0) : null
      ;(p.paliers || []).slice(0, NB_PALIERS).forEach((x, i) => {
        val[`seuil${i + 1}`] = Number(x.seuil)
        val[`prime${i + 1}`] = Number(x.montant)
      })
      val.base_ca = ['evol_familles', 'evol_transfo', 'nb_clients'].includes(p.indicateur) ? BASES[p.base_ca === 'agence' ? 'agence' : 'perso'] : null
      val.cible = valeurCible(p)
      val.familles_macro = (p.familles_macro || []).join(' ; ')
      val.familles = (p.familles || []).join(' ; ')
      val.tranche = p.tranche ? TRANCHES[p.tranche] : null
      val.cible_nb = p.cible_nb ?? null
      val.id = prep ? null : p.id || null
      if (ep) {
        val.sit_max = ep.montantMax
        val.sit_date = ep.montantADate
        val.sit_proj = ep.montantProjete
        val.sit_eval = p.resultat ? { a_evaluer: 'À évaluer', atteint: 'Atteint', partiel: 'Partiel', non_atteint: 'Non atteint' }[p.resultat] : 'À évaluer'
        val.sit_retenu = p.montant_retenu ?? null
        val.sit_texte = [ep.texte, p.commentaire_evaluation].filter(Boolean).join(' · ')
      }
    }
    COLS_PRIMES.forEach((col, i) => {
      const cell = ws.getCell(rr, i + 1)
      const v = val[col.cle]
      cell.value = (v === '' ? null : v) as any
      cell.font = { size: 10 }
      cell.alignment = { vertical: 'top', wrapText: ['libelle', 'description', 'sit_texte', 'section', 'indicateur', 'familles', 'familles_macro'].includes(col.cle) }
      remplir(cell, col.info || col.cle === 'id' ? C.info : C.saisie)
      bordure(cell)
      if (col.cle === 'montant' || col.cle.startsWith('prime') || col.cle.startsWith('sit_') && col.cle !== 'sit_eval' && col.cle !== 'sit_texte') cell.numFmt = EUR
      if (col.cle.startsWith('seuil') && p) cell.numFmt = formatSeuil(p)
      if (col.cle === 'cible' && p) cell.numFmt = p.indicateur === 'evol_transfo' ? '0.0 "pts"' : PCT
      if (col.cle === 'id') cell.font = { size: 8, color: { argb: C.infoTexte } }
    })
    liste(ws.getCell(rr, idx('section')), L.section)
    liste(ws.getCell(rr, idx('mode')), L.mode)
    liste(ws.getCell(rr, idx('indicateur')), L.indicateur)
    liste(ws.getCell(rr, idx('echeance')), L.echeance)
    liste(ws.getCell(rr, idx('base_ca')), L.base)
    liste(ws.getCell(rr, idx('tranche')), L.tranche)
  }
  r = rHead + nbLignes + 2

  // Situation à date (informatif)
  if (!prep) {
    titreBloc(ws, r, `SITUATION À FIN ${moisClos.toUpperCase()} ${f.annee}`, 'Informatif — recalculé par le compagnon, non importé')
    r++
    const kpis: Array<[string, unknown, string]> = [
      [obj.agence ? `${obj.libelle} à date` : 'CA HT perso à date', obj.realise, EUR],
      ['Avancement / objectif', c?.objectif_caht ? obj.realise / c.objectif_caht : null, PCT],
      ['CA projeté fin d’année', obj.projection, EUR],
      ['Marge à date', calc.margeTotal, EUR],
      ['Taux de marge', calc.tauxMarge, PCT],
      ['Commission acquise', calc.commissionAcquise, EUR2],
      ['Avances à date', calc.avancesADate, EUR],
      ['Solde à date', calc.soldeADate, EUR2],
      ['Solde projeté au 31/12', calc.soldeProjete, EUR],
      ['Autres versements saisis', calc.autresVersements, EUR],
    ]
    for (const [lib, v, fmt] of kpis) {
      const a = ws.getCell(r, 1)
      a.value = lib
      a.font = { size: 10 }
      remplir(a, C.info)
      bordure(a)
      const b = ws.getCell(r, 2)
      b.value = v == null || (typeof v === 'number' && !Number.isFinite(v)) ? null : (v as number)
      b.numFmt = fmt
      remplir(b, C.info)
      bordure(b)
      r++
    }
    r++
    const hm = ['Mois', `CA ${f.annee}`, `Marge ${f.annee}`, `CA ${f.annee - 1}`, `Marge ${f.annee - 1}`, 'Avance', 'État', 'Commission']
    hm.forEach((h, i) => entete(ws.getCell(r, i + 1), 'FF6B7480'))
    hm.forEach((h, i) => (ws.getCell(r, i + 1).value = h))
    r++
    const parMois = new Map(f.mois.map((x) => [x.mois, x]))
    for (const tr of calc.trimestres) {
      for (const lm of tr.mois) {
        const x = parMois.get(lm.mois)
        const vals = [
          MOIS[lm.mois],
          lm.ca,
          lm.marge,
          x?.ca_n1 ?? null,
          x?.marge_n1 ?? null,
          lm.horsContrat ? null : lm.avance,
          lm.horsContrat ? 'hors contrat' : lm.clos ? 'clos' : lm.enCours ? 'en cours' : 'à venir',
          null,
        ]
        vals.forEach((v, i) => {
          const cell = ws.getCell(r, i + 1)
          cell.value = v as any
          if ((i >= 1 && i <= 5) || i === 7) cell.numFmt = EUR2
          remplir(cell, C.info)
          bordure(cell)
          cell.font = { size: 10 }
        })
        r++
      }
      const vals = [TRIMESTRES[tr.t - 1], tr.ca, tr.marge, null, null, tr.avances, tr.complet ? 'complet' : 'partiel', tr.commission]
      vals.forEach((v, i) => {
        const cell = ws.getCell(r, i + 1)
        cell.value = v as any
        if ((i >= 1 && i <= 5) || i === 7) cell.numFmt = EUR2
        remplir(cell, C.creme)
        bordure(cell)
        cell.font = { size: 10, bold: true }
      })
      r++
    }
  }

  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } }
  ws.views = [{ showGridLines: false, state: 'frozen', ySplit: 2 }]
}

function ecrireModeEmploi(wb: WB, opt: OptionsExport, n: number) {
  const ws = wb.addWorksheet('Mode d’emploi', { views: [{ showGridLines: false }] })
  ws.getColumn(1).width = 4
  ws.getColumn(2).width = 120
  const prep = opt.mode === 'preparation'
  const annee = prep ? opt.annee + 1 : opt.annee
  const lignes: Array<[string, 'titre' | 'texte' | 'section']> = [
    [prep ? `Préparation des contrats d’objectifs ${annee}` : `Contrats d’objectifs ${annee} — export du ${new Date().toLocaleDateString('fr-FR')}`, 'titre'],
    [`${n} contrat(s), un onglet par commercial. ${FORMAT_MARQUE}.`, 'texte'],
    ['Ce que l’on peut modifier', 'section'],
    ['• Les cellules blanches : paramètres du contrat (objectif, périmètre, marge N-1, taux, avance saisie, date de fin, statut, commentaire) et le tableau des primes.', 'texte'],
    ['• Les cellules grises sont informatives (calculées par le compagnon) : elles ne sont jamais importées.', 'texte'],
    ['• Ne pas modifier : la cellule A2 de chaque onglet (marque du format), l’année, le code collaborateur, la colonne « Identifiant » des primes.', 'texte'],
    ['Primes', 'section'],
    ['• Une ligne par prime. Ajouter une prime = remplir une ligne vide ; supprimer une prime = vider la ligne (toutes les colonnes blanches).', 'texte'],
    ['• Calcul « Forfait » : renseigner « Montant forfait ». Calcul « Paliers » : renseigner les couples seuil / prime (jusqu’à 5).', 'texte'],
    ['• Paliers CA : seuils en euros (ex. 2 600 000). Évolution CA familles : seuils et cible en % (ex. 20 %). Taux de transfo : seuils et cible en points (ex. 2).', 'texte'],
    ['• Nombre de clients : choisir la tranche, le nombre de clients visé et la base CA (perso / agence).', 'texte'],
    ['• Familles : noms exacts des macro-familles / familles du compagnon, séparés par « ; » (liste dans l’onglet Familles).', 'texte'],
    ['• Une prime qui garde son identifiant conserve son évaluation par la direction après réimport.', 'texte'],
    ['Réimport', 'section'],
    [`• Compagnon › Contrats d’objectifs › année ${annee} › « Importer le classeur » : chaque onglet est rattaché par son code collaborateur.`, 'texte'],
    ['• L’import remplace le contrat existant de l’année (avenant) ; les versements saisis sur la fiche ne sont pas touchés.', 'texte'],
    ['• Un onglet peut être copié dans un autre classeur : la marque en A2 suffit à le reconnaître.', 'texte'],
    ['• Nouveau commercial : copier un onglet existant (clic droit › Déplacer ou copier), changer code, nom et agence, vider la colonne « Identifiant ».', 'texte'],
  ]
  if (prep)
    lignes.splice(2, 0, [
      `Copie de préparation : objectifs et primes ${opt.annee} repris, statut Brouillon, marge N-1 = estimation de la marge ${opt.annee} (à remplacer par la marge réelle en janvier). Les contrats arrêtés avant le 31/12/${opt.annee} (date de fin) ne sont pas repris.`,
      'texte',
    ])
  let r = 2
  for (const [t, s] of lignes) {
    if (s === 'section') r++
    const c = ws.getCell(r, 2)
    c.value = t
    c.alignment = { wrapText: true, vertical: 'top' }
    c.font = s === 'titre' ? { bold: true, size: 16, color: { argb: C.marine } } : s === 'section' ? { bold: true, size: 11, color: { argb: C.ocre } } : { size: 10 }
    r++
  }
}

function ecrireSynthese(wb: WB, fiches: FicheContrat[], opt: OptionsExport, onglets: Map<string, string>) {
  const ws = wb.addWorksheet('Synthèse', { views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }] })
  const prep = opt.mode === 'preparation'
  const mc = fiches[0]?.mois_clos ?? 0
  ws.getCell(1, 1).value = prep ? `Synthèse — préparation ${opt.annee + 1}` : `Synthèse des contrats ${opt.annee} — réalisé à fin ${MOIS[mc]?.toLowerCase() || '—'}`
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: C.marine } }
  const cols = prep
    ? ['Collaborateur', 'Code', 'Agence', 'Objectif CA HT', 'Périmètre', 'Marge N-1 estimée', 'Avance mensuelle', 'Nb primes', 'Primes max (€)']
    : ['Collaborateur', 'Code', 'Agence', 'Objectif CA HT', 'Périmètre', 'CA à date', 'vs N-1', 'Avancement', 'Marge à date', 'Commission acquise', 'Avances versées', 'Solde', 'Primes à évaluer', 'Primes acquises à date', 'Primes projetées', 'Statut', 'Fin de contrat']
  cols.forEach((h, i) => {
    const c = ws.getCell(3, i + 1)
    c.value = h
    entete(c)
  })
  ws.getRow(3).height = 32
  let r = 4
  const tot: number[] = []
  for (const f of fiches) {
    const c = f.contrat
    const calc = calculerContrat(f)
    const obj = caObjectif(f, calc)
    const primes = f.primes || []
    const etats = primes.map((p) => etatPrime(p, f, calc))
    const max = etats.reduce((s, e) => s + e.montantMax, 0)
    let vals: Array<[unknown, string?]>
    if (prep) {
      const marge = calc.part > 0 ? Math.round(calc.margeTotal / calc.part) : Math.round(calc.margeTotal)
      vals = [
        [f.nom],
        [f.code],
        [f.agence || ''],
        [c?.objectif_caht ?? null, EUR],
        [BASES[c?.perimetre_objectif === 'agence' ? 'agence' : 'perso']],
        [marge, EUR],
        [avanceTheorique(marge, c?.taux_base ?? 0.08, c?.taux_commission ?? 0.01), EUR],
        [primes.length],
        [max, EUR],
      ]
    } else {
      const caN1 = obj.agence ? f.ca_agence_n1 ?? null : f.mois.filter((m) => m.mois <= calc.moisCalc).reduce((s, m) => s + (m.ca_n1 || 0), 0)
      vals = [
        [f.nom],
        [f.code],
        [f.agence || ''],
        [c?.objectif_caht ?? null, EUR],
        [BASES[c?.perimetre_objectif === 'agence' ? 'agence' : 'perso']],
        [obj.realise, EUR],
        [caN1 ? obj.realise / caN1 - 1 : null, '+0.0%;-0.0%'],
        [c?.objectif_caht ? obj.realise / c.objectif_caht : null, PCT],
        [calc.margeTotal, EUR],
        [calc.commissionAcquise, EUR],
        [calc.avancesADate, EUR],
        [calc.soldeADate, EUR],
        [primes.filter((p) => (!p.resultat || p.resultat === 'a_evaluer') && ['manuel', 'cerfa_complet'].includes(p.indicateur)).length],
        [etats.reduce((s, e) => s + e.montantADate, 0), EUR],
        [etats.reduce((s, e) => s + e.montantProjete, 0), EUR],
        [STATUTS[c?.statut || 'valide']],
        [c?.date_fin ? new Date(c.date_fin) : null, 'dd/mm/yyyy'],
      ]
    }
    vals.forEach(([v, fmt], i) => {
      const cell = ws.getCell(r, i + 1)
      cell.value = (v as any) ?? null
      if (fmt) cell.numFmt = fmt
      bordure(cell)
      cell.font = { size: 10 }
      if (typeof v === 'number' && fmt === EUR) tot[i] = (tot[i] || 0) + v
    })
    const nomO = onglets.get(f.code)
    if (nomO) ws.getCell(r, 1).value = { text: f.nom, hyperlink: `#'${nomO}'!A1` }
    ws.getCell(r, 1).font = { size: 10, color: { argb: 'FF1F5F99' }, underline: true }
    r++
  }
  cols.forEach((_, i) => {
    const cell = ws.getCell(r, i + 1)
    if (i === 0) cell.value = `Total (${fiches.length})`
    else if (tot[i] != null) {
      cell.value = tot[i]
      cell.numFmt = EUR
    }
    cell.font = { bold: true, size: 10 }
    remplir(cell, C.creme)
    bordure(cell)
  })
  if (!prep) {
    const io = cols.indexOf('Objectif CA HT') + 1
    const ic = cols.indexOf('CA à date') + 1
    const ia = cols.indexOf('Avancement') + 1
    const L = (n: number) => String.fromCharCode(64 + n)
    ws.getCell(r, ia).value = { formula: `IF(${L(io)}${r}=0,"",${L(ic)}${r}/${L(io)}${r})` }
    ws.getCell(r, ia).numFmt = PCT
  }
  const larg = prep ? [28, 12, 16, 15, 11, 15, 13, 9, 13] : [28, 12, 16, 15, 11, 14, 9, 11, 13, 13, 13, 12, 10, 13, 13, 10, 12]
  larg.forEach((w, i) => (ws.getColumn(i + 1).width = w))
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: r - 1, column: cols.length } }
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }
}

function ecrireFamilles(wb: WB, familles: Array<{ macro: string; familles: string[] }>) {
  const ws = wb.addWorksheet('Familles', { views: [{ showGridLines: false, state: 'frozen', ySplit: 1 }] })
  entete(ws.getCell(1, 1))
  entete(ws.getCell(1, 2))
  ws.getCell(1, 1).value = 'Macro-famille'
  ws.getCell(1, 2).value = 'Famille'
  ws.getColumn(1).width = 34
  ws.getColumn(2).width = 40
  let r = 2
  for (const m of familles) for (const f of m.familles.length ? m.familles : ['']) {
    ws.getCell(r, 1).value = m.macro
    ws.getCell(r, 2).value = f || null
    r++
  }
}

/** Construit le classeur normé (un onglet par contrat). */
export async function construireClasseur(fiches: FicheContrat[], opt: OptionsExport): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Compagnon CEGECLIM'
  wb.created = new Date()
  // Préparation N+1 : on ne reprend pas les contrats arrêtés avant le 31/12 de l'année
  const retenues =
    opt.mode === 'preparation'
      ? fiches.filter((f) => f.contrat && (!f.contrat.date_fin || f.contrat.date_fin.slice(0, 10) >= `${f.annee}-12-31`))
      : fiches.filter((f) => f.contrat)
  retenues.sort((a, b) => (a.agence || '').localeCompare(b.agence || '') || a.nom.localeCompare(b.nom))
  // Noms d'onglets calculés d'abord : la Synthèse (2e onglet) pointe vers eux
  const pris = new Set<string>(['mode d’emploi', 'synthèse', 'listes', 'familles'])
  const onglets = new Map<string, string>()
  for (const f of retenues) onglets.set(f.code, nomOnglet(f.nom, f.code, pris))
  ecrireModeEmploi(wb, opt, retenues.length)
  ecrireSynthese(wb, retenues, opt, onglets)
  const L = listesRef()
  for (const f of retenues) {
    const ws = wb.addWorksheet(onglets.get(f.code)!, { properties: { tabColor: { argb: f.contrat?.statut === 'brouillon' || opt.mode === 'preparation' ? 'FFB4761A' : 'FF2F7A4A' } } })
    ecrireOnglet(ws, f, opt, L)
  }
  if (opt.familles?.length) ecrireFamilles(wb, opt.familles)
  ajouterListes(wb)
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function telecharger(blob: Blob, nom: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nom
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ---------------------------------------------------------------------------
// Lecture d'un onglet normé
// ---------------------------------------------------------------------------
export type OngletNorme = OngletLu & {
  format: 'norme'
  annee: number | null
  code_lu: string | null
  nom_lu: string | null
  date_fin: string | null
  statut: 'brouillon' | 'valide' | 'signe'
  commentaire: string | null
  avance_saisie: number | null
}

function texte(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('result' in o) return texte(o.result)
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as Array<{ text: string }>).map((x) => x.text).join('').trim()
    if ('text' in o) return texte(o.text)
    if ('error' in o) return ''
  }
  return String(v).trim()
}
function nombre(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'object' && v && 'result' in (v as object)) return nombre((v as { result: unknown }).result)
  const t = texte(v)
  if (!t) return null
  const pct = /%\s*$/.test(t)
  const n = parseNombreFr(t.replace(/pts?$/i, '').replace(/%\s*$/, ''))
  return n == null ? null : pct ? n / 100 : n
}
function dateIso(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10)
  const t = texte(v)
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  return null
}

export function estOngletNorme(ws: WS) {
  return FORMAT_RE.test(norm(texte(ws.getCell(2, 1).value)).replace(/[–—-]/g, ' ').replace(/\s+/g, ' '))
}

export function lireOngletNorme(ws: WS): OngletNorme {
  const avert: string[] = []
  const maxR = ws.rowCount
  const maxC = Math.max(ws.columnCount, COLS_PRIMES.length)
  // Paramètres : libellé en A, valeur en B
  const params = new Map<string, unknown>()
  let rPrimes = 0
  let rMois = 0
  for (let r = 1; r <= maxR; r++) {
    const a = norm(texte(ws.getCell(r, 1).value))
    if (!a) continue
    if (!rPrimes && a === 'n°' && /type de prime/.test(norm(texte(ws.getCell(r, 2).value)))) rPrimes = r
    else if (!rMois && a === 'mois' && rPrimes) rMois = r
    else if (!rPrimes) params.set(a, ws.getCell(r, 2).value)
  }
  const P = (re: RegExp) => {
    for (const [k, v] of params) if (re.test(k)) return v
    return undefined
  }
  const annee = nombre(P(/^annee$/))
  const code = texte(P(/^code collaborateur/)).toUpperCase() || null
  const objectif = nombre(P(/^objectif ca ht/))
  const perimetre = lireBase(texte(P(/^objectif porte sur/))) || 'perso'
  const marge = nombre(P(/^marge n-1/))
  let tauxBase = nombre(P(/^taux de base/))
  let tauxCom = nombre(P(/^taux de commission/))
  if (tauxBase != null && tauxBase > 1) tauxBase /= 100
  if (tauxCom != null && tauxCom > 1) tauxCom /= 100
  const avanceSaisie = nombre(P(/^avance mensuelle saisie/))
  const avanceCalc = nombre(P(/^avance mensuelle calculee/))
  const dateFinBrute = P(/^date de fin/)
  const dateFin = dateIso(dateFinBrute)
  if (texte(dateFinBrute) && !dateFin) avert.push(`Date de fin illisible : « ${texte(dateFinBrute)} »`)
  const statut = lireStatut(texte(P(/^statut$/))) || 'valide'
  const commentaire = texte(P(/^commentaire/)) || null
  if (annee == null) avert.push('Année absente')
  if (!code) avert.push('Code collaborateur absent')
  if (objectif == null) avert.push('Objectif CA HT vide')
  if (marge == null) avert.push('Marge N-1 vide')

  // Primes : colonnes repérées par leur en-tête
  const primes: Prime[] = []
  if (!rPrimes) avert.push('Tableau des primes introuvable')
  else {
    const col = new Map<string, number>()
    for (let c = 1; c <= maxC; c++) {
      const h = norm(texte(ws.getCell(rPrimes, c).value))
      const d = COLS_PRIMES.find((x) => norm(x.titre) === h)
      if (d) col.set(d.cle, c)
    }
    const v = (r: number, cle: string) => (col.has(cle) ? ws.getCell(r, col.get(cle)!).value : null)
    const fin = rMois ? rMois - 1 : maxR
    for (let r = rPrimes + 1; r <= fin; r++) {
      const a = norm(texte(ws.getCell(r, 1).value))
      if (/^situation a fin/.test(a)) break
      const sectionT = texte(v(r, 'section'))
      const libelle = texte(v(r, 'libelle'))
      const indicT = texte(v(r, 'indicateur'))
      const description = texte(v(r, 'description'))
      const montantF = nombre(v(r, 'montant'))
      const paliers = Array.from({ length: NB_PALIERS }, (_, i) => ({ seuil: nombre(v(r, `seuil${i + 1}`)), montant: nombre(v(r, `prime${i + 1}`)) })).filter(
        (x) => x.seuil != null || x.montant != null,
      )
      if (!sectionT && !libelle && !indicT && !description && montantF == null && paliers.length === 0) continue
      const ref = `ligne ${r}${libelle ? ` (${libelle})` : ''}`
      const section = lireSection(sectionT)
      let indicateur = lireIndicateur(indicT)
      if (!section) avert.push(`Type de prime inconnu ${ref} : « ${sectionT || 'vide'} »`)
      if (!indicateur) {
        indicateur = section === 'ca_perso' ? 'ca_perso' : section === 'ca_agence' ? 'ca_agence' : section === 'familles' ? 'evol_familles' : section === 'transfo' ? 'evol_transfo' : section === 'clients' ? 'nb_clients' : 'manuel'
        if (indicT) avert.push(`Indicateur inconnu ${ref} : « ${indicT} » → ${INDICATEUR_COURT[indicateur]}`)
      }
      const mode = lireMode(texte(v(r, 'mode'))) || (paliers.length ? 'paliers' : 'forfait')
      if (mode === 'paliers' && paliers.some((x) => x.seuil == null || x.montant == null)) avert.push(`Palier incomplet ${ref}`)
      if (mode === 'paliers' && paliers.length === 0) avert.push(`Aucun palier ${ref}`)
      if (mode === 'forfait' && montantF == null) avert.push(`Montant forfait vide ${ref}`)
      let cible = nombre(v(r, 'cible'))
      const pal = paliers.filter((x) => x.seuil != null && x.montant != null).map((x) => ({ seuil: x.seuil!, montant: x.montant! }))
      if (indicateur === 'evol_familles') {
        if (cible != null && Math.abs(cible) > 1.5) cible /= 100
        pal.forEach((x) => Math.abs(x.seuil) > 1.5 && (x.seuil /= 100))
      }
      const splitL = (x: unknown) =>
        texte(x)
          .split(/\s*[;\n]\s*/)
          .map((s) => s.trim())
          .filter(Boolean)
      const tranche = lireTranche(texte(v(r, 'tranche')))
      if (indicateur === 'nb_clients' && !tranche) avert.push(`Tranche clients manquante ${ref}`)
      const id = texte(v(r, 'id'))
      primes.push({
        id: /^[0-9a-f-]{36}$/i.test(id) ? id : undefined,
        section: section || 'qualitatif',
        libelle: libelle || (section ? SECTION_LIBELLES[section] : 'Prime'),
        description: description || null,
        mode,
        indicateur,
        paliers: mode === 'paliers' ? pal.sort((a, b) => a.seuil - b.seuil) : [],
        montant: mode === 'forfait' ? montantF ?? 0 : 0,
        echeance: lireEcheance(texte(v(r, 'echeance'))) || 'avril_n1',
        base_ca: lireBase(texte(v(r, 'base_ca'))) || 'perso',
        cible_evol: indicateur === 'evol_familles' || indicateur === 'evol_transfo' ? cible : null,
        familles_macro: splitL(v(r, 'familles_macro')),
        familles: splitL(v(r, 'familles')),
        tranche: indicateur === 'nb_clients' ? tranche : null,
        cible_nb: indicateur === 'nb_clients' ? nombre(v(r, 'cible_nb')) : null,
      })
    }
  }
  primes.forEach((p, i) => (p.ordre = i + 1))
  if (rPrimes && primes.length === 0) avert.push('Aucune prime')

  // Réalisé mensuel (informatif, sert au contrôle Excel ↔ compagnon)
  const mois: OngletLu['mois'] = Array.from({ length: 12 }, (_, i) => ({ mois: i + 1, ca: null, marge: null }))
  if (rMois) {
    for (let r = rMois + 1; r <= Math.min(maxR, rMois + 20); r++) {
      const i = MOIS.findIndex((x, k) => k > 0 && norm(x) === norm(texte(ws.getCell(r, 1).value)))
      if (i > 0) {
        const etat = norm(texte(ws.getCell(r, 7).value))
        if (etat === 'clos') mois[i - 1] = { mois: i, ca: nombre(ws.getCell(r, 2).value), marge: nombre(ws.getCell(r, 3).value) }
      }
    }
  }

  return {
    format: 'norme',
    onglet: ws.name,
    annee: annee != null ? Math.round(annee) : null,
    code_lu: code,
    nom_lu: texte(P(/^nom$/)) || null,
    objectif_caht: objectif,
    perimetre_objectif: perimetre,
    marge_n1: marge,
    annee_marge_n1: annee != null ? Math.round(annee) - 1 : null,
    taux_base: tauxBase,
    taux_commission: tauxCom,
    avance_excel: avanceSaisie ?? avanceCalc,
    avance_saisie: avanceSaisie,
    date_fin: dateFin,
    statut,
    commentaire,
    mois,
    primes,
    avertissements: avert,
  }
}

export type OngletAuto = OngletLu & Partial<Omit<OngletNorme, 'format' | keyof OngletLu>> & { format: 'norme' | 'libre' }

/** Lit un classeur : onglets normés (marque en A2) en lecture stricte, autres onglets en lecture libre historique. */
export async function lireClasseurAuto(file: File, lireOngletLibre: (ws: WS) => OngletLu): Promise<OngletAuto[]> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const res: OngletAuto[] = []
  const nbNormes = wb.worksheets.filter((ws: WS) => estOngletNorme(ws)).length
  wb.eachSheet((ws: WS) => {
    if (ws.state === 'hidden' || ws.state === 'veryHidden') return
    if (estOngletNorme(ws)) return res.push(lireOngletNorme(ws))
    // Classeur normé : les onglets annexes (Mode d'emploi, Synthèse, Familles) sont ignorés
    if (nbNormes > 0) return
    const lu = lireOngletLibre(ws)
    if (lu.objectif_caht == null && lu.mois.every((m) => m.ca == null)) return
    res.push({ ...lu, format: 'libre' })
  })
  return res
}
/* eslint-enable @typescript-eslint/no-explicit-any */
