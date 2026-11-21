import { getUser } from '#lib/domain/users.ts';
import { appDatabase } from '#lib/server/db.ts';
import { requireUser } from '#lib/server/http.ts';
import { APP_VERSION } from '#lib/version.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	return {
		user,
		version: APP_VERSION,
		// The first-time welcome (#84), until the person dismisses it.
		welcome: !getUser(appDatabase(), user.id).welcomed
	};
};
