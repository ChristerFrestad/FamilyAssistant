#!/bin/bash
# Familieassistenten — Oppstartskript for Raspberry Pi 5
# Kjør: chmod +x start.sh && ./start.sh

set -e

echo "🏠 Starter Familieassistenten..."

# Gå til prosjektmappen
cd "$(dirname "$0")"

# Sjekk Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js er ikke installert. Installer med:"
  echo "   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "   sudo apt install -y nodejs"
  exit 1
fi

echo "✅ Node.js $(node -v)"

# Sjekk Ollama (valgfritt)
if command -v ollama &> /dev/null; then
  echo "✅ Ollama funnet"
  # Start Ollama i bakgrunnen hvis ikke kjørende
  if ! pgrep -x "ollama" > /dev/null; then
    echo "🤖 Starter Ollama..."
    ollama serve &
    sleep 3
  fi
  # Sjekk om modellen er lastet ned
  if ! ollama list | grep -q "qwen3"; then
    echo "📦 Laster ned Qwen 3 4B (dette tar noen minutter)..."
    ollama pull qwen3:4b
  fi
else
  echo "⚠️  Ollama ikke installert — chatbot deaktivert"
  echo "   Installer: curl -fsSL https://ollama.com/install.sh | sh"
  echo "   Last ned modell: ollama pull qwen3:4b"
fi

# Start serveren
echo ""
echo "🚀 Starter webserver på port 3000..."
echo "📱 Åpne på iPhone: http://$(hostname -I | awk '{print $1}'):3000"
echo "   Legg til som snarvei: Safari → Del → Legg til på Hjem-skjerm"
echo ""

node server/index.js
