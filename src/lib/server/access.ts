/** Paths reachable without signing in. Everything else needs a session (or a token on /mcp). */
const PUBLIC_PATHS = [
	/^\/login\/?$/,
	/^\/setup\/?$/,
	/^\/health\/?$/,
	/^\/manifest\.webmanifest$/,
	/^\/icons\//,
	/^\/favicon\.(ico|svg|png)$/,
	/^\/robots\.txt$/,
	// OAuth for /mcp (#75): metadata, and the endpoints a client calls with its own credentials.
	// /oauth/authorize is not here: the person approving must be signed in.
	/^\/\.well-known\//,
	/^\/oauth\/(token|register|revoke)\/?$/,
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

/**
 * Endpoints called server to server by OAuth clients with their own credentials (client secret or
 * PKCE verifier, never a cookie), so the browser cross-site form check does not apply.
 */
const CROSS_SITE_FORM_EXEMPT = [/^\/oauth\/(token|revoke)\/?$/];

const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * SvelteKit's own rule, applied here so the OAuth endpoints can be exempt: a form-type request that
 * changes something must come from this site's own origin. Cookies ride along on cross-site form
 * posts, so without this a page elsewhere could act as the signed-in person.
 */
export function isCrossSiteFormPost(request: Request, url: URL): boolean {
	if (!MUTATING.has(request.method)) return false;
	const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
	if (type && !FORM_TYPES.includes(type)) return false;
	if (request.headers.get('origin') === url.origin) return false;
	return !CROSS_SITE_FORM_EXEMPT.some((p) => p.test(url.pathname));
}
