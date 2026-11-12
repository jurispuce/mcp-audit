# Public endpoint

How to reach mcp-audit over the public internet, and what remote MCP clients need. A private network or VPN (docs/deployment.md, options 1 and 2) stays the safer default: use this only when the team or a client must reach the app from anywhere.

## What the app does for you

- **Sign-in lock-out.** Five wrong passwords for an account within 15 minutes lock that account's sign-in for 15 minutes, even with the right password. The same happens for an email that has no account, so a lock does not reveal whether an account exists. An admin's Reset password lifts the lock.
- **Rate limits per client address.** 20 failed sign-ins in 15 minutes from one address, 30 wrong tokens on `/mcp`, or 10 wrong set-up codes lock that address for 15 minutes. The answer is `429` with `Retry-After`. Locks are stored in the database, so a restart does not lift them.
- **Cookies.** The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` whenever the app is reached over https. The cookie value is never stored; the database keeps its SHA-256.
- **Headers.** `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY` and a `Permissions-Policy` on every response, plus `Strict-Transport-Security` over https.
- **Every route and tool needs a signed-in user or a personal access token.** There is no anonymous access, and `/mcp` is never authless.

## Reverse proxy with TLS

`docker-compose.public.yml` puts [Caddy](https://caddyserver.com/) in front of the app, using `deploy/Caddyfile`. Caddy gets a certificate from Let's Encrypt, redirects http to https and adds HSTS. The app itself is no longer published on the host; only Caddy reaches it.

1. Point a DNS name (for example `audit.example.com`) at the server. Open ports 80 and 443 and nothing else.
2. In `.env`:

   ```
   PUBLIC_HOST=audit.example.com
   ORIGIN=https://audit.example.com
   TEST_SEED_ENABLED=false
   ```

3. Start both:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.public.yml up -d
   ```

The override also sets `ADDRESS_HEADER=x-forwarded-for`, `XFF_DEPTH=1` and `PROTOCOL_HEADER=x-forwarded-proto`. Without them, every request would seem to come from Caddy's address, so one person's failures would lock everyone out. `XFF_DEPTH=1` takes the address Caddy added, so a client cannot dodge the limit by sending its own `X-Forwarded-For`.

With another proxy (nginx, Traefik, a cloud load balancer), keep the same three settings and make the proxy:

- set `X-Forwarded-For` and `X-Forwarded-Proto`;
- allow request bodies up to 100 MB;
- not buffer responses on `/mcp`;
- allow a read timeout of a few minutes for AI actions.

## Checklist before exposing

- [ ] **Hostname and ORIGIN.** `ORIGIN` is the https address; `PUBLIC_HOST` matches it.
- [ ] **Ports.** Only 80 and 443 are open on the server; the app port is not published (`docker compose ps` shows no `3000` on the host).
- [ ] **https works:**
  - `curl -I http://<host>/health` answers `308` to https;
  - `curl -I https://<host>/health` shows `strict-transport-security`.
- [ ] **Secure cookie.** After signing in, the browser's cookie `mcpa_session` is marked `Secure` and `HttpOnly`.
- [ ] **First admin.** It exists before the address is public: finish `/setup`, or set `INITIAL_ADMIN_*` for the first start and remove the password from `.env` afterwards. Until then, anyone who reads the log's set-up code could claim the instance.
- [ ] **No test switches.** `TEST_SEED_ENABLED` is `false`; `POST /api/test/seed` answers `401`.
- [ ] **People and passwords.** Every person has their own account; leavers are deactivated, which ends their sessions and tokens.
- [ ] **Access tokens.** One per person and client, named after the client; unused ones are revoked in Settings, Access tokens. A token is a password: never paste it into a document or chat.
- [ ] **Backups.** `BACKUP_PASSPHRASE` is set and a copy is kept off the server (docs/backup.md).
- [ ] **Updates.** `MCP_AUDIT_TAG` is a version (for example `v0.7.0`) rather than `main`, and upgrades follow docs/deployment.md.
- [ ] **In-app AI.** If it is set up, the gateway is not public (keep LiteLLM on the Compose network). For each engagement, check where its documents go: the model provider behind the gateway sees what a button reads.

## Remote MCP clients

Checked on 2026-11-12 against Anthropic's connector documentation ([building connectors](https://claude.com/docs/connectors/building), [authentication](https://claude.com/docs/connectors/building/authentication)).

| Client                                                                                                   | How it connects to mcp-audit                                                                                 | Works                                               |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Claude Code                                                                                              | `claude mcp add --transport http mcp-audit https://<host>/mcp --header "Authorization: Bearer mcpa_…"`       | Over a private network or the public endpoint.      |
| Claude Desktop, local configuration                                                                      | The `mcp-remote` bridge in `claude_desktop_config.json`, passing the token as a header (docs/mcp-connect.md) | Anywhere; the bridge runs on the person's computer. |
| claude.ai web, Claude Desktop and mobile "custom connector" (Settings, Connectors, Add custom connector) | Anthropic's servers connect to `https://<host>/mcp` and sign in with OAuth                                   | Only on the public endpoint.                        |

What a custom connector needs, and how mcp-audit meets it (#75):

| Requirement                                                                        | mcp-audit                                                                                                                                           |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A public https URL. Anthropic's servers make the calls, from `160.79.104.0/21`.    | The public endpoint above. A VPN or `localhost` address cannot work.                                                                                |
| Streamable HTTP                                                                    | `/mcp`                                                                                                                                              |
| A `401` with `WWW-Authenticate: Bearer resource_metadata="…"` (RFC 9728)           | `/mcp` without a valid token answers so, pointing at `/.well-known/oauth-protected-resource/mcp`.                                                   |
| Authorization server metadata (RFC 8414)                                           | `/.well-known/oauth-authorization-server`                                                                                                           |
| Dynamic Client Registration (RFC 7591)                                             | `/oauth/register`: https, loopback http or app-scheme redirect URIs; public clients or clients with a secret; 20 registrations an hour per address. |
| Authorization code with PKCE S256                                                  | `/oauth/authorize` shows a consent screen to the signed-in person; codes are single use and last 5 minutes.                                         |
| Callback `https://claude.ai/api/mcp/auth_callback`; Claude Code on a loopback port | Registered by the client; loopback URIs match on any port.                                                                                          |
| Resource indicator                                                                 | Tokens are issued for `https://<host>/mcp` only and refused anywhere else.                                                                          |
| Tokens                                                                             | Access tokens last an hour. Refresh tokens rotate on every use; reusing a spent one ends the whole connection.                                      |

Fixed bearer tokens ("static headers", entered by an organization Owner) remain a beta for a limited set of organizations; with OAuth they are not needed. Authless access is never offered (CLAUDE.md rule 7).

To check it from a terminal:

```bash
curl -si https://<host>/mcp -X POST -H 'content-type: application/json' -d '{}' | grep -i www-authenticate
```

```bash
curl -s https://<host>/.well-known/oauth-authorization-server
```
