#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Absensi BIGNET — Automated Production Backup Wrapper (Cron / Manual)
# Contoh cron harian pukul 01:30 WIB:
#   30 1 * * * cd /var/www/absensi-bignet && /bin/bash scripts/backup/backup.sh >> logs/backup.log 2>&1
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${APP_ROOT}"

export TZ="${TZ:-Asia/Jakarta}"

if command -v npx >/dev/null 2>&1; then
  npx tsx scripts/backup/backup.ts "$@"
else
  echo "[BACKUP] Error: npx/tsx tidak ditemukan pada PATH." >&2
  exit 1
fi
