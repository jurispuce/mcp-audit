import { json, redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { SESSION_COOKIE, validateSession } from '#lib/domain/auth.ts';
import { issueSetupCode, needsSetup } from '#lib/domain/setup.ts';
import { failInterruptedJobs } from '#lib/domain/jobs.ts';
import { prepareInstance, StartupError } from '#lib/domain/startup.ts';
import {
	allowedWhileChangingPassword,
	isApiPath,
	isCrossSiteFormPost,
	isOperatorPath,
	isPublicPath
} from '#lib/server/access.ts';
import { appDatabase } from '#lib/server/db.ts';
import { sessionCookieOptions } from '#lib/server/http.ts';

/** Before the first request: open the database, run migrations, and make sure someone can sign in. */
export const init: ServerInit = async () => {
	const app = appDatabase();
	try {
		await prepareInstance(app);
	} catch (e) {
		if (!(e instanceof StartupError)) throw e;
		// A setting keeps the instance from starting: say which, plainly, and stop.
		console.error(`\nCannot start.\n${e.message}\n`);
		process.exit(1);
	}
	const interrupted = failInterruptedJobs(app);
	if (interrupted) console.log(`Closed ${interrupted} AI action(s) the previous run left open.`);
	if (needsSetup(app)) {
		console.log(
			`\nNo users yet. Open /setup in the browser and enter this set-up code: ${issueSetupCode()}\n`
		);
	}
};

const NON_PAGE_CSP = "default-src 'none'; frame-ancestors 'none'";
const SECURITY_HEADERS: Record<string, string> = {
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'same-origin',
	'x-frame-options': 'DENY',
	// Pages carry the policy of vite.config.ts (csp). Everything else (JSON, downloads, redirects)
	// gets this one: nothing in it may load or run anything, so a file that was uploaded can never
	// act as a page of the app, and nothing opens inside a frame (#93, #99).
	'content-security-policy': NON_PAGE_CSP,
	'permissions-policy': 'camera=(self), microphone=(), geolocation=()'
};

/** Every route requires a signed-in user, except the few public ones. */
export const handle: Handle = async ({ event, resolve }) => {
	if (isCrossSiteFormPost(event.request, event.url)) {
		const message = `Cross-site ${event.request.method} form submissions are forbidden`;
		return event.request.headers.get('accept') === 'application/json'
			? json({ message }, { status: 403 })
			: new Response(message, { status: 403 });
	}
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

	// /mcp authenticates every request with a personal access token (the route checks it); the
	// operator's numbers with the instance's operator token (#98).
	const tokenAuthenticated = path === '/mcp' || isOperatorPath(path);

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
