#!/bin/bash
# ============================================
# FamilyAssistant — setup script for Raspberry Pi 5
# Run this script once to set up everything
# ============================================

set -e
echo "Setting up FamilyAssistant on Raspberry Pi 5..."

# 1. Check Node.js
if ! command -v node &> /dev/null; then
  echo "Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "Node.js $(node -v)"

# 2. Install dependencies (for future SQLite upgrade)
cd "$(dirname "$0")"
echo "Installing npm packages..."
npm install

# 3. Create data directory
mkdir -p data

# 4. Set up systemd service for autostart
echo "Setting up systemd service..."
sudo tee /etc/systemd/system/familieassistenten.service > /dev/null << EOF
[Unit]
Description=FamilyAssistant - household assistant
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
echo "FamilyAssistant is up and running."
echo ""
echo "Open in browser:"
echo "   http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "iPhone home-screen shortcut:"
echo "   1. Open the URL above in Safari"
echo "   2. Tap the Share button"
echo "   3. Choose 'Add to Home Screen'"
echo ""
echo "Useful commands:"
echo "   sudo systemctl status familieassistenten"
echo "   sudo systemctl restart familieassistenten"
echo "   sudo journalctl -u familieassistenten -f"
echo "============================================"
