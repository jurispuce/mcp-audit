import { requireUser } from '#lib/server/http.ts';
import { APP_VERSION } from '#lib/version.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	return { user: requireUser(locals), version: APP_VERSION };
};
