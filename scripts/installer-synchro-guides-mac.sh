#!/bin/bash
# ============================================================================
# scripts/installer-synchro-guides-mac.sh — Guides BLG : installe la synchronisation
# automatique depuis le dossier Teams synchronisé par OneDrive (09/11/2026)
# ----------------------------------------------------------------------------
# À lancer UNE fois dans le Terminal, depuis le dossier du projet :
#     bash scripts/installer-synchro-guides-mac.sh
# (optionnel : bash scripts/installer-synchro-guides-mac.sh "/chemin/du/dossier")
# Pour arrêter la synchronisation :
#     bash scripts/installer-synchro-guides-mac.sh --desinstaller
#
# Crée la tâche macOS « fr.cegeclim.guides-blg-sync » (launchd), qui lance
# scripts/guides-blg-sync.ts toutes les 5 minutes et à l'ouverture de session.
# Journal : ~/Library/Logs/cegeclim-guides-sync.log
# ============================================================================
set -eo pipefail

LABEL="fr.cegeclim.guides-blg-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/cegeclim-guides-sync.log"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" == "--desinstaller" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Synchronisation des guides arrêtée et désinstallée."
  exit 0
fi

echo "== Synchronisation des Guides BLG (OneDrive → compagnon) =="
echo "Projet : $REPO"

# 1) Node et dépendances ------------------------------------------------------
NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  echo "ERREUR : node introuvable. Ouvrez ce Terminal comme pour « npm run dev » puis relancez." >&2
  exit 1
fi
if [[ ! -f "$REPO/node_modules/tsx/dist/cli.mjs" || ! -d "$REPO/node_modules/linkedom" ]]; then
  echo "Installation des dépendances (npm install)…"
  (cd "$REPO" && npm install --no-audit --no-fund)
fi

# 2) Clés Supabase --------------------------------------------------------------
if ! grep -qE '^\s*SUPABASE_SERVICE_ROLE_KEY\s*=' "$REPO/.env.local" 2>/dev/null; then
  echo "ERREUR : SUPABASE_SERVICE_ROLE_KEY absent de $REPO/.env.local." >&2
  echo "Ajoutez la ligne SUPABASE_SERVICE_ROLE_KEY=… (Supabase › Project Settings › API keys) puis relancez." >&2
  exit 1
fi

# 3) Dossier des chapitres --------------------------------------------------------
DOSSIER="${1:-}"
if [[ -z "$DOSSIER" ]]; then
  CANDIDATS=()
  while IFS= read -r f; do
    d="$(dirname "$f")"
    [[ " ${CANDIDATS[*]-} " == *" $d "* ]] || CANDIDATS+=("$d")
  done < <(find "$HOME/Library/CloudStorage" -maxdepth 6 -iname 'CHAPITRE-*.html' -not -path '*RELECTURE*' 2>/dev/null)
  if [[ ${#CANDIDATS[@]} -eq 1 ]]; then
    DOSSIER="${CANDIDATS[0]}"
    echo "Dossier trouvé : $DOSSIER"
    read -r -p "C'est bien le dossier des chapitres à publier ? (o/n) " OK
    [[ "$OK" =~ ^[oOyY] ]] || DOSSIER=""
  elif [[ ${#CANDIDATS[@]} -gt 1 ]]; then
    echo "Plusieurs dossiers contiennent des fichiers CHAPITRE-*.html :"
    for i in "${!CANDIDATS[@]}"; do echo "  $((i + 1))) ${CANDIDATS[$i]}"; done
    read -r -p "Numéro du dossier à publier : " N
    DOSSIER="${CANDIDATS[$((N - 1))]:-}"
  fi
fi
if [[ -z "$DOSSIER" ]]; then
  echo "Glissez ici depuis le Finder le dossier qui contient les fichiers CHAPITRE-xxx.html, puis Entrée :"
  read -r DOSSIER
  DOSSIER="$(echo "$DOSSIER" | sed -e 's/[[:space:]]*$//')"
  DOSSIER="${DOSSIER%\'}"; DOSSIER="${DOSSIER#\'}"; DOSSIER="${DOSSIER//\\ / }"; DOSSIER="${DOSSIER%/}"
fi
if ! ls "$DOSSIER"/[Cc][Hh][Aa][Pp][Ii][Tt][Rr][Ee]-*.htm* >/dev/null 2>&1; then
  echo "ERREUR : aucun fichier CHAPITRE-*.html dans « $DOSSIER »." >&2
  echo "Vérifiez que OneDrive a bien synchronisé le dossier (clic droit › Toujours conserver sur cet appareil)." >&2
  exit 1
fi

# 4) Tâche launchd ------------------------------------------------------------------
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$NODE")</string>
    <string>$(xml "$REPO/node_modules/tsx/dist/cli.mjs")</string>
    <string>$(xml "$REPO/scripts/guides-blg-sync.ts")</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml "$REPO")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>GUIDES_BLG_DOSSIER</key><string>$(xml "$DOSSIER")</string>
    <key>PATH</key><string>$(xml "$(dirname "$NODE")"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG")</string>
</dict>
</plist>
EOF

# 5) Premier passage dans ce Terminal (macOS peut demander l'autorisation d'accès aux fichiers OneDrive)
echo
echo "Premier passage (publication des chapitres, quelques minutes)…"
(cd "$REPO" && GUIDES_BLG_DOSSIER="$DOSSIER" "$NODE" "$REPO/node_modules/tsx/dist/cli.mjs" "$REPO/scripts/guides-blg-sync.ts") | tee -a "$LOG"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo
echo "Installé : les chapitres modifiés dans Teams seront republiés automatiquement (vérification toutes les 5 minutes)."
echo "Journal : $LOG   (tail -f \"$LOG\" pour le suivre)"
