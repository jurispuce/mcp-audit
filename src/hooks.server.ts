import { json, redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, validateSession } from '#lib/domain/auth.ts';
import { issueSetupCode, needsSetup } from '#lib/domain/setup.ts';
import { failInterruptedJobs } from '#lib/domain/jobs.ts';
import { ensureInitialAdmin } from '#lib/domain/users.ts';
import { allowedWhileChangingPassword, isApiPath, isPublicPath } from '#lib/server/access.ts';
import { appDatabase } from '#lib/server/db.ts';
import { sessionCookieOptions } from '#lib/server/http.ts';

/** Before the first request: open the database, run migrations, and make sure someone can sign in. */
export const init: ServerInit = async () => {
	const app = appDatabase();
	const created = await ensureInitialAdmin(app);
	if (created) console.log(`Created the first admin ${created.email} from INITIAL_ADMIN_EMAIL.`);
	const interrupted = failInterruptedJobs(app);
	if (interrupted) console.log(`Closed ${interrupted} AI action(s) the previous run left open.`);
	if (needsSetup(app)) {
		console.log(
			`\nNo users yet. Open /setup in the browser and enter this set-up code: ${issueSetupCode()}\n`
		);
	}
};

const SECURITY_HEADERS: Record<string, string> = {
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'same-origin',
	'x-frame-options': 'DENY',
	'permissions-policy': 'camera=(self), microphone=(), geolocation=()'
};

/** Every route requires a signed-in user, except the few public ones. */
export const handle: Handle = async ({ event, resolve }) => {
	const app = appDatabase();
	const path = event.url.pathname;
	const token = event.cookies.get(SESSION_COOKIE);
	const session = validateSession(app, token);

	event.locals.user = session?.user ?? null;
	event.locals.sessionId = session?.sessionId ?? null;
	if (session && token) {
		event.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(event, session.expiresAt));
	} else if (token) {
		event.cookies.delete(SESSION_COOKIE, { path: '/' });
	}

	// /mcp authenticates every request with a personal access token (the route checks it).
	const tokenAuthenticated = path === '/mcp';

	if (!session && !isPublicPath(path) && !tokenAuthenticated) {
		if (isApiPath(path)) {
			return json(
				{ message: 'Sign in or send a personal access token.', code: 'unauthenticated' },
				{ status: 401 }
			);
		}
		if (needsSetup(app)) redirect(303, '/setup');
		const next = path === '/' ? '' : `?next=${encodeURIComponent(path + event.url.search)}`;
		redirect(303, `/login${next}`);
	}

	if (session?.user.mustChangePassword && !allowedWhileChangingPassword(path) && !isApiPath(path)) {
		redirect(303, '/settings?password=required');
	}

	const response = await resolve(event);
	for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
		if (!response.headers.has(k)) response.headers.set(k, v);
	}
	// Reached over https (directly or through a TLS proxy that says so): browsers stay on https.
	if (event.url.protocol === 'https:' && !response.headers.has('strict-transport-security')) {
		response.headers.set('strict-transport-security', 'max-age=31536000');
	}
	return response;
};
