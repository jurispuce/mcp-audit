import { describe, expect, it } from 'vitest';
import { allowedWhileChangingPassword, isApiPath, isPublicPath } from './access';
import { safeNext } from './http';

describe('access rules', () => {
	it('keeps only login, set-up, health and static assets public', () => {
		for (const p of [
			'/login',
			'/setup',
			'/health',
			'/_app/immutable/x.js',
			'/manifest.webmanifest',
			'/icons/icon.svg'
		])
			expect(isPublicPath(p, false), p).toBe(true);
		for (const p of [
			'/',
			'/settings',
			'/settings/users',
			'/api/items/user/1',
			'/mcp',
			'/e/1',
			'/library',
			'/loginx'
		])
			expect(isPublicPath(p, false), p).toBe(false);
	});

	it('opens test endpoints only when TEST_SEED_ENABLED is on', () => {
		expect(isPublicPath('/api/test/login', true)).toBe(true);
		expect(isPublicPath('/api/test/login', false)).toBe(false);
	});

	it('treats /api and /mcp as API paths', () => {
		expect(isApiPath('/api/items/x')).toBe(true);
		expect(isApiPath('/mcp')).toBe(true);
		expect(isApiPath('/settings')).toBe(false);
	});

	it('limits a user with a one-time password to the account page and logout', () => {
		expect(allowedWhileChangingPassword('/settings')).toBe(true);
		expect(allowedWhileChangingPassword('/logout')).toBe(true);
		expect(allowedWhileChangingPassword('/')).toBe(false);
	});

	it('only redirects to local paths after login', () => {
		expect(safeNext('/settings/users')).toBe('/settings/users');
		expect(safeNext('https://evil.example')).toBe('/');
		expect(safeNext('//evil.example')).toBe('/');
		expect(safeNext('/\\evil.example')).toBe('/');
		expect(safeNext(null)).toBe('/');
	});
});
