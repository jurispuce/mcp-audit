// Check a tenant's public address as Cloudflare serves it (#92): from the outside, with no token,
// the way a person's browser and an assistant's server reach it.
//
//   node scripts/check-edge.mjs https://mcpaudit-acme.example.com [--operator https://mcpaudit.example.com] [--lockout]
//
// For the tenant's address it checks that
//   - it answers over https and is the instance it should be (its health page, its own issuer);
//   - its sign-in page is the app's own and not Cloudflare Access;
//   - pages arrive as the app sent them: its Content-Security-Policy, no Rocket Loader, no Web Analytics
//     beacon, nothing else of Cloudflare's put into the page;
//   - nothing is served from Cloudflare's cache;
//   - an assistant's server reaches /mcp and the OAuth endpoints and gets the app's answer, not a
//     Cloudflare challenge;
//   - with --lockout: a made-up CF-Connecting-IP does not change the address the app counts. This locks
//     the address you run it from out of that tenant's /mcp for 15 minutes.
// With --operator, it checks that your own instance still asks for Access, and that the paths
// connectors need are exempt there.
//
// It prints one line per check and ends with exit code 1 when one failed. --via http://host:port sends
// the requests there over plain http with the address's name as Host: for tests, without Cloudflare.
import http from 'node:http';
import https from 'node:https';

const USER_AGENT = 'mcp-audit-check-edge/1 (as an assistant server would ask)';
const BODY_LIMIT = 512 * 1024;

/**
 * @typedef {{ status: number, headers: Record<string, string | string[] | undefined>, body: string, error?: string }} Answer
 * @typedef {{ method?: string, headers?: Record<string, string>, body?: string }} Ask
 * @typedef {(path: string, ask?: Ask) => Promise<Answer>} Requester
 * @typedef {{ level: 'ok' | 'fail' | 'note', text: string }} Result
 */

/** Requests to one address, directly or through --via, never following redirects. */
export function requester(
	/** @type {URL} */ target,
	/** @type {URL | null} */ via = null,
	timeoutMs = 15_000
) {
	/** @type {Requester} */
	return (path, ask = {}) =>
		new Promise((resolve) => {
			const headers = { 'user-agent': USER_AGENT, accept: '*/*', ...ask.headers };
			const lib = via ? http : target.protocol === 'https:' ? https : http;
			const req = lib.request(
				via
					? {
							host: via.hostname,
							port: via.port || 80,
							path,
							method: ask.method ?? 'GET',
							headers: { ...headers, host: target.host }
						}
					: {
							host: target.hostname,
							port: target.port || undefined,
							servername: target.hostname,
							path,
							method: ask.method ?? 'GET',
							headers
						},
				(res) => {
					let body = '';
					res.setEncoding('utf8');
					res.on('data', (chunk) => {
						if (body.length < BODY_LIMIT) body += chunk;
					});
					res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
				}
			);
			req.setTimeout(timeoutMs, () => req.destroy(new Error(`no answer within ${timeoutMs / 1000} seconds`)));
			req.on('error', (e) => resolve({ status: 0, headers: {}, body: '', error: e.message }));
			if (ask.body !== undefined) req.write(ask.body);
			req.end();
		});
}

const header = (/** @type {Answer} */ a, /** @type {string} */ name) => {
	const v = a.headers[name.toLowerCase()];
	return Array.isArray(v) ? v.join(', ') : (v ?? '');
};
const json = (/** @type {Answer} */ a) => {
	try {
		return JSON.parse(a.body);
	} catch {
		return null;
	}
};
const said = (/** @type {Answer} */ a) => (a.error ? a.error : `HTTP ${a.status}`);

/** Cloudflare stood in the way: a challenge, a block, or one of its own error pages. */
export function cloudflareStoppedIt(/** @type {Answer} */ a) {
	const mitigated = header(a, 'cf-mitigated');
	if (mitigated) return `Cloudflare answered in the app's place (cf-mitigated: ${mitigated})`;
	if ((a.status === 403 || a.status === 503) && /Just a moment|challenge-platform|cf-chl-/i.test(a.body))
		return 'Cloudflare answered with a challenge page';
	if (/error code: 1033/i.test(a.body))
		return 'Cloudflare could not reach the tunnel (error 1033): is cloudflared running?';
	if (a.status >= 520 && a.status <= 530) return `Cloudflare could not reach the server (HTTP ${a.status})`;
	if (/error code: 1\d{3}|cf-error-details/i.test(a.body))
		return 'Cloudflare answered with one of its error pages';
	return null;
}

/** Cloudflare Access answered: a redirect to its sign-in, or its own refusal. */
export function accessAnswered(/** @type {Answer} */ a) {
	const where = header(a, 'location');
	if (/cloudflareaccess\.com|\/cdn-cgi\/access\//i.test(where))
		return `a redirect to Access sign-in (${where.slice(0, 80)})`;
	if (/cloudflareaccess\.com|\/cdn-cgi\/access\//i.test(header(a, 'www-authenticate')))
		return 'an Access refusal';
	if (/CF_Authorization|CF_AppSession/i.test(header(a, 'set-cookie'))) return 'an Access cookie';
	if ((a.status === 401 || a.status === 403) && /cloudflareaccess\.com|Cloudflare Access/i.test(a.body))
		return 'an Access page';
	return null;
}

/** What Cloudflare puts into a page it passes on, by the marks it leaves. */
export function rewrites(/** @type {string} */ html) {
	/** @type {string[]} */
	const found = [];
	if (/rocket-loader|data-cf-settings|type="[0-9a-f]+-text\/javascript"/i.test(html))
		found.push('Rocket Loader');
	if (/data-cfemail|\/cdn-cgi\/l\/email-protection|email-decode\.min\.js/i.test(html))
		found.push('Email Obfuscation');
	if (/cloudflareinsights\.com|data-cf-beacon/i.test(html)) found.push('the Web Analytics beacon');
	if (/\/cdn-cgi\/(scripts|challenge-platform|zaraz)\//i.test(html) && !found.length)
		found.push('a Cloudflare script');
	return found;
}

const CACHED = /^(HIT|MISS|EXPIRED|STALE|UPDATING|REVALIDATED)$/i;

/** @param {URL} target @param {Requester} ask @param {{ via: boolean, lockout: boolean }} opts @returns {Promise<Result[]>} */
export async function checkTenant(target, ask, opts) {
	/** @type {Result[]} */
	const out = [];
	const ok = (/** @type {string} */ text) => out.push({ level: 'ok', text });
	const fail = (/** @type {string} */ text) => out.push({ level: 'fail', text });
	const note = (/** @type {string} */ text) => out.push({ level: 'note', text });
	const origin = target.origin;

	// ---- It answers, over https, and is the instance it should be
	if (target.protocol !== 'https:' && !opts.via) fail(`${origin} is not an https address`);
	const health = await ask('/health');
	const h = json(health);
	if (health.status === 200 && h?.status === 'ok')
		ok(`it answers: the instance is healthy, version ${h.version}`);
	else {
		const stopped = cloudflareStoppedIt(health) ?? accessAnswered(health);
		fail(`it does not answer as an instance: /health gave ${said(health)}${stopped ? `, ${stopped}` : ''}`);
		return out;
	}
	const server = json(await ask('/.well-known/oauth-authorization-server'));
	if (server?.issuer === origin) ok(`it names itself ${origin} (ORIGIN is right)`);
	else fail(`it names itself ${server?.issuer ?? 'nothing'}, not ${origin}: check ORIGIN in its .env`);
	if (opts.via) note('https and Strict-Transport-Security not checked: asked over plain http (--via)');
	else if (/max-age=\d+/.test(header(health, 'strict-transport-security')))
		ok('browsers are told to stay on https (Strict-Transport-Security)');
	else fail('no Strict-Transport-Security header: the instance did not see the request as https');

	// ---- The sign-in page is the app's own, not Access
	const login = await ask('/login');
	const access = accessAnswered(login);
	if (access)
		fail(
			`Cloudflare Access is in front of it: /login gave ${access}. Tenant names must not be behind Access`
		);
	else if (login.status === 200 && /<title>Sign in\b/.test(login.body))
		ok('the sign-in page is the app’s own, with no Access in front');
	else
		fail(
			`the sign-in page did not come: /login gave ${said(login)}${cloudflareStoppedIt(login) ? `, ${cloudflareStoppedIt(login)}` : ''}`
		);

	// ---- Pages arrive as the app sent them
	const guide = await ask('/welcome/guide');
	for (const [path, page] of /** @type {const} */ ([
		['/login', login],
		['/welcome/guide', guide]
	])) {
		if (page.status !== 200) continue;
		const added = rewrites(page.body);
		if (added.length) fail(`Cloudflare changed ${path}: ${added.join(', ')}. Turn it off for tenant names`);
		else ok(`${path} arrives as the app sent it`);
	}
	const policy = header(login, 'content-security-policy');
	if (/script-src 'self' 'nonce-/.test(policy) && /frame-ancestors 'none'/.test(policy))
		ok('the app’s Content-Security-Policy arrives intact');
	else if (login.status === 200)
		fail(`the page's Content-Security-Policy is not the app's: "${policy.slice(0, 80)}"`);
	if (guide.status === 200 && guide.body.includes(`value="${origin}/mcp"`))
		ok('the public guide shows this instance’s own MCP address');
	else if (guide.status !== 200) fail(`the public guide did not come: /welcome/guide gave ${said(guide)}`);
	else fail('the public guide does not show this instance’s MCP address');
	note(
		'Email Obfuscation is not visible from outside: no public page holds an email address. Check the setting'
	);

	// ---- Nothing comes from Cloudflare's cache
	const again = await ask('/login');
	const cached = [
		['/login', login],
		['/login again', again],
		['/health', health],
		['/welcome/guide', guide]
	]
		.map(([path, a]) => [path, header(/** @type {Answer} */ (a), 'cf-cache-status')])
		.filter(([, status]) => CACHED.test(String(status)));
	if (cached.length)
		fail(
			`Cloudflare caches pages: ${cached.map(([p, s]) => `${p} ${s}`).join(', ')}. A Cache Rule should bypass the cache for tenant names`
		);
	else ok('nothing is served from Cloudflare’s cache');

	// ---- An assistant's server gets the app's answers
	const resource = await ask('/.well-known/oauth-protected-resource/mcp');
	const r = json(resource);
	if (resource.status === 200 && r?.resource === `${origin}/mcp`) ok('the connector metadata is reachable');
	else
		fail(
			`the connector metadata did not come: ${said(resource)}${cloudflareStoppedIt(resource) ? `, ${cloudflareStoppedIt(resource)}` : ''}`
		);
	const mcp = await ask('/mcp', {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
	});
	const stopped = cloudflareStoppedIt(mcp) ?? accessAnswered(mcp);
	if (stopped)
		fail(`/mcp: ${stopped}. Assistants' servers must reach it (see Bots in the Cloudflare checklist)`);
	else if (mcp.status === 401 && /resource_metadata=/.test(header(mcp, 'www-authenticate')))
		ok('/mcp answers an assistant’s server and asks it to sign in');
	else fail(`/mcp gave ${said(mcp)}, not the app's request to sign in`);
	const register = await ask('/oauth/register', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: 'not json'
	});
	const reg = json(register);
	const regStopped = cloudflareStoppedIt(register) ?? accessAnswered(register);
	if (regStopped) fail(`/oauth/register: ${regStopped}`);
	else if (register.status === 400 && reg?.error) ok('/oauth/register answers an assistant’s server');
	else fail(`/oauth/register gave ${said(register)}, not the app's answer`);
	note(
		'Cloudflare decides by its own judgement whom to challenge: a pass here does not prove Bot Fight Mode is off'
	);

	// ---- A made-up visitor's address (optional: it locks the address you run it from out for 15 minutes)
	if (opts.lockout) {
		let last = /** @type {Answer | null} */ (null);
		let refused = 0;
		for (let i = 1; i <= 31; i++) {
			last = await ask('/mcp', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: 'Bearer mcpa_wrong',
					'cf-connecting-ip': `203.0.113.${i}`
				},
				body: '{}'
			});
			if (cloudflareStoppedIt(last)) refused++;
		}
		if (refused === 31) ok('Cloudflare refuses a request that names its own visitor address');
		else if (last?.status === 429)
			ok('31 requests with made-up visitor addresses counted as one sender (locked out: 429)');
		else
			fail(
				`31 requests with made-up visitor addresses were counted apart (last answer ${said(/** @type {Answer} */ (last))}): the app trusts a header it must not`
			);
		note('your address is now locked out of this tenant’s /mcp for 15 minutes');
	}
	return out;
}

/** Your own instance: Access in front, and the paths connectors need let through. */
export async function checkOperator(/** @type {URL} */ target, /** @type {Requester} */ ask) {
	/** @type {Result[]} */
	const out = [];
	const ok = (/** @type {string} */ text) => out.push({ level: 'ok', text: `your own instance: ${text}` });
	const fail = (/** @type {string} */ text) =>
		out.push({ level: 'fail', text: `your own instance: ${text}` });
	const home = await ask('/');
	const access = accessAnswered(home);
	if (access) ok(`asks for Access (${access})`);
	else
		fail(
			`does not ask for Access: / gave ${said(home)}${header(home, 'location') ? ` to ${header(home, 'location')}` : ''}`
		);
	const authorize = await ask('/oauth/authorize');
	if (accessAnswered(authorize)) ok('/oauth/authorize stays behind Access');
	else fail(`/oauth/authorize is not behind Access (${said(authorize)}): it is a page a person opens`);

	const mcp = await ask('/mcp', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{}'
	});
	if (accessAnswered(mcp))
		fail('/mcp is behind Access: connectors cannot reach it. Exempt it with a Bypass policy');
	else if (mcp.status === 401 && /resource_metadata=/.test(header(mcp, 'www-authenticate')))
		ok('/mcp is let through to the app');
	else fail(`/mcp gave ${said(mcp)}${cloudflareStoppedIt(mcp) ? `, ${cloudflareStoppedIt(mcp)}` : ''}`);
	for (const [path, method, body] of /** @type {const} */ ([
		['/.well-known/oauth-protected-resource/mcp', 'GET', undefined],
		['/.well-known/oauth-authorization-server', 'GET', undefined],
		['/oauth/register', 'POST', 'not json'],
		['/oauth/token', 'POST', ''],
		['/oauth/revoke', 'POST', '']
	])) {
		const a = await ask(path, {
			method,
			body,
			headers:
				body === undefined
					? {}
					: {
							'content-type':
								path === '/oauth/register' ? 'application/json' : 'application/x-www-form-urlencoded'
						}
		});
		if (accessAnswered(a)) fail(`${path} is behind Access: exempt it with a Bypass policy`);
		else if (cloudflareStoppedIt(a)) fail(`${path}: ${cloudflareStoppedIt(a)}`);
		else if (a.status === 0) fail(`${path}: ${said(a)}`);
		else if (a.status < 500 && (json(a) !== null || path === '/oauth/revoke'))
			ok(`${path} is let through to the app`);
		else fail(`${path} gave ${said(a)}, not the app's answer`);
	}
	return out;
}

/** @param {string[]} argv @param {{ requesterFor?: (target: URL) => Requester }} deps */
export async function main(argv, deps = {}) {
	const flag = (/** @type {string} */ name) => {
		const i = argv.indexOf(name);
		return i === -1 ? null : (argv[i + 1] ?? '');
	};
	const address = argv.find(
		(a, i) => !a.startsWith('--') && argv[i - 1] !== '--operator' && argv[i - 1] !== '--via'
	);
	if (!address)
		throw new Error(
			'Usage: check-edge.mjs <https://tenant address> [--operator <https://your address>] [--lockout] [--via <http://host:port>]'
		);
	const parse = (/** @type {string} */ s) => {
		try {
			return new URL(s.includes('://') ? s : `https://${s}`);
		} catch {
			throw new Error(`"${s}" is not an address`);
		}
	};
	const target = parse(address);
	const via = flag('--via') ? parse(/** @type {string} */ (flag('--via'))) : null;
	const ask = (/** @type {URL} */ t) => (deps.requesterFor ? deps.requesterFor(t) : requester(t, via));
	const results = await checkTenant(target, ask(target), { via: !!via, lockout: argv.includes('--lockout') });
	const operator = flag('--operator');
	if (operator) results.push(...(await checkOperator(parse(operator), ask(parse(operator)))));
	const failed = results.filter((r) => r.level === 'fail').length;
	const lines = [
		`${target.origin}${via ? ` (through ${via.origin})` : ''}`,
		...results.map((r) => `  ${r.level === 'ok' ? 'ok  ' : r.level === 'fail' ? 'FAIL' : 'note'}  ${r.text}`),
		failed ? `${failed} check(s) failed.` : 'All checks passed.'
	];
	return { lines, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main(process.argv.slice(2))
		.then(({ lines, failed }) => {
			console.log(lines.join('\n'));
			process.exit(failed ? 1 : 0);
		})
		.catch((e) => {
			console.error(e instanceof Error ? e.message : e);
			process.exit(2);
		});
}
