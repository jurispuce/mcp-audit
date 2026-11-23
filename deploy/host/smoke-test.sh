#!/usr/bin/env bash
# Smoke test of the tenant host layout (#92), without Cloudflare: the internal proxy and two tenants
# on test host names, on this machine's Docker.
#   IMAGE=mcp-audit:ci deploy/host/smoke-test.sh
# It checks that each name reaches its own instance, an unknown name is refused, one tenant's
# container cannot reach another's, the visitor's address comes from the tunnel's header and from
# nowhere else, and the containers run confined. Everything it starts is removed at the end.
set -euo pipefail

image="${IMAGE:-mcp-audit:ci}"
src="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
port="${SMOKE_PORT:-18088}"
proxy=mcp-audit-proxy-smoke
tenants=(smoke-a smoke-b)
failed=0

say() { printf '\n== %s\n' "$*"; }
pass() { printf '  ok    %s\n' "$*"; }
fail() { printf '  FAIL  %s\n' "$*"; failed=1; }
check() { # check "<what>" <command...>
	local what="$1"; shift
	if "$@" > /dev/null 2>&1; then pass "$what"; else fail "$what"; fi
}

cleanup() {
	for t in "${tenants[@]}"; do
		[ -d "$work/tenants/$t" ] && (cd "$work/tenants/$t" && docker compose down -v --remove-orphans > /dev/null 2>&1) || true
	done
	[ -d "$work/host" ] && (cd "$work/host" && docker compose --env-file host.env down -v --remove-orphans > /dev/null 2>&1) || true
	rm -rf "$work"
}
trap cleanup EXIT

say "Set-up in $work"
cp -r "$src" "$work/host"
rm -f "$work/host/tenants"/*.caddy
cat > "$work/host/host.env" <<ENV
TENANT_ADDRESS_PATTERN=mcpaudit-{tenant}.smoke.test
TENANTS_DIR=$work/tenants
HOST_PROJECT=mcp-audit-host-smoke
PROXY_CONTAINER=$proxy
EDGE_NETWORK=mcp-audit-edge-smoke
EDGE_SUBNET=172.31.251.0/24
PROXY_PORT=$port
ENV

for t in "${tenants[@]}"; do
	host="$(TENANT_ADDRESS_PATTERN='mcpaudit-{tenant}.smoke.test' "$work/host/bin/tenant-address" "$t")"
	mkdir -p "$work/tenants/$t"
	cp "$src/tenant/docker-compose.yml" "$work/tenants/$t/"
	# Each tenant has its own secrets; the mail server here does not exist, which a start must survive.
	cat > "$work/tenants/$t/.env" <<ENV
TENANT=$t
TENANT_HOST=$host
MCP_AUDIT_IMAGE=${image%:*}
MCP_AUDIT_TAG=${image##*:}
BACKUP_PASSPHRASE=passphrase-of-$t-only
SMTP_HOST=127.0.0.1
SMTP_PORT=2599
SMTP_FROM=audit@smoke.test
ENV
	chmod 600 "$work/tenants/$t/.env"
	cat > "$work/tenants/$t/tenant-profile.yaml" <<YAML
instance_name: Tenant $t
sign_in_method: passkey
first_admin:
  name: Admin of $t
  email: admin@$t.smoke.test
library_sources:
  - nis2
YAML
	chmod 644 "$work/tenants/$t/tenant-profile.yaml"
done

say "Start the proxy and two tenants"
(cd "$work/host" && docker compose --env-file host.env up -d > /dev/null 2>&1)
for t in "${tenants[@]}"; do (cd "$work/tenants/$t" && docker compose up -d > /dev/null 2>&1); done
"$work/host/bin/proxy-sync"

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

say "A suspended tenant has no route"
touch "$work/tenants/smoke-b/suspended"
"$work/host/bin/proxy-sync" > /dev/null
check "its name is refused (404)" bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: $host_b' http://127.0.0.1:$port/health)\" = 404 ]"
check "the other tenant still answers" bash -c "curl -s --max-time 10 -H 'Host: $host_a' http://127.0.0.1:$port/health | grep -q '\"status\":\"ok\"'"

if [ "$failed" = 0 ]; then printf '\nAll checks passed.\n'; else printf '\nSome checks FAILED.\n'; docker logs "$proxy" 2>&1 | tail -20; exit 1; fi
