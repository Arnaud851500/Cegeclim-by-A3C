'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'

type CerfaRow = {
  id: number | string
  ligne_hash?: string | null
  date_facture?: string | null
  numero_piece?: string | null
  numero_tiers_entete?: string | null
  intitule_tiers_entete?: string | null
  reference_article?: string | null
  designation?: string | null
  depot?: string | null
  collaborateur?: string | null
  projet?: string | null
  affaire?: string | null
  affaireDraft: string
  checked: boolean
  saving: boolean
  lienFacture?: string | null
  lienTiers?: string | null
}

type GenericRow = Record<string, any>

const FACTURE_SELECT = [
  'id',
  'ligne_hash',
  'date_facture',
  'numero_piece',
  'numero_tiers_entete',
  'intitule_tiers_entete',
  'reference_article',
  'designation',
  'depot',
  'collaborateur',
  'projet',
  'affaire',
].join(',')

function cleanText(value: any) {
  return String(value ?? '').trim()
}

function formatDateFr(value: any) {
  const text = cleanText(value)
  if (!text) return '—'
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[3].padStart(2, '0')}/${iso[2].padStart(2, '0')}/${iso[1]}`
  return text
}

function normalizeColumnName(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function rowValueByAliases(row: GenericRow, aliases: string[]) {
  const wanted = new Set(aliases.map(normalizeColumnName))
  for (const [column, value] of Object.entries(row || {})) {
    if (!wanted.has(normalizeColumnName(column))) continue
    const text = cleanText(value)
    if (text) return text
  }
  return ''
}

function firstUrlLike(row: GenericRow) {
  for (const value of Object.values(row || {})) {
    const text = cleanText(value)
    if (/^https?:\/\//i.test(text) || text.includes('app.blgcloud.com')) return text
  }
  return ''
}

function linkKey(value: any) {
  return cleanText(value)
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
}

function addLinkEntry(map: Record<string, string>, key: any, href: any) {
  const cleanKey = linkKey(key)
  const cleanHref = cleanText(href)
  if (!cleanKey || !cleanHref) return
  map[cleanKey] = cleanHref
  map[cleanKey.toUpperCase()] = cleanHref
  map[cleanKey.toLowerCase()] = cleanHref
}

function findLink(map: Record<string, string>, value: any) {
  const key = linkKey(value)
  if (!key) return null
  return map[key] || map[key.toUpperCase()] || map[key.toLowerCase()] || null
}

async function fetchLinksForVisibleRows(tableName: string, keyColumns: string[], linkColumns: string[], keys: string[]) {
  const result: Record<string, string> = {}
  const uniqueKeys = Array.from(new Set(keys.map(cleanText).filter(Boolean))).slice(0, 1000)
  if (!uniqueKeys.length) return result

  for (const keyColumn of keyColumns) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .in(keyColumn, uniqueKeys)
      .limit(1000)

    if (error) continue

    ;((data || []) as GenericRow[]).forEach((row) => {
      const key = rowValueByAliases(row, [keyColumn, ...keyColumns])
      const href = rowValueByAliases(row, linkColumns) || firstUrlLike(row)
      addLinkEntry(result, key, href)
    })

    break
  }

  return result
}

export default function CerfaKoPage() {
  const { email } = useAccess()
  const [rows, setRows] = useState<CerfaRow[]>([])
  const [loading, setLoading] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((row) =>
      [
        row.numero_piece,
        row.numero_tiers_entete,
        row.intitule_tiers_entete,
        row.reference_article,
        row.designation,
        row.depot,
        row.collaborateur,
        row.projet,
        row.affaireDraft,
      ]
        .map((value) => cleanText(value).toLowerCase())
        .some((value) => value.includes(needle))
    )
  }, [rows, search])

  async function refreshHeaderStatus() {
    try {
      await supabase.rpc('refresh_app_status_cerfa')
    } catch {
      // Ne jamais bloquer l'écran CERFA pour un refresh de voyant.
    }
  }

  async function loadRows() {
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      const { data, error: loadError } = await supabase
        .from('facture_lignes')
        .select(FACTURE_SELECT)
        .not('projet', 'is', null)
        .order('date_facture', { ascending: false, nullsFirst: false })
        .order('numero_piece', { ascending: true })
        .limit(1000)

      if (loadError) throw loadError

      const rawRows = ((data || []) as GenericRow[])
        .filter((row) => cleanText(row.projet))
        .map((row) => ({
          ...(row as CerfaRow),
          affaireDraft: cleanText(row.affaire),
          checked: false,
          saving: false,
          lienFacture: null,
          lienTiers: null,
        }))

      const invoiceNumbers = rawRows.map((row) => cleanText(row.numero_piece)).filter(Boolean)
      const tiersNumbers = rawRows.map((row) => cleanText(row.numero_tiers_entete)).filter(Boolean)

      const [documentLinks, tiersLinks] = await Promise.all([
        fetchLinksForVisibleRows(
          'blg_link',
          ['numero_piece', 'numero_pièce', 'Numero_Piece', 'Numero_piece', 'numero_document', 'Numero_Document'],
          ['lien_blg_doc', 'Lien_BLG_doc', 'Lien_BLG_Doc', 'LIEN_BLG_DOC'],
          invoiceNumbers
        ),
        fetchLinksForVisibleRows(
          'ref_tiers',
          ['numero', 'numero_tiers', 'Numero_Tiers', 'NUMERO_TIERS', 'code_tiers', 'Code_Tiers'],
          ['lien_blg_tiers', 'Lien_BLG_Tiers', 'LIEN_BLG_TIERS'],
          tiersNumbers
        ),
      ])

      const hydratedRows = rawRows.map((row) => ({
        ...row,
        lienFacture: findLink(documentLinks, row.numero_piece),
        lienTiers: findLink(tiersLinks, row.numero_tiers_entete),
      }))

      setRows(hydratedRows)
      await refreshHeaderStatus()
    } catch (exception: any) {
      setError(exception?.message || String(exception))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateRow(id: string | number, patch: Partial<CerfaRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
  }

  async function validateRow(row: CerfaRow) {
    const affaire = cleanText(row.affaireDraft)
    if (!row.checked) {
      setError('Coche d’abord la case OK de la ligne à valider.')
      return
    }
    if (!affaire) {
      setError('Le champ Affaire / commentaire est obligatoire pour valider une ligne CERFA.')
      return
    }

    setError(null)
    updateRow(row.id, { saving: true })

    try {
      const numericId = Number(row.id)
      const { data, error: rpcError } = await supabase.rpc('validate_cerfa_ko_by_id', {
        p_id: Number.isFinite(numericId) ? numericId : null,
        p_ligne_hash: cleanText(row.ligne_hash) || null,
        p_affaire: affaire,
      })

      if (rpcError) throw rpcError
      if (data === 0 || data === false) throw new Error('Aucune ligne mise à jour. Elle a peut-être déjà été régularisée.')

      setRows((current) => current.filter((item) => item.id !== row.id))
      setMessage(`Ligne ${row.numero_piece || row.id} régularisée.`)
      await refreshHeaderStatus()
    } catch (exception: any) {
      setError(`Validation impossible : ${exception?.message || exception}`)
      updateRow(row.id, { saving: false })
    }
  }

  async function validateSelectedRows() {
    const selectedRows = filteredRows.filter((row) => row.checked && cleanText(row.affaireDraft) && !row.saving)
    if (!selectedRows.length) {
      setError('Aucune ligne sélectionnée avec une affaire renseignée.')
      return
    }

    setSavingAll(true)
    setError(null)
    try {
      for (const row of selectedRows) {
        // validation séquentielle pour éviter de saturer Supabase
        // eslint-disable-next-line no-await-in-loop
        await validateRow(row)
      }
    } finally {
      setSavingAll(false)
    }
  }

  return (
    <main className="mx-auto max-w-[1900px] px-6 py-6 text-slate-900">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black">Liste des CERFA KO en attente de régularisation</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {email ? `Utilisateur connecté : ${email}` : 'Utilisateur connecté'} · {rows.length} ligne(s) à traiter
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadRows()}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50"
            >
              Actualiser
            </button>
            <button
              type="button"
              onClick={() => void validateSelectedRows()}
              disabled={savingAll}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              Valider les lignes cochées
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filtrer facture, tiers, référence, dépôt, collaborateur…"
            className="h-11 min-w-[320px] flex-1 rounded-xl border border-slate-300 px-4 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <div className="rounded-full bg-slate-100 px-3 py-2 text-xs font-black text-slate-600">
            {filteredRows.length} ligne(s) affichée(s)
          </div>
        </div>

        {message && <div className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-sm font-black text-blue-700">{message}</div>}
        {error && <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</div>}
        {loading && <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-black text-slate-600">Chargement des lignes CERFA…</div>}

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          <div className="max-h-[68vh] overflow-auto">
            <table className="min-w-[1650px] w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-3 text-left font-black">Date facture</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-left font-black">N° facture</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-left font-black">N° Tiers</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-left font-black">Désignation du Tiers</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-left font-black">Référence</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-left font-black">Désignation article</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-left font-black">Dépôt</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-left font-black">Collaborateur</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-left font-black">Projet</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-left font-black">Affaire / commentaire</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-center font-black">OK</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-center font-black">Action</th>
                </tr>
              </thead>
              <tbody>
                {!loading && filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-10 text-center text-sm font-black text-slate-400">
                      Aucune ligne CERFA KO à régulariser.
                    </td>
                  </tr>
                ) : filteredRows.map((row, index) => (
                  <tr key={`${row.id}-${row.ligne_hash || index}`} className={index % 2 ? 'bg-white' : 'bg-slate-50/60'}>
                    <td className="border-b border-slate-100 px-3 py-3 font-semibold whitespace-nowrap">{formatDateFr(row.date_facture)}</td>
                    <td className="border-b border-slate-100 px-3 py-3 font-black whitespace-nowrap">
                      {row.lienFacture ? (
                        <a href={row.lienFacture} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline underline-offset-2 hover:text-blue-900">
                          {row.numero_piece || '—'} ↗
                        </a>
                      ) : row.numero_piece || '—'}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3 font-black whitespace-nowrap">
                      {row.lienTiers ? (
                        <a href={row.lienTiers} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline underline-offset-2 hover:text-blue-900">
                          {row.numero_tiers_entete || '—'} ↗
                        </a>
                      ) : row.numero_tiers_entete || '—'}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3">{row.intitule_tiers_entete || '—'}</td>
                    <td className="border-b border-slate-100 px-3 py-3 font-semibold whitespace-nowrap">{row.reference_article || '—'}</td>
                    <td className="border-b border-slate-100 px-3 py-3">{row.designation || '—'}</td>
                    <td className="border-b border-slate-100 px-3 py-3 font-semibold whitespace-nowrap">{row.depot || '—'}</td>
                    <td className="border-b border-slate-100 px-3 py-3 font-semibold whitespace-nowrap">{row.collaborateur || '—'}</td>
                    <td className="border-b border-slate-100 px-3 py-3 font-black text-red-700 whitespace-nowrap">{row.projet || '—'}</td>
                    <td className="border-b border-slate-100 px-3 py-2 min-w-[260px]">
                      <input
                        value={row.affaireDraft}
                        onChange={(event) => updateRow(row.id, { affaireDraft: event.target.value })}
                        placeholder="Affaire / commentaire obligatoire"
                        className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={row.checked}
                        onChange={(event) => updateRow(row.id, { checked: event.target.checked })}
                      />
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => void validateRow(row)}
                        disabled={row.saving}
                        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white hover:bg-slate-700 disabled:opacity-50"
                      >
                        {row.saving ? '...' : 'OK'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">
          Validation : coche OK, renseigne Affaire / commentaire, puis clique sur OK. La ligne est mise à jour dans facture_lignes : projet = null et affaire = commentaire saisi.
        </div>
      </section>
    </main>
  )
}
