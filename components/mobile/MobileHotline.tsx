'use client'

/**
 * Écran mobile « Hotline - Ticketing » (08/11/2026, demandé par Arnaud).
 * Bloc de l'accueil mobile visible avec le droit can_hotline ou can_hotline_expert.
 *
 * - Recherche libre (n° de ticket, client, chantier, description, modèle, série)
 *   et critères dédiés : téléphone, n° de série UI / GE, modèle GE / UI, code
 *   défaut (« 03 », « code 3 », « 12 clignotements » se retrouvent), client,
 *   chantier.
 * - Filtres de la classification, dans l'ordre du ticket : filière, gamme,
 *   nature de l'appel, symptôme, organe défaillant, action menée, issue, puis
 *   statut et période. Chaque choix affiche le nombre de tickets trouvés.
 *   « Non renseigné » retrouve les tickets à classer.
 * - Fiche ticket en consultation : identification, produit, classification,
 *   description, préconisation, chronologie horodatée.
 * Recherche côté base : RPC hotline_recherche (migration
 * 20261108b_hotline_recherche_mobile.sql), RLS hotline appliquée.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  CLASSIF_VIDE,
  ETAPE_LIBELLES,
  FILIERES,
  GAMMES,
  NATURES,
  STATUTS,
  chargerClassification,
  chargerEtapes,
  fmtDate,
  fmtDateHeure,
  fmtDuree,
  fmtTel,
  libelleClassif,
  libelleFiliere,
  libelleGamme,
  libelleMotif,
  libelleNature,
  type AxeClassif,
  type Classification,
  type Etape,
  type Statut,
  type Ticket,
} from '@/lib/hotline'

// ── Filtres ───────────────────────────────────────────────────────────────
type CleTexte = 'q' | 'tel' | 'serie' | 'modele' | 'code' | 'client' | 'chantier'
type CleChoix = 'filiere' | 'gamme' | 'nature' | 'symptome' | 'organe' | 'action' | 'issue' | 'statut' | 'periode'
type Filtres = Record<CleTexte | CleChoix, string>

const FILTRES_VIDES: Filtres = {
  q: '', tel: '', serie: '', modele: '', code: '', client: '', chantier: '',
  filiere: '', gamme: '', nature: '', symptome: '', organe: '', action: '', issue: '', statut: '', periode: '',
}

const CRITERES: Array<{ cle: Exclude<CleTexte, 'q'>; label: string; placeholder: string; mode?: 'tel' | 'text' }> = [
  { cle: 'tel', label: 'Téléphone', placeholder: '06 12 34 56 78', mode: 'tel' },
  { cle: 'serie', label: 'N° de série (UI ou GE)', placeholder: 'ex. 4QE46149' },
  { cle: 'modele', label: 'Modèle GE / UI', placeholder: 'ex. RAS-4WHVNPE, RAK-35' },
  { cle: 'code', label: 'Code défaut', placeholder: 'ex. 03, 70, 12 clign.' },
  { cle: 'client', label: 'Client (nom ou code tiers)', placeholder: 'Nom, code, contact' },
  { cle: 'chantier', label: 'Chantier', placeholder: 'Référence chantier' },
]

/** Ordre et libellés des filtres de classification (même ordre que le ticket). */
const AXES_FILTRE: Array<{ cle: CleChoix; label: string; groupe: 'classif' | 'suivi' }> = [
  { cle: 'filiere', label: 'Filière', groupe: 'classif' },
  { cle: 'gamme', label: 'Gamme', groupe: 'classif' },
  { cle: 'nature', label: 'Nature', groupe: 'classif' },
  { cle: 'symptome', label: 'Symptôme', groupe: 'classif' },
  { cle: 'organe', label: 'Organe', groupe: 'classif' },
  { cle: 'action', label: 'Action', groupe: 'classif' },
  { cle: 'issue', label: 'Issue', groupe: 'classif' },
  { cle: 'statut', label: 'Statut', groupe: 'suivi' },
  { cle: 'periode', label: 'Période', groupe: 'suivi' },
]

const PERIODES: Array<{ code: string; libelle: string; jours: number }> = [
  { code: '7J', libelle: '7 derniers jours', jours: 7 },
  { code: '30J', libelle: '30 derniers jours', jours: 30 },
  { code: '90J', libelle: '3 derniers mois', jours: 90 },
  { code: '12M', libelle: '12 derniers mois', jours: 365 },
]

const STATUTS_FILTRE: Array<{ code: string; libelle: string }> = [
  { code: 'ACTIFS', libelle: 'En cours (ouverts, en cours, escaladés)' },
  { code: 'TERMINES', libelle: 'Terminés (résolus, clos)' },
  ...(Object.keys(STATUTS) as Statut[]).map((s) => ({ code: s, libelle: STATUTS[s].label })),
]

type Facettes = Partial<Record<'filiere' | 'gamme' | 'nature' | 'symptome' | 'organe' | 'action' | 'issue' | 'statut', Record<string, number>>>
type Resultat = Pick<
  Ticket,
  | 'id' | 'numero' | 'filiere' | 'gamme' | 'nature' | 'motif' | 'statut' | 'niveau' | 'opened_at' | 'resolved_at'
  | 'telephone_appelant' | 'numero_tiers' | 'intitule_tiers' | 'contact_nom' | 'chantier' | 'modele_ge' | 'serie_ge'
  | 'reference_article' | 'numero_serie' | 'code_defaut' | 'symptome' | 'organe' | 'actions' | 'issue' | 'classif_source' | 'description'
>

const PAGE = 40
const C_BLEU = '#8FC7DA'
const C_ACCENT = 'rgba(75,146,172,0.5)'

function isoJour(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Filtres de l'écran → paramètres de la RPC hotline_recherche. */
function versRpc(f: Filtres): Record<string, string> {
  const out: Record<string, string> = {}
  ;(['q', 'tel', 'serie', 'modele', 'code', 'client', 'chantier', 'filiere', 'gamme', 'nature', 'symptome', 'organe', 'action', 'issue', 'statut'] as const).forEach((k) => {
    const v = f[k].trim()
    if (v) out[k] = v
  })
  const p = PERIODES.find((x) => x.code === f.periode)
  if (p) out.du = isoJour(new Date(Date.now() - (p.jours - 1) * 86_400_000))
  return out
}

/** Options d'un filtre de choix : code + libellé, dans l'ordre du référentiel. */
function optionsFiltre(cle: CleChoix, classif: Classification): Array<{ code: string; libelle: string }> {
  switch (cle) {
    case 'filiere':
      return FILIERES.map((x) => ({ code: x.value, libelle: x.label }))
    case 'gamme':
      return GAMMES.map((x) => ({ code: x.value, libelle: `${x.label} — ${x.titre}` }))
    case 'nature':
      return NATURES.map((x) => ({ code: x.value, libelle: x.label }))
    case 'symptome':
    case 'organe':
    case 'action':
    case 'issue':
      return classif[cle as AxeClassif].map((v) => ({ code: v.code, libelle: v.libelle }))
    case 'statut':
      return STATUTS_FILTRE
    case 'periode':
      return PERIODES.map((p) => ({ code: p.code, libelle: p.libelle }))
  }
}

function libelleValeur(cle: CleChoix, code: string, classif: Classification) {
  if (code === '-') return 'Non renseigné'
  return optionsFiltre(cle, classif).find((o) => o.code === code)?.libelle.split(' — ')[0] || code
}

// ── Écran ─────────────────────────────────────────────────────────────────
export default function MobileHotline() {
  const [filtres, setFiltres] = useState<Filtres>(FILTRES_VIDES)
  // Saisie texte appliquée après une courte pause (pas une requête par lettre).
  const [filtresAppliques, setFiltresAppliques] = useState<Filtres>(FILTRES_VIDES)
  const [criteresOuverts, setCriteresOuverts] = useState(false)
  const [panneau, setPanneau] = useState<CleChoix | null>(null)
  const [classif, setClassif] = useState<Classification>(CLASSIF_VIDE)
  const [resultats, setResultats] = useState<Resultat[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [facettes, setFacettes] = useState<Facettes>({})
  const [chargement, setChargement] = useState(false)
  const [chargementSuite, setChargementSuite] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [ouvert, setOuvert] = useState<string | null>(null)
  const requete = useRef(0)

  useEffect(() => {
    chargerClassification().then(setClassif).catch(() => undefined)
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => setFiltresAppliques(filtres), 450)
    return () => window.clearTimeout(t)
  }, [filtres])

  const params = useMemo(() => versRpc(filtresAppliques), [filtresAppliques])
  const cleParams = JSON.stringify(params)

  useEffect(() => {
    const id = ++requete.current
    setChargement(true)
    setErreur(null)
    supabase
      .rpc('hotline_recherche', { p_filtres: params, p_limite: PAGE, p_offset: 0 })
      .then(({ data, error }) => {
        if (id !== requete.current) return
        if (error) {
          setErreur(error.message)
          setResultats([])
          setTotal(0)
        } else {
          const v = (data || {}) as { total?: number; rows?: Resultat[]; facettes?: Facettes }
          setResultats(v.rows || [])
          setTotal(Number(v.total || 0))
          setFacettes(v.facettes || {})
        }
        setChargement(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleParams])

  async function afficherPlus() {
    setChargementSuite(true)
    const { data, error } = await supabase.rpc('hotline_recherche', { p_filtres: params, p_limite: PAGE, p_offset: resultats.length })
    if (error) setErreur(error.message)
    else setResultats((r) => [...r, ...(((data || {}) as { rows?: Resultat[] }).rows || [])])
    setChargementSuite(false)
  }

  const patch = (p: Partial<Filtres>) => setFiltres((f) => ({ ...f, [Object.keys(p)[0]]: Object.values(p)[0] ?? '' }))
  const nbCriteres = CRITERES.filter((c) => filtres[c.cle].trim()).length
  const nbFiltres = AXES_FILTRE.filter((a) => filtres[a.cle]).length + nbCriteres + (filtres.q.trim() ? 1 : 0)

  return (
    <div style={{ flex: 1, padding: '16px 3px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Recherche libre */}
      <input
        value={filtres.q}
        onChange={(e) => patch({ q: e.target.value })}
        placeholder="N° ticket, client, chantier, description…"
        style={champStyle}
      />

      {/* Critères d'identification */}
      <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' }}>
        <button
          type="button"
          onClick={() => setCriteresOuverts((v) => !v)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: 'none', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700 }}
        >
          <span>
            📞 Téléphone, n° de série, modèle, code défaut…
            {nbCriteres ? <span style={{ marginLeft: 8, color: C_BLEU }}>({nbCriteres})</span> : null}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>{criteresOuverts ? '▴' : '▾'}</span>
        </button>
        {criteresOuverts && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '0 12px 12px' }}>
            {CRITERES.map((c) => (
              <label key={c.cle} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, color: 'rgba(255,255,255,0.55)', fontWeight: 600 }}>
                {c.label}
                <input
                  value={filtres[c.cle]}
                  inputMode={c.mode === 'tel' ? 'tel' : 'text'}
                  autoCapitalize={c.cle === 'serie' || c.cle === 'modele' ? 'characters' : 'none'}
                  onChange={(e) => patch({ [c.cle]: e.target.value } as Partial<Filtres>)}
                  placeholder={c.placeholder}
                  style={{ ...champStyle, padding: '9px 10px', fontSize: 14, borderColor: filtres[c.cle].trim() ? C_ACCENT : 'rgba(255,255,255,0.15)' }}
                />
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Filtres de la classification */}
      <div>
        <div style={titreGroupe}>Classification</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {AXES_FILTRE.filter((a) => a.groupe === 'classif').map((a) => (
            <Pastille key={a.cle} label={filtres[a.cle] ? `${a.label} : ${libelleValeur(a.cle, filtres[a.cle], classif)}` : a.label} actif={Boolean(filtres[a.cle])} onClick={() => setPanneau(a.cle)} />
          ))}
        </div>
        <div style={{ ...titreGroupe, marginTop: 10 }}>Suivi</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          {AXES_FILTRE.filter((a) => a.groupe === 'suivi').map((a) => (
            <Pastille key={a.cle} label={filtres[a.cle] ? libelleValeur(a.cle, filtres[a.cle], classif) : a.label} actif={Boolean(filtres[a.cle])} onClick={() => setPanneau(a.cle)} />
          ))}
          {nbFiltres ? (
            <button
              type="button"
              onClick={() => setFiltres(FILTRES_VIDES)}
              style={{ padding: '7px 10px', borderRadius: 999, border: '1px solid rgba(193,104,60,0.4)', background: 'rgba(193,104,60,0.10)', color: '#e0a685', fontSize: 12, fontWeight: 600 }}
            >
              ✕ Tout effacer
            </button>
          ) : null}
        </div>
      </div>

      {/* Résultats */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '2px 4px' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
          {total === null ? 'Recherche…' : `${total.toLocaleString('fr-FR')} ticket${total > 1 ? 's' : ''}`}
        </span>
        {chargement && total !== null ? <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>mise à jour…</span> : null}
      </div>

      {erreur && (
        <div style={{ borderRadius: 10, border: '1px solid rgba(193,104,60,0.4)', background: 'rgba(193,104,60,0.12)', color: '#e0a685', fontSize: 13, padding: '10px 12px' }}>
          {erreur}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: chargement ? 0.55 : 1 }}>
        {resultats.map((t) => (
          <CarteTicket key={t.id} t={t} classif={classif} onOpen={() => setOuvert(t.id)} />
        ))}
      </div>

      {!chargement && total === 0 && !erreur ? (
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Aucun ticket pour ces critères.</div>
      ) : null}

      {total !== null && resultats.length < total ? (
        <button
          type="button"
          onClick={() => void afficherPlus()}
          disabled={chargementSuite}
          style={{ padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 14, fontWeight: 600 }}
        >
          {chargementSuite ? 'Chargement…' : `Afficher plus (${(total - resultats.length).toLocaleString('fr-FR')} restants)`}
        </button>
      ) : null}

      {panneau && (
        <PanneauFiltre
          cle={panneau}
          titre={AXES_FILTRE.find((a) => a.cle === panneau)?.label || ''}
          valeur={filtres[panneau]}
          options={optionsFiltre(panneau, classif)}
          compteurs={panneau === 'periode' ? undefined : facettes[panneau as keyof Facettes]}
          nonRenseigne={!['filiere', 'statut', 'periode'].includes(panneau)}
          onChoisir={(v) => {
            setFiltres((f) => ({ ...f, [panneau]: v }))
            setPanneau(null)
          }}
          onClose={() => setPanneau(null)}
        />
      )}

      {ouvert && <FicheTicketMobile id={ouvert} classif={classif} onClose={() => setOuvert(null)} />}
    </div>
  )
}

// ── Carte de résultat ─────────────────────────────────────────────────────
function CarteTicket({ t, classif, onOpen }: { t: Resultat; classif: Classification; onOpen: () => void }) {
  const st = STATUTS[t.statut]
  const produit = [t.modele_ge && `GE ${t.modele_ge}`, t.reference_article && `UI ${t.reference_article}`].filter(Boolean).join(' · ')
  const classifLigne = [libelleClassif(classif, 'symptome', t.symptome), libelleClassif(classif, 'organe', t.organe)].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ textAlign: 'left', borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', padding: '11px 13px', width: '100%', color: '#fff' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13.5, fontWeight: 700 }}>{t.numero}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)' }}>{fmtDate(t.opened_at)}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: st.bg, color: st.tone }}>{st.label}</span>
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {t.intitule_tiers || t.numero_tiers || fmtTel(t.telephone_appelant) || 'Client non identifié'}
        {t.contact_nom ? <span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.5)' }}> · {t.contact_nom}</span> : null}
      </div>
      <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
        {[libelleFiliere(t.filiere), libelleGamme(t.gamme), libelleNature(t.nature)].filter(Boolean).join(' · ')}
        {t.niveau > 1 ? <span style={{ color: '#E8A33D', fontWeight: 700 }}> · N{t.niveau}</span> : null}
      </div>
      {produit || t.code_defaut ? (
        <div style={{ fontSize: 12, color: '#E9E5D6', marginTop: 5, fontFamily: 'var(--font-mono)' }}>
          {produit}
          {t.code_defaut ? <span style={{ color: '#E8A33D' }}>{produit ? ' · ' : ''}code {t.code_defaut}</span> : null}
        </div>
      ) : null}
      {classifLigne || t.issue ? (
        <div style={{ fontSize: 12.5, marginTop: 5 }}>
          <span style={{ color: '#fff' }}>{classifLigne || '—'}</span>
          {t.issue ? <span style={{ color: C_BLEU, fontWeight: 700 }}> → {libelleClassif(classif, 'issue', t.issue)}</span> : null}
        </div>
      ) : null}
      {t.description ? (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {t.description}
        </div>
      ) : null}
    </button>
  )
}

// ── Panneau de choix d'un filtre ──────────────────────────────────────────
function PanneauFiltre({
  cle, titre, valeur, options, compteurs, nonRenseigne, onChoisir, onClose,
}: {
  cle: CleChoix
  titre: string
  valeur: string
  options: Array<{ code: string; libelle: string }>
  compteurs?: Record<string, number>
  nonRenseigne: boolean
  onChoisir: (v: string) => void
  onClose: () => void
}) {
  // Avec compteurs : valeurs présentes dans les résultats d'abord (triées par nombre), puis les autres.
  const lignes = useMemo(() => {
    const base = [...options]
    if (nonRenseigne) base.push({ code: '-', libelle: 'Non renseigné' })
    if (!compteurs || cle === 'statut') return base
    return base
      .map((o, i) => ({ ...o, n: compteurs[o.code] || 0, i }))
      .sort((a, b) => Number(a.code === '-') - Number(b.code === '-') || Number(b.n > 0) - Number(a.n > 0) || b.n - a.n || a.i - b.i)
  }, [options, compteurs, nonRenseigne, cle])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 260, background: 'rgba(6,10,18,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div
        style={{ width: '100%', maxWidth: 520, maxHeight: '78dvh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.1)', padding: '12px 14px 24px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 10px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 8 }}>{titre}</div>
        <LigneChoix libelle="Tous" actif={!valeur} onClick={() => onChoisir('')} />
        {lignes.map((o) => {
          const n = compteurs ? compteurs[o.code] || 0 : null
          return <LigneChoix key={o.code} libelle={o.libelle} n={n} actif={valeur === o.code} attenue={n === 0 && valeur !== o.code} onClick={() => onChoisir(o.code)} />
        })}
      </div>
    </div>
  )
}

function LigneChoix({ libelle, n, actif, attenue, onClick }: { libelle: string; n?: number | null; actif: boolean; attenue?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, textAlign: 'left',
        padding: '11px 12px', marginBottom: 6, borderRadius: 12,
        border: `1px solid ${actif ? C_ACCENT : 'rgba(255,255,255,0.08)'}`,
        background: actif ? 'rgba(75,146,172,0.18)' : 'rgba(255,255,255,0.03)',
        color: attenue ? 'rgba(255,255,255,0.35)' : '#fff', fontSize: 14, fontWeight: actif ? 700 : 500,
      }}
    >
      <span>{libelle}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {n !== null && n !== undefined ? <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums', color: attenue ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.6)' }}>{n.toLocaleString('fr-FR')}</span> : null}
        {actif ? <span style={{ color: C_BLEU }}>✓</span> : null}
      </span>
    </button>
  )
}

function Pastille({ label, actif, onClick }: { label: string; actif: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 999,
        border: `1px solid ${actif ? C_ACCENT : 'rgba(255,255,255,0.15)'}`,
        background: actif ? 'rgba(75,146,172,0.18)' : 'rgba(255,255,255,0.04)',
        color: actif ? C_BLEU : 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: 600,
        maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      {label} ▾
    </button>
  )
}

// ── Fiche ticket (consultation) ───────────────────────────────────────────
function FicheTicketMobile({ id, classif, onClose }: { id: string; classif: Classification; onClose: () => void }) {
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [etapes, setEtapes] = useState<Etape[]>([])
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    let vivant = true
    ;(async () => {
      try {
        const { data, error } = await supabase.from('hotline_tickets').select('*').eq('id', id).maybeSingle()
        if (error) throw error
        if (!vivant) return
        setTicket((data as Ticket) || null)
        const liste = await chargerEtapes(id)
        if (vivant) setEtapes(liste.filter((e) => e.type !== 'CLOTURE' || !String(e.libelle).includes('ancien outil')).reverse())
      } catch (e) {
        if (vivant) setErreur(String((e as { message?: string })?.message || e))
      }
    })()
    return () => {
      vivant = false
    }
  }, [id])

  const t = ticket
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 250, background: 'rgba(6,10,18,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div
        style={{ width: '100%', maxWidth: 560, height: '92dvh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.1)', padding: '12px 16px 28px', color: '#fff' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 10px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700 }}>{t?.numero || '…'}</span>
          <button type="button" onClick={onClose} style={{ border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: '#fff', borderRadius: 10, padding: '8px 12px', fontSize: 14, fontWeight: 600 }}>
            Fermer
          </button>
        </div>
        {erreur ? <div style={{ marginTop: 10, color: '#e0a685', fontSize: 13 }}>{erreur}</div> : null}
        {!t ? (
          !erreur ? <div style={{ marginTop: 16, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Chargement du ticket…</div> : null
        ) : (
          <>
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: STATUTS[t.statut].bg, color: STATUTS[t.statut].tone }}>{STATUTS[t.statut].label}</span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                N{t.niveau} · ouvert le {fmtDateHeure(t.opened_at)}
                {t.resolved_at || t.closed_at ? ` · durée ${fmtDuree(t.opened_at, t.resolved_at || t.closed_at)}` : ''}
              </span>
            </div>

            <Section titre="Appelant">
              <Ligne k="Client" v={[t.intitule_tiers, t.numero_tiers].filter(Boolean).join(' · ')} />
              <Ligne k="Contact" v={t.contact_nom} />
              <Ligne
                k="Téléphone"
                v={t.telephone_appelant ? (
                  <a href={`tel:${String(t.telephone_appelant).replace(/[^\d+]/g, '')}`} style={{ color: C_BLEU, fontWeight: 700 }}>
                    {fmtTel(t.telephone_appelant)}
                  </a>
                ) : null}
              />
              <Ligne k="E-mail" v={t.contact_email} />
              <Ligne k="Chantier" v={t.chantier} />
            </Section>

            <Section titre="Produit">
              <Ligne k="Filière" v={[libelleFiliere(t.filiere), libelleGamme(t.gamme)].filter(Boolean).join(' · ')} />
              <Ligne k="GE" v={[t.modele_ge, t.serie_ge && `n° ${t.serie_ge}`].filter(Boolean).join(' · ')} mono />
              <Ligne k="UI" v={[t.reference_article, t.numero_serie && `n° ${t.numero_serie}`].filter(Boolean).join(' · ')} mono />
              <Ligne k="Mise en service" v={t.date_mes ? fmtDate(t.date_mes) : ''} />
              <Ligne k="Code défaut" v={t.code_defaut} mono />
            </Section>

            <Section titre="Classification" note={t.classif_source === 'AUTO_2026_11' ? 'déduite de l’historique' : undefined}>
              <Ligne k="Nature" v={[libelleNature(t.nature), libelleMotif(t.motif)].filter(Boolean).join(' · ')} />
              <Ligne k="Symptôme" v={libelleClassif(classif, 'symptome', t.symptome)} />
              <Ligne k="Organe" v={libelleClassif(classif, 'organe', t.organe)} />
              <Ligne k="Actions" v={(t.actions || []).map((a) => libelleClassif(classif, 'action', a)).join(', ')} />
              <Ligne k="Issue" v={t.issue ? <span style={{ color: C_BLEU, fontWeight: 700 }}>{libelleClassif(classif, 'issue', t.issue)}</span> : null} />
            </Section>

            {t.description ? (
              <Section titre="Description">
                <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: 'rgba(255,255,255,0.85)' }}>{t.description}</div>
              </Section>
            ) : null}
            {t.preconisation ? (
              <Section titre="Préconisation">
                <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: '#C9E8D0' }}>{t.preconisation}</div>
              </Section>
            ) : null}

            <Section titre={`Chronologie (${etapes.length})`}>
              {etapes.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderLeft: '2px solid rgba(235,216,174,0.35)', paddingLeft: 10 }}>
                  {etapes.map((e) => (
                    <div key={e.id} style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                        {fmtDateHeure(e.at)} · {String(e.auteur || '').split('@')[0]}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>
                        <span style={{ fontWeight: 700, color: '#E9E5D6' }}>{ETAPE_LIBELLES[e.type] || e.type}</span>{' '}
                        <span style={{ color: 'rgba(255,255,255,0.75)' }}>{String(e.libelle).replace(/^Diagnostic : /, '')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)' }}>Aucune étape.</div>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

function Section({ titre, note, children }: { titre: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ ...titreGroupe, display: 'flex', justifyContent: 'space-between' }}>
        {titre}
        {note ? <span style={{ textTransform: 'none', letterSpacing: 0, color: C_BLEU, fontWeight: 600 }}>{note}</span> : null}
      </div>
      <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {children}
      </div>
    </div>
  )
}

function Ligne({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 13.5, lineHeight: 1.4 }}>
      <span style={{ width: 108, flexShrink: 0, color: 'rgba(255,255,255,0.45)', fontSize: 12.5 }}>{k}</span>
      <span style={{ minWidth: 0, color: v ? '#fff' : 'rgba(255,255,255,0.3)', fontFamily: mono && v ? 'var(--font-mono)' : undefined, wordBreak: 'break-word' }}>{v || '—'}</span>
    </div>
  )
}

const champStyle: React.CSSProperties = {
  width: '100%', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)',
  color: '#fff', padding: '11px 12px', fontSize: 15, fontFamily: 'var(--font-body)', outline: 'none',
}

const titreGroupe: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: 6, padding: '0 2px',
}
