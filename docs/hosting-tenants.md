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
- **Each tenant is its own Compose project in its own directory:** one container, one data volume, one network, one environment file. A tenant's network is shared only with the proxy and the AI gateway, so one tenant's container cannot open a connection to another's.
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
    docker-compose.yml       the proxy, and optionally the tunnel and the AI gateway
    Caddyfile
    litellm.config.yaml      the AI gateway's models, when it runs from here
    host.env                 the host's settings (chmod 600)
    tenants/<tenant>.caddy   one route per tenant, written by bin/proxy-sync
    registry/                which tenants exist: names, addresses, versions, states, dates
    bin/                     tenant (create, list, status, suspend, resume, delete, ai, upgrade,
                             backup, restore, export, nightly), tenant-address, proxy-sync
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
      upgrading              present while the tenant is upgraded: its address shows a plain
                             "being upgraded" page
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

Optional: `--admin-name "Ina Bērziņa"`, `--version v0.4.0` (the image tag; the host's `MCP_AUDIT_TAG` otherwise), `--sources nis2` (library sources by code; the host's `TENANT_SOURCES` otherwise), `--ai-budget 50` (US dollars per period; the host's `TENANT_AI_BUDGET` otherwise, see AI for tenants below).

It checks the name (1 to 32 lower-case letters, digits or hyphens; not taken; not a reserved name such as `www`, `mail` or `admin`), then:

1. makes the tenant's **own key at the AI gateway**, with its budget (skipped, and said so, when `host.env` names no gateway);
2. writes `tenants/acme/` with the Compose file, an environment file readable by you only, with a **newly generated backup passphrase** and the AI key, and the profile (`sign_in_method: passkey`, the first admin, the sources, the gateway's address and the model);
3. makes the container, lets the proxy and the AI gateway join its network, starts it and waits until it reports healthy;
4. adds the route in the internal proxy;
5. adds the DNS record;
6. prints the address. The instance itself has emailed the first admin's invitation, and has checked its AI model through the gateway, so the AI buttons work from the first sign-in.

**If a step fails, what was made is removed**, the AI key included, and the error names the step. When the instance refuses to start, for example over an unknown library source, its own last lines are shown.

### List and status

```bash
bin/tenant list
```

```bash
bin/tenant status acme
```

`list` shows name, title, address, version, state and creation date, and marks the tenants that are behind the version the host is on (see Upgrades). `status` adds the directory, the container's state and health, the data volume, where the address leads, and what the tenant has used of its AI budget (`AI: $3.10 of $20.00 used, $16.90 left, resets 2026-12-01`).

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
2. **revokes the tenant's key at the AI gateway**, then removes the DNS record, the container, **the data volume**, the directory and the route;
3. keeps the tenant's **backups for 30 days** (`DELETED_BACKUPS_DAYS`), with the passphrase that opens them stored apart from them; the nightly run removes both after that;
4. writes a line to `registry/deleted.tsv`: name, title, address, created, deleted, and until when the backups are kept. Nothing of the tenant's content.

If the export fails, or the key cannot be revoked, or the DNS record cannot be removed, nothing is deleted. `--without-export` skips the export, for a tenant that was never used. Within the 30 days a backup can still be brought back as a new tenant (`bin/tenant restore acme --from latest --as acme-back`).

### The registry

`host/registry/` holds one small file per tenant (`acme.meta`: name, title, address, version, state, dates, the last backup and restore check), `deleted.tsv`, `events.tsv` (what was done on this host and when: backups, restores, exports, deletions, backups removed) and `nightly.status` (the last nightly run and what failed in it). It holds no tenant content and no secrets; the secrets are in each tenant's own `.env`.

## AI for tenants

Tenants use one gateway of yours for the in-app AI buttons: LiteLLM with key management. Each tenant has **its own key with its own budget**, so one tenant cannot spend another's, and you see who used what. The key is made, changed and revoked with the tenant, by the tenant command.

### The gateway

To run it on this server, from the host's Compose file:

1. Copy `litellm.config.example.yaml` to `litellm.config.yaml` and name the models. It keeps keys, budgets and spend in its own database, and is set **not to store what is asked or answered**.
2. In `host.env` set `AI_GATEWAY_URL=http://mcp-audit-gateway:4000/v1`, `AI_GATEWAY_NETWORK=mcp-audit-gateway`, a master key (`AI_GATEWAY_MASTER_KEY`, starting with `sk-`), `AI_GATEWAY_DB_PASSWORD`, `AI_GATEWAY_SALT_KEY` (set once, never change), the provider's key (`ANTHROPIC_API_KEY`) and `TENANT_AI_DEFAULT_MODEL` (a `model_name` of the config).
3. Start it, and let it join the tenants that already exist:

```bash
docker compose --env-file host.env --profile gateway up -d
```

```bash
bin/proxy-sync
```

The gateway is **not published** on the server and not reachable from the internet. It joins each tenant's network, as the proxy does; a tenant's container is never on the gateway's own network, where its database is. A tenant reaches the gateway and nothing through it: the smoke test checks that one tenant still cannot reach another. The provider's key and the master key are in `host.env` only; no tenant holds either.

A gateway that runs elsewhere works the same: set `AI_GATEWAY_URL` to its address (and `AI_GATEWAY_ADMIN_URL` if its key management is at another one) and leave `AI_GATEWAY_NETWORK` empty. With `AI_GATEWAY_URL` empty, tenants are created without AI.

The key management was tried against LiteLLM 1.110.2. The gateway's own Compose service has not been started in a test; check it once on the server with `docker compose --env-file host.env --profile gateway ps`.

### A key and a budget per tenant

`tenant create` makes the key with:

- **a budget** in US dollars: `--ai-budget`, or `TENANT_AI_BUDGET` (20 unless set);
- **the period** after which the spend starts again: `TENANT_AI_BUDGET_PERIOD` (`30d` unless set). LiteLLM 1.110 starts a `30d` budget again at midnight UTC on the 1st of each month; the instance and `tenant status` show the date the gateway gives;
- **the models** it may use: `TENANT_AI_MODELS` (comma-separated; all of the gateway's when empty).

The key is written into the tenant's `.env` (`LITELLM_API_KEY`, with `LITELLM_BASE_URL`), readable by you and that tenant's container only. It is not in the profile, not in the registry and never on a command line. `tenant delete` revokes it; a copy made with `restore --as` gets a key of its own.

A tenant created while `host.env` named no gateway has no key; the command does not add one later.

### Change the budget, switch AI off and on

```bash
bin/tenant ai acme --budget 50
```

```bash
bin/tenant ai acme --off
```

```bash
bin/tenant ai acme --on
```

A new budget holds at once and keeps what was already spent in the period. Switching off blocks the key at the gateway; nothing in the instance changes, and `--on` brings it back. `tenant status acme` shows the spend against the budget, and says `USED UP` or `SWITCHED OFF`. The gateway writes spend down within about a minute, so the figure can be that far behind.

### What the tenant sees

- An admin sees on **Settings, AI** how much of the budget is used, how much is left and when it starts again.
- When the budget is used up, an AI button answers: "The AI budget of this instance is used up for now. An admin can see on Settings, AI when it resets; the person who runs the instance can raise it." When the key is off: "AI is switched off for this instance by the person who runs it. Everything else works as usual."
- A refused action writes nothing. If the budget runs out in the middle of an action, what the action had proposed until then stays as proposals for a person to review, each complete; nothing is accepted by itself.
- Everything else in the instance works as before. A person's own Claude or ChatGPT through MCP does not go through the gateway and is not affected by the budget.
- A tenant's admin can put **a gateway of their own** on Settings, AI, for example a local model. Your budget then no longer applies to them, and the key you gave the instance is not sent to their gateway.

### Which data passes through the gateway and the model provider

For the onboarding pack (#100). When a person presses an AI button on an engagement:

- **Sent to the model, through the gateway:** the instructions of the action, and what the action reads of that engagement while it works: for example the text of the auditee's documents, requirements, notes, evidence and findings. The model's answers come back the same way. This goes to the provider of the model you configured (in the example config, Anthropic), under your agreement with that provider; state its terms on retention and on training in the onboarding pack.
- **Kept by the gateway:** for each request, which tenant's key, which model, when, how many tokens and what it cost. **Not** what was asked or answered (`store_prompts_in_spend_logs: false` and `turn_off_message_logging: true` in `litellm.config.yaml`; on LiteLLM 1.110.2 the stored rows held no text of either).
- **Web search**, where it is on for the tenant (`TENANT_AI_WEB_SEARCH`), sends the model's search questions to the provider's search.
- **Nothing is sent** for an engagement where AI is switched off, and nothing before someone presses an AI button.
- **Not through your gateway at all:** a person's own Claude or ChatGPT connected through MCP (that is between their AI provider and the instance), and a tenant that set a gateway of its own.

## Upgrades

Each tenant runs **the version named in its own `.env`** (`MCP_AUDIT_TAG`) and stays on it until you upgrade it: restarting, resuming or restoring a tenant never changes its version. `MCP_AUDIT_TAG` in `host.env` is the version the host is on: what a new tenant gets, and where an upgrade goes when you name no version. Use released versions such as `v0.4.0`; `main` and `latest` are names that move, and the command says so when it meets one.

```bash
bin/tenant list
```

shows each tenant's version, with `(behind)` where it is older than the host's, and how many are behind.

### One tenant

```bash
bin/tenant upgrade acme --to v0.4.0
```

1. fetches the image, and stops with nothing changed if it cannot;
2. puts a plain **"being upgraded" page** at the tenant's address (`503`, with a hint to come back in half a minute), so nobody works in the instance meanwhile;
3. makes a **backup** (the same kind as every night, in `backups/acme/`);
4. stops the container, starts the new version and waits until it reports healthy. The new version applies its database changes as it starts;
5. asks the instance which version it is, and expects the one named;
6. sends the address to the instance again.

**If the new version does not start, is not healthy, or reports another version**, the command says what failed, shows the instance's last lines, and puts the tenant back: the old version, and **the backup made in step 3**. That backup is restored every time, not only when something looks wrong: **database changes only go forwards**, so data that a newer version has touched cannot be given back to the older one. Nothing is lost by it, because the page of step 2 was up before the backup was made. The tenant then answers on the old version as if the upgrade had not been tried.

If the tenant cannot be put back either, the command says so, leaves the "being upgraded" page up and names the backup to restore (`bin/tenant restore acme --from <backup>`).

### All tenants

Set the new version in `host.env` (`MCP_AUDIT_TAG=v0.4.0`), then:

```bash
bin/tenant upgrade --all
```

It goes **one tenant at a time**, each as above:

1. **your own instance first**, when it is a tenant on this host: name it with `OPERATOR_TENANT` in `host.env`. If your own instance runs elsewhere, upgrade it first as `docs/deployment.md` describes and see that it works; the command reminds you;
2. then the others, by name.

It **stops at the first failure**. That tenant is put back, the ones before it stay on the new version, and the ones after it are not touched: no backup, no restart, the version they had. A suspended tenant is left as it is; upgrade it after it is resumed. A tenant already on the version is skipped. `--dry-run` prints the order and the steps.

A good order for a release: your own instance, then one tenant you know well (`bin/tenant upgrade <name>`), then `--all`.

### A restart is a page too

While an instance is not answering for any other reason (the server restarted, a restore is running), its address says "This instance is restarting. Try again in a moment." with `503`, not a bare error.

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

- Each tenant's `.env` has its own backup passphrase, its own address and its own AI key. No tenant has another's.
- The email account is yours and the same for all tenants; its password is written into each tenant's `.env`, where only you and that tenant's container can read it. The sender shows the tenant's title (`TENANT_SMTP_FROM={title} <audit@example.com>`).

### By hand

To see what the command does, or to repair something: a tenant is its directory (`docker-compose.yml`, `.env`, `tenant-profile.yaml`), started with `docker compose up -d` in it, plus a route and a DNS record. `bin/proxy-sync` makes the proxy match the tenant directories: a route per tenant, the proxy joined to each tenant's network, a suspended page for a tenant with a file named `suspended`, and routes of tenants that are gone removed. Run it after the proxy container is recreated.

## What confines a tenant

Set in `deploy/host/tenant/docker-compose.yml`, the same for every tenant:

- its own network, on which only the proxy and the AI gateway also sit; nothing published on the server;
- its own data volume and its own `.env`, with its own `ORIGIN`, backup passphrase and AI gateway key;
- memory and CPU limits, a limit on processes, restart on failure, logs rotated at 5 × 10 MB;
- a read-only filesystem apart from `/data` and `/tmp`, no root, no extra kernel rights.

Each tenant has its own database and files, so nothing of one tenant, internal requirements included, can appear in another.

## Checking the layout

`deploy/host/smoke-test.sh` starts the proxy and two tenants on test names on the machine's own Docker, without Cloudflare, and removes them again:

```bash
IMAGE=ghcr.io/jurispuce/mcp-audit:main deploy/host/smoke-test.sh
```

It creates the tenants with `bin/tenant` and checks that each name reaches its own instance, an unknown name is refused, one tenant's container cannot reach the other's by name or by address, the visitor's address is taken from the tunnel's header and from nowhere else, the containers run confined, each tenant has its own key and budget at an AI gateway (a scripted stand-in for LiteLLM: spend on one tenant does not show on the other, a key that is off or over budget is refused, a deleted tenant's key is revoked), that an upgrade backs up first and shows the "being upgraded" page, that a version which damages the data and fails to start is rolled back with the data as before, that `--all` stops at the first failure, and that suspend, resume and delete do what they say. CI runs it on every push.

On the real tunnel, check by hand after the first tenant:

- its address answers over https and shows the sign-in page, with no Access prompt;
- a Claude custom connector added with `https://<tenant address>/mcp` reaches the consent screen and lists the tools;
- your own address still asks for Access.
