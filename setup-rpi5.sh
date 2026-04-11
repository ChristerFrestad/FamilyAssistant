#!/bin/bash
# ============================================
# Familieassistenten — Oppsett for Raspberry Pi 5
# Kjør dette skriptet én gang for å sette opp alt
# ============================================

set -e
echo "🏠 Setter opp Familieassistenten på Raspberry Pi 5..."

# 1. Sjekk Node.js
if ! command -v node &> /dev/null; then
  echo "📦 Installerer Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "✅ Node.js $(node -v)"

# 2. Installer avhengigheter (for fremtidig SQLite-oppgradering)
cd "$(dirname "$0")"
echo "📦 Installerer npm-pakker..."
npm install

# 3. Opprett data-mappe
mkdir -p data

# 4. Sett opp systemd-tjeneste for autostart
echo "⚙️ Setter opp systemd-tjeneste..."
sudo tee /etc/systemd/system/familieassistenten.service > /dev/null << EOF
[Unit]
Description=Familieassistenten - Husholdningsassistent
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=$(which node) server/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable familieassistenten
sudo systemctl start familieassistenten

echo ""
echo "============================================"
echo "🎉 Familieassistenten er oppe og kjører!"
echo ""
echo "📱 Åpne i nettleseren:"
echo "   http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "📱 iPhone-snarvei:"
echo "   1. Åpne URL over i Safari"
echo "   2. Trykk Del-knappen (firkant med pil opp)"
echo "   3. Velg 'Legg til på Hjem-skjerm'"
echo ""
echo "🔧 Nyttige kommandoer:"
echo "   sudo systemctl status familieassistenten"
echo "   sudo systemctl restart familieassistenten"
echo "   sudo journalctl -u familieassistenten -f"
echo "============================================"
