# Upgrades across tenants (#97). Part of bin/tenant; not run on its own.
#
# Each tenant runs the version named in its own environment file and changes only when it is
# upgraded. An upgrade shows a "being upgraded" page at the tenant's address, backs the tenant up,
# starts the new version and waits until it is healthy and reports that version. If it does not,
# the old version and the backup made just before are put back: a newer version may have changed
# the database, and database changes only go forwards.

RELEASE='^v[0-9]+\.[0-9]+\.[0-9]+$'
is_release() { [[ "$1" =~ $RELEASE ]]; }
# The version this host is on: what new tenants get and what upgrades go to.
host_version() { echo "${MCP_AUDIT_TAG:-main}"; }

# older_than <a> <b>: both are released versions and a is the older one
older_than() {
	is_release "$1" && is_release "$2" || return 1
	[ "$1" != "$2" ] || return 1
	[ "$(printf '%s\n%s\n' "${1#v}" "${2#v}" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "${1#v}" ]
}
# How a tenant's version stands against the host's: nothing when it is the same.
version_note() { # version_note <version>
	local v="$1" h
	h="$(host_version)"
	if [ "$v" = "$h" ]; then echo ""
	elif older_than "$v" "$h"; then echo "behind"
	elif older_than "$h" "$v"; then echo "ahead"
	else echo "differs"; fi
}
moving_note() { # said once where a version is not a released one
	is_release "$1" || say "Note: \"$1\" is not a released version (such as v0.4.0). A name like main or latest moves when the image is fetched again."
}

# Which image the tenant's Compose file starts.
set_tag() { # set_tag <tenant> <version>
	local f
	f="$(tenant_dir "$1")/.env"
	(
		umask 077
		if grep -q '^MCP_AUDIT_TAG=' "$f"; then
			sed "s/^MCP_AUDIT_TAG=.*/MCP_AUDIT_TAG=$2/" "$f" > "$f.new"
		else
			{ cat "$f"; echo "MCP_AUDIT_TAG=$2"; } > "$f.new"
		fi
	)
	mv "$f.new" "$f"
}
# The version the running instance says it is, from its health page. Nothing is signed in to.
reported_version() {
	docker exec "$(container "$1")" node -e \
		"fetch('http://127.0.0.1:3000/health').then(r=>r.json()).then(j=>console.log(j.version)).catch(()=>process.exit(1))" 2> /dev/null
}
have_image() { docker image inspect "$1" > /dev/null 2>&1 || quiet docker pull "$1"; }
upgrading_file() { echo "$(tenant_dir "$1")/upgrading"; }
# The page at the tenant's address while it is upgraded, and the way back to the instance.
show_upgrading() {
	touch "$(upgrading_file "$1")"
	"$HOST_DIR/bin/proxy-sync" > /dev/null
}
show_instance() {
	local f
	f="$(upgrading_file "$1")"
	rm -f "${f:?}"
	"$HOST_DIR/bin/proxy-sync" > /dev/null
}

# Put a tenant back on the version it had, with the backup made just before the upgrade.
# 0 when it answers again on the old version; 1 when it could not be put back.
put_back() { # put_back <tenant> <old version> <backup file>
	local name="$1" from="$2" file="$3" pass
	say "Putting back version $from and the backup made just before the upgrade."
	pass="$(passphrase_of "$name")"
	quiet compose "$name" stop || true
	set_tag "$name" "$from"
	if restore_into "$name" "$file" "$pass" --force && start_container "$name" && wait_healthy "$name"; then
		# The restore keeps the replaced data aside in the volume; nothing of the failed upgrade stays.
		docker exec "$(container "$name")" sh -c 'rm -rf /data/pre-restore-*' > /dev/null 2>&1 || true
		show_instance "$name"
		return 0
	fi
	return 1
}

# Upgrade one tenant. 0: on the new version (or already there). 1: failed, and back on the old
# version with its data as before. 2: failed and could not be put back.
upgrade_one() { # upgrade_one <tenant> <version>
	local name="$1" to="$2" from image file why said
	from="$(meta_get "$name" version)"
	image="${MCP_AUDIT_IMAGE:-$default_image}:$to"
	if [ "$from" = "$to" ]; then
		say "\"$name\" is already on $to."
		return 0
	fi
	say "Upgrading \"$name\" from $from to $to."
	begin "fetch the image $image"
	if ! $dry && ! have_image "$image"; then
		echo "The image $image could not be fetched. Nothing was changed for \"$name\"." >&2
		return 1
	fi
	begin "show the \"being upgraded\" page at https://$(meta_get "$name" host)"
	begin "back up the current state"
	begin "stop the container, start version $to and wait until it is healthy"
	begin "check that the instance reports version $to"
	$dry && return 0

	if ! show_upgrading "$name"; then
		show_instance "$name" || true
		echo "The \"being upgraded\" page could not be shown, so \"$name\" was not upgraded. Nothing was changed." >&2
		return 1
	fi
	(umask 077 && mkdir -p "$(backups_of "$name")")
	file="$(backups_of "$name")/$name-$(stamp).mcpa"
	if ! make_backup "$name" "$file"; then
		show_instance "$name"
		echo "\"$name\" could not be backed up, so it was not upgraded. Nothing was changed." >&2
		event "$name" upgrade-failed "to $to: no backup"
		return 1
	fi
	event "$name" backup "$(basename "$file")"

	why=""
	quiet compose "$name" stop || why="the container could not be stopped"
	if [ -z "$why" ]; then
		set_tag "$name" "$to"
		if ! start_container "$name"; then
			why="version $to could not be started"
		elif ! wait_healthy "$name"; then
			why="version $to did not become healthy"
		else
			said="$(reported_version "$name" || true)"
			# A released version says its own name; anything else says what it was built from.
			if [ -z "$said" ]; then
				why="the instance did not say which version it is"
			elif is_release "$to" && [ "$said" != "$to" ]; then
				why="the instance reports version $said, not $to"
			fi
		fi
	fi

	if [ -z "$why" ]; then
		meta_set "$name" version "$to"
		meta_set "$name" upgraded "$(now) from $from"
		event "$name" upgraded "$from to $to"
		show_instance "$name"
		say "\"$name\" is on $to${said:+ (the instance reports $said)}. The state before is in $(basename "$file")."
		return 0
	fi

	echo "The upgrade of \"$name\" to $to failed: $why." >&2
	if put_back "$name" "$from" "$file"; then
		event "$name" upgrade-failed "to $to: $why; back on $from"
		echo "\"$name\" is back on $from, with its data as it was before the upgrade." >&2
		return 1
	fi
	event "$name" upgrade-failed "to $to: $why; NOT put back"
	echo "\"$name\" could NOT be put back on $from. Its address shows the \"being upgraded\" page." >&2
	echo "Its state before the upgrade is in $file. See: bin/tenant status $name, then bin/tenant restore $name --from $(basename "$file")" >&2
	return 2
}

# ---- tenant upgrade <name> [--to <version>]   |   tenant upgrade --all [--to <version>]
cmd_upgrade() {
	local name="" to="" all=false
	while [ $# -gt 0 ]; do
		case "$1" in
			--to) to="${2:-}"; shift 2 ;;
			--all) all=true; shift ;;
			--dry-run) dry=true; shift ;;
			-*) die "Unknown option $1" ;;
			*) name="$1"; shift ;;
		esac
	done
	[ -n "$to" ] || to="$(host_version)"
	[[ "$to" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || die "--to is not an image tag: \"$to\""
	if $all && [ -n "$name" ]; then die "Give a tenant's name or --all, not both."; fi
	$all || [ -n "$name" ] || usage
	moving_note "$to"

	if ! $all; then
		need_known "$name"
		[ "$(meta_get "$name" state)" = suspended ] && die "\"$name\" is suspended. Resume it first, then upgrade it."
		local rc=0
		upgrade_one "$name" "$to" || rc=$?
		$dry && say "Nothing was changed (--dry-run)."
		return "$rc"
	fi

	# Every tenant, one at a time: the operator's own first, the others by name.
	local first="${OPERATOR_TENANT:-}" f t
	local -a order=() done_list=() skipped=()
	if [ -n "$first" ]; then
		known "$first" || die "OPERATOR_TENANT in host.env names \"$first\", which is no tenant here."
		order+=("$first")
	else
		say "No OPERATOR_TENANT in host.env: this does not upgrade your own instance. Upgrade it first and see that it works."
	fi
	for f in "$registry"/*.meta; do
		[ -e "$f" ] || continue
		t="$(basename "$f" .meta)"
		[ "$t" = "$first" ] || order+=("$t")
	done
	[ "${#order[@]}" -gt 0 ] || { say "There are no tenants."; return 0; }
	say "Upgrading to $to, one tenant at a time: ${order[*]}"

	local i rc
	for i in "${!order[@]}"; do
		t="${order[$i]}"
		if [ "$(meta_get "$t" state)" = suspended ]; then
			say "\"$t\" is suspended: it stays on $(meta_get "$t" version). Upgrade it after it is resumed."
			skipped+=("$t")
			continue
		fi
		rc=0
		upgrade_one "$t" "$to" || rc=$?
		if [ "$rc" != 0 ]; then
			local -a rest=("${order[@]:$((i + 1))}")
			echo "Stopped at \"$t\". Upgraded before it: ${done_list[*]:-none}. Not reached, still on their version: ${rest[*]:-none}." >&2
			return "$rc"
		fi
		done_list+=("$t")
	done
	if $dry; then
		say "Nothing was changed (--dry-run)."
	else
		say "All tenants are on $to${skipped[*]:+, but for the suspended: ${skipped[*]}}."
		[ "$to" = "$(host_version)" ] || say "New tenants still get $(host_version): set MCP_AUDIT_TAG=$to in host.env."
	fi
}
