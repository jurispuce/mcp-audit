import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { login } from './auth';
import { TooManyAttemptsError, UnauthenticatedError } from './errors';
import { addressKey, assertNotLocked, POLICIES, recordFailure } from './throttle';
import { createFirstAdmin, resetPassword } from './users';
import type { Actor } from './write';

const PASSWORD = 'correct horse battery';
let app: AppDatabase;
let admin: Actor;
const t0 = new Date('2026-11-12T10:00:00Z');
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, { name: 'Ada', email: 'ada@example.test', password: PASSWORD });
	admin = { userId: a.id, channel: 'ui' };
});
afterEach(() => app.close());

async function fail(email: string, when: Date, address = '10.0.0.1') {
	await expect(login(app, email, 'wrong password', when, address)).rejects.toBeInstanceOf(
		UnauthenticatedError
	);
}

describe('sign-in rate limiting and lock-out (#67)', () => {
	it('locks an account after 5 wrong passwords in 15 minutes, even for the right password', async () => {
		for (let i = 0; i < 5; i++) await fail('ada@example.test', at(i));
		const locked = login(app, 'Ada@Example.test', PASSWORD, at(5), '10.0.0.2');
		await expect(locked).rejects.toBeInstanceOf(TooManyAttemptsError);
		await expect(locked).rejects.toThrow('Too many failed attempts. Try again in 14 minutes.');
		// The lock ends after 15 minutes.
		await expect(login(app, 'ada@example.test', PASSWORD, at(20), '10.0.0.2')).resolves.toMatchObject({
			user: { email: 'ada@example.test' }
		});
	});

	it('failures spread over more than the window do not lock; a success resets the count', async () => {
		for (let i = 0; i < 4; i++) await fail('ada@example.test', at(i));
		await login(app, 'ada@example.test', PASSWORD, at(5), '10.0.0.1');
		for (let i = 0; i < 4; i++) await fail('ada@example.test', at(6 + i));
		await fail('ada@example.test', at(30)); // a new window
		await expect(login(app, 'ada@example.test', PASSWORD, at(31), '10.0.0.1')).resolves.toBeTruthy();
	});

	it('locks unknown emails the same way, so a lock says nothing about whether an account exists', async () => {
		for (let i = 0; i < 5; i++) await fail('nobody@example.test', at(i), `10.0.1.${i}`);
		await expect(login(app, 'nobody@example.test', 'x', at(6), '10.0.2.1')).rejects.toBeInstanceOf(
			TooManyAttemptsError
		);
	});

	it('limits one address trying many accounts', async () => {
		for (let i = 0; i < POLICIES.address.max; i++) await fail(`user${i}@example.test`, at(0), '10.9.9.9');
		await expect(login(app, 'ada@example.test', PASSWORD, at(1), '10.9.9.9')).rejects.toBeInstanceOf(
			TooManyAttemptsError
		);
		await expect(login(app, 'ada@example.test', PASSWORD, at(1), '10.9.9.8')).resolves.toBeTruthy();
	});

	it('an admin resetting the password lifts the lock', async () => {
		for (let i = 0; i < 5; i++) await fail('ada@example.test', at(i));
		const { temporaryPassword } = await resetPassword(app, admin, admin.userId);
		await expect(
			login(app, 'ada@example.test', temporaryPassword, new Date(), '10.0.0.3')
		).resolves.toBeTruthy();
	});

	it('token and set-up keys lock by address', () => {
		const key = addressKey('token', '192.0.2.1');
		for (let i = 0; i < POLICIES.token.max - 1; i++)
			expect(recordFailure(app, key, POLICIES.token, at(0))).toBe(false);
		expect(recordFailure(app, key, POLICIES.token, at(0))).toBe(true);
		expect(() => assertNotLocked(app, [key], at(1))).toThrow(TooManyAttemptsError);
		expect(() => assertNotLocked(app, [addressKey('token', '192.0.2.2')], at(1))).not.toThrow();
		expect(() => assertNotLocked(app, [key], at(16))).not.toThrow();
	});
});
