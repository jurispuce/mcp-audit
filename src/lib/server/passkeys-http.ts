import { json, type RequestEvent } from '@sveltejs/kit';
import { DomainError, TooManyAttemptsError } from '#lib/domain/errors.ts';
import { CHALLENGE_COOKIE } from '#lib/domain/passkeys.ts';

/** The passkey endpoints answer JSON to the page's own scripts only. */
export function fromThisSite(event: Pick<RequestEvent, 'request' | 'url'>): boolean {
	return event.request.headers.get('origin') === event.url.origin;
}

export const refuseOtherSite = () =>
	json({ message: 'This request must come from the app itself.', code: 'forbidden' }, { status: 403 });

/** The challenge is tied to this browser by a short-lived cookie the page's scripts cannot read. */
export function setChallengeCookie(
	event: Pick<RequestEvent, 'cookies' | 'url'>,
	token: string,
	expires: Date
) {
	event.cookies.set(CHALLENGE_COOKIE, token, {
		path: '/api/passkeys',
		httpOnly: true,
		sameSite: 'strict',
		secure: event.url.protocol === 'https:',
		expires
	});
}

export function takeChallengeCookie(event: Pick<RequestEvent, 'cookies'>): string | undefined {
	const token = event.cookies.get(CHALLENGE_COOKIE);
	event.cookies.delete(CHALLENGE_COOKIE, { path: '/api/passkeys' });
	return token;
}

export function domainFailure(event: Pick<RequestEvent, 'setHeaders'>, e: unknown): Response {
	if (e instanceof TooManyAttemptsError) {
		event.setHeaders({ 'retry-after': String(e.retryAfterSeconds) });
		return json({ message: e.message, code: e.code }, { status: 429 });
	}
	if (e instanceof DomainError) return json({ message: e.message, code: e.code }, { status: e.status });
	throw e;
}
