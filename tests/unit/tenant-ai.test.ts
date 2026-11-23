import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseProfile } from '#lib/domain/tenant-profile.ts';
import { REPO, makeHost } from '../fixtures/tenant-host';

/**
 * #95: a key and a budget per tenant at the shared AI gateway. The tenant command is the real shell
 * script and the key helper the real one; docker is scripted, and the gateway is the scripted
 * stand-in for LiteLLM (e2e/fake-llm.mjs), running as a server of its own for this file.
 */
let gateway: ChildProcess;
let url: string;
let h: ReturnType<typeof makeHost>;
const MASTER = 'sk-master-for-tests';

const freePort = () =>
	new Promise<number>((resolve, reject) => {
		const s = createServer();
		s.once('error', reject);
		s.listen(0, '127.0.0.1', () => {
			const { port } = s.address() as { port: number };
			s.close(() => resolve(port));
		});
	});

beforeAll(async () => {
	const port = await freePort();
	url = `http://127.0.0.1:${port}`;
	gateway = spawn('node', [path.join(REPO, 'e2e/fake-llm.mjs')], {
		env: { ...process.env, PORT: String(port), FAKE_MASTER_KEY: MASTER },
		stdio: 'ignore'
	});
	for (let i = 0; i < 100; i++) {
		try {
			if ((await fetch(`${url}/v1/models`)).ok) return;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error('the scripted gateway did not start');
});
afterAll(() => {
	gateway.kill();
});

const AI = () => [
	`AI_GATEWAY_URL=${url}`,
	`AI_GATEWAY_MASTER_KEY=${MASTER}`,
	'TENANT_AI_BUDGET=20',
	'TENANT_AI_DEFAULT_MODEL=fake-tools',
	'TENANT_AI_MODELS=fake-tools,fake-slow',
	'TENANT_AI_WEB_SEARCH=true'
];
beforeEach(() => {
	h = makeHost(AI());
});
afterEach(() => h.cleanup());

/** One AI call with a key, as a tenant's instance makes it. Resolves to the status and the gateway's words. */
async function use(key: string) {
	const res = await fetch(`${url}/v1/chat/completions`, {
		method: 'POST',
		headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
		body: JSON.stringify({ model: 'fake-tools', messages: [{ role: 'user', content: 'hello' }] })
	});
	const body = (await res.json()) as { error?: { message?: string; type?: string } };
	return { status: res.status, type: body.error?.type, message: body.error?.message ?? '' };
}
const keyOf = (name: string) => h.envOf(name).LITELLM_API_KEY!;
const registry = () =>
	readdirSync(path.join(h.hostDir, 'registry'))
		.filter((f) => !f.startsWith('.'))
		.map((f) => readFileSync(path.join(h.hostDir, 'registry', f), 'utf8'))
		.join('\n');

describe('tenant create, with AI', () => {
	it('makes a key with a budget for the tenant, in its own environment file and nowhere else', async () => {
		const dry = h.create('acme', ['--dry-run']);
		expect(dry.out).toContain('would: make an AI key at the gateway with a budget of $20 per 30d');
		expect(existsSync(path.join(h.tenantsDir, 'acme'))).toBe(false);

		const r = h.create('acme');
		expect(r.err).toBe('');
		expect(r.code).toBe(0);
		expect(r.out).toContain('make an AI key at the gateway with a budget of $20 per 30d');
		const key = keyOf('acme');
		expect(key).toMatch(/^sk-/);
		expect((await use(key)).status).toBe(200);

		// The instance is told where the gateway is and which model to use; the key is not in the profile.
		const file = path.join(h.tenantsDir, 'acme/tenant-profile.yaml');
		const profile = parseProfile(parseYaml(readFileSync(file, 'utf8')), file);
		expect(profile.ai).toEqual({ baseUrl: url, apiKey: null, defaultModel: 'fake-tools', webSearch: true });
		expect(readFileSync(file, 'utf8')).not.toContain(key);
		// The key is named together with its gateway: the instance sends it nowhere else.
		expect(h.envOf('acme').LITELLM_BASE_URL).toBe(url);
		// Not in the registry, not on a command line.
		expect(registry()).not.toContain(key);
		expect(h.dockerCalls().join('\n')).not.toContain(key);
		expect(h.meta('acme')).toContain('ai_budget=20');
		expect(h.meta('acme')).toContain('ai=on');
		expect(h.tenant(['status', 'acme']).out).toMatch(
			/AI: {9}\$0\.25 of \$20\.00 used, \$19\.75 left, resets \d{4}-\d\d-\d\d/
		);
	});

	it('gives every tenant a key of its own; what one uses does not show on another', async () => {
		h.create('acme');
		h.create('bolt', ['--ai-budget', '5']);
		expect(keyOf('acme')).not.toBe(keyOf('bolt'));
		await use(keyOf('acme'));
		await use(keyOf('acme'));
		expect(h.tenant(['ai', 'acme']).out).toContain('AI of "acme": $0.50 of $20.00 used, $19.50 left');
		expect(h.tenant(['ai', 'bolt']).out).toContain('AI of "bolt": $0.00 of $5.00 used, $5.00 left');
		expect(h.meta('bolt')).toContain('ai_budget=5');
	});

	it('checks the budget, and what the host must have, before anything is made', () => {
		expect(h.create('acme', ['--ai-budget', 'lots']).err).toContain('A budget is an amount in US dollars');
		h.hostEnv(['TENANT_AI_DEFAULT_MODEL=']);
		expect(h.create('acme').err).toContain('Set TENANT_AI_DEFAULT_MODEL in host.env');
		expect(h.dockerCalls()).toEqual([]);
		expect(existsSync(h.tenantsDir)).toBe(false);
	});

	it('revokes the key again when a later step fails', async () => {
		const r = h.create('acme', [], { env: { FAKE_DOCKER_FAIL: '^compose up' } });
		expect(r.code).toBe(1);
		expect(r.err).toContain('Create failed at: start the container');
		expect(existsSync(path.join(h.tenantsDir, 'acme'))).toBe(false);
		// Made, then revoked: the gateway holds no key for the tenant.
		const calls = h.dockerCalls().filter((c) => c.includes('gateway-keys.mjs'));
		expect(calls.map((c) => c.split('gateway-keys.mjs ')[1])).toEqual([
			'create acme --budget 20 --period 30d --models fake-tools,fake-slow',
			'revoke'
		]);
		expect(h.create('acme').code).toBe(0);
		expect((await use(keyOf('acme'))).status).toBe(200);
	});

	it('names the step when the gateway cannot make a key, and makes nothing', () => {
		h.hostEnv(['AI_GATEWAY_MASTER_KEY=sk-not-the-master-key']);
		const r = h.create('acme');
		expect(r.code).toBe(1);
		expect(r.err).toContain('The AI gateway refused');
		expect(r.err).toContain('Create failed at: make an AI key at the gateway');
		expect(r.err).not.toContain('sk-not-the-master-key');
		expect(existsSync(path.join(h.tenantsDir, 'acme'))).toBe(false);
		expect(h.dockerCalls().some((c) => c.startsWith('compose up'))).toBe(false);
	});

	it('without a gateway on the host, a tenant is made without AI and the command says so', () => {
		const plain = makeHost();
		try {
			const r = plain.create('acme');
			expect(r.code).toBe(0);
			expect(r.out).toContain('skipped: the AI key (no AI gateway in host.env)');
			expect(plain.envOf('acme').LITELLM_API_KEY).toBeUndefined();
			expect(readFileSync(path.join(plain.tenantsDir, 'acme/tenant-profile.yaml'), 'utf8')).not.toContain(
				'ai:'
			);
			expect(plain.tenant(['status', 'acme']).out).toContain('AI:         no AI gateway in host.env');
			expect(plain.tenant(['ai', 'acme', '--budget', '5']).err).toContain(
				'Set AI_GATEWAY_URL and AI_GATEWAY_MASTER_KEY'
			);
		} finally {
			plain.cleanup();
		}
	});
});

describe('tenant ai', () => {
	it('changes the budget: a tenant that used its budget up goes on once it is raised', async () => {
		h.create('acme', ['--ai-budget', '0.50']);
		const key = keyOf('acme');
		await use(key);
		await use(key);
		const full = await use(key);
		expect(full.type).toBe('budget_exceeded');
		expect(h.tenant(['status', 'acme']).out).toContain('$0.50 of $0.50 used, $0.00 left');
		expect(h.tenant(['status', 'acme']).out).toContain('USED UP');

		expect(h.tenant(['ai', 'acme', '--budget', '10', '--dry-run']).out).toContain(
			'Nothing was changed (--dry-run).'
		);
		expect((await use(key)).type).toBe('budget_exceeded');
		const r = h.tenant(['ai', 'acme', '--budget', '10']);
		expect(r.code).toBe(0);
		expect(r.out).toContain('AI of "acme": $0.50 of $10.00 used, $9.50 left');
		expect((await use(key)).status).toBe(200);
		expect(h.meta('acme')).toContain('ai_budget=10');
		expect(h.events()).toContain('acme ai-budget 10');
		expect(h.tenant(['ai', 'acme', '--budget', '-5']).err).toContain('A budget is an amount');
	});

	it('switches a tenant’s AI off and on; other tenants are not touched', async () => {
		h.create('acme');
		h.create('bolt');
		const off = h.tenant(['ai', 'acme', '--off']);
		expect(off.out).toContain('SWITCHED OFF');
		const refused = await use(keyOf('acme'));
		expect(refused.status).toBe(401);
		expect(refused.message).toContain('Key is blocked');
		expect((await use(keyOf('bolt'))).status).toBe(200);
		expect(h.meta('acme')).toContain('ai=off');
		expect(h.tenant(['status', 'acme']).out).toContain('SWITCHED OFF');

		expect(h.tenant(['ai', 'acme', '--on']).out).not.toContain('SWITCHED OFF');
		expect((await use(keyOf('acme'))).status).toBe(200);
		expect(h.events()).toEqual(expect.arrayContaining(['acme ai-off', 'acme ai-on']));
		expect(h.tenant(['ai', 'nobody', '--off']).err).toContain('There is no tenant "nobody".');
	});

	it('says so when the gateway does not answer, and changes nothing on the host', () => {
		h.create('acme');
		h.hostEnv(['AI_GATEWAY_URL=http://127.0.0.1:9']);
		const r = h.tenant(['ai', 'acme', '--budget', '50']);
		expect(r.code).toBe(1);
		expect(r.err).toContain('The budget of "acme" was not changed.');
		expect(h.meta('acme')).toContain('ai_budget=20');
		expect(h.tenant(['status', 'acme']).out).toContain('AI:         the gateway did not answer');
	});
});

describe('tenant delete, with AI', () => {
	it('revokes the tenant’s key, so it cannot be used or charged afterwards', async () => {
		h.create('acme');
		h.create('bolt');
		const key = keyOf('acme');
		expect(h.tenant(['delete', 'acme', '--without-export', '--dry-run']).out).toContain(
			'would: revoke its key at the AI gateway'
		);
		const r = h.tenant(['delete', 'acme', '--without-export'], { input: 'acme\n' });
		expect(r.code).toBe(0);
		expect(r.out).toContain('revoke its key at the AI gateway');
		const after = await use(key);
		expect(after.status).toBe(401);
		expect(after.type).toBe('token_not_found_in_db');
		expect((await use(keyOf('bolt'))).status).toBe(200);
	});

	it('deletes nothing when the key cannot be revoked', () => {
		h.create('acme');
		const r = h.tenant(['delete', 'acme', '--without-export'], {
			input: 'acme\n',
			env: { FAKE_DOCKER_FAIL: 'gateway-keys.mjs revoke' }
		});
		expect(r.code).toBe(1);
		expect(r.err).toContain('The key at the AI gateway could not be revoked, so nothing was deleted.');
		expect(existsSync(path.join(h.tenantsDir, 'acme/.env'))).toBe(true);
		expect(h.meta('acme')).toContain('state=active');
	});
});

describe('a copy restored from a backup', () => {
	it('gets a key and a budget of its own', async () => {
		h.create('acme');
		h.tenant(['backup', 'acme']);
		const r = h.tenant(['restore', 'acme', '--from', 'latest', '--as', 'acme-check']);
		expect(r.err).toBe('');
		expect(keyOf('acme-check')).not.toBe(keyOf('acme'));
		await use(keyOf('acme-check'));
		expect(h.tenant(['ai', 'acme']).out).toContain('$0.00 of $20.00 used');
		expect(h.tenant(['ai', 'acme-check']).out).toContain('$0.25 of $20.00 used');
	});
});
