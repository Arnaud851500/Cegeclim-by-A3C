'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { formatMoney } from '@/app/focus_mensuel/page'
import MobileDetailSheet, { type DetailField } from './MobileDetailSheet'

// ─────────────────────────────────────────────────────────────────────────
// Confirmé (Supabase Table Editor, table activite_lignes) : les documents
// sont répartis sur TROIS tables distinctes, pas une seule table générique :
//   - devis_lignes    : Devis
//   - facture_lignes  : Factures (confirmé fonctionnel ailleurs dans l'app)
//   - activite_lignes : Bon de commande / Bon de livraison / Bon de retour
//     (CDC/BL/BR). Colonnes confirmées sur cette table : numero_piece,
//     numero_tiers_entete, intitule_tiers_entete, type_document, ligne_hash.
// D'où la recherche multi-tables ci-dessous. Chaque table × champ est
// interrogée séparément et isolée par son propre try/catch : une colonne ou
// une table qui n'existe pas dans une combinaison n'empêche pas les autres
// de fonctionner.
// ─────────────────────────────────────────────────────────────────────────

const SEARCH_TABLES = ['activite_lignes', 'facture_lignes', 'devis_lignes']

const SEARCH_FIELDS = [
  { key: 'numero_piece' },
  { key: 'numero_document' },
  { key: 'reference_article' },
  { key: 'reference' },
  { key: 'numero_tiers_entete' },
]

// ── Rendez-vous BLG (crm_base_activity) — même source que l'agenda du
// OnePage desktop (components/OutlookAgenda.tsx). Filtrée sur
// internal_tag='normal', type in ('meeting','phoneCall','reminder'), et
// from_fk = l'identifiant partner de l'utilisateur (user_page_access.
// blg_partner_id, cf. migration add_blg_partner_id_to_user_page_access.sql).
// Si ce champ n'est pas renseigné pour l'utilisateur, la liste reste vide
// avec un message explicite plutôt que planter.
//
// NOTE SCHEMA : le schéma Postgres réel est `blg`, mais PostgREST
// n'expose que `public` et `sage`. On passe donc par une vue miroir
// `public.crm_base_activity` (CREATE VIEW ... AS SELECT * FROM blg.crm_base_activity)
// et on interroge cette vue directement sans .schema('blg').
//
// NOTE TYPE : confirmé empiriquement que crm_base_activity.type stocke le
// nom texte ('meeting', 'phoneCall', 'reminder'), pas l'ID numérique de la
// table de référence blg.activity_type (4/7/9 correspondent bien aux mêmes
// types, mais ce sont les libellés texte qui sont stockés sur cette colonne).
// On filtre donc sur le texte — les IDs numériques sont ajoutés au filtre en
// plus par sécurité, au cas où certaines lignes utiliseraient l'ID en texte
// ('4', '7', '9') ; ça ne retire jamais de résultat, ça ne peut qu'en ajouter.
const RDV_TYPE_KEYS = ['meeting', 'phoneCall', 'reminder', '4', '7', '9']
const RDV_TYPE_COLORS: Record<string, string> = {
  meeting: '#2E5BB8',
  phoneCall: '#D68910',
  reminder: '#8E44AD',
  '4': '#2E5BB8',
  '7': '#D68910',
  '9': '#8E44AD',
}
const RDV_TYPE_LABELS: Record<string, string> = {
  meeting: 'RDV',
  phoneCall: 'Appel',
  reminder: 'Rappel',
  '4': 'RDV',
  '7': 'Appel',
  '9': 'Rappel',
}

type BlgActivity = {
  id: string
  type: string
  subject: string
  company: string | null
  start: string
  end: string
  allDay: boolean
}

function safeText(value: any) {
  return String(value ?? '').trim()
}
function pick(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const v = row?.[key]
    if (v !== null && v !== undefined && String(v).trim() !== '') return v
  }
  return null
}
function normalizeDateIso(value: any) {
  const text = safeText(value)
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  return ''
}
function formatDateFr(iso: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

type DocResult = {
  key: string
  type: string
  numero: string
  tiers: string
  reference: string
  date: string
  montant_ht: number
}

async function searchByField(table: string, field: string, term: string) {
  try {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .ilike(field, `%${term}%`)
      .limit(30)
    if (error) return []
    return (data || []) as Record<string, any>[]
  } catch {
    return []
  }
}

export default function MobileRdv() {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<DocResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [openDetail, setOpenDetail] = useState<{ title: string; subtitle?: string; fields: DetailField[] } | null>(null)

  const [rdvList, setRdvList] = useState<BlgActivity[] | null>(null)
  const [rdvLoading, setRdvLoading] = useState(true)
  const [rdvUnconfigured, setRdvUnconfigured] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadRdv() {
      setRdvLoading(true)
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const email = sessionData.session?.user?.email?.toLowerCase()
        if (!email) return

        const { data: access } = await supabase
          .from('user_page_access')
          .select('blg_partner_id')
          .eq('email', email)
          .maybeSingle()

        if (!access?.blg_partner_id) {
          if (!cancelled) {
            setRdvUnconfigured(true)
            setRdvList([])
          }
          return
        }

        const today = new Date()
        const start = today.toISOString().slice(0, 10)
        const later = new Date(today)
        later.setDate(later.getDate() + 30)
        const end = later.toISOString().slice(0, 10)

        const { data, error } = await supabase
          .from('crm_base_activity')
          .select('*')
          .eq('internal_tag', 'normal')
          .in('type', RDV_TYPE_KEYS)
          .eq('from_fk', access.blg_partner_id)
          .gte('start_date', start)
          .lt('start_date', end)
          .order('start_date', { ascending: true })
          .limit(100)

        if (cancelled) return
        if (error) {
          console.error('[MobileRdv] crm_base_activity', error)
          setRdvList([])
          return
        }

        const rows = (data || []) as Record<string, any>[]

        // Nom d'entreprise liée : crm_activity_company (activity_fk, company_fk)
        // -> partner_base_partner.id / company_name. Résolu en 2 requêtes
        // batch. Une erreur ici ne doit jamais empêcher l'affichage des
        // rendez-vous eux-mêmes — repli silencieux sur "pas d'entreprise".
        const companyByActivity = new Map<number, string>()
        try {
          const activityIds = rows.map((r) => r.id).filter((v) => v !== null && v !== undefined)
          if (activityIds.length > 0) {
            const { data: links } = await supabase
              .from('crm_activity_company')
              .select('activity_fk, company_fk')
              .in('activity_fk', activityIds)

            const companyIds = Array.from(
              new Set(((links || []) as Record<string, any>[]).map((l) => l.company_fk).filter((v) => v !== null && v !== undefined)),
            )

            if (companyIds.length > 0) {
              const { data: companies } = await supabase
                .from('partner_base_partner')
                .select('id, company_name')
                .in('id', companyIds)

              const nameById = new Map(
                ((companies || []) as Record<string, any>[]).map((c) => [c.id, String(c.company_name || '').trim()]),
              )

              ;((links || []) as Record<string, any>[]).forEach((l) => {
                const name = nameById.get(l.company_fk)
                if (name) companyByActivity.set(l.activity_fk, name)
              })
            }
          }
        } catch (e) {
          console.warn('[MobileRdv] résolution entreprise liée impossible :', e)
        }

        if (cancelled) return

        setRdvUnconfigured(false)
        setRdvList(
          rows.map((row) => ({
            id: String(row.id),
            type: String(row.type ?? ''),
            // "comment" est la colonne réelle du texte descriptif sur
            // crm_base_activity (confirmé via information_schema — pas de
            // colonne subject/title/name/label sur cette table).
            subject: String(pick(row, ['comment', 'subject', 'title', 'name', 'label']) || RDV_TYPE_LABELS[String(row.type ?? '')] || 'Activité'),
            company: companyByActivity.get(row.id) || null,
            // NE PAS tronquer le timestamp (garder le fuseau horaire) : un
            // .slice(0, 19) sur "2026-08-23T22:00:00+00:00" donnait
            // "2026-08-23T22:00:00", réinterprété par `new Date()` comme 22h
            // locale plutôt que 22h UTC (= 00h locale le lendemain) — ce qui
            // décalait la date/heure affichée d'environ 2h en été.
            start: String(row.start_date || ''),
            end: String(row.end_date || row.start_date || ''),
            allDay: Boolean(row.all_day),
          })),
        )
      } finally {
        if (!cancelled) setRdvLoading(false)
      }
    }
    void loadRdv()
    return () => {
      cancelled = true
    }
  }, [])

  function openRdvDetail(r: BlgActivity) {
    const startDate = r.start ? new Date(r.start) : null
    const endDate = r.end ? new Date(r.end) : null
    const fmtTime = (d: Date | null) => (d ? d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
    setOpenDetail({
      title: r.subject,
      subtitle: RDV_TYPE_LABELS[r.type] || r.type || 'Activité',
      fields: [
        ...(r.company ? [{ label: 'Entreprise', value: r.company }] : []),
        { label: 'Début', value: r.allDay ? (startDate ? startDate.toLocaleDateString('fr-FR') : '') : fmtTime(startDate) },
        { label: 'Fin', value: r.allDay ? (endDate ? endDate.toLocaleDateString('fr-FR') : '') : fmtTime(endDate) },
        { label: 'Toute la journée', value: r.allDay ? 'Oui' : 'Non' },
      ],
    })
  }

  function openResultDetail(r: DocResult) {
    setOpenDetail({
      title: r.numero || '(sans numéro)',
      subtitle: r.type || 'Document',
      fields: [
        { label: 'Type', value: r.type },
        { label: 'N° de pièce', value: r.numero },
        { label: 'Client', value: r.tiers },
        { label: 'Référence', value: r.reference },
        { label: 'Date', value: r.date ? formatDateFr(r.date) : '' },
        { label: 'Montant HT', value: r.montant_ht ? formatMoney(r.montant_ht) : '' },
      ],
    })
  }

  async function runSearch() {
    const q = term.trim()
    if (!q) {
      setResults(null)
      return
    }
    setLoading(true)
    try {
      const calls: Promise<Record<string, any>[]>[] = []
      SEARCH_TABLES.forEach((table) => {
        SEARCH_FIELDS.forEach((f) => calls.push(searchByField(table, f.key, q)))
      })
      const rawResultsPerCall = await Promise.all(calls)

      const merged = new Map<string, DocResult>()
      rawResultsPerCall.flat().forEach((row) => {
        const numero = safeText(pick(row, ['numero_piece', 'numero_document', 'num_piece']))
        const type = safeText(row.type_document)
        const tiers = safeText(pick(row, ['numero_tiers_entete']))
        const key = `${type}-${numero}-${tiers}`
        if (merged.has(key)) return
        merged.set(key, {
          key,
          type,
          numero,
          tiers,
          reference: safeText(pick(row, ['reference_article', 'reference'])),
          date: normalizeDateIso(pick(row, [
            'date_document', 'date_facture', 'date_piece',
            'date_bl', 'date_piece_bl', 'date_livraison_bl', 'date_livraison',
            'date_devis',
          ])),
          montant_ht: Number(row.montant_ht || 0),
        })
      })
      setResults(Array.from(merged.values()).slice(0, 40))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ---- Rendez-vous : crm_base_activity, filtrés sur l'identifiant partner BLG de l'utilisateur. ---- */}
      <div
        style={{
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.10)',
          background: 'rgba(255,255,255,0.04)',
          padding: '14px 16px',
        }}
      >
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>
          Rendez-vous — 30 prochains jours
        </div>

        {rdvLoading ? (
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Chargement…</div>
        ) : rdvUnconfigured ? (
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>
            Identifiant partner BLG non renseigné pour ce compte (user_page_access.blg_partner_id).
          </div>
        ) : !rdvList || rdvList.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Aucun rendez-vous sur les 30 prochains jours.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rdvList.map((r) => {
              const color = RDV_TYPE_COLORS[r.type] || '#7A5EA8'
              const d = r.start ? new Date(r.start) : null
              const dateLabel = d
                ? r.allDay
                  ? d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })
                  : d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                : ''
              return (
                <div
                  key={r.id}
                  onClick={() => openRdvDetail(r)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)',
                    padding: '9px 12px', cursor: 'pointer',
                  }}
                >
                  <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: color, flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {r.company && (
                      <div style={{
                        fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em',
                        color: '#E8A96A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {r.company}
                      </div>
                    )}
                    <div style={{ fontSize: 13.5, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.subject}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>
                      {[RDV_TYPE_LABELS[r.type] || r.type, dateLabel].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ---- Assistant vocal : à venir. ---- */}
      <button
        disabled
        style={{
          borderRadius: 14,
          border: '1px dashed rgba(255,255,255,0.15)',
          background: 'transparent',
          color: 'rgba(255,255,255,0.35)',
          padding: '14px 16px',
          fontSize: 13,
          textAlign: 'left',
        }}
      >
        🎙️ Assistant visite (résumé vocal + actions) — Bientôt disponible
      </button>

      {/* ---- Recherche de document ---- */}
      <div>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
          Rechercher un document
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            placeholder="N° de pièce, référence chantier, n° client…"
            style={{
              flex: 1,
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.05)',
              color: '#fff',
              padding: '11px 13px',
              fontSize: 14,
              outline: 'none',
            }}
          />
          <button
            onClick={runSearch}
            style={{
              borderRadius: 12,
              border: '1px solid rgba(166,161,129,0.4)',
              background: 'rgba(166,161,129,0.15)',
              color: '#e4dfc9',
              padding: '0 16px',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Chercher
          </button>
        </div>

        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading ? (
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Recherche…</div>
          ) : results === null ? null : results.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Aucun document trouvé.</div>
          ) : (
            results.map((r) => (
              <div
                key={r.key}
                onClick={() => openResultDetail(r)}
                style={{
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.03)',
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: '#fff' }}>{r.numero || '—'}</span>
                  {r.montant_ht > 0 && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'rgba(255,255,255,0.75)' }}>
                      {formatMoney(r.montant_ht)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>
                  {[r.type, r.tiers && `Client ${r.tiers}`, r.date && formatDateFr(r.date), r.reference]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {openDetail && (
        <MobileDetailSheet
          title={openDetail.title}
          subtitle={openDetail.subtitle}
          fields={openDetail.fields}
          onClose={() => setOpenDetail(null)}
        />
      )}
    </div>
  )
}
