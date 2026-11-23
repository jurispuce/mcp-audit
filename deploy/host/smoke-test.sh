#!/usr/bin/env bash
# Smoke test of the tenant host layout (#92), without Cloudflare: the internal proxy and two tenants
# on test host names, on this machine's Docker.
#   IMAGE=mcp-audit:ci deploy/host/smoke-test.sh
# It creates the tenants with the tenant command (#94) and checks that each name reaches its own
# instance, an unknown name is refused, one tenant's container cannot reach another's, the visitor's
# address comes from the tunnel's header and from nowhere else, the containers run confined, and
# that suspend, resume and delete do what they say. Everything it starts is removed at the end.
set -euo pipefail

image="${IMAGE:-mcp-audit:ci}"
src="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
port="${SMOKE_PORT:-18088}"
proxy=mcp-audit-proxy-smoke
tenants=(smoke-a smoke-b)
# Made later from a backup of smoke-a; removed with the others at the end.
copies=(smoke-copy)
failed=0

say() { printf '\n== %s\n' "$*"; }
pass() { printf '  ok    %s\n' "$*"; }
fail() { printf '  FAIL  %s\n' "$*"; failed=1; }
check() { # check "<what>" <command...>
	local what="$1"; shift
	if "$@" > /dev/null 2>&1; then pass "$what"; else fail "$what"; fi
}

cleanup() {
	for t in "${tenants[@]}" "${copies[@]}"; do
		docker network disconnect "mcp-audit-tenant-$t" "$proxy" > /dev/null 2>&1 || true
		[ -d "$work/tenants/$t" ] && (cd "$work/tenants/$t" && docker compose down -v --remove-orphans > /dev/null 2>&1) || true
	done
	docker rm -f mcp-audit-check-smoke-a > /dev/null 2>&1 || true
	docker volume rm -f mcp-audit-check-smoke-a smoke-export-check > /dev/null 2>&1 || true
	[ -d "$work/host" ] && (cd "$work/host" && docker compose --env-file host.env down -v --remove-orphans > /dev/null 2>&1) || true
	rm -rf "$work"
}
trap cleanup EXIT

say "Set-up in $work"
cp -r "$src" "$work/host"
rm -rf "$work/host/tenants"/*.caddy "$work/host/registry" "$work/host/host.env"
cat > "$work/host/host.env" <<ENV
TENANT_ADDRESS_PATTERN=mcpaudit-{tenant}.smoke.test
TENANTS_DIR=$work/tenants
HOST_PROJECT=mcp-audit-host-smoke
PROXY_CONTAINER=$proxy
EDGE_NETWORK=mcp-audit-edge-smoke
EDGE_SUBNET=172.31.251.0/24
PROXY_PORT=$port
MCP_AUDIT_IMAGE=${image%:*}
MCP_AUDIT_TAG=${image##*:}
TENANT_SOURCES=nis2
TENANT_SMTP_HOST=127.0.0.1
TENANT_SMTP_PORT=2599
TENANT_SMTP_FROM={title} <audit@smoke.test>
BACKUPS_DIR=$work/backups
BACKUP_COPY_COMMAND=cp -r {dir} $work/offsite
ENV
tenant() { "$work/host/bin/tenant" "$@"; }

say "Start the proxy, then create two tenants with the tenant command"
(cd "$work/host" && docker compose --env-file host.env up -d > /dev/null 2>&1)
# The mail server named here does not exist: an instance must start all the same.
for t in "${tenants[@]}"; do
	tenant create "$t" --title "Tenant $t" --admin-email "admin@$t.smoke.test" | sed 's/^/  /'
done
check "create --dry-run changes nothing" bash -c "'$work/host/bin/tenant' create smoke-c --title 'Tenant c' --admin-email c@smoke.test --dry-run > /dev/null && [ ! -e '$work/tenants/smoke-c' ]"
check "a reserved name is refused" bash -c "! '$work/host/bin/tenant' create admin --title x --admin-email a@smoke.test"
check "a name that is taken is refused" bash -c "! '$work/host/bin/tenant' create smoke-a --title x --admin-email a@smoke.test"
check "list shows both, active" bash -c "[ \"\$('$work/host/bin/tenant' list | grep -c ' active ')\" = 2 ]"
check "the environment file is the operator's only" bash -c "[ \"\$(stat -c %a '$work/tenants/smoke-a/.env')\" = 600 ]"

# What the tunnel does: a request for a name, arriving at the proxy.
via_proxy() { # via_proxy <host> <path> [curl args...]
	local host="$1" path="$2"; shift 2
	curl -s --max-time 10 -H "Host: $host" "$@" "http://127.0.0.1:$port$path"
}
host_a=mcpaudit-smoke-a.smoke.test
host_b=mcpaudit-smoke-b.smoke.test
for h in "$host_a" "$host_b"; do
	for _ in $(seq 1 60); do via_proxy "$h" /health | grep -q '"status":"ok"' && break; sleep 1; done
done

say "Each name reaches its own instance"
check "$host_a is healthy" bash -c "curl -s --max-time 10 -H 'Host: $host_a' http://127.0.0.1:$port/health | grep -q '\"status\":\"ok\"'"
check "$host_a is Tenant smoke-a" bash -c "curl -s --max-time 10 -H 'Host: $host_a' http://127.0.0.1:$port/login | grep -q '<title>Sign in · Tenant smoke-a</title>'"
check "$host_b is Tenant smoke-b" bash -c "curl -s --max-time 10 -H 'Host: $host_b' http://127.0.0.1:$port/login | grep -q '<title>Sign in · Tenant smoke-b</title>'"
check "the instance knows its https address" bash -c "curl -s --max-time 10 -H 'Host: $host_a' http://127.0.0.1:$port/.well-known/oauth-authorization-server | grep -q '\"issuer\":\"https://$host_a\"'"

say "A name that is no tenant is refused"
check "an unknown name gets 404" bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: mcpaudit-nobody.smoke.test' http://127.0.0.1:$port/login)\" = 404 ]"
check "and no instance's page" bash -c "! curl -s --max-time 10 -H 'Host: mcpaudit-nobody.smoke.test' http://127.0.0.1:$port/login | grep -q 'Tenant smoke'"
check "nothing of a tenant is published on the server" bash -c "[ -z \"\$(docker port mcp-audit-tenant-smoke-a)\" ]"

say "One tenant cannot reach another"
reach='const [,u]=process.argv; fetch(u,{signal:AbortSignal.timeout(4000)}).then(()=>process.exit(0)).catch(()=>process.exit(7))'
ip_b="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' mcp-audit-tenant-smoke-b)"
check "A reaches itself (the test can tell success)" docker exec mcp-audit-tenant-smoke-a node -e "$reach" http://127.0.0.1:3000/health
check "A cannot reach B by name" bash -c "! docker exec mcp-audit-tenant-smoke-a node -e '$reach' http://mcp-audit-tenant-smoke-b:3000/health"
check "A cannot reach B by address ($ip_b)" bash -c "! docker exec mcp-audit-tenant-smoke-a node -e '$reach' http://$ip_b:3000/health"
check "the tenants are on different networks" bash -c "[ \"\$(docker inspect -f '{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}}{{end}}' mcp-audit-tenant-smoke-a)\" = mcp-audit-tenant-smoke-a ]"

say "The visitor's address comes from the tunnel's header"
# 30 wrong tokens lock an address out of /mcp. All from one visitor, as Cloudflare names them.
wrong() { via_proxy "$1" /mcp -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'authorization: Bearer mcpa_wrong' -H "CF-Connecting-IP: $2" -d '{}'; }
for _ in $(seq 1 30); do wrong "$host_a" 198.51.100.7 > /dev/null; done
check "that visitor is locked out (429)" bash -c "[ \"$(wrong "$host_a" 198.51.100.7)\" = 429 ]"
check "another visitor is not (401)" bash -c "[ \"$(wrong "$host_a" 198.51.100.8)\" = 401 ]"
check "and the lock is tenant A's only" bash -c "[ \"$(wrong "$host_b" 198.51.100.7)\" = 401 ]"

say "Nobody else can name the visitor"
# From inside tenant A, through the proxy, at tenant B: a different made-up visitor each time.
forge='const http=require("http");const [,proxy,host,ip]=process.argv;const r=http.request({host:proxy,port:80,path:"/mcp",method:"POST",headers:{host,"content-type":"application/json","authorization":"Bearer mcpa_wrong","cf-connecting-ip":ip,"x-client-ip":ip,"x-forwarded-for":ip}},s=>{console.log(s.statusCode);s.resume()});r.on("error",()=>console.log("error"));r.end("{}")'
last=""
for i in $(seq 1 31); do last="$(docker exec mcp-audit-tenant-smoke-a node -e "$forge" "$proxy" "$host_b" "203.0.113.$i")"; done
check "31 requests with made-up addresses count as one sender (429, got $last)" bash -c "[ \"$last\" = 429 ]"
check "which leaves real visitors of B alone (401)" bash -c "[ \"$(wrong "$host_b" 198.51.100.9)\" = 401 ]"

say "Containers are confined"
for t in "${tenants[@]}"; do
	c="mcp-audit-tenant-$t"
	check "$c does not run as root" bash -c "[ \"\$(docker exec $c id -u)\" != 0 ]"
	check "$c has a memory limit" bash -c "[ \"\$(docker inspect -f '{{.HostConfig.Memory}}' $c)\" -gt 0 ]"
	check "$c has a CPU limit" bash -c "[ \"\$(docker inspect -f '{{.HostConfig.NanoCpus}}' $c)\" -gt 0 ]"
	check "$c restarts on failure" bash -c "[ \"\$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' $c)\" = unless-stopped ]"
	check "$c rotates its logs" bash -c "[ \"\$(docker inspect -f '{{index .HostConfig.LogConfig.Config \"max-size\"}}' $c)\" = 10m ]"
	check "$c has a read-only filesystem" bash -c "[ \"\$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' $c)\" = true ]"
	check "$c holds no extra rights" bash -c "docker inspect -f '{{.HostConfig.CapDrop}}' $c | grep -q ALL"
	check "$c has its own data volume" bash -c "docker inspect -f '{{range .Mounts}}{{.Name}} {{end}}' $c | grep -q \"mcp-audit-tenant-${t}_data\""
done
check "the tenants' secrets differ" bash -c "[ \"\$(docker exec mcp-audit-tenant-smoke-a printenv BACKUP_PASSPHRASE)\" != \"\$(docker exec mcp-audit-tenant-smoke-b printenv BACKUP_PASSPHRASE)\" ]"

say "Back up a tenant, change it, restore: the change is gone"
ca=mcp-audit-tenant-smoke-a
db='const D=require("better-sqlite3");const db=new D("/data/app.db");'
admin_name() { docker exec "$1" node -e "$db console.log(db.prepare('SELECT name FROM \"user\" ORDER BY created_at LIMIT 1').get().name)"; }
tenant backup smoke-a > /dev/null
first_backup="$(ls "$work/backups/smoke-a" | head -1)"
check "the backup is the operator's only" bash -c "[ \"\$(stat -c %a '$work/backups/smoke-a/$first_backup')\" = 600 ] && [ \"\$(stat -c %a '$work/backups/smoke-a')\" = 700 ]"
check "it is encrypted (the app's own format, no readable content)" bash -c "head -c 7 '$work/backups/smoke-a/$first_backup' | grep -q MCPABK1 && ! grep -q 'smoke.test' '$work/backups/smoke-a/$first_backup'"
docker exec "$ca" node -e "$db db.prepare('UPDATE \"user\" SET name = ?').run('Changed after the backup')"
docker exec "$ca" sh -c 'mkdir -p /data/files/zz && echo late > /data/files/zz/late'
check "the change is there" bash -c "[ \"$(admin_name "$ca")\" = 'Changed after the backup' ]"
check "restore asks for the name" bash -c "! echo nope | '$work/host/bin/tenant' restore smoke-a --from latest"
echo smoke-a | tenant restore smoke-a --from "$first_backup" > /dev/null
check "after the restore the change is gone" bash -c "[ \"$(admin_name "$ca")\" = 'Admin of smoke-a' ] || [ \"$(admin_name "$ca")\" = 'admin' ]"
check "and so is the file added since" bash -c "! docker exec $ca test -e /data/files/zz/late"
check "the state before the restore was backed up" bash -c "[ \"\$(ls '$work/backups/smoke-a' | wc -l)\" = 2 ]"
check "nothing of the replaced data is left in the volume" bash -c "! docker exec $ca sh -c 'ls /data | grep -q pre-restore'"
check "the instance answers again" bash -c "curl -s --max-time 10 -H 'Host: $host_a' http://127.0.0.1:$port/login | grep -q '<title>Sign in · Tenant smoke-a</title>'"

say "Restore a backup as a new tenant"
tenant restore smoke-a --from "$first_backup" --as smoke-copy > /dev/null
host_copy=mcpaudit-smoke-copy.smoke.test
check "the copy answers at its own address" bash -c "curl -s --max-time 10 -H 'Host: $host_copy' http://127.0.0.1:$port/login | grep -q '<title>Sign in · Tenant smoke-a</title>'"
check "it holds the people of the backup" bash -c "[ \"$(admin_name mcp-audit-tenant-smoke-copy)\" = \"$(admin_name "$ca")\" ]"
check "it has a passphrase of its own" bash -c "[ \"\$(docker exec mcp-audit-tenant-smoke-copy printenv BACKUP_PASSPHRASE)\" != \"\$(docker exec $ca printenv BACKUP_PASSPHRASE)\" ]"
check "the original is untouched" bash -c "'$work/host/bin/tenant' list | grep -q 'smoke-a .* active '"

say "One tenant's backup cannot be opened with another's passphrase"
wrong_key="$( (cd "$work/tenants/smoke-b" && docker compose run --rm -T --no-deps -e DATA_DIR=/tmp/elsewhere app sh -c 'cat > /tmp/in.mcpa && node scripts/restore.mjs --in /tmp/in.mcpa' < "$work/backups/smoke-a/$first_backup" 2>&1) || true)"
check "tenant B's passphrase is refused for tenant A's backup" bash -c "echo \"$wrong_key\" | grep -q 'Could not decrypt the backup'"

say "The newest backup restores into a working instance"
check "check-backup passes" "$work/host/bin/tenant" check-backup smoke-a
check "and leaves no throwaway behind" bash -c "! docker container inspect mcp-audit-check-smoke-a && ! docker volume inspect mcp-audit-check-smoke-a"

say "Export for a tenant that leaves"
exported="$(tenant export smoke-a)"
archive="$(echo "$exported" | sed -n 's/^Export of "smoke-a": //p')"
export_pass="$(echo "$exported" | sed -n 's/^    \([A-Za-z0-9_-]\{43\}\)$/\1/p')"
check "an archive with a readme and one encrypted file" bash -c "[ \"\$(tar -tf '$archive' | sort | tr '\n' ' ')\" = \"README.txt \$(basename '$archive' .tar).mcpa \" ]"
open_export() { # open_export <passphrase>: restore the exported file somewhere harmless
	tar -xOf "$archive" "$(basename "$archive" .tar).mcpa" | BACKUP_PASSPHRASE="$1" docker run --rm -i -e BACKUP_PASSPHRASE -e DATA_DIR=/tmp/elsewhere "$image" \
		sh -c 'cat > /tmp/in.mcpa && node scripts/restore.mjs --in /tmp/in.mcpa'
}
check "it opens with the passphrase that was shown" open_export "$export_pass"
check "and not with the tenant's backup passphrase" bash -c "! (tar -xOf '$archive' \"\$(basename '$archive' .tar).mcpa\" | docker run --rm -i -e BACKUP_PASSPHRASE=\"\$(docker exec $ca printenv BACKUP_PASSPHRASE)\" -e DATA_DIR=/tmp/elsewhere '$image' sh -c 'cat > /tmp/in.mcpa && node scripts/restore.mjs --in /tmp/in.mcpa')"

say "The nightly run"
check "nightly backs up every tenant and copies off the server" "$work/host/bin/tenant" nightly
check "each tenant has a backup from tonight" bash -c "[ \"\$(ls '$work/backups/smoke-b' | wc -l)\" = 1 ] && [ \"\$(ls '$work/backups/smoke-a' | wc -l)\" = 3 ]"
check "the copy off the server has them" bash -c "[ \"\$(ls '$work/offsite/smoke-a' | wc -l)\" = 3 ]"
check "the status for the operator says no failures" grep -q '^failures=0$' "$work/host/registry/nightly.status"

say "Suspend and resume a tenant"
tenant suspend smoke-b > /dev/null
check "its address shows the suspended page (503)" bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: $host_b' http://127.0.0.1:$port/login)\" = 503 ]"
check "and says so plainly" bash -c "curl -s --max-time 10 -H 'Host: $host_b' http://127.0.0.1:$port/login | grep -q 'This instance is suspended'"
check "its container is stopped, its data kept" bash -c "[ \"\$(docker inspect -f '{{.State.Status}}' mcp-audit-tenant-smoke-b)\" = exited ] && docker volume inspect mcp-audit-tenant-smoke-b_data > /dev/null"
check "the other tenant still answers" bash -c "curl -s --max-time 10 -H 'Host: $host_a' http://127.0.0.1:$port/health | grep -q '\"status\":\"ok\"'"
check "list says suspended" bash -c "'$work/host/bin/tenant' list | grep -q 'smoke-b .* suspended '"
tenant resume smoke-b > /dev/null
check "after resume it answers again" bash -c "curl -s --max-time 10 -H 'Host: $host_b' http://127.0.0.1:$port/login | grep -q '<title>Sign in · Tenant smoke-b</title>'"

say "Delete a tenant"
check "not without the name typed again" bash -c "! echo smoke-a | '$work/host/bin/tenant' delete smoke-b"
echo smoke-b | tenant delete smoke-b > /dev/null
check "its address is no instance any more (404)" bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: $host_b' http://127.0.0.1:$port/health)\" = 404 ]"
check "its container is gone" bash -c "! docker container inspect mcp-audit-tenant-smoke-b"
check "its data is gone" bash -c "! docker volume inspect mcp-audit-tenant-smoke-b_data"
check "its network is gone" bash -c "! docker network inspect mcp-audit-tenant-smoke-b"
check "its directory is gone" bash -c "[ ! -e '$work/tenants/smoke-b' ]"
check "a record of the deletion stays" bash -c "grep -q '^smoke-b' '$work/host/registry/deleted.tsv'"
check "a final export was made" bash -c "ls '$work/exports' | grep -q '^smoke-b-export-.*\.tar$'"
check "its backups are kept for now, with what opens them apart from them" bash -c "[ -n \"\$(ls '$work/backups/smoke-b')\" ] && [ \"\$(stat -c %a '$work/tenants/.deleted/smoke-b/.env')\" = 600 ]"
check "the other tenant is untouched" bash -c "curl -s --max-time 10 -H 'Host: $host_a' http://127.0.0.1:$port/login | grep -q '<title>Sign in · Tenant smoke-a</title>'"

if [ "$failed" = 0 ]; then printf '\nAll checks passed.\n'; else printf '\nSome checks FAILED.\n'; docker logs "$proxy" 2>&1 | tail -20; exit 1; fi
