import { error, fail, redirect, type ActionFailure, type RequestEvent } from '@sveltejs/kit';
import { DomainError, StaleWriteError, ValidationError } from '#lib/domain/errors.ts';
import type { Actor } from '#lib/domain/write.ts';
import type { SessionUser } from '#lib/domain/auth.ts';

/** The signed-in user. The auth hook already guarantees one on every non-public route. */
export function requireUser(locals: App.Locals): SessionUser {
	if (!locals.user) redirect(303, '/login');
	return locals.user;
}

/** The actor for writes made in the UI by the signed-in user. */
export function uiActor(locals: App.Locals): Actor {
	return { userId: requireUser(locals).id, channel: 'ui' };
}

export interface FormFailure {
	message: string;
	fields?: Record<string, string>;
	/** Set when someone saved first: the newer version, and what this user tried to save. */
	conflict?: { version: number; current: Record<string, unknown>; attempted: Record<string, unknown> };
	values?: Record<string, unknown>;
}

/**
 * Turn a domain error into a form failure the page can show. Anything else is rethrown.
 * `attempted` is what the user submitted, so a stale write can be redone.
 */
export function formFailure(e: unknown, attempted: Record<string, unknown> = {}): ActionFailure<FormFailure> {
	if (e instanceof StaleWriteError) {
		return fail(409, {
			message: 'Someone else saved a newer version while you were editing. Your change was not saved.',
			conflict: { version: e.currentVersion, current: e.current, attempted },
			values: attempted
		});
	}
	if (e instanceof ValidationError)
		return fail(400, { message: e.message, fields: e.fields, values: attempted });
	if (e instanceof DomainError) return fail(e.status, { message: e.message, values: attempted });
	throw e;
}

/** For JSON endpoints: map domain errors to HTTP errors. */
export function httpError(e: unknown): never {
	if (e instanceof DomainError) error(e.status, { message: e.message, code: e.code });
	throw e;
}

export function formValues(data: FormData, keys: string[]): Record<string, string> {
	return Object.fromEntries(keys.map((k) => [k, String(data.get(k) ?? '')]));
}

/** Only allow redirects to paths on this site. */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
	if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
	return next;
}

export function sessionCookieOptions(event: Pick<RequestEvent, 'url'>, expires: Date) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		// Plain http is normal on a private network; mark secure whenever the app is reached over https.
		secure: event.url.protocol === 'https:',
		expires
	};
}
