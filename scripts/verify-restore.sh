#!/usr/bin/env bash
# Conta le righe delle tabelle principali: serve a confrontare database originale e database ripristinato.
# Uso:  TARGET_URL=postgres://... scripts/verify-restore.sh
set -euo pipefail
: "${TARGET_URL:?imposta TARGET_URL}"
for t in users contracts suppliers supplier_documents tasks task_documents contract_drafts draft_comments clause_library po_lines sap_pos mp_lines config_audit audit_log security_events; do
  printf '%-22s %s\n' "$t" "$(psql "$TARGET_URL" -Atc "select count(*) from $t" 2>/dev/null || echo "assente")"
done
