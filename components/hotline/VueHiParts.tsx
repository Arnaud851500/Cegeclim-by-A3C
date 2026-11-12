'use client'

/**
 * Vue éclatée Hi-Parts — Hotline Thermie (12/11/2026).
 *
 * Ouverte depuis la console d'appel à partir du modèle GE ou UI saisi : retrouve
 * le modèle dans la copie locale du catalogue Hitachi Hi-Parts (lib/hiparts.ts),
 * affiche ses planches (image hébergée par Hi-Parts + repères cliquables) et la
 * nomenclature avec le prix HT. « Ajouter au ticket » reporte la référence, la
 * désignation, le repère et le prix dans le corps du ticket.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  avancementHiParts,
  chargerSchemaHiParts,
  chargerSchemasHiParts,
  chercherModelesHiParts,
  imageHiParts,
  ligneTicketHiParts,
  lienProduitHiParts,
  lienSchemaHiParts,
  type HiPartsAvancement,
  type HiPartsPiece,
  type HiPartsProduit,
  type HiPartsSchema,
} from '@/lib/hiparts'

const ROUGE = '#C8102E' // repères Hi-Parts
const AMBRE = '#B4761A'

function euro(v: number | null) {
  return v === null ? '—' : v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

export default function VueHiParts({
  modele,
  unite,
  onFermer,
  onAjouter,
}: {
  modele: string
  unite: 'GE' | 'UI'
  onFermer: () => void
  onAjouter: (texte: string) => Promise<void> | void
}) {
  const [recherche, setRecherche] = useState(modele)
  const [produits, setProduits] = useState<HiPartsProduit[] | null>(null)
  const [produit, setProduit] = useState<HiPartsProduit | null>(null)
  const [schemas, setSchemas] = useState<HiPartsSchema[]>([])
  const [schema, setSchema] = useState<HiPartsSchema | null>(null)
  const [pieces, setPieces] = useState<HiPartsPiece[]>([])
  const [chargement, setChargement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [choisie, setChoisie] = useState<number | null>(null)
  const [survol, setSurvol] = useState<number | null>(null)
  const [filtre, setFiltre] = useState('')
  const [quantite, setQuantite] = useState(1)
  const [ajoutees, setAjoutees] = useState<string[]>([])
  const [ajoutEnCours, setAjoutEnCours] = useState(false)
  const [taille, setTaille] = useState<{ l: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [avancement, setAvancement] = useState<HiPartsAvancement | null>(null)
  const listeRef = useRef<HTMLUListElement>(null)

  // Recherche du modèle (saisie libre, temporisée)
  useEffect(() => {
    let actif = true
    const t = window.setTimeout(() => {
      chercherModelesHiParts(recherche)
        .then((l) => {
          if (!actif) return
          setProduits(l)
          setProduit((p) => (p && l.some((x) => x.idgam === p.idgam) ? p : l.find((x) => x.exact) || (l.length === 1 ? l[0] : null)))
        })
        .catch((e) => actif && setErreur(String(e?.message || e)))
    }, 250)
    return () => {
      actif = false
      window.clearTimeout(t)
    }
  }, [recherche])

  useEffect(() => {
    avancementHiParts().then(setAvancement).catch(() => undefined)
  }, [])

  // Planches du modèle
  useEffect(() => {
    if (!produit) {
      setSchemas([])
      setSchema(null)
      return
    }
    let actif = true
    setChargement(true)
    chargerSchemasHiParts(produit.idgam)
      .then((l) => {
        if (!actif) return
        setSchemas(l)
        setSchema(l[0] || null)
      })
      .catch((e) => actif && setErreur(String(e?.message || e)))
      .finally(() => actif && setChargement(false))
    return () => {
      actif = false
    }
  }, [produit])

  // Nomenclature de la planche
  useEffect(() => {
    setPieces([])
    setChoisie(null)
    setTaille(null)
    setZoom(1)
    if (!schema) return
    let actif = true
    chargerSchemaHiParts(schema.idscg)
      .then((p) => actif && setPieces(p))
      .catch((e) => actif && setErreur(String(e?.message || e)))
    return () => {
      actif = false
    }
  }, [schema])

  useEffect(() => {
    const touche = (e: KeyboardEvent) => e.key === 'Escape' && onFermer()
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [onFermer])

  const piece = pieces.find((p) => p.ligne === choisie) || null
  const visibles = useMemo(() => {
    const f = filtre.trim().toLowerCase()
    if (!f) return pieces
    return pieces.filter((p) => [p.repere, p.designation, p.reference].some((v) => String(v || '').toLowerCase().includes(f)))
  }, [pieces, filtre])

  // Points du dessin : un point par position, rattaché à la première ligne du repère
  const points = useMemo(() => {
    const vus = new Set<string>()
    const out: Array<{ cle: string; ligne: number; repere: string; x: number; y: number }> = []
    for (const p of pieces) {
      p.positions.forEach(([x, y], i) => {
        const cle = `${p.repere}-${x}-${y}`
        if (vus.has(cle)) return
        vus.add(cle)
        out.push({ cle: `${cle}-${i}`, ligne: p.ligne, repere: String(p.repere || ''), x, y })
      })
    }
    return out
  }, [pieces])

  const repereActif = pieces.find((p) => p.ligne === (survol ?? choisie))?.repere || null

  function choisir(ligne: number) {
    setChoisie(ligne)
    setQuantite(1)
    window.setTimeout(() => listeRef.current?.querySelector(`[data-ligne="${ligne}"]`)?.scrollIntoView({ block: 'nearest' }), 0)
  }

  async function ajouter() {
    if (!piece || !produit) return
    const texte = ligneTicketHiParts({ piece, produit: produit.nom, schema, quantite })
    setAjoutEnCours(true)
    try {
      await onAjouter(texte)
      setAjoutees((l) => [texte, ...l])
    } catch (e) {
      setErreur(String((e as Error)?.message || e))
    } finally {
      setAjoutEnCours(false)
    }
  }

  const image = imageHiParts(schema?.image_path)
  const enCours = avancement && avancement.a_faire > 0

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(6,10,18,0.6)] p-3" onClick={onFermer}>
      <div className="flex h-[94vh] w-full max-w-[1600px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* En-tête */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EFEDE8] px-5 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: ROUGE }}>
              Hitachi Hi-Parts · vue éclatée {unite}
            </div>
            <div className="truncate text-[18px] font-bold text-slate-900">{produit ? produit.nom : modele || 'Modèle à préciser'}</div>
            {produit?.chemin ? <div className="truncate text-[11px] text-slate-500">{produit.chemin}</div> : null}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Modèle (ex. RAS-4WHVNPE)"
              className="h-9 w-[240px] rounded-lg border border-[#D8D3C8] px-3 text-[13px] outline-none focus:border-[#B4761A]"
            />
            {produit ? (
              <a href={schema ? lienSchemaHiParts(schema.idscg) : lienProduitHiParts(produit)} target="_blank" rel="noreferrer" className="h-9 rounded-lg border border-[#D8D3C8] px-3 py-2 text-[12px] font-semibold text-slate-700 hover:border-[#B4761A]">
                Ouvrir sur Hi-Parts ↗
              </a>
            ) : null}
            <button type="button" onClick={onFermer} className="h-9 rounded-lg border border-[#D8D3C8] px-3 text-[13px] font-semibold text-slate-700 hover:border-[#B4761A]">
              Fermer
            </button>
          </div>
        </div>

        {erreur ? <div className="border-b border-[#F0C5BE] bg-[#FCEFEC] px-5 py-2 text-[13px] text-[#7F1D1D]">{erreur}</div> : null}

        <div className="flex min-h-0 flex-1">
          {/* Choix du modèle quand plusieurs correspondent */}
          {produits && produits.length > 1 ? (
            <aside className="w-[210px] shrink-0 overflow-y-auto border-r border-[#EFEDE8] py-2">
              <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">Modèles trouvés</div>
              {produits.map((p) => (
                <button
                  key={p.idgam}
                  type="button"
                  onClick={() => setProduit(p)}
                  className={`block w-full px-3 py-1.5 text-left text-[12px] ${produit?.idgam === p.idgam ? 'bg-[#FDF2DD] font-bold text-slate-900' : 'text-slate-700 hover:bg-[#FAF9F7]'}`}
                >
                  {p.nom}
                  <span className="block text-[10px] font-normal text-slate-400">
                    {p.type_unite} · {p.nb_schemas} vue{p.nb_schemas > 1 ? 's' : ''}
                  </span>
                </button>
              ))}
            </aside>
          ) : null}

          {/* Dessin */}
          <div className="flex min-w-0 flex-1 flex-col bg-[#FAF9F7]">
            {schemas.length > 1 ? (
              <div className="flex gap-1 overflow-x-auto border-b border-[#EFEDE8] bg-white px-3 py-2">
                {schemas.map((s, i) => (
                  <button
                    key={s.idscg}
                    type="button"
                    onClick={() => setSchema(s)}
                    title={[s.code, s.libelle].filter(Boolean).join(' — ')}
                    className={`shrink-0 rounded-md px-2.5 py-1 text-[12px] font-semibold ${schema?.idscg === s.idscg ? 'bg-[#0B1220] text-white' : 'border border-[#D8D3C8] text-slate-600'}`}
                  >
                    {s.rubrique ? `${s.rubrique} ` : ''}
                    {i + 1}
                    {s.nb_pieces ? <span className="ml-1 opacity-60">({s.nb_pieces})</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="relative min-h-0 flex-1 overflow-auto p-4">
              {!produits ? (
                <div className="text-[13px] text-slate-500">Recherche du modèle…</div>
              ) : !produit ? (
                <MessageVide
                  titre={produits.length ? 'Choisir le modèle dans la liste' : `Aucun modèle Hi-Parts trouvé pour « ${recherche} »`}
                  texte={
                    produits.length
                      ? 'Plusieurs modèles commencent par cette saisie.'
                      : enCours
                        ? 'Le catalogue Hi-Parts est en cours de copie : le modèle apparaîtra au fil de l’eau. Vérifiez aussi l’orthographe du modèle.'
                        : 'Vérifiez le modèle saisi (la recherche ignore espaces, tirets et points).'
                  }
                />
              ) : chargement ? (
                <div className="text-[13px] text-slate-500">Chargement des vues…</div>
              ) : !schema ? (
                <MessageVide
                  titre="Vues éclatées pas encore copiées pour ce modèle"
                  texte={enCours ? 'La copie du catalogue est en cours ; en attendant, ouvrez le modèle directement sur Hi-Parts.' : 'Ce modèle n’a pas de vue éclatée dans Hi-Parts.'}
                  lien={lienProduitHiParts(produit)}
                />
              ) : image ? (
                <div className="mx-auto" style={{ width: `${zoom * 100}%`, maxWidth: taille && zoom === 1 ? `calc((94vh - 170px) * ${taille.l / taille.h})` : undefined }}>
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image}
                      alt={schema.libelle || produit.nom}
                      className="block h-auto w-full select-none rounded-lg bg-white"
                      draggable={false}
                      onLoad={(e) => setTaille({ l: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                    />
                    {taille
                      ? points.map((pt) => {
                          const actif = pt.repere === repereActif
                          const sel = pieces.find((p) => p.ligne === choisie)?.repere === pt.repere
                          return (
                            <button
                              key={pt.cle}
                              type="button"
                              title={`Repère ${pt.repere}`}
                              onClick={() => choisir(pt.ligne)}
                              onMouseEnter={() => setSurvol(pt.ligne)}
                              onMouseLeave={() => setSurvol(null)}
                              className="absolute flex h-[24px] min-w-[24px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 px-1 text-[11px] font-bold leading-none shadow-sm transition"
                              style={{
                                left: `${(pt.x / taille.l) * 100}%`,
                                top: `${(pt.y / taille.h) * 100}%`,
                                background: sel ? ROUGE : actif ? '#FDE7EA' : 'rgba(255,255,255,0.85)',
                                color: sel ? '#fff' : ROUGE,
                                borderColor: ROUGE,
                                zIndex: actif || sel ? 3 : 2,
                                transform: `translate(-50%, -50%) scale(${actif || sel ? 1.25 : 1})`,
                              }}
                            >
                              {pt.repere}
                            </button>
                          )
                        })
                      : null}
                  </div>
                </div>
              ) : (
                <MessageVide titre="Image de la vue indisponible" texte="Ouvrez la vue directement sur Hi-Parts." lien={lienSchemaHiParts(schema.idscg)} />
              )}
              {image ? (
                <div className="sticky bottom-0 left-0 mt-2 flex w-fit gap-1 rounded-lg bg-white/90 p-1 shadow">
                  <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} className="h-7 w-7 rounded border border-[#D8D3C8] text-[14px] font-bold text-slate-700">
                    −
                  </button>
                  <span className="px-1 py-1 text-[11px] text-slate-500">{Math.round(zoom * 100)} %</span>
                  <button type="button" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} className="h-7 w-7 rounded border border-[#D8D3C8] text-[14px] font-bold text-slate-700">
                    +
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {/* Fiche et nomenclature */}
          <aside className="flex w-[420px] shrink-0 flex-col border-l border-[#EFEDE8]">
            {piece ? (
              <div className="space-y-3 border-b border-[#EFEDE8] p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 min-w-10 items-center justify-center rounded-full px-2 text-[16px] font-bold text-white" style={{ background: ROUGE }}>
                    {piece.repere}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[16px] font-bold leading-tight text-slate-900">{piece.designation}</div>
                    <div className="mt-0.5 font-mono text-[13px] text-slate-700">{piece.reference}</div>
                    {piece.ref_remplacement ? <div className="text-[12px] font-semibold text-[#8A5A11]">Remplacée par {piece.ref_remplacement}</div> : null}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <div className="rounded-md bg-[#FAF9F7] px-2 py-1.5">
                    <div className="text-[10px] font-semibold uppercase text-slate-400">Prix unitaire HT Hi-Parts</div>
                    <div className="text-[16px] font-bold text-slate-900">{piece.prix_ht !== null ? euro(piece.prix_ht) : <span className="text-[12px] font-normal text-slate-500">pas encore récupéré</span>}</div>
                  </div>
                  <div className="rounded-md bg-[#FAF9F7] px-2 py-1.5">
                    <div className="text-[10px] font-semibold uppercase text-slate-400">Stock Hitachi</div>
                    <div className="text-[12px] text-slate-700">{piece.stock_info || '—'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[12px] font-semibold text-slate-500">Quantité</label>
                  <input
                    type="number"
                    min={1}
                    value={quantite}
                    onChange={(e) => setQuantite(Math.max(1, Number(e.target.value) || 1))}
                    className="h-8 w-16 rounded-md border border-[#D8D3C8] px-2 text-[13px]"
                  />
                  <button
                    type="button"
                    onClick={ajouter}
                    disabled={ajoutEnCours}
                    className="ml-auto rounded-md bg-[#0B1220] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                  >
                    {ajoutEnCours ? 'Ajout…' : 'Ajouter au ticket'}
                  </button>
                </div>
                {piece.prix_maj_le ? <div className="text-[10px] text-slate-400">Prix relevé le {new Date(piece.prix_maj_le).toLocaleDateString('fr-FR')}</div> : null}
              </div>
            ) : (
              <div className="border-b border-[#EFEDE8] p-4 text-[13px] text-slate-600">
                Cliquer un <span className="font-semibold">repère</span> sur le dessin ou une pièce dans la liste, puis « Ajouter au ticket » : la référence, la désignation et le prix sont ajoutés au motif de l’appel.
              </div>
            )}

            <div className="border-b border-[#EFEDE8] px-4 py-2">
              <input
                value={filtre}
                onChange={(e) => setFiltre(e.target.value)}
                placeholder="Chercher une pièce (repère, nom, référence)"
                className="h-8 w-full rounded-md border border-[#D8D3C8] px-2 text-[12px] outline-none focus:border-[#B4761A]"
              />
            </div>
            <ul ref={listeRef} className="min-h-0 flex-1 overflow-y-auto">
              {visibles.map((p) => (
                <li key={p.ligne} data-ligne={p.ligne}>
                  <button
                    type="button"
                    onClick={() => choisir(p.ligne)}
                    onMouseEnter={() => setSurvol(p.ligne)}
                    onMouseLeave={() => setSurvol(null)}
                    className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-[12px] ${p.ligne === choisie ? 'bg-[#FDE7EA]' : p.repere === repereActif ? 'bg-[#FAF9F7]' : 'hover:bg-[#FAF9F7]'}`}
                  >
                    <span className="w-8 shrink-0 text-right font-bold" style={{ color: ROUGE }}>
                      {p.repere}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-slate-800">{p.designation}</span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-500">{p.reference}</span>
                    <span className="w-[68px] shrink-0 text-right text-[11px] text-slate-700">{euro(p.prix_ht)}</span>
                  </button>
                </li>
              ))}
              {schema && !pieces.length ? <li className="px-4 py-3 text-[12px] text-slate-500">Nomenclature pas encore copiée pour cette vue.</li> : null}
            </ul>

            {ajoutees.length ? (
              <div className="max-h-[140px] overflow-y-auto border-t border-[#EFEDE8] px-4 py-2">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.05em] text-slate-500">Ajouté au ticket</div>
                {ajoutees.map((t, i) => (
                  <div key={i} className="text-[11px] text-[#2F6B3A]">
                    ✓ {t}
                  </div>
                ))}
              </div>
            ) : null}
            {avancement ? (
              <div className="border-t border-[#EFEDE8] px-4 py-1.5 text-[10px] text-slate-400">
                Catalogue copié : {avancement.produits.toLocaleString('fr-FR')} modèles · {avancement.schemas.toLocaleString('fr-FR')} vues · {avancement.prix.toLocaleString('fr-FR')} prix
                {enCours ? ` · copie en cours (${avancement.a_faire.toLocaleString('fr-FR')} pages restantes)` : ''}
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  )
}

function MessageVide({ titre, texte, lien }: { titre: string; texte: string; lien?: string }) {
  return (
    <div className="mx-auto mt-16 max-w-[460px] rounded-xl border border-[#E2DFD8] bg-white p-5 text-center">
      <div className="text-[15px] font-bold text-slate-900">{titre}</div>
      <div className="mt-1 text-[13px] text-slate-500">{texte}</div>
      {lien ? (
        <a href={lien} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-md border border-[#D8D3C8] px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:border-[#B4761A]">
          Ouvrir sur Hi-Parts ↗
        </a>
      ) : null}
      <div className="mt-2 text-[11px]" style={{ color: AMBRE }}>
        Sur Hi-Parts, la session doit être ouverte dans votre navigateur.
      </div>
    </div>
  )
}
