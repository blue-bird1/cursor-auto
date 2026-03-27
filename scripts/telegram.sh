#!/usr/bin/env bash
set -euo pipefail

# Self-use wrapper for automation environments:
# ./scripts/telegram.sh send --text "hello"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "${ROOT_DIR}/package.json" ]]; then
  echo "error: package.json not found in ${ROOT_DIR}" >&2
  exit 1
fi

if [[ ! -d "${ROOT_DIR}/node_modules" ]]; then
  echo "Installing dependencies..." >&2
  npm install --prefix "${ROOT_DIR}" >/dev/null
fi

exec npx --yes --prefix "${ROOT_DIR}" tsx "${ROOT_DIR}/src/cli.ts" "$@"
