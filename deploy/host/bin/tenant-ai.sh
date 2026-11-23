# AI for tenants through the shared gateway (#95). Part of bin/tenant; not run on its own.
#
# Each tenant has a key of its own at the gateway (LiteLLM with key management), with a budget that
# starts again each period. The key is in the tenant's own environment file, for the operator and
# that tenant's container only. It is made, changed and revoked through scripts/gateway-keys.mjs,
# which runs in the app's image and is given a tenant's key in the environment, never on a
# command line.

ai_set_up() { [ -n "${AI_GATEWAY_URL:-}" ] && [ -n "${AI_GATEWAY_MASTER_KEY:-}" ]; }
ai_period() { echo "${TENANT_AI_BUDGET_PERIOD:-30d}"; }
ai_key_of() { sed -n 's/^LITELLM_API_KEY=//p' "$(tenant_dir "$1")/.env" 2> /dev/null | head -1; }

# The helper, in a container that can reach the gateway's key management. It is handed the
# gateway's settings and nothing else of host.env, by name: no value is on a command line.
gateway() {
	local -a net=()
	[ -n "${AI_GATEWAY_NETWORK:-}" ] && net=(--network "$AI_GATEWAY_NETWORK")
	docker run --rm "${net[@]}" -e AI_GATEWAY_URL -e AI_GATEWAY_ADMIN_URL -e AI_GATEWAY_MASTER_KEY -e TENANT_AI_KEY \
		"${MCP_AUDIT_IMAGE:-$default_image}:${MCP_AUDIT_TAG:-main}" node scripts/gateway-keys.mjs "$@"
}
# The same, for one tenant's key.
gateway_for() { # gateway_for <tenant> <command...>
	local key
	key="$(ai_key_of "$1")"
	shift
	TENANT_AI_KEY="$key" gateway "$@"
}

check_ai_budget() { # check_ai_budget <amount>
	[[ "$1" =~ ^[0-9]+(\.[0-9]{1,2})?$ ]] || die "A budget is an amount in US dollars, for example 20 or 7.50: \"$1\""
}

# What a new tenant's instance is told about AI, for its profile. The key is not in it.
ai_profile() {
	echo "ai:"
	echo "  base_url: $(yaml "$AI_GATEWAY_URL")"
	echo "  default_model: $(yaml "$TENANT_AI_DEFAULT_MODEL")"
	echo "  web_search: $([ "${TENANT_AI_WEB_SEARCH:-false}" = true ] && echo true || echo false)"
}

# One line for status and list: what is used and what is left, as the gateway has it.
ai_line() { # ai_line <tenant>
	if ! ai_set_up; then
		echo "no AI gateway in host.env"
	elif [ -z "$(ai_key_of "$1")" ]; then
		echo "no key at the gateway"
	else
		gateway_for "$1" info 2> /dev/null || echo "the gateway did not answer"
	fi
}

# ---- tenant ai <name> [--budget <amount>] [--off] [--on]
cmd_ai() {
	local name="" budget="" switch=""
	while [ $# -gt 0 ]; do
		case "$1" in
			--budget) budget="${2:-}"; shift 2 ;;
			--off | --on) switch="${1#--}"; shift ;;
			--dry-run) dry=true; shift ;;
			-*) die "Unknown option $1" ;;
			*) name="$1"; shift ;;
		esac
	done
	[ -n "$name" ] || usage
	need_known "$name"
	ai_set_up || die "Set AI_GATEWAY_URL and AI_GATEWAY_MASTER_KEY in host.env first."
	[ -n "$(ai_key_of "$name")" ] || die "\"$name\" has no key at the AI gateway."
	[ -z "$budget" ] || check_ai_budget "$budget"
	if $dry; then
		[ -z "$budget" ] || say "Would set the AI budget of \"$name\" to \$$budget per $(ai_period)."
		[ -z "$switch" ] || say "Would switch AI $switch for \"$name\"."
		say "Nothing was changed (--dry-run)."
		return 0
	fi
	if [ -n "$budget" ]; then
		gateway_for "$name" budget "$budget" > /dev/null || die "The budget of \"$name\" was not changed."
		meta_set "$name" ai_budget "$budget"
		event "$name" ai-budget "$budget"
	fi
	if [ -n "$switch" ]; then
		gateway_for "$name" "$switch" > /dev/null || die "AI was not switched $switch for \"$name\"."
		meta_set "$name" ai "$switch"
		event "$name" "ai-$switch"
	fi
	say "AI of \"$name\": $(ai_line "$name")"
}
