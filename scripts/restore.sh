#!/usr/bin/env bash
# Ripristino di una copia in un database VUOTO e separato (mai sopra quello in uso).
# Uso:  TARGET_URL=postgres://.../nuovo_db scripts/restore.sh file.dump
# Poi controlla i numeri con:  TARGET_URL=... scripts/verify-restore.sh
set -euo pipefail
: "${TARGET_URL:?imposta TARGET_URL (un database vuoto)}"
f="${1:?indica il file .dump}"
[ -f "$f.sha256" ] && (cd "$(dirname "$f")" && sha256sum -c "$(basename "$f").sha256")
n=$(psql "$TARGET_URL" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")
[ "$n" = "0" ] || { echo "Il database di destinazione non è vuoto ($n tabelle): ripristino annullato."; exit 1; }
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET_URL" "$f"
echo "Ripristino completato in $TARGET_URL"
