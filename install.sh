#!/usr/bin/env bash
# WORDLESS installer wrapper (macOS / Linux).
# Checks for Node.js 20+ + npm, installs dependencies, then runs the wizard.
# No remote code is downloaded or executed beyond `npm install` from the
# project's own package.json. Arguments are passed through to the wizard,
# e.g. ./install.sh --local  (non-interactive local setup).
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null 2>&1 || { echo "Node.js 20+ is required: https://nodejs.org/" >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20+ is required (found $(node --version)): https://nodejs.org/" >&2
  exit 1
fi
command -v npm >/dev/null 2>&1 || { echo "npm is required (it ships with Node.js 20+)." >&2; exit 1; }

npm install
npm run setup -- "$@"
