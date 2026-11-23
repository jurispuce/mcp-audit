#!/usr/bin/env bash
# A scripted stand-in for the docker command, for tests of the tenant command (#94).
# It writes every call to $FAKE_DOCKER_LOG, keeps which tenant "containers" are up in
# $FAKE_DOCKER_STATE, and fails on purpose where a test asks it to:
#   FAKE_DOCKER_FAIL=<regex>     a call whose arguments match fails
#   FAKE_DOCKER_UNHEALTHY=1      started containers never become healthy (they restart in a loop)
set -euo pipefail
echo "$*" >> "$FAKE_DOCKER_LOG"
mkdir -p "$FAKE_DOCKER_STATE"
if [ -n "${FAKE_DOCKER_FAIL:-}" ] && [[ "$*" =~ $FAKE_DOCKER_FAIL ]]; then
	echo "fake docker: refused: $*" >&2
	exit 1
fi
up() { [ -f "$FAKE_DOCKER_STATE/$1" ] && [ "$(cat "$FAKE_DOCKER_STATE/$1")" = up ]; }
# Which passphrase a backup or restore runs with: the one handed over, or the container's own.
key() { [[ " $* " == *" -e BACKUP_PASSPHRASE "* ]] && echo "given:${BACKUP_PASSPHRASE:-}" || echo "own"; }

# ---- Backups (#96): what the app's backup and restore scripts would do, recorded
if [[ "$*" == *"scripts/backup.mjs --out -"* ]]; then
	if [ "$1" = exec ]; then for a in "$@"; do [[ "$a" == mcp-audit-tenant-* ]] && c="$a"; done; else c="mcp-audit-tenant-$(basename "$PWD")"; fi
	echo "MCPABK1 fake backup of $c how=$1 key=$(key "$@")"
	exit 0
fi
if [[ "$*" == *"scripts/restore.mjs"* ]]; then
	if [ "$1" = compose ]; then into="mcp-audit-tenant-$(basename "$PWD")"; else into="$(echo "$*" | sed -n 's/.* -v \([^ :]*\):\/data .*/\1/p')"; fi
	{
		echo "key=$(key "$@")"
		[[ "$*" == *"--force"* ]] && echo "force=yes" || echo "force=no"
		cat
	} > "$FAKE_DOCKER_STATE/restored-$into"
	[ "$1" = compose ] && [ ! -f "$FAKE_DOCKER_STATE/$into" ] && echo stopped > "$FAKE_DOCKER_STATE/$into"
	exit 0
fi
if [[ "$*" == *"scripts/backup-retention.mjs"* ]]; then
	# The real rules, run here: the fake only stands in for the container around them.
	args=()
	seen=false
	for a in "$@"; do
		if $seen; then args+=("$a"); fi
		[ "$a" = scripts/backup-retention.mjs ] && seen=true
	done
	exec node "$FAKE_DOCKER_REPO/scripts/backup-retention.mjs" "${args[@]}"
fi

case "$1 ${2:-}" in
	"run -d")
		name=""
		prev=""
		for a in "$@"; do
			[ "$prev" = --name ] && name="$a"
			prev="$a"
		done
		echo up > "$FAKE_DOCKER_STATE/$name"
		;;
	"rm -f") rm -f "${FAKE_DOCKER_STATE:?}/${3:?}" ;;
	"volume rm") : ;;
	"compose up") echo up > "$FAKE_DOCKER_STATE/mcp-audit-tenant-$(basename "$PWD")" ;;
	"compose stop") echo stopped > "$FAKE_DOCKER_STATE/mcp-audit-tenant-$(basename "$PWD")" ;;
	"compose down") rm -f "$FAKE_DOCKER_STATE/mcp-audit-tenant-$(basename "$PWD")" ;;
	"inspect -f")
		container="${4:-}"
		[ -f "$FAKE_DOCKER_STATE/$container" ] || exit 1
		if [ "$3" = '{{.State.Status}}' ]; then
			up "$container" && echo running || echo exited
		elif [[ "$3" == *RestartCount* ]]; then
			if ! up "$container"; then echo "exited 0 "
			elif [ -n "${FAKE_DOCKER_UNHEALTHY:-}" ]; then echo "restarting 3 "
			else echo "running 0 healthy"; fi
		else
			up "$container" && echo "running, healthy, image ghcr.io/jurispuce/mcp-audit:main" || echo "exited, image ghcr.io/jurispuce/mcp-audit:main"
		fi
		;;
	"logs --tail") printf 'Cannot start.\nThe tenant profile cannot be used:\n  - library_sources.0: "nope" is not a source that ships with the app.\n' ;;
	"network inspect" | "network connect" | "network disconnect" | "exec "* | "run "*) : ;;
	*) echo "fake docker: not scripted: $*" >&2; exit 64 ;;
esac
