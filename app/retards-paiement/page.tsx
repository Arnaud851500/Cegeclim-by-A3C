'use client'

// app/retards-paiement/page.tsx
//
// Import (régulier) du fichier compta "Qui vous doit quoi"
// (ex. qui-vous-doit-quoi-20260903.xlsx) dans retards_paiement_clients, en
// attendant la connexion directe de la compta client à l'outil compagnon.
//
//   1. On dépose le .xlsx tel qu'exporté (aucune retouche nécessaire : la
//      ligne de totaux sans "Code" est ignorée, les colonnes sont
//      reconnues par leur libellé, accents/casse indifférents).
//   2. La date de situation est lue dans le nom du fichier (…-AAAAMMJJ.xlsx),
//      modifiable à la main. Ré-importer un fichier de la même date remplace
//      l'instantané précédent de cette date (idempotent) ; une nouvelle date
//      crée un nouvel instantané -- l'app n'affiche que le plus récent.
//   3. L'import est réservé aux administrateurs (user_page_access.can_autorisation),
//      contrôle fait côté base dans import_retards_paiement().
//
// Lecture du fichier : xlsx-js-style (déjà présent dans le projet, utilisé
// par l'export Excel de la Synthèse multi-clients), en import dynamique.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  TRANCHES_RETARD,
  fetchRetardsPaiementSynthese,
  formatDateFrRetard,
  formatKEurRetard,
  type RetardPaiementSynthese,
} from '@/lib/retardsPaiement'

type LigneImport = {
  numero_tiers: string
  nom_tiers: string | null
  profil: string | null
  en_litige: boolean | null
  code_litige: string | null
  intitule_litige: string | null
  promesses: string | null
  commercial_code: string | null
  delai_moyen_paiement: number | null
  niveau_relance: string | null
  effectue_le: string | null
  retard_plus_45: number
  retard_30_45: number
  retard_15_30: number
  retard_0_15: number
  total_en_retard: number
  total_a_venir: number
  total: number
  commentaires: string | null
  email_vide: boolean | null
  email_invalide: boolean | null
}

type Historique = {
  date_extraction: string
  nb_lignes: number
  nb_en_retard: number
  total_en_retard: number
  source_fichier: string | null
  imported_by_email: string | null
  imported_at: string | null
}

/** Libellé de colonne du fichier -> champ de la table. Les libellés sont
 * normalisés (minuscules, sans accents, espaces réduits) avant comparaison,
 * pour résister aux petites variations d'export. */
const COLONNES: Record<string, keyof LigneImport> = {
  'nom': 'nom_tiers',
  'code': 'numero_tiers',
  'profil': 'profil',
  'en litige': 'en_litige',
  'code de litige': 'code_litige',
  'intitule du litige': 'intitule_litige',
  'promesses': 'promesses',
  'commercial': 'commercial_code',
  'delai moyen de paiement': 'delai_moyen_paiement',
  'niveau': 'niveau_relance',
  'effectue le': 'effectue_le',
  'en retard de plus de 45 jours': 'retard_plus_45',
  'en retard entre plus de 30 et 45 jours': 'retard_30_45',
  'en retard entre plus de 15 et 30 jours': 'retard_15_30',
  'en retard entre plus de 0 et 15 jours': 'retard_0_15',
  'total en retard': 'total_en_retard',
  'total a venir': 'total_a_venir',
  'total': 'total',
  'commentaires': 'commentaires',
  'adresse email vide': 'email_vide',
  'adresse email invalide': 'email_invalide',
}
const COLONNES_OBLIGATOIRES: Array<keyof LigneImport> = ['numero_tiers', 'total_en_retard']

function normaliserLibelle(value: any) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}
function texteOuNull(value: any): string | null {
  const t = String(value ?? '').trim()
  return t ? t : null
}
function nombre(value: any): number {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const n = Number(String(value).replace(/\s/g, '').replace(/€/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
function entierOuNull(value: any): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Math.round(nombre(value))
  return Number.isFinite(n) ? n : null
}
function booleenOuNull(value: any): boolean | null {
  const t = normaliserLibelle(value)
  if (!t) return null
  if (['oui', 'true', '1', 'yes', 'vrai', 'x'].includes(t)) return true
  if (['non', 'false', '0', 'no', 'faux'].includes(t)) return false
  return null
}
/** Cellule date Excel : Date JS (cellDates), numéro de série Excel, ou texte
 * JJ/MM/AAAA / AAAA-MM-JJ -> ISO AAAA-MM-JJ, sinon null. */
function dateIsoOuNull(value: any): string | null {
  if (value === null || value === undefined || value === '') return null
  const pad = (n: number) => String(n).padStart(2, '0')
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 20000 || value > 80000) return null
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  const t = String(value).trim()
  const iso = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const fr = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
  return null
}
function dateDepuisNomFichier(nom: string): string {
  const m = nom.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function lireFichier(file: File): Promise<{ lignes: LigneImport[]; colonnesManquantes: string[]; nbIgnorees: number }> {
  // @ts-ignore - xlsx-js-style est présent dans le projet mais n'a pas toujours les types TS.
  const XLSX = await import('xlsx-js-style')
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const matrice: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
  if (!matrice.length) return { lignes: [], colonnesManquantes: ['(fichier vide)'], nbIgnorees: 0 }

  const entetes = matrice[0].map((h) => normaliserLibelle(h))
  const index: Partial<Record<keyof LigneImport, number>> = {}
  entetes.forEach((h, i) => {
    const champ = COLONNES[h]
    if (champ && index[champ] === undefined) index[champ] = i
  })
  const colonnesManquantes = COLONNES_OBLIGATOIRES.filter((c) => index[c] === undefined)
  if (colonnesManquantes.length) return { lignes: [], colonnesManquantes, nbIgnorees: 0 }

  const cell = (row: any[], champ: keyof LigneImport) => (index[champ] === undefined ? null : row[index[champ] as number])
  const lignes: LigneImport[] = []
  let nbIgnorees = 0
  for (const row of matrice.slice(1)) {
    const numero = String(cell(row, 'numero_tiers') ?? '').trim().toUpperCase()
    if (!numero) { nbIgnorees += 1; continue } // ligne de totaux / ligne vide
    lignes.push({
      numero_tiers: numero,
      nom_tiers: texteOuNull(cell(row, 'nom_tiers')),
      profil: texteOuNull(cell(row, 'profil')),
      en_litige: booleenOuNull(cell(row, 'en_litige')),
      code_litige: texteOuNull(cell(row, 'code_litige')),
      intitule_litige: texteOuNull(cell(row, 'intitule_litige')),
      promesses: texteOuNull(cell(row, 'promesses')),
      commercial_code: texteOuNull(cell(row, 'commercial_code')),
      delai_moyen_paiement: entierOuNull(cell(row, 'delai_moyen_paiement')),
      niveau_relance: texteOuNull(cell(row, 'niveau_relance')),
      effectue_le: dateIsoOuNull(cell(row, 'effectue_le')),
      retard_plus_45: nombre(cell(row, 'retard_plus_45')),
      retard_30_45: nombre(cell(row, 'retard_30_45')),
      retard_15_30: nombre(cell(row, 'retard_15_30')),
      retard_0_15: nombre(cell(row, 'retard_0_15')),
      total_en_retard: nombre(cell(row, 'total_en_retard')),
      total_a_venir: nombre(cell(row, 'total_a_venir')),
      total: nombre(cell(row, 'total')),
      commentaires: texteOuNull(cell(row, 'commentaires')),
      email_vide: booleenOuNull(cell(row, 'email_vide')),
      email_invalide: booleenOuNull(cell(row, 'email_invalide')),
    })
  }
  return { lignes, colonnesManquantes: [], nbIgnorees }
}

export default function RetardsPaiementImportPage() {
  const [fichier, setFichier] = useState<File | null>(null)
  const [lignes, setLignes] = useState<LigneImport[]>([])
  const [nbIgnorees, setNbIgnorees] = useState(0)
  const [dateExtraction, setDateExtraction] = useState('')
  const [lecture, setLecture] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [importEnCours, setImportEnCours] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [historique, setHistorique] = useState<Historique[]>([])
  const [synthese, setSynthese] = useState<RetardPaiementSynthese | null>(null)

  async function chargerEtat() {
    const [{ data: hist }, syn] = await Promise.all([
      supabase.rpc('get_retards_paiement_historique'),
      fetchRetardsPaiementSynthese(null).catch(() => null),
    ])
    setHistorique(((hist || []) as any[]).map((r) => ({
      date_extraction: String(r.date_extraction || ''),
      nb_lignes: Number(r.nb_lignes || 0),
      nb_en_retard: Number(r.nb_en_retard || 0),
      total_en_retard: Number(r.total_en_retard || 0),
      source_fichier: r.source_fichier || null,
      imported_by_email: r.imported_by_email || null,
      imported_at: r.imported_at || null,
    })))
    setSynthese(syn)
  }

  useEffect(() => { void chargerEtat() }, [])

  async function choisirFichier(file: File | null) {
    setFichier(file)
    setLignes([])
    setNbIgnorees(0)
    setErreur(null)
    setMessage(null)
    if (!file) return
    setDateExtraction(dateDepuisNomFichier(file.name))
    setLecture(true)
    try {
      const resultat = await lireFichier(file)
      if (resultat.colonnesManquantes.length) {
        setErreur(`Colonnes introuvables dans le fichier : ${resultat.colonnesManquantes.join(', ')}. Le fichier attendu est l'export "Qui vous doit quoi" (colonnes Nom, Code, …, Total en retard).`)
        return
      }
      setLignes(resultat.lignes)
      setNbIgnorees(resultat.nbIgnorees)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setLecture(false)
    }
  }

  async function importer() {
    if (!lignes.length || !dateExtraction) return
    setImportEnCours(true)
    setErreur(null)
    setMessage(null)
    try {
      const { data, error } = await supabase.rpc('import_retards_paiement', {
        p_date_extraction: dateExtraction,
        p_source_fichier: fichier?.name || null,
        p_rows: lignes,
      })
      if (error) throw error
      setMessage(`${Number(data) || 0} clients importés pour la situation au ${formatDateFrRetard(dateExtraction)}.`)
      setFichier(null)
      setLignes([])
      await chargerEtat()
    } catch (e: any) {
      setErreur(e?.message || String(e))
    } finally {
      setImportEnCours(false)
    }
  }

  const apercu = useMemo(() => {
    const enRetard = lignes.filter((l) => l.total_en_retard > 0)
    const somme = (k: keyof LigneImport) => enRetard.reduce((s, l) => s + Number(l[k] || 0), 0)
    return {
      nbClients: lignes.length,
      nbEnRetard: enRetard.length,
      nbLitiges: lignes.filter((l) => l.en_litige).length,
      totalEnRetard: somme('total_en_retard'),
      tranches: TRANCHES_RETARD.map((t) => ({ ...t, montant: somme(t.key) })),
      premieres: [...enRetard].sort((a, b) => b.total_en_retard - a.total_en_retard).slice(0, 12),
    }
  }, [lignes])

  return (
    <main className="page">
      <header className="entete">
        <div>
          <div className="eyebrow">Compta client</div>
          <h1>Retards de paiement — import du fichier « Qui vous doit quoi »</h1>
          <p>Déposez l'export compta (.xlsx). Seul le dernier instantané est affiché dans l'app (mobile, Synthèse multi-clients, Vision Client, Vision ONE PAGE) ; les précédents sont conservés.</p>
        </div>
        {synthese && (
          <div className="etatActuel">
            {synthese.date_extraction ? (
              <>
                <span>Situation en ligne au <strong>{formatDateFrRetard(synthese.date_extraction)}</strong></span>
                <span><strong>{synthese.nb_clients}</strong> clients en retard · <strong>{formatKEurRetard(synthese.total_en_retard)}</strong></span>
              </>
            ) : (
              <span>Aucun fichier importé pour l'instant.</span>
            )}
          </div>
        )}
      </header>

      <section className="card">
        <h2>1. Fichier à importer</h2>
        <div className="ligneFichier">
          <input
            type="file"
            accept=".xlsx,.xlsm,.xls"
            onChange={(e) => void choisirFichier(e.target.files?.[0] || null)}
            disabled={lecture || importEnCours}
          />
          <label className="champDate">
            Situation au
            <input type="date" value={dateExtraction} onChange={(e) => setDateExtraction(e.target.value)} disabled={!fichier || importEnCours} />
          </label>
        </div>
        <p className="aide">
          La date est lue dans le nom du fichier (…-AAAAMMJJ.xlsx) et reste modifiable. Un nouvel import à une date déjà existante remplace l'instantané de cette date.
        </p>
        {lecture && <p className="info">Lecture du fichier…</p>}
        {erreur && <p className="erreur">{erreur}</p>}
        {message && <p className="succes">{message}</p>}
      </section>

      {lignes.length > 0 && (
        <section className="card">
          <h2>2. Aperçu avant import</h2>
          <div className="kpis">
            <div><span>Clients dans le fichier</span><strong>{apercu.nbClients}</strong></div>
            <div><span>Clients avec retard</span><strong>{apercu.nbEnRetard}</strong></div>
            <div><span>Total en retard</span><strong>{formatKEurRetard(apercu.totalEnRetard)}</strong></div>
            {apercu.tranches.map((t) => (
              <div key={t.key}><span>{t.court}</span><strong>{formatKEurRetard(t.montant)}</strong></div>
            ))}
            <div><span>En litige</span><strong>{apercu.nbLitiges}</strong></div>
          </div>
          {nbIgnorees > 0 && <p className="aide">{nbIgnorees} ligne{nbIgnorees > 1 ? 's' : ''} sans code client ignorée{nbIgnorees > 1 ? 's' : ''} (ligne de totaux du fichier).</p>}

          <table className="apercu">
            <thead>
              <tr>
                <th>Code</th><th>Nom</th><th>Commercial</th><th>Niveau</th>
                {TRANCHES_RETARD.map((t) => <th key={t.key} className="num">{t.court}</th>)}
                <th className="num">Total en retard</th>
              </tr>
            </thead>
            <tbody>
              {apercu.premieres.map((l) => (
                <tr key={l.numero_tiers}>
                  <td className="mono">{l.numero_tiers}</td>
                  <td>{l.nom_tiers || '—'}</td>
                  <td>{l.commercial_code || '—'}</td>
                  <td>{l.niveau_relance || '—'}</td>
                  {TRANCHES_RETARD.map((t) => <td key={t.key} className="num">{l[t.key] ? formatKEurRetard(l[t.key]) : ''}</td>)}
                  <td className="num total">{formatKEurRetard(l.total_en_retard)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {apercu.nbEnRetard > apercu.premieres.length && (
            <p className="aide">Les {apercu.premieres.length} plus gros retards sont affichés ; les {apercu.nbEnRetard} clients seront importés.</p>
          )}

          <div className="actions">
            <button type="button" className="principal" onClick={() => void importer()} disabled={importEnCours || !dateExtraction}>
              {importEnCours ? 'Import en cours…' : `Importer ${apercu.nbClients} clients (situation au ${formatDateFrRetard(dateExtraction) || '?'})`}
            </button>
            <button type="button" className="secondaire" onClick={() => void choisirFichier(null)} disabled={importEnCours}>Annuler</button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Imports réalisés</h2>
        {historique.length === 0 ? (
          <p className="aide">Aucun import pour l'instant.</p>
        ) : (
          <table className="apercu">
            <thead>
              <tr>
                <th>Situation au</th><th className="num">Clients</th><th className="num">Avec retard</th><th className="num">Total en retard</th><th>Fichier</th><th>Importé par</th><th>Le</th>
              </tr>
            </thead>
            <tbody>
              {historique.map((h, i) => (
                <tr key={h.date_extraction} className={i === 0 ? 'actuel' : ''}>
                  <td>{formatDateFrRetard(h.date_extraction)}{i === 0 ? ' · en ligne' : ''}</td>
                  <td className="num">{h.nb_lignes}</td>
                  <td className="num">{h.nb_en_retard}</td>
                  <td className="num total">{formatKEurRetard(h.total_en_retard)}</td>
                  <td className="mono">{h.source_fichier || '—'}</td>
                  <td>{h.imported_by_email || '—'}</td>
                  <td>{h.imported_at ? new Date(h.imported_at).toLocaleString('fr-FR') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <style jsx>{`
        .page { padding: 20px 28px 40px; background: #f6f8fb; min-height: 100vh; color: #0f172a; }
        .entete { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
        .eyebrow { font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.14em; color: #64748b; }
        h1 { margin: 2px 0 4px; font-size: 24px; font-weight: 900; letter-spacing: -0.02em; }
        .entete p { margin: 0; color: #64748b; font-size: 13px; max-width: 760px; }
        .etatActuel { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px 14px; font-size: 12.5px; color: #475569; white-space: nowrap; }
        .etatActuel strong { color: #0f172a; }
        .card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(15,23,42,.05); }
        .card h2 { margin: 0 0 12px; font-size: 15px; font-weight: 900; }
        .ligneFichier { display: flex; gap: 18px; align-items: flex-end; flex-wrap: wrap; }
        .champDate { display: flex; flex-direction: column; gap: 4px; font-size: 11px; font-weight: 800; text-transform: uppercase; color: #64748b; }
        .champDate input { height: 36px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0 10px; font-size: 13px; font-family: inherit; }
        .aide { margin: 8px 0 0; font-size: 12px; color: #94a3b8; }
        .info { margin: 8px 0 0; font-size: 12.5px; color: #475569; font-weight: 700; }
        .erreur { margin: 10px 0 0; background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; padding: 10px 12px; border-radius: 10px; font-weight: 700; font-size: 12.5px; }
        .succes { margin: 10px 0 0; background: #dcfce7; color: #047857; border: 1px solid #86efac; padding: 10px 12px; border-radius: 10px; font-weight: 800; font-size: 12.5px; }
        .kpis { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
        .kpis div { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 10px; min-width: 0; }
        .kpis span { display: block; font-size: 10px; font-weight: 900; text-transform: uppercase; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .kpis strong { display: block; margin-top: 2px; font-size: 16px; font-weight: 950; }
        .apercu { width: 100%; border-collapse: collapse; font-size: 12px; }
        .apercu th { text-align: left; font-size: 10px; text-transform: uppercase; color: #94a3b8; padding: 5px 8px; border-bottom: 1px solid #e2e8f0; font-weight: 800; }
        .apercu td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; }
        .apercu .num { text-align: right; }
        .apercu .mono { font-family: monospace; font-weight: 700; }
        .apercu .total { font-weight: 900; color: #dc2626; }
        .apercu tr.actuel td { background: #fff7df; font-weight: 800; }
        .actions { display: flex; gap: 8px; margin-top: 14px; }
        .principal { border: none; background: #0f172a; color: white; font-size: 13px; font-weight: 800; padding: 10px 18px; border-radius: 9px; cursor: pointer; }
        .principal:disabled { opacity: .5; cursor: not-allowed; }
        .secondaire { border: 1px solid #e2e8f0; background: white; color: #64748b; font-size: 13px; font-weight: 800; padding: 10px 16px; border-radius: 9px; cursor: pointer; }
      `}</style>
    </main>
  )
}
