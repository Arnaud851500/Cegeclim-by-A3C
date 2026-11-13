'use client'

/**
 * Documents « Soleil » de la hotline (13/11/2026, demande d'Arnaud) —
 * onglet de l'éditeur de diagnostic (/hotline/diagnostic), réservé aux experts.
 *
 * Arborescence Soleil :
 *  - NIV 2 = marque de l'onduleur (Hoymiles, Solis, Autre) → notices CEGECLIM
 *    de la marque, affichées en tête de liste dans la console (pour « Autre » :
 *    notices Huawei + Wallbox + Solar Edge) ;
 *  - NIV 3 = équipement de la marque → fiches techniques et notices fabricant,
 *    affichées à part (bloc séparé) dans la console.
 * Un document = un fichier déposé dans le bucket public « hotline-documents »
 * (le lien peut être envoyé au client) ou un lien vers un document existant.
 * Table hotline_docs_soleil (migration 20261113a_hotline_soleil.sql).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  CATEGORIES_DOC_SOLEIL,
  MARQUES_SOLEIL,
  chargerDocsSoleil,
  libelleEquipementSoleil,
  marqueSoleil,
  messageErreur,
  type CategorieDocSoleil,
  type DocSoleil,
  type MarqueSoleil,
} from '@/lib/hotline'

const champ = 'h-9 w-full rounded-lg border border-[#D8D3C8] bg-white px-2.5 text-[13px] text-slate-900 outline-none focus:border-[#B4761A]'

type Nouveau = { equipement: string; categorie: CategorieDocSoleil; titre: string; url: string; fichier: File | null }

export default function DocumentsSoleilAdmin({ onErreur, onInfo }: { onErreur: (m: string) => void; onInfo: (m: string) => void }) {
  const [marque, setMarque] = useState<MarqueSoleil>('HOYMILES')
  const [docs, setDocs] = useState<DocSoleil[]>([])
  const [busy, setBusy] = useState(false)
  const [nouveau, setNouveau] = useState<Nouveau>({ equipement: '', categorie: 'NOTICE_CEGECLIM', titre: '', url: '', fichier: null })
  const m = marqueSoleil(marque)!

  const charger = useCallback(async () => {
    try {
      setDocs(await chargerDocsSoleil())
    } catch (e) {
      onErreur(messageErreur(e))
    }
  }, [onErreur])

  useEffect(() => {
    void charger()
  }, [charger])

  const groupes = useMemo(() => {
    const deLaMarque = docs.filter((d) => d.marque === marque)
    return [
      { cle: '', titre: `Niveau 2 · notices CEGECLIM ${m.label}`, liste: deLaMarque.filter((d) => !d.equipement) },
      ...m.equipements.map((e) => ({ cle: e.value, titre: `Niveau 3 · ${e.label}`, liste: deLaMarque.filter((d) => d.equipement === e.value) })),
    ]
  }, [docs, marque, m])

  function choisirEmplacement(equipement: string) {
    setNouveau((n) => ({ ...n, equipement, categorie: equipement ? (n.categorie === 'NOTICE_CEGECLIM' ? 'FICHE_TECHNIQUE' : n.categorie) : 'NOTICE_CEGECLIM' }))
  }

  async function ajouter() {
    if (!nouveau.titre.trim() && !nouveau.fichier) return onErreur('Donner un titre au document.')
    if (!nouveau.fichier && !nouveau.url.trim()) return onErreur('Déposer un fichier ou saisir un lien.')
    setBusy(true)
    try {
      let url = nouveau.url.trim()
      let chemin: string | null = null
      if (nouveau.fichier) {
        const propre = nouveau.fichier.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_')
        chemin = `soleil/${marque.toLowerCase()}/${nouveau.equipement ? nouveau.equipement.toLowerCase() + '/' : ''}${Date.now()}_${propre}`
        const { error: e1 } = await supabase.storage.from('hotline-documents').upload(chemin, nouveau.fichier, { contentType: nouveau.fichier.type || undefined, upsert: false })
        if (e1) throw e1
        url = supabase.storage.from('hotline-documents').getPublicUrl(chemin).data.publicUrl
      }
      const ordre = docs.filter((d) => d.marque === marque && (d.equipement || '') === nouveau.equipement).length
      const { error } = await supabase.from('hotline_docs_soleil').insert({
        marque,
        equipement: nouveau.equipement || null,
        categorie: nouveau.categorie,
        titre: nouveau.titre.trim() || (nouveau.fichier?.name || '').replace(/\.[^.]+$/, ''),
        url,
        chemin,
        ordre,
      })
      if (error) throw error
      setNouveau((n) => ({ ...n, titre: '', url: '', fichier: null }))
      onInfo('Document ajouté')
      await charger()
    } catch (e) {
      onErreur(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  async function supprimer(d: DocSoleil) {
    if (!window.confirm(`Supprimer le document « ${d.titre} » ?`)) return
    setBusy(true)
    try {
      if (d.chemin) await supabase.storage.from('hotline-documents').remove([d.chemin])
      const { error } = await supabase.from('hotline_docs_soleil').delete().eq('id', d.id)
      if (error) throw error
      await charger()
    } catch (e) {
      onErreur(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  async function deplacer(d: DocSoleil, sens: -1 | 1) {
    const liste = docs.filter((x) => x.marque === d.marque && (x.equipement || '') === (d.equipement || ''))
    const i = liste.findIndex((x) => x.id === d.id)
    const autre = liste[i + sens]
    if (!autre) return
    setBusy(true)
    try {
      await supabase.from('hotline_docs_soleil').update({ ordre: i + sens }).eq('id', d.id)
      await supabase.from('hotline_docs_soleil').update({ ordre: i }).eq('id', autre.id)
      await charger()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#E2DFD8] bg-white p-4">
        <div className="text-[14px] font-bold text-slate-900">Documents Soleil</div>
        <p className="mt-1 text-[12px] text-slate-500">
          Niveau 2 (marque) : notices CEGECLIM, affichées en tête dans la console. Niveau 3 (équipement) : fiches techniques et notices fabricant, affichées à
          part. Les fichiers déposés ici ont un lien public : ils peuvent être envoyés au client.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {MARQUES_SOLEIL.map((x) => (
            <button
              key={x.value}
              type="button"
              onClick={() => {
                setMarque(x.value)
                choisirEmplacement('')
              }}
              className="min-w-[110px] rounded-lg border-2 px-4 py-1.5 text-[13px] font-bold"
              style={{ borderColor: x.couleur, background: marque === x.value ? x.couleur : '#fff', color: marque === x.value ? '#fff' : x.couleur }}
            >
              {x.label}
              <span className="ml-1.5 text-[11px] font-normal opacity-80">({docs.filter((d) => d.marque === x.value).length})</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-[#E2DFD8] bg-white p-4">
        <div className="text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">Ajouter un document · {m.label}</div>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
          <label className="text-[11px] font-semibold text-slate-500">
            Emplacement
            <select value={nouveau.equipement} onChange={(e) => choisirEmplacement(e.target.value)} className={champ}>
              <option value="">Niveau 2 · marque {m.label}</option>
              {m.equipements.map((e) => (
                <option key={e.value} value={e.value}>
                  Niveau 3 · {e.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-semibold text-slate-500">
            Type
            <select value={nouveau.categorie} onChange={(e) => setNouveau((n) => ({ ...n, categorie: e.target.value as CategorieDocSoleil }))} className={champ}>
              {CATEGORIES_DOC_SOLEIL.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-semibold text-slate-500 md:col-span-2">
            Titre
            <input value={nouveau.titre} onChange={(e) => setNouveau((n) => ({ ...n, titre: e.target.value }))} placeholder="Ex. Notice de mise en service HMS-2000" className={champ} />
          </label>
          <label className="text-[11px] font-semibold text-slate-500 md:col-span-2">
            Fichier (PDF…)
            <input
              type="file"
              onChange={(e) => setNouveau((n) => ({ ...n, fichier: e.target.files?.[0] || null }))}
              className="block w-full text-[12px] text-slate-600 file:mr-2 file:rounded-lg file:border file:border-[#D8D3C8] file:bg-white file:px-3 file:py-1.5 file:text-[12px] file:font-semibold"
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-500 md:col-span-2">
            … ou lien vers le document
            <input value={nouveau.url} onChange={(e) => setNouveau((n) => ({ ...n, url: e.target.value }))} placeholder="https://…" disabled={Boolean(nouveau.fichier)} className={champ} />
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" disabled={busy} onClick={() => void ajouter()} className="rounded-lg bg-[#0B1220] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
            {busy ? '…' : 'Ajouter le document'}
          </button>
        </div>
      </div>

      {groupes.map((g) => (
        <div key={g.cle || 'marque'} className={`rounded-2xl border bg-white ${g.cle ? 'border-[#E2DFD8]' : ''}`} style={g.cle ? undefined : { borderColor: m.couleur }}>
          <div className="flex items-center justify-between border-b border-[#EFEDE8] px-4 py-2">
            <span className="text-[12px] font-bold uppercase tracking-[0.05em]" style={{ color: g.cle ? '#475569' : m.couleur }}>
              {g.titre}
            </span>
            <button type="button" onClick={() => choisirEmplacement(g.cle)} className="text-[11px] font-semibold text-[#B4761A] underline">
              Ajouter ici
            </button>
          </div>
          <div className="space-y-1.5 p-3">
            {g.liste.length ? (
              g.liste.map((d, i) => (
                <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#E2DFD8] px-3 py-1.5 text-[13px]">
                  <span className="min-w-0 truncate">
                    <span className="mr-1.5 rounded bg-[#EEEDEA] px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                      {CATEGORIES_DOC_SOLEIL.find((c) => c.value === d.categorie)?.label}
                    </span>
                    {d.titre}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[12px]">
                    <button type="button" disabled={busy || i === 0} onClick={() => void deplacer(d, -1)} className="text-slate-400 hover:text-slate-800 disabled:opacity-30" title="Monter">
                      ▲
                    </button>
                    <button type="button" disabled={busy || i === g.liste.length - 1} onClick={() => void deplacer(d, 1)} className="text-slate-400 hover:text-slate-800 disabled:opacity-30" title="Descendre">
                      ▼
                    </button>
                    <a href={d.url} target="_blank" rel="noreferrer" className="font-semibold text-slate-500 underline">
                      Ouvrir
                    </a>
                    <button type="button" disabled={busy} onClick={() => void supprimer(d)} className="font-semibold text-[#A32C2C] underline disabled:opacity-40">
                      Supprimer
                    </button>
                  </span>
                </div>
              ))
            ) : (
              <p className="text-[12px] text-slate-400">
                Aucun document
                {g.cle ? ` pour ${libelleEquipementSoleil(marque, g.cle)}` : m.notices ? ` (attendu : ${m.notices})` : ''}.
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
