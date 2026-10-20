'use client'

// ============================================================================
// components/mobile/MobilePromesseActionSheet.tsx
// ----------------------------------------------------------------------------
// (2026-10-20) Saisie de l'action + commentaire sur une CDC à date de
// livraison interdite, depuis l'alerte mobile. Même règles que le panneau PC
// (lib/cdcPromesses.ts) : décaler la date / déprioriser une autre CDC (liste
// d'aide) / autre ; commentaire obligatoire ; vérification à la synchro.
// ============================================================================

import { useEffect, useState } from 'react'
import {
  ACTION_INFO,
  VERDICT_INFO,
  enregistrerAction,
  fetchPromesseCandidats,
  formatDateCourte,
  supprimerAction,
  verifierSaisie,
  type PromesseAction,
  type PromesseCandidat,
  type PromesseCommande,
} from '@/lib/cdcPromesses'

const champ: React.CSSProperties = {
  width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5, boxSizing: 'border-box',
}

export default function MobilePromesseActionSheet({
  commande, userEmail, userName, onClose, onSaved,
}: {
  commande: PromesseCommande
  userEmail: string
  userName: string
  onClose: () => void
  onSaved: () => void
}) {
  const [action, setAction] = useState<PromesseAction>(commande.action || 'decaler')
  const [nouvelleDate, setNouvelleDate] = useState(commande.nouvelle_date || commande.date_proposee || '')
  const [cdcDepriorisee, setCdcDepriorisee] = useState(commande.cdc_depriorisee || '')
  const [commentaire, setCommentaire] = useState(commande.commentaire || '')
  const [candidats, setCandidats] = useState<PromesseCandidat[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [erreur, setErreur] = useState('')

  useEffect(() => {
    if (action !== 'deprioriser' || candidats !== null) return
    let alive = true
    fetchPromesseCandidats(commande.numero_document)
      .then((rows) => { if (alive) setCandidats(rows) })
      .catch((e) => { if (alive) { setCandidats([]); setErreur(`Liste d’aide indisponible : ${e?.message || e}`) } })
    return () => { alive = false }
  }, [action, candidats, commande.numero_document])

  async function enregistrer() {
    const saisie = { action, nouvelleDate: nouvelleDate || null, cdcDepriorisee: cdcDepriorisee || null, commentaire }
    const err = verifierSaisie(saisie, commande)
    if (err) { setErreur(err); return }
    setSaving(true)
    setErreur('')
    try {
      await enregistrerAction(commande.numero_document, saisie, { email: userEmail, nom: userName })
      onSaved()
    } catch (e: any) {
      setErreur(e?.message || String(e))
      setSaving(false)
    }
  }

  async function supprimer() {
    if (!window.confirm('Supprimer l’action saisie ?')) return
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 260, background: 'rgba(6,10,18,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => !saving && onClose()}>
      <div
        style={{ width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.08)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 4px' }} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Traiter {commande.numero_document}</div>
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
            {commande.nom_tiers} · promise le {formatDateCourte(commande.echeance)} · <span style={{ color: '#8fd4a8', fontWeight: 700 }}>date proposée {commande.date_proposee ? `${formatDateCourte(commande.date_proposee)}${commande.via_appro ? ' (si appro lancé aujourd’hui)' : ''}` : commande.arret_appro ? 'aucune (arrêt appro)' : 'aucune'}</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
            {commande.lignes.map((l) => `${l.reference_article} (${VERDICT_INFO[l.verdict].court}, ${Math.round(l.q_manque)} p.)`).join(' · ')}
          </div>
        </div>

        {(Object.keys(ACTION_INFO) as PromesseAction[]).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => { setAction(a); setErreur('') }}
            style={{
              textAlign: 'left', padding: '11px 12px', borderRadius: 12,
              border: action === a ? '1px solid #A6A181' : '1px solid rgba(255,255,255,0.10)',
              background: action === a ? 'rgba(166,161,129,0.16)' : 'rgba(255,255,255,0.03)', color: '#fff',
            }}
          >
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>{action === a ? '● ' : '○ '}{ACTION_INFO[a].label}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{ACTION_INFO[a].aide}</div>
          </button>
        ))}

        {action === 'decaler' && (
          <div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Nouvelle date de livraison</div>
            <input type="date" value={nouvelleDate} onChange={(e) => setNouvelleDate(e.target.value)} style={champ} />
            {commande.date_proposee && nouvelleDate && nouvelleDate < commande.date_proposee && (
              <div style={{ fontSize: 12, color: '#E0A961', marginTop: 4 }}>Avant la date proposée : la date restera probablement interdite.</div>
            )}
          </div>
        )}

        {action === 'deprioriser' && (
          <div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Commande à déprioriser (elle devra prendre une date tenable dans SAGE / BLG)</div>
            <input value={cdcDepriorisee} onChange={(e) => setCdcDepriorisee(e.target.value.toUpperCase())} placeholder="N° de CDC" style={{ ...champ, fontFamily: 'var(--font-mono)' }} />
            <div style={{ marginTop: 8, borderRadius: 10, border: '1px solid rgba(255,255,255,0.10)', maxHeight: 240, overflowY: 'auto' }}>
              {candidats === null && <div style={{ padding: 10, fontSize: 12.5, color: 'rgba(255,255,255,0.45)' }}>Chargement de la liste d’aide…</div>}
              {candidats !== null && candidats.length === 0 && <div style={{ padding: 10, fontSize: 12.5, color: 'rgba(255,255,255,0.45)' }}>Aucune commande candidate dans votre périmètre.</div>}
              {(candidats || []).map((k) => (
                <button
                  key={k.numero_document}
                  type="button"
                  onClick={() => setCdcDepriorisee(k.numero_document)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '9px 10px', border: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#fff',
                    background: cdcDepriorisee.toUpperCase() === k.numero_document.toUpperCase() ? 'rgba(75,146,172,0.22)' : 'transparent',
                  }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                    {k.numero_document}
                    {k.meme_representant && <span style={{ marginLeft: 6, fontSize: 10.5, color: '#8fd4a8' }}>mon portefeuille</span>}
                    <span style={{ float: 'right', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>liv. {formatDateCourte(k.date_livraison)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{k.nom_tiers} · {k.references_communes} · {Math.round(k.quantite)} p.</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Commentaire (obligatoire)</div>
          <textarea
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            rows={3}
            placeholder="Ex. : client prévenu, accepte une livraison le…"
            style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: 10, fontSize: 14.5, resize: 'vertical', boxSizing: 'border-box' }}
          />
        </div>

        {erreur && <div style={{ fontSize: 13, color: '#e0a685' }}>{erreur}</div>}

        <button type="button" onClick={() => void enregistrer()} disabled={saving} style={{ padding: 13, borderRadius: 12, border: 'none', background: '#A6A181', color: '#141A26', fontSize: 14.5, fontWeight: 700 }}>
          {saving ? 'Enregistrement…' : 'Enregistrer l’action'}
        </button>
        {commande.action && (
          <button type="button" onClick={() => void supprimer()} disabled={saving} style={{ padding: 11, borderRadius: 12, border: '1px solid rgba(193,104,60,0.45)', background: 'transparent', color: '#e0a685', fontSize: 13, fontWeight: 600 }}>
            Supprimer l’action
          </button>
        )}
        <button type="button" onClick={() => !saving && onClose()} style={{ padding: 11, borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}>
          Annuler
        </button>
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)' }}>
          L’action ne modifie pas SAGE : faites la modification dans SAGE / BLG ; la vérification se fait à la synchro suivante.
        </div>
      </div>
    </div>
  )
}
