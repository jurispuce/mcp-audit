import { createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { SoftAuthenticator } from '../../../tests/fixtures/soft-authenticator';
import './entities';
import {
	RECHECK_MINUTES,
	RecheckNeededError,
	authenticateBearer,
	createPersonalTokenInSession,
	createSession,
	recentlyVerified,
	validateSession
} from './auth';
import { TooManyAttemptsError, UnauthenticatedError, ValidationError } from './errors';
import {
	OAuthError,
	approveAuthorization,
	authorizationServerMetadata,
	exchangeCode,
	refreshTokens,
	registerClient,
	resolveAccessToken,
	validateAuthorizeRequest
} from './oauth';
import {
	finishPasskeyConfirm,
	finishPasskeyRegistration,
	relyingParty,
	startPasskeyConfirm,
	startPasskeyRegistration
} from './passkeys';
import { createFirstAdmin, createUser } from './users';
import type { Actor } from './write';

/** #93: a fresh proof before a token is created, and connections that belong to one instance only. */

const ORIGIN = 'https://audit-a.example.test';
const OTHER = 'https://audit-b.example.test';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const T0 = new Date('2026-11-22T10:00:00Z');
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const rp = relyingParty(ORIGIN, {});

interface Instance {
	app: AppDatabase;
	actor: Actor;
	benId: string;
}
let a: Instance;
let b: Instance;

async function instance(): Promise<Instance> {
	const app = createTestDatabase();
	const admin = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	const actor: Actor = { userId: admin.id, channel: 'ui' };
	const ben = (await createUser(app, actor, { name: 'Ben', email: 'ben@example.test' })).user;
	return { app, actor, benId: ben.id };
}

beforeEach(async () => {
	a = await instance();
	b = await instance();
});
afterEach(() => {
	a.app.close();
	b.app.close();
});

function sessionOf(i: Instance, userId = i.actor.userId, now = T0) {
	const s = createSession(i.app, userId, now);
	return validateSession(i.app, s.token, now)!.sessionId;
}

async function addPasskey(i: Instance, userId: string, device: SoftAuthenticator, now = T0) {
	const start = await startPasskeyRegistration(i.app, userId, rp, now);
	await finishPasskeyRegistration(
		i.app,
		userId,
		start.token,
		device.register(start.options, ORIGIN),
		rp,
		'Laptop',
		now
	);
}

describe('creating a personal access token (#93)', () => {
	it('works within 5 minutes of signing in, and not after', () => {
		const session = sessionOf(a);
		expect(
			createPersonalTokenInSession(a.app, a.actor, session, 'Claude Code', later(RECHECK_MINUTES)).token
		).toMatch(/^mcpa_/);
		expect(recentlyVerified(a.app, session, later(RECHECK_MINUTES + 1))).toBe(false);
		expect(() => createPersonalTokenInSession(a.app, a.actor, session, 'Claude Code', later(6))).toThrow(
			RecheckNeededError
		);
		// Without a session there is nothing that was proven.
		expect(() => createPersonalTokenInSession(a.app, a.actor, null, 'Claude Code', T0)).toThrow(
			RecheckNeededError
		);
		expect(() => createPersonalTokenInSession(a.app, a.actor, 'no-such-session', 'Claude Code', T0)).toThrow(
			RecheckNeededError
		);
	});

	it('works again once the passkey was asked for, in that session only', async () => {
		const device = new SoftAuthenticator();
		await addPasskey(a, a.actor.userId, device);
		const session = sessionOf(a);
		const otherSession = sessionOf(a);

		const start = await startPasskeyConfirm(a.app, a.actor.userId, rp, later(30));
		// Only the person's own passkeys are offered.
		expect(start.options.allowCredentials).toHaveLength(1);
		await finishPasskeyConfirm(
			a.app,
			a.actor.userId,
			session,
			start.token,
			device.signIn(start.options, ORIGIN),
			rp,
			later(30)
		);
		expect(createPersonalTokenInSession(a.app, a.actor, session, 'Claude Code', later(34)).token).toMatch(
			/^mcpa_/
		);
		expect(() => createPersonalTokenInSession(a.app, a.actor, otherSession, 'x', later(34))).toThrow(
			RecheckNeededError
		);
		// And it wears off like a sign-in does.
		expect(() => createPersonalTokenInSession(a.app, a.actor, session, 'x', later(36))).toThrow(
			RecheckNeededError
		);
	});

	it('takes only the person’s own passkey, once, made for this instance', async () => {
		const mine = new SoftAuthenticator();
		const bens = new SoftAuthenticator();
		await addPasskey(a, a.actor.userId, mine);
		await addPasskey(a, a.benId, bens);
		const session = sessionOf(a);
		const refuse = async (
			answer: (s: Awaited<ReturnType<typeof startPasskeyConfirm>>) => ReturnType<SoftAuthenticator['signIn']>
		) => {
			const start = await startPasskeyConfirm(a.app, a.actor.userId, rp, later(30));
			await expect(
				finishPasskeyConfirm(a.app, a.actor.userId, session, start.token, answer(start), rp, later(30))
			).rejects.toThrow(UnauthenticatedError);
			expect(recentlyVerified(a.app, session, later(30))).toBe(false);
		};
		await refuse((s) => bens.signIn(s.options, ORIGIN));
		await refuse((s) => mine.signIn(s.options, OTHER));
		await refuse((s) => mine.signIn(s.options, ORIGIN, { verified: false }));

		// An answer works once.
		const start = await startPasskeyConfirm(a.app, a.actor.userId, rp, later(30));
		const answer = mine.signIn(start.options, ORIGIN);
		await finishPasskeyConfirm(a.app, a.actor.userId, session, start.token, answer, rp, later(30));
		await expect(
			finishPasskeyConfirm(a.app, a.actor.userId, session, start.token, answer, rp, later(31))
		).rejects.toThrow(ValidationError);

		// Someone without a passkey is told to sign in again; wrong answers lock like wrong passwords.
		await expect(startPasskeyConfirm(b.app, b.actor.userId, rp, T0)).rejects.toThrow('Sign in again instead');
		for (let i = 0; i < 2; i++) {
			const again = await startPasskeyConfirm(a.app, a.actor.userId, rp, later(40));
			await expect(
				finishPasskeyConfirm(
					a.app,
					a.actor.userId,
					session,
					again.token,
					bens.signIn(again.options, ORIGIN),
					rp,
					later(40)
				)
			).rejects.toThrow(UnauthenticatedError);
		}
		await expect(
			startPasskeyConfirm(a.app, a.actor.userId, rp, later(30)).then((s) =>
				finishPasskeyConfirm(
					a.app,
					a.actor.userId,
					session,
					s.token,
					mine.signIn(s.options, ORIGIN),
					rp,
					later(30)
				)
			)
		).rejects.toThrow(TooManyAttemptsError);
	});
});

describe('each instance is its own issuer (#93)', () => {
	function pkce() {
		const verifier = randomBytes(32).toString('base64url');
		return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
	}
	const noSecret = (clientId: string) => ({ clientId, clientSecret: null, via: 'none' as const });

	/** Claude registers at instance A and Ada approves there. */
	function authorizeAtA() {
		const client = registerClient(a.app, {
			client_name: 'Claude',
			redirect_uris: [CLAUDE],
			token_endpoint_auth_method: 'none'
		});
		const { verifier, challenge } = pkce();
		const req = validateAuthorizeRequest(
			a.app,
			new URLSearchParams({
				response_type: 'code',
				client_id: client.client_id,
				redirect_uri: CLAUDE,
				code_challenge: challenge,
				code_challenge_method: 'S256',
				state: 's',
				resource: `${ORIGIN}/mcp`
			}),
			ORIGIN
		);
		const location = new URL(approveAuthorization(a.app, a.actor, req, ORIGIN));
		const form = new URLSearchParams({
			grant_type: 'authorization_code',
			code: location.searchParams.get('code')!,
			code_verifier: verifier,
			redirect_uri: CLAUDE
		});
		return { client, location, form };
	}

	it('names itself by its own address', () => {
		expect(authorizationServerMetadata(ORIGIN).issuer).toBe(ORIGIN);
		expect(authorizationServerMetadata(OTHER).issuer).toBe(OTHER);
		expect(authorizeAtA().location.searchParams.get('iss')).toBe(ORIGIN);
	});

	it('refuses a client, an authorization code and tokens that another instance issued', () => {
		const { client, form } = authorizeAtA();
		// Instance B never heard of the client, so the code is worth nothing there.
		expect(() => exchangeCode(b.app, noSecret(client.client_id), form, OTHER)).toThrow(OAuthError);
		expect(() =>
			validateAuthorizeRequest(
				b.app,
				new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: CLAUDE }),
				OTHER
			)
		).toThrow();

		const tokens = exchangeCode(a.app, noSecret(client.client_id), form, ORIGIN);
		expect(resolveAccessToken(a.app, tokens.access_token, ORIGIN)?.user.name).toBe('Ada');
		expect(resolveAccessToken(b.app, tokens.access_token, OTHER)).toBeNull();
		expect(() =>
			refreshTokens(
				b.app,
				noSecret(client.client_id),
				new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token! }),
				OTHER
			)
		).toThrow(OAuthError);
		// Even the same database answers only at the address the connection was made for.
		expect(resolveAccessToken(a.app, tokens.access_token, OTHER)).toBeNull();
	});

	it('refuses a personal access token from another instance', () => {
		const { token } = createPersonalTokenInSession(a.app, a.actor, sessionOf(a), 'Claude Code', T0);
		const request = new Request(`${OTHER}/mcp`, { headers: { authorization: `Bearer ${token}` } });
		expect(authenticateBearer(a.app, request)?.user.name).toBe('Ada');
		expect(authenticateBearer(b.app, request)).toBeNull();
	});
});
