import { describe, expect, it } from 'vitest';
import { allowedWhileChangingPassword, isApiPath, isCrossSiteFormPost, isPublicPath } from './access';
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

describe('cross-site form posts (#75)', () => {
	const url = (p: string) => new URL(`https://audit.example.com${p}`);
	const post = (headers: Record<string, string>) =>
		new Request('https://audit.example.com/x', { method: 'POST', headers });
	const form = { 'content-type': 'application/x-www-form-urlencoded' };

	it('refuses form posts from another origin or without one, as SvelteKit does', () => {
		expect(isCrossSiteFormPost(post({ ...form, origin: 'https://evil.example' }), url('/login'))).toBe(true);
		expect(isCrossSiteFormPost(post(form), url('/settings/tokens'))).toBe(true);
		expect(isCrossSiteFormPost(post({}), url('/logout'))).toBe(true);
		expect(
			isCrossSiteFormPost(post({ 'content-type': 'multipart/form-data; boundary=x' }), url('/e/1'))
		).toBe(true);
	});

	it('allows same-origin forms, JSON and reads', () => {
		expect(isCrossSiteFormPost(post({ ...form, origin: 'https://audit.example.com' }), url('/login'))).toBe(
			false
		);
		expect(isCrossSiteFormPost(post({ 'content-type': 'application/json' }), url('/mcp'))).toBe(false);
		expect(isCrossSiteFormPost(new Request('https://audit.example.com/x'), url('/login'))).toBe(false);
	});

	it('lets OAuth clients post to the token and revocation endpoints from their servers', () => {
		expect(isCrossSiteFormPost(post(form), url('/oauth/token'))).toBe(false);
		expect(isCrossSiteFormPost(post(form), url('/oauth/revoke'))).toBe(false);
		expect(isCrossSiteFormPost(post(form), url('/oauth/authorize'))).toBe(true);
	});

	it('makes the OAuth metadata and client endpoints public, but not authorize', () => {
		for (const p of [
			'/.well-known/oauth-protected-resource/mcp',
			'/oauth/token',
			'/oauth/register',
			'/oauth/revoke'
		])
			expect(isPublicPath(p, false), p).toBe(true);
		expect(isPublicPath('/oauth/authorize', false)).toBe(false);
	});
});
