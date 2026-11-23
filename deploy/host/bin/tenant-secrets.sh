# No two tenants share a secret (#99). Part of bin/tenant; not run on its own.
#
# tenant check-secrets compares the tenants' environment files: every secret in one tenant's file
# must differ from every secret in every other tenant's file, and no tenant may hold a secret of
# the host itself. It prints names of settings and tenants, never a value.
#
# One secret is the same for all tenants on purpose: the password of the operator's mail account,
# which every instance sends its mail with. It is named in the output each time.

SECRET_NAME='^[A-Za-z0-9_]*(PASSPHRASE|TOKEN|PASSWORD|SECRET|KEY)[A-Za-z0-9_]*$'
# Settings every tenant has with the same value, by design.
SHARED_BY_DESIGN=" SMTP_PASSWORD "
# Settings of the host that a tenant is meant to be given a copy of.
HANDED_DOWN=" TENANT_SMTP_PASSWORD "

# Prints the problems found, one per line; returns 1 when there are any.
shared_secrets() {
	local f name line key value dir mode found=0
	local -A seen=() host=()
	# The host's own secrets: no tenant should hold one.
	if [ -f "$HOST_DIR/host.env" ]; then
		while IFS= read -r line || [ -n "$line" ]; do
			[[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.+)$ ]] || continue
			key="${BASH_REMATCH[1]}"
			value="${BASH_REMATCH[2]}"
			[[ "$key" =~ $SECRET_NAME ]] || continue
			[[ "$HANDED_DOWN" == *" $key "* ]] && continue
			host["$value"]="$key"
		done < "$HOST_DIR/host.env"
	fi
	for f in "$registry"/*.meta; do
		[ -e "$f" ] || continue
		name="$(basename "$f" .meta)"
		dir="$(tenant_dir "$name")"
		[ -f "$dir/.env" ] || continue
		mode="$(stat -c %a "$dir/.env" 2> /dev/null || echo "?")"
		if [ "$mode" != 600 ]; then
			echo "The environment file of \"$name\" can be read by others on this server (mode $mode, not 600)."
			found=1
		fi
		while IFS= read -r line || [ -n "$line" ]; do
			[[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.+)$ ]] || continue
			key="${BASH_REMATCH[1]}"
			value="${BASH_REMATCH[2]}"
			[[ "$key" =~ $SECRET_NAME ]] || continue
			[[ "$SHARED_BY_DESIGN" == *" $key "* ]] && continue
			if [ -n "${host[$value]:-}" ]; then
				echo "\"$name\" holds a secret of the host: its $key is the host's ${host[$value]}."
				found=1
			fi
			if [ -n "${seen[$value]:-}" ] && [ "${seen[$value]%%:*}" != "$name" ]; then
				echo "$key of \"$name\" is the same as ${seen[$value]#*:} of \"${seen[$value]%%:*}\"."
				found=1
			else
				seen["$value"]="$name:$key"
			fi
		done < "$dir/.env"
	done
	return "$found"
}

# ---- tenant check-secrets
cmd_check_secrets() {
	local count problems
	count="$(find "$registry" -maxdepth 1 -name '*.meta' 2> /dev/null | wc -l | tr -d ' ')"
	echo "Compared the environment files of $count tenant(s) with each other and with host.env."
	if problems="$(shared_secrets)"; then
		echo "No secret is shared between tenants, and no tenant holds a secret of the host."
		echo "The same for all tenants, on purpose: SMTP_PASSWORD, the password of your mail account."
		return 0
	fi
	echo "Needs attention:"
	echo "$problems" | sed 's/^/  - /'
	return 1
}
