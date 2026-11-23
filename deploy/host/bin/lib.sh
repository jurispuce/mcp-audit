# Shared by the host's commands (#92, #94). Not run on its own.

# Read host.env as Docker reads it: KEY=value lines, the value as written to the end of the line,
# no quotes and no shell. A setting already in the environment wins, so one run can override it.
load_env() {
	local file="$1" line key
	[ -f "$file" ] || return 0
	while IFS= read -r line || [ -n "$line" ]; do
		[[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
		[[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
		key="${BASH_REMATCH[1]}"
		[ -n "${!key+x}" ] || export "$key=${BASH_REMATCH[2]}"
	done < "$file"
}
