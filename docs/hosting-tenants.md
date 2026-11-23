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

- Linux with Docker Engine 25 or newer and the Compose plugin, `bash` and `curl`. Nothing else is installed on the server: helper scripts that need more run in the app's own image.
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
    registry/                which tenants exist: names, addresses, versions, states, dates
    bin/                     tenant (create, list, status, suspend, resume, delete, backup,
                             restore, export, nightly), tenant-address, proxy-sync
  backups/<tenant>/          one encrypted backup per night, <tenant>-YYYYMMDDTHHMMSSZ.mcpa
  exports/                   archives for tenants that leave
  tenants/
    .deleted/<tenant>/.env   a deleted tenant's passphrase, kept until its backups are removed
    <tenant>/
      docker-compose.yml     a copy of deploy/host/tenant/docker-compose.yml
      .env                   this tenant's settings and secrets (chmod 600)
      tenant-profile.yaml    what the instance sets itself up from at its first start
      suspended              present while the tenant is suspended: it keeps its data and its
                             address shows a plain "suspended" page
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

## The tenant command

`bin/tenant` does a tenant's whole life the same way every time. It works on the files and containers of this layout only: it never signs in to an instance and never reads its database. Every command takes `--dry-run`, which prints what it would do and changes nothing.

It needs these in `host.env` besides the address pattern: `TENANTS_DIR`, the tenants' email settings (`TENANT_SMTP_HOST`, `TENANT_SMTP_PORT`, `TENANT_SMTP_USER`, `TENANT_SMTP_PASSWORD`, `TENANT_SMTP_FROM`) and, for DNS, the Cloudflare settings. `host.env` is plain `KEY=value` lines as Docker reads them: the value runs to the end of the line, without quotes.

### Create

```bash
bin/tenant create acme --title "Acme Audit" --admin-email ina@acme-audit.example
```

Optional: `--admin-name "Ina Bērziņa"`, `--version v0.4.0` (the image tag; the host's `MCP_AUDIT_TAG` otherwise), `--sources nis2` (library sources by code; the host's `TENANT_SOURCES` otherwise).

It checks the name (1 to 32 lower-case letters, digits or hyphens; not taken; not a reserved name such as `www`, `mail` or `admin`), then:

1. writes `tenants/acme/` with the Compose file, an environment file readable by you only, with a **newly generated backup passphrase**, and the profile (`sign_in_method: passkey`, the first admin, the sources);
2. starts the container and waits until it reports healthy;
3. adds the route in the internal proxy;
4. adds the DNS record;
5. prints the address. The instance itself has emailed the first admin's invitation.

**If a step fails, what was made is removed** and the error names the step. When the instance refuses to start, for example over an unknown library source, its own last lines are shown. The AI key and budget are skipped until #95 exists, and the command says so.

### List and status

```bash
bin/tenant list
```

```bash
bin/tenant status acme
```

`list` shows name, title, address, version, state and creation date. `status` adds the directory, the container's state and health, the data volume and where the address leads.

### Suspend and resume

```bash
bin/tenant suspend acme
```

```bash
bin/tenant resume acme
```

Suspending stops the instance and makes its address answer `503 This instance is suspended.` The data, the DNS record and the people's passkeys stay. Resuming starts it, waits until it is healthy and sends the address to it again; if it does not come back it stays suspended.

### Delete

```bash
bin/tenant delete acme
```

It asks for the tenant's name to be typed again, then:

1. makes a **final export** (see Export, below) and prints its passphrase;
2. removes the DNS record, the container, **the data volume**, the directory and the route;
3. keeps the tenant's **backups for 30 days** (`DELETED_BACKUPS_DAYS`), with the passphrase that opens them stored apart from them; the nightly run removes both after that;
4. writes a line to `registry/deleted.tsv`: name, title, address, created, deleted, and until when the backups are kept. Nothing of the tenant's content.

If the export fails or the DNS record cannot be removed, nothing is deleted. `--without-export` skips the export, for a tenant that was never used. Within the 30 days a backup can still be brought back as a new tenant (`bin/tenant restore acme --from latest --as acme-back`).

### The registry

`host/registry/` holds one small file per tenant (`acme.meta`: name, title, address, version, state, dates, the last backup and restore check), `deleted.tsv`, `events.tsv` (what was done on this host and when: backups, restores, exports, deletions, backups removed) and `nightly.status` (the last nightly run and what failed in it). It holds no tenant content and no secrets; the secrets are in each tenant's own `.env`.

## Backups

Each tenant is backed up with the app's own encrypted backup (`docs/backup.md`), using **that tenant's own passphrase**, generated when the tenant was created. One tenant's backup cannot be opened with another's passphrase. Backups are made and restored inside the tenant's own image; nothing on the server opens one.

Set `BACKUPS_DIR` in `host.env`. Backups are files named `<tenant>-YYYYMMDDTHHMMSSZ.mcpa` in `BACKUPS_DIR/<tenant>/`, readable by you only.

### Every night

```bash
bin/tenant nightly
```

Run it from cron, as the user that runs the other commands (`crontab -e`):

```
15 2 * * * /srv/mcp-audit/host/bin/tenant nightly >> /var/log/mcp-audit-nightly.log 2>&1
```

For every tenant, suspended ones included, it:

1. makes tonight's backup;
2. removes old ones, keeping the newest of each of the last **7 days, 4 weeks and 6 months** (`BACKUP_KEEP_DAILY`, `BACKUP_KEEP_WEEKLY`, `BACKUP_KEEP_MONTHLY`). A backup younger than 48 hours is always kept, so one made by hand or before a restore is still there the next morning;
3. **once a month**, restores the newest backup into a throwaway instance without any network, sees it start and checks its database, then removes it;
4. removes the backups of tenants deleted more than 30 days ago, and the passphrase kept for them;
5. **copies the backups off the server** with `BACKUP_COPY_COMMAND`, for example `rsync -a --delete {dir}/ backup@nas.example.com:/volume1/mcp-audit/` or `rclone sync {dir} remote:mcp-audit-backups`. The files are encrypted, so ordinary storage will do. Without the setting it says that no copy is made.

A failure of any step for any tenant is printed, written to `registry/nightly.status`, and makes the command end with an error, so cron's mail or your monitoring sees it. The other tenants are still done.

**Keep the passphrases somewhere other than the server too.** They are in each tenant's `.env`. A backup copied off the server is useless without the passphrase if the server is lost; copy `tenants/*/.env` to your password manager or another safe place when a tenant is created.

### One backup now, and what there is

```bash
bin/tenant backup acme
```

```bash
bin/tenant backups acme
```

### Restore

```bash
bin/tenant restore acme --from latest
```

`--from` takes `latest`, a file name from `bin/tenant backups acme`, or a path. The instance goes back to that state **as a whole**: what was changed since is gone from it. So the command asks for the tenant's name to be typed again, **backs up the current state first**, stops the instance, restores, starts it and waits until it is healthy. The registry records the restore. If the backup cannot be opened, the data stays as it was and the instance is started again.

To look into a backup without touching the tenant, or to get one item back, restore it **as a new tenant**:

```bash
bin/tenant restore acme --from acme-20261123T021500Z.mcpa --as acme-check
```

The copy is a tenant like any other, at its own address, with secrets of its own. It holds the people of the backup; they sign in there with a code by email, because passkeys belong to the address they were made at. Delete it when done (`bin/tenant delete acme-check --without-export`).

### Check a backup

```bash
bin/tenant check-backup acme
```

What the nightly run does once a month, on demand: the newest backup is restored into a throwaway instance and checked.

### Export, for a tenant that leaves

```bash
bin/tenant export acme
```

It writes `exports/acme-export-<time>.tar`: one encrypted file with the tenant's database and files, and a readme on how to open it in their own mcp-audit. It is encrypted with a **new passphrase, printed once and stored nowhere**, not with the tenant's backup passphrase. Send the archive to the tenant's admin, and give them the passphrase another way (a call, a message in another channel). `--out <directory>` writes it elsewhere.

### What is the same for every tenant, and what is not

- Each tenant's `.env` has its own backup passphrase and its own address. No tenant has another's.
- The email account is yours and the same for all tenants; its password is written into each tenant's `.env`, where only you and that tenant's container can read it. The sender shows the tenant's title (`TENANT_SMTP_FROM={title} <audit@example.com>`).

### By hand

To see what the command does, or to repair something: a tenant is its directory (`docker-compose.yml`, `.env`, `tenant-profile.yaml`), started with `docker compose up -d` in it, plus a route and a DNS record. `bin/proxy-sync` makes the proxy match the tenant directories: a route per tenant, the proxy joined to each tenant's network, a suspended page for a tenant with a file named `suspended`, and routes of tenants that are gone removed. Run it after the proxy container is recreated.

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

It creates the tenants with `bin/tenant` and checks that each name reaches its own instance, an unknown name is refused, one tenant's container cannot reach the other's by name or by address, the visitor's address is taken from the tunnel's header and from nowhere else, the containers run confined, and that suspend, resume and delete do what they say. CI runs it on every push.

On the real tunnel, check by hand after the first tenant:

- its address answers over https and shows the sign-in page, with no Access prompt;
- a Claude custom connector added with `https://<tenant address>/mcp` reaches the consent screen and lists the tools;
- your own address still asks for Access.
