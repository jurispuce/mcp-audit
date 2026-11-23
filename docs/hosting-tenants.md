# Hosting tenants

How one server runs many mcp-audit instances, each for one audit firm (a tenant), each at its own address, none able to reach another. It builds on `docs/deployment.md` (one instance) and `docs/public-endpoint.md` (what the app does for itself on the public internet). The files are in `deploy/host/`.

Tenants are for people who have only an email address: they sign in with a passkey (`docs/deployment.md`, Sign-in method) and the instance sets itself up from a profile (An instance set up from a profile).

## The layout

```
visitor ─ https ─▶ Cloudflare ─ tunnel ─▶ internal proxy ─ http ─▶ tenant A's container ── tenant A's volume
                  (certificate,          (one per server,      ─▶ tenant B's container ── tenant B's volume
                   one DNS record         knows which name
                   per tenant)            is which tenant)
```

- **The server opens no inbound ports.** The Cloudflare Tunnel connects outwards and hands every tenant address to one internal proxy (Caddy, `deploy/host/Caddyfile`).
- **The proxy sends each name to that tenant's container.** A name that is no tenant gets `404 No instance at this address.`, never another tenant's instance.
- **Encryption ends at Cloudflare.** The tunnel, the proxy and the containers speak plain http on private Docker networks. Each instance knows itself by its https address (`ORIGIN`).
- **Each tenant is its own Compose project in its own directory:** one container, one data volume, one network, one environment file. A tenant's network is shared only with the proxy (and later the AI gateway), so one tenant's container cannot open a connection to another's.
- **The visitor's address** comes from Cloudflare's `CF-Connecting-IP` header. The proxy believes that header only from the tunnel and passes the address on as `X-Client-IP`, which is all the app reads. Anything else that reaches the proxy, such as a tenant's own container, is counted under the address it really came from. Lock-outs and rate limits therefore count per person, not per tunnel.

Cloudflare sees tenant traffic unencrypted at its edge. Tell tenants so before they start.

## What the server needs

- Linux with Docker Engine and the Compose plugin, and `curl`. Nothing else is installed on the server: helper scripts that need more run in the app's own image.
- About 150 MB of memory per idle tenant; each container is capped at 768 MB and one CPU unless you change it. Twenty tenants fit a server with 8 GB.
- Disk for each tenant's database and documents, and for backups.
- A Cloudflare zone for the domain, and a Cloudflare Tunnel (the one that already serves your own instance can be used).

## Directory layout

```
/srv/mcp-audit/
  host/                      a copy of deploy/host/
    docker-compose.yml       the proxy, and optionally the tunnel
    Caddyfile
    host.env                 the host's settings (chmod 600)
    tenants/<tenant>.caddy   one route per tenant, written by bin/proxy-sync
    bin/                     tenant-address, proxy-sync
  tenants/
    <tenant>/
      docker-compose.yml     a copy of deploy/host/tenant/docker-compose.yml
      .env                   this tenant's settings and secrets (chmod 600)
      tenant-profile.yaml    what the instance sets itself up from at its first start
      suspended              present while the tenant is suspended: it keeps its data and has no route
```

## Tenant addresses

One pattern for all tenants, set in `host.env`:

```
TENANT_ADDRESS_PATTERN=mcpaudit-{tenant}.example.com
```

- The default shape, `mcpaudit-<tenant>.example.com`, is one level under the domain, which Cloudflare's free certificate covers.
- `<tenant>.mcpaudit.example.com` is two levels under the domain and needs Cloudflare's Advanced Certificate Manager (paid). A dedicated domain works too. Either is a change of the pattern, not of code.
- A tenant's short name is 1 to 32 lower-case letters, digits or hyphens. `bin/tenant-address <tenant>` prints the address.
- **Do not change the address of a tenant that has people in it.** Passkeys are bound to the host name; every passkey of the instance would stop working.

## First set-up

1. Copy `deploy/host/` to `/srv/mcp-audit/host/` and create `/srv/mcp-audit/tenants/`.
2. `cp host.env.example host.env`, fill it in, `chmod 600 host.env`.
3. Start the proxy:

   ```bash
   docker compose --env-file host.env up -d
   ```

4. Point the tunnel at the proxy (next section), then create the DNS token (the section after).
5. Work through the Cloudflare checklist below once, before the first tenant.

### The tunnel and its catch-all rule

A tunnel has a list of rules, checked in order, and a last rule that catches everything else. Keep your own instance's rule first and make the catch-all the proxy:

- **Tunnel managed in the Cloudflare dashboard:** Zero Trust → Networks → Tunnels → your tunnel → Published application routes → **Catch-all rule** → `http://127.0.0.1:8088` when `cloudflared` runs on the server itself, or `http://proxy:80` when it runs from this Compose file.
- **Tunnel with a `config.yml`:**

  ```yaml
  ingress:
    - hostname: mcpaudit.example.com # your own instance, as before
      service: http://localhost:3000
    - service: http://127.0.0.1:8088 # everything else: the tenants' proxy
  ```

Which names reach the tunnel at all is decided by DNS: only names with a record pointing at the tunnel arrive. There is **no wildcard record**, so other names on the domain are untouched, and a name without a tenant that someone points at the tunnel gets the proxy's 404.

To run the tunnel from this Compose file instead of on the server, put its token in `host.env` (`CLOUDFLARE_TUNNEL_TOKEN`) and start with `docker compose --env-file host.env --profile tunnel up -d`. Do not run the same tunnel in both places with different rules.

The proxy is published on `127.0.0.1:8088` only, for a tunnel on the server. Nothing listens on a public address.

### The DNS token

Each tenant gets one DNS record: a proxied CNAME from its address to the tunnel (`<tunnel id>.cfargotunnel.com`). The record is added when the tenant is created and removed when it is deleted.

1. Cloudflare dashboard → My Profile → API Tokens → Create Token → **Edit zone DNS**, with Zone Resources limited to **this one zone**. The token can do nothing but DNS on that zone.
2. Put it in `host.env` as `CLOUDFLARE_API_TOKEN`, with the zone's id (`CLOUDFLARE_ZONE_ID`, on the zone's Overview page) and the tunnel's id (`CLOUDFLARE_TUNNEL_ID`).

```bash
docker run --rm --env-file host.env ghcr.io/jurispuce/mcp-audit:main node scripts/cloudflare-dns.mjs add mcpaudit-acme.example.com
```

```bash
docker run --rm --env-file host.env ghcr.io/jurispuce/mcp-audit:main node scripts/cloudflare-dns.mjs remove mcpaudit-acme.example.com
```

The command marks the records it makes and only ever changes or deletes those. A name that already has any other record, such as your own instance's, is refused and left alone.

## Cloudflare checklist

Tick these off once for the zone. They are settings in Cloudflare, not in the app.

**Access**

- [ ] Tenant addresses are **not** behind Cloudflare Access. The app's own sign-in is the gate there, so people without a Google account get in and the Claude and ChatGPT connectors reach `/mcp`. If an Access application covers the whole domain (`*.example.com`), give it no claim on the tenant names: an Access application for `mcpaudit-*.example.com` with a **Bypass** policy for Everyone takes them out.
- [ ] Your own instance may stay behind Access. For connectors to reach it, these paths must be exempt there (an Access application for each path with a Bypass policy): `/mcp`, `/oauth/token`, `/oauth/register`, `/oauth/revoke` and `/.well-known/*`. The app checks a token on every one of them. `/oauth/authorize` stays behind Access: it is a page a person opens.
- [ ] People without a Google account cannot pass an Access policy that asks for Google. Either add the **One-time PIN** login method to that Access application, or do not put them on your own instance: that is what tenants are for.

**Bots**

- [ ] The assistants' servers must not be challenged on `/mcp`, `/oauth/*` and `/.well-known/*` of tenant addresses.
  - **Free plan:** Bot Fight Mode cannot be skipped by any rule; it is on or off for the whole zone. Leave **Bot Fight Mode off** (Security → Bots). The app's own lock-outs and rate limits stay in place.
  - **Pro plan and up:** with Super Bot Fight Mode, add a WAF custom rule above the others with the action **Skip** (Super Bot Fight Mode rules), for these requests and only these:

    ```
    (starts_with(http.host, "mcpaudit-") and (starts_with(http.request.uri.path, "/mcp") or starts_with(http.request.uri.path, "/oauth/") or starts_with(http.request.uri.path, "/.well-known/")))
    ```

- [ ] If "Block AI bots" (Security → Bots) is on, check that the connectors still work; it is meant for crawlers but is applied by Cloudflare's own list.

**Pages are passed on as they are**

- [ ] A **Configuration Rule** for `starts_with(http.host, "mcpaudit-")` that turns off Rocket Loader and Email Obfuscation (the app's pages must reach the browser as the app sent them: Rocket Loader changes how scripts load, and the email addresses on a page are data).
- [ ] Auto Minify, if your zone still has the setting, is off for the same names.
- [ ] A **Cache Rule** for the same names with **Bypass cache**. The app sends `no-store` where it matters, but nothing of a tenant belongs in a shared cache.

**Limits to know**

- Cloudflare gives up on a request that has not started answering within **100 seconds**. No request of the app waits that long: AI actions run as background jobs that the screen polls, calls to the AI gateway that a person waits for give up after 20 or 60 seconds, every MCP call is its own short request answered as JSON, reports are built in memory, and the text of an upload is read in seconds (a 3,000-page PDF of 35 MB takes about 11 seconds).
- An upload may be at most **100 MB** on the free plan, the same as the app's own limit for one request (one file: 50 MB).

## A tenant by hand

`#94` adds one command for this. Until then, and to understand what it does:

```bash
cd /srv/mcp-audit && host/bin/tenant-address acme
```

1. Create `tenants/acme/` with a copy of `host/tenant/docker-compose.yml`.
2. Write `tenants/acme/.env` from `host/tenant/tenant.env.example`: `TENANT`, `TENANT_HOST` (the address printed above), a backup passphrase of its own, and the email settings. `chmod 600` it. No secret in it is used for another tenant.
3. Write `tenants/acme/tenant-profile.yaml` (`docs/deployment.md`, An instance set up from a profile) with `sign_in_method: passkey` and the first admin.
4. Start it and give it a route:

   ```bash
   cd /srv/mcp-audit/tenants/acme && docker compose up -d
   ```

   ```bash
   /srv/mcp-audit/host/bin/proxy-sync
   ```

5. Add its DNS record (The DNS token, above). The first admin's invitation was sent when the instance started.

`bin/proxy-sync` makes the proxy match the tenant directories: a route per tenant, the proxy joined to each tenant's network, routes of tenants that are gone removed. Run it after a tenant is added or removed, and after the proxy container is recreated. A tenant with a file named `suspended` in its directory keeps its data and gets no route.

## What confines a tenant

Set in `deploy/host/tenant/docker-compose.yml`, the same for every tenant:

- its own network, on which only the proxy (and the AI gateway) also sit; nothing published on the server;
- its own data volume and its own `.env`, with its own `ORIGIN`, backup passphrase and (later) gateway key;
- memory and CPU limits, a limit on processes, restart on failure, logs rotated at 5 × 10 MB;
- a read-only filesystem apart from `/data` and `/tmp`, no root, no extra kernel rights.

Each tenant has its own database and files, so nothing of one tenant, internal requirements included, can appear in another.

## Checking the layout

`deploy/host/smoke-test.sh` starts the proxy and two tenants on test names on the machine's own Docker, without Cloudflare, and removes them again:

```bash
IMAGE=ghcr.io/jurispuce/mcp-audit:main deploy/host/smoke-test.sh
```

It checks that each name reaches its own instance, an unknown name is refused, one tenant's container cannot reach the other's by name or by address, the visitor's address is taken from the tunnel's header and from nowhere else, the containers run confined, and a suspended tenant has no route. CI runs it on every push.

On the real tunnel, check by hand after the first tenant:

- its address answers over https and shows the sign-in page, with no Access prompt;
- a Claude custom connector added with `https://<tenant address>/mcp` reaches the consent screen and lists the tools;
- your own address still asks for Access.
