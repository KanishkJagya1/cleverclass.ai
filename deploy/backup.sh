#!/usr/bin/env bash
#
# Nightly backup. Install with:
#   (crontab -l 2>/dev/null; echo "17 2 * * * bash /opt/cleverclass/deploy/backup.sh >> /opt/cleverclass/backups/backup.log 2>&1") | crontab -
#
# The PDFs are the only irreplaceable artefact here — the catalogue can be
# re-imported and the vector index can be rebuilt from the database, but a lost
# book PDF means asking the publisher for it again.
set -euo pipefail

ROOT=/opt/cleverclass
OUT="$ROOT/backups"
STAMP=$(date +%Y%m%d-%H%M)
KEEP_DAYS=14

mkdir -p "$OUT"

# sqlite3 .backup, NOT cp. Copying a WAL-mode database while a write is in
# flight yields a file that opens fine and is subtly corrupt; .backup takes a
# consistent snapshot of a live database.
docker exec cc-api python -c "
import sqlite3, sys
src = sqlite3.connect('/db/cleverclass.db')
dst = sqlite3.connect('/db/backup-tmp.db')
with dst:
    src.backup(dst)
dst.close(); src.close()
print('snapshot taken')
"
docker cp cc-api:/db/backup-tmp.db "$OUT/cleverclass-$STAMP.db"
docker exec cc-api rm -f /db/backup-tmp.db

gzip -f "$OUT/cleverclass-$STAMP.db"

# PDFs, weekly — they are large and they rarely change.
if [ "$(date +%u)" = "7" ]; then
  tar -czf "$OUT/media-$STAMP.tar.gz" -C "$ROOT" media/pdf 2>/dev/null || true
fi

find "$OUT" -name '*.gz' -mtime +$KEEP_DAYS -delete

echo "$(date -Iseconds) backup ok: $(ls -1 "$OUT"/*.gz | wc -l) archive(s), $(du -sh "$OUT" | cut -f1) total"

# ⚠ These backups are ON THE SAME DISK as the data they protect. That covers
# "someone deleted a book" but not "the disk died". Off-box replication (a GCS
# bucket, ~2 GB) is the remaining gap and should be added.
