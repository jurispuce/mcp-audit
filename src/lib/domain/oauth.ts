import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { OAuthClientMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AppDatabase } from '#lib/db/client.ts';
import type { SessionUser } from './auth';
import { ForbiddenError, NotFoundError } from './errors';
import type { UserRole } from './roles';
import type { Actor } from './write';

/**
 * mcp-audit as its own OAuth 2.0 authorization server for /mcp (#75), so remote MCP clients such as
 * claude.ai custom connectors can sign in. Implements what the MCP authorization specification asks
 * for: dynamic client registration (RFC 7591), authorization code with PKCE S256 only, resource
 * indicators (RFC 8707) bound to this server's /mcp, rotating refresh tokens. Personal access tokens
 * keep working alongside. Secrets are stored only as SHA-256 hashes.
 */

export const SCOPE = 'mcp';
export const ACCESS_PREFIX = 'mcpo_';
export const REFRESH_PREFIX = 'mcpr_';
const CLIENT_PREFIX = 'mcpc_';
const SECRET_PREFIX = 'mcps_';
export const CODE_TTL_MS = 5 * 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;

const AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'] as const;
type AuthMethod = (typeof AUTH_METHODS)[number];

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const random = (prefix: string) => prefix + randomBytes(32).toString('base64url');

/** An OAuth error as the protocol names it, with the HTTP status the endpoint answers with. */
export class OAuthError extends Error {
	constructor(
		readonly error: string,
		readonly description: string,
		readonly status = 400
	) {
		super(description);
	}
}

/** The URLs a client must know, all derived from the public origin. */
export function endpoints(origin: string) {
	const o = origin.replace(/\/+$/, '');
	return {
		issuer: o,
		resource: `${o}/mcp`,
		resourceMetadata: `${o}/.well-known/oauth-protected-resource/mcp`,
		authorize: `${o}/oauth/authorize`,
		token: `${o}/oauth/token`,
		register: `${o}/oauth/register`,
		revoke: `${o}/oauth/revoke`
	};
}

/** RFC 9728 protected resource metadata for /mcp. */
export function protectedResourceMetadata(origin: string) {
	const e = endpoints(origin);
	return {
		resource: e.resource,
		authorization_servers: [e.issuer],
		scopes_supported: [SCOPE],
		bearer_methods_supported: ['header'],
		resource_name: 'mcp-audit'
	};
}

/** RFC 8414 authorization server metadata. */
export function authorizationServerMetadata(origin: string) {
	const e = endpoints(origin);
	return {
		issuer: e.issuer,
		authorization_endpoint: e.authorize,
		token_endpoint: e.token,
		registration_endpoint: e.register,
		revocation_endpoint: e.revoke,
		scopes_supported: [SCOPE],
		response_types_supported: ['code'],
		response_modes_supported: ['query'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: [...AUTH_METHODS],
		revocation_endpoint_auth_methods_supported: [...AUTH_METHODS],
		authorization_response_iss_parameter_supported: true
	};
}

/** Resource indicators are compared without a trailing slash. */
const sameResource = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

// ---- Clients (RFC 7591)

export interface OAuthClient {
	clientId: string;
	name: string;
	redirectUris: string[];
	authMethod: AuthMethod;
	clientUri: string | null;
	createdAt: Date;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLoopback(u: URL) {
	return u.protocol === 'http:' && LOOPBACK.has(u.hostname);
}

/**
 * Redirect URIs a client may register: https, http on a loopback address (local clients such as
 * Claude Code), or a private-use scheme in reverse-domain form (RFC 8252 native apps). No fragments.
 */
function checkRedirectUri(value: string): string {
	let u: URL;
	try {
		u = new URL(value);
	} catch {
		throw new OAuthError('invalid_redirect_uri', `Not a URL: ${value}`);
	}
	if (u.hash) throw new OAuthError('invalid_redirect_uri', 'A redirect URI must not have a fragment.');
	const scheme = u.protocol.slice(0, -1);
	const ok =
		scheme === 'https' ||
		isLoopback(u) ||
		(/^[a-z][a-z0-9+-]*(\.[a-z0-9+-]+)+$/.test(scheme) && !['javascript', 'data', 'file'].includes(scheme));
	if (!ok) {
		throw new OAuthError(
			'invalid_redirect_uri',
			`Redirect URIs must use https, http on localhost, or an app's own scheme: ${value}`
		);
	}
	return value;
}

/** Register a client. Returns the RFC 7591 response, with the secret shown this once. */
export function registerClient(app: AppDatabase, body: unknown, now = new Date()) {
	const parsed = OAuthClientMetadataSchema.safeParse(body);
	if (!parsed.success) {
		throw new OAuthError('invalid_client_metadata', parsed.error.issues.map((i) => i.message).join('; '));
	}
	const m = parsed.data;
	if (m.redirect_uris.length === 0 || m.redirect_uris.length > 10) {
		throw new OAuthError('invalid_redirect_uri', 'Register between one and ten redirect URIs.');
	}
	const redirectUris = m.redirect_uris.map((u) => checkRedirectUri(String(u)));
	const method = (m.token_endpoint_auth_method ?? 'client_secret_basic') as AuthMethod;
	if (!AUTH_METHODS.includes(method)) {
		throw new OAuthError('invalid_client_metadata', `Unsupported token_endpoint_auth_method ${method}.`);
	}
	const grants = m.grant_types ?? ['authorization_code'];
	if (grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) {
		throw new OAuthError(
			'invalid_client_metadata',
			'Only authorization_code and refresh_token grants are supported.'
		);
	}
	if ((m.response_types ?? ['code']).some((r) => r !== 'code')) {
		throw new OAuthError('invalid_client_metadata', 'Only the code response type is supported.');
	}
	const name = (m.client_name ?? '').trim().slice(0, 80) || 'MCP client';
	const clientId = random(CLIENT_PREFIX);
	const secret = method === 'none' ? null : random(SECRET_PREFIX);
	const clientUri = m.client_uri ? String(m.client_uri) : null;
	app.sqlite
		.prepare(
			`INSERT INTO oauth_client (client_id, secret_hash, name, redirect_uris, auth_method, client_uri, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			clientId,
			secret ? sha256(secret) : null,
			name,
			JSON.stringify(redirectUris),
			method,
			clientUri,
			now.getTime()
		);
	return {
		client_id: clientId,
		...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
		client_id_issued_at: Math.floor(now.getTime() / 1000),
		client_name: name,
		redirect_uris: redirectUris,
		token_endpoint_auth_method: method,
		grant_types: grants,
		response_types: ['code'],
		...(clientUri ? { client_uri: clientUri } : {})
	};
}

interface ClientRow {
	client_id: string;
	secret_hash: string | null;
	name: string;
	redirect_uris: string;
	auth_method: AuthMethod;
	client_uri: string | null;
	created_at: number;
}

function clientRow(app: AppDatabase, clientId: string): ClientRow | undefined {
	return app.sqlite.prepare('SELECT * FROM oauth_client WHERE client_id = ?').get(clientId) as
		ClientRow | undefined;
}

export function getClient(app: AppDatabase, clientId: string | null | undefined): OAuthClient | null {
	const r = clientId ? clientRow(app, clientId) : undefined;
	if (!r) return null;
	return {
		clientId: r.client_id,
		name: r.name,
		redirectUris: JSON.parse(r.redirect_uris) as string[],
		authMethod: r.auth_method,
		clientUri: r.client_uri,
		createdAt: new Date(r.created_at)
	};
}

/**
 * Whether a redirect URI matches one the client registered: exactly, except that a loopback URI may
 * use any port (RFC 8252 7.3; Claude Code picks a free port each time).
 */
function matchRedirect(registered: string[], given: string): boolean {
	if (registered.includes(given)) return true;
	let g: URL;
	try {
		g = new URL(given);
	} catch {
		return false;
	}
	if (!isLoopback(g)) return false;
	return registered.some((r) => {
		const u = new URL(r);
		return isLoopback(u) && u.hostname === g.hostname && u.pathname === g.pathname && u.search === g.search;
	});
}

// ---- Authorization request

export interface AuthorizeRequest {
	client: OAuthClient;
	redirectUri: string;
	state: string | null;
	codeChallenge: string;
	resource: string;
	scope: string;
}

/**
 * An error to show on the page rather than send back: the client or redirect URI cannot be trusted,
 * so redirecting would make this server an open redirector (RFC 6749 4.1.2.1).
 */
export class AuthorizePageError extends Error {}

/** An error to send back to the client's redirect URI. */
export class AuthorizeRedirectError extends OAuthError {
	constructor(
		error: string,
		description: string,
		readonly redirectUri: string,
		readonly state: string | null,
		readonly issuer: string
	) {
		super(error, description);
	}

	location(): string {
		const u = new URL(this.redirectUri);
		u.searchParams.set('error', this.error);
		u.searchParams.set('error_description', this.description);
		if (this.state) u.searchParams.set('state', this.state);
		u.searchParams.set('iss', this.issuer);
		return u.toString();
	}
}

/** Check an authorization request. Run it on showing the consent page and again on approving. */
export function validateAuthorizeRequest(
	app: AppDatabase,
	params: URLSearchParams,
	origin: string
): AuthorizeRequest {
	const e = endpoints(origin);
	const client = getClient(app, params.get('client_id'));
	if (!client)
		throw new AuthorizePageError('This app is not registered with mcp-audit. Add the connector again.');
	const given = params.get('redirect_uri');
	let redirectUri: string;
	if (given) {
		if (!matchRedirect(client.redirectUris, given)) {
			throw new AuthorizePageError('The app asked to return to an address it did not register.');
		}
		redirectUri = given;
	} else if (client.redirectUris.length === 1) {
		redirectUri = client.redirectUris[0]!;
	} else {
		throw new AuthorizePageError('The app did not say where to return to.');
	}
	const state = params.get('state');
	const fail = (error: string, description: string) =>
		new AuthorizeRedirectError(error, description, redirectUri, state, e.issuer);

	if (params.get('response_type') !== 'code')
		throw fail('unsupported_response_type', 'Only response_type=code is supported.');
	const challenge = params.get('code_challenge') ?? '';
	if (!challenge) throw fail('invalid_request', 'PKCE is required: send code_challenge with method S256.');
	if (params.get('code_challenge_method') !== 'S256') {
		throw fail('invalid_request', 'Only the S256 code challenge method is supported.');
	}
	if (!/^[A-Za-z0-9_-]{43}$/.test(challenge))
		throw fail('invalid_request', 'The code challenge is not an S256 value.');
	const resource = params.get('resource') ?? e.resource;
	if (!sameResource(resource, e.resource)) {
		throw fail('invalid_target', `This server only grants access to ${e.resource}.`);
	}
	return { client, redirectUri, state, codeChallenge: challenge, resource: e.resource, scope: SCOPE };
}

/** The person approved: issue a one-time code and return where to send the browser. */
export function approveAuthorization(
	app: AppDatabase,
	actor: Actor,
	req: AuthorizeRequest,
	origin: string,
	now = new Date()
): string {
	if (actor.channel !== 'ui' || actor.agent) throw new ForbiddenError('Only a person can approve an app.');
	const code = randomBytes(32).toString('base64url');
	app.sqlite
		.prepare(
			`INSERT INTO oauth_code (code_hash, client_id, user_id, redirect_uri, code_challenge, resource, scope, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			sha256(code),
			req.client.clientId,
			actor.userId,
			req.redirectUri,
			req.codeChallenge,
			req.resource,
			req.scope,
			now.getTime() + CODE_TTL_MS
		);
	const u = new URL(req.redirectUri);
	u.searchParams.set('code', code);
	if (req.state) u.searchParams.set('state', req.state);
	u.searchParams.set('iss', endpoints(origin).issuer);
	return u.toString();
}

export function denyAuthorization(req: AuthorizeRequest, origin: string): string {
	return new AuthorizeRedirectError(
		'access_denied',
		'The person declined.',
		req.redirectUri,
		req.state,
		endpoints(origin).issuer
	).location();
}

// ---- Token endpoint

export interface ClientCredentials {
	clientId: string | null;
	clientSecret: string | null;
	/** How the credentials came: in the form body, or in an HTTP Basic header. */
	via: 'post' | 'basic' | 'none';
}

/** Read client credentials from a Basic header or the form (RFC 6749 2.3.1). */
export function clientCredentials(request: Request, form: URLSearchParams): ClientCredentials {
	const header = request.headers.get('authorization') ?? '';
	const basic = /^Basic\s+(.+)$/i.exec(header);
	if (basic) {
		const decoded = Buffer.from(basic[1]!, 'base64').toString('utf8');
		const i = decoded.indexOf(':');
		const unescape = (v: string) => {
			try {
				return decodeURIComponent(v.replace(/\+/g, ' '));
			} catch {
				return v;
			}
		};
		if (i > 0) {
			return {
				clientId: unescape(decoded.slice(0, i)),
				clientSecret: unescape(decoded.slice(i + 1)),
				via: 'basic'
			};
		}
	}
	const secret = form.get('client_secret');
	return { clientId: form.get('client_id'), clientSecret: secret, via: secret ? 'post' : 'none' };
}

function safeEqualHex(a: string, b: string): boolean {
	const x = Buffer.from(a, 'hex');
	const y = Buffer.from(b, 'hex');
	return x.length === y.length && timingSafeEqual(x, y);
}

/** Authenticate the client as it registered: public clients have no secret; others must send theirs. */
function authenticateClient(app: AppDatabase, creds: ClientCredentials): ClientRow {
	const row = creds.clientId ? clientRow(app, creds.clientId) : undefined;
	if (!row) throw new OAuthError('invalid_client', 'Unknown client.', 401);
	if (row.auth_method === 'none') {
		if (creds.clientSecret) throw new OAuthError('invalid_client', 'This client has no secret.', 401);
		return row;
	}
	if (!creds.clientSecret || !row.secret_hash || !safeEqualHex(sha256(creds.clientSecret), row.secret_hash)) {
		throw new OAuthError('invalid_client', 'Client authentication failed.', 401);
	}
	return row;
}

export interface TokenResponse {
	access_token: string;
	token_type: 'Bearer';
	expires_in: number;
	refresh_token: string;
	scope: string;
}

function userActive(app: AppDatabase, userId: string): boolean {
	const u = app.sqlite.prepare('SELECT active, deleted FROM "user" WHERE id = ?').get(userId) as
		{ active: number; deleted: number } | undefined;
	return !!u && u.active === 1 && u.deleted !== 1;
}

function issueTokens(
	app: AppDatabase,
	grant: { grantId: string; clientId: string; userId: string; resource: string; scope: string },
	now: Date
): TokenResponse {
	const access = random(ACCESS_PREFIX);
	const refresh = random(REFRESH_PREFIX);
	const t = now.getTime();
	app.sqlite
		.prepare(
			`INSERT INTO oauth_token (id, grant_id, client_id, user_id, access_hash, refresh_hash, resource, scope,
			                          access_expires_at, refresh_expires_at, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			randomUUID(),
			grant.grantId,
			grant.clientId,
			grant.userId,
			sha256(access),
			sha256(refresh),
			grant.resource,
			grant.scope,
			t + ACCESS_TTL_MS,
			t + REFRESH_TTL_MS,
			t
		);
	return {
		access_token: access,
		token_type: 'Bearer',
		expires_in: Math.floor(ACCESS_TTL_MS / 1000),
		refresh_token: refresh,
		scope: grant.scope
	};
}

function revokeGrantRows(app: AppDatabase, grantId: string, now: Date): void {
	app.sqlite
		.prepare('UPDATE oauth_token SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL')
		.run(now.getTime(), grantId);
}

/** A spent code or refresh token was presented again: the grant it belongs to is revoked. */
class ReuseError extends OAuthError {
	constructor(
		description: string,
		readonly grantId: string | null
	) {
		super('invalid_grant', description);
	}
}

/** Run a token transaction; on reuse, revoke the grant once the transaction has rolled back. */
function revokingOnReuse<T>(app: AppDatabase, now: Date, fn: () => T): T {
	try {
		return app.sqlite.transaction(fn)();
	} catch (e) {
		if (e instanceof ReuseError && e.grantId) revokeGrantRows(app, e.grantId, now);
		throw e;
	}
}

/** The PKCE check: base64url(SHA-256(verifier)) must equal the challenge (RFC 7636 4.6). */
export function pkceMatches(verifier: string, challenge: string): boolean {
	if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
	return createHash('sha256').update(verifier).digest('base64url') === challenge;
}

/** grant_type=authorization_code */
export function exchangeCode(
	app: AppDatabase,
	creds: ClientCredentials,
	form: URLSearchParams,
	origin: string,
	now = new Date()
): TokenResponse {
	const client = authenticateClient(app, creds);
	const code = form.get('code');
	const verifier = form.get('code_verifier');
	if (!code || !verifier) throw new OAuthError('invalid_request', 'Send code and code_verifier.');
	return revokingOnReuse(app, now, () => {
		const row = app.sqlite.prepare('SELECT * FROM oauth_code WHERE code_hash = ?').get(sha256(code)) as
			| {
					client_id: string;
					user_id: string;
					redirect_uri: string;
					code_challenge: string;
					resource: string;
					scope: string;
					expires_at: number;
					used_at: number | null;
					grant_id: string | null;
					code_hash: string;
			  }
			| undefined;
		if (!row || row.client_id !== client.client_id)
			throw new OAuthError('invalid_grant', 'Unknown authorization code.');
		if (row.used_at) {
			// A code used twice may have been stolen: end what the first use gave (RFC 6749 4.1.2).
			// Revoked after the transaction, which this error rolls back.
			throw new ReuseError('This authorization code was already used.', row.grant_id);
		}
		if (row.expires_at <= now.getTime())
			throw new OAuthError('invalid_grant', 'The authorization code expired.');
		const redirect = form.get('redirect_uri');
		if (redirect !== null && redirect !== row.redirect_uri) {
			throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request.');
		}
		if (!pkceMatches(verifier, row.code_challenge))
			throw new OAuthError('invalid_grant', 'PKCE verification failed.');
		const resource = form.get('resource');
		if (resource && !sameResource(resource, endpoints(origin).resource)) {
			throw new OAuthError('invalid_target', 'The resource does not match the authorization request.');
		}
		if (!userActive(app, row.user_id))
			throw new OAuthError('invalid_grant', 'The account is no longer active.');
		const grantId = randomUUID();
		app.sqlite
			.prepare('UPDATE oauth_code SET used_at = ?, grant_id = ? WHERE code_hash = ?')
			.run(now.getTime(), grantId, row.code_hash);
		return issueTokens(
			app,
			{ grantId, clientId: client.client_id, userId: row.user_id, resource: row.resource, scope: row.scope },
			now
		);
	});
}

interface TokenRow {
	id: string;
	grant_id: string;
	client_id: string;
	user_id: string;
	resource: string;
	scope: string;
	access_expires_at: number;
	refresh_expires_at: number;
	rotated_at: number | null;
	revoked_at: number | null;
}

/** grant_type=refresh_token. Each refresh token works once; reusing one revokes the whole grant. */
export function refreshTokens(
	app: AppDatabase,
	creds: ClientCredentials,
	form: URLSearchParams,
	origin: string,
	now = new Date()
): TokenResponse {
	const client = authenticateClient(app, creds);
	const refresh = form.get('refresh_token');
	if (!refresh) throw new OAuthError('invalid_request', 'Send refresh_token.');
	return revokingOnReuse(app, now, () => {
		const row = app.sqlite
			.prepare('SELECT * FROM oauth_token WHERE refresh_hash = ?')
			.get(sha256(refresh)) as TokenRow | undefined;
		if (!row || row.client_id !== client.client_id)
			throw new OAuthError('invalid_grant', 'Unknown refresh token.');
		if (row.revoked_at) throw new OAuthError('invalid_grant', 'Access for this app was revoked.');
		if (row.rotated_at) {
			throw new ReuseError(
				'This refresh token was already used; the app has to sign in again.',
				row.grant_id
			);
		}
		if (row.refresh_expires_at <= now.getTime())
			throw new OAuthError('invalid_grant', 'The refresh token expired.');
		const resource = form.get('resource');
		if (resource && !sameResource(resource, endpoints(origin).resource)) {
			throw new OAuthError('invalid_target', 'The resource does not match the grant.');
		}
		if (!userActive(app, row.user_id))
			throw new OAuthError('invalid_grant', 'The account is no longer active.');
		app.sqlite.prepare('UPDATE oauth_token SET rotated_at = ? WHERE id = ?').run(now.getTime(), row.id);
		return issueTokens(
			app,
			{
				grantId: row.grant_id,
				clientId: row.client_id,
				userId: row.user_id,
				resource: row.resource,
				scope: row.scope
			},
			now
		);
	});
}

/** RFC 7009: revoke the grant behind an access or refresh token. Unknown tokens are not an error. */
export function revokeToken(
	app: AppDatabase,
	creds: ClientCredentials,
	token: string | null,
	now = new Date()
): void {
	const client = authenticateClient(app, creds);
	if (!token) throw new OAuthError('invalid_request', 'Send token.');
	const hash = sha256(token);
	const row = app.sqlite
		.prepare('SELECT grant_id, client_id FROM oauth_token WHERE access_hash = ? OR refresh_hash = ?')
		.get(hash, hash) as { grant_id: string; client_id: string } | undefined;
	if (row && row.client_id === client.client_id) revokeGrantRows(app, row.grant_id, now);
}

// ---- Using an access token on /mcp

/**
 * The person and app behind an OAuth access token, or null if it is unknown, expired, revoked, issued
 * for another resource, or its person is no longer active.
 */
export function resolveAccessToken(
	app: AppDatabase,
	token: string | null | undefined,
	origin: string,
	now = new Date()
): { user: SessionUser; clientName: string; grantId: string } | null {
	if (!token || !token.startsWith(ACCESS_PREFIX)) return null;
	const row = app.sqlite
		.prepare(
			`SELECT t.id AS token_id, t.grant_id, t.resource, t.access_expires_at, t.revoked_at, c.name AS client_name,
			        u.id, u.name, u.email, u.role, u.active, u.deleted, uc.must_change_password
			   FROM oauth_token t JOIN oauth_client c ON c.client_id = t.client_id
			   JOIN "user" u ON u.id = t.user_id LEFT JOIN user_credential uc ON uc.user_id = u.id
			  WHERE t.access_hash = ?`
		)
		.get(sha256(token)) as
		| {
				token_id: string;
				grant_id: string;
				resource: string;
				access_expires_at: number;
				revoked_at: number | null;
				client_name: string;
				id: string;
				name: string;
				email: string;
				role: UserRole;
				active: number;
				deleted: number;
				must_change_password: number | null;
		  }
		| undefined;
	if (!row || row.revoked_at || row.access_expires_at <= now.getTime()) return null;
	if (row.active !== 1 || row.deleted === 1) return null;
	if (!sameResource(row.resource, endpoints(origin).resource)) return null;
	app.sqlite.prepare('UPDATE oauth_token SET last_used_at = ? WHERE id = ?').run(now.getTime(), row.token_id);
	return {
		user: {
			id: row.id,
			name: row.name,
			email: row.email,
			role: row.role,
			mustChangePassword: row.must_change_password === 1
		},
		clientName: row.client_name,
		grantId: row.grant_id
	};
}

// ---- Connected apps (Settings, Access tokens)

export interface ConnectedApp {
	grantId: string;
	clientName: string;
	clientUri: string | null;
	connectedAt: Date;
	lastUsedAt: Date | null;
}

/** The apps a person approved and that can still refresh their access. */
export function listConnectedApps(app: AppDatabase, userId: string, now = new Date()): ConnectedApp[] {
	const rows = app.sqlite
		.prepare(
			`SELECT t.grant_id, c.name, c.client_uri, MIN(t.created_at) AS connected_at, MAX(t.last_used_at) AS last_used_at
			   FROM oauth_token t JOIN oauth_client c ON c.client_id = t.client_id
			  WHERE t.user_id = ?
			  GROUP BY t.grant_id
			 HAVING SUM(CASE WHEN t.revoked_at IS NULL AND t.rotated_at IS NULL AND t.refresh_expires_at > ? THEN 1 ELSE 0 END) > 0
			  ORDER BY connected_at DESC`
		)
		.all(userId, now.getTime()) as {
		grant_id: string;
		name: string;
		client_uri: string | null;
		connected_at: number;
		last_used_at: number | null;
	}[];
	return rows.map((r) => ({
		grantId: r.grant_id,
		clientName: r.name,
		clientUri: r.client_uri,
		connectedAt: new Date(r.connected_at),
		lastUsedAt: r.last_used_at ? new Date(r.last_used_at) : null
	}));
}

/** Disconnect an app: its owner or an admin. Its access and refresh tokens stop working at once. */
export function revokeConnectedApp(app: AppDatabase, actor: Actor, grantId: string, now = new Date()): void {
	const row = app.sqlite
		.prepare('SELECT user_id FROM oauth_token WHERE grant_id = ? LIMIT 1')
		.get(grantId) as { user_id: string } | undefined;
	if (!row) throw new NotFoundError('Connected app not found');
	if (row.user_id !== actor.userId) {
		const me = app.sqlite.prepare('SELECT role FROM "user" WHERE id = ?').get(actor.userId) as
			{ role: string } | undefined;
		if (me?.role !== 'admin') throw new ForbiddenError('You can only disconnect your own apps.');
	}
	revokeGrantRows(app, grantId, now);
}

/** When a person is deactivated, every app they connected loses access. */
export function revokeAllConnectedApps(app: AppDatabase, userId: string, now = new Date()): void {
	app.sqlite
		.prepare('UPDATE oauth_token SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
		.run(now.getTime(), userId);
}
