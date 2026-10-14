#!/usr/bin/env bash
# Copia di sicurezza del database (formato personalizzato di pg_dump, compresso).
# Uso:  DATABASE_URL=postgres://... scripts/backup.sh [cartella]     (default: ./backups)
# Produce  <cartella>/procurement-lab-AAAAMMGG-HHMMSS.dump  e un file .sha256 con l'impronta.
# I file allegati (Vercel Blob) NON sono inclusi: vedi docs/OPERATIONS.md.
set -euo pipefail
: "${DATABASE_URL:?imposta DATABASE_URL}"
dir="${1:-backups}"; mkdir -p "$dir"
f="$dir/procurement-lab-$(date -u +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --no-privileges --file="$f" "$DATABASE_URL"
sha256sum "$f" > "$f.sha256"
echo "Copia creata: $f ($(du -h "$f" | cut -f1))"
