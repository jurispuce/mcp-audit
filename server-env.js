// Environment clean-up applied before the SvelteKit handler is loaded. See server.js.

/** Settings that may be left empty in .env; adapter-node rejects some of them when empty. */
export const OPTIONAL_SETTINGS = [
	'ORIGIN',
	'PROTOCOL_HEADER',
	'HOST_HEADER',
	'PORT_HEADER',
	'ADDRESS_HEADER',
	'XFF_DEPTH',
	'BODY_SIZE_LIMIT'
];

/** Largest request body when BODY_SIZE_LIMIT is not set: room for several documents at once. */
export const DEFAULT_BODY_SIZE_LIMIT = '100M';

/**
 * Remove empty optional settings, and when no ORIGIN or PROTOCOL_HEADER is given, read the
 * protocol from X-Forwarded-Proto. Returns whether requests without that header must be marked http.
 * @param {Record<string, string | undefined>} env
 */
export function prepareEnv(env) {
	for (const name of OPTIONAL_SETTINGS) {
		if (env[name] !== undefined && env[name].trim() === '') delete env[name];
	}
	// Document upload sends several files in one request; adapter-node's own default is 512K.
	if (!env.BODY_SIZE_LIMIT) env.BODY_SIZE_LIMIT = DEFAULT_BODY_SIZE_LIMIT;
	const useForwardedProto = !env.ORIGIN && !env.PROTOCOL_HEADER;
	if (useForwardedProto) env.PROTOCOL_HEADER = 'x-forwarded-proto';
	return { useForwardedProto };
}
