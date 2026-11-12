#!/bin/sh
# End-to-end check of backup and restore with Docker: back up a running container, restore into a
# fresh volume, start it, and confirm the data and files came back. Used by CI; safe to run locally.
#   IMAGE=ghcr.io/jurispuce/mcp-audit:latest scripts/backup-restore-check.sh
set -eu
IMAGE="${IMAGE:-ghcr.io/jurispuce/mcp-audit:latest}"
WORK="$(mktemp -d)"
PASS="backup check passphrase"
DOCKER="${DOCKER:-docker}"
cleanup() {
	$DOCKER rm -f mcpa-bk-src mcpa-bk-dst >/dev/null 2>&1 || true
	$DOCKER volume rm mcpa-bk-src mcpa-bk-dst >/dev/null 2>&1 || true
	rm -rf "$WORK"
}
trap cleanup EXIT

wait_healthy() {
	for _ in $(seq 1 60); do
		if $DOCKER exec "$1" node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then return 0; fi
		sleep 1
	done
	echo "container $1 did not become healthy"; $DOCKER logs "$1"; return 1
}

echo "1. Start a container with data"
$DOCKER run -d --name mcpa-bk-src -v mcpa-bk-src:/data -e TEST_SEED_ENABLED=true -e BACKUP_PASSPHRASE="$PASS" "$IMAGE" >/dev/null
wait_healthy mcpa-bk-src
$DOCKER exec mcpa-bk-src node scripts/seed.mjs
$DOCKER exec mcpa-bk-src sh -c 'mkdir -p /data/files/ab && printf evidence > /data/files/ab/abc123'

echo "2. Back up while it runs"
$DOCKER exec mcpa-bk-src node scripts/backup.mjs --out - > "$WORK/backup.mcpa"
$DOCKER rm -f mcpa-bk-src >/dev/null

echo "3. Restore into a fresh volume and start"
chmod 755 "$WORK" && chmod 644 "$WORK/backup.mcpa"
$DOCKER run --rm -v mcpa-bk-dst:/data -v "$WORK:/backups:ro" -e BACKUP_PASSPHRASE="$PASS" "$IMAGE" \
	node scripts/restore.mjs --in /backups/backup.mcpa
$DOCKER run -d --name mcpa-bk-dst -v mcpa-bk-dst:/data -e TEST_SEED_ENABLED=true "$IMAGE" >/dev/null
wait_healthy mcpa-bk-dst

echo "4. Check users and files came back"
$DOCKER exec mcpa-bk-dst node -e "
const D = require('better-sqlite3'); const db = new D('/data/app.db', { readonly: true });
const emails = db.prepare('SELECT email FROM \"user\" ORDER BY email').all().map(r => r.email);
if (emails.join() !== 'admin@example.test,auditor@example.test') { console.error('users:', emails); process.exit(1); }
const f = require('fs').readFileSync('/data/files/ab/abc123', 'utf8');
if (f !== 'evidence') { console.error('file:', f); process.exit(1); }
console.log('restored users:', emails.join(', '), '| file ok');"
echo "Backup and restore check passed."
