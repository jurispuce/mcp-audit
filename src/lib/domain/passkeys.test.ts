import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { SoftAuthenticator } from '../../../tests/fixtures/soft-authenticator';
import './entities';
import { validateSession } from './auth';
import { NotFoundError, TooManyAttemptsError, UnauthenticatedError, ValidationError } from './errors';
import { getItemHistory } from './items';
import {
	finishPasskeyRegistration,
	finishPasskeySignIn,
	listPasskeys,
	passkeysPossible,
	relyingParty,
	removePasskey,
	renamePasskey,
	startPasskeyRegistration,
	startPasskeySignIn
} from './passkeys';
import { createFirstAdmin, createUser, getUser, setUserActive } from './users';
import type { Actor } from './write';

let app: AppDatabase;
let admin: Actor;
let userId: string;
const ORIGIN = 'https://audit.example.test';
const rp = relyingParty(ORIGIN, { INSTANCE_NAME: 'Baltic Audit' });

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	admin = { userId: a.id, channel: 'ui' };
	userId = a.id;
});
afterEach(() => app.close());

async function addPasskey(device: SoftAuthenticator, name = 'MacBook', forUser = userId) {
	const start = await startPasskeyRegistration(app, forUser, rp);
	return finishPasskeyRegistration(
		app,
		forUser,
		start.token,
		device.register(start.options, ORIGIN),
		rp,
		name
	);
}

async function signIn(device: SoftAuthenticator, address = '203.0.113.5', now = new Date()) {
	const start = await startPasskeySignIn(app, rp, now);
	return finishPasskeySignIn(app, start.token, device.signIn(start.options, ORIGIN), rp, now, address);
}

describe('where passkeys work (#87)', () => {
	it('over https with a host name, or on localhost; the relying party is the host name', () => {
		expect(rp).toEqual({ id: 'audit.example.test', origin: ORIGIN, name: 'Baltic Audit' });
		expect(passkeysPossible('https://audit.example.test')).toBe(true);
		expect(passkeysPossible('http://localhost:5173')).toBe(true);
		expect(passkeysPossible('http://audit.lan:3000')).toBe(false);
		expect(passkeysPossible('http://127.0.0.1:3000')).toBe(false);
		expect(passkeysPossible('https://192.168.1.20')).toBe(false);
		expect(relyingParty('http://localhost:5173', {})).toMatchObject({ id: 'localhost', name: 'mcp-audit' });
	});

	it('refuses to start where a passkey cannot exist', async () => {
		const lan = relyingParty('http://audit.lan:3000', {});
		await expect(startPasskeyRegistration(app, userId, lan)).rejects.toThrow(
			'Passkeys need the app at an https'
		);
		await expect(startPasskeySignIn(app, lan)).rejects.toThrow(ValidationError);
	});
});

describe('adding a passkey (#87)', () => {
	it('asks the device to verify the person and to keep a discoverable passkey for this host', async () => {
		const { options } = await startPasskeyRegistration(app, userId, rp);
		expect(options.rp).toEqual({ id: 'audit.example.test', name: 'Baltic Audit' });
		expect(options.user).toMatchObject({ name: 'ada@example.test', displayName: 'Ada' });
		expect(options.authenticatorSelection).toMatchObject({
			residentKey: 'required',
			userVerification: 'required'
		});
		expect(options.attestation).toBe('none');
	});

	it('stores the passkey, lists it, and records the addition in the history without key material', async () => {
		const device = new SoftAuthenticator();
		const p = await addPasskey(device);
		expect(p).toMatchObject({ name: 'MacBook', lastUsedAt: null });
		expect(listPasskeys(app, userId).map((x) => x.name)).toEqual(['MacBook']);
		expect(getUser(app, userId).passkeys).toBe(1);
		const history = getItemHistory(app, 'user', userId);
		expect(history[0]!.note).toBe('Passkey added: MacBook');
		const revisions = app.sqlite.prepare('SELECT snapshot FROM revision').all() as { snapshot: string }[];
		expect(revisions.some((r) => r.snapshot.includes(device.id))).toBe(false);
		expect(JSON.stringify(listPasskeys(app, userId))).not.toContain(device.id);

		// A second device; the first is excluded so it is not added twice.
		const start = await startPasskeyRegistration(app, userId, rp);
		expect(start.options.excludeCredentials?.map((c) => c.id)).toEqual([device.id]);
		await addPasskey(new SoftAuthenticator(), '');
		expect(listPasskeys(app, userId).map((x) => x.name)).toEqual(['MacBook', 'Passkey 2']);
	});

	it('refuses an answer for another address, a reused or foreign challenge, an unverified person, a duplicate', async () => {
		const device = new SoftAuthenticator();
		// Made on a look-alike site.
		let start = await startPasskeyRegistration(app, userId, rp);
		await expect(
			finishPasskeyRegistration(
				app,
				userId,
				start.token,
				device.register(start.options, 'https://audit.example.test.evil.example'),
				rp,
				'x'
			)
		).rejects.toThrow('The passkey could not be added.');
		// The challenge was used up by that attempt.
		await expect(
			finishPasskeyRegistration(app, userId, start.token, device.register(start.options, ORIGIN), rp, 'x')
		).rejects.toThrow('That took too long, or was already used.');
		// A device that did not check who is holding it.
		start = await startPasskeyRegistration(app, userId, rp);
		await expect(
			finishPasskeyRegistration(
				app,
				userId,
				start.token,
				device.register(start.options, ORIGIN, { verified: false }),
				rp,
				'x'
			)
		).rejects.toThrow('The passkey could not be added.');
		// Someone else's challenge.
		const { user: bo } = await createUser(app, admin, { name: 'Bo', email: 'bo@example.test' });
		start = await startPasskeyRegistration(app, bo.id, rp);
		await expect(
			finishPasskeyRegistration(app, userId, start.token, device.register(start.options, ORIGIN), rp, 'x')
		).rejects.toThrow('That took too long, or was already used.');
		// Too late.
		const then = new Date('2026-11-21T10:00:00Z');
		start = await startPasskeyRegistration(app, userId, rp, then);
		await expect(
			finishPasskeyRegistration(
				app,
				userId,
				start.token,
				device.register(start.options, ORIGIN),
				rp,
				'x',
				new Date(then.getTime() + 6 * 60_000)
			)
		).rejects.toThrow('That took too long');
		expect(listPasskeys(app, userId)).toEqual([]);

		// The same passkey cannot sit on two accounts.
		await addPasskey(device);
		start = await startPasskeyRegistration(app, bo.id, rp);
		await expect(
			finishPasskeyRegistration(app, bo.id, start.token, device.register(start.options, ORIGIN), rp, 'x')
		).rejects.toThrow('already on an account');
	});
});

describe('signing in with a passkey (#87)', () => {
	it('starts a session for the person the passkey belongs to, with no email typed', async () => {
		const device = new SoftAuthenticator();
		await addPasskey(device);
		const start = await startPasskeySignIn(app, rp);
		expect(start.options.allowCredentials ?? []).toEqual([]);
		expect(start.options.userVerification).toBe('required');
		const session = await finishPasskeySignIn(app, start.token, device.signIn(start.options, ORIGIN), rp);
		expect(session.user).toMatchObject({ email: 'ada@example.test', role: 'admin' });
		expect(validateSession(app, session.token)?.user.id).toBe(userId);
		const p = listPasskeys(app, userId)[0]!;
		expect(p.lastUsedAt).not.toBeNull();
		// Again: the counter moves on.
		await signIn(device);
	});

	it('refuses a replayed, tampered, foreign-site or unknown answer, always with the same words', async () => {
		const device = new SoftAuthenticator();
		await addPasskey(device);
		const refuse = async (make: (o: Awaited<ReturnType<typeof startPasskeySignIn>>) => unknown) => {
			const start = await startPasskeySignIn(app, rp);
			const err = await finishPasskeySignIn(app, start.token, make(start) as never, rp).catch(
				(e: unknown) => e
			);
			expect(err).toBeInstanceOf(UnauthenticatedError);
			expect((err as Error).message).toBe('That passkey could not be used to sign in here.');
		};
		// Answered for a look-alike site.
		await refuse((s) => device.signIn(s.options, 'https://audit.example.test.evil.example'));
		// Signed for another host name.
		await refuse((s) => device.signIn(s.options, ORIGIN, { rpId: 'other.example.test' }));
		// The person was not verified by the device.
		await refuse((s) => device.signIn(s.options, ORIGIN, { verified: false }));
		// A signature that does not match.
		await refuse((s) => {
			const r = device.signIn(s.options, ORIGIN);
			r.response.signature = r.response.signature.replace(/^.{6}/, 'AAAAAA');
			return r;
		});
		// A passkey this instance has never seen.
		await refuse((s) => new SoftAuthenticator().signIn(s.options, ORIGIN));
		// An earlier answer sent again: its challenge is gone.
		const first = await startPasskeySignIn(app, rp);
		const answer = device.signIn(first.options, ORIGIN);
		await finishPasskeySignIn(app, first.token, answer, rp);
		await expect(finishPasskeySignIn(app, first.token, answer, rp)).rejects.toThrow('That took too long');
		const second = await startPasskeySignIn(app, rp);
		await expect(finishPasskeySignIn(app, second.token, answer, rp)).rejects.toThrow(UnauthenticatedError);
		// A counter that went backwards: a copied authenticator.
		device.counter = 0;
		await refuse((s) => device.signIn(s.options, ORIGIN));
	});

	it('counts failures towards the same lock-outs as wrong passwords', async () => {
		const device = new SoftAuthenticator();
		await addPasskey(device);
		const now = new Date('2026-11-21T10:00:00Z');
		// Five refused answers for this account lock it, even for the right passkey.
		for (let i = 0; i < 5; i++) {
			const start = await startPasskeySignIn(app, rp, now);
			await expect(
				finishPasskeySignIn(
					app,
					start.token,
					device.signIn(start.options, ORIGIN, { verified: false }),
					rp,
					now,
					`198.51.100.${i}`
				)
			).rejects.toThrow(UnauthenticatedError);
		}
		device.counter = 100;
		await expect(signIn(device, '198.51.100.99', now)).rejects.toThrow(TooManyAttemptsError);
		await signIn(device, '198.51.100.99', new Date(now.getTime() + 16 * 60_000));

		// Twenty unknown passkeys from one address lock that address.
		const later = new Date('2026-11-21T12:00:00Z');
		for (let i = 0; i < 20; i++) {
			const start = await startPasskeySignIn(app, rp, later);
			await expect(
				finishPasskeySignIn(
					app,
					start.token,
					new SoftAuthenticator().signIn(start.options, ORIGIN),
					rp,
					later,
					'203.0.113.77'
				)
			).rejects.toThrow(UnauthenticatedError);
		}
		await expect(signIn(device, '203.0.113.77', later)).rejects.toThrow(TooManyAttemptsError);
		await signIn(device, '203.0.113.78', later);
	});

	it('a deactivated person cannot sign in with their passkey, and can again once reactivated', async () => {
		const { user: bo } = await createUser(app, admin, { name: 'Bo', email: 'bo@example.test' });
		const device = new SoftAuthenticator();
		await addPasskey(device, 'Phone', bo.id);
		expect((await signIn(device)).user.email).toBe('bo@example.test');
		setUserActive(app, admin, bo.id, getUser(app, bo.id).version, false);
		await expect(signIn(device)).rejects.toThrow('That passkey could not be used to sign in here.');
		setUserActive(app, admin, bo.id, getUser(app, bo.id).version, true);
		expect((await signIn(device)).user.email).toBe('bo@example.test');
	});
});

describe('managing passkeys (#87)', () => {
	it('renames and removes one; the removal is in the history', async () => {
		const a = await addPasskey(new SoftAuthenticator(), 'MacBook');
		const b = await addPasskey(new SoftAuthenticator(), 'Phone');
		expect(renamePasskey(app, userId, b.id, '  Work   phone ').name).toBe('Work phone');
		expect(() => renamePasskey(app, userId, b.id, ' ')).toThrow('Give the passkey a name.');
		removePasskey(app, userId, a.id);
		expect(listPasskeys(app, userId).map((p) => p.name)).toEqual(['Work phone']);
		expect(getUser(app, userId).passkeys).toBe(1);
		expect(getItemHistory(app, 'user', userId)[0]!.note).toBe('Passkey removed: MacBook');
	});

	it("nobody touches another person's passkey", async () => {
		const p = await addPasskey(new SoftAuthenticator());
		const { user: bo } = await createUser(app, admin, { name: 'Bo', email: 'bo@example.test' });
		expect(() => removePasskey(app, bo.id, p.id)).toThrow(NotFoundError);
		expect(() => renamePasskey(app, bo.id, p.id, 'Mine now')).toThrow(NotFoundError);
		expect(listPasskeys(app, bo.id)).toEqual([]);
	});

	it('the last passkey goes only when another way in exists', async () => {
		const device = new SoftAuthenticator();
		const p = await addPasskey(device);
		// With a password, the last passkey can go.
		removePasskey(app, userId, p.id);
		// Without one, it cannot.
		const again = await addPasskey(device);
		app.sqlite.prepare('DELETE FROM user_credential WHERE user_id = ?').run(userId);
		expect(() => removePasskey(app, userId, again.id)).toThrow('This is your only way to sign in.');
		await addPasskey(new SoftAuthenticator(), 'Second');
		removePasskey(app, userId, again.id);
		expect(listPasskeys(app, userId).map((x) => x.name)).toEqual(['Second']);
	});
});
