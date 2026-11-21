import { redirect, type RequestEvent } from '@sveltejs/kit';
import { SESSION_COOKIE } from '#lib/domain/auth.ts';
import { instanceInfo } from '#lib/domain/email-templates.ts';
import {
	invitationProblem,
	joinOptions,
	joinWithPassword,
	joinWithoutPasskey,
	readInvitation,
	type Joined
} from '#lib/domain/invitations.ts';
import { MIN_PASSWORD_LENGTH } from '#lib/domain/password.ts';
import { needsSetup } from '#lib/domain/setup.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, sessionCookieOptions } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

/** The page an invitation link opens (#90). Opening it uses nothing up; joining does. */
export const load: PageServerLoad = ({ url, locals }) => {
	const app = appDatabase();
	if (needsSetup(app)) redirect(303, '/setup');
	const token = url.searchParams.get('t') ?? '';
	const view = readInvitation(app, token);
	return {
		instance: instanceInfo(url.origin).name,
		token,
		problem: invitationProblem(view),
		used: view.state === 'used',
		// Who was invited is shown only to someone holding a link that works.
		invitee: view.state === 'open' && view.user ? { name: view.user.name, email: view.user.email } : null,
		invitedBy: view.state === 'open' ? view.invitedBy : null,
		options: joinOptions(url.origin),
		signedInAs: locals.user?.name ?? null,
		minPassword: MIN_PASSWORD_LENGTH
	};
};

function joined(event: RequestEvent, session: Joined): never {
	event.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(event, session.expiresAt));
	// A new person lands on the engagements screen, where the first-time welcome is (#84).
	redirect(303, '/');
}

export const actions: Actions = {
	// The token rides in the address (?/password&t=…), so the page keeps the invitation after a refusal.
	password: async (event) => {
		const data = await event.request.formData();
		let session: Joined;
		try {
			session = await joinWithPassword(appDatabase(), event.url.searchParams.get('t'), {
				password: data.get('password'),
				repeat: data.get('repeat')
			});
		} catch (e) {
			return formFailure(e, { action: 'password' });
		}
		joined(event, session);
	},
	without: async (event) => {
		let session: Joined;
		try {
			session = joinWithoutPasskey(appDatabase(), event.url.searchParams.get('t'));
		} catch (e) {
			return formFailure(e, { action: 'without' });
		}
		joined(event, session);
	}
};
