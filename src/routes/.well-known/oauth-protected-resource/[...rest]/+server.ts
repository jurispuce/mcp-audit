import { protectedResourceMetadata } from '#lib/domain/oauth.ts';
import { CORS, preflight } from '#lib/server/oauth-http.ts';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** RFC 9728 metadata for /mcp, at the root and at /.well-known/oauth-protected-resource/mcp. */
export const GET: RequestHandler = ({ url }) =>
	json(protectedResourceMetadata(url.origin), { headers: { ...CORS, 'cache-control': 'max-age=3600' } });
export const OPTIONS: RequestHandler = preflight;
