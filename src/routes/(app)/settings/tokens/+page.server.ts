import { fail, redirect } from '@sveltejs/kit';
import {
	RECHECK_MINUTES,
	RecheckNeededError,
	SESSION_COOKIE,
	createPersonalTokenInSession,
	listPersonalTokens,
	logout,
	revokePersonalToken
} from '#lib/domain/auth.ts';
import { listConnectedApps, revokeConnectedApp } from '#lib/domain/oauth.ts';
import { listPasskeys, passkeysPossible } from '#lib/domain/passkeys.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, requireUser, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	return {
		tokens: listPersonalTokens(appDatabase(), requireUser(locals).id),
		apps: listConnectedApps(appDatabase(), requireUser(locals).id),
		mcpUrl: `${url.origin}/mcp`,
		// Creating a token asks for the passkey again when the last proof is older than this (#93).
		recheckMinutes: RECHECK_MINUTES,
		canConfirmWithPasskey:
			passkeysPossible(url.origin) && listPasskeys(appDatabase(), requireUser(locals).id).length > 0
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const data = await request.formData();
		const name = String(data.get('name') ?? '');
		try {
			const { token, info } = createPersonalTokenInSession(
				appDatabase(),
				uiActor(locals),
				locals.sessionId,
				name
			);
			return { created: { token, name: info.name } };
		} catch (e) {
			// The page then asks for the passkey and sends the form again, or offers a new sign-in.
			if (e instanceof RecheckNeededError)
				return fail(403, { recheck: true, message: e.message, values: { name } });
			return formFailure(e, { name });
		}
	},
	/** Without a passkey to ask for, a new sign-in is the fresh proof; it comes back here. */
	signInAgain: async ({ cookies }) => {
		logout(appDatabase(), cookies.get(SESSION_COOKIE));
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, `/login?next=${encodeURIComponent('/settings/tokens')}`);
	},
	revoke: async ({ request, locals }) => {
		const data = await request.formData();
		try {
			revokePersonalToken(appDatabase(), uiActor(locals), String(data.get('id')));
			return { success: 'Token revoked. It no longer works.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	disconnect: async ({ request, locals }) => {
		const data = await request.formData();
		try {
			revokeConnectedApp(appDatabase(), uiActor(locals), String(data.get('grant')));
			return { success: 'App disconnected. It has to be allowed again to work.' };
		} catch (e) {
			return formFailure(e);
		}
	}
};
