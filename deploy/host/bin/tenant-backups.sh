# Backups, restores and exports for tenants (#96). Part of bin/tenant; not run on its own.
#
# A backup is the app's own encrypted backup (docs/backup.md), made with the tenant's own
# passphrase and kept in $BACKUPS_DIR/<tenant>/<tenant>-YYYYMMDDTHHMMSSZ.mcpa, readable by the
# operator only. Nothing here opens a backup on the host: making and restoring happen inside the
# tenant's own image.
#
# Every removal below names its target with ${var:?}: if a name were ever empty, the shell stops
# with an error and nothing is removed.

backups_of() { echo "${BACKUPS_DIR:?Set BACKUPS_DIR in host.env}/${1:?}"; }
exports_dir() { echo "${EXPORTS_DIR:-$(dirname "${BACKUPS_DIR:?Set BACKUPS_DIR in host.env}")/exports}"; }
stamp() { date -u +%Y%m%dT%H%M%SZ; }
image_of() { echo "${MCP_AUDIT_IMAGE:-$default_image}:$(meta_get "$1" version)"; }
running() { [ "$(docker inspect -f '{{.State.Status}}' "$(container "$1")" 2> /dev/null)" = running ]; }
# A deleted tenant's passphrase is kept, away from its backups, until the backups are removed.
kept_dir() { echo "${TENANTS_DIR:?Set TENANTS_DIR in host.env}/.deleted/${1:?}"; }
kept_env() { echo "$(kept_dir "$1")/.env"; }
passphrase_of() {
	local f
	for f in "$(tenant_dir "$1")/.env" "$(kept_env "$1")"; do
		if [ -f "$f" ]; then
			sed -n 's/^BACKUP_PASSPHRASE=//p' "$f" | head -1
			return 0
		fi
	done
	return 1
}

# What happened on this host, one line each: when, which tenant, what. No tenant content.
event() { # event <tenant> <what> [detail]
	mkdir -p "$registry"
	[ -f "$registry/events.tsv" ] || printf 'time\ttenant\tevent\tdetail\n' > "$registry/events.tsv"
	printf '%s\t%s\t%s\t%s\n' "$(now)" "$1" "$2" "${3:-}" >> "$registry/events.tsv"
}

# Make one encrypted backup of a tenant into a file. With a passphrase given, that one is used
# and not the tenant's own (an export for a tenant that leaves). The passphrase travels in the
# environment, never on a command line.
make_backup() { # make_backup <tenant> <file> [passphrase]
	local name="$1" out="${2:?}" pass="${3:-}" rc=0
	local part="$out.part"
	local -a with=()
	[ -n "$pass" ] && with=(-e BACKUP_PASSPHRASE)
	(
		umask 077
		[ -n "$pass" ] && export BACKUP_PASSPHRASE="$pass"
		if running "$name"; then
			docker exec "${with[@]}" "$(container "$name")" node scripts/backup.mjs --out - > "$part" 2> "$part.err"
		else
			# A suspended tenant: a one-off container on its data, started for the backup alone.
			compose "$name" run --rm -T --no-deps "${with[@]}" app node scripts/backup.mjs --out - > "$part" 2> "$part.err"
		fi
	) || rc=$?
	if [ "$rc" != 0 ] || [ ! -s "$part" ]; then
		sed 's/^/    /' "$part.err" >&2 || true
		rm -f "${part:?}" "${part:?}.err"
		return 1
	fi
	rm -f "${part:?}.err"
	mv "$part" "$out"
}

newest_backup() { # newest_backup <tenant>: its newest backup file, by the time in the name
	ls "$(backups_of "$1")" 2> /dev/null | grep -E -- '-[0-9]{8}T[0-9]{6}Z\.mcpa$' | sort | tail -1 || true
}

# A backup named on the command line: "latest", a file name in the tenant's backups, or a path.
find_backup() { # find_backup <tenant> <from>
	local name="$1" from="$2" dir file
	dir="$(backups_of "$name")"
	if [ "$from" = latest ]; then
		file="$(newest_backup "$name")"
		[ -n "$file" ] || die "\"$name\" has no backups in $dir."
		echo "$dir/$file"
	elif [ -f "$from" ]; then
		echo "$(cd "$(dirname "$from")" && pwd)/$(basename "$from")"
	elif [ -f "$dir/$from" ]; then
		echo "$dir/$from"
	else
		die "There is no backup \"$from\". See: bin/tenant backups $name"
	fi
}

# Put a backup into a tenant's data. The file goes in through standard input, so the container
# needs no access to the operator's backup directory; the app's own restore checks the passphrase,
# that the file was not altered and the database's integrity before it touches the data.
INCOMING='cat > /data/.incoming.mcpa && node scripts/restore.mjs --in /data/.incoming.mcpa "$@"; rc=$?; rm -f /data/.incoming.mcpa; exit $rc'
restore_into() { # restore_into <tenant> <file> <passphrase> [--force]
	local name="$1" file="$2" pass="$3"
	shift 3
	BACKUP_PASSPHRASE="$pass" quiet compose "$name" run --rm -T --no-deps -e BACKUP_PASSPHRASE app \
		sh -c "$INCOMING" restore "$@" < "$file"
}

# ---- backup, backups
cmd_backup() {
	local name=""
	for a in "$@"; do [ "$a" = "--dry-run" ] && dry=true || name="$a"; done
	[ -n "$name" ] || usage
	need_known "$name"
	local dir file
	dir="$(backups_of "$name")"
	file="$dir/$name-$(stamp).mcpa"
	if $dry; then
		say "Would back up \"$name\" to $file, encrypted with its own passphrase. Nothing was changed (--dry-run)."
		return 0
	fi
	(umask 077 && mkdir -p "$dir")
	if ! make_backup "$name" "$file"; then
		meta_set "$name" last_backup_failed "$(now)"
		event "$name" backup-failed
		die "The backup of \"$name\" failed."
	fi
	meta_set "$name" last_backup "$(now)"
	meta_set "$name" last_backup_failed ""
	event "$name" backup "$(basename "$file")"
	say "Backed up \"$name\": $file ($(wc -c < "$file" | tr -d ' ') bytes)"
}

cmd_backups() {
	local name=""
	for a in "$@"; do [ "$a" = "--dry-run" ] || name="$a"; done
	[ -n "$name" ] || usage
	local dir f
	dir="$(backups_of "$name")"
	[ -d "$dir" ] || { say "\"$name\" has no backups."; return 0; }
	printf '%-44s %12s\n' BACKUP BYTES
	for f in $(ls "$dir" | grep -E -- '-[0-9]{8}T[0-9]{6}Z\.mcpa$' | sort -r); do
		printf '%-44s %12s\n' "$f" "$(wc -c < "$dir/$f" | tr -d ' ')"
	done
}

# ---- restore
cmd_restore() {
	local name="" from="" as="" title=""
	while [ $# -gt 0 ]; do
		case "$1" in
			--from) from="${2:-}"; shift 2 ;;
			--as) as="${2:-}"; shift 2 ;;
			--title) title="${2:-}"; shift 2 ;;
			--dry-run) dry=true; shift ;;
			-*) die "Unknown option $1" ;;
			*) name="$1"; shift ;;
		esac
	done
	[ -n "$name" ] && [ -n "$from" ] || usage
	local file pass
	file="$(find_backup "$name" "$from")"
	pass="$(passphrase_of "$name")" || die "The passphrase of \"$name\" is not on this host any more, so its backups cannot be opened."

	if [ -n "$as" ]; then
		# Into a new tenant: to check a backup, or to recover one item. The copy gets secrets of its own.
		local source_title source_version
		source_title="$(meta_get "$name" title 2> /dev/null || true)"
		source_version="$(meta_get "$name" version 2> /dev/null || true)"
		[ -n "$title" ] || title="$(printf '%.40s' "${source_title:-$name}") (restored copy)"
		restore_file="$file" restore_pass="$pass" restore_source="$name"
		local -a opts=(--title "$title" --admin-email "restored@$as.invalid")
		[ -n "$source_version" ] && opts+=(--version "$source_version")
		$dry && opts+=(--dry-run)
		cmd_create "$as" "${opts[@]}"
		$dry && return 0
		event "$as" restored-from "$name $(basename "$file")"
		say "People of \"$name\" sign in at the copy with a code by email: passkeys belong to the address they were made at."
		return 0
	fi

	need_known "$name"
	local was
	was="$(meta_get "$name" state)"
	say "Restoring \"$name\" from $(basename "$file"): the instance goes back to that state as a whole. What was changed since is gone from it."
	if $dry; then
		begin "back up the current state first"
		begin "stop the container $(container "$name")"
		begin "restore $(basename "$file")"
		[ "$was" = suspended ] || begin "start the container and wait until it is healthy"
		say "Nothing was changed (--dry-run)."
		return 0
	fi
	local typed
	printf 'Type the tenant'"'"'s name to restore it: '
	IFS= read -r typed || typed=""
	[ "$typed" = "$name" ] || die "That is not \"$name\". Nothing was restored."

	begin "back up the current state first"
	(umask 077 && mkdir -p "$(backups_of "$name")")
	local before
	before="$(backups_of "$name")/$name-$(stamp).mcpa"
	# A second apart from the backup being restored, so the two never share a name.
	if [ "$before" = "$file" ]; then
		sleep 1
		before="$(backups_of "$name")/$name-$(stamp).mcpa"
	fi
	make_backup "$name" "$before" || die "The current state could not be backed up, so nothing was restored."
	event "$name" backup "$(basename "$before")"

	begin "stop the container $(container "$name")"
	quiet compose "$name" stop
	begin "restore $(basename "$file")"
	if ! restore_into "$name" "$file" "$pass" --force; then
		echo "The backup was not restored; the data is as it was." >&2
		if [ "$was" != suspended ]; then start_container "$name" && wait_healthy "$name" || true; fi
		event "$name" restore-failed "$(basename "$file")"
		exit 1
	fi
	if [ "$was" != suspended ]; then
		begin "start the container and wait until it is healthy"
		start_container "$name"
		wait_healthy "$name" || die "\"$name\" was restored but did not come back healthy. The state before is in $(basename "$before")."
		# The restore keeps the replaced data aside in the volume; the backup made above holds it too.
		docker exec "$(container "$name")" sh -c 'rm -rf /data/pre-restore-*' > /dev/null 2>&1 || true
		"$HOST_DIR/bin/proxy-sync" > /dev/null
	fi
	meta_set "$name" restored "$(now) from $(basename "$file")"
	event "$name" restored "$(basename "$file")"
	say "\"$name\" is restored from $(basename "$file"). The state before is in $(basename "$before")."
}

# ---- export: for a tenant that leaves
export_readme() { # export_readme <title> <address> <file name>
	cat <<TXT
Your data from $1
=====================================================

This archive holds everything your instance at $2 stored:
the database and all files, in one encrypted file, $3.

It is encrypted with a passphrase that you were given separately from this archive.
Without the passphrase the file cannot be opened; keep both, apart from each other.

To open it in your own mcp-audit
--------------------------------
mcp-audit is free software: https://github.com/jurispuce/mcp-audit
Its deployment guide (docs/deployment.md) sets up one instance with Docker.

1. Set up an instance, but do not start it yet. In its .env put:
       BACKUP_PASSPHRASE=<the passphrase you were given>
2. Put $3 in a folder named backups next to docker-compose.yml.
3. Restore it into the new, empty instance:
       docker compose run --rm -v "\$PWD/backups:/backups" app node scripts/restore.mjs --in /backups/$3
4. Start the instance:
       docker compose up -d

What to know
------------
- People, engagements, documents, findings and the whole history are in it.
- Passkeys belong to the address they were made at. At a new address people sign in
  with a code by email (set up email first), or an admin sets them up again.
- After restoring, choose a new BACKUP_PASSPHRASE of your own for your backups.
TXT
}

make_export() { # make_export <tenant>: writes the archive, prints its path and the passphrase
	local name="$1" dir pass base work archive
	dir="$(exports_dir)"
	pass="$(secret)"
	base="$name-export-$(stamp)"
	(umask 077 && mkdir -p "$dir")
	work="$(mktemp -d "$dir/.export.XXXXXX")"
	if ! make_backup "$name" "$work/$base.mcpa" "$pass"; then
		rm -rf "${work:?}"
		return 1
	fi
	export_readme "$(meta_get "$name" title)" "https://$(meta_get "$name" host)" "$base.mcpa" > "$work/README.txt"
	archive="$dir/$base.tar"
	(umask 077 && tar -cf "$archive" -C "$work" README.txt "$base.mcpa")
	rm -rf "${work:?}"
	event "$name" exported "$(basename "$archive")"
	say "Export of \"$name\": $archive"
	say "Its passphrase, shown once and stored nowhere. Give it to the tenant's admin separately from the file:"
	say "    $pass"
}

cmd_export() {
	local name=""
	while [ $# -gt 0 ]; do
		case "$1" in
			--out) EXPORTS_DIR="${2:-}"; shift 2 ;;
			--dry-run) dry=true; shift ;;
			-*) die "Unknown option $1" ;;
			*) name="$1"; shift ;;
		esac
	done
	[ -n "$name" ] || usage
	need_known "$name"
	if $dry; then
		say "Would write an archive of \"$name\" (its database and files, encrypted with a new passphrase, and a readme) to $(exports_dir). Nothing was changed (--dry-run)."
		return 0
	fi
	make_export "$name" || die "The export of \"$name\" failed."
}

# ---- check-backup: restore the newest backup into a throwaway instance and see it start
CHECK_DATA="const D=require('better-sqlite3');const db=new D('/data/app.db',{readonly:true});if(db.pragma('integrity_check',{simple:true})!=='ok'||db.prepare('SELECT count(*) AS n FROM \"user\"').get().n<1)process.exit(1)"
check_restores() { # check_restores <tenant> <file> <throwaway name>: 0 when the backup gives a working instance
	local name="$1" file="$2" c="$3" image pass
	image="$(image_of "$name")"
	pass="$(passphrase_of "$name")"
	# Restore into a fresh volume, then start the app on it with no network at all.
	BACKUP_PASSPHRASE="$pass" quiet docker run --rm -i -e BACKUP_PASSPHRASE -v "$c:/data" "$image" \
		sh -c "$INCOMING" restore < "$(backups_of "$name")/$file" || return 1
	quiet docker run -d --name "$c" --network none -v "$c:/data" --env-file "$(tenant_dir "$name")/.env" \
		-e "ORIGIN=https://$(meta_get "$name" host)" -e DATA_DIR=/data "$image" || return 1
	wait_container_healthy "$c" || return 1
	quiet docker exec "$c" node -e "$CHECK_DATA" || return 1
}

cmd_check_backup() {
	local name=""
	for a in "$@"; do [ "$a" = "--dry-run" ] && dry=true || name="$a"; done
	[ -n "$name" ] || usage
	need_known "$name"
	local file
	file="$(newest_backup "$name")"
	[ -n "$file" ] || die "\"$name\" has no backup to check."
	if $dry; then
		say "Would restore $file into a throwaway instance without a network, see it start, and remove it. Nothing was changed (--dry-run)."
		return 0
	fi
	local c="mcp-audit-check-$name" ok=true
	docker rm -f "$c" > /dev/null 2>&1 || true
	docker volume rm -f "$c" > /dev/null 2>&1 || true
	check_restores "$name" "$file" "$c" || ok=false
	docker rm -f "$c" > /dev/null 2>&1 || true
	docker volume rm -f "$c" > /dev/null 2>&1 || true
	if $ok; then
		meta_set "$name" restore_checked "$(now) ok $file"
		event "$name" restore-check-ok "$file"
		say "The newest backup of \"$name\" restores and starts: $file"
	else
		meta_set "$name" restore_checked "$(now) failed $file"
		event "$name" restore-check-failed "$file"
		die "The newest backup of \"$name\" did NOT restore into a working instance: $file"
	fi
}

# ---- nightly: every tenant backed up, old backups removed, a copy off the server
retention_tool() { # runs scripts/backup-retention.mjs in the app's image, which has Node
	docker run --rm -i "${MCP_AUDIT_IMAGE:-$default_image}:${MCP_AUDIT_TAG:-main}" node scripts/backup-retention.mjs "$@"
}

cmd_nightly() {
	for a in "$@"; do [ "$a" = "--dry-run" ] && dry=true; done
	local -a failures=()
	local -a keep=(--daily "${BACKUP_KEEP_DAILY:-7}" --weekly "${BACKUP_KEEP_WEEKLY:-4}" --monthly "${BACKUP_KEEP_MONTHLY:-6}")
	local name f dir removed old outdated
	say "Nightly run, $(now)"

	for f in "$registry"/*.meta; do
		[ -e "$f" ] || continue
		name="$(basename "$f" .meta)"
		dir="$(backups_of "$name")"
		if $dry; then
			say "  would: back up \"$name\" and remove backups outside ${keep[*]}"
			continue
		fi
		# 1. Tonight's backup, with the tenant's own passphrase.
		if (cmd_backup "$name") > /dev/null 2>&1; then
			say "  $name: backed up"
		else
			say "  $name: BACKUP FAILED"
			failures+=("$name: backup")
			continue
		fi
		# 2. Keep the last days, weeks and months; remove the rest.
		if outdated="$(ls "$dir" | retention_tool prune "${keep[@]}")"; then
			removed=0
			for old in $outdated; do
				rm -f "${dir:?}/${old:?}"
				removed=$((removed + 1))
			done
			if [ "$removed" != 0 ]; then
				say "  $name: $removed old backups removed"
				event "$name" backups-pruned "$removed"
			fi
		else
			say "  $name: OLD BACKUPS COULD NOT BE SORTED OUT"
			failures+=("$name: retention")
		fi
		# 3. Once a month: does the newest backup restore into a working instance?
		if [ "$(meta_get "$name" state)" = active ] && [ "$(meta_get "$name" restore_checked | cut -c1-7)" != "$(date -u +%Y-%m)" ]; then
			if (cmd_check_backup "$name") > /dev/null 2>&1; then
				say "  $name: this month's restore check passed"
			else
				say "  $name: RESTORE CHECK FAILED"
				failures+=("$name: restore check")
			fi
		fi
	done

	# 4. Backups of deleted tenants go a stated number of days after the deletion.
	local days="${DELETED_BACKUPS_DAYS:-30}" deleted
	if [ -f "$registry/deleted.tsv" ]; then
		while IFS=$'\t' read -r name _ _ _ deleted _; do
			[ -n "$name" ] && [ "$name" != name ] || continue
			[ -d "$(backups_of "$name")" ] || [ -f "$(kept_env "$name")" ] || continue
			# A tenant of that name exists again: these are its backups now.
			known "$name" && continue
			[ "$(retention_tool due "$deleted" "$days")" = yes ] || continue
			if $dry; then
				say "  would: remove the backups of deleted tenant \"$name\" (deleted $deleted)"
			else
				rm -rf "$(backups_of "$name")" "$(kept_dir "$name")"
				event "$name" backups-removed "deleted $deleted, kept $days days"
				say "  $name: backups of the deleted tenant removed"
			fi
		done < "$registry/deleted.tsv"
	fi

	# 5. A copy off this server. The backups are encrypted, so ordinary storage will do.
	if [ -n "${BACKUP_COPY_COMMAND:-}" ]; then
		if $dry; then
			say "  would: copy $BACKUPS_DIR off the server with BACKUP_COPY_COMMAND"
		elif bash -c "${BACKUP_COPY_COMMAND//\{dir\}/$BACKUPS_DIR}" > "$registry/copy.log" 2>&1; then
			say "  copied off the server"
			event - backups-copied
		else
			say "  THE COPY OFF THE SERVER FAILED (see $registry/copy.log)"
			failures+=("copy off the server")
		fi
	else
		say "  no copy off the server: BACKUP_COPY_COMMAND is not set in host.env"
	fi

	if $dry; then
		say "Nothing was changed (--dry-run)."
		return 0
	fi
	# For the operator's overview (#98): when the last run was and what went wrong in it.
	{
		echo "time=$(now)"
		echo "failures=${#failures[@]}"
		local x
		for x in "${failures[@]}"; do echo "failed=$x"; done
	} > "$registry/nightly.status"
	if [ "${#failures[@]}" -gt 0 ]; then
		say "Nightly run finished with ${#failures[@]} failure(s): ${failures[*]}"
		return 1
	fi
	say "Nightly run finished."
}
