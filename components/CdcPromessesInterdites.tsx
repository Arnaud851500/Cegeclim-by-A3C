'use client'

// ============================================================================
// components/CdcPromessesInterdites.tsx — panneau « Date de livraison interdite »
// ----------------------------------------------------------------------------
// (2026-10-20) Affiché dans le Portefeuille livraison (filtre dédié, URL
// ?promesse=interdite). Une ligne par CDC × référence, mêmes colonnes que le
// détail de l'écran « Reconstruction du stock projeté » ; une action +
// commentaire par CDC (cellule fusionnée). Voir lib/cdcPromesses.ts.
// (2026-10-25) Le panneau suit aussi les filtres de dates du portefeuille
// (création début / fin sur la date de création, livraison début / fin sur la
// date de livraison promise) via la prop filtreDates.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabaseClient'
import {
  ACTION_INFO,
  PROMESSES_FENETRE_JOURS,
  STATUT_INFO,
  VERDICT_INFO,
  enregistrerAction,
  fetchPromesseCandidats,
  fetchPromessesInterdites,
  formatDateCourte,
  formatSigne,
  grouperParCommande,
  joursEntre,
  lienStockArticle,
  promessesExportCommandes,
  promessesExportLignes,
  supprimerAction,
  verifierSaisie,
  type PromesseAction,
  type PromesseCandidat,
  type PromesseCommande,
  type PromesseLigne,
  type PromesseStatut,
  type PromesseVerdict,
} from '@/lib/cdcPromesses'

type FiltreVerdict = 'TOUS' | 'INTENABLE' | 'CREE_RETARD'

/** Bornes de dates venant des filtres du Portefeuille livraison (ISO AAAA-MM-JJ, vide = pas de borne). */
export type PromessesFiltreDates = {
  creationDebut?: string
  creationFin?: string
  livraisonDebut?: string
  livraisonFin?: string
}

export function promessesFiltreDatesActif(f?: PromessesFiltreDates | null) {
  return Boolean(f && (f.creationDebut || f.creationFin || f.livraisonDebut || f.livraisonFin))
}

/** Applique les bornes de dates du portefeuille : date de création de la CDC
 * et date de livraison promise (échéance). */
export function filtrerPromessesParDates(commandes: PromesseCommande[], f?: PromessesFiltreDates | null): PromesseCommande[] {
  if (!promessesFiltreDatesActif(f)) return commandes
  return commandes.filter((c) => {
    const creation = String(c.date_creation || '').slice(0, 10)
    const echeance = String(c.echeance || '').slice(0, 10)
    if (f!.creationDebut && (!creation || creation < f!.creationDebut)) return false
    if (f!.creationFin && (!creation || creation > f!.creationFin)) return false
    if (f!.livraisonDebut && (!echeance || echeance < f!.livraisonDebut)) return false
    if (f!.livraisonFin && (!echeance || echeance > f!.livraisonFin)) return false
    return true
  })
}

function libelleFiltreDates(f?: PromessesFiltreDates | null) {
  if (!promessesFiltreDatesActif(f)) return ''
  const parts: string[] = []
  if (f!.creationDebut || f!.creationFin) parts.push(`créées ${f!.creationDebut ? `du ${formatDateCourte(f!.creationDebut)}` : ''}${f!.creationFin ? ` au ${formatDateCourte(f!.creationFin)}` : ''}`.trim())
  if (f!.livraisonDebut || f!.livraisonFin) parts.push(`livraison promise ${f!.livraisonDebut ? `du ${formatDateCourte(f!.livraisonDebut)}` : ''}${f!.livraisonFin ? ` au ${formatDateCourte(f!.livraisonFin)}` : ''}`.trim())
  return parts.join(' · ')
}

const VERDICT_CLASS: Record<PromesseVerdict, string> = {
  OK: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  INTENABLE: 'border-rose-300 bg-rose-50 text-rose-800',
  CREE_RETARD: 'border-amber-300 bg-amber-50 text-amber-800',
}
const STATUT_CLASS: Record<PromesseStatut, string> = {
  a_traiter: 'border-rose-300 bg-rose-50 text-rose-800',
  non_confirmee: 'border-red-400 bg-red-100 text-red-900',
  en_attente: 'border-sky-300 bg-sky-50 text-sky-800',
  resolue: 'border-emerald-300 bg-emerald-50 text-emerald-800',
}

function norm(v: string | null | undefined) {
  return String(v || '').trim().toUpperCase()
}

export default function CdcPromessesInterdites({
  agenceFiltre,
  representantFiltre,
  filtreDates,
  onCountChange,
}: {
  /** Agence choisie dans les filtres du portefeuille (vide = toutes). */
  agenceFiltre?: string
  /** Représentant choisi dans les filtres du portefeuille (vide = tous). */
  representantFiltre?: string
  /** Bornes de dates choisies dans les filtres du portefeuille. */
  filtreDates?: PromessesFiltreDates | null
  /** Nombre de CDC à traiter (à traiter + non confirmées) dans le périmètre affiché. */
  onCountChange?: (n: number) => void
}) {
  const [lignes, setLignes] = useState<PromesseLigne[]>([])
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [masquerTraitees, setMasquerTraitees] = useState(false)
  const [filtreVerdict, setFiltreVerdict] = useState<FiltreVerdict>('TOUS')
  const [recherche, setRecherche] = useState('')
  const [edition, setEdition] = useState<PromesseCommande | null>(null)

  const charger = useCallback(async () => {
    setLoading(true)
    setErreur(null)
    try {
      setLignes(await fetchPromessesInterdites())
    } catch (e: any) {
      const msg = String(e?.message || e)
      setErreur(/v_cdc_promesses_interdites|does not exist|schema cache/i.test(msg)
        ? 'Le contrôle des dates de livraison n’est pas encore installé en base (script 20261020_cdc_promesses_controle.sql à exécuter).'
        : msg)
      setLignes([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void charger() }, [charger])

  const commandes = useMemo(() => grouperParCommande(lignes).filter((c) => c.lignes.length > 0 || c.statut_traitement !== 'resolue'), [lignes])

  const commandesPerimetre = useMemo(() => filtrerPromessesParDates(commandes.filter((c) => {
    if (agenceFiltre && norm(c.agence) !== norm(agenceFiltre)) return false
    if (representantFiltre && norm(c.representant) !== norm(representantFiltre) && !c.lignes.some((l) => norm(l.collaborateur) === norm(representantFiltre))) return false
    return true
  }), filtreDates), [commandes, agenceFiltre, representantFiltre, filtreDates])

  const compteurs = useMemo(() => {
    const out = { aTraiter: 0, nonConfirmee: 0, enAttente: 0, intenable: 0, retard: 0, pieces: 0 }
    for (const c of commandesPerimetre) {
      if (c.statut_traitement === 'a_traiter') out.aTraiter += 1
      if (c.statut_traitement === 'non_confirmee') out.nonConfirmee += 1
      if (c.statut_traitement === 'en_attente') out.enAttente += 1
      if (c.verdict === 'INTENABLE') out.intenable += 1
      if (c.verdict === 'CREE_RETARD') out.retard += 1
      out.pieces += c.lignes.reduce((s, l) => s + l.q_manque, 0)
    }
    return out
  }, [commandesPerimetre])

  useEffect(() => { onCountChange?.(compteurs.aTraiter + compteurs.nonConfirmee) }, [compteurs, onCountChange])

  const commandesAffichees = useMemo(() => {
    const q = recherche.trim().toUpperCase()
    return commandesPerimetre.filter((c) => {
      if (masquerTraitees && c.action) return false
      if (filtreVerdict !== 'TOUS' && c.verdict !== filtreVerdict) return false
      if (q) {
        const texte = `${c.numero_document} ${c.nom_tiers || ''} ${c.numero_tiers || ''} ${c.lignes.map((l) => l.reference_article).join(' ')}`.toUpperCase()
        if (!texte.includes(q)) return false
      }
      return true
    })
  }, [commandesPerimetre, masquerTraitees, filtreVerdict, recherche])

  const calculeLe = useMemo(() => lignes.reduce<string | null>((m, l) => (l.calcule_le && (!m || l.calcule_le > m) ? l.calcule_le : m), null), [lignes])
  const filtreDatesLibelle = libelleFiltreDates(filtreDates)

  function exporter() {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(promessesExportCommandes(commandesAffichees)), 'Dates interdites')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(promessesExportLignes(commandesAffichees)), 'Dates interdites detail')
    XLSX.writeFile(wb, `dates-livraison-interdites-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <section className="rounded-2xl border border-rose-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">Commandes à date de livraison interdite</h2>
          <p className="mt-1 max-w-5xl text-sm text-slate-500">
            CDC ouvertes créées depuis {PROMESSES_FENETRE_JOURS} jours dont la date de livraison promise ne tient pas compte du stock : <b className="text-rose-700">intenable</b> (le stock n’y sera pas à la date, même avec les arrivages) ou <b className="text-amber-700">crée un retard</b> (livrable, mais sur le stock d’une commande plus ancienne qu’aucun arrivage ne recouvre à temps). Même calcul que l’écran Reconstruction du stock projeté, refait après chaque synchro SAGE{calculeLe ? ` (dernier calcul ${new Date(calculeLe).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})` : ''}.
            {' '}Ne sont pas retenues, comme dans le reste du portefeuille : les références non gérées en stock, et les commandes dont la rupture créée tombe après le délai d'appro (un appro passé à la saisie la couvre).
            {' '}Pour chaque commande : <b>décaler la date</b> (au plus tôt la date proposée, qui suppose au besoin un appro lancé le jour même) ou <b>déprioriser une autre commande</b> de votre portefeuille, avec un commentaire. L’action est vérifiée à la synchro suivante.
          </p>
          {filtreDatesLibelle && (
            <div className="mt-2 inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800">
              Filtres de dates du portefeuille appliqués : {filtreDatesLibelle}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full border border-rose-300 bg-rose-50 px-2.5 py-1 text-rose-800">{compteurs.aTraiter} à traiter</span>
            <span className="rounded-full border border-red-400 bg-red-100 px-2.5 py-1 text-red-900" title={STATUT_INFO.non_confirmee.aide}>{compteurs.nonConfirmee} non confirmée(s)</span>
            <span className="rounded-full border border-sky-300 bg-sky-50 px-2.5 py-1 text-sky-800" title={STATUT_INFO.en_attente.aide}>{compteurs.enAttente} en attente synchro</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">{compteurs.intenable} intenable(s) · {compteurs.retard} créent un retard · {Math.round(compteurs.pieces).toLocaleString('fr-FR')} pièce(s) en défaut</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="N° CDC, client, référence" className="h-9 w-56 rounded-xl border border-slate-300 px-3 text-sm" />
          <select value={filtreVerdict} onChange={(e) => setFiltreVerdict(e.target.value as FiltreVerdict)} className="h-9 rounded-xl border border-slate-300 px-2 text-sm">
            <option value="TOUS">Intenables + retards</option>
            <option value="INTENABLE">Intenables</option>
            <option value="CREE_RETARD">Créent un retard</option>
          </select>
          <button
            type="button"
            onClick={() => setMasquerTraitees((v) => !v)}
            className={['h-9 rounded-xl border px-3 text-sm font-medium', masquerTraitees ? 'border-sky-400 bg-sky-50 text-sky-800' : 'border-slate-300 bg-white text-slate-700'].join(' ')}
            title="Masque les commandes pour lesquelles une action et un commentaire ont déjà été saisis, même si la synchro n'est pas encore passée"
          >
            {masquerTraitees ? '✓ Commandes avec action masquées' : 'Masquer les commandes avec action'}
          </button>
          <button type="button" onClick={() => void charger()} className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700">Actualiser</button>
          <button type="button" onClick={exporter} disabled={!commandesAffichees.length} className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 disabled:opacity-40">Excel</button>
        </div>
      </div>

      {erreur && <div className="m-4 rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-800">{erreur}</div>}
      {loading && <div className="px-4 py-6 text-sm text-slate-500">Chargement…</div>}

      {!loading && !erreur && (
        <div className="max-h-[640px] overflow-y-auto overflow-x-hidden">
          {/* (2026-10-21) Tableau ramené à une seule largeur d'écran : colonne « Commande » unique
              (document, création, client, agence, statut et boutons d'action sous le numéro),
              largeurs fixes, en-têtes sur deux lignes, date exacte et écart regroupés. */}
          <table className="w-full table-fixed border-collapse text-[13px]">
            <colgroup>
              <col style={{ width: '17%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '3.5%' }} />
              <col style={{ width: '5.5%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '5.5%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '6.5%' }} />
              <col />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-slate-100 text-left text-[10px] uppercase leading-tight tracking-wide text-slate-500">
              <tr>
                {[
                  { h: 'Commande · client · action', align: '' },
                  { h: 'Promise', align: '' },
                  { h: 'Référence', align: '' },
                  { h: 'Qté', align: 'text-right' },
                  { h: 'Stock fin de journée', align: 'text-right' },
                  { h: 'Solde à la date promise', align: 'text-right' },
                  { h: 'Dispo réelle', align: 'text-right' },
                  { h: 'Verdict', align: '' },
                  { h: 'Date exacte (écart)', align: '' },
                  { h: 'Date proposée', align: '' },
                  { h: 'Rupture créée le', align: '' },
                  { h: 'Promesses exposées', align: '' },
                ].map(({ h, align }) => (
                  <th key={h} className={['border-b border-slate-200 px-2 py-2 align-bottom font-semibold', align].join(' ')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {commandesAffichees.map((c) => {
                const lignesAff = c.lignes.length > 0 ? c.lignes : []
                if (lignesAff.length === 0) {
                  // CDC redevenue tenable mais action non encore vérifiée : une ligne de rappel.
                  return (
                    <tr key={c.numero_document} className="border-t-2 border-slate-200 bg-emerald-50/40">
                      <td className="px-2 py-2 align-top"><CelluleCommande c={c} onEdit={() => setEdition(c)} /></td>
                      <td colSpan={11} className="px-2 py-2 align-top text-slate-500">Date désormais tenable — vérification de l’action à la prochaine synchro (CDC dépriorisée à contrôler).</td>
                    </tr>
                  )
                }
                return lignesAff.map((l, i) => {
                  const ecart = joursEntre(l.echeance, l.date_exacte)
                  return (
                    <tr key={`${c.numero_document}-${l.reference_article}`} className={[i === 0 ? 'border-t-2 border-slate-200' : 'border-t border-slate-100', c.statut_traitement === 'a_traiter' || c.statut_traitement === 'non_confirmee' ? '' : 'bg-slate-50/60'].join(' ')}>
                      {i === 0 && (
                        <td rowSpan={lignesAff.length} className="border-r border-slate-100 px-2 py-2 align-top"><CelluleCommande c={c} onEdit={() => setEdition(c)} /></td>
                      )}
                      <td className="px-2 py-1.5 whitespace-nowrap">{formatDateCourte(l.echeance)}</td>
                      <td className="truncate px-2 py-1.5">
                        <a href={lienStockArticle(l.reference_article)} target="_blank" rel="noopener noreferrer" className="font-mono text-[12px] text-blue-700 hover:underline" title={`${l.reference_article} — ouvrir la fiche dans Stock articles`}>{l.reference_article}</a>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{Math.round(l.quantite).toLocaleString('fr-FR')}</td>
                      <td className="px-2 py-1.5 text-right font-mono" title={`Promesses ouvertes toutes dates : ${Math.round(l.promesses_ouvertes)} · stock projeté ${formatSigne(l.stock_projete_creation)}`}>{Math.round(l.stock_phys).toLocaleString('fr-FR')}</td>
                      <td className={['px-2 py-1.5 text-right font-mono', l.solde_echeance >= l.quantite ? 'text-emerald-700' : 'text-rose-700'].join(' ')}>{formatSigne(l.solde_echeance)}</td>
                      <td className={['px-2 py-1.5 text-right font-mono font-semibold', l.atp_echeance >= l.quantite ? 'text-emerald-700' : 'text-rose-700'].join(' ')}>{formatSigne(l.atp_echeance)}</td>
                      <td className="px-2 py-1.5" title={VERDICT_INFO[l.verdict].aide}>
                        <span className={['inline-flex whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[11px] font-semibold', VERDICT_CLASS[l.verdict]].join(' ')}>{VERDICT_INFO[l.verdict].label}</span>
                        <span className="ml-1 whitespace-nowrap text-[11px] text-slate-500">{Math.round(l.q_manque)} p.</span>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {l.date_exacte ? <span className="font-semibold text-amber-800">{formatDateCourte(l.date_exacte)}</span> : <span className="font-semibold text-rose-700">aucune</span>}
                        {ecart !== null && <span className={['block font-mono text-[11px]', ecart > 0 ? 'text-rose-700' : 'text-slate-500'].join(' ')}>{ecart > 0 ? '+' : ''}{ecart} j</span>}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap" title={l.date_proposee && l.date_proposee !== l.date_exacte ? 'Au plus court si un appro est lancé aujourd’hui : aujourd’hui + délai d’appro + 7 j ; Hitachi H0001 : 180 j sans sécurité pour la liste ciblée, 90 j + 7 j pour les autres réf. Hitachi' : 'Date exacte : stock et arrivages déjà connus'}>
                        {l.date_proposee
                          ? <><span className="font-semibold text-emerald-800">{formatDateCourte(l.date_proposee)}</span>{l.date_proposee !== l.date_exacte ? <span className="block text-[11px] text-slate-500">si appro</span> : null}</>
                          : <span className="font-semibold text-rose-700">{l.arret_appro ? 'arrêt appro' : 'aucune'}</span>}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-rose-700">{formatDateCourte(l.date_rupture)}</td>
                      <td className="px-2 py-1.5" title={l.nb_victimes > 0 ? `${l.nb_victimes} CDC · ${Math.round(l.q_victimes)} p. : ${l.victimes || ''}` : undefined}>
                        {l.nb_victimes > 0
                          ? <><div className="font-mono text-[12px] text-amber-800">{l.nb_victimes} CDC · {Math.round(l.q_victimes)} p.</div><div className="line-clamp-2 break-words text-[11px] text-slate-500">{l.victimes}{l.nb_victimes > 5 ? ' …' : ''}</div></>
                          : '—'}
                      </td>
                    </tr>
                  )
                })
              })}
              {commandesAffichees.length === 0 && (
                <tr><td colSpan={12} className="px-3 py-6 text-center text-sm text-slate-500">{commandesPerimetre.length === 0 ? (filtreDatesLibelle ? 'Aucune commande à date de livraison interdite avec ces filtres de dates.' : 'Aucune commande à date de livraison interdite dans votre périmètre.') : 'Aucune commande pour ces filtres.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500">
        Solde à la date promise = stock de fin de journée de saisie + réceptions jusqu’à cette date − promesses plus anciennes dues d’ici là. Dispo réelle = plus bas niveau de ce solde à partir de la date promise (ce qu’on pouvait promettre sans léser personne). Date exacte = première date où la commande ne lèse personne. « Promesses exposées » = commandes plus anciennes privées de stock entre la rupture créée et la date exacte.
      </div>

      {edition && (
        <EditionAction
          commande={edition}
          onClose={() => setEdition(null)}
          onSaved={() => { setEdition(null); void charger() }}
        />
      )}
    </section>
  )
}

/** Colonne « Commande » : n° + date de création, statut et boutons d'action juste dessous,
 *  puis client, n° tiers · représentant, agence, et l'action saisie. */
function CelluleCommande({ c, onEdit }: { c: PromesseCommande; onEdit: () => void }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[13px] font-semibold text-slate-900">{c.numero_document}</span>
        <span className="whitespace-nowrap text-[11px] text-slate-500" title="Date de création">créée {formatDateCourte(c.date_creation)}</span>
      </div>
      <CelluleAction c={c} onEdit={onEdit} />
      <div className="pt-0.5">
        <div className="break-words font-medium leading-snug text-slate-800">{c.nom_tiers || c.numero_tiers}</div>
        <div className="break-words text-[11px] text-slate-500">{c.numero_tiers}{c.representant ? ` · ${c.representant}` : ''}{c.agence ? ` · ${c.agence}` : ''}</div>
      </div>
    </div>
  )
}

function CelluleAction({ c, onEdit }: { c: PromesseCommande; onEdit: () => void }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={['inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold', STATUT_CLASS[c.statut_traitement]].join(' ')} title={c.verification || STATUT_INFO[c.statut_traitement].aide}>{STATUT_INFO[c.statut_traitement].label}</span>
        <button type="button" onClick={onEdit} className="rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">{c.action ? 'Modifier' : 'Traiter'}</button>
      </div>
      {c.action && (
        <div className="break-words text-xs text-slate-700">
          <div className="font-semibold">
            {ACTION_INFO[c.action].label}
            {c.action === 'decaler' && c.nouvelle_date ? ` → ${formatDateCourte(c.nouvelle_date)}` : ''}
            {c.action === 'deprioriser' && c.cdc_depriorisee ? ` : ${c.cdc_depriorisee}` : ''}
          </div>
          {c.commentaire && <div className="whitespace-pre-wrap text-slate-600">{c.commentaire}</div>}
          <div className="text-[11px] text-slate-400">{c.saisi_par_nom}{c.saisi_le ? ` · ${new Date(c.saisi_le).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</div>
          {c.statut_traitement === 'non_confirmee' && c.verification && <div className="text-[11px] font-semibold text-red-700">⚠ {c.verification}</div>}
        </div>
      )}
    </div>
  )
}

function EditionAction({ commande, onClose, onSaved }: { commande: PromesseCommande; onClose: () => void; onSaved: () => void }) {
  const [action, setAction] = useState<PromesseAction>(commande.action || 'decaler')
  const [nouvelleDate, setNouvelleDate] = useState(commande.nouvelle_date || commande.date_proposee || '')
  const [cdcDepriorisee, setCdcDepriorisee] = useState(commande.cdc_depriorisee || '')
  const [commentaire, setCommentaire] = useState(commande.commentaire || '')
  const [candidats, setCandidats] = useState<PromesseCandidat[]>([])
  const [candidatsLoading, setCandidatsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    if (action !== 'deprioriser' || candidats.length > 0) return
    let alive = true
    setCandidatsLoading(true)
    fetchPromesseCandidats(commande.numero_document)
      .then((rows) => { if (alive) setCandidats(rows) })
      .catch((e) => { if (alive) setErreur(`Liste d’aide indisponible : ${e?.message || e}`) })
      .finally(() => { if (alive) setCandidatsLoading(false) })
    return () => { alive = false }
  }, [action, commande.numero_document, candidats.length])

  async function enregistrer() {
    const saisie = { action, nouvelleDate: nouvelleDate || null, cdcDepriorisee: cdcDepriorisee || null, commentaire }
    const err = verifierSaisie(saisie, commande)
    if (err) { setErreur(err); return }
    setSaving(true)
    setErreur(null)
    try {
      const { data } = await supabase.auth.getSession()
      const email = data.session?.user?.email || null
      const nom = (data.session?.user?.user_metadata as any)?.full_name || email
      await enregistrerAction(commande.numero_document, saisie, { email, nom })
      onSaved()
    } catch (e: any) {
      setErreur(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  async function supprimer() {
    if (!window.confirm('Supprimer l’action saisie ? La commande repassera « à traiter ».')) return
    setSaving(true)
    try {
      await supprimerAction(commande.numero_document)
      onSaved()
    } catch (e: any) {
      setErreur(e?.message || String(e))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-auto bg-slate-900/40 p-6" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold">Traiter {commande.numero_document}</h3>
            <p className="text-sm text-slate-500">
              {commande.nom_tiers} ({commande.numero_tiers}) · créée le {formatDateCourte(commande.date_creation)} · promise le {formatDateCourte(commande.echeance)} ·{' '}
              <span className="font-semibold text-emerald-800">date proposée {commande.date_proposee ? `${formatDateCourte(commande.date_proposee)}${commande.via_appro ? ' (si appro lancé aujourd’hui)' : ''}` : commande.arret_appro ? 'aucune (arrêt appro)' : 'aucune'}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">Références : {commande.lignes.map((l) => `${l.reference_article} (${VERDICT_INFO[l.verdict].court}, ${Math.round(l.q_manque)} p.)`).join(' · ')}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">✕</button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-2">
            {(Object.keys(ACTION_INFO) as PromesseAction[]).map((a) => (
              <label key={a} className={['flex cursor-pointer items-start gap-3 rounded-xl border p-3', action === a ? 'border-slate-900 bg-slate-50' : 'border-slate-200'].join(' ')}>
                <input type="radio" name="action" checked={action === a} onChange={() => { setAction(a); setErreur(null) }} className="mt-1" />
                <span>
                  <span className="block text-sm font-semibold">{ACTION_INFO[a].label}</span>
                  <span className="block text-xs text-slate-500">{ACTION_INFO[a].aide}</span>
                </span>
              </label>
            ))}
          </div>

          {action === 'decaler' && (
            <label className="block text-sm">
              <span className="font-semibold">Nouvelle date de livraison</span>
              <input type="date" value={nouvelleDate} onChange={(e) => setNouvelleDate(e.target.value)} className="mt-1 block h-10 rounded-xl border border-slate-300 px-3" />
              {commande.date_proposee && nouvelleDate && nouvelleDate < commande.date_proposee && (
                <span className="mt-1 block text-xs font-semibold text-amber-700">Avant la date proposée ({formatDateCourte(commande.date_proposee)}) : la date restera probablement interdite à la vérification.</span>
              )}
              {commande.via_appro && (
                <span className="mt-1 block text-xs text-slate-500">La date proposée suppose qu’un appro soit lancé aujourd’hui (délai d’appro + 7 j ; Hitachi H0001 : 180 j sans sécurité pour la liste ciblée, 90 j + 7 j pour les autres réf. Hitachi).</span>
              )}
            </label>
          )}

          {action === 'deprioriser' && (
            <div className="text-sm">
              <div className="font-semibold">Commande à déprioriser</div>
              <div className="text-xs text-slate-500">CDC ouvertes plus anciennes sur les mêmes références, dues avant la date exacte — celles de votre portefeuille en premier. Elle devra prendre une date de livraison couverte par le stock à la prochaine synchro.</div>
              <input value={cdcDepriorisee} onChange={(e) => setCdcDepriorisee(e.target.value.toUpperCase())} placeholder="N° de CDC" className="mt-2 h-10 w-56 rounded-xl border border-slate-300 px-3 font-mono" />
              <div className="mt-2 max-h-64 overflow-auto rounded-xl border border-slate-200">
                {candidatsLoading && <div className="p-3 text-xs text-slate-500">Chargement de la liste d’aide…</div>}
                {!candidatsLoading && candidats.length === 0 && <div className="p-3 text-xs text-slate-500">Aucune commande candidate dans votre périmètre.</div>}
                {candidats.map((k) => (
                  <button
                    key={k.numero_document}
                    type="button"
                    onClick={() => setCdcDepriorisee(k.numero_document)}
                    className={['flex w-full items-start justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left text-xs hover:bg-slate-50', norm(cdcDepriorisee) === norm(k.numero_document) ? 'bg-sky-50' : ''].join(' ')}
                  >
                    <span>
                      <span className="font-mono font-semibold">{k.numero_document}</span>{k.meme_representant ? <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">mon portefeuille</span> : null}
                      <span className="block text-slate-600">{k.nom_tiers} ({k.numero_tiers}) · {k.representant || '—'}</span>
                      <span className="block text-slate-400">{k.references_communes} · {Math.round(k.quantite)} p.</span>
                    </span>
                    <span className="whitespace-nowrap text-right text-slate-600">livraison {formatDateCourte(k.date_livraison)}<span className="block text-slate-400">créée {formatDateCourte(k.date_creation)}</span></span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="block text-sm">
            <span className="font-semibold">Commentaire (obligatoire)</span>
            <textarea value={commentaire} onChange={(e) => setCommentaire(e.target.value)} rows={3} placeholder="Ex. : client prévenu, accepte une livraison le…" className="mt-1 block w-full rounded-xl border border-slate-300 p-3" />
          </label>

          {erreur && <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{erreur}</div>}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
          <div>{commande.action && <button type="button" onClick={() => void supprimer()} disabled={saving} className="rounded-xl border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-700">Supprimer l’action</button>}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">Annuler</button>
            <button type="button" onClick={() => void enregistrer()} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </div>
        <div className="border-t border-slate-100 px-5 py-2 text-[11px] text-slate-500">
          L’action ne modifie pas SAGE : faites la modification dans SAGE / BLG, la vérification se fait à la synchro suivante. D’ici là la commande reste « en attente synchro » (masquable avec le bouton « Masquer les commandes avec action »).
        </div>
      </div>
    </div>
  )
}
