// lib/server/icsParser.ts
//
// Parseur iCalendar (.ics) minimal, suffisant pour un flux d'évènements en
// lecture seule (Yahoo Agenda, Google Calendar, etc. via lien de partage
// privé). Ne gère pas les règles de récurrence (RRULE) : les évènements
// récurrents n'apparaissent qu'à leur première occurrence — suffisant pour
// une maquette/test, à améliorer si besoin en production.

export type IcsEvent = {
  id: string;
  subject: string;
  start: string; // ISO
  end: string;   // ISO
  isAllDay: boolean;
  location: string | null;
  categories: string[];
};

function unfoldLines(raw: string): string[] {
  // RFC 5545 : une ligne qui continue la précédente commence par un espace
  // ou une tabulation.
  const rawLines = raw.split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseDate(value: string, params: Record<string, string>): { iso: string; isAllDay: boolean } {
  // VALUE=DATE (journée entière) : "20260815"
  if (params.VALUE === "DATE" || /^\d{8}$/.test(value)) {
    const y = value.slice(0, 4), m = value.slice(4, 6), d = value.slice(6, 8);
    return { iso: `${y}-${m}-${d}T00:00:00`, isAllDay: true };
  }
  // "20260815T090000Z" (UTC) ou "20260815T090000" (heure locale, TZID le cas échéant — non convertie, traitée telle quelle)
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (m) {
    const [, y, mo, d, h, mi, s, z] = m;
    const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? "Z" : ""}`;
    return { iso, isAllDay: false };
  }
  return { iso: value, isAllDay: false };
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

export function parseIcs(raw: string): IcsEvent[] {
  const lines = unfoldLines(raw);
  const events: IcsEvent[] = [];
  let current: Partial<IcsEvent> & { _startParams?: Record<string, string> } = {};
  let inEvent = false;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      current = { categories: [] };
      continue;
    }
    if (line === "END:VEVENT") {
      if (inEvent && current.start && current.end) {
        events.push({
          id: current.id || `${current.start}-${current.subject}`,
          subject: current.subject || "(Sans titre)",
          start: current.start,
          end: current.end,
          isAllDay: Boolean(current.isAllDay),
          location: current.location || null,
          categories: current.categories || [],
        });
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    const sepIdx = line.indexOf(":");
    if (sepIdx === -1) continue;
    const rawKey = line.slice(0, sepIdx);
    const value = line.slice(sepIdx + 1);
    const [key, ...paramParts] = rawKey.split(";");
    const params: Record<string, string> = {};
    paramParts.forEach((p) => {
      const [pk, pv] = p.split("=");
      if (pk && pv) params[pk.toUpperCase()] = pv;
    });

    switch (key.toUpperCase()) {
      case "UID":
        current.id = value;
        break;
      case "SUMMARY":
        current.subject = unescapeText(value);
        break;
      case "LOCATION":
        current.location = unescapeText(value);
        break;
      case "CATEGORIES":
        current.categories = value.split(",").map((c) => unescapeText(c.trim())).filter(Boolean);
        break;
      case "DTSTART": {
        const { iso, isAllDay } = parseDate(value, params);
        current.start = iso;
        current.isAllDay = isAllDay;
        break;
      }
      case "DTEND": {
        const { iso } = parseDate(value, params);
        current.end = iso;
        break;
      }
      default:
        break;
    }
  }

  return events;
}

/**
 * Récupère et parse un flux ICS distant (lien de partage Yahoo/Google/etc.).
 *
 * Certains fournisseurs (Yahoo en tête, protégé par un pare-feu anti-robots
 * de type Akamai/PerimeterX) renvoient un 403 aux requêtes serveur-à-serveur
 * sans en-têtes de navigateur — même sur un lien de partage public/privé
 * parfaitement valide. On simule donc un vrai navigateur (User-Agent,
 * Accept, Accept-Language) pour maximiser les chances de passer.
 */
export async function fetchIcsEvents(url: string): Promise<IcsEvent[]> {
  // "webcal://" n'est qu'un raccourci d'affichage pour les clients de
  // messagerie — le contenu est servi en https classique.
  const httpUrl = url.replace(/^webcal:\/\//i, "https://");
  const res = await fetch(httpUrl, {
    headers: {
      Accept: "text/calendar, text/plain, */*",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) {
    const bodySnippet = await res.text().catch(() => "");
    throw new Error(
      `Lecture du flux ICS impossible (HTTP ${res.status})${
        res.status === 403
          ? " — le fournisseur bloque probablement les requêtes serveur (pare-feu anti-robots). Vérifie que le lien est toujours actif, ou essaie de le régénérer."
          : ""
      }${bodySnippet ? ` : ${bodySnippet.slice(0, 200)}` : ""}`,
    );
  }
  const text = await res.text();
  return parseIcs(text);
}
