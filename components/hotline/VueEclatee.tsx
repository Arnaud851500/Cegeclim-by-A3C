'use client'

/**
 * Vue éclatée interactive — Hotline technique (04/11/2026).
 *
 * Fenêtre plein écran ouverte depuis la console d'appel :
 *  - depuis une ligne produit d'un dossier de vente (référence ayant une vue),
 *  - depuis le champ « Modèle / référence article »,
 *  - depuis un document de parcours de type VUE_ECLATEE (url « vue:<réf> »).
 * Chaque repère du dessin est cliquable (sur le numéro et sur la pièce) ; la
 * fiche de la pièce donne sa référence, la lecture du stock, la demande
 * d'envoi au SAV (enregistrée dans le ticket) et la préparation d'un mail au pro.
 * Données : hotline_vues_eclatees / hotline_vue_pieces ; une vue marquée
 * « simulation » affiche un bandeau Démonstration (références et stocks fictifs).
 */

import { useEffect, useMemo, useState } from 'react'
import { chargerDemandesPieces, chargerVue, demanderPiece, fmtDateHeure, fmtEuro, messageErreur, type DemandePiece, type DocumentLien, type PieceVue, type VueEclatee as Vue } from '@/lib/hotline'

type Client = {
  numeroTiers: string
  intitule: string
  contact: string
  email: string
  chantier: string
}

type LectureStock = { etat: 'idle' | 'lecture' | 'lu'; pour: string | null }

const AMBRE = '#B4761A'

export default function VueEclatee({
  reference,
  ticketId,
  ticketNumero,
  client,
  onFermer,
  onMail,
  onDemande,
}: {
  reference: string
  ticketId: string | null
  ticketNumero?: string | null
  client: Client
  onFermer: () => void
  onMail: (doc: DocumentLien) => void
  onDemande?: (texte: string) => void
}) {
  const [vue, setVue] = useState<Vue | null>(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [choisi, setChoisi] = useState<string | null>(null)
  const [survol, setSurvol] = useState<string | null>(null)
  const [filtre, setFiltre] = useState('')
  const [stock, setStock] = useState<LectureStock>({ etat: 'idle', pour: null })
  const [quantite, setQuantite] = useState(1)
  const [commentaire, setCommentaire] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [demandes, setDemandes] = useState<DemandePiece[]>([])

  useEffect(() => {
    let actif = true
    chargerVue(reference)
      .then((v) => {
        if (!actif) return
        setVue(v)
        if (!v) setErreur(`Aucune vue éclatée pour ${reference}.`)
      })
      .catch((e) => actif && setErreur(messageErreur(e)))
      .finally(() => actif && setChargement(false))
    return () => {
      actif = false
    }
  }, [reference])

  useEffect(() => {
    if (!ticketId) return
    let actif = true
    chargerDemandesPieces(ticketId)
      .then((d) => actif && setDemandes(d))
      .catch(() => undefined)
    return () => {
      actif = false
    }
  }, [ticketId])

  useEffect(() => {
    const touche = (e: KeyboardEvent) => e.key === 'Escape' && onFermer()
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [onFermer])

  const pieces = useMemo(() => vue?.pieces || [], [vue])
  const piece = pieces.find((p) => p.id === choisi) || null
  const visibles = useMemo(() => {
    const f = filtre.trim().toLowerCase()
    if (!f) return pieces
    return pieces.filter((p) => [p.repere, p.libelle, p.reference_piece].some((v) => String(v || '').toLowerCase().includes(f)))
  }, [pieces, filtre])

  function choisir(p: PieceVue) {
    setChoisi(p.id)
    setStock({ etat: 'idle', pour: null })
    setQuantite(1)
    setCommentaire('')
    setConfirmation(null)
  }

  function lireStock() {
    if (!piece) return
    setStock({ etat: 'lecture', pour: piece.id })
    window.setTimeout(() => setStock({ etat: 'lu', pour: piece.id }), 700)
  }

  async function demander() {
    if (!vue || !piece || !ticketId) return
    setEnvoi(true)
    setErreur(null)
    try {
      const d = await demanderPiece({
        ticketId,
        vue,
        piece,
        quantite,
        numeroTiers: client.numeroTiers,
        intituleTiers: client.intitule,
        chantier: client.chantier,
        destinataire: [client.intitule, client.contact].filter(Boolean).join(' — '),
        commentaire,
      })
      setDemandes((l) => [d, ...l])
      const texte = `Demande d’envoi transmise au SAV : ${quantite} × ${piece.libelle} (repère ${piece.repere}) pour ${client.intitule || 'le client'}${vue.simulation ? ' — simulation' : ''}.`
      setConfirmation(texte)
      onDemande?.(texte)
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setEnvoi(false)
    }
  }

  function preparerMail() {
    if (!vue || !piece) return
    const lu = stock.etat === 'lu' && stock.pour === piece.id
    const dispo = (piece.stock_fms || 0) + (piece.stock_agence || 0)
    const lignes = [
      `Bonjour${client.contact ? ` ${client.contact}` : ''},`,
      '',
      `Suite à votre appel${ticketNumero ? ` (ticket ${ticketNumero})` : ''}${client.chantier ? ` concernant le chantier ${client.chantier}` : ''}, voici la pièce identifiée sur la vue éclatée du ${vue.reference_article} (jointe) :`,
      '',
      `  • Repère ${piece.repere} — ${piece.libelle}`,
      `  • Référence pièce : ${piece.reference_piece || 'à confirmer'}`,
      `  • Quantité : ${quantite}`,
      lu ? `  • Disponibilité : ${dispo > 0 ? 'en stock, expédition sous 24/48 h' : `réapprovisionnement en cours${piece.delai_reappro ? ` (délai ${piece.delai_reappro})` : ''}`}` : '',
      '',
      'Merci de nous confirmer l’adresse de livraison si elle diffère de celle du chantier.',
      '',
      'Cordialement,',
      'Hotline technique CEGECLIM',
    ].filter((l, i, t) => l !== '' || t[i - 1] !== '')
    const url = typeof window !== 'undefined' ? new URL(vue.image_url, window.location.origin).toString() : vue.image_url
    onMail({
      titre: `${vue.reference_article} — repère ${piece.repere} ${piece.libelle}`,
      type: 'PNG',
      url,
      message: lignes.join('\n'),
    })
  }

  const actif = survol || choisi
  const pieceActive = pieces.find((p) => p.id === actif) || null
  const ratio = vue ? vue.largeur / vue.hauteur : 1000 / 760

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(6,10,18,0.6)] p-3" onClick={onFermer}>
      <div className="flex h-[94vh] w-full max-w-[1600px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EFEDE8] px-5 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#B4761A]">Vue éclatée interactive</div>
            <div className="truncate text-[18px] font-bold text-slate-900">{vue?.titre || reference}</div>
          </div>
          <div className="flex items-center gap-3">
            {vue?.simulation ? (
              <span className="rounded-full border border-[#EBD8AE] bg-[#FDF7EA] px-3 py-1 text-[11px] font-bold text-[#8A5A11]" title="Nomenclature, références, prix et stocks fictifs pour la démonstration">
                DÉMONSTRATION — données simulées
              </span>
            ) : null}
            <button type="button" onClick={onFermer} className="h-9 rounded-lg border border-[#D8D3C8] px-3 text-[13px] font-semibold text-slate-700 hover:border-[#B4761A]">
              Fermer
            </button>
          </div>
        </div>

        {erreur ? <div className="border-b border-[#F0C5BE] bg-[#FCEFEC] px-5 py-2 text-[13px] text-[#7F1D1D]">{erreur}</div> : null}

        <div className="flex min-h-0 flex-1">
          {/* Dessin */}
          <div className="flex min-w-0 flex-1 items-center justify-center bg-[#FAF9F7] p-4">
            {chargement ? (
              <div className="text-[13px] text-slate-500">Chargement de la vue…</div>
            ) : vue ? (
              <div className="relative" style={{ width: `min(100%, calc((94vh - 120px) * ${ratio}))`, aspectRatio: `${vue.largeur} / ${vue.hauteur}` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={vue.image_url} alt={vue.titre} className="block h-full w-full select-none rounded-lg bg-white" draggable={false} />
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {pieceActive ? (
                    <line
                      x1={pieceActive.label_x}
                      y1={pieceActive.label_y}
                      x2={pieceActive.cible_x}
                      y2={pieceActive.cible_y}
                      stroke={AMBRE}
                      strokeWidth={0.5}
                      vectorEffect="non-scaling-stroke"
                      style={{ strokeWidth: 3 }}
                      strokeLinecap="round"
                    />
                  ) : null}
                </svg>
                {pieces.map((p) => {
                  const on = p.id === actif
                  const sel = p.id === choisi
                  return (
                    <div key={p.id}>
                      <button
                        type="button"
                        title={`${p.repere} — ${p.libelle}`}
                        onClick={() => choisir(p)}
                        onMouseEnter={() => setSurvol(p.id)}
                        onMouseLeave={() => setSurvol(null)}
                        className="absolute flex h-[22px] min-w-[22px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border px-1 text-[11px] font-bold leading-none shadow-sm transition"
                        style={{
                          left: `${p.label_x}%`,
                          top: `${p.label_y}%`,
                          background: sel ? AMBRE : on ? '#FDF2DD' : 'rgba(255,255,255,0.92)',
                          color: sel ? '#fff' : '#5A3810',
                          borderColor: AMBRE,
                          zIndex: on ? 3 : 2,
                        }}
                      >
                        {p.repere}
                      </button>
                      <button
                        type="button"
                        aria-label={`Pièce ${p.repere}`}
                        title={`${p.repere} — ${p.libelle}`}
                        onClick={() => choisir(p)}
                        onMouseEnter={() => setSurvol(p.id)}
                        onMouseLeave={() => setSurvol(null)}
                        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
                        style={{ left: `${p.cible_x}%`, top: `${p.cible_y}%`, width: 22, height: 22, zIndex: on ? 3 : 1 }}
                      >
                        {on ? <span className="absolute inset-0 animate-ping rounded-full" style={{ background: 'rgba(180,118,26,0.45)' }} /> : null}
                        <span
                          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
                          style={{ width: on ? 14 : 9, height: on ? 14 : 9, background: AMBRE, opacity: on ? 1 : 0.55 }}
                        />
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>

          {/* Fiche et liste des pièces */}
          <aside className="flex w-[400px] shrink-0 flex-col border-l border-[#EFEDE8]">
            {piece ? (
              <div className="space-y-3 border-b border-[#EFEDE8] p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 min-w-10 items-center justify-center rounded-lg px-2 text-[16px] font-bold text-white" style={{ background: AMBRE }}>
                    {piece.repere}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[16px] font-bold leading-tight text-slate-900">{piece.libelle}</div>
                    <div className="mt-0.5 font-mono text-[12px] text-slate-600">{piece.reference_piece || 'Référence à confirmer'}</div>
                    {piece.prix_ht !== null ? <div className="text-[12px] text-slate-500">Prix HT indicatif : {fmtEuro(piece.prix_ht)}</div> : null}
                  </div>
                </div>

                <div className="rounded-lg border border-[#E2DFD8] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">Stock</span>
                    <button
                      type="button"
                      onClick={lireStock}
                      disabled={stock.etat === 'lecture'}
                      className="rounded-md bg-[#0B1220] px-2.5 py-1 text-[12px] font-semibold text-white disabled:opacity-60"
                    >
                      {stock.etat === 'lecture' && stock.pour === piece.id ? 'Lecture…' : stock.etat === 'lu' && stock.pour === piece.id ? 'Relire' : 'Lire le stock'}
                    </button>
                  </div>
                  {stock.etat === 'lu' && stock.pour === piece.id ? (
                    <BlocStock piece={piece} simulation={Boolean(vue?.simulation)} />
                  ) : (
                    <p className="mt-2 text-[12px] text-slate-500">Lire le stock du dépôt central (FMS) et de l’agence avant de proposer l’envoi.</p>
                  )}
                </div>

                <div className="rounded-lg border border-[#E2DFD8] p-3">
                  <div className="text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">Envoi de la pièce au pro</div>
                  <div className="mt-1 text-[12px] text-slate-700">
                    {client.intitule ? (
                      <>
                        <span className="font-semibold">{client.intitule}</span>
                        {client.contact ? ` — ${client.contact}` : ''}
                        {client.chantier ? <div className="text-slate-500">Chantier {client.chantier}</div> : null}
                      </>
                    ) : (
                      <span className="text-[#8A5A11]">Identifier l’appelant dans la console pour préremplir le destinataire.</span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-[12px] font-semibold text-slate-500">Quantité</label>
                    <input
                      type="number"
                      min={1}
                      value={quantite}
                      onChange={(e) => setQuantite(Math.max(1, Number(e.target.value) || 1))}
                      className="h-8 w-16 rounded-md border border-[#D8D3C8] px-2 text-[13px]"
                    />
                  </div>
                  <textarea
                    value={commentaire}
                    onChange={(e) => setCommentaire(e.target.value)}
                    rows={2}
                    placeholder="Précision pour le SAV (adresse, urgence…)"
                    className="mt-2 w-full rounded-md border border-[#D8D3C8] px-2 py-1.5 text-[12px] outline-none focus:border-[#B4761A]"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={demander}
                      disabled={envoi || !ticketId}
                      title={ticketId ? 'Enregistre la demande dans le ticket et la transmet au SAV' : 'Ouvrir le ticket pour pouvoir demander l’envoi'}
                      className="rounded-md bg-[#C1683C] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
                    >
                      {envoi ? 'Transmission…' : 'Demander l’envoi au SAV'}
                    </button>
                    <button type="button" onClick={preparerMail} className="rounded-md border border-[#D8D3C8] px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:border-[#B4761A]">
                      Préparer un mail au pro
                    </button>
                  </div>
                  {!ticketId ? <div className="mt-1.5 text-[11px] text-[#8A5A11]">Ouvrir le ticket dans la console pour enregistrer la demande.</div> : null}
                  {confirmation ? <div className="mt-2 rounded-md bg-[#EEF7EF] px-2 py-1.5 text-[12px] text-[#2F6B3A]">{confirmation}</div> : null}
                </div>
              </div>
            ) : (
              <div className="border-b border-[#EFEDE8] p-4 text-[13px] text-slate-600">
                Cliquer un <span className="font-semibold">repère</span> sur le dessin (le numéro ou le point sur la pièce), ou une pièce dans la liste.
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
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {visibles.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => choisir(p)}
                    onMouseEnter={() => setSurvol(p.id)}
                    onMouseLeave={() => setSurvol(null)}
                    className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-[12px] ${p.id === choisi ? 'bg-[#FDF2DD]' : 'hover:bg-[#FAF9F7]'}`}
                  >
                    <span className="w-9 shrink-0 text-right font-bold text-[#8A5A11]">{p.repere}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-800">{p.libelle}</span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-400">{p.reference_piece}</span>
                  </button>
                </li>
              ))}
            </ul>

            {demandes.length ? (
              <div className="max-h-[150px] overflow-y-auto border-t border-[#EFEDE8] px-4 py-2">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.05em] text-slate-500">Demandes de pièces du ticket</div>
                {demandes.map((d) => (
                  <div key={d.id} className="text-[11px] text-slate-600">
                    {fmtDateHeure(d.demande_le)} · {d.quantite} × {d.libelle} ·{' '}
                    <span className={d.statut === 'EXPEDIEE' ? 'font-semibold text-[#2F6B3A]' : d.statut === 'ANNULEE' ? 'text-slate-400' : 'font-semibold text-[#8A5A11]'}>
                      {d.statut === 'EXPEDIEE' ? 'expédiée' : d.statut === 'ANNULEE' ? 'annulée' : 'demandée au SAV'}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  )
}

function BlocStock({ piece, simulation }: { piece: PieceVue; simulation: boolean }) {
  const fms = piece.stock_fms || 0
  const agence = piece.stock_agence || 0
  const dispo = fms + agence > 0
  return (
    <div className="mt-2 space-y-1.5 text-[12px]">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md bg-[#FAF9F7] px-2 py-1.5">
          <div className="text-[10px] font-semibold uppercase text-slate-400">Dépôt central FMS</div>
          <div className={`text-[16px] font-bold ${fms > 0 ? 'text-[#2F6B3A]' : 'text-[#A32C2C]'}`}>{fms}</div>
        </div>
        <div className="rounded-md bg-[#FAF9F7] px-2 py-1.5">
          <div className="text-[10px] font-semibold uppercase text-slate-400">Agence</div>
          <div className={`text-[16px] font-bold ${agence > 0 ? 'text-[#2F6B3A]' : 'text-slate-500'}`}>{agence}</div>
        </div>
      </div>
      <div className={`rounded-md px-2 py-1.5 font-semibold ${dispo ? 'bg-[#EEF7EF] text-[#2F6B3A]' : 'bg-[#FCEFEC] text-[#A32C2C]'}`}>
        {dispo ? 'Disponible : expédition possible sous 24/48 h' : `Rupture${piece.delai_reappro ? ` — réapprovisionnement sous ${piece.delai_reappro}` : ''}`}
      </div>
      {simulation ? <div className="text-[10px] text-[#8A5A11]">Lecture simulée (démonstration) — non reliée au stock SAGE.</div> : null}
    </div>
  )
}
