/**
 * Lecture d'une page de suivi container copiée depuis le site de l'armateur
 * (Ctrl+A / Ctrl+C) ou envoyée par le favori « Envoyer au compagnon ».
 * ---------------------------------------------------------------------------
 * Créé le 23/10/2026 pour l'écran Portefeuille commandes fournisseurs
 * (/stock/portefeuille-cdf). Aucune API payante : on lit le TEXTE affiché par
 * le site public de l'armateur, puis l'utilisateur vérifie avant d'enregistrer.
 *
 * Armateurs lus : MSC (msc.com, « POD ETA ») et CMA CGM (cma-cgm.com,
 * « ETA BERTH AT POD »). Si la page change de présentation, les champs non
 * reconnus restent vides : rien de faux n'est proposé.
 */

export type StatutSuiviLu = 'booke' | 'embarque' | 'en_mer' | 'arrive' | 'decharge' | 'livre'

export type SuiviLu = {
  armateur: 'MSC' | 'CMA' | null
  container: string | null
  navire: string | null
  voyage: string | null
  port_arrivee: string | null
  eta_port: string | null          // AAAA-MM-JJ
  statut: StatutSuiviLu | null
  dernier_evenement: string | null // libellé lu, pour information
  champs_lus: number               // nombre de champs reconnus (hors armateur)
}

const MOIS_EN: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
}

/** Contrôle ISO 6346 (même règle que appro_container_valide côté SQL). */
export function containerValide(v: string): boolean {
  const s = v.toUpperCase().replace(/[\s\-./]/g, '')
  if (!/^[A-Z]{3}[UJZ][0-9]{7}$/.test(s)) return false
  let total = 0
  for (let i = 0; i < 10; i++) {
    const c = s[i]
    let val: number
    if (/[0-9]/.test(c)) val = Number(c)
    else { const n = c.charCodeAt(0) - 55; val = n + Math.floor((n - 1) / 10) }
    total += val * 2 ** i
  }
  return (total % 11) % 10 === Number(s[10])
}

function premierContainer(texte: string): string | null {
  const re = /\b([A-Z]{3}[UJZ])\s?(\d{6})\s?-?\s?(\d)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(texte.toUpperCase())) !== null) {
    const c = `${m[1]}${m[2]}${m[3]}`
    if (containerValide(c)) return c
  }
  return null
}

function dateFr(j: string, m: string, a: string): string | null {
  const d = new Date(`${a}-${m}-${j}T12:00:00`)
  return Number.isNaN(d.getTime()) ? null : `${a}-${m}-${j}`
}

function capitaliser(v: string): string {
  return v.toLowerCase().replace(/(^|[\s\-'])([a-zà-ÿ])/g, (_, a: string, b: string) => a + b.toUpperCase()).trim()
}

/** Statut à partir d'un libellé d'événement (MSC ou CMA CGM). */
function statutDepuisEvenement(ev: string): StatutSuiviLu | null {
  const e = ev.toUpperCase()
  if (/EMPTY RETURN|EMPTY IN DEPOT|EMPTY TO SHIPPER/.test(e) && !/LOADED/.test(e)) return /RETURN|IN DEPOT/.test(e) ? 'livre' : 'booke'
  if (/DELIVER|TO CONSIGNEE|GATE OUT|GATED OUT|IMPORT TO CONSIGNEE|ON RAIL|TRUCK/.test(e) && /IMPORT|CONSIGNEE|DELIVER/.test(e)) return 'livre'
  if (/DISCHARG/.test(e) && /IMPORT|POD|FOS|DESTINATION/.test(e)) return 'decharge'
  if (/VESSEL ARRIVAL|ARRIVED|ARRIVAL AT POD/.test(e) && !/PLANNED|ESTIMATED/.test(e)) return 'arrive'
  if (/LOADED ON VESSEL|VESSEL DEPARTURE|TRANSHIPMENT|TRANSSHIPMENT|LOADED/.test(e) && !/PLANNED|BARGE/.test(e)) return 'en_mer'
  if (/EXPORT|GATE IN|RECEIVED|BARGE|EMPTY/.test(e)) return 'embarque'
  return null
}

// ─── MSC ────────────────────────────────────────────────────────────────────
// Texte type (copie de msc.com) :
//   Container MSNU9412225 … POD ETA 15/11/2026
//   15/11/2026  Fos-Sur-Mer, FR  Estimated Time of Arrival  MSC ALLEGRA GJ645E
//   06/10/2026  Shanghai, CN     Export Loaded on Vessel    MSC ALLEGRA GJ637W …
function lireMsc(t: string, r: SuiviLu) {
  const eta = t.match(/POD\s+ETA\s*[:\n\t ]*\s*(\d{2})\/(\d{2})\/(\d{4})/i)
  if (eta) r.eta_port = dateFr(eta[1], eta[2], eta[3])

  // Ligne « Estimated Time of Arrival » : port et navire d'arrivée
  const lignes = t.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const blocs: { date: string; texte: string }[] = []
  let courant: { date: string; texte: string } | null = null
  for (const l of lignes) {
    const d = l.match(/^(\d{2}\/\d{2}\/\d{4})\b(.*)$/)
    if (d) { courant = { date: d[1], texte: d[2] }; blocs.push(courant) }
    else if (courant) courant.texte += ' ' + l
  }
  const arrivee = blocs.find((b) => /Estimated Time of Arrival/i.test(b.texte))
  if (arrivee) {
    const port = arrivee.texte.match(/^\s*([^,\t]+?),\s*[A-Z]{2}\b/)
    if (port) r.port_arrivee = capitaliser(port[1])
    const nav = arrivee.texte.match(/\b(MSC\s+[A-Z][A-Z0-9 ]*?)\s+([A-Z]{2}\d{3}[A-Z])\b/)
    if (nav) { r.navire = nav[1].replace(/\s+/g, ' ').trim(); r.voyage = nav[2] }
    if (!r.eta_port) { const [j, m, a] = arrivee.date.split('/'); r.eta_port = dateFr(j, m, a) }
  }
  if (!r.navire) {
    const nav = t.match(/\b(MSC\s+[A-Z][A-Z0-9 ]*?)\s+([A-Z]{2}\d{3}[A-Z])\b/)
    if (nav) { r.navire = nav[1].replace(/\s+/g, ' ').trim(); r.voyage = nav[2] }
  }
  // Dernier événement réel = premier bloc daté qui n'est pas l'ETA (liste décroissante)
  // (un bloc d'événement porte un lieu « Ville, XX » ; écarte la date seule du bandeau « POD ETA »)
  const reel = blocs.find((b) => !/Estimated Time of Arrival/i.test(b.texte) && /^\s*[^,\t]+,\s*[A-Z]{2}\b/.test(b.texte))
  if (reel) {
    const desc = reel.texte.match(/(Export[^\t\n]*?|Import[^\t\n]*?|Full[^\t\n]*?|Empty[^\t\n]*?|Gate[^\t\n]*?|Transshipment[^\t\n]*?|Loaded[^\t\n]*?|Discharged[^\t\n]*?)(?:\s{2,}|\t|\s+(?:MSC|LADEN|EMPTY)\b|$)/i)
    r.dernier_evenement = (desc ? desc[1] : reel.texte).replace(/\s+/g, ' ').trim().slice(0, 80) || null
    if (r.dernier_evenement) r.statut = statutDepuisEvenement(r.dernier_evenement)
  }
}

// ─── CMA CGM ────────────────────────────────────────────────────────────────
// Texte type (copie de cma-cgm.com) :
//   Tracking details VESSEL DEPARTURE Container CMAU6986991 …
//   POD FOS SUR MER (FR) … ETA BERTH AT POD Fri 06-NOV-2026 08:00 PM …
//   Friday, 06-NOV-2026 08:00 PM PLANNED VESSEL ARRIVAL FOS SUR MER … CMA CGM MARCO POLO ( 0MEOUE1MA)
function lireCma(t: string, r: SuiviLu) {
  const up = t.toUpperCase()
  // ETA du bandeau ; à défaut, date de la ligne « PLANNED VESSEL ARRIVAL »
  let eta = up.match(/ETA\s+BERTH\s+AT\s+POD[\s\S]{0,30}?(\d{2})-([A-Z]{3})-(\d{4})/)
  if (!eta) eta = up.match(/(\d{2})-([A-Z]{3})-(\d{4})[\s\S]{0,60}?PLANNED\s+VESSEL\s+ARRIVAL/)
  if (eta && MOIS_EN[eta[2]]) r.eta_port = dateFr(eta[1], MOIS_EN[eta[2]], eta[3])

  // Port de destination : dernier « POD <PORT> (XX) » (le premier peut être le POL)
  const pods = Array.from(up.matchAll(/\bPOD\b\s*\n?\s*([A-Z][A-Z \-']+?)\s*\(([A-Z]{2})\)/g))
  const pod = pods.find((p) => p[2] === 'FR') || pods[pods.length - 1]
  if (pod) r.port_arrivee = capitaliser(pod[1])

  // Navire : celui de l'arrivée prévue, sinon le dernier cité
  const navires = Array.from(up.matchAll(/(CMA\s+CGM\s+[A-Z0-9][A-Z0-9 ]*?)\s*\(\s*([A-Z0-9]+)\s*\)/g))
  const idxArr = up.search(/PLANNED\s+VESSEL\s+ARRIVAL|VESSEL\s+ARRIVAL/)
  const nav = (idxArr >= 0 ? navires.find((n) => (n.index ?? 0) > idxArr) : undefined) || navires[navires.length - 1]
  if (nav) { r.navire = nav[1].replace(/\s+/g, ' ').trim(); r.voyage = nav[2] }

  // Statut : badge d'en-tête « Tracking details <STATUT> »
  const badge = up.match(/TRACKING\s+DETAILS\s*\n?\s*([A-Z][A-Z ]{3,40}?)\s*\n?\s*CONTAINER\b/)
  if (badge) {
    r.dernier_evenement = capitaliser(badge[1])
    r.statut = statutDepuisEvenement(badge[1])
  }
}

export function lireSuiviContainer(texte: string): SuiviLu {
  const t = (texte || '').replace(/\r/g, '').replace(/ /g, ' ')
  const up = t.toUpperCase()
  const r: SuiviLu = {
    armateur: null, container: premierContainer(t), navire: null, voyage: null,
    port_arrivee: null, eta_port: null, statut: null, dernier_evenement: null, champs_lus: 0,
  }
  if (/ETA\s+BERTH\s+AT\s+POD|CMA\s+CGM|CMA-CGM/.test(up)) r.armateur = 'CMA'
  else if (/POD\s+ETA|MSC\.COM|\bMSC\s+[A-Z]/.test(up)) r.armateur = 'MSC'

  if (r.armateur === 'CMA') lireCma(t, r)
  else if (r.armateur === 'MSC') lireMsc(t, r)

  r.champs_lus = [r.container, r.navire, r.port_arrivee, r.eta_port, r.statut].filter(Boolean).length
  return r
}
