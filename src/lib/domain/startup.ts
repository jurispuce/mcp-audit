import type { AppDatabase } from '#lib/db/client.ts';
import { countPasswords, removeAllPasswords } from './auth';
import { checkMailServer, emailSettings, type EmailDeps } from './email';
import { inviteFirstAdmin, resendFirstAdminInvitation, type InvitationResult } from './invitations';
import { passkeysPossible } from './passkeys';
import { signInMethod, signInMethodProblem } from './sign-in-method';
import { countUsers, ensureInitialAdmin } from './users';

/**
 * What must hold before the instance takes its first request (#89): the sign-in method is one the
 * app knows, and an instance that signs in with passkeys has what that needs. A problem stops the
 * start with a message that names the setting; nothing is changed before every check has passed.
 */

type Env = Record<string, string | undefined>;

/** A setting that keeps the instance from starting. The message is for whoever runs it. */
export class StartupError extends Error {}

const val = (env: Env, key: string) => (env[key] ?? '').trim();

/** What an instance without passwords still lacks, each named by its setting. */
export function passkeyModeProblems(app: AppDatabase, env: Env = process.env): string[] {
	const problems: string[] = [];
	if (!emailSettings(env).configured)
		problems.push(
			'SIGN_IN_METHOD=passkey needs email: set SMTP_HOST and SMTP_FROM. People join by an emailed invitation and get back in with an emailed code.'
		);
	const origin = val(env, 'ORIGIN');
	if (!origin || !passkeysPossible(origin))
		problems.push(
			"SIGN_IN_METHOD=passkey needs ORIGIN set to the instance's https address with a host name: browsers give passkeys nowhere else, and the links in emails are built from it."
		);
	if (countUsers(app) === 0 && !val(env, 'INITIAL_ADMIN_EMAIL'))
		problems.push(
			'SIGN_IN_METHOD=passkey needs INITIAL_ADMIN_EMAIL (and INITIAL_ADMIN_NAME) on a new instance: the first admin is invited by email, not created with a set-up code.'
		);
	return problems;
}

export async function prepareSignIn(
	app: AppDatabase,
	options: { env?: Env; deps?: EmailDeps; log?: (line: string) => void } = {}
): Promise<void> {
	const env = options.env ?? process.env;
	const deps = { ...options.deps, env };
	const log = options.log ?? console.log;

	const unknown = signInMethodProblem(env);
	if (unknown) throw new StartupError(unknown);

	if (signInMethod(env) === 'password') {
		const created = await ensureInitialAdmin(app, env as NodeJS.ProcessEnv);
		if (created) log(`Created the first admin ${created.email} from INITIAL_ADMIN_EMAIL.`);
		return;
	}

	const problems = passkeyModeProblems(app, env);
	if (problems.length) throw new StartupError(problems.join('\n'));

	// Moving an instance from passwords to passkeys: once the passwords are gone, email is the way in
	// for everyone who has no passkey yet. So the mail server must answer before anything is deleted.
	const passwords = countPasswords(app);
	if (passwords > 0) {
		const mail = await checkMailServer(deps);
		if (mail)
			throw new StartupError(
				`SIGN_IN_METHOD=passkey would delete ${passwords} stored ${passwords === 1 ? 'password' : 'passwords'}, and people would then need email to sign in, but: ${mail} Nothing was changed. Fix the email settings, or go back to SIGN_IN_METHOD=password.`
			);
		removeAllPasswords(app);
		log(
			`Deleted ${passwords} stored ${passwords === 1 ? 'password' : 'passwords'}: this instance signs in with passkeys. People sign in next with a code by email and add a passkey.`
		);
	}

	const origin = val(env, 'ORIGIN');
	const report = (r: InvitationResult) =>
		log(
			r.problem
				? `The first admin's invitation to ${r.user.email} could not be sent: ${r.problem} Restart to send it again.`
				: `Sent the first admin's invitation to ${r.user.email}. The link works once, for 7 days; a restart sends a new one until they have joined.`
		);
	if (countUsers(app) === 0) {
		const email = val(env, 'INITIAL_ADMIN_EMAIL');
		try {
			report(
				await inviteFirstAdmin(
					app,
					{ name: val(env, 'INITIAL_ADMIN_NAME') || 'Admin', email },
					{ origin },
					deps
				)
			);
		} catch (e) {
			throw new StartupError(`INITIAL_ADMIN_EMAIL is "${email}": ${(e as Error).message}`);
		}
	} else {
		const again = await resendFirstAdminInvitation(app, { origin }, deps);
		if (again) report(again);
	}
}
