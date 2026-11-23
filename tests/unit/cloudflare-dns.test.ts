import { beforeEach, describe, expect, it } from 'vitest';
import {
	RECORD_COMMENT,
	addTenantRecord,
	configFromEnv,
	main,
	recordsFor,
	removeTenantRecord
} from '../../scripts/cloudflare-dns.mjs';

/** #92: a tenant's DNS record, against a stand-in for Cloudflare's API that keeps one zone in memory. */

interface Rec {
	id: string;
	type: string;
	name: string;
	content: string;
	proxied?: boolean;
	comment?: string | null;
}
let zone: Rec[];
let calls: { method: string; path: string; auth: string | null }[];
let tokenOk = true;

const fake: typeof fetch = async (input, init = {}) => {
	const url = new URL(String(input));
	const method = init.method ?? 'GET';
	const headers = new Headers(init.headers);
	calls.push({ method, path: url.pathname + url.search, auth: headers.get('authorization') });
	const answer = (status: number, body: unknown) =>
		new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	if (!tokenOk)
		return answer(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] });
	const m = /^\/client\/v4\/zones\/zone-1\/dns_records(?:\/([\w-]+))?$/.exec(url.pathname);
	if (!m) return answer(404, { success: false, errors: [{ message: 'Zone not found' }] });
	if (method === 'GET') {
		const name = url.searchParams.get('name');
		return answer(200, { success: true, result: zone.filter((r) => r.name === name) });
	}
	if (method === 'POST') {
		const rec = { id: `rec-${zone.length + 1}`, ...(JSON.parse(String(init.body)) as Omit<Rec, 'id'>) };
		zone.push(rec);
		return answer(200, { success: true, result: rec });
	}
	if (method === 'DELETE') {
		zone = zone.filter((r) => r.id !== m[1]);
		return answer(200, { success: true, result: { id: m[1] } });
	}
	return answer(405, { success: false, errors: [{ message: 'Method not allowed' }] });
};

const cfg = { token: 'cf-secret-token', zoneId: 'zone-1', tunnelId: 'tunnel-abc', fetch: fake };
const TARGET = 'tunnel-abc.cfargotunnel.com';
const HOST = 'mcpaudit-acme.example.com';

beforeEach(() => {
	zone = [
		{ id: 'own', type: 'CNAME', name: 'mcpaudit.example.com', content: TARGET, proxied: true, comment: null },
		{ id: 'www', type: 'A', name: 'www.example.com', content: '192.0.2.10' }
	];
	calls = [];
	tokenOk = true;
});

describe('a tenant’s DNS record (#92)', () => {
	it('points the name at the tunnel, proxied, and marks the record as its own', async () => {
		expect(await addTenantRecord(cfg, 'MCPAudit-Acme.Example.com')).toBe('created');
		expect(zone.at(-1)).toEqual({
			id: 'rec-3',
			type: 'CNAME',
			name: HOST,
			content: TARGET,
			proxied: true,
			ttl: 1,
			comment: RECORD_COMMENT
		});
		// Asking again changes nothing.
		expect(await addTenantRecord(cfg, HOST)).toBe('unchanged');
		expect(zone).toHaveLength(3);
		expect(calls.every((c) => c.auth === 'Bearer cf-secret-token')).toBe(true);
		// One name at a time: never a wildcard, never another name.
		expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
		expect(JSON.stringify(zone)).not.toContain('*');
	});

	it('never takes over a name that is in use, such as the operator’s own instance', async () => {
		await expect(addTenantRecord(cfg, 'mcpaudit.example.com')).rejects.toThrow(
			'mcpaudit.example.com already has a CNAME record (tunnel-abc.cfargotunnel.com) that this command did not make. Nothing was changed.'
		);
		await expect(addTenantRecord(cfg, 'www.example.com')).rejects.toThrow(
			'already has a A record (192.0.2.10)'
		);
		expect(zone).toHaveLength(2);
	});

	it('removes only a record it made', async () => {
		await addTenantRecord(cfg, HOST);
		expect(await removeTenantRecord(cfg, HOST)).toBe('removed');
		expect(zone.map((r) => r.id)).toEqual(['own', 'www']);
		expect(await removeTenantRecord(cfg, HOST)).toBe('absent');
		// The operator's own record points at the same tunnel, but this command did not make it.
		await expect(removeTenantRecord(cfg, 'mcpaudit.example.com')).rejects.toThrow('It was left alone.');
		await expect(removeTenantRecord(cfg, 'www.example.com')).rejects.toThrow('It was left alone.');
		expect(zone).toHaveLength(2);
		expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
	});

	it('refuses what is not a host name, before asking Cloudflare', async () => {
		for (const bad of [
			'',
			'acme',
			'*.example.com',
			'acme .example.com',
			'https://acme.example.com',
			'a/b.example.com'
		])
			await expect(addTenantRecord(cfg, bad)).rejects.toThrow('is not a host name');
		expect(calls).toHaveLength(0);
	});

	it('reports Cloudflare’s refusal without the token', async () => {
		tokenOk = false;
		const error = await addTenantRecord(cfg, HOST).catch((e: Error) => e);
		expect((error as Error).message).toBe('Cloudflare refused: Authentication error');
		expect((error as Error).message).not.toContain('cf-secret-token');
	});

	it('names the settings it needs', () => {
		expect(() => configFromEnv({ CLOUDFLARE_ZONE_ID: 'z' })).toThrow(
			'Set CLOUDFLARE_API_TOKEN, CLOUDFLARE_TUNNEL_ID (host.env).'
		);
		expect(
			configFromEnv({ CLOUDFLARE_API_TOKEN: ' t ', CLOUDFLARE_ZONE_ID: 'z', CLOUDFLARE_TUNNEL_ID: 'u' })
		).toEqual({
			token: 't',
			zoneId: 'z',
			tunnelId: 'u',
			apiBase: undefined
		});
	});

	it('shows what a name has, and says which records are not its own', async () => {
		await addTenantRecord(cfg, HOST);
		expect((await recordsFor(cfg, HOST)).map((r) => r.content)).toEqual([TARGET]);
		await expect(main(['rename', HOST], {})).rejects.toThrow('Usage');
	});
});
