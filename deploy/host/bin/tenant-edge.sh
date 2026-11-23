# Check a tenant's public address as Cloudflare serves it (#92). Part of bin/tenant; not run on its own.
#
# tenant check-edge <name> asks the tenant's https address from outside, the way a browser and an
# assistant's server reach it, and says what Cloudflare changed or stopped: Access in front, pages
# rewritten or cached, a challenge on /mcp. With OPERATOR_INSTANCE in host.env (or --operator), it also
# checks that your own instance still asks for Access. scripts/check-edge.mjs does the asking, in the
# app's image; it needs no token and reads nothing of the tenant but what anyone on the internet sees.

# ---- tenant check-edge <name> [--operator <https address>] [--lockout]
cmd_check_edge() {
	local name="" operator="${OPERATOR_INSTANCE:-}" via=""
	local -a extra=()
	while [ $# -gt 0 ]; do
		case "$1" in
			--operator) operator="${2:-}"; shift 2 ;;
			--lockout) extra+=(--lockout); shift ;;
			# For tests only: send the requests to this http address with the tenant's name as Host.
			--via) via="${2:-}"; shift 2 ;;
			--dry-run) dry=true; shift ;;
			-*) die "Unknown option $1" ;;
			*) name="$1"; shift ;;
		esac
	done
	[ -n "$name" ] || usage
	need_known "$name"
	[ -n "$operator" ] && extra+=(--operator "$operator")
	[ -n "$via" ] && extra+=(--via "$via")
	local address="https://$(meta_get "$name" host)"
	if $dry; then
		say "Would ask $address from outside${operator:+, and $operator}. Nothing is changed either way."
		return 0
	fi
	[ "$(meta_get "$name" state)" = suspended ] && say "\"$name\" is suspended: its address shows the suspended page, so most checks fail."
	local rc=0
	docker run --rm "${MCP_AUDIT_IMAGE:-$default_image}:${MCP_AUDIT_TAG:-main}" \
		node scripts/check-edge.mjs "$address" "${extra[@]}" || rc=$?
	[ "$rc" = 0 ] && meta_set "$name" edge_checked "$(now) ok" || meta_set "$name" edge_checked "$(now) failed"
	return "$rc"
}
