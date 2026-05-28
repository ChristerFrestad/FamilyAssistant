#!/bin/bash
# FamilyAssistant — start script for Raspberry Pi 5
# Run: chmod +x start.sh && ./start.sh

set -e

echo "Starting FamilyAssistant..."

# Move to the project folder
cd "$(dirname "$0")"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "Node.js is not installed. Install with:"
  echo "   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "   sudo apt install -y nodejs"
  exit 1
fi

echo "Node.js $(node -v)"

# Check Ollama (optional)
if command -v ollama &> /dev/null; then
  echo "Ollama detected"
  # Start Ollama in the background if not already running
  if ! pgrep -x "ollama" > /dev/null; then
    echo "Starting Ollama..."
    ollama serve &
    sleep 3
  fi
  # Check whether the model is already pulled
  if ! ollama list | grep -q "qwen3"; then
    echo "Pulling Qwen 3 4B (this takes a few minutes)..."
    ollama pull qwen3:4b
  fi
else
  echo "Ollama not installed - chatbot disabled"
  echo "   Install: curl -fsSL https://ollama.com/install.sh | sh"
  echo "   Pull model: ollama pull qwen3:4b"
fi

# Start the server
echo ""
echo "Starting web server on port 3000..."
echo "Open on iPhone: http://$(hostname -I | awk '{print $1}'):3000"
echo "   Add as shortcut: Safari -> Share -> Add to Home Screen"
echo ""

node server/index.js
