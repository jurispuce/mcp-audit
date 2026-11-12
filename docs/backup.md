# Backup and restore

Everything mcp-audit stores is in one data volume: the SQLite database (`app.db`) and the files folder. A backup is one encrypted file holding both.

## How a backup works

- The database is copied with SQLite's online backup API, so the app keeps running and the copy is consistent.
- The files folder is copied after the database. Files are written before the database row that points to them, so every file the copied database refers to is in the backup.
- The result is a `.tar.gz` encrypted with AES-256-GCM. The key comes from `BACKUP_PASSPHRASE` through scrypt. Any change to the file makes restore refuse it.

Keep the passphrase outside the server, for example in the team's password manager. A backup cannot be restored without it.

## Set the passphrase

Add it to `.env` next to `docker-compose.yml` (at least 12 characters):

```bash
BACKUP_PASSPHRASE=choose-a-long-passphrase-and-store-it-safely
```

Then recreate the container so it sees the variable:

```bash
docker compose up -d
```

## Make a backup

```bash
mkdir -p backups
docker compose exec -T app node scripts/backup.mjs --out - > backups/mcp-audit-$(date +%F-%H%M).mcpa
```

Copy the file somewhere other than the server: another disk, another machine or cloud storage. It is encrypted, so ordinary storage is fine.

## Nightly backups

On the host, run `crontab -e` and add a line like this one (adjust the folder). It keeps 30 days.

```bash
15 2 * * * cd /srv/mcp-audit && docker compose exec -T app node scripts/backup.mjs --out - > backups/mcp-audit-$(date +\%F).mcpa && find backups -name 'mcp-audit-*.mcpa' -mtime +30 -delete
```

The architecture's security baseline expects a nightly encrypted backup and full-disk encryption on the host.

## Restore

Restore replaces the data in the volume. Stop the app first.

```bash
docker compose stop app
```

```bash
docker compose run --rm -v "$PWD/backups:/backups" app node scripts/restore.mjs --in /backups/mcp-audit-2026-11-12-0215.mcpa --force
```

```bash
docker compose start app
```

- Without `--force`, restore refuses to replace existing data. With it, the data it replaces is moved to `pre-restore-<time>/` inside the volume, not deleted. Remove that folder once you are sure.
- Into a new, empty volume (a new server), leave out `--force`.
- If the backup is from an older version of the app, the newer migrations run when the app starts.
- The restore checks the passphrase, that the file was not altered, and the database's integrity before it touches the volume.

## Test the procedure

`scripts/backup-restore-check.sh` backs up a running container, restores into a fresh volume, starts it and checks that users and files came back. CI runs it on every build; run it yourself after changing anything around storage:

```bash
IMAGE=ghcr.io/jurispuce/mcp-audit:latest scripts/backup-restore-check.sh
```
