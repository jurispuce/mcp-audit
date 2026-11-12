import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { ValidationError } from './errors';

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
	new Promise<Buffer>((resolve, reject) =>
		scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)))
	);

/** scrypt parameters: N=2^15, r=8, p=1 (about 32 MB per hash). Stored with the hash so they can change later. */
const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64 };
export const MIN_PASSWORD_LENGTH = 10;

export function validatePassword(password: unknown): string {
	const p = typeof password === 'string' ? password : '';
	if (p.length < MIN_PASSWORD_LENGTH) {
		throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, {
			password: `At least ${MIN_PASSWORD_LENGTH} characters`
		});
	}
	if (p.length > 256) throw new ValidationError('Password is too long.', { password: 'Too long' });
	return p;
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const key = await scrypt(password, salt, PARAMS.keylen, {
		N: PARAMS.N,
		r: PARAMS.r,
		p: PARAMS.p,
		maxmem: 128 * 1024 * 1024
	});
	return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [scheme, n, r, p, salt, hash] = stored.split('$');
	if (scheme !== 'scrypt' || !salt || !hash) return false;
	const expected = Buffer.from(hash, 'base64');
	const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
		N: Number(n),
		r: Number(r),
		p: Number(p),
		maxmem: 128 * 1024 * 1024
	});
	return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash of a random password, used to spend the same time when an email is unknown. */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
	dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
	return dummyHash;
}

/** Readable one-time password for new accounts and resets: 4 groups of 4, no look-alike characters. */
export function generateTemporaryPassword(): string {
	const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
	const bytes = randomBytes(16);
	const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
	return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}
