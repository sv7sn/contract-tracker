#!/usr/bin/env bash
# Esegue le suite di test dell'API contro un Postgres locale (una base di dati per ogni suite, ricreata da zero).
# Uso:  tests/run.sh              tutte le suite
#       tests/run.sh renewal clm  solo alcune
# Variabile: PGADMIN_URL = connessione con permesso di creare database (default postgres://postgres:pw@localhost:5432/postgres).
# SAP_SAMPLES = cartella con gli export SAP reali (pr.xls, po.xls) e mp27.xlsx: servono a 5 suite (budget, purchase, sourcing, spend, tasks), non sono nel repository.
# Richiede: Node 22+, psql, `npm install`. Gli upload su Vercel Blob e le email sono simulati (tests/fake-blob, VIES/sanzioni "mock").
set -uo pipefail
cd "$(dirname "$0")/.."
ADMIN="${PGADMIN_URL:-postgres://postgres:pw@localhost:5432/postgres}"
BASE="${ADMIN%/*}"
BUILD="$PWD/tests/.build"
rm -rf "$BUILD" && mkdir -p "$BUILD/node_modules/@vercel"
npx tsc -p tests/tsconfig.sim.json || exit 1
cp -r tests/fake-blob "$BUILD/node_modules/@vercel/blob"
ln -s "$PWD/node_modules/pg" "$BUILD/node_modules/pg"
echo '{"type":"module"}' > "$BUILD/package.json"
NEEDS_SAMPLES=" budget purchase sourcing spend tasks "
suites=("$@"); [ ${#suites[@]} -eq 0 ] && for f in tests/api/*.test.mjs; do b=$(basename "$f" .test.mjs); suites+=("$b"); done
fail=0; total=0
for s in "${suites[@]}"; do
  if [[ "$NEEDS_SAMPLES" == *" $s "* && ( -z "${SAP_SAMPLES:-}" || ! -f "${SAP_SAMPLES:-/nonexistent}/pr.xls" ) ]]; then echo "- $s: saltata (servono gli export SAP reali pr.xls, po.xls, mp27.xlsx in \$SAP_SAMPLES; non sono nel repository)"; continue; fi
  db="ct_test_${s}"
  psql "$ADMIN" -q -c "drop database if exists $db" -c "create database $db" >/dev/null 2>&1 || { echo "$s: impossibile creare il database"; fail=1; continue; }
  out=$(SAP_SAMPLES="${SAP_SAMPLES:-}" API_BUILD="$BUILD" TEST_DB_URL="$BASE/$db" VIES_MODE=mock SANCTIONS_PROVIDER="$([ "$s" = sanctions ] && echo "" || echo mock)" node "tests/api/$s.test.mjs" 2>&1); code=$?
  n=$(printf '%s\n' "$out" | grep -c '✓'); total=$((total + n))
  if [ $code -ne 0 ]; then echo "✗ $s ($n controlli prima dell'errore)"; printf '%s\n' "$out" | tail -8; fail=1; else echo "✓ $s ($n controlli)"; fi
done
echo "Totale: $total controlli"
exit $fail
