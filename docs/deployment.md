# Deployment

mcp-audit is one container with one data volume. The same image runs on a laptop, a server on your network, or a VPS. On a server you only need two files: `docker-compose.yml` and `.env`.

> **Not for the open internet yet.** Until issue #67 (public endpoint readiness: TLS proxy, login rate limiting, secure cookies) is done, keep the app on a private network: your machine, your LAN, or a VPN such as Tailscale or WireGuard.

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

`MCP_AUDIT_TAG` in `.env` chooses the image tag: `latest` (newest release), `main` (newest build of the default branch) or a version such as `v0.2.0`. Pinning a version is safest for a team.

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

| Variable                                                              | Default           | Purpose                                                                                                                                                     |
| --------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BIND_ADDRESS`                                                        | `127.0.0.1`       | Host address the port is published on. Use a LAN or VPN address to share.                                                                                   |
| `HOST_PORT`                                                           | `3000`            | Port on the host.                                                                                                                                           |
| `MCP_AUDIT_TAG`                                                       | `latest`          | Image tag to run.                                                                                                                                           |
| `ORIGIN`                                                              | empty             | Fixed public URL, for example `https://audit.example.lan`. Empty accepts any host; the protocol then comes from `X-Forwarded-Proto` and is http without it. |
| `PROTOCOL_HEADER`, `HOST_HEADER`, `ADDRESS_HEADER`, `XFF_DEPTH`       | empty             | Headers to trust behind a reverse proxy (#67).                                                                                                              |
| `BODY_SIZE_LIMIT`                                                     | `100M`            | Largest request body, for uploading several documents at once. One file may be at most 50 MB.                                                               |
| `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_NAME` | empty             | Create the first admin at first start instead of using `/setup`.                                                                                            |
| `BACKUP_PASSPHRASE`                                                   | empty             | Required for backup and restore. At least 12 characters.                                                                                                    |
| `TZ`                                                                  | `Europe/Riga`     | Time zone for logs and report dates.                                                                                                                        |
| `TEST_SEED_ENABLED`                                                   | `false`           | Test environments only: seed data and a password-free test login. Never in production.                                                                      |
| `DATA_DIR`                                                            | `/data`           | Where the database and files live inside the container. Leave as is.                                                                                        |
| `HOST`, `PORT`                                                        | `0.0.0.0`, `3000` | Address and port inside the container. Leave as is.                                                                                                         |

## Health

`GET /health` needs no login and returns the version, whether the database answers, and how many migrations are applied. Docker uses it for the container healthcheck; `docker compose ps` shows `healthy` when all is well.
