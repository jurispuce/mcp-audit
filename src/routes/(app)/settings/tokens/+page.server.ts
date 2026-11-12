import { createPersonalToken, listPersonalTokens, revokePersonalToken } from '#lib/domain/auth.ts';
import { listConnectedApps, revokeConnectedApp } from '#lib/domain/oauth.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, requireUser, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	return {
		tokens: listPersonalTokens(appDatabase(), requireUser(locals).id),
		apps: listConnectedApps(appDatabase(), requireUser(locals).id),
		mcpUrl: `${url.origin}/mcp`
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const data = await request.formData();
		const name = String(data.get('name') ?? '');
		try {
			const { token, info } = createPersonalToken(appDatabase(), uiActor(locals), name);
			return { created: { token, name: info.name } };
		} catch (e) {
			return formFailure(e, { name });
		}
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
