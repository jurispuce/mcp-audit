import { json } from '@sveltejs/kit';
import { systemStatus } from '#lib/domain/system.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

/** Liveness and readiness for Docker and monitoring. Reveals no audit data. */
export const GET: RequestHandler = () => {
	const status = systemStatus(appDatabase());
	return json(status, {
		status: status.status === 'ok' ? 200 : 503,
		headers: { 'cache-control': 'no-store' }
	});
};
