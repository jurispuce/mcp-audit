import { redirect } from '@sveltejs/kit';
import { listEngagements } from '#lib/domain/engagements.ts';
import { engagementOverview } from '#lib/domain/overview.ts';
import { setWelcomed } from '#lib/domain/users.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const app = appDatabase();
	const { engagement } = await parent();
	return {
		// Progress per step comes from the same phase checklist as Home.
		phases: engagement
			? engagementOverview(app, engagement.id).phases.map((p) => ({
					number: p.number,
					title: p.title,
					fact: p.fact,
					done: p.done
				}))
			: null,
		engagements: engagement
			? []
			: listEngagements(app).map((e) => ({ id: e.id, name: e.name, auditeeName: e.auditeeName }))
	};
};

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
	showWelcome: async ({ locals }) => {
		try {
			setWelcomed(appDatabase(), uiActor(locals), false);
			return { success: 'The welcome shows again on the engagements screen and on Home.' };
		} catch (e) {
			return formFailure(e);
		}
	}
};
