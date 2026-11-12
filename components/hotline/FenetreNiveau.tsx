'use client'

/**
 * Escalade / retour de niveau d'un ticket hotline (12/11/2026).
 *
 * - Escalade au N2 : choix OBLIGATOIRE d'un collaborateur de fonction N2 ; le
 *   N2 proposé par défaut est celui dont les départements couvrent celui du
 *   client (RPC hotline_collaborateurs). Escalade au N3 : choix obligatoire dès
 *   qu'un collaborateur N3 est déclaré.
 * - Retour au niveau inférieur (N2 → N1, N3 → N2) : collaborateur facultatif.
 * Fonction hotline et départements : écran Autorisations › Utilisateurs.
 */

import { useEffect, useMemo, useState } from 'react'
import type { Collaborateurs, Destinataire } from '@/lib/hotline'

export default function FenetreNiveau({
  mode,
  niveau,
  collaborateurs,
  motifInitial = '',
  busy,
  onValider,
  onFermer,
}: {
  mode: 'escalade' | 'redescente'
  niveau: number
  collaborateurs: Collaborateurs
  motifInitial?: string
  busy?: boolean
  onValider: (v: { destinataire: Destinataire; motif: string }) => void
  onFermer: () => void
}) {
  const cible = mode === 'escalade' ? Math.min(3, niveau + 1) : Math.max(1, niveau - 1)
  const candidats = useMemo(() => collaborateurs.liste.filter((c) => c.niveau === cible), [collaborateurs, cible])
  const parDefaut = candidats.find((c) => c.par_defaut) || (candidats.length === 1 ? candidats[0] : null)
  const [email, setEmail] = useState(parDefaut?.email || '')
  const [motif, setMotif] = useState(motifInitial)
  const obligatoire = mode === 'escalade' && (cible === 2 || candidats.length > 0)

  useEffect(() => {
    const touche = (e: KeyboardEvent) => e.key === 'Escape' && onFermer()
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [onFermer])

  const choisi = candidats.find((c) => c.email === email) || null
  const valide = !obligatoire || Boolean(choisi)
  const titre = mode === 'escalade' ? `Escalader au niveau ${cible}` : `Redescendre le ticket au niveau ${cible}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(6,10,18,0.55)] p-4" onClick={onFermer}>
      <div className="w-full max-w-[520px] rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#EFEDE8] px-5 py-3">
          <div className="text-[15px] font-bold text-slate-900">{titre}</div>
          <button type="button" onClick={onFermer} className="text-[13px] font-semibold text-slate-500 hover:text-slate-900">
            Fermer ✕
          </button>
        </div>
        <div className="space-y-3 p-5">
          <label className="block text-[11px] font-semibold text-slate-500">
            {mode === 'escalade' ? `Collaborateur N${cible}${obligatoire ? ' (obligatoire)' : ''}` : `Collaborateur N${cible} (facultatif)`}
            <select
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              className={`h-10 w-full rounded-lg border bg-white px-2.5 text-[13px] text-slate-900 outline-none focus:border-[#B4761A] ${obligatoire && !choisi ? 'border-[#C1683C]' : 'border-[#D8D3C8]'}`}
            >
              <option value="">{obligatoire ? 'Choisir le collaborateur…' : '— Aucun en particulier —'}</option>
              {candidats.map((c) => (
                <option key={c.email} value={c.email}>
                  {c.nom}
                  {c.departements.length ? ` · dép. ${c.departements.join(', ')}` : ''}
                  {c.par_defaut ? ' · département du client' : ''}
                </option>
              ))}
            </select>
          </label>
          {mode === 'escalade' && cible === 2 ? (
            <p className="text-[12px] text-slate-500">
              {collaborateurs.departement
                ? parDefaut?.par_defaut
                  ? `Client du département ${collaborateurs.departement} : ${parDefaut.nom} est proposé par défaut.`
                  : `Aucun N2 n’est rattaché au département ${collaborateurs.departement} du client.`
                : 'Département du client inconnu (client non identifié ou sans code postal).'}
            </p>
          ) : null}
          {!candidats.length ? (
            <p className="rounded-lg border border-[#EBD8AE] bg-[#FDF7EA] px-3 py-2 text-[12px] text-[#6B470E]">
              Aucun collaborateur n’a la fonction hotline N{cible}. Elle se déclare dans Autorisations › Utilisateurs › Hotline.
            </p>
          ) : null}
          <label className="block text-[11px] font-semibold text-slate-500">
            {mode === 'escalade' ? 'Motif de l’escalade' : 'Consigne pour le niveau ' + cible}
            <textarea
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-[#D8D3C8] bg-white px-2.5 py-2 text-[13px] text-slate-900 outline-none focus:border-[#B4761A]"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#EFEDE8] px-5 py-3">
          <button type="button" onClick={onFermer} className="rounded-lg border border-[#D8D3C8] px-4 py-2 text-[13px] font-semibold text-slate-700">
            Annuler
          </button>
          <button
            type="button"
            disabled={busy || !valide}
            onClick={() => onValider({ destinataire: choisi ? { email: choisi.email, nom: choisi.nom } : null, motif: motif.trim() })}
            className={`rounded-lg px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40 ${mode === 'escalade' ? 'bg-[#C1683C]' : 'bg-[#1E4E8C]'}`}
          >
            {busy ? '…' : mode === 'escalade' ? `Escalader au N${cible}` : `Redescendre au N${cible}`}
          </button>
        </div>
      </div>
    </div>
  )
}
