import { createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import {
	ACCESS_TTL_MS,
	approveAuthorization,
	AuthorizePageError,
	AuthorizeRedirectError,
	authorizationServerMetadata,
	clientCredentials,
	CODE_TTL_MS,
	denyAuthorization,
	exchangeCode,
	listConnectedApps,
	OAuthError,
	protectedResourceMetadata,
	refreshTokens,
	registerClient,
	resolveAccessToken,
	revokeConnectedApp,
	revokeToken,
	validateAuthorizeRequest
} from './oauth';
import { createFirstAdmin, createUser, setUserActive, getUser } from './users';
import type { Actor } from './write';

const ORIGIN = 'https://audit.example.com';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
let app: AppDatabase;
let admin: Actor;
let anna: Actor;

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	admin = { userId: a.id, channel: 'ui' };
	const { user } = await createUser(app, admin, {
		name: 'Anna',
		email: 'anna@example.test',
		role: 'auditor'
	});
	anna = { userId: user.id, channel: 'ui' };
});
afterEach(() => app.close());

function pkce() {
	const verifier = randomBytes(32).toString('base64url');
	return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function authorizeParams(clientId: string, challenge: string, extra: Record<string, string> = {}) {
	return new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: CLAUDE,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		state: 'xyz',
		resource: `${ORIGIN}/mcp`,
		...extra
	});
}

const noSecret = (clientId: string) => ({ clientId, clientSecret: null, via: 'none' as const });

/** Register a public client, approve as Anna, exchange the code: the whole flow. */
function connect(name = 'Claude') {
	const client = registerClient(app, {
		client_name: name,
		redirect_uris: [CLAUDE],
		token_endpoint_auth_method: 'none'
	});
	const { verifier, challenge } = pkce();
	const req = validateAuthorizeRequest(app, authorizeParams(client.client_id, challenge), ORIGIN);
	const location = new URL(approveAuthorization(app, anna, req, ORIGIN));
	const code = location.searchParams.get('code')!;
	const tokens = exchangeCode(
		app,
		noSecret(client.client_id),
		new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			code_verifier: verifier,
			redirect_uri: CLAUDE
		}),
		ORIGIN
	);
	return { client, tokens, location, code, verifier };
}

describe('OAuth metadata (#75)', () => {
	it('publishes RFC 9728 and RFC 8414 metadata with S256 only', () => {
		expect(protectedResourceMetadata(ORIGIN)).toMatchObject({
			resource: `${ORIGIN}/mcp`,
			authorization_servers: [ORIGIN],
			bearer_methods_supported: ['header']
		});
		expect(authorizationServerMetadata(ORIGIN)).toMatchObject({
			issuer: ORIGIN,
			authorization_endpoint: `${ORIGIN}/oauth/authorize`,
			token_endpoint: `${ORIGIN}/oauth/token`,
			registration_endpoint: `${ORIGIN}/oauth/register`,
			revocation_endpoint: `${ORIGIN}/oauth/revoke`,
			response_types_supported: ['code'],
			code_challenge_methods_supported: ['S256'],
			grant_types_supported: ['authorization_code', 'refresh_token']
		});
	});
});

describe('dynamic client registration (#75)', () => {
	it('registers public clients and clients with a secret', () => {
		const pub = registerClient(app, {
			client_name: 'Claude',
			redirect_uris: [CLAUDE],
			token_endpoint_auth_method: 'none'
		});
		expect(pub).toMatchObject({ client_name: 'Claude', token_endpoint_auth_method: 'none' });
		expect(pub).not.toHaveProperty('client_secret');
		const conf = registerClient(app, { redirect_uris: ['http://localhost/callback'] });
		expect(conf).toMatchObject({
			client_name: 'MCP client',
			token_endpoint_auth_method: 'client_secret_basic'
		});
		expect(conf.client_secret).toMatch(/^mcps_/);
		// The secret is stored only as a hash.
		expect(JSON.stringify(app.sqlite.prepare('SELECT * FROM oauth_client').all())).not.toContain(
			conf.client_secret
		);
	});

	it('accepts https, loopback http and app schemes; refuses other redirect URIs', () => {
		for (const uri of [CLAUDE, 'http://127.0.0.1:3118/callback', 'com.example.app:/cb'])
			expect(() => registerClient(app, { redirect_uris: [uri] }), uri).not.toThrow();
		for (const uri of ['http://evil.example/cb', 'javascript:alert(1)', 'https://x.example/cb#frag'])
			expect(() => registerClient(app, { redirect_uris: [uri] }), uri).toThrow(OAuthError);
		expect(() => registerClient(app, { redirect_uris: [] })).toThrow(/between one and ten/);
		expect(() =>
			registerClient(app, { redirect_uris: [CLAUDE], grant_types: ['client_credentials'] })
		).toThrow(/grants are supported/);
	});
});

describe('authorization (#75)', () => {
	it('requires a registered client and redirect URI, shown on the page rather than redirected', () => {
		const { challenge } = pkce();
		expect(() => validateAuthorizeRequest(app, authorizeParams('mcpc_unknown', challenge), ORIGIN)).toThrow(
			AuthorizePageError
		);
		const c = registerClient(app, { redirect_uris: [CLAUDE], token_endpoint_auth_method: 'none' });
		expect(() =>
			validateAuthorizeRequest(
				app,
				authorizeParams(c.client_id, challenge, { redirect_uri: 'https://evil.example/cb' }),
				ORIGIN
			)
		).toThrow(AuthorizePageError);
	});

	it('sends other problems back to the client: PKCE S256 required, resource must be this /mcp', () => {
		const c = registerClient(app, { redirect_uris: [CLAUDE], token_endpoint_auth_method: 'none' });
		const { challenge } = pkce();
		const cases: [Record<string, string>, string][] = [
			[{ code_challenge: '' }, 'invalid_request'],
			[{ code_challenge_method: 'plain' }, 'invalid_request'],
			[{ response_type: 'token' }, 'unsupported_response_type'],
			[{ resource: 'https://other.example/mcp' }, 'invalid_target']
		];
		for (const [extra, error] of cases) {
			try {
				validateAuthorizeRequest(app, authorizeParams(c.client_id, challenge, extra), ORIGIN);
				expect.unreachable(JSON.stringify(extra));
			} catch (e) {
				expect(e).toBeInstanceOf(AuthorizeRedirectError);
				const loc = new URL((e as AuthorizeRedirectError).location());
				expect(loc.origin + loc.pathname).toBe(CLAUDE);
				expect(loc.searchParams.get('error')).toBe(error);
				expect(loc.searchParams.get('state')).toBe('xyz');
				expect(loc.searchParams.get('iss')).toBe(ORIGIN);
			}
		}
		// A trailing slash on the resource is the same resource.
		expect(() =>
			validateAuthorizeRequest(
				app,
				authorizeParams(c.client_id, challenge, { resource: `${ORIGIN}/mcp/` }),
				ORIGIN
			)
		).not.toThrow();
	});

	it('lets a loopback redirect use any port, as Claude Code does', () => {
		const c = registerClient(app, {
			redirect_uris: ['http://localhost/callback'],
			token_endpoint_auth_method: 'none'
		});
		const { challenge } = pkce();
		const req = validateAuthorizeRequest(
			app,
			authorizeParams(c.client_id, challenge, { redirect_uri: 'http://localhost:3118/callback' }),
			ORIGIN
		);
		expect(req.redirectUri).toBe('http://localhost:3118/callback');
		expect(() =>
			validateAuthorizeRequest(
				app,
				authorizeParams(c.client_id, challenge, { redirect_uri: 'http://localhost:3118/other' }),
				ORIGIN
			)
		).toThrow(AuthorizePageError);
	});

	it('only a person approves; denying sends access_denied back', () => {
		const c = registerClient(app, { redirect_uris: [CLAUDE], token_endpoint_auth_method: 'none' });
		const req = validateAuthorizeRequest(app, authorizeParams(c.client_id, pkce().challenge), ORIGIN);
		expect(() =>
			approveAuthorization(app, { ...anna, channel: 'mcp', agent: 'Claude' }, req, ORIGIN)
		).toThrow(/Only a person/);
		expect(new URL(denyAuthorization(req, ORIGIN)).searchParams.get('error')).toBe('access_denied');
	});
});

describe('tokens (#75)', () => {
	it('exchanges a code with PKCE for an access token that works on /mcp as the person, for this resource only', () => {
		const { tokens, location } = connect();
		expect(location.searchParams.get('state')).toBe('xyz');
		expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, scope: 'mcp' });
		expect(tokens.access_token).toMatch(/^mcpo_/);
		const who = resolveAccessToken(app, tokens.access_token, ORIGIN);
		expect(who).toMatchObject({ user: { id: anna.userId, name: 'Anna' }, clientName: 'Claude' });
		expect(resolveAccessToken(app, tokens.access_token, 'https://other.example')).toBeNull();
		expect(
			resolveAccessToken(app, tokens.access_token, ORIGIN, new Date(Date.now() + ACCESS_TTL_MS + 1000))
		).toBeNull();
	});

	it('codes are single use, short-lived, bound to the client, redirect URI and PKCE verifier', () => {
		const c = registerClient(app, { redirect_uris: [CLAUDE], token_endpoint_auth_method: 'none' });
		const other = registerClient(app, { redirect_uris: [CLAUDE], token_endpoint_auth_method: 'none' });
		const issue = () => {
			const p = pkce();
			const req = validateAuthorizeRequest(app, authorizeParams(c.client_id, p.challenge), ORIGIN);
			return { code: new URL(approveAuthorization(app, anna, req, ORIGIN)).searchParams.get('code')!, ...p };
		};
		const form = (code: string, verifier: string, extra: Record<string, string> = {}) =>
			new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				code_verifier: verifier,
				redirect_uri: CLAUDE,
				...extra
			});
		const err = (fn: () => unknown) => {
			try {
				fn();
			} catch (e) {
				return (e as OAuthError).error;
			}
			return 'no error';
		};

		const a = issue();
		expect(err(() => exchangeCode(app, noSecret(c.client_id), form(a.code, pkce().verifier), ORIGIN))).toBe(
			'invalid_grant'
		);
		const b = issue();
		expect(err(() => exchangeCode(app, noSecret(other.client_id), form(b.code, b.verifier), ORIGIN))).toBe(
			'invalid_grant'
		);
		expect(
			err(() =>
				exchangeCode(
					app,
					noSecret(c.client_id),
					form(b.code, b.verifier, { redirect_uri: 'https://x.example/cb' }),
					ORIGIN
				)
			)
		).toBe('invalid_grant');
		const d = issue();
		expect(
			err(() =>
				exchangeCode(
					app,
					noSecret(c.client_id),
					form(d.code, d.verifier),
					ORIGIN,
					new Date(Date.now() + CODE_TTL_MS + 1000)
				)
			)
		).toBe('invalid_grant');

		// Used twice: the second use fails and the tokens of the first stop working.
		const e = issue();
		const first = exchangeCode(app, noSecret(c.client_id), form(e.code, e.verifier), ORIGIN);
		expect(err(() => exchangeCode(app, noSecret(c.client_id), form(e.code, e.verifier), ORIGIN))).toBe(
			'invalid_grant'
		);
		expect(resolveAccessToken(app, first.access_token, ORIGIN)).toBeNull();
	});

	it('a confidential client must authenticate with its secret, in the body or with Basic', () => {
		const c = registerClient(app, {
			redirect_uris: [CLAUDE],
			token_endpoint_auth_method: 'client_secret_post'
		});
		const p = pkce();
		const req = validateAuthorizeRequest(app, authorizeParams(c.client_id, p.challenge), ORIGIN);
		const code = new URL(approveAuthorization(app, anna, req, ORIGIN)).searchParams.get('code')!;
		const body = new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: p.verifier });
		expect(() =>
			exchangeCode(app, { clientId: c.client_id, clientSecret: 'wrong', via: 'post' }, body, ORIGIN)
		).toThrow(expect.objectContaining({ error: 'invalid_client', status: 401 }));
		const basic = new Request('https://x', {
			headers: {
				authorization: `Basic ${Buffer.from(`${c.client_id}:${c.client_secret}`).toString('base64')}`
			}
		});
		const creds = clientCredentials(basic, body);
		expect(creds.via).toBe('basic');
		expect(exchangeCode(app, creds, body, ORIGIN).access_token).toMatch(/^mcpo_/);
	});

	it('refresh tokens rotate; reusing a spent one revokes the whole grant', () => {
		const { client, tokens } = connect();
		const refresh = (token: string) =>
			refreshTokens(
				app,
				noSecret(client.client_id),
				new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token }),
				ORIGIN
			);
		const second = refresh(tokens.refresh_token);
		expect(second.refresh_token).not.toBe(tokens.refresh_token);
		expect(resolveAccessToken(app, second.access_token, ORIGIN)).not.toBeNull();
		expect(() => refresh(tokens.refresh_token)).toThrow(/already used/);
		expect(resolveAccessToken(app, second.access_token, ORIGIN)).toBeNull();
		expect(() => refresh(second.refresh_token)).toThrow(/revoked/);
	});

	it('revocation (RFC 7009) ends the grant; unknown tokens are not an error', () => {
		const { client, tokens } = connect();
		revokeToken(app, noSecret(client.client_id), 'mcpo_unknown');
		revokeToken(app, noSecret(client.client_id), tokens.refresh_token);
		expect(resolveAccessToken(app, tokens.access_token, ORIGIN)).toBeNull();
	});
});

describe('connected apps (#75)', () => {
	it('lists the apps a person allowed; disconnecting one stops its tokens', () => {
		const { tokens } = connect('Claude');
		resolveAccessToken(app, tokens.access_token, ORIGIN);
		const apps = listConnectedApps(app, anna.userId);
		expect(apps).toHaveLength(1);
		expect(apps[0]).toMatchObject({ clientName: 'Claude' });
		expect(apps[0]!.lastUsedAt).not.toBeNull();
		const ben = { userId: 'someone-else', channel: 'ui' as const };
		expect(() => revokeConnectedApp(app, ben, apps[0]!.grantId)).toThrow(/your own apps/);
		revokeConnectedApp(app, anna, apps[0]!.grantId);
		expect(resolveAccessToken(app, tokens.access_token, ORIGIN)).toBeNull();
		expect(listConnectedApps(app, anna.userId)).toEqual([]);
	});

	it('deactivating a person revokes every app they connected', () => {
		const { tokens } = connect();
		setUserActive(app, admin, anna.userId, getUser(app, anna.userId).version, false);
		expect(resolveAccessToken(app, tokens.access_token, ORIGIN)).toBeNull();
		expect(listConnectedApps(app, anna.userId)).toEqual([]);
	});
});
