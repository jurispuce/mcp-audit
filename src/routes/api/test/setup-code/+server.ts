import { error, json } from '@sveltejs/kit';
import { seedAllowed } from '#lib/domain/seed.ts';
import { issueSetupCode, needsSetup } from '#lib/domain/setup.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

/** Test only: the set-up code that is otherwise printed in the server log. */
export const GET: RequestHandler = () => {
	if (!seedAllowed() || !needsSetup(appDatabase())) error(404, { message: 'Not found' });
	return json({ code: issueSetupCode() });
};
