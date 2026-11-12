/** Paths reachable without signing in. Everything else needs a session (or a token on /mcp). */
const PUBLIC_PATHS = [
	/^\/login\/?$/,
	/^\/setup\/?$/,
	/^\/health\/?$/,
	/^\/manifest\.webmanifest$/,
	/^\/icons\//,
	/^\/favicon\.(ico|svg|png)$/,
	/^\/robots\.txt$/,
	// MCP clients probe for OAuth metadata after a 401; there is none, so let them get a plain 404.
	/^\/\.well-known\//,
	/^\/_app\//
];

/** Test-only endpoints are public when TEST_SEED_ENABLED=true and do not exist otherwise. */
export function isPublicPath(
	pathname: string,
	testSeedEnabled = process.env.TEST_SEED_ENABLED === 'true'
): boolean {
	if (testSeedEnabled && pathname.startsWith('/api/test/')) return true;
	return PUBLIC_PATHS.some((p) => p.test(pathname));
}

/** API-style paths answer 401 JSON instead of redirecting to the login page. */
export function isApiPath(pathname: string): boolean {
	return pathname.startsWith('/api/') || pathname === '/mcp' || pathname.startsWith('/mcp/');
}

/** Pages a user who must change their password may still open. */
export function allowedWhileChangingPassword(pathname: string): boolean {
	return pathname === '/settings' || pathname === '/logout' || isPublicPath(pathname);
}
