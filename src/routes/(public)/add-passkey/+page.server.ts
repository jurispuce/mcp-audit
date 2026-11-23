import { redirect } from '@sveltejs/kit';
import { listPasskeys, passkeysPossible } from '#lib/domain/passkeys.ts';
import { appDatabase } from '#lib/server/db.ts';
import { requireUser, safeNext } from '#lib/server/http.ts';
import type { PageServerLoad } from './$types';

/**
 * After signing in with an email code (#88): this device has no passkey, so offer one. The person
 * can go on without; the offer comes back at the next sign-in by code.
 */
export const load: PageServerLoad = ({ locals, url }) => {
	const me = requireUser(locals);
	const next = safeNext(url.searchParams.get('next'));
	if (!passkeysPossible(url.origin)) redirect(303, next);
	return { next, name: me.name, count: listPasskeys(appDatabase(), me.id).length };
};
