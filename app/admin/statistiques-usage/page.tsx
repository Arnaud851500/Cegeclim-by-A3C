'use client'

// ============================================================================
// app/admin/statistiques-usage/page.tsx — Statistiques d'usage (Admin)
// ----------------------------------------------------------------------------
// Créé le 2026-10-01. Lit le RPC get_stats_usage(p_debut, p_fin) qui agrège
// user_activity_log (page_view / login, heure de Paris).
//
// Accès : réservé à a.valanchauskas@cegeclim-energies.com. Le RPC refuse tout
// autre compte côté base ; cette page se contente d'afficher « Accès réservé »
// sans appeler la base pour les autres utilisateurs.
//
// Contenu :
//   - indicateurs de la période (utilisateurs actifs, pages, part mobile…) ;
//   - activité jour par jour (utilisateurs actifs, pages PC / mobile) ;
//   - matrice utilisateur × jour (pages vues et connexions, intensité) avec
//     fiche détaillée au clic (écrans consultés, heures de première et
//     dernière activité de chaque jour) ;
//   - écrans les plus consultés ;
//   - comptes sans aucune activité sur la période ;
//   - export CSV (utilisateur × jour).
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'

const OWNER_EMAIL = 'a.valanchauskas@cegeclim-energies.com'
const DATE_LANCEMENT = '2026-09-28'

// ── Types ───────────────────────────────────────────────────────────────────

type JourUser = {
  jour: string
  pages: number
  pages_mobile: number
  logins: number
  premiere: string | null
  derniere: string | null
}

type UserStat = {
  email: string
  nom: string
  jours_actifs: number
  pages: number
  pages_mobile: number
  logins: number
  derniere_activite: string | null
  par_jour: JourUser[]
  ecrans: { ecran: string; vues: number }[]
}

type JourTotal = {
  jour: string
  utilisateurs: number
  utilisateurs_mobile: number
  pages: number
  pages_mobile: number
  logins: number
}

type EcranStat = {
  ecran: string
  vues: number
  utilisateurs: number
  mobile: boolean
  derniere_vue: string | null
}

type Inactif = { email: string; nom: string; derniere_activite: string | null }

type StatsUsage = {
  meta: {
    debut: string
    fin: string
    generated_at: string
    utilisateurs_actifs: number
    utilisateurs_mobile: number
    pages: number
    pages_mobile: number
    logins: number
  }
  jours: JourTotal[]
  utilisateurs: UserStat[]
  ecrans: EcranStat[]
  inactifs: Inactif[]
}

type SortKey = 'jours' | 'pages' | 'mobile' | 'derniere' | 'nom'
type CellMode = 'pages' | 'logins'

// ── Libellés des écrans ─────────────────────────────────────────────────────

const ECRAN_LABELS: Record<string, string> = {
  '/accueil': 'Accueil (PC)',
  '/tableaux-de-bord/vision-tci': 'Vision One Page',
  '/tableau-de-bord/vision-tci': 'Vision One Page (ancienne URL)',
  '/focus_mensuel2': 'Activité quotidienne',
  '/focus_mensuel': 'Focus mensuel (ancien)',
  '/portefeuille-livraison': 'Portefeuille livraison',
  '/carte': 'Carte prospects / clients',
  '/synthese_multi_clients': 'Suivi multi clients',
  '/vision-client': 'Vision client 360',
  '/todo': 'Todo list',
  '/agenda': 'Agenda',
  '/stock': 'Stock articles',
  '/stock/groupes': 'Disponibilité par groupe d’articles',
  '/stock/reconstruction': 'Reconstruction du stock',
  '/stocks-disponibilites2': 'Stocks disponibilités',
  '/approvisionnements': 'Approvisionnements',
  '/appro/achat': 'Appro / Achats',
  '/atelier-analyse': 'Atelier d’analyse',
  '/cycle-documents': 'Cycle des documents',
  '/activites': 'Activités',
  '/retards-paiement': 'Retards de paiement',
  '/clients': 'Liste globale clients',
  '/autorisation': 'Autorisations',
  '/controle-sage-blg': 'Contrôle SAGE / BLG',
  '/controle-sage-blg/clients': 'Clients SAGE / BLG',
  '/controle-sage-blg/articles': 'Articles SAGE / BLG',
  '/controle-sage-blg/fournisseur-sage-blg': 'Fournisseurs & articles SAGE / BLG',
  '/cdc-sage-blg': 'Commandes clients SAGE / BLG',
  '/financement': 'Aides financières — tableau de bord',
  '/financement/controle-pieces': 'Contrôle des pièces CEE',
  '/financement/clients-cee': 'Clients convention CEE',
  '/financement/clients-cee/[numero]': 'Fiche client CEE',
  '/financement/dossiers/nouveau': 'Nouveau dossier CEE',
  '/financement/dossiers/[id]': 'Fiche dossier CEE',
  '/admin/statistiques-usage': 'Statistiques d’usage',
  '/m/accueil': 'Accueil',
  '/m/activite': 'Mon activité',
  '/m/clients': 'Mes clients',
  '/m/rdv': 'Mes rdv',
  '/m/alertes': 'Mes alertes',
  '/m/prospects': 'Carte prospects & clients',
  '/m/stock': 'Stock articles',
  '/m/admin': 'Admin',
  '/m/taches/fiche': 'Fiche tâche',
}

function ecranLabel(path: string) {
  return ECRAN_LABELS[path] ?? path
}

function isMobilePath(path: string) {
  return path.startsWith('/m/')
}

// ── Dates ───────────────────────────────────────────────────────────────────

function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + n)
  return isoLocal(dt)
}

function daysBetween(debut: string, fin: string) {
  const out: string[] = []
  let cur = debut
  let guard = 0
  while (cur <= fin && guard < 400) {
    out.push(cur)
    cur = addDays(cur, 1)
    guard++
  }
  return out
}

const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

function jourEntete(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return { semaine: JOURS_COURTS[dt.getDay()], date: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`, weekend: dt.getDay() === 0 || dt.getDay() === 6 }
}

function fmtDateHeure(ts: string | null) {
  if (!ts) return 'jamais'
  const d = new Date(ts)
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
}

function fmtHeure(ts: string | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
}

function fmtInt(n: number) {
  return new Intl.NumberFormat('fr-FR').format(n || 0)
}

function pct(part: number, total: number) {
  if (!total) return '0 %'
  return `${Math.round((100 * part) / total)} %`
}

// ── Couleurs (tokens CEGECLIM) ──────────────────────────────────────────────

const C = {
  marine: '#0B1220',
  panel: '#121B2E',
  panel2: '#17223A',
  border: 'rgba(255,255,255,0.10)',
  text: '#F5F3EC',
  muted: 'rgba(245,243,236,0.62)',
  faint: 'rgba(245,243,236,0.38)',
  sauge: '#A6A181',
  alerte: '#C1683C',
  violet: '#7A5EA8',
  pc: '#5B8DEF',
  mobile: '#3FB68B',
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function StatistiquesUsagePage() {
  const { loading: accessLoading, email } = useAccess()
  const isOwner = (email || '').trim().toLowerCase() === OWNER_EMAIL

  const today = isoLocal(new Date())
  const [debut, setDebut] = useState<string>(addDays(today, -13))
  const [fin, setFin] = useState<string>(today)
  const [data, setData] = useState<StatsUsage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('jours')
  const [cellMode, setCellMode] = useState<CellMode>('pages')
  const [selected, setSelected] = useState<UserStat | null>(null)

  const load = useCallback(async (d: string, f: string) => {
    setLoading(true)
    setError(null)
    try {
      const { data: res, error: err } = await supabase.rpc('get_stats_usage', { p_debut: d, p_fin: f })
      if (err) throw err
      setData(res as StatsUsage)
    } catch (e: any) {
      setError(e?.message || 'Erreur de chargement')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (accessLoading || !isOwner) return
    load(debut, fin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessLoading, isOwner])

  function appliquerPeriode(d: string, f: string) {
    setDebut(d)
    setFin(f)
    load(d, f)
  }

  const jours = useMemo(() => (data ? daysBetween(data.meta.debut, data.meta.fin) : []), [data])

  const utilisateurs = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    const list = data.utilisateurs.filter((u) => !q || u.nom.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    const sorted = [...list]
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'pages': return b.pages - a.pages
        case 'mobile': return (b.pages ? b.pages_mobile / b.pages : 0) - (a.pages ? a.pages_mobile / a.pages : 0) || b.pages - a.pages
        case 'derniere': return (b.derniere_activite || '').localeCompare(a.derniere_activite || '')
        case 'nom': return a.nom.localeCompare(b.nom, 'fr')
        default: return b.jours_actifs - a.jours_actifs || b.pages - a.pages
      }
    })
    return sorted
  }, [data, search, sortKey])

  const maxCell = useMemo(() => {
    let m = 1
    for (const u of utilisateurs) for (const j of u.par_jour) m = Math.max(m, cellMode === 'pages' ? j.pages : j.logins)
    return m
  }, [utilisateurs, cellMode])

  const jourAujourdhui = data?.jours.find((j) => j.jour === today)

  function exportCsv() {
    if (!data) return
    const lignes = [['utilisateur', 'email', 'jour', 'pages', 'pages_mobile', 'connexions', 'premiere_activite', 'derniere_activite'].join(';')]
    for (const u of data.utilisateurs) {
      for (const j of u.par_jour) {
        lignes.push([u.nom, u.email, j.jour, j.pages, j.pages_mobile, j.logins, fmtHeure(j.premiere), fmtHeure(j.derniere)]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'))
      }
    }
    const blob = new Blob(['﻿' + lignes.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `statistiques-usage_${data.meta.debut}_${data.meta.fin}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Garde d'accès ──────────────────────────────────────────────────────

  if (accessLoading) {
    return <div style={styles.page}><div style={styles.empty}>Chargement…</div></div>
  }

  if (!isOwner) {
    return (
      <div style={styles.page}>
        <div style={{ ...styles.card, maxWidth: 520, margin: '80px auto', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Accès réservé</div>
          <div style={{ color: C.muted }}>Cet écran n’est accessible qu’à l’administrateur de l’application.</div>
        </div>
      </div>
    )
  }

  // ── Rendu ──────────────────────────────────────────────────────────────

  const periodes: { label: string; d: string; f: string }[] = [
    { label: '7 jours', d: addDays(today, -6), f: today },
    { label: '14 jours', d: addDays(today, -13), f: today },
    { label: '30 jours', d: addDays(today, -29), f: today },
    { label: 'Depuis le lancement', d: DATE_LANCEMENT, f: today },
    { label: 'Mois en cours', d: today.slice(0, 8) + '01', f: today },
  ]

  return (
    <div style={styles.page}>
      {/* En-tête */}
      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>ADMIN — USAGE DE L’APPLICATION</div>
          <h1 style={styles.title}>Statistiques d’usage</h1>
          <div style={{ color: C.muted, fontSize: 13 }}>
            Pages vues et connexions par utilisateur, jour par jour (heure de Paris).
            {data && <> Données au {fmtDateHeure(data.meta.generated_at)}.</>}
          </div>
        </div>
        <div style={styles.toolbar}>
          <div style={styles.segment}>
            {periodes.map((p) => {
              const active = p.d === debut && p.f === fin
              return (
                <button key={p.label} onClick={() => appliquerPeriode(p.d, p.f)} style={{ ...styles.segBtn, ...(active ? styles.segBtnActive : {}) }}>
                  {p.label}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={debut} max={fin} onChange={(e) => setDebut(e.target.value)} style={styles.input} />
            <span style={{ color: C.faint }}>→</span>
            <input type="date" value={fin} min={debut} max={today} onChange={(e) => setFin(e.target.value)} style={styles.input} />
            <button onClick={() => load(debut, fin)} style={styles.btnPrimary} disabled={loading}>
              {loading ? 'Chargement…' : 'Actualiser'}
            </button>
            <button onClick={exportCsv} style={styles.btn} disabled={!data}>Export CSV</button>
          </div>
        </div>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {!data && loading && <div style={styles.empty}>Chargement des statistiques…</div>}

      {data && (
        <>
          {/* Indicateurs */}
          <div style={styles.kpiGrid}>
            <Kpi label="Utilisateurs actifs" value={fmtInt(data.meta.utilisateurs_actifs)} sub={`sur la période`} />
            <Kpi label="Actifs aujourd’hui" value={jourAujourdhui ? fmtInt(jourAujourdhui.utilisateurs) : '—'} sub={jourAujourdhui ? `dont ${jourAujourdhui.utilisateurs_mobile} sur mobile` : 'hors période'} />
            <Kpi label="Pages vues" value={fmtInt(data.meta.pages)} sub={`${fmtInt(data.meta.logins)} connexions`} />
            <Kpi label="Part mobile" value={pct(data.meta.pages_mobile, data.meta.pages)} sub={`${data.meta.utilisateurs_mobile} utilisateur(s) mobile`} accent={C.mobile} />
            <Kpi label="Comptes inactifs" value={fmtInt(data.inactifs.length)} sub="aucune page sur la période" accent={data.inactifs.length ? C.alerte : undefined} />
          </div>

          {/* Activité par jour */}
          <div style={styles.card}>
            <div style={styles.cardTitle}>Activité par jour</div>
            <JoursChart jours={data.jours} />
          </div>

          {/* Matrice utilisateur × jour */}
          <div style={styles.card}>
            <div style={styles.cardHead}>
              <div>
                <div style={styles.cardTitle}>Par utilisateur, jour par jour</div>
                <div style={{ color: C.faint, fontSize: 12 }}>
                  Cliquer sur une ligne pour le détail (écrans, heures). Point vert = utilisé sur mobile ce jour-là.
                  La session restant ouverte d’un jour à l’autre, les jours actifs reflètent mieux l’usage que les connexions.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input placeholder="Rechercher un utilisateur" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...styles.input, width: 200 }} />
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} style={styles.input}>
                  <option value="jours">Tri : jours actifs</option>
                  <option value="pages">Tri : pages vues</option>
                  <option value="mobile">Tri : part mobile</option>
                  <option value="derniere">Tri : dernière activité</option>
                  <option value="nom">Tri : nom</option>
                </select>
                <div style={styles.segment}>
                  <button onClick={() => setCellMode('pages')} style={{ ...styles.segBtn, ...(cellMode === 'pages' ? styles.segBtnActive : {}) }}>Pages</button>
                  <button onClick={() => setCellMode('logins')} style={{ ...styles.segBtn, ...(cellMode === 'logins' ? styles.segBtnActive : {}) }}>Connexions</button>
                </div>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, ...styles.stickyCol, textAlign: 'left', minWidth: 190 }}>Utilisateur</th>
                    {jours.map((j) => {
                      const h = jourEntete(j)
                      return (
                        <th key={j} style={{ ...styles.th, minWidth: 46, color: h.weekend ? C.faint : C.muted }}>
                          <div style={{ fontSize: 10 }}>{h.semaine}</div>
                          <div>{h.date}</div>
                        </th>
                      )
                    })}
                    <th style={styles.th}>Jours</th>
                    <th style={styles.th}>Pages</th>
                    <th style={styles.th}>Conn.</th>
                    <th style={styles.th}>Mobile</th>
                    <th style={{ ...styles.th, textAlign: 'left' }}>Dernière activité</th>
                  </tr>
                </thead>
                <tbody>
                  {utilisateurs.map((u) => {
                    const parJour = new Map(u.par_jour.map((j) => [j.jour, j]))
                    return (
                      <tr key={u.email} onClick={() => setSelected(u)} style={styles.trClickable}>
                        <td style={{ ...styles.td, ...styles.stickyCol, textAlign: 'left' }}>
                          <div style={{ fontWeight: 600 }}>{u.nom}</div>
                          <div style={{ color: C.faint, fontSize: 11 }}>{u.email.split('@')[0]}</div>
                        </td>
                        {jours.map((j) => {
                          const v = parJour.get(j)
                          const n = v ? (cellMode === 'pages' ? v.pages : v.logins) : 0
                          const actif = !!v && (v.pages > 0 || v.logins > 0)
                          const alpha = actif ? 0.12 + 0.68 * Math.min(1, n / maxCell) : 0
                          return (
                            <td
                              key={j}
                              title={v ? `${jourEntete(j).date} — ${v.pages} page(s) dont ${v.pages_mobile} mobile, ${v.logins} connexion(s), ${fmtHeure(v.premiere)} → ${fmtHeure(v.derniere)}` : `${jourEntete(j).date} — aucune activité`}
                              style={{ ...styles.td, background: actif ? `rgba(166,161,129,${alpha.toFixed(2)})` : 'transparent', position: 'relative' }}
                            >
                              {actif ? (
                                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{n}</span>
                              ) : (
                                <span style={{ color: C.faint }}>·</span>
                              )}
                              {v && v.pages_mobile > 0 && <span style={styles.mobileDot} />}
                            </td>
                          )
                        })}
                        <td style={styles.tdNum}>{u.jours_actifs}</td>
                        <td style={styles.tdNum}>{fmtInt(u.pages)}</td>
                        <td style={styles.tdNum}>{fmtInt(u.logins)}</td>
                        <td style={styles.tdNum}>{pct(u.pages_mobile, u.pages)}</td>
                        <td style={{ ...styles.td, textAlign: 'left', color: C.muted, whiteSpace: 'nowrap' }}>{fmtDateHeure(u.derniere_activite)}</td>
                      </tr>
                    )
                  })}
                  {utilisateurs.length === 0 && (
                    <tr><td colSpan={jours.length + 6} style={{ ...styles.td, color: C.faint, padding: 20 }}>Aucun utilisateur</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={styles.twoCols}>
            {/* Écrans */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Écrans consultés</div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, textAlign: 'left' }}>Écran</th>
                    <th style={styles.th}>Support</th>
                    <th style={styles.th}>Vues</th>
                    <th style={styles.th}>Utilisateurs</th>
                    <th style={{ ...styles.th, textAlign: 'left' }}>Dernière vue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ecrans.map((e) => (
                    <tr key={e.ecran}>
                      <td style={{ ...styles.td, textAlign: 'left' }}>
                        <div style={{ fontWeight: 600 }}>{ecranLabel(e.ecran)}</div>
                        <div style={{ color: C.faint, fontSize: 11 }}>{e.ecran}</div>
                      </td>
                      <td style={styles.td}><SupportBadge mobile={isMobilePath(e.ecran)} /></td>
                      <td style={styles.tdNum}>{fmtInt(e.vues)}</td>
                      <td style={styles.tdNum}>{e.utilisateurs}</td>
                      <td style={{ ...styles.td, textAlign: 'left', color: C.muted, whiteSpace: 'nowrap' }}>{fmtDateHeure(e.derniere_vue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Inactifs */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Comptes sans activité sur la période ({data.inactifs.length})</div>
              <div style={{ color: C.faint, fontSize: 12, marginBottom: 8 }}>
                Comptes déclarés dans les autorisations qui n’ont ouvert aucune page entre le {jourEntete(data.meta.debut).date} et le {jourEntete(data.meta.fin).date}.
              </div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, textAlign: 'left' }}>Utilisateur</th>
                    <th style={{ ...styles.th, textAlign: 'left' }}>Dernière activité connue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.inactifs.map((i) => (
                    <tr key={i.email}>
                      <td style={{ ...styles.td, textAlign: 'left' }}>
                        <div style={{ fontWeight: 600 }}>{i.nom}</div>
                        <div style={{ color: C.faint, fontSize: 11 }}>{i.email}</div>
                      </td>
                      <td style={{ ...styles.td, textAlign: 'left', color: i.derniere_activite ? C.muted : C.alerte }}>
                        {fmtDateHeure(i.derniere_activite)}
                      </td>
                    </tr>
                  ))}
                  {data.inactifs.length === 0 && (
                    <tr><td colSpan={2} style={{ ...styles.td, color: C.faint, padding: 16 }}>Tous les comptes ont été actifs.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {selected && <UserDetail user={selected} jours={jours} onClose={() => setSelected(null)} />}
    </div>
  )
}

// ── Composants ─────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={styles.kpi}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, color: accent || C.text }}>{value}</div>
      {sub && <div style={{ color: C.faint, fontSize: 12 }}>{sub}</div>}
    </div>
  )
}

function SupportBadge({ mobile }: { mobile: boolean }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
      color: mobile ? C.mobile : C.pc,
      background: mobile ? 'rgba(63,182,139,0.12)' : 'rgba(91,141,239,0.12)',
    }}>
      {mobile ? 'Mobile' : 'PC'}
    </span>
  )
}

/** Barres : pages PC + pages mobile empilées, utilisateurs actifs en libellé. */
function JoursChart({ jours }: { jours: JourTotal[] }) {
  const max = Math.max(1, ...jours.map((j) => j.pages))
  const hauteur = 150
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, fontSize: 12, color: C.muted, marginBottom: 10 }}>
        <span><span style={{ ...styles.legendSwatch, background: C.pc }} />Pages PC</span>
        <span><span style={{ ...styles.legendSwatch, background: C.mobile }} />Pages mobile</span>
        <span style={{ color: C.faint }}>Nombre au-dessus de la barre = utilisateurs actifs</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: hauteur + 34, overflowX: 'auto', paddingBottom: 2 }}>
        {jours.map((j) => {
          const h = jourEntete(j.jour)
          const hPc = ((j.pages - j.pages_mobile) / max) * hauteur
          const hMob = (j.pages_mobile / max) * hauteur
          return (
            <div
              key={j.jour}
              title={`${h.semaine} ${h.date} — ${j.utilisateurs} utilisateur(s) actif(s) dont ${j.utilisateurs_mobile} sur mobile, ${j.pages} page(s) dont ${j.pages_mobile} mobile, ${j.logins} connexion(s)`}
              style={{ flex: '1 0 26px', maxWidth: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: j.utilisateurs ? C.text : C.faint, marginBottom: 3 }}>{j.utilisateurs || ''}</div>
              <div style={{ width: '70%', height: hMob, background: C.mobile, borderRadius: hPc ? '3px 3px 0 0' : 3 }} />
              <div style={{ width: '70%', height: hPc, background: C.pc, borderRadius: hMob ? 0 : '3px 3px 0 0' }} />
              <div style={{ fontSize: 10, color: h.weekend ? C.faint : C.muted, marginTop: 4, whiteSpace: 'nowrap' }}>{h.date}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function UserDetail({ user, jours, onClose }: { user: UserStat; jours: string[]; onClose: () => void }) {
  const parJour = new Map(user.par_jour.map((j) => [j.jour, j]))
  const maxVues = Math.max(1, ...user.ecrans.map((e) => e.vues))

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>{user.nom}</div>
            <div style={{ color: C.muted, fontSize: 13 }}>{user.email}</div>
          </div>
          <button onClick={onClose} style={styles.btn} aria-label="Fermer">✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, margin: '16px 0' }}>
          <MiniKpi label="Jours actifs" value={String(user.jours_actifs)} />
          <MiniKpi label="Pages" value={fmtInt(user.pages)} />
          <MiniKpi label="Connexions" value={fmtInt(user.logins)} />
          <MiniKpi label="Mobile" value={pct(user.pages_mobile, user.pages)} />
        </div>

        <div style={styles.sectionTitle}>Écrans consultés</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
          {user.ecrans.map((e) => (
            <div key={e.ecran} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 34px', gap: 8, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {ecranLabel(e.ecran)} <SupportBadge mobile={isMobilePath(e.ecran)} />
                </div>
              </div>
              <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
                <div style={{ width: `${(e.vues / maxVues) * 100}%`, height: 6, borderRadius: 3, background: isMobilePath(e.ecran) ? C.mobile : C.pc }} />
              </div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{e.vues}</div>
            </div>
          ))}
          {user.ecrans.length === 0 && <div style={{ color: C.faint, fontSize: 13 }}>Aucune page vue (connexions seules).</div>}
        </div>

        <div style={styles.sectionTitle}>Jour par jour</div>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={{ ...styles.th, textAlign: 'left' }}>Jour</th>
              <th style={styles.th}>Pages</th>
              <th style={styles.th}>dont mobile</th>
              <th style={styles.th}>Conn.</th>
              <th style={styles.th}>Première</th>
              <th style={styles.th}>Dernière</th>
            </tr>
          </thead>
          <tbody>
            {[...jours].reverse().map((j) => {
              const v = parJour.get(j)
              const h = jourEntete(j)
              return (
                <tr key={j} style={{ opacity: v ? 1 : 0.4 }}>
                  <td style={{ ...styles.td, textAlign: 'left' }}>{h.semaine} {h.date}</td>
                  <td style={styles.tdNum}>{v?.pages ?? 0}</td>
                  <td style={styles.tdNum}>{v?.pages_mobile ?? 0}</td>
                  <td style={styles.tdNum}>{v?.logins ?? 0}</td>
                  <td style={styles.tdNum}>{fmtHeure(v?.premiere ?? null)}</td>
                  <td style={styles.tdNum}>{fmtHeure(v?.derniere ?? null)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ fontSize: 11, color: C.faint }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100%',
    background: C.marine,
    color: C.text,
    padding: '24px 28px 48px',
    fontFamily: 'var(--font-body)',
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' },
  kicker: { fontFamily: 'var(--font-mono, monospace)', fontSize: 11, letterSpacing: 2, color: C.sauge, marginBottom: 4 },
  title: { fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, margin: '0 0 4px' },
  toolbar: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' },
  segment: { display: 'inline-flex', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 3, gap: 2, flexWrap: 'wrap' },
  segBtn: { background: 'transparent', color: C.muted, border: 'none', borderRadius: 7, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  segBtnActive: { background: C.text, color: C.marine },
  input: { background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 13, colorScheme: 'dark' as any },
  btn: { background: 'transparent', color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnPrimary: { background: C.sauge, color: C.marine, border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  error: { background: 'rgba(193,104,60,0.15)', border: `1px solid ${C.alerte}`, color: C.text, borderRadius: 10, padding: '10px 14px' },
  empty: { color: C.muted, padding: 40, textAlign: 'center' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  kpi: { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px' },
  kpiLabel: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: C.muted },
  kpiValue: { fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, margin: '4px 0 2px' },
  card: { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', minWidth: 0 },
  cardHead: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 },
  cardTitle: { fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, marginBottom: 6 },
  sectionTitle: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: C.sauge, margin: '6px 0 8px' },
  twoCols: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 18, alignItems: 'start' },
  table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 },
  th: { position: 'sticky', top: 0, background: C.panel, color: C.muted, fontWeight: 600, fontSize: 11, textAlign: 'center', padding: '6px 6px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' },
  td: { padding: '6px 6px', borderBottom: `1px solid rgba(255,255,255,0.05)`, textAlign: 'center' },
  tdNum: { padding: '6px 8px', borderBottom: `1px solid rgba(255,255,255,0.05)`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  stickyCol: { position: 'sticky', left: 0, background: C.panel, zIndex: 1 },
  trClickable: { cursor: 'pointer' },
  mobileDot: { position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: 3, background: C.mobile },
  legendSwatch: { display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6, verticalAlign: 'middle' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', justifyContent: 'flex-end' },
  drawer: { width: 'min(560px, 100vw)', height: '100%', overflowY: 'auto', background: C.marine, borderLeft: `1px solid ${C.border}`, padding: '20px 22px', color: C.text },
}
