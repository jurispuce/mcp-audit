# The onboarding pack for a tenant (#100). Part of bin/tenant; not run on its own.
#
# tenant pack <name> writes what the operator sends a new tenant's first admin besides the
# invitation the instance itself emails: a one-page statement of where the data is and who can see
# it, filled in with this tenant's and this host's facts, and a short note to send with it.
# The documents are made by scripts/onboarding-pack.mjs in the app's image; the tenant's profile
# goes in on standard input, for the first admin's name. Nothing is read from the instance.

pack_tool() { # pack_tool <tenant> <statement|note|missing>
	local name="$1" what="$2" title
	title="$(meta_get "$name" title)"
	PACK_TITLE="$title" PACK_ADDRESS="https://$(meta_get "$name" host)" PACK_SENDER="$(sender "$title")" \
		PACK_AI="$(meta_get "$name" ai)" PACK_AI_BUDGET="$(meta_get "$name" ai_budget)" PACK_AI_PERIOD="$(ai_period)" \
		PACK_DATE="$(now | cut -c1-10)" \
		docker run --rm -i -e PACK_TITLE -e PACK_ADDRESS -e PACK_SENDER -e PACK_AI -e PACK_AI_BUDGET -e PACK_AI_PERIOD -e PACK_DATE \
		-e OPERATOR_NAME -e OPERATOR_CONTACT -e OPERATOR_HOSTING -e OPERATOR_BACKUP_COPY -e OPERATOR_EMAIL_SERVICE -e OPERATOR_MODEL_PROVIDER \
		-e TENANT_AI_WEB_SEARCH -e BACKUP_KEEP_DAILY -e BACKUP_KEEP_WEEKLY -e BACKUP_KEEP_MONTHLY -e DELETED_BACKUPS_DAYS \
		"${MCP_AUDIT_IMAGE:-$default_image}:${MCP_AUDIT_TAG:-main}" node scripts/onboarding-pack.mjs "$what" \
		< "$(tenant_dir "$name")/tenant-profile.yaml"
}

# ---- tenant pack <name> [--out <directory>] [--draft]
cmd_pack() {
	local name="" out="" draft=false
	while [ $# -gt 0 ]; do
		case "$1" in
			--out) out="${2:-}"; shift 2 ;;
			--draft) draft=true; shift ;;
			--dry-run) dry=true; shift ;;
			-*) die "Unknown option $1" ;;
			*) name="$1"; shift ;;
		esac
	done
	[ -n "$name" ] || usage
	need_known "$name"
	[ -f "$(tenant_dir "$name")/tenant-profile.yaml" ] || die "\"$name\" has no tenant-profile.yaml in $(tenant_dir "$name")."
	[ -n "$out" ] || out="$HOST_DIR/packs/$name"

	local missing
	missing="$(pack_tool "$name" missing)" || die "The pack for \"$name\" could not be made."
	if [ -n "$missing" ] && ! $draft; then
		echo "The pack for \"$name\" is not ready to send. Set these in host.env first:" >&2
		echo "$missing" | sed 's/^/  - /' >&2
		echo "Or see it with the gaps marked: bin/tenant pack $name --draft" >&2
		exit 1
	fi
	if $dry; then
		say "Would write statement.html and note.txt to $out. Nothing was changed (--dry-run)."
		return 0
	fi
	(umask 077 && mkdir -p "$out")
	pack_tool "$name" statement > "$out/statement.html.new" || die "The statement for \"$name\" could not be made."
	pack_tool "$name" note > "$out/note.txt.new" || die "The note for \"$name\" could not be made."
	mv "$out/statement.html.new" "$out/statement.html"
	mv "$out/note.txt.new" "$out/note.txt"
	say "The pack for \"$name\" is in $out:"
	say "  note.txt        a note in your own name: send it as an email from your own address"
	say "  statement.html  one page on where the data is and who can see it: attach it (or print it to PDF first)"
	if [ -n "$missing" ]; then
		say "DRAFT: do not send it. The gaps are marked [TO FILL IN: …]; set these in host.env and run it again:"
		echo "$missing" | sed 's/^/  - /'
	else
		say "The instance itself has emailed the invitation, with the welcome and the link to the guide (https://$(meta_get "$name" host)/welcome/guide)."
	fi
}
