'use client'

// Pièces jointes d'un ticket hotline (03/11/2026) — console d'appel et fiche
// ticket. Trois façons d'ajouter :
//   - « Ajouter des fichiers » ou glisser-déposer depuis le PC (photos, PDF…) ;
//   - glisser un mail depuis la boîte de réception (Outlook le dépose comme un
//     fichier .eml / .msg : objet, expéditeur et date lus quand c'est possible) ;
//   - coller une capture d'écran (Ctrl/Cmd + V) n'importe où sur l'écran.
// Fichiers dans le bucket privé « hotline-pieces », liens temporaires (1 h).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccess } from '@/components/AccessContext'
import {
  ajouterPiece,
  chargerPieces,
  estImage,
  estMail,
  fmtDateHeure,
  fmtTaille,
  liensPieces,
  messageErreur,
  supprimerPiece,
  type OriginePiece,
  type PieceJointe,
} from '@/lib/hotline'

export default function PiecesJointes({ ticketId, onChange, lectureSeule = false }: { ticketId: string; onChange?: () => void; lectureSeule?: boolean }) {
  const { email, rights } = useAccess()
  const expert = Boolean(rights.can_hotline_expert || rights.can_autorisation)
  const [pieces, setPieces] = useState<PieceJointe[]>([])
  const [liens, setLiens] = useState<Record<string, string>>({})
  const [survol, setSurvol] = useState(false)
  const [envoi, setEnvoi] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const charger = useCallback(async () => {
    try {
      const liste = await chargerPieces(ticketId)
      setPieces(liste)
      setLiens(await liensPieces(liste.map((p) => p.chemin)))
    } catch (e) {
      setErreur(messageErreur(e))
    }
  }, [ticketId])

  useEffect(() => {
    let actif = true
    chargerPieces(ticketId)
      .then(async (liste) => {
        const urls = await liensPieces(liste.map((p) => p.chemin))
        if (!actif) return
        setPieces(liste)
        setLiens(urls)
      })
      .catch((e) => actif && setErreur(messageErreur(e)))
    return () => {
      actif = false
    }
  }, [ticketId])

  const deposer = useCallback(
    async (fichiers: File[], origine: OriginePiece) => {
      if (!fichiers.length) return
      setErreur(null)
      for (const f of fichiers) {
        setEnvoi(f.name)
        try {
          await ajouterPiece(ticketId, f, origine)
        } catch (e) {
          setErreur(messageErreur(e))
        }
      }
      setEnvoi(null)
      await charger()
      onChange?.()
    },
    [ticketId, charger, onChange],
  )

  // Capture d'écran collée : seulement si le presse-papiers contient un fichier
  // (le collage de texte dans les champs n'est pas touché).
  useEffect(() => {
    function coller(e: ClipboardEvent) {
      if (lectureSeule) return
      const fichiers = Array.from(e.clipboardData?.files || [])
      if (!fichiers.length) return
      e.preventDefault()
      const horodatage = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      void deposer(
        fichiers.map((f) => (f.name && f.name !== 'image.png' ? f : new File([f], `capture-${horodatage}.png`, { type: f.type || 'image/png' }))),
        'PRESSE_PAPIER',
      )
    }
    window.addEventListener('paste', coller)
    return () => window.removeEventListener('paste', coller)
  }, [deposer, lectureSeule])

  async function retirer(p: PieceJointe) {
    if (!window.confirm(`Retirer « ${p.mail_objet || p.nom} » du ticket ?`)) return
    try {
      await supprimerPiece(p)
      await charger()
      onChange?.()
    } catch (e) {
      setErreur(messageErreur(e))
    }
  }

  return (
    <div className="space-y-2">
      {lectureSeule ? (
        !pieces.length ? <p className="text-[12px] text-slate-500">Aucune pièce jointe.</p> : null
      ) : (
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setSurvol(true)
        }}
        onDragLeave={() => setSurvol(false)}
        onDrop={(e) => {
          e.preventDefault()
          setSurvol(false)
          const fichiers = Array.from(e.dataTransfer.files || [])
          if (!fichiers.length) {
            setErreur(
              'Rien à déposer : cette messagerie ne fournit pas le mail comme fichier. Dans Outlook, enregistrez le mail (Fichier › Enregistrer sous) puis déposez le fichier ici.',
            )
            return
          }
          void deposer(fichiers, 'PC')
        }}
        className={`rounded-xl border-2 border-dashed px-4 py-3 text-center text-[12px] transition ${
          survol ? 'border-[#B4761A] bg-[#FDF7EA] text-[#8A5A11]' : 'border-[#D8D3C8] text-slate-500'
        }`}
      >
        {envoi ? (
          <span className="font-semibold text-[#8A5A11]">Envoi de « {envoi} »…</span>
        ) : (
          <>
            <span className="font-semibold text-slate-700">Glissez ici des photos, fichiers ou mails</span> (depuis le PC ou la boîte de réception Outlook), collez une capture
            (Ctrl/Cmd + V), ou{' '}
            <button type="button" onClick={() => input.current?.click()} className="font-semibold text-[#B4761A] underline">
              choisissez des fichiers
            </button>
            .
          </>
        )}
        <input
          ref={input}
          type="file"
          multiple
          accept="image/*,.pdf,.eml,.msg,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip,.mp4,.mov"
          className="hidden"
          onChange={(e) => {
            void deposer(Array.from(e.target.files || []), 'PC')
            e.target.value = ''
          }}
        />
      </div>
      )}

      {erreur ? (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-[#F0C5BE] bg-[#FCEFEC] px-3 py-2 text-[12px] text-[#7F1D1D]">
          <span>{erreur}</span>
          <button type="button" onClick={() => setErreur(null)} className="shrink-0 font-semibold underline">
            OK
          </button>
        </div>
      ) : null}

      {pieces.length ? (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {pieces.map((p) => {
            const lien = liens[p.chemin]
            const image = estImage(p.nom, p.type_mime)
            const mail = estMail(p.nom, p.type_mime)
            const peutRetirer = !lectureSeule && (expert || p.ajoute_par === email)
            return (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border border-[#E2DFD8] bg-white p-2 text-[12px]">
                {image && lien ? (
                  <a href={lien} target="_blank" rel="noreferrer" className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={lien} alt={p.nom} className="h-12 w-12 rounded object-cover" />
                  </a>
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-[#F1EFEA] text-[18px]">{mail ? '✉️' : '📄'}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-800" title={p.mail_objet || p.nom}>
                    {mail ? p.mail_objet || p.nom : p.nom}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {mail
                      ? [p.mail_de, p.mail_date ? fmtDateHeure(p.mail_date) : ''].filter(Boolean).join(' · ') || p.nom
                      : [fmtTaille(p.taille), p.origine === 'PRESSE_PAPIER' ? 'capture' : ''].filter(Boolean).join(' · ')}
                  </span>
                  <span className="block truncate text-[10px] text-slate-400">
                    {p.ajoute_par.split('@')[0]} · {fmtDateHeure(p.ajoute_le)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {lien ? (
                    <a href={lien} target="_blank" rel="noreferrer" className="font-semibold text-[#B4761A] underline">
                      Ouvrir
                    </a>
                  ) : null}
                  {peutRetirer ? (
                    <button type="button" onClick={() => retirer(p)} className="text-[11px] text-slate-400 hover:text-[#A32C2C]">
                      Retirer
                    </button>
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
