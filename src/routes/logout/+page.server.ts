import { redirect } from '@sveltejs/kit';
import { logout, SESSION_COOKIE } from '#lib/domain/auth.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => redirect(303, '/');

export const actions: Actions = {
	default: ({ cookies }) => {
		logout(appDatabase(), cookies.get(SESSION_COOKIE));
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/login');
	}
};
