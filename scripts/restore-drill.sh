#!/usr/bin/env bash
# Prova di ripristino: copia un database, lo ripristina in uno nuovo e confronta il numero di righe di TUTTE le tabelle.
# Uso:  SOURCE_URL=postgres://utente:pw@host/db_da_copiare ADMIN_URL=postgres://utente:pw@host/postgres scripts/restore-drill.sh
# Crea e poi elimina un database temporaneo; non tocca quello di origine (solo lettura).
set -euo pipefail
: "${SOURCE_URL:?imposta SOURCE_URL}"; : "${ADMIN_URL:?imposta ADMIN_URL (database con permesso di crearne altri)}"
here="$(cd "$(dirname "$0")" && pwd)"; tmp="$(mktemp -d)"; db="restore_drill_$(date -u +%H%M%S)"; base="${ADMIN_URL%/*}"
trap 'psql "$ADMIN_URL" -qc "drop database if exists $db" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
DATABASE_URL="$SOURCE_URL" "$here/backup.sh" "$tmp"
psql "$ADMIN_URL" -qc "create database $db"
f="$(ls "$tmp"/*.dump)"; TARGET_URL="$base/$db" "$here/restore.sh" "$f" >/dev/null
q="select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"
count() { for t in $(psql "$1" -Atc "$q"); do printf '%s %s\n' "$t" "$(psql "$1" -Atc "select count(*) from \"$t\"")"; done; }
count "$SOURCE_URL" > "$tmp/a.txt"; count "$base/$db" > "$tmp/b.txt"
tables=$(wc -l < "$tmp/a.txt"); rows=$(awk '{s+=$2} END {print s}' "$tmp/a.txt")
if diff -q "$tmp/a.txt" "$tmp/b.txt" >/dev/null; then echo "PROVA SUPERATA: $tables tabelle, $rows righe, identiche dopo il ripristino"; else echo "PROVA FALLITA: differenze nei conteggi"; diff "$tmp/a.txt" "$tmp/b.txt" || true; exit 1; fi
