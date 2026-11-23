import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accessAnswered, cloudflareStoppedIt, main, rewrites } from '../../scripts/check-edge.mjs';
import { OWN, TENANT } from '../fixtures/fake-edge.mjs';
import { REPO, makeHost } from '../fixtures/tenant-host';

/**
 * #92: the check of a tenant's public address. A stand-in answers as the app does through a
 * Cloudflare that behaves well, and can be told to misbehave the ways Cloudflare can: Access in front,
 * a challenge, pages rewritten or cached. The answers of the real app are checked in the smoke test,
 * where the same script runs against real instances.
 */
const ORIGIN = `https://${TENANT}`;

type Misbehaviour =
	| 'access'
	| 'access-401'
	| 'challenge-mcp'
	| 'rocket'
	| 'beacon'
	| 'cache'
	| 'csp-gone'
	| 'origin-wrong'
	| 'down'
	| 'trusts-forged';

let edge: ChildProcess;
let via: string;
beforeAll(async () => {
	edge = spawn(process.execPath, [path.join(REPO, 'tests/fixtures/fake-edge.mjs')], {
		stdio: ['ignore', 'pipe', 'inherit']
	});
	via = await new Promise<string>((resolve) =>
		edge.stdout!.on('data', (d) => {
			const port = /fake edge on (\d+)/.exec(String(d))?.[1];
			if (port) resolve(`http://127.0.0.1:${port}`);
		})
	);
});
afterAll(() => {
	edge.kill();
});
/** What the stand-in gets wrong from now on. */
const getWrong = (...what: Misbehaviour[]) =>
	fetch(`${via}/__wrong`, { method: 'POST', body: JSON.stringify(what) }).then(() => undefined);
beforeEach(() => getWrong());

/** The check as run, but towards the stand-in, and as if it were https: what --via does, minus the https note. */
async function check(args: string[] = []) {
	const { lines, failed } = await main([ORIGIN, '--via', via, ...args]);
	return { text: lines.join('\n'), failed, lines };
}

describe('tenant check-edge, against a Cloudflare that behaves', () => {
	it('passes, and says what it cannot see from outside', async () => {
		const r = await check();
		expect(r.failed).toBe(0);
		expect(r.text).toContain('ok    it answers: the instance is healthy, version v1.2.3');
		expect(r.text).toContain(`ok    it names itself ${ORIGIN} (ORIGIN is right)`);
		expect(r.text).toContain('ok    the sign-in page is the app’s own, with no Access in front');
		expect(r.text).toContain('ok    /login arrives as the app sent it');
		expect(r.text).toContain('ok    the app’s Content-Security-Policy arrives intact');
		expect(r.text).toContain('ok    the public guide shows this instance’s own MCP address');
		expect(r.text).toContain('ok    nothing is served from Cloudflare’s cache');
		expect(r.text).toContain('ok    /mcp answers an assistant’s server and asks it to sign in');
		expect(r.text).toContain('ok    /oauth/register answers an assistant’s server');
		expect(r.text).toContain('note  Email Obfuscation is not visible from outside');
		expect(r.text).toContain('note  Cloudflare decides by its own judgement whom to challenge');
		expect(r.lines.at(-1)).toBe('All checks passed.');
	});

	it('checks your own instance: Access in front, the paths connectors need let through', async () => {
		const r = await check(['--operator', `https://${OWN}`]);
		expect(r.failed).toBe(0);
		expect(r.text).toContain('ok    your own instance: asks for Access (a redirect to Access sign-in');
		expect(r.text).toContain('ok    your own instance: /oauth/authorize stays behind Access');
		for (const path of [
			'/mcp',
			'/.well-known/oauth-protected-resource/mcp',
			'/oauth/register',
			'/oauth/token',
			'/oauth/revoke'
		])
			expect(r.text).toContain(`ok    your own instance: ${path} is let through to the app`);
	});
});

describe('tenant check-edge finds what Cloudflare got wrong', () => {
	const failsWith = async (what: Misbehaviour, ...expected: string[]) => {
		await getWrong(what);
		const r = await check();
		expect(r.failed, what).toBeGreaterThan(0);
		for (const e of expected) expect(r.text, what).toContain(e);
		expect(r.lines.at(-1)).toMatch(/^\d+ check\(s\) failed\.$/);
	};

	it('Access in front of a tenant, as a redirect or as a refusal', async () => {
		await failsWith(
			'access',
			'FAIL  it does not answer as an instance: /health gave HTTP 302, a redirect to Access sign-in'
		);
		await failsWith('access-401', 'an Access refusal');
	});

	it('a challenge on /mcp', async () => {
		await failsWith(
			'challenge-mcp',
			"FAIL  /mcp: Cloudflare answered in the app's place (cf-mitigated: challenge). Assistants' servers must reach it"
		);
	});

	it('pages changed by Rocket Loader or the Web Analytics beacon, or without the app’s policy', async () => {
		await failsWith('rocket', 'FAIL  Cloudflare changed /login: Rocket Loader. Turn it off for tenant names');
		await failsWith('beacon', 'FAIL  Cloudflare changed /welcome/guide: the Web Analytics beacon');
		await failsWith('csp-gone', "FAIL  the page's Content-Security-Policy is not the app's");
	});

	it('pages from the cache', async () => {
		await failsWith(
			'cache',
			'FAIL  Cloudflare caches pages: /login HIT, /login again HIT, /health HIT, /welcome/guide HIT'
		);
	});

	it('an instance that names another address, and one that does not answer', async () => {
		await failsWith(
			'origin-wrong',
			`FAIL  it names itself http://localhost:3000, not ${ORIGIN}: check ORIGIN in its .env`
		);
		await failsWith(
			'down',
			'FAIL  it does not answer as an instance: /health gave HTTP 530, Cloudflare could not reach the tunnel (error 1033): is cloudflared running?'
		);
	});

	it('your own instance without Access in front, or with a connector path not let through', async () => {
		const r = await check(['--operator', `https://${TENANT}`]);
		expect(r.text).toContain('FAIL  your own instance: does not ask for Access: / gave HTTP 404');
		expect(r.text).toContain('FAIL  your own instance: /oauth/authorize is not behind Access');
	});

	it('an address that is not https, asked directly', async () => {
		const { lines, failed } = await main([via]);
		expect(failed).toBeGreaterThan(0);
		expect(lines.join('\n')).toContain(`FAIL  ${via} is not an https address`);
	});
});

describe('a made-up visitor address (--lockout)', () => {
	it('passes when 31 made-up addresses count as one sender', async () => {
		const r = await check(['--lockout']);
		expect(r.failed).toBe(0);
		expect(r.text).toContain(
			'ok    31 requests with made-up visitor addresses counted as one sender (locked out: 429)'
		);
		expect(r.text).toContain('note  your address is now locked out of this tenant’s /mcp for 15 minutes');
	});

	it('fails when the app counts each made-up address apart', async () => {
		await getWrong('trusts-forged');
		const r = await check(['--lockout']);
		expect(r.text).toContain('FAIL  31 requests with made-up visitor addresses were counted apart');
	});
});

describe('what the marks of Cloudflare look like', () => {
	it('tells a challenge, an error page, Access and each kind of rewriting apart from the app’s own answers', () => {
		const a = (status: number, headers: Record<string, string> = {}, body = '') => ({
			status,
			headers,
			body
		});
		expect(cloudflareStoppedIt(a(403, { 'cf-mitigated': 'challenge' }))).toContain('cf-mitigated: challenge');
		expect(cloudflareStoppedIt(a(503, {}, '<title>Just a moment...</title>'))).toContain('challenge page');
		expect(cloudflareStoppedIt(a(530, {}, 'error code: 1016'))).toContain('could not reach the server');
		expect(cloudflareStoppedIt(a(401, {}, '{"error":"unauthorized"}'))).toBeNull();
		expect(cloudflareStoppedIt(a(429, {}, '{"error":"too_many_attempts"}'))).toBeNull();
		expect(accessAnswered(a(302, { location: '/cdn-cgi/access/login/x' }))).toContain('Access sign-in');
		expect(accessAnswered(a(200, { 'set-cookie': 'CF_AppSession=abc; Path=/' }))).toBe('an Access cookie');
		expect(accessAnswered(a(303, { location: '/login?next=%2F' }))).toBeNull();
		expect(rewrites('<a href="/cdn-cgi/l/email-protection#3a5f">[email&#160;protected]</a>')).toEqual([
			'Email Obfuscation'
		]);
		expect(rewrites('<script src="/cdn-cgi/zaraz/s.js"></script>')).toEqual(['a Cloudflare script']);
		expect(rewrites('<script nonce="x">start()</script>')).toEqual([]);
	});
});

describe('bin/tenant check-edge', () => {
	let h: ReturnType<typeof makeHost>;
	beforeEach(() => {
		h = makeHost([`OPERATOR_INSTANCE=https://${OWN}`]);
	});
	afterEach(() => h.cleanup());

	it('checks the tenant’s own address and your instance, in the app’s image, and records the result', () => {
		// The address pattern of the test host gives mcpaudit-acme.example.test, the stand-in's tenant name.
		h.create('acme');
		const r = h.tenant(['check-edge', 'acme', '--via', via]);
		expect(r.err).toBe('');
		expect(r.code).toBe(0);
		expect(r.out).toContain(`${ORIGIN} (through ${via})`);
		expect(r.out).toContain('ok    your own instance: asks for Access');
		expect(r.out).toContain('All checks passed.');
		expect(h.dockerCalls().filter((c) => c.includes('check-edge.mjs'))).toEqual([
			`run --rm ghcr.io/jurispuce/mcp-audit:v1.2.3 node scripts/check-edge.mjs ${ORIGIN} --operator https://${OWN} --via ${via}`
		]);
		expect(h.meta('acme')).toMatch(/^edge_checked=\d{4}-.* ok$/m);
	});

	it('ends with an error when a check fails, and says so in the registry', async () => {
		h.create('acme');
		await getWrong('rocket');
		const r = h.tenant(['check-edge', 'acme', '--via', via]);
		expect(r.code).toBe(1);
		expect(r.out).toContain('FAIL  Cloudflare changed /login: Rocket Loader');
		expect(h.meta('acme')).toMatch(/^edge_checked=\d{4}-.* failed$/m);
		expect(h.tenant(['check-edge', 'nobody']).err).toContain('There is no tenant "nobody".');
	});
});
