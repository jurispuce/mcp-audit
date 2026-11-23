import { loadConfig } from '#lib/server/config.ts';
import { appDatabase } from '#lib/server/db.ts';
import { operatorStatus } from '#lib/server/operator-http.ts';
import type { RequestHandler } from './$types';

/**
 * Numbers about this instance for whoever runs it (#98): counts, sizes and dates, never content.
 * The caller must hold this instance's operator token; it is not a user and has no session.
 */
export const GET: RequestHandler = ({ request, getClientAddress }) => {
	// Asked on the server itself, the request does not come through the proxy that names the
	// visitor's address (ADDRESS_HEADER), and SvelteKit then refuses to name one.
	let address = 'local';
	try {
		address = getClientAddress();
	} catch {
		// counted under "local"
	}
	return operatorStatus(appDatabase(), request, address, { filesDir: loadConfig().filesDir });
};
