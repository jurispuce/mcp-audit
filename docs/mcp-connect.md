# Connect Claude to mcp-audit

mcp-audit has an MCP server at `/mcp` (Streamable HTTP). Claude uses it to read and improve the library, and from milestone 4 onwards to work on engagements. Everything Claude writes is versioned and shown as "Claude on behalf of <you>". AI work that needs a judgement lands as a proposal for you to accept; Claude can never approve findings, change plan status or delete files.

## 1. Create a token

In the app: Settings, Access tokens, Create token. Give it a name that says where it is used, for example "Claude Code on laptop". Copy the token (`mcpa_…`); it is shown once. Make one token per place, so you can revoke one without the others.

The endpoint is the app's address plus `/mcp`, for example `http://audit.example.lan:3000/mcp`. Settings, Access tokens shows it.

## 2. Claude Code

```bash
claude mcp add --transport http mcp-audit http://audit.example.lan:3000/mcp --header "Authorization: Bearer mcpa_yourtoken"
```

- `--scope user` makes it available in all your projects; the default (`local`) is this project only.
- To share the set-up in a repository without sharing the token, use `.mcp.json` and keep the token in an environment variable:

```json
{
	"mcpServers": {
		"mcp-audit": {
			"type": "http",
			"url": "http://audit.example.lan:3000/mcp",
			"headers": { "Authorization": "Bearer ${AUDIT_TOKEN}" }
		}
	}
}
```

Then `export AUDIT_TOKEN=mcpa_yourtoken` before starting `claude`. If the variable is unset, the literal text is sent and the app answers 401.

Check the connection with `claude mcp list`, or `/mcp` inside a session.

## 3. Claude Desktop

Desktop's "Add custom connector" connects from Anthropic's cloud, so it cannot reach an app that is only on your private network or VPN. Use the `mcp-remote` bridge instead, which runs on your computer. It needs Node.js.

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
	"mcpServers": {
		"mcp-audit": {
			"command": "npx",
			"args": [
				"mcp-remote",
				"http://audit.example.lan:3000/mcp",
				"--header",
				"Authorization:${AUTH_HEADER}",
				"--allow-http"
			],
			"env": { "AUTH_HEADER": "Bearer mcpa_yourtoken" }
		}
	}
}
```

- `--allow-http` is needed for a plain `http://` address other than localhost. Use it only on a network you trust (your LAN or VPN); leave it out when the app is behind https.
- The token sits in `env`, not in `args`, because Desktop on Windows does not keep spaces inside arguments.
- Restart Claude Desktop after editing the file.

## 3b. claude.ai, Claude Desktop or mobile as a custom connector

This needs the app on a public https address (`docs/public-endpoint.md`): Anthropic's servers make the calls, so a private or VPN address cannot work. No token is needed; you sign in instead.

1. In claude.ai or Claude Desktop: Settings, Connectors, Add custom connector. On Team and Enterprise plans an organization Owner may need to add it first.
2. Name it "mcp-audit" and enter the address `https://<your host>/mcp`. Leave the advanced OAuth fields empty: Claude registers itself.
3. Choose Connect. A window opens on mcp-audit: sign in if asked, check the app's name, and choose **Allow access**.
4. The connector shows the mcp-audit tools. Everything it writes is versioned as "Claude on behalf of <you>", using the name the app registered with.

The connection lasts until you disconnect it in Settings, Access tokens, Connected apps, or an admin deactivates your account. Mobile uses the connectors added on the web.

## 4. Load the audit skills

The skills in `skills/` tell Claude how to run each audit step. In Claude Code, copy a skill folder to `~/.claude/skills/` (or `.claude/skills/` in a project). In Claude Desktop or claude.ai, zip the skill folder and add it under Settings, Capabilities, Skills. When the mcp-audit tools are connected, the skills use them; otherwise they work with files.

## Tools

| Group       | Tools                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Orientation | `list_engagements`, `get_engagement_overview` (engagements arrive in milestone 4)                                                      |
| Library     | `search_requirements`, `get_requirement`, `upsert_sources`, `upsert_requirements`, `link_requirements`, `set_guidance`, `set_criteria` |
| Any item    | `add_comment`, `get_history`, `revert`                                                                                                 |

A requirement is named by its id or as `"<source code>:<reference>"`, for example `"nis2:Art. 21(2)(d)"`.

## When it does not work

| Symptom                           | Cause                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 401                               | Missing, mistyped or revoked token, or its user was deactivated. Create a new token.                                     |
| Connection refused or timeout     | The address is not reachable from where the client runs: check `BIND_ADDRESS`, the VPN, and that the URL ends in `/mcp`. |
| `forbidden: AI can only propose…` | A guard rail: the change needs a person in the app.                                                                      |
| `stale_write`                     | Someone changed the item since Claude read it; Claude should read it again and redo the change.                          |
