import type { ServerInit } from '@sveltejs/kit/hooks';
import { appDatabase } from '#lib/server/db.ts';

/** Open the database and run pending migrations before the first request is served. */
export const init: ServerInit = () => {
	appDatabase();
};
