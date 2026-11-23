# Deployment

mcp-audit is one container with one data volume. The same image runs on a laptop, a server on your network, or a VPS. On a server you only need two files: `docker-compose.yml` and `.env`.

> **Private network first.** Keep the app on your machine, your LAN, or a VPN such as Tailscale or WireGuard. To reach it over the public internet, follow `docs/public-endpoint.md`: a TLS proxy (Caddy), the proxy header settings, and a checklist.

## What you need

- Docker with the Compose plugin (`docker compose version` prints 2.24 or later).
- The image `ghcr.io/jurispuce/mcp-audit`. CI publishes `:main` from the default branch, and `:vX.Y.Z` and `:latest` from version tags. It runs on amd64 and arm64.
- If the repository or package is private: a GitHub personal access token with `read:packages`, and once per machine:

```bash
docker login ghcr.io -u <github-user>
```

## 1. Laptop

```bash
mkdir mcp-audit && cd mcp-audit
```

Put `docker-compose.yml` and `.env.example` from this repository in the folder, then:

```bash
cp .env.example .env
docker compose pull
docker compose up -d
```

Open http://127.0.0.1:3000. On first start the app asks for a set-up code; it is printed in the log:

```bash
docker compose logs app | grep "set-up code"
```

Create the first admin, then add your colleagues in Settings, Users. Each gets a one-time password to change at first sign-in.

To skip the set-up page, put `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` and `INITIAL_ADMIN_NAME` in `.env` before the first start.

## 2. Server on your network (LAN or VPN)

Same steps as the laptop, plus one setting in `.env` to publish the port on an address colleagues can reach:

```bash
BIND_ADDRESS=192.168.1.20      # the server's LAN address
# or, with Tailscale on the server:
BIND_ADDRESS=100.101.102.103   # the server's Tailscale address (tailscale ip -4)
```

```bash
docker compose up -d
```

Colleagues open `http://<that address>:3000`, also from their phones while on the same network or VPN. The app accepts any host name or IP; leave `ORIGIN` empty unless you give it one fixed address.

With Tailscale, only devices in your tailnet can reach the app, wherever they are. That is the recommended way to use it during an interview away from the office.

## 3. VPS

1. Create a small VPS (1 vCPU and 1 GB RAM is plenty) with full-disk encryption if the provider offers it.
2. Install Docker and the Compose plugin, and Tailscale.
3. Allow only SSH from outside; the app port must not be public:

```bash
sudo ufw default deny incoming
sudo ufw allow OpenSSH
sudo ufw enable
```

4. Follow section 2 with `BIND_ADDRESS` set to the VPS's Tailscale address. Docker publishes ports past ufw, so binding to the Tailscale address (never `0.0.0.0`) is what keeps the app private.
5. Set `BACKUP_PASSPHRASE` and the nightly backup from `docs/backup.md`, and copy backups off the VPS.

If you cannot use a VPN, keep `BIND_ADDRESS=127.0.0.1` and reach the app through an SSH tunnel:

```bash
ssh -L 3000:127.0.0.1:3000 you@your-vps
```

To serve it publicly over https instead, see `docs/public-endpoint.md`.

## Upgrade

Migrations run automatically when the new version starts. Back up first, because migrations only go forward.

```bash
docker compose exec -T app node scripts/backup.mjs --out - > backups/before-upgrade-$(date +%F).mcpa
docker compose pull
docker compose up -d
```

Check the new version:

```bash
curl -s http://127.0.0.1:3000/health
```

`MCP_AUDIT_TAG` in `.env` chooses the image tag: `main` (the default: newest build of the default branch), `latest` (newest release, once a version tag exists) or a version such as `v0.2.0`. Pinning a version is safest for a team.

## Roll back

A newer version may have changed the database, so rolling back means going back to the previous image and the backup taken before the upgrade.

1. In `.env`, set `MCP_AUDIT_TAG` to the previous version, for example `v0.1.0`.
2. Restore the backup taken before the upgrade (`docs/backup.md`):

```bash
docker compose stop app
docker compose run --rm -v "$PWD/backups:/backups" app node scripts/restore.mjs --in /backups/before-upgrade-2026-11-12.mcpa --force
docker compose up -d
```

Work done since the upgrade is in the replaced data, which restore keeps in `pre-restore-<time>/` inside the volume.

## Settings

All settings are environment variables in `.env`. Only the Compose ones (`BIND_ADDRESS`, `HOST_PORT`, `MCP_AUDIT_TAG`) are read by Docker; the rest reach the app.

| Variable                                                                           | Default           | Purpose                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BIND_ADDRESS`                                                                     | `127.0.0.1`       | Host address the port is published on. Use a LAN or VPN address to share.                                                                                     |
| `HOST_PORT`                                                                        | `3000`            | Port on the host.                                                                                                                                             |
| `MCP_AUDIT_TAG`                                                                    | `main`            | Image tag to run.                                                                                                                                             |
| `ORIGIN`                                                                           | empty             | Fixed public URL, for example `https://audit.example.lan`. Empty accepts any host; the protocol then comes from `X-Forwarded-Proto` and is http without it.   |
| `PROTOCOL_HEADER`, `HOST_HEADER`, `ADDRESS_HEADER`, `XFF_DEPTH`                    | empty             | Headers to trust behind a reverse proxy; `docker-compose.public.yml` sets them (docs/public-endpoint.md).                                                     |
| `BODY_SIZE_LIMIT`                                                                  | `100M`            | Largest request body, for uploading several documents at once. One file may be at most 50 MB.                                                                 |
| `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_NAME`              | empty             | Create the first admin at first start instead of using `/setup`. With `SIGN_IN_METHOD=passkey`: name and email only, and the first admin is invited by email. |
| `SIGN_IN_METHOD`                                                                   | `password`        | `password` or `passkey`. With `passkey` nobody has a password; see "Sign-in method" below.                                                                    |
| `BACKUP_PASSPHRASE`                                                                | empty             | Required for backup and restore. At least 12 characters.                                                                                                      |
| `LITELLM_BASE_URL`, `LITELLM_API_KEY`                                              | empty             | Default AI gateway address and key for the in-app AI actions. Settings, AI overrides them. See "In-app AI" below.                                             |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | empty             | Mail server for invitations, sign-in codes and security notices. `SMTP_HOST` and `SMTP_FROM` switch email on. See "Email" below.                              |
| `INSTANCE_NAME`                                                                    | `mcp-audit`       | What this instance is called in the shell, in page titles, in emails and in the downloaded guide, so a person with two instances can tell them apart.         |
| `TENANT_PROFILE`                                                                   | empty             | Path of a profile file a new instance sets itself up from at its first start. See "An instance set up from a profile" below.                                  |
| `TZ`                                                                               | `Europe/Riga`     | Time zone for logs and report dates.                                                                                                                          |
| `TEST_SEED_ENABLED`                                                                | `false`           | Test environments only: seed data and a password-free test login. Never in production.                                                                        |
| `DATA_DIR`                                                                         | `/data`           | Where the database and files live inside the container. Leave as is.                                                                                          |
| `HOST`, `PORT`                                                                     | `0.0.0.0`, `3000` | Address and port inside the container. Leave as is.                                                                                                           |

## In-app AI (optional)

The AI buttons (Derive roles, Extract requirements, Extract risks, Draft plan, Process event materials, Propose findings, and the library's Extract requirements and Propose mapping) reach models through a [LiteLLM](https://docs.litellm.ai/) gateway, so Claude, other providers and local models all work. Without a gateway the buttons stay disabled and say why; Claude Desktop or Claude Code through MCP works either way.

1. Run a gateway. To run it next to the app, copy `litellm.config.example.yaml` to `litellm.config.yaml`, list your models in it, put the provider keys it names in `.env` (for example `ANTHROPIC_API_KEY`), and uncomment the `litellm` service in `docker-compose.yml`. Then `docker compose up -d`.
2. Sign in as an admin and open **Settings, AI**:
   - **Gateway**: the address, for example `http://litellm:4000` for the Compose service, and the gateway key (`LITELLM_MASTER_KEY`). The key is write-only: it is never shown again. `LITELLM_BASE_URL` and `LITELLM_API_KEY` in `.env` work as defaults.
   - **Models**: add each model by the name the gateway uses, or load the list from the gateway. Adding a model runs the tool-calling check: every AI action is an agent loop that calls tools, so a model that fails the check is listed with the reason and cannot be used.
   - **Model per action**: a default, and optionally a different model per button.
3. Per engagement, on Home, **Edit details**: "AI may work on this engagement" switches AI off entirely; "Model for in-app AI" limits the engagement to one checked model, for example a local one for confidential material.

What a button does: the server sends the matching skill's instructions and a fixed set of the app's MCP tools to the model, and runs each tool call it returns through the same domain rules as an MCP client. Everything is written as "<model> on behalf of <you>" and stored as proposed; review it on the screen's proposal bar or on the engagement's Proposals list. Progress shows under the button, which can be cancelled; a failure says what went wrong. The documents a button reads are sent to the model provider behind the gateway, so choose the model per engagement accordingly.

## Email (optional)

The instance can send email: invitations, sign-in codes and security notices use it. Without these settings the app works as before, and whatever needs email says that it is off.

1. Get an SMTP account from a mail service, with a sender address on a domain you control.
2. In `.env`:

   ```
   SMTP_HOST=smtp.example.com
   SMTP_PORT=587
   SMTP_USER=your-smtp-user
   SMTP_PASSWORD=your-smtp-password
   SMTP_FROM=mcp-audit <audit@example.com>
   INSTANCE_NAME=Our audit team
   ```

   - Port 587 upgrades the connection with STARTTLS; a user name and password are never sent without encryption. For port 465 (encrypted from the start) set `SMTP_PORT=465`.
   - `SMTP_FROM` is the sender people see. Use an address the mail service lets you send from.
   - Set `ORIGIN` too: links in emails are built from it.

3. Restart (`docker compose up -d`), then in the app: **Settings → Email → Send test email**. It goes to your own address and says what the mail server answered if it fails. The password is read from the environment only; it is never stored in the database or shown.

For mail to arrive in the inbox and not in spam, the sender's domain needs two DNS records, which the mail service gives you: **SPF** (which servers may send for the domain) and **DKIM** (a signature the service adds). A **DMARC** record on top tells receivers what to do with mail that fails both.

The instance sends at most 10 emails an hour to one address and 300 an hour in total. Settings → Email lists the most recent sends: to whom and whether the mail server took them, never the text.

## Sign-in method

`SIGN_IN_METHOD` decides how people sign in on the instance. An unknown value stops the start.

|              | `password` (the default)                                                        | `passkey`                                                               |
| ------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Sign in with | email and password; a passkey or an emailed code as further ways in             | a passkey; an emailed code where there is none on the device            |
| New people   | **Invite user** by email, or **Add user** with a one-time password              | **Invite user** by email only                                           |
| First admin  | set-up code from the log, or `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` | invited by email at start (`INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_NAME`) |
| Lost access  | an admin resets the password                                                    | a code by email; an admin can end sessions and remove passkeys          |
| Needs        | nothing more                                                                    | email settings, and `ORIGIN` as an https address with a host name       |

**Choose `password`** for a private instance on your own network, above all one without email or without https. **Choose `passkey`** for an instance other people reach over the internet: there is no password to guess, reuse or phish, and nobody has to pass one on.

### An instance with `passkey`

```
SIGN_IN_METHOD=passkey
ORIGIN=https://audit.example.com
INITIAL_ADMIN_EMAIL=first.admin@example.com
INITIAL_ADMIN_NAME=First Admin
SMTP_HOST=…            # and the other email settings, see Email
```

- At the first start the first admin gets an email with a link, creates a passkey and is in. There is no set-up page and no code in the log, so nobody who reaches the address first can claim the instance. Until the first admin has joined, **each restart sends a new link** (the earlier one stops working), which is also how to replace an expired one.
- No password can be set, changed or reset anywhere: the sign-in page, Settings → Account and Settings → Users show none.
- The instance **refuses to start** when email settings are missing, when `ORIGIN` is not an address browsers allow passkeys on, or when a new instance has no `INITIAL_ADMIN_EMAIL`. The log names the setting.

### Moving an instance from `password` to `passkey`

1. Set up email and check it with **Settings → Email → Send test email**. Make sure every person's email address is right: it becomes their way in.
2. Set `SIGN_IN_METHOD=passkey` (and `ORIGIN`), and restart.
3. At that start the app connects to the mail server first. If it does not answer, the app does not start and **nothing is changed**. If it does, **all stored passwords are deleted**; the log says how many.
4. People who are signed in stay signed in. At their next sign-in each person asks for a code by email and is offered to add a passkey.

Going back to `password` is possible, but the passwords are gone: people sign in with a passkey or a code by email and set a new password on Settings → Account, or an admin resets it. Keep email working until everyone has one.

## An instance set up from a profile

A new instance normally starts empty: someone creates the first admin, loads the library and connects AI by hand. With `TENANT_PROFILE` naming a file, the instance does this itself at its **first start**, so it is ready before its first person arrives.

```yaml
# tenant-profile.yaml (JSON works too)
instance_name: Baltic Audit
sign_in_method: passkey # optional: password or passkey
first_admin:
  name: Ina Admin
  email: ina@baltic-audit.example
library_sources: # optional: sources that ship with the app, by code
  - nis2
ai: # optional
  base_url: https://llm.example.com
  api_key: sk-…
  default_model: claude-sonnet
  web_search: false
```

Mount the file into the container and name it, next to the email settings and `ORIGIN`:

```yaml
# docker-compose.yml, under the app service
volumes:
  - ./tenant-profile.yaml:/config/tenant-profile.yaml:ro
environment:
  TENANT_PROFILE: /config/tenant-profile.yaml
```

At the first start the instance:

- loads the listed library sources;
- saves the AI gateway and its key, switches web search for research on or off, runs the tool-calling check on the default model and, when it passes, lets that model run the AI actions;
- creates the first admin and sends their invitation by email. There is no set-up page and no code in the log, whatever the sign-in method;
- takes its name and, where the profile gives one, its sign-in method from the profile.

What to know:

- **It is applied once**, in one step: everything, or on a problem nothing. What was applied, and when, is kept in the database and written to the log; the key is in neither. A restart applies nothing again, and **a later edit of the file is not read**, so it never overwrites what the instance's admin has changed since.
- **A profile with an error stops the start.** The log names every field that is wrong (`first_admin.email: is missing`, `library_sources.1: "iso27001" is not a source that ships with the app`), and nothing is created.
- It needs the email settings and `ORIGIN`: the first admin's link goes out by email and is built from the address. Until the first admin has joined, each restart sends a new link.
- If the gateway does not answer at the first start, the instance starts all the same, says so in the log, and tries the model's check again at each start until it has passed once. An admin can also run it on Settings → AI.
- `INSTANCE_NAME` and `SIGN_IN_METHOD` in the environment win over the profile where they are set. To rename an instance later, set `INSTANCE_NAME`.
- A profile named for an instance that already has people is not applied; the log says so.

## Passkeys

People can add a passkey on **Settings → Account** and then sign in with the device's fingerprint, face or PIN: **Sign in with a passkey** on the sign-in page, with no email or password typed. On an instance with passwords they keep working next to it, and someone who joined with a passkey can set a password on Settings → Account without giving a current one.

- Browsers give passkeys only to an **https address with a host name** (or `localhost` for development). On a plain http address or an IP address the app does not offer them and says so.
- A passkey is bound to the instance's host name, taken from `ORIGIN`. **Changing the host name makes every passkey of the instance unusable**; people then sign in with their password and add a new passkey.
- Only the public half of a passkey is stored. Adding and removing one shows in the person's history by name, without key material.
- Wrong or unknown passkeys count towards the same lock-outs as wrong passwords (docs/public-endpoint.md). Deactivating a person makes their passkeys unusable until they are reactivated.

## Invitations by email

Where email is set up (above), an admin adds people on **Settings → Users → Invite user**: name, email and role. Nobody passes a password on.

- The person gets an email that names the instance and who invited them, with a link that works **once, for 7 days**. Opening the link uses nothing up (mail scanners open links); joining does.
- On the join page they **create a passkey** and are signed in, where the address can have passkeys (https with a host name). On an instance with passwords they can set a password of their own instead; this is the only choice at an address without passkeys.
- Until they join they are listed as **Invited** and cannot sign in any other way: no sign-in code is sent to them and no password can be reset for them. **Send invitation again** makes the earlier link useless; **Withdraw invitation** kills the link and deactivates the person, and a new invitation brings them back.
- A link that was used, has expired, was replaced or withdrawn says which, and whom to ask. Correcting an invited person's email kills the link that went to the wrong mailbox; send the invitation again.
- Only the hash of a link is stored. The person's history shows who invited them and when they joined.
- If the mail server refuses the invitation, the admin is told why at once; the person stays listed as invited, to be sent the invitation again.

Without email settings, **Add user** with a one-time password shown on screen stays the way to add people. An instance with `SIGN_IN_METHOD=passkey` has only invitations.

## Sign-in codes by email

Where email is set up (above), the sign-in page offers **Email me a sign-in code**: the way in for a device without a passkey, and the way back after a lost one.

- The person enters their email and gets a six-digit code and a link. Either signs them in. Both work once, for 10 minutes, and **only in the browser that asked**: a code read out or forwarded to someone else opens nothing, and the link opened in a mail app or on another device says where to go instead.
- The page answers the same way whether or not the address has an account.
- After signing in with a code the app offers to add a passkey to the device, every time. On a device that cannot hold one the person continues without.
- Each use of a code, and each passkey added or removed, is announced to the account by email. If an announcement cannot be sent the action still happens; Settings → Email shows the failed send.
- Codes are stored only as hashes, and the list of sends on Settings → Email holds no subject or text.
- **A lost device:** on Settings → Users an admin uses **End sessions and remove passkeys** for that person. The device is signed out at once and its passkey stops working; the person comes back with a code by email and adds a new passkey. The person is told by email.

Without email settings none of this is offered, and a person's last passkey can be removed only while they have a password.

## Health

`GET /health` needs no login and returns the version, whether the database answers, and how many migrations are applied. Docker uses it for the container healthcheck; `docker compose ps` shows `healthy` when all is well.
