import { redirect } from '@sveltejs/kit';
import {
	approveAuthorization,
	AuthorizePageError,
	AuthorizeRedirectError,
	denyAuthorization,
	validateAuthorizeRequest
} from '#lib/domain/oauth.ts';
import { appDatabase } from '#lib/server/db.ts';
import { requireUser, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * The consent screen of the OAuth flow (#75). The person is signed in (the hook sends them to the
 * login page first and back here after). Problems with the client or its redirect URI are shown here;
 * anything else goes back to the client as an OAuth error.
 */
export const load: PageServerLoad = ({ url, locals }) => {
	const user = requireUser(locals);
	try {
		const req = validateAuthorizeRequest(appDatabase(), url.searchParams, url.origin);
		return {
			user: { name: user.name, email: user.email },
			client: { name: req.client.name, uri: req.client.clientUri },
			returnsTo: new URL(req.redirectUri).host || req.redirectUri,
			params: url.searchParams.toString(),
			error: null
		};
	} catch (e) {
		if (e instanceof AuthorizeRedirectError) redirect(302, e.location(), { external: true });
		if (e instanceof AuthorizePageError) {
			return {
				user: { name: user.name, email: user.email },
				client: null,
				returnsTo: null,
				params: '',
				error: e.message
			};
		}
		throw e;
	}
};

function request(data: FormData, url: URL) {
	return validateAuthorizeRequest(
		appDatabase(),
		new URLSearchParams(String(data.get('params') ?? '')),
		url.origin
	);
}

export const actions: Actions = {
	approve: async ({ request: req, url, locals }) => {
		const data = await req.formData();
		let location: string;
		try {
			location = approveAuthorization(appDatabase(), uiActor(locals), request(data, url), url.origin);
		} catch (e) {
			if (e instanceof AuthorizeRedirectError) redirect(303, e.location(), { external: true });
			if (e instanceof AuthorizePageError) return { error: e.message };
			throw e;
		}
		// Only ever a redirect URI the client registered (checked in validateAuthorizeRequest).
		redirect(303, location, { external: true });
	},
	deny: async ({ request: req, url }) => {
		const data = await req.formData();
		let location: string;
		try {
			location = denyAuthorization(request(data, url), url.origin);
		} catch (e) {
			if (e instanceof AuthorizeRedirectError) redirect(303, e.location(), { external: true });
			if (e instanceof AuthorizePageError) return { error: e.message };
			throw e;
		}
		// Only ever a redirect URI the client registered (checked in validateAuthorizeRequest).
		redirect(303, location, { external: true });
	}
};
