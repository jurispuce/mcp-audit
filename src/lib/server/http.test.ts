import { describe, expect, it } from 'vitest';
import { sessionCookieOptions } from './http';

describe('session cookie (#67)', () => {
	it('is http-only, same-site lax, and secure whenever the app is reached over https', () => {
		const expires = new Date('2026-12-01T00:00:00Z');
		expect(sessionCookieOptions({ url: new URL('https://audit.example.com/login') }, expires)).toEqual({
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			expires
		});
		expect(sessionCookieOptions({ url: new URL('http://10.0.0.5:3000/login') }, expires).secure).toBe(false);
	});
});
