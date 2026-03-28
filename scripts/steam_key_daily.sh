#!/usr/bin/env bash
set -euo pipefail

# Steam key daily inspection wrapper:
# ./scripts/steam_key_daily.sh --state-path tools/steam_key_daily/state.local.json --dry-run
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "${ROOT_DIR}/tools/steam_key_daily/inspect.mjs" ]]; then
  echo "error: inspect script not found in ${ROOT_DIR}/tools/steam_key_daily/inspect.mjs" >&2
  exit 1
fi

exec node "${ROOT_DIR}/tools/steam_key_daily/inspect.mjs" "$@"
