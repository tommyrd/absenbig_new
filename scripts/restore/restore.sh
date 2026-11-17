#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Absensi BIGNET — Production Restore Wrapper
# Penting: Hentikan proses server terlebih dahulu (pm2 stop absensi-bignet)
# sebelum menjalankan restore agar tidak ada write aktif saat file DB diganti.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${APP_ROOT}"

export TZ="${TZ:-Asia/Jakarta}"

if command -v npx >/dev/null 2>&1; then
  npx tsx scripts/restore/restore.ts "$@"
else
  echo "[RESTORE] Error: npx/tsx tidak ditemukan pada PATH." >&2
  exit 1
fi
