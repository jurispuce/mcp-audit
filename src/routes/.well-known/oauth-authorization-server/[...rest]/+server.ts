import { authorizationServerMetadata } from '#lib/domain/oauth.ts';
import { CORS, preflight } from '#lib/server/oauth-http.ts';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** RFC 8414 metadata. The issuer is the origin itself, so any path suffix gets the same answer. */
export const GET: RequestHandler = ({ url }) =>
	json(authorizationServerMetadata(url.origin), { headers: { ...CORS, 'cache-control': 'max-age=3600' } });
export const OPTIONS: RequestHandler = preflight;
