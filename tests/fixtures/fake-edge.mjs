// A stand-in for Cloudflare in front of mcp-audit instances, for tests of scripts/check-edge.mjs (#92).
// It answers as the app does through a Cloudflare that behaves well, and can be told to misbehave the
// ways Cloudflare can: POST /__wrong on any host with a JSON list of what to get wrong.
//   access, access-401   Access in front of the tenant (a redirect, or a refusal)
//   challenge-mcp        a challenge on /mcp
//   rocket, beacon       pages changed by Rocket Loader or the Web Analytics beacon
//   cache                pages served from the cache
//   csp-gone             the app's Content-Security-Policy taken off
//   origin-wrong         the instance names another address
//   down                 the tunnel cannot reach the server
//   trusts-forged        the app counts a made-up CF-Connecting-IP as the sender
// The tenant is mcpaudit-acme.example.test; mcpaudit.example.test is the operator's own instance,
// with Access in front of all but the paths connectors need.
// It runs as a process of its own (node tests/fixtures/fake-edge.mjs; it prints its port), because the
// tenant command is run synchronously by the tests and would otherwise wait on its own test.
import http from 'node:http';

export const TENANT = 'mcpaudit-acme.example.test';
export const OWN = 'mcpaudit.example.test';
const APP_CSP = "default-src 'self'; script-src 'self' 'nonce-abc123'; frame-ancestors 'none'";

let wrong = new Set();
let failures = new Map();

/** @param {http.IncomingMessage} req @param {string} body @param {http.ServerResponse} res */
function answer(req, body, res) {
	const host = String(req.headers.host);
	const url = new URL(req.url ?? '/', 'http://x');
	/** @param {number} status @param {string} text @param {Record<string, string>} [headers] */
	const send = (status, text, headers = {}) => {
		res.writeHead(status, { 'strict-transport-security': 'max-age=31536000', ...headers });
		res.end(text);
	};
	if (url.pathname === '/__wrong') {
		wrong = new Set(JSON.parse(body || '[]'));
		failures = new Map();
		return send(204, '');
	}
	const page = (/** @type {string} */ title, extra = '') =>
		`<!doctype html><html><head><title>${title}</title><script nonce="abc123">start()</script></head><body>${extra}</body></html>`;
	const origin = wrong.has('origin-wrong') ? 'http://localhost:3000' : `https://${host}`;

	if (host === OWN) {
		const exempt =
			url.pathname === '/mcp' ||
			url.pathname.startsWith('/.well-known/') ||
			['/oauth/token', '/oauth/register', '/oauth/revoke'].includes(url.pathname);
		if (!exempt)
			return send(302, '', { location: `https://team.cloudflareaccess.com/cdn-cgi/access/login/${OWN}` });
	}
	if (wrong.has('access') && host === TENANT)
		return send(302, '', {
			location: `https://team.cloudflareaccess.com/cdn-cgi/access/login/${host}?redirect_url=%2F`
		});
	if (wrong.has('access-401') && host === TENANT)
		return send(401, 'Unauthorized', {
			'www-authenticate':
				'Bearer resource_metadata="https://team.cloudflareaccess.com/.well-known/oauth-protected-resource"'
		});
	if (wrong.has('down')) return send(530, 'error code: 1033');
	const cache = { 'cf-cache-status': wrong.has('cache') ? 'HIT' : 'DYNAMIC' };

	if (url.pathname === '/health')
		return send(200, JSON.stringify({ status: 'ok', version: 'v1.2.3' }), {
			'content-type': 'application/json',
			...cache
		});
	if (url.pathname === '/.well-known/oauth-authorization-server')
		return send(200, JSON.stringify({ issuer: origin }), { 'content-type': 'application/json' });
	if (url.pathname === '/.well-known/oauth-protected-resource/mcp')
		return send(200, JSON.stringify({ resource: `${origin}/mcp`, authorization_servers: [origin] }), {
			'content-type': 'application/json'
		});
	if (url.pathname === '/login' || url.pathname === '/welcome/guide') {
		let html =
			url.pathname === '/login'
				? page('Sign in · Acme')
				: page('Acme Guide', `<input value="${origin}/mcp">`);
		if (wrong.has('rocket'))
			html =
				html.replace('<script nonce', '<script type="8c1e7f2a-text/javascript" nonce') +
				'<script src="/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js" data-cf-settings="8c1e7f2a-|49" defer></script>';
		if (wrong.has('beacon'))
			html += `<script defer src="https://static.cloudflareinsights.com/beacon.min.js/v8c78df7c7c0f484497ecbca7046644da1771523124516" data-cf-beacon='{"token":"x"}'></script>`;
		return send(200, html, {
			'content-type': 'text/html',
			...(wrong.has('csp-gone') ? {} : { 'content-security-policy': APP_CSP }),
			...cache
		});
	}
	if (url.pathname === '/mcp' && req.method === 'POST') {
		if (wrong.has('challenge-mcp'))
			return send(
				403,
				'<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></html>',
				{ 'cf-mitigated': 'challenge', 'content-type': 'text/html' }
			);
		if (String(req.headers.authorization ?? '').startsWith('Bearer ')) {
			// The app's lock-out: 30 wrong tokens from one sender. Which sender is the question.
			const who = wrong.has('trusts-forged')
				? String(req.headers['cf-connecting-ip'])
				: String(req.socket.remoteAddress);
			const n = (failures.get(who) ?? 0) + 1;
			failures.set(who, n);
			if (n > 30)
				return send(429, JSON.stringify({ error: 'too_many_attempts' }), {
					'content-type': 'application/json'
				});
		}
		return send(401, JSON.stringify({ error: 'unauthorized' }), {
			'content-type': 'application/json',
			'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`
		});
	}
	if (url.pathname === '/oauth/register' && req.method === 'POST')
		return send(400, JSON.stringify({ error: 'invalid_client_metadata' }), {
			'content-type': 'application/json'
		});
	if (url.pathname === '/oauth/token' && req.method === 'POST')
		return send(400, JSON.stringify({ error: 'invalid_request' }), { 'content-type': 'application/json' });
	if (url.pathname === '/oauth/revoke' && req.method === 'POST') return send(200, '');
	send(404, 'Not found');
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => answer(req, body, res));
	});
	server.listen(Number(process.env.PORT ?? 0), '127.0.0.1', () => {
		const address = server.address();
		console.log(`fake edge on ${typeof address === 'object' && address ? address.port : ''}`);
	});
}
