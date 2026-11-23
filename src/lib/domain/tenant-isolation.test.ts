import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { sessionCookieOptions } from '#lib/server/http.ts';
import { SoftAuthenticator } from '../../../tests/fixtures/soft-authenticator';
import './entities';
import { createSession, login, validateSession } from './auth';
import { TooManyAttemptsError, UnauthenticatedError } from './errors';
import {
	finishPasskeyRegistration,
	finishPasskeySignIn,
	relyingParty,
	startPasskeyRegistration,
	startPasskeySignIn
} from './passkeys';
import { POLICIES, addressKey, assertNotLocked, recordFailure } from './throttle';
import { createFirstAdmin } from './users';

/**
 * #99: two tenants are two instances with a database each, at sibling names under one domain. What
 * belongs to one must be worth nothing at the other. (An assistant's connection, an access token
 * and the operator's token across instances are in mcp-connections.test.ts and
 * src/lib/server/operator-http.test.ts.)
 */
const A = 'https://mcpaudit-acme.example.test';
const B = 'https://mcpaudit-bolt.example.test';
const rpA = relyingParty(A, {});
const rpB = relyingParty(B, {});
const PASSWORD = 'correct horse battery';

let a: AppDatabase;
let b: AppDatabase;
let adaAtA: string;
let adaAtB: string;

beforeEach(async () => {
	a = createTestDatabase();
	b = createTestDatabase();
	// The same person, with the same address, works for both firms.
	adaAtA = (await createFirstAdmin(a, { name: 'Ada', email: 'ada@example.test', password: PASSWORD })).id;
	adaAtB = (await createFirstAdmin(b, { name: 'Ada', email: 'ada@example.test', password: PASSWORD })).id;
});
afterEach(() => {
	a.close();
	b.close();
});

describe('a session belongs to one tenant', () => {
	it('is refused by another', () => {
		const { token } = createSession(a, adaAtA);
		expect(validateSession(a, token)?.user.name).toBe('Ada');
		expect(validateSession(b, token)).toBeNull();
	});

	it('its cookie is set for the instance’s own host name only, never for the domain above it', () => {
		const options = sessionCookieOptions({ url: new URL(`${A}/`) }, new Date(Date.now() + 1000));
		// No Domain attribute: the browser then sends the cookie to this exact host and to no sibling.
		expect(Object.keys(options).sort()).toEqual(['expires', 'httpOnly', 'path', 'sameSite', 'secure']);
		expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
	});
});

describe('a passkey belongs to one tenant', () => {
	async function passkeyAtA() {
		const device = new SoftAuthenticator();
		const start = await startPasskeyRegistration(a, adaAtA, rpA);
		await finishPasskeyRegistration(a, adaAtA, start.token, device.register(start.options, A), rpA, 'Laptop');
		return device;
	}

	it('is named after the instance’s own host, not the domain the tenants share', () => {
		expect(rpA.id).toBe('mcpaudit-acme.example.test');
		expect(rpB.id).toBe('mcpaudit-bolt.example.test');
	});

	it('signs in at the tenant it was made for and is unknown at another', async () => {
		const device = await passkeyAtA();
		const atA = await startPasskeySignIn(a, rpA);
		expect((await finishPasskeySignIn(a, atA.token, device.signIn(atA.options, A), rpA)).user.name).toBe(
			'Ada'
		);

		// A browser would not even offer it at B. If something did present it there:
		const atB = await startPasskeySignIn(b, rpB);
		await expect(finishPasskeySignIn(b, atB.token, device.signIn(atB.options, B), rpB)).rejects.toThrow(
			UnauthenticatedError
		);
	});

	it('is refused at another tenant even when its record was copied there', async () => {
		const device = await passkeyAtA();
		// The worst case: B's database holds A's passkey record, for the same person.
		const row = a.sqlite.prepare('SELECT * FROM passkey').get() as Record<string, unknown>;
		const copy = { ...row, user_id: adaAtB };
		const columns = Object.keys(copy);
		b.sqlite
			.prepare(`INSERT INTO passkey (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
			.run(...Object.values(copy));

		// An answer made at A's address, replayed to B with B's own challenge: the address is wrong.
		const atB = await startPasskeySignIn(b, rpB);
		await expect(
			finishPasskeySignIn(b, atB.token, device.signIn(atB.options, A, { rpId: rpA.id }), rpB)
		).rejects.toThrow(UnauthenticatedError);
		// Sent from B's own page but made for A's name: the name is wrong.
		const again = await startPasskeySignIn(b, rpB);
		await expect(
			finishPasskeySignIn(b, again.token, device.signIn(again.options, B, { rpId: rpA.id }), rpB)
		).rejects.toThrow(UnauthenticatedError);
		// And an answer to A's challenge is no answer to B's.
		const atA = await startPasskeySignIn(a, rpA);
		const last = await startPasskeySignIn(b, rpB);
		await expect(finishPasskeySignIn(b, last.token, device.signIn(atA.options, A), rpB)).rejects.toThrow(
			UnauthenticatedError
		);
	});
});

describe('lock-outs and limits belong to one tenant', () => {
	it('an address locked out of A is not locked out of B', () => {
		const key = addressKey('token', '198.51.100.7');
		for (let i = 0; i < POLICIES.token.max; i++) recordFailure(a, key, POLICIES.token);
		expect(() => assertNotLocked(a, [key])).toThrow(TooManyAttemptsError);
		expect(() => assertNotLocked(b, [key])).not.toThrow();
	});

	it('wrong passwords for a person at A do not lock the same person out of B', async () => {
		for (let i = 0; i < POLICIES.account.max; i++)
			await expect(
				login(a, 'ada@example.test', 'wrong password', new Date(), '198.51.100.7')
			).rejects.toThrow();
		await expect(login(a, 'ada@example.test', PASSWORD, new Date(), '198.51.100.7')).rejects.toThrow(
			TooManyAttemptsError
		);
		expect((await login(b, 'ada@example.test', PASSWORD, new Date(), '198.51.100.7')).user.name).toBe('Ada');
	});
});
