#!/usr/bin/env bash
# Smoke test of the tenant host layout (#92), without Cloudflare: the internal proxy and two tenants
# on test host names, on this machine's Docker.
#   IMAGE=mcp-audit:ci deploy/host/smoke-test.sh
# It creates the tenants with the tenant command (#94) and checks that each name reaches its own
# instance, an unknown name is refused, one tenant's container cannot reach another's, the visitor's
# address comes from the tunnel's header and from nowhere else, the containers run confined, each
# tenant has its own key and budget at the AI gateway (#95; a scripted stand-in for LiteLLM), and
# an upgrade backs up first and a failed one is rolled back (#97; test images made from $IMAGE), and
# the operator's overview reports a stopped tenant and a missing backup and nothing of a tenant's
# content (#98), and that suspend, resume and delete do what they say. Everything it starts is
# removed at the end.
set -euo pipefail

image="${IMAGE:-mcp-audit:ci}"
src="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
port="${SMOKE_PORT:-18088}"
proxy=mcp-audit-proxy-smoke
gateway=mcp-audit-gateway-smoke
gateway_net=mcp-audit-gateway-smoke
repo="$(cd "$src/../.." && pwd)"
repo_image="${image%:*}"
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
	docker rm -f "$gateway" > /dev/null 2>&1 || true
	for t in "${tenants[@]}" "${copies[@]}"; do
		docker network disconnect "mcp-audit-tenant-$t" "$proxy" > /dev/null 2>&1 || true
		[ -d "$work/tenants/$t" ] && (cd "$work/tenants/$t" && docker compose down -v --remove-orphans > /dev/null 2>&1) || true
	done
	docker rm -f mcp-audit-check-smoke-a > /dev/null 2>&1 || true
	docker volume rm -f mcp-audit-check-smoke-a smoke-export-check > /dev/null 2>&1 || true
	[ -d "$work/host" ] && (cd "$work/host" && docker compose --env-file host.env down -v --remove-orphans > /dev/null 2>&1) || true
	docker network rm "$gateway_net" > /dev/null 2>&1 || true
	docker rmi "$repo_image:v9.9.1" "$repo_image:v9.9.2" > /dev/null 2>&1 || true
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
GATEWAY_CONTAINER=$gateway
AI_GATEWAY_URL=http://$gateway:4000/v1
AI_GATEWAY_MASTER_KEY=sk-smoke-master
AI_GATEWAY_NETWORK=$gateway_net
TENANT_AI_DEFAULT_MODEL=fake-tools
TENANT_AI_BUDGET=5
DISK_ALERT_PERCENT=101
ENV
tenant() { "$work/host/bin/tenant" "$@"; }

say "Start the proxy and an AI gateway, then create two tenants with the tenant command"
(cd "$work/host" && docker compose --env-file host.env up -d > /dev/null 2>&1)
# The gateway: the tests' scripted stand-in for LiteLLM, with its key management. Not published.
docker network create "$gateway_net" > /dev/null
docker run -d --name "$gateway" --network "$gateway_net" -e PORT=4000 -e FAKE_MASTER_KEY=sk-smoke-master \
	-v "$repo/e2e/fake-llm.mjs:/fake/fake-llm.mjs:ro" "$image" node /fake/fake-llm.mjs > /dev/null
for _ in $(seq 1 30); do
	docker exec "$gateway" node -e "fetch('http://127.0.0.1:4000/v1/models').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" > /dev/null 2>&1 && break
	sleep 1
done
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
check "and so does the other: each names itself as issuer, and only itself" bash -c "curl -s --max-time 10 -H 'Host: $host_b' http://127.0.0.1:$port/.well-known/oauth-authorization-server | grep -q '\"issuer\":\"https://$host_b\"' && ! curl -s --max-time 10 -H 'Host: $host_b' http://127.0.0.1:$port/.well-known/oauth-authorization-server | grep -q '$host_a'"

say "Every answer carries a Content-Security-Policy"
csp_of() { via_proxy "$host_a" "$1" -o /dev/null -D - | tr -d '\r' | sed -n 's/^[Cc]ontent-[Ss]ecurity-[Pp]olicy: //p'; }
check "a page allows the app's own scripts and the one it names, nothing inline" bash -c "echo \"$(csp_of /login)\" | grep -q \"script-src 'self' 'nonce-[A-Za-z0-9+/=]*';\" && echo \"$(csp_of /login)\" | grep -q \"frame-ancestors 'none'\""
check "an API answer allows nothing" bash -c "[ \"$(csp_of /health)\" = \"default-src 'none'; frame-ancestors 'none'\" ]"
check "a static file allows nothing" bash -c "[ \"$(csp_of /icons/icon.svg)\" = \"default-src 'none'; frame-ancestors 'none'\" ]"
check "a redirect allows nothing" bash -c "[ \"$(csp_of /settings)\" = \"default-src 'none'; frame-ancestors 'none'\" ]"

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
check "no two tenants share a secret, and none holds one of the host (the command compares their environment files)" "$work/host/bin/tenant" check-secrets
check "the tenants' secrets differ" bash -c "[ \"\$(docker exec mcp-audit-tenant-smoke-a printenv BACKUP_PASSPHRASE)\" != \"\$(docker exec mcp-audit-tenant-smoke-b printenv BACKUP_PASSPHRASE)\" ]"

say "AI: each tenant has its own key and budget at the shared gateway"
ai_of() { tenant status "$1" | sed -n 's/^AI: *//p'; }
spent() { ai_of "$1" | sed -n 's/^\$\([0-9.]*\) of.*/\1/p'; }
key_of() { sed -n 's/^LITELLM_API_KEY=//p' "$work/tenants/$1/.env"; }
# One question to the model from inside a tenant's container, with its own key unless one is given.
ask='const [,u,k]=process.argv; fetch(u+"/chat/completions",{method:"POST",headers:{authorization:"Bearer "+(k||process.env.LITELLM_API_KEY),"content-type":"application/json"},body:JSON.stringify({model:"fake-tools",messages:[{role:"user",content:"hello"}]}),signal:AbortSignal.timeout(5000)}).then(async r=>console.log(r.status,(await r.json()).error?.type??"ok")).catch(()=>console.log("unreachable"))'
ask_as() { docker exec "mcp-audit-tenant-$1" node -e "$ask" "http://$gateway:4000/v1" "${2:-}"; }
# An attempt to raise its own budget, with its own key.
raise='const [,u]=process.argv; const k=process.env.LITELLM_API_KEY; fetch(u+"/key/update",{method:"POST",headers:{authorization:"Bearer "+k,"content-type":"application/json"},body:JSON.stringify({key:k,max_budget:1000}),signal:AbortSignal.timeout(5000)}).then(r=>console.log(r.status)).catch(()=>console.log("unreachable"))'
# Each instance checks its model through the gateway as it starts: wait until both have.
for _ in $(seq 1 40); do [ "$(spent smoke-a)" != 0.00 ] && [ "$(spent smoke-b)" != 0.00 ] && break; sleep 1; done
check "each instance reached the gateway with its own key at its first start" bash -c "[ '$(spent smoke-a)' != 0.00 ] && [ '$(spent smoke-b)' != 0.00 ]"
check "status shows what is used and what is left ($(ai_of smoke-a))" bash -c "echo '$(ai_of smoke-a)' | grep -q 'of \$5.00 used, .* left'"
check "the tenants' keys differ" bash -c "[ -n '$(key_of smoke-a)' ] && [ '$(key_of smoke-a)' != '$(key_of smoke-b)' ]"
check "the key is in the tenant's environment file, not in its profile" bash -c "! grep -q '$(key_of smoke-a)' '$work/tenants/smoke-a/tenant-profile.yaml'"
check "no tenant holds the gateway's master key" bash -c "! docker exec mcp-audit-tenant-smoke-a printenv | grep -q sk-smoke-master && ! grep -rq sk-smoke-master '$work/tenants/smoke-a'"
check "the gateway is not published on the server" bash -c "[ -z \"\$(docker port $gateway)\" ]"
check "a tenant cannot change its own budget (401)" bash -c "[ \"\$(docker exec mcp-audit-tenant-smoke-a node -e '$raise' http://$gateway:4000)\" = 401 ]"
before_a="$(spent smoke-a)"; before_b="$(spent smoke-b)"
check "tenant A asks the model" bash -c "[ '$(ask_as smoke-a)' = '200 ok' ]"
check "that is counted for A ($before_a to $(spent smoke-a))" bash -c "[ '$(spent smoke-a)' != '$before_a' ]"
check "and not for B" bash -c "[ '$(spent smoke-b)' = '$before_b' ]"
tenant ai smoke-a --off > /dev/null
check "switched off: A is refused as blocked" bash -c "[ '$(ask_as smoke-a)' = '401 auth_error' ]"
check "status says so" bash -c "echo '$(ai_of smoke-a)' | grep -q 'SWITCHED OFF'"
check "B still works" bash -c "[ '$(ask_as smoke-b)' = '200 ok' ]"
tenant ai smoke-a --on > /dev/null
check "switched on: A works again" bash -c "[ '$(ask_as smoke-a)' = '200 ok' ]"
tenant ai smoke-a --budget 0.25 > /dev/null
check "a budget below what is used: A is refused as over budget" bash -c "[ '$(ask_as smoke-a)' = '422 budget_exceeded' ]"
check "status says used up" bash -c "echo '$(ai_of smoke-a)' | grep -q 'USED UP'"
check "B still works" bash -c "[ '$(ask_as smoke-b)' = '200 ok' ]"
tenant ai smoke-a --budget 10 > /dev/null
check "the budget raised: A works again" bash -c "[ '$(ask_as smoke-a)' = '200 ok' ]"
check "A still cannot reach B, with the gateway on both networks" bash -c "! docker exec mcp-audit-tenant-smoke-a node -e '$reach' http://mcp-audit-tenant-smoke-b:3000/health"
check "A is on its own network only" bash -c "[ \"\$(docker inspect -f '{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}}{{end}}' mcp-audit-tenant-smoke-a)\" = mcp-audit-tenant-smoke-a ]"

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
check "it has an AI key of its own" bash -c "[ -n '$(key_of smoke-copy)' ] && [ '$(key_of smoke-copy)' != '$(key_of smoke-a)' ]"
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

say "An instance that is not answering shows a plain page, not an error"
docker stop mcp-audit-tenant-smoke-b > /dev/null
check "its address says it is restarting (503)" bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: $host_b' http://127.0.0.1:$port/login)\" = 503 ] && curl -s --max-time 10 -H 'Host: $host_b' http://127.0.0.1:$port/login | grep -q 'This instance is restarting'"
docker start mcp-audit-tenant-smoke-b > /dev/null
for _ in $(seq 1 60); do via_proxy "$host_b" /health | grep -q '"status":"ok"' && break; sleep 1; done
check "and answers again once it is up" bash -c "curl -s --max-time 10 -H 'Host: $host_b' http://127.0.0.1:$port/login | grep -q '<title>Sign in · Tenant smoke-b</title>'"

say "Upgrade a tenant: a backup first, a page meanwhile, the new version after"
# Two versions made from the image under test: one that works, and one that damages the data
# and then fails to start, as a bad release with a bad migration would.
# Made from a container of the image, without a build, so no builder has to find a local image.
version_image() { # version_image <version> [<command as a JSON list>]
	local c
	c="$(docker create "$image")"
	docker commit -c "ENV APP_VERSION=$1" ${2:+-c "CMD $2"} "$c" "$repo_image:$1" > /dev/null
	docker rm "$c" > /dev/null
}
version_image v9.9.1
damage='const D=require("better-sqlite3");const db=new D("/data/app.db");db.prepare("UPDATE \"user\" SET name = ?").run("Broken by the upgrade");console.log("damaged:",db.prepare("SELECT name FROM \"user\" LIMIT 1").get().name);process.exit(1)'
version_image v9.9.2 "[\"node\",\"-e\",$(printf '%s' "$damage" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')]"
version_at() { via_proxy "$1" /health | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'; }
name_before="$(admin_name "$ca")"
backups_before="$(ls "$work/backups/smoke-a" | wc -l)"
# What a visitor sees while it runs: every answer's status, twice a second.
seen="$work/seen-during-upgrade"
( while [ ! -e "$work/upgrade-done" ]; do
	printf '%s %s\n' "$(curl -s -o "$work/page" -w '%{http_code}' --max-time 5 -H "Host: $host_a" "http://127.0.0.1:$port/login")" "$(head -c 60 "$work/page" | tr '\n' ' ')" >> "$seen"
	sleep 0.3
done ) &
watcher=$!
tenant upgrade smoke-a --to v9.9.1 > "$work/upgrade.out" 2>&1 && upgraded=yes || upgraded=no
touch "$work/upgrade-done"; wait "$watcher" 2> /dev/null || true
check "the upgrade succeeds" bash -c "[ $upgraded = yes ]"
[ "$upgraded" = yes ] || sed 's/^/    /' "$work/upgrade.out"
check "the instance reports the new version (v9.9.1, got $(version_at "$host_a"))" bash -c "[ '$(version_at "$host_a")' = v9.9.1 ]"
check "list shows it" bash -c "'$work/host/bin/tenant' list | grep -q 'smoke-a .* v9.9.1 '"
check "a backup was made first" bash -c "[ \"\$(ls '$work/backups/smoke-a' | wc -l)\" = $((backups_before + 1)) ]"
check "its data is as it was" bash -c "[ \"$(admin_name "$ca")\" = \"$name_before\" ]"
check "a visitor saw the \"being upgraded\" page meanwhile" grep -q '^503 This instance is being upgraded' "$seen"
check "and nothing but the instance or that page (no error)" bash -c "! grep -v -e '^200 ' -e '^503 This instance is being upgraded' '$seen' | grep -q ."
check "the address leads to the instance again" bash -c "curl -s --max-time 10 -H 'Host: $host_a' http://127.0.0.1:$port/login | grep -q '<title>Sign in · Tenant smoke-a</title>'"

say "A version that fails is rolled back, with the data as before"
tenant upgrade smoke-a --to v9.9.2 > "$work/upgrade-bad.out" 2>&1 && bad=passed || bad=failed
check "the upgrade fails and says why" bash -c "[ $bad = failed ] && grep -q 'The upgrade of \"smoke-a\" to v9.9.2 failed: version v9.9.2 did not become healthy' '$work/upgrade-bad.out'"
check "the failed version had changed the data before it stopped" grep -q 'damaged: Broken by the upgrade' "$work/upgrade-bad.out"
check "the tenant is back on the old version" bash -c "grep -q '\"smoke-a\" is back on v9.9.1' '$work/upgrade-bad.out' && '$work/host/bin/tenant' list | grep -q 'smoke-a .* v9.9.1 '"
for _ in $(seq 1 30); do [ "$(version_at "$host_a")" = v9.9.1 ] && break; sleep 1; done
check "it answers on the old version (got $(version_at "$host_a"))" bash -c "[ '$(version_at "$host_a")' = v9.9.1 ]"
check "what the failed version did to the data is gone" bash -c "[ \"$(admin_name "$ca")\" = \"$name_before\" ]"
check "nothing of the failed upgrade is left in the volume" bash -c "! docker exec $ca sh -c 'ls /data | grep -q pre-restore'"
check "the address leads to the instance again" bash -c "curl -s --max-time 10 -H 'Host: $host_a' http://127.0.0.1:$port/login | grep -q '<title>Sign in · Tenant smoke-a</title>'"

say "Upgrade all: the operator's own first, and stop at the first failure"
echo "OPERATOR_TENANT=smoke-copy" >> "$work/host/host.env"
tenant upgrade --all --to v9.9.2 > "$work/upgrade-all-bad.out" 2>&1 && all_bad=passed || all_bad=failed
check "it stops at the operator's own instance" bash -c "[ $all_bad = failed ] && grep -q 'Stopped at \"smoke-copy\". Upgraded before it: none. Not reached, still on their version: smoke-a smoke-b.' '$work/upgrade-all-bad.out'"
check "which is back on its version and answers" bash -c "'$work/host/bin/tenant' list | grep -q 'smoke-copy .* ${image##*:} ' && curl -s --max-time 10 -H 'Host: $host_copy' http://127.0.0.1:$port/health | grep -q '\"status\":\"ok\"'"
check "the tenants after it were not touched" bash -c "'$work/host/bin/tenant' list | grep -q 'smoke-b .* ${image##*:} ' && [ \"\$(docker inspect -f '{{.Config.Image}}' mcp-audit-tenant-smoke-b)\" = '$image' ]"
tenant upgrade --all --to v9.9.1 > "$work/upgrade-all.out" 2>&1 && all_good=passed || all_good=failed
[ "$all_good" = passed ] || sed 's/^/    /' "$work/upgrade-all.out"
check "a good version reaches every tenant, the operator's first" bash -c "[ $all_good = passed ] && grep -q 'one tenant at a time: smoke-copy smoke-a smoke-b' '$work/upgrade-all.out' && grep -q '\"smoke-a\" is already on v9.9.1' '$work/upgrade-all.out'"
check "all report the new version" bash -c "[ '$(version_at "$host_b")' = v9.9.1 ] && [ '$(version_at "$host_copy")' = v9.9.1 ]"

say "The operator's overview: numbers, and nothing of a tenant's content"
overview="$(tenant status --all 2>&1)" && overview_rc=0 || overview_rc=$?
echo "$overview" | sed 's/^/    /'
check "all is well, and the command says so (exit 0)" bash -c "[ $overview_rc = 0 ] && echo \"$overview\" | grep -q '^All well\.$'"
check "each tenant is shown up, with its version and a backup" bash -c "[ \"\$(echo \"$overview\" | grep -c -E '^smoke-(a|b|copy) +up +v9\.9\.1 .* 20[0-9-]+ [0-9:]+ +ok ')\" = 3 ]"
check "with the people it has and how much it holds" bash -c "echo \"$overview\" | grep -q -E '^smoke-a .* [0-9.]+ (kB|MB) +0 \(\+1 invited\) +never '"
token_of() { sed -n 's/^OPERATOR_TOKEN=//p' "$work/tenants/$1/.env"; }
# Ask an instance's operator endpoint from inside its own container: prints the status and the fields.
numbers='const [,t]=process.argv; fetch("http://127.0.0.1:3000/api/operator/status",{headers:t?{authorization:"Bearer "+t}:{}}).then(async r=>{const j=await r.json();console.log(r.status,Object.keys(j).sort().join(","),JSON.stringify(j))}).catch(()=>console.log("unreachable"))'
own="$(docker exec mcp-audit-tenant-smoke-a node -e "$numbers" "$(token_of smoke-a)")"
check "an instance answers its own operator token with the listed fields only" bash -c "echo '$own' | grep -q '^200 database_bytes,engagements,files_bytes,invited,last_activity,last_sign_in,users,version '"
check "and with no name, address or title in it" bash -c "! echo '$own' | grep -q -i -e smoke -e '@' -e admin"
check "another tenant's token is refused (401)" bash -c "docker exec mcp-audit-tenant-smoke-a node -e '$numbers' '$(token_of smoke-b)' | grep -q '^401 '"
check "so is no token (401)" bash -c "docker exec mcp-audit-tenant-smoke-a node -e '$numbers' | grep -q '^401 '"
check "the tenants' operator tokens differ" bash -c "[ -n '$(token_of smoke-a)' ] && [ '$(token_of smoke-a)' != '$(token_of smoke-b)' ]"
check "through the tunnel the endpoint does not exist, even with the token (404)" bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: $host_a' -H 'authorization: Bearer $(token_of smoke-a)' http://127.0.0.1:$port/api/operator/status)\" = 404 ]"
# A stopped tenant and a tenant without a backup.
docker stop mcp-audit-tenant-smoke-copy > /dev/null
mv "$work/backups/smoke-b" "$work/backups-of-b-aside"
overview="$(tenant status --all 2>&1)" && overview_rc=0 || overview_rc=$?
check "a stopped tenant and a missing backup end the command with a non-zero exit code (got $overview_rc)" bash -c "[ $overview_rc != 0 ]"
check "the stopped tenant is named" bash -c "echo \"$overview\" | grep -q -- '- smoke-copy: the instance is not up (exited'"
check "the missing backup is named" bash -c "echo \"$overview\" | grep -q -- '- smoke-b: it has no backup\.'"
check "the tenant that is well is not" bash -c "! echo \"$overview\" | grep -q -- '- smoke-a:'"
mv "$work/backups-of-b-aside" "$work/backups/smoke-b"
docker start mcp-audit-tenant-smoke-copy > /dev/null
for _ in $(seq 1 60); do via_proxy "$host_copy" /health | grep -q '"status":"ok"' && break; sleep 1; done
check "a disk that is nearly full is reported too" bash -c "DISK_ALERT_PERCENT=1 '$work/host/bin/tenant' status --all | grep -q -- '- The disk at .* is [0-9]*% full'"
check "and all is well again" "$work/host/bin/tenant" status --all

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
key_b="$(key_of smoke-b)"
echo smoke-b | tenant delete smoke-b > /dev/null
check "its AI key is revoked at the gateway" bash -c "[ '$(ask_as smoke-a "$key_b")' = '401 token_not_found_in_db' ]"
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
