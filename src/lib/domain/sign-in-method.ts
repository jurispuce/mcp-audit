/**
 * How people sign in on this instance (#89): `password` (the default: passwords, with passkeys as a
 * second way in) or `passkey` (passkeys with email as the way back; no password exists).
 */
export type SignInMethod = 'password' | 'passkey';

export function signInMethod(env: Record<string, string | undefined> = process.env): SignInMethod {
	return (env.SIGN_IN_METHOD ?? '').trim().toLowerCase() === 'passkey' ? 'passkey' : 'password';
}
