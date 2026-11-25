import { redirect } from '@sveltejs/kit';
import { setWelcomed } from '#lib/domain/users.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, uiActor } from '#lib/server/http.ts';
import { GUIDE_COOKIE } from '#lib/server/guide-bar.ts';
import type { Actions } from './$types';

/** A path inside this app, or the engagements screen. */
function localPath(value: FormDataEntryValue | null): string {
	const s = typeof value === 'string' ? value : '';
	return /^\/(?![/\\])[^\s\\]*$/.test(s) ? s : '/';
}

export const actions: Actions = {
	/** From the welcome: it is dismissed whichever way the person leaves it. */
	welcome: async ({ request, locals }) => {
		const data = await request.formData();
		try {
			setWelcomed(appDatabase(), uiActor(locals), true);
		} catch (e) {
			return formFailure(e);
		}
		const id = data.get('e');
		const q = typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id) ? `?e=${id}` : '';
		const to = data.get('to');
		redirect(
			303,
			to === 'guide' ? `/guide${q}` : to === 'connect' ? `/guide/connect${q}` : localPath(data.get('back'))
		);
	},
	/** The guide bar's Close (#106): the bar goes, and stays gone until Go in the guide turns it on again. */
	closeBar: async ({ request, cookies }) => {
		const data = await request.formData();
		cookies.delete(GUIDE_COOKIE, { path: '/' });
		redirect(303, localPath(data.get('back')));
	},
	showWelcome: async ({ locals }) => {
		try {
			setWelcomed(appDatabase(), uiActor(locals), false);
			return { success: 'The welcome shows again on the engagements screen and on Home.' };
		} catch (e) {
			return formFailure(e);
		}
	}
};
