import { ForbiddenError } from './errors';

/**
 * How people sign in on this instance (#89), set with SIGN_IN_METHOD:
 * - `password` (the default): passwords, with passkeys and emailed codes as further ways in;
 * - `passkey`: passkeys, with a code by email as the way back. No password exists: none can be set,
 *   changed or reset, people join by invitation (#90), and stored password hashes are deleted at start.
 */
export type SignInMethod = 'password' | 'passkey';

type Env = Record<string, string | undefined>;

const raw = (env: Env) => (env.SIGN_IN_METHOD ?? '').trim().toLowerCase();

/** An unknown value is refused at start (startup.ts), so the fallback here is never relied on. */
export function signInMethod(env: Env = process.env): SignInMethod {
	return raw(env) === 'passkey' ? 'passkey' : 'password';
}

/** What is wrong with the setting itself, or null. */
export function signInMethodProblem(env: Env = process.env): string | null {
	const value = raw(env);
	return value === '' || value === 'password' || value === 'passkey'
		? null
		: `SIGN_IN_METHOD is "${env.SIGN_IN_METHOD}". Use "password" or "passkey".`;
}

export const passwordsAllowed = (env: Env = process.env) => signInMethod(env) === 'password';

export const NO_PASSWORDS = 'This instance signs in with passkeys. It has no passwords.';

/** Every place that sets or checks a password asks here first. */
export function assertPasswords(env: Env = process.env): void {
	if (!passwordsAllowed(env)) throw new ForbiddenError(NO_PASSWORDS);
}
