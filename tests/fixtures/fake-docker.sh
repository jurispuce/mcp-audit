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
case "$1 ${2:-}" in
	"compose up") echo up > "$FAKE_DOCKER_STATE/mcp-audit-tenant-$(basename "$PWD")" ;;
	"compose stop") echo stopped > "$FAKE_DOCKER_STATE/mcp-audit-tenant-$(basename "$PWD")" ;;
	"compose down") rm -f "$FAKE_DOCKER_STATE/mcp-audit-tenant-$(basename "$PWD")" ;;
	"inspect -f")
		container="${4:-}"
		[ -f "$FAKE_DOCKER_STATE/$container" ] || exit 1
		if [[ "$3" == *RestartCount* ]]; then
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
