// The DNS record of a tenant's address (#92): add it when a tenant is created, remove it when the
// tenant is deleted. Each record is a proxied CNAME to the Cloudflare Tunnel, so the name arrives at
// the tunnel and nowhere else. There is no wildcard record: other names on the domain are untouched.
//
//   node scripts/cloudflare-dns.mjs add <host name>
//   node scripts/cloudflare-dns.mjs remove <host name>
//   node scripts/cloudflare-dns.mjs show <host name>
//
// On the tenant host it runs in the app's image, which has Node:
//   docker run --rm --env-file host.env ghcr.io/jurispuce/mcp-audit:main node scripts/cloudflare-dns.mjs add <host name>
//
// Needs CLOUDFLARE_API_TOKEN (one permission: Zone, DNS, Edit, on this one zone), CLOUDFLARE_ZONE_ID
// and CLOUDFLARE_TUNNEL_ID. It only ever touches records it made itself, told by their comment.

/** Written on every record this script makes; the only records it will change or delete. */
export const RECORD_COMMENT = 'mcp-audit tenant';

const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * @typedef {{ token: string, zoneId: string, tunnelId: string, apiBase?: string, fetch?: typeof fetch }} DnsConfig
 * @typedef {{ id: string, type: string, name: string, content: string, proxied?: boolean, comment?: string | null }} DnsRecord
 */

/** @param {Record<string, string | undefined>} env @returns {DnsConfig} */
export function configFromEnv(env = process.env) {
	const missing = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_TUNNEL_ID'].filter(
		(k) => !(env[k] ?? '').trim()
	);
	if (missing.length) throw new Error(`Set ${missing.join(', ')} (host.env).`);
	return {
		token: String(env.CLOUDFLARE_API_TOKEN).trim(),
		zoneId: String(env.CLOUDFLARE_ZONE_ID).trim(),
		tunnelId: String(env.CLOUDFLARE_TUNNEL_ID).trim(),
		apiBase: (env.CLOUDFLARE_API_BASE ?? '').trim() || undefined
	};
}

/** Where a tenant's name points: the tunnel. @param {DnsConfig} cfg */
export const tunnelTarget = (cfg) => `${cfg.tunnelId}.cfargotunnel.com`;

/** @param {string} name */
function hostName(name) {
	const host = String(name ?? '')
		.trim()
		.toLowerCase();
	if (!HOST.test(host)) throw new Error(`"${name}" is not a host name.`);
	return host;
}

/** @param {DnsConfig} cfg @param {string} path @param {RequestInit} [init] */
async function api(cfg, path, init = {}) {
	const doFetch = cfg.fetch ?? fetch;
	const res = await doFetch(`${cfg.apiBase ?? 'https://api.cloudflare.com/client/v4'}${path}`, {
		...init,
		headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' }
	});
	/** @type {{ success?: boolean, result?: unknown, errors?: { code?: number, message?: string }[] }} */
	const body = await res.json().catch(() => ({}));
	if (!res.ok || body.success === false) {
		const said =
			(body.errors ?? [])
				.map((e) => e.message)
				.filter(Boolean)
				.join('; ') || `HTTP ${res.status}`;
		// The token is never part of a message.
		throw new Error(`Cloudflare refused: ${said}`);
	}
	return body.result;
}

/** Every record with this name, whatever made it. @param {DnsConfig} cfg @param {string} name @returns {Promise<DnsRecord[]>} */
export async function recordsFor(cfg, name) {
	const host = hostName(name);
	const found = await api(cfg, `/zones/${cfg.zoneId}/dns_records?name=${encodeURIComponent(host)}`);
	return /** @type {DnsRecord[]} */ (Array.isArray(found) ? found : []);
}

/** @param {DnsConfig} cfg @param {DnsRecord} r */
const isOurs = (cfg, r) =>
	r.type === 'CNAME' && r.content === tunnelTarget(cfg) && r.comment === RECORD_COMMENT;

/**
 * Point a tenant's name at the tunnel. A name that already has any other record is left alone and
 * reported, so a typo can never take over an address that is in use.
 * @param {DnsConfig} cfg @param {string} name @returns {Promise<'created' | 'unchanged'>}
 */
export async function addTenantRecord(cfg, name) {
	const host = hostName(name);
	const existing = await recordsFor(cfg, host);
	if (existing.some((r) => isOurs(cfg, r))) return 'unchanged';
	const other = existing[0];
	if (other) {
		const r = other;
		throw new Error(
			`${host} already has a ${r.type} record (${r.content}) that this command did not make. Nothing was changed.`
		);
	}
	await api(cfg, `/zones/${cfg.zoneId}/dns_records`, {
		method: 'POST',
		body: JSON.stringify({
			type: 'CNAME',
			name: host,
			content: tunnelTarget(cfg),
			proxied: true,
			ttl: 1,
			comment: RECORD_COMMENT
		})
	});
	return 'created';
}

/**
 * Remove a tenant's record. Only a record this command made is deleted; anything else with the name
 * is left alone and reported.
 * @param {DnsConfig} cfg @param {string} name @returns {Promise<'removed' | 'absent'>}
 */
export async function removeTenantRecord(cfg, name) {
	const host = hostName(name);
	const existing = await recordsFor(cfg, host);
	const ours = existing.filter((r) => isOurs(cfg, r));
	if (!ours.length) {
		const other = existing[0];
		if (other)
			throw new Error(
				`${host} has a ${other.type} record (${other.content}) that this command did not make. It was left alone.`
			);
		return 'absent';
	}
	for (const r of ours) await api(cfg, `/zones/${cfg.zoneId}/dns_records/${r.id}`, { method: 'DELETE' });
	return 'removed';
}

/** @param {string[]} argv @param {Record<string, string | undefined>} env @param {(line: string) => void} out */
export async function main(argv, env = process.env, out = console.log) {
	const [action = '', name] = argv;
	if (!['add', 'remove', 'show'].includes(action) || !name)
		throw new Error('Usage: cloudflare-dns.mjs add|remove|show <host name>');
	const cfg = configFromEnv(env);
	if (action === 'add') {
		const did = await addTenantRecord(cfg, name);
		out(
			did === 'created'
				? `Added ${name} -> ${tunnelTarget(cfg)} (proxied).`
				: `${name} already points at the tunnel.`
		);
	} else if (action === 'remove') {
		const did = await removeTenantRecord(cfg, name);
		out(did === 'removed' ? `Removed ${name}.` : `${name} had no record.`);
	} else {
		const records = await recordsFor(cfg, name);
		if (!records.length) out(`${name} has no record.`);
		for (const r of records)
			out(
				`${r.name} ${r.type} ${r.content}${r.proxied ? ' (proxied)' : ''}${isOurs(cfg, r) ? '' : '  [not made by this command]'}`
			);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main(process.argv.slice(2)).catch((e) => {
		console.error(e.message);
		process.exit(1);
	});
}
