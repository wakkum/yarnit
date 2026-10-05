#!/bin/bash
# Yarnit launcher for macOS (and Linux: run ./start.command). Double-click it in Finder.
# First run installs dependencies (a few minutes); later runs start in seconds.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Yarnit needs Node.js (version 22 or newer). Opening the download page..."
  open "https://nodejs.org/en/download" 2>/dev/null || xdg-open "https://nodejs.org/en/download" 2>/dev/null
  read -r -p "Install Node.js, then run this again. Press Enter to close."
  exit 1
fi
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)"; then
  echo "Your Node.js is $(node -v), Yarnit needs 22.12 or newer. Get it at https://nodejs.org"
  read -r -p "Press Enter to close."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing (this takes a few minutes)..."
  npm ci || { read -r -p "Install failed (see above). Press Enter to close."; exit 1; }
fi

echo "Starting Yarnit. It opens in your browser; keep this window open while you use it."
npm start
