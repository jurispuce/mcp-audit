import { error } from '@sveltejs/kit';
import { EMAIL_KIND_LABELS, emailSettings, listEmailLog, sendEmail } from '#lib/domain/email.ts';
import { instanceInfo, testEmail } from '#lib/domain/email-templates.ts';
import { isAdmin } from '#lib/domain/users.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, requireUser, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const app = appDatabase();
	if (!isAdmin(app, uiActor(locals))) error(403, { message: 'Only an admin can see the email settings.' });
	return {
		// From the environment; the password itself is never read into the page.
		email: emailSettings(),
		log: listEmailLog(app).map((l) => ({ ...l, kindLabel: EMAIL_KIND_LABELS[l.kind] ?? l.kind })),
		myEmail: requireUser(locals).email
	};
};

export const actions: Actions = {
	test: async ({ locals, url }) => {
		const app = appDatabase();
		const me = requireUser(locals);
		if (!isAdmin(app, uiActor(locals))) error(403, { message: 'Only an admin can send a test email.' });
		try {
			await sendEmail(app, {
				...testEmail(instanceInfo(url.origin), { name: me.name }),
				to: me.email,
				kind: 'test'
			});
			return {
				success: `Test email sent to ${me.email}. Check the inbox, and the spam folder if it is not there.`
			};
		} catch (e) {
			return formFailure(e);
		}
	}
};
