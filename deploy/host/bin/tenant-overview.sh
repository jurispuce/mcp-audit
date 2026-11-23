# The operator's overview (#98). Part of bin/tenant; not run on its own.
#
# tenant status --all shows, for every tenant: whether it is up, its version, its last backup and
# restore check, how much data it holds, how many people use it and when someone last signed in,
# and its AI spend. It ends with a non-zero exit code when something needs attention, so a
# scheduled run can tell the operator.
#
# What it knows of a tenant is numbers and dates. The ones only the instance knows come from the
# instance's operator endpoint, asked inside the tenant's own container with that tenant's own
# token: counts, sizes and dates, never a name, a title or a document.

ATTENTION_EXIT=3

# seconds since a time like 2026-11-23T02:00:00Z; nothing when it cannot be read
age_seconds() { # age_seconds <time>
	local then
	then="$(date -u -d "$1" +%s 2> /dev/null)" || return 1
	echo $(($(date -u +%s) - then))
}
# The time in a backup's name: acme-20261123T020000Z.mcpa
backup_time() {
	local s
	s="$(echo "$1" | sed -n 's/.*-\([0-9]\{8\}T[0-9]\{6\}Z\)\.mcpa$/\1/p')"
	[ -n "$s" ] || return 1
	echo "${s:0:4}-${s:4:2}-${s:6:2}T${s:9:2}:${s:11:2}:${s:13:2}Z"
}
short_time() { [ -n "$1" ] && [ "$1" != "-" ] && echo "${1:0:10} ${1:11:5}" || echo "$2"; }
human_bytes() {
	awk -v b="${1:-0}" 'BEGIN { split("B kB MB GB TB", u, " "); i = 1; while (b >= 1000 && i < 5) { b /= 1000; i++ } printf (i == 1 ? "%d %s" : "%.1f %s"), b, u[i] }'
}

# The numbers only the instance knows. One line: "ok <users> <invited> <engagements> <bytes>
# <last sign-in> <last activity> <version>", or why there are none.
NUMBERS_JS='const t=process.env.OPERATOR_TOKEN;if(!t){console.log("no-token")}else{fetch("http://127.0.0.1:3000/api/operator/status",{headers:{authorization:"Bearer "+t},signal:AbortSignal.timeout(8000)}).then(async r=>{if(!r.ok){console.log("status-"+r.status);return}const j=await r.json();console.log(["ok",j.users,j.invited,j.engagements,j.database_bytes+j.files_bytes,j.last_sign_in||"-",j.last_activity||"-",j.version].join(" "))}).catch(()=>console.log("unreachable"))}'
instance_numbers() { docker exec "$(container "$1")" node -e "$NUMBERS_JS" 2> /dev/null || echo unreachable; }

# How full the disks are that hold the tenants' data and backups: "<percent> <mount point>" lines.
disks() {
	local root p
	root="$(docker info -f '{{.DockerRootDir}}' 2> /dev/null || true)"
	for p in "${BACKUPS_DIR:-}" "${TENANTS_DIR:-}" "$root"; do
		[ -n "$p" ] && [ -e "$p" ] || continue
		df -P "$p" 2> /dev/null | awk 'NR == 2 { gsub("%", "", $5); print $5, $6 }'
	done | sort -u
}

cmd_status_all() {
	local f name
	local -a problems=() notes=()
	local backup_hours="${BACKUP_ALERT_HOURS:-26}" disk_percent="${DISK_ALERT_PERCENT:-85}"
	echo "Tenants on this host at $(now). The host is on $(host_version)."
	printf '%-16s %-10s %-18s %-17s %-17s %-9s %-14s %-17s %s\n' NAME STATE VERSION BACKUP "RESTORE CHECK" DATA PEOPLE "LAST SIGN-IN" AI
	for f in "$registry"/*.meta; do
		[ -e "$f" ] || continue
		name="$(basename "$f" .meta)"
		local version note state up=false raw
		version="$(meta_get "$name" version)"
		note="$(version_note "$version")"

		# ---- Up or not
		if [ "$(meta_get "$name" state)" = suspended ]; then
			state=suspended
		else
			raw="$(docker inspect -f '{{.State.Status}} {{.RestartCount}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$(container "$name")" 2> /dev/null || echo "missing 0")"
			case "$raw" in
				"running "*" healthy") state=up; up=true ;;
				*)
					state=DOWN
					problems+=("$name: the instance is not up ($(echo "$raw" | awk '{ print $1 ($3 ? ", " $3 : "") }')).")
					;;
			esac
			if [ -f "$(tenant_dir "$name")/upgrading" ]; then
				problems+=("$name: its address shows the \"being upgraded\" page. An upgrade is running, or one could not be put back.")
			fi
		fi

		# ---- Backups
		local newest at age backup check checked
		newest="$(newest_backup "$name")"
		if [ -z "$newest" ]; then
			backup=none
			problems+=("$name: it has no backup.")
		else
			at="$(backup_time "$newest" || true)"
			backup="$(short_time "$at" "?")"
			age="$(age_seconds "$at" || echo 0)"
			if [ "$age" -gt $((backup_hours * 3600)) ]; then
				problems+=("$name: its last backup is $((age / 3600)) hours old ($backup).")
			fi
		fi
		[ -n "$(meta_get "$name" last_backup_failed)" ] && problems+=("$name: a backup failed at $(meta_get "$name" last_backup_failed).")
		checked="$(meta_get "$name" restore_checked)"
		case "$checked" in
			*" ok "*) check="ok ${checked:0:10}" ;;
			*" failed "*)
				check="FAILED ${checked:0:10}"
				problems+=("$name: the restore check of ${checked##* } failed. Its backups may not restore.")
				;;
			*) check="not yet" ;;
		esac

		# ---- What the instance itself reports
		local data="-" people="-" signin="-" numbers
		if $up; then
			numbers="$(instance_numbers "$name")"
			case "$numbers" in
				"ok "*)
					# shellcheck disable=SC2086
					set -- $numbers
					data="$(human_bytes "$5")"
					people="$2$([ "$3" -gt 0 ] && echo " (+$3 invited)")"
					signin="$(short_time "$6" never)"
					;;
				no-token | status-404) notes+=("$name: it gives no numbers (no OPERATOR_TOKEN in its .env, or a version before the operator endpoint).") ;;
				*) problems+=("$name: it is up but did not give its numbers ($numbers).") ;;
			esac
		fi

		# ---- AI
		local ai
		ai="$(ai_line "$name")"
		case "$ai" in
			*"USED UP"*) problems+=("$name: its AI budget is used up ($ai).") ;;
			*"did not answer"*) problems+=("$name: the AI gateway did not answer for its key.") ;;
		esac

		printf '%-16s %-10s %-18s %-17s %-17s %-9s %-14s %-17s %s\n' "$name" "$state" "$version${note:+ ($note)}" "$backup" "$check" "$data" "$people" "$signin" "$ai"
	done

	# ---- The server's own disks
	local line pct mount shown=""
	while read -r line; do
		[ -n "$line" ] || continue
		pct="${line%% *}"
		mount="${line#* }"
		shown="$shown${shown:+, }$mount $pct% full"
		if [ "$pct" -ge "$disk_percent" ] 2> /dev/null; then
			problems+=("The disk at $mount is $pct% full.")
		fi
	done < <(disks)
	[ -n "$shown" ] && echo "Disk: $shown."

	if [ -f "$registry/nightly.status" ] && ! grep -q '^failures=0$' "$registry/nightly.status"; then
		problems+=("The last nightly run had failures. See $registry/nightly.status")
	fi

	local n
	for n in "${notes[@]:-}"; do [ -n "$n" ] && echo "Note: $n"; done
	if [ "${#problems[@]}" -eq 0 ]; then
		echo "All well."
		return 0
	fi
	echo "Needs attention (${#problems[@]}):"
	for n in "${problems[@]}"; do echo "  - $n"; done
	return "$ATTENTION_EXIT"
}
