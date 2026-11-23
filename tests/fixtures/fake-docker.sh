#!/usr/bin/env bash
# A scripted stand-in for the docker command, for tests of the tenant command (#94).
# It writes every call to $FAKE_DOCKER_LOG, keeps which tenant "containers" are up in
# $FAKE_DOCKER_STATE, and fails on purpose where a test asks it to:
#   FAKE_DOCKER_FAIL=<regex>     a call whose arguments match fails
#   FAKE_DOCKER_UNHEALTHY=1      started containers never become healthy (they restart in a loop)
#   FAKE_DOCKER_UNHEALTHY_TAG=<regex>  the same, for containers whose "<container>:<version>" matches
#   FAKE_DOCKER_NO_IMAGE=<regex> an image whose name matches is not on this machine
#   FAKE_DOCKER_REPORTS=<version>  what every instance's health page says its version is
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
if [[ "$*" == *"scripts/gateway-keys.mjs"* ]]; then
	# The real helper (#95), run here against the test's scripted gateway. Its settings and a
	# tenant's key come in the environment, as they would in the container.
	args=()
	seen=false
	for a in "$@"; do
		if $seen; then args+=("$a"); fi
		[ "$a" = scripts/gateway-keys.mjs ] && seen=true
	done
	exec node "$FAKE_DOCKER_REPO/scripts/gateway-keys.mjs" "${args[@]}"
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

# ---- Upgrades (#97): which version a started container runs, and what it says of itself
if [ "$1" = exec ] && [[ "$*" == *"/health"* ]]; then
	if [ -n "${FAKE_DOCKER_REPORTS:-}" ]; then echo "$FAKE_DOCKER_REPORTS"; else cat "$FAKE_DOCKER_STATE/version-$2" 2> /dev/null || exit 1; fi
	exit 0
fi
if [ "$1 ${2:-}" = "image inspect" ]; then
	if [ -n "${FAKE_DOCKER_NO_IMAGE:-}" ] && [[ "$3" =~ $FAKE_DOCKER_NO_IMAGE ]]; then exit 1; fi
	exit 0
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
	"compose up")
		state="$FAKE_DOCKER_STATE/mcp-audit-tenant-$(basename "$PWD")"
		if [[ "$*" == *--no-start* ]]; then
			[ -f "$state" ] || echo created > "$state"
		else
			echo up > "$state"
			# As Compose does it: a value in the environment wins over the one in the tenant's .env.
			echo "${MCP_AUDIT_TAG:-$(sed -n 's/^MCP_AUDIT_TAG=//p' .env 2> /dev/null | head -1)}" > "$FAKE_DOCKER_STATE/version-mcp-audit-tenant-$(basename "$PWD")"
		fi
		;;
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
			# A version that does not start, for one tenant or all: matched against "<container>:<version>".
			elif [ -n "${FAKE_DOCKER_UNHEALTHY_TAG:-}" ] && [[ "$container:$(cat "$FAKE_DOCKER_STATE/version-$container" 2> /dev/null)" =~ $FAKE_DOCKER_UNHEALTHY_TAG ]]; then echo "restarting 3 "
			else echo "running 0 healthy"; fi
		else
			up "$container" && echo "running, healthy, image ghcr.io/jurispuce/mcp-audit:main" || echo "exited, image ghcr.io/jurispuce/mcp-audit:main"
		fi
		;;
	"logs --tail") printf 'Cannot start.\nThe tenant profile cannot be used:\n  - library_sources.0: "nope" is not a source that ships with the app.\n' ;;
	"network inspect" | "network connect" | "network disconnect" | "exec "* | "run "* | "pull "*) : ;;
	*) echo "fake docker: not scripted: $*" >&2; exit 64 ;;
esac
