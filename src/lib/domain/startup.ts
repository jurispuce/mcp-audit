import type { FetchLike } from '#lib/ai/llm.ts';
import type { AppDatabase } from '#lib/db/client.ts';
import { countPasswords, removeAllPasswords } from './auth';
import { checkMailServer, emailSettings, type EmailDeps } from './email';
import { inviteFirstAdmin, resendFirstAdminInvitation, sendFirstAdminInvitation } from './invitations';
import { passkeysPossible } from './passkeys';
import { signInMethod, signInMethodProblem } from './sign-in-method';
import {
	ProfileError,
	appliedProfile,
	applyProfile,
	checkProfileModel,
	loadProfile,
	type TenantProfile
} from './tenant-profile';
import { countUsers, ensureInitialAdmin } from './users';

/**
 * What must hold before the instance takes its first request: a tenant profile, if one is named, is
 * applied to a new instance (#91); the sign-in method is one the app knows, and an instance that signs
 * in with passkeys has what that needs (#89). A problem stops the start with a message that names the
 * setting or the profile's field; nothing is changed before every check has passed.
 */

type Env = Record<string, string | undefined>;

/** A setting that keeps the instance from starting. The message is for whoever runs it. */
export class StartupError extends Error {}

const val = (env: Env, key: string) => (env[key] ?? '').trim();

/** What an instance without passwords still lacks, each named by its setting. */
export function passkeyModeProblems(
	app: AppDatabase,
	env: Env = process.env,
	firstAdminFromProfile = false
): string[] {
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
	if (countUsers(app) === 0 && !firstAdminFromProfile && !val(env, 'INITIAL_ADMIN_EMAIL'))
		problems.push(
			'SIGN_IN_METHOD=passkey needs INITIAL_ADMIN_EMAIL (and INITIAL_ADMIN_NAME) on a new instance: the first admin is invited by email, not created with a set-up code.'
		);
	return problems;
}

export interface StartupOptions {
	/** Settings to read. Where a profile sets the instance's name or sign-in method, they are written here. */
	env?: Env;
	deps?: EmailDeps;
	fetch?: FetchLike;
	log?: (line: string) => void;
	now?: Date;
}

export async function prepareInstance(app: AppDatabase, options: StartupOptions = {}): Promise<void> {
	const env = options.env ?? process.env;
	const deps = { ...options.deps, env };
	const log = options.log ?? console.log;
	const now = options.now ?? new Date();

	// ---- A tenant profile: read and checked now, applied further down once everything else holds.
	const file = val(env, 'TENANT_PROFILE');
	const record = appliedProfile(app);
	let profile: TenantProfile | null = null;
	if (file && !record) {
		if (countUsers(app) > 0) {
			log(
				`TENANT_PROFILE is set, but this instance already has people. A profile is applied at the first start only, so nothing was applied.`
			);
		} else {
			try {
				profile = loadProfile(file);
			} catch (e) {
				if (e instanceof ProfileError) throw new StartupError(e.message);
				throw e;
			}
		}
	}
	// The instance's name and sign-in method: the environment decides where it says something,
	// otherwise what the profile set, now or at the first start. A later edit of the file is not read.
	const set = profile ?? record;
	if (set) {
		if (!val(env, 'INSTANCE_NAME')) env.INSTANCE_NAME = set.instanceName;
		if (!val(env, 'SIGN_IN_METHOD') && set.signInMethod) env.SIGN_IN_METHOD = set.signInMethod;
	}

	const unknown = signInMethodProblem(env);
	if (unknown) throw new StartupError(unknown);
	const passkeys = signInMethod(env) === 'passkey';
	const origin = val(env, 'ORIGIN');

	const problems = passkeys ? passkeyModeProblems(app, env, !!profile) : [];
	if (profile && !passkeys) {
		// The first admin of a profile is invited by email whatever the sign-in method.
		if (!emailSettings(env).configured)
			problems.push(
				'TENANT_PROFILE needs email: set SMTP_HOST and SMTP_FROM. The first admin is invited by email.'
			);
		if (!origin)
			problems.push(
				"TENANT_PROFILE needs ORIGIN set to the instance's address: the link in the first admin's invitation is built from it."
			);
	}
	if (problems.length) throw new StartupError(problems.join('\n'));

	if (!passkeys && !profile) {
		const created = await ensureInitialAdmin(app, env as NodeJS.ProcessEnv);
		if (created) log(`Created the first admin ${created.email} from INITIAL_ADMIN_EMAIL.`);
	}

	if (passkeys) {
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
	}

	// ---- The first admin's invitation
	const report = (email: string, problem: string | null) =>
		log(
			problem
				? `The first admin's invitation to ${email} could not be sent: ${problem} Restart to send it again.`
				: `Sent the first admin's invitation to ${email}. The link works once, for 7 days; a restart sends a new one until they have joined.`
		);
	if (profile) {
		let applied: ReturnType<typeof applyProfile>;
		try {
			applied = applyProfile(app, profile, file, now);
		} catch (e) {
			// Nothing of the profile is kept when a part of it cannot be applied.
			throw new StartupError(`The tenant profile ${file} could not be applied: ${(e as Error).message}`);
		}
		const { record: r } = applied;
		log(
			`Applied the tenant profile ${file}: instance "${r.instanceName}", first admin ${r.firstAdmin.email}, ` +
				`library sources ${r.librarySources.join(', ') || 'none'}, AI ${r.ai ? `at ${r.ai.baseUrl} with ${r.ai.defaultModel}` : 'not set'}.`
		);
		report(
			applied.user.email,
			await sendFirstAdminInvitation(app, applied.user, applied.token, origin, { ...deps, now })
		);
	} else if (passkeys && countUsers(app) === 0) {
		const email = val(env, 'INITIAL_ADMIN_EMAIL');
		try {
			const r = await inviteFirstAdmin(
				app,
				{ name: val(env, 'INITIAL_ADMIN_NAME') || 'Admin', email },
				{ origin, now },
				deps
			);
			report(r.user.email, r.problem);
		} catch (e) {
			throw new StartupError(`INITIAL_ADMIN_EMAIL is "${email}": ${(e as Error).message}`);
		}
	} else if (origin && emailSettings(env).configured) {
		const again = await resendFirstAdminInvitation(app, { origin, now }, deps);
		if (again) report(again.user.email, again.problem);
	}

	// ---- The profile's AI model: checked now, and again at a later start until it has passed once.
	try {
		const model = await checkProfileModel(app, { fetch: options.fetch, env, now });
		if (model)
			log(
				model.check?.ok
					? `AI: ${model.id} passed the tool-calling check and runs the AI actions.`
					: `AI: ${model.id} did not pass the tool-calling check: ${model.check?.message ?? 'no answer'} It is tried again at the next start, or check it in Settings, AI.`
			);
	} catch (e) {
		log(`AI: the profile's model could not be checked: ${(e as Error).message}`);
	}
}
