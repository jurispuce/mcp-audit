import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';

/** The browser side of passkeys (#87): ask the server, ask the device, send the answer back. */

async function post<T>(path: string, body: unknown = {}): Promise<T> {
	const res = await fetch(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const data = (await res.json().catch(() => ({}))) as T & { message?: string };
	if (!res.ok) throw new Error(data.message ?? 'Something went wrong. Try again.');
	return data;
}

export const passkeysSupported = () => browserSupportsWebAuthn();

const NOT_SUPPORTED = 'This browser cannot use passkeys.';

/** Sign in with a passkey the device holds for this address. Resolves to where to go next. */
export async function signInWithPasskey(next: string | null): Promise<string> {
	if (!passkeysSupported()) throw new Error(NOT_SUPPORTED);
	const optionsJSON = await post<Parameters<typeof startAuthentication>[0]['optionsJSON']>(
		'/api/passkeys/sign-in/options'
	);
	const response = await startAuthentication({ optionsJSON });
	return (await post<{ redirect: string }>('/api/passkeys/sign-in/verify', { response, next })).redirect;
}

/** Make a passkey on this device for the signed-in person. */
export async function addPasskey(name: string): Promise<{ id: string; name: string }> {
	if (!passkeysSupported()) throw new Error(NOT_SUPPORTED);
	const optionsJSON = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>(
		'/api/passkeys/register/options'
	);
	const response = await startRegistration({ optionsJSON });
	return post('/api/passkeys/register/verify', { response, name });
}

/** Join by invitation (#90): make a passkey for the invited person. Resolves to where to go next. */
export async function joinWithPasskey(token: string, name: string): Promise<string> {
	if (!passkeysSupported()) throw new Error(NOT_SUPPORTED);
	const optionsJSON = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>(
		'/api/passkeys/join/options',
		{ token }
	);
	const response = await startRegistration({ optionsJSON });
	return (await post<{ redirect: string }>('/api/passkeys/join/verify', { token, response, name })).redirect;
}

/** What went wrong, in words. The browser reports a cancelled or timed-out prompt as "not allowed". */
export function passkeyProblem(e: unknown, doing: 'sign-in' | 'add'): string {
	const err = e as { name?: string; code?: string; message?: string };
	if (err?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || err?.name === 'InvalidStateError')
		return 'This device already has a passkey for your account.';
	if (err?.name === 'NotAllowedError' || err?.code === 'ERROR_CEREMONY_ABORTED')
		return doing === 'sign-in'
			? 'No passkey was used. Try again, or sign in another way.'
			: 'No passkey was made. Try again when you are ready.';
	return err?.message || 'Something went wrong. Try again.';
}

/** A first name for a new passkey: "Chrome on macOS". The person can change it. */
export function guessPasskeyName(userAgent: string): string {
	const os = /iPhone/.test(userAgent)
		? 'iPhone'
		: /iPad/.test(userAgent)
			? 'iPad'
			: /Android/.test(userAgent)
				? 'Android'
				: /Windows/.test(userAgent)
					? 'Windows'
					: /Mac OS X|Macintosh/.test(userAgent)
						? 'macOS'
						: /Linux/.test(userAgent)
							? 'Linux'
							: '';
	const browser = /Edg\//.test(userAgent)
		? 'Edge'
		: /Firefox\//.test(userAgent)
			? 'Firefox'
			: /Chrome\//.test(userAgent)
				? 'Chrome'
				: /Safari\//.test(userAgent)
					? 'Safari'
					: '';
	return [browser, os].filter(Boolean).join(' on ') || 'Passkey';
}
