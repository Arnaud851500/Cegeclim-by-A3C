// lib/server/microsoftGraph.ts
//
// Client Microsoft Graph "app-only" (client credentials flow) : l'application
// s'authentifie elle-même auprès de Microsoft Entra (pas l'utilisateur), avec
// l'autorisation Application "Calendars.Read" consentie par un admin M365.
// Un jeton applicatif obtenu ainsi peut techniquement lire N'IMPORTE QUELLE
// messagerie du tenant — c'est pour ça que la route API vérifie SYSTÉMATIQUEMENT
// la table outlook_calendar_autorisations avant tout appel Graph : cette table
// est le véritable filtre d'accès côté métier, le rôle Microsoft Entra n'en
// est qu'un pré-requis technique.
//
// Variables d'environnement requises (Vercel / .env.local) :
//   MICROSOFT_TENANT_ID
//   MICROSOFT_CLIENT_ID
//   MICROSOFT_CLIENT_SECRET

const TENANT_ID     = process.env.MICROSOFT_TENANT_ID || "";
const CLIENT_ID     = process.env.MICROSOFT_CLIENT_ID || "";
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// ── Jeton applicatif : mis en cache en mémoire (par instance serverless),
// renouvelé un peu avant expiration. Suffisant ici : un jeton dure ~1h et le
// volume d'appels est faible (un écran de dashboard, pas un flux temps réel).
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAppOnlyAccessToken(): Promise<string> {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "Configuration Microsoft manquante : MICROSOFT_TENANT_ID / MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET doivent être définies."
    );
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Authentification Microsoft impossible (${res.status}) : ${text || res.statusText}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

async function graphFetch(path: string, init?: RequestInit) {
  const token = await getAppOnlyAccessToken();
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Microsoft Graph ${path} : HTTP ${res.status} — ${text || res.statusText}`);
  }
  return res.json();
}

// ── Couleurs de catégorie Outlook ───────────────────────────────────────────
// Microsoft Graph ne renvoie jamais un code hexadécimal directement sur un
// évènement : chaque évènement porte une liste de NOMS de catégorie
// (ex. "Red category"), et c'est le référentiel de catégories de la
// messagerie (masterCategories) qui associe un nom à une des 25 couleurs
// prédéfinies Outlook (preset0 à preset24). On mappe donc : nom → preset via
// masterCategories (mis en cache par mailbox), puis preset → hex via cette
// table fixe (valeurs officielles de la palette Outlook).
const OUTLOOK_PRESET_HEX: Record<string, string> = {
  preset0:  "#E74C3C", // Rouge
  preset1:  "#E67E22", // Orange
  preset2:  "#F1C40F", // Jaune citron
  preset3:  "#F4D03F", // Jaune clair
  preset4:  "#27AE60", // Vert
  preset5:  "#16A085", // Vert clair
  preset6:  "#1ABC9C", // Turquoise (Bleu sarcelle)
  preset7:  "#3498DB", // Bleu clair
  preset8:  "#2980B9", // Bleu
  preset9:  "#5DADE2", // Bleu marine
  preset10: "#8E44AD", // Violet
  preset11: "#AF7AC5", // Prune
  preset12: "#EC7063", // Rose vif
  preset13: "#D35400", // Rouille
  preset14: "#B7950B", // Or
  preset15: "#7F8C8D", // Gris foncé
  preset16: "#95A5A6", // Gris
  preset17: "#34495E", // Noir bleuté
  preset18: "#BDC3C7", // Blanc cassé (marqueur clair)
  preset19: "#C0392B", // Rouge foncé
  preset20: "#D68910", // Ambre
  preset21: "#229954", // Vert foncé
  preset22: "#148F77", // Sarcelle foncé
  preset23: "#2E4053", // Bleu ardoise
  preset24: "#76448A", // Violet foncé
};

const masterCategoriesCache = new Map<string, { map: Map<string, string>; expiresAt: number }>();

async function getCategoryColorMap(email: string): Promise<Map<string, string>> {
  const cached = masterCategoriesCache.get(email);
  if (cached && cached.expiresAt > Date.now()) return cached.map;

  const data = (await graphFetch(`/users/${encodeURIComponent(email)}/outlook/masterCategories`)) as {
    value: Array<{ displayName: string; color: string }>;
  };

  const map = new Map<string, string>();
  (data.value || []).forEach((c) => {
    const hex = OUTLOOK_PRESET_HEX[c.color] || null;
    if (hex) map.set(c.displayName, hex);
  });

  masterCategoriesCache.set(email, { map, expiresAt: Date.now() + 30 * 60_000 }); // 30 min
  return map;
}

// ── Évènements de calendrier ────────────────────────────────────────────────
export type OutlookEvent = {
  id: string;
  subject: string;
  start: string; // ISO, déjà en heure locale Europe/Paris (cf. header Prefer ci-dessous)
  end: string;
  isAllDay: boolean;
  location: string | null;
  categories: string[];
  colorHex: string | null;
  webLink: string | null;
};

/**
 * Récupère les évènements d'une messagerie autorisée sur une plage donnée.
 * startIso / endIso : dates ISO (YYYY-MM-DD ou datetime), interprétées par
 * Graph selon le header Prefer ci-dessous (Europe/Paris).
 */
export async function getCalendarEvents(email: string, startIso: string, endIso: string): Promise<OutlookEvent[]> {
  const params = new URLSearchParams({
    startDateTime: startIso,
    endDateTime: endIso,
    $orderby: "start/dateTime",
    $top: "250",
    $select: "id,subject,start,end,isAllDay,location,categories,webLink",
  });

  const [data, colorMap] = await Promise.all([
    graphFetch(`/users/${encodeURIComponent(email)}/calendarView?${params.toString()}`, {
      headers: { Prefer: 'outlook.timezone="Europe/Paris"' },
    }) as Promise<{ value: any[] }>,
    getCategoryColorMap(email).catch(() => new Map<string, string>()),
  ]);

  return (data.value || []).map((e) => {
    const firstCategory = Array.isArray(e.categories) && e.categories.length ? e.categories[0] : null;
    return {
      id: e.id,
      subject: e.subject || "(Sans titre)",
      start: e.start?.dateTime || e.start,
      end: e.end?.dateTime || e.end,
      isAllDay: Boolean(e.isAllDay),
      location: e.location?.displayName || null,
      categories: e.categories || [],
      colorHex: firstCategory ? colorMap.get(firstCategory) || null : null,
      webLink: e.webLink || null,
    };
  });
}
