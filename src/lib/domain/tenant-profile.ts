import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { FetchLike } from '#lib/ai/llm.ts';
import type { AppDatabase } from '#lib/db/client.ts';
import {
	assignModels,
	checkModel,
	getAiSettings,
	saveGateway,
	saveResearch,
	type AiModel
} from './ai-settings';
import { readSetting, saveSetting } from './app-settings';
import { createInvitedFirstAdmin } from './invitations';
import { builtInSources, importBuiltInSource, type BuiltInSource } from './library-import';
import type { SignInMethod } from './sign-in-method';
import type { User } from './users';
import type { Actor } from './write';

/**
 * A tenant profile (#91): one file, named by TENANT_PROFILE, from which a new instance sets itself up
 * at its first start, so it is ready before its first person signs in. It is applied once, in one
 * step: either everything it names exists afterwards, or nothing does. What was applied is recorded;
 * a later edit of the file changes nothing, so it never overwrites what the tenant's admin did since.
 */

/** A profile that cannot be used. Each line names a field of the file. */
export class ProfileError extends Error {
	constructor(
		readonly file: string,
		readonly problems: string[]
	) {
		super(`The tenant profile ${file} cannot be used:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
	}
}

export interface TenantProfile {
	instanceName: string;
	/** Unset: SIGN_IN_METHOD decides, as on any instance. */
	signInMethod: SignInMethod | null;
	firstAdmin: { name: string; email: string };
	/** Bundled library sources to load, by code. */
	librarySources: BuiltInSource[];
	ai: { baseUrl: string; apiKey: string | null; defaultModel: string; webSearch: boolean } | null;
}

const text = (max: number) =>
	z.string().trim().min(1, 'is empty').max(max, `is longer than ${max} characters`);

const FileSchema = z.strictObject({
	instance_name: text(60),
	sign_in_method: z.enum(['password', 'passkey'], 'must be "password" or "passkey"').optional(),
	first_admin: z.strictObject({
		name: text(120),
		email: z
			.string()
			.trim()
			.regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'is not an email address')
	}),
	library_sources: z.array(text(80)).optional(),
	ai: z
		.strictObject({
			base_url: z
				.string()
				.trim()
				.regex(/^https?:\/\/\S+$/i, 'must be an http or https address'),
			api_key: z.string().trim().optional(),
			default_model: text(200),
			web_search: z.boolean('must be true or false').optional()
		})
		.optional()
});

/** "first_admin.email: is missing" rather than the parser's own words. */
function describe(issue: z.core.$ZodIssue): string {
	const where = issue.path.map(String).join('.');
	if (issue.code === 'unrecognized_keys')
		return `${[where, issue.keys.join(', ')].filter(Boolean).join('.')}: is not a field of a tenant profile`;
	const missing = issue.code === 'invalid_type' && /received undefined/.test(issue.message);
	const said = missing
		? 'is missing'
		: issue.code === 'invalid_type'
			? `has the wrong kind of value (${issue.message.replace(/^Invalid input: /, '')})`
			: issue.message;
	return `${where || 'the file'}: ${said}`;
}

/** Check what a profile file holds. Every problem is found before anything is reported. */
export function parseProfile(
	raw: unknown,
	file: string,
	sources: BuiltInSource[] = builtInSources()
): TenantProfile {
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
		throw new ProfileError(file, [
			'the file: must hold the profile fields, such as instance_name and first_admin'
		]);
	const parsed = FileSchema.safeParse(raw);
	const problems = parsed.success ? [] : parsed.error.issues.map(describe);
	const wanted = Array.isArray((raw as { library_sources?: unknown }).library_sources)
		? ((raw as { library_sources: unknown[] }).library_sources.filter(
				(c) => typeof c === 'string'
			) as string[])
		: [];
	const known = new Map(sources.map((s) => [s.code, s]));
	const picked: BuiltInSource[] = [];
	wanted.forEach((code, i) => {
		const source = known.get(code.trim().toLowerCase());
		if (!source)
			problems.push(
				`library_sources.${i}: "${code}" is not a source that ships with the app. Known: ${[...known.keys()].join(', ') || 'none'}`
			);
		else if (!picked.includes(source)) picked.push(source);
	});
	if (problems.length || !parsed.success) throw new ProfileError(file, problems);
	const p = parsed.data;
	return {
		instanceName: p.instance_name,
		signInMethod: p.sign_in_method ?? null,
		firstAdmin: { name: p.first_admin.name, email: p.first_admin.email.toLowerCase() },
		librarySources: picked,
		ai: p.ai
			? {
					baseUrl: p.ai.base_url.replace(/\/+$/, ''),
					apiKey: p.ai.api_key || null,
					defaultModel: p.ai.default_model,
					webSearch: p.ai.web_search === true
				}
			: null
	};
}

/** Read and check the file TENANT_PROFILE names: YAML, or JSON, which YAML reads too. */
export function loadProfile(file: string, sources: BuiltInSource[] = builtInSources()): TenantProfile {
	let content: string;
	try {
		content = readFileSync(file, 'utf8');
	} catch (e) {
		throw new ProfileError(file, [
			`the file: cannot be read (${(e as NodeJS.ErrnoException).code ?? 'error'})`
		]);
	}
	let raw: unknown;
	try {
		raw = parseYaml(content);
	} catch (e) {
		throw new ProfileError(file, [
			`the file: is not valid YAML or JSON (${(e as Error).message.split('\n')[0]})`
		]);
	}
	return parseProfile(raw, file, sources);
}

// ---- What was applied

const KEY = 'instance.profile';

/** The record of the one time a profile was applied. Never holds the gateway key. */
export interface AppliedProfile {
	appliedAt: string;
	file: string;
	instanceName: string;
	signInMethod: SignInMethod | null;
	firstAdmin: { id: string; name: string; email: string };
	librarySources: string[];
	ai: { baseUrl: string; defaultModel: string; webSearch: boolean; keyGiven: boolean } | null;
	/** The default model passed the tool-calling check and runs the AI actions. */
	aiChecked: boolean;
}

export function appliedProfile(app: AppDatabase): AppliedProfile | null {
	return readSetting<AppliedProfile | null>(app, KEY, null);
}

/**
 * Apply a profile to a new instance, all or nothing: the first admin (invited, not yet joined), the
 * library sources and the AI settings, each through the domain's own functions and recorded as done by
 * the first admin on set-up. Returns the link token for the invitation, which is sent afterwards.
 */
export function applyProfile(
	app: AppDatabase,
	profile: TenantProfile,
	file: string,
	now = new Date()
): { user: User; token: string; record: AppliedProfile } {
	return app.sqlite.transaction(() => {
		const { user, token } = createInvitedFirstAdmin(app, profile.firstAdmin, now);
		const actor: Actor = { userId: user.id, channel: 'ui' };
		for (const source of profile.librarySources) importBuiltInSource(app, actor, source.file);
		if (profile.ai) {
			saveGateway(app, actor, { baseUrl: profile.ai.baseUrl, apiKey: profile.ai.apiKey });
			saveResearch(app, actor, { webSearch: profile.ai.webSearch });
		}
		const record: AppliedProfile = {
			appliedAt: now.toISOString(),
			file,
			instanceName: profile.instanceName,
			signInMethod: profile.signInMethod,
			firstAdmin: { id: user.id, name: user.name, email: user.email },
			librarySources: profile.librarySources.map((s) => s.code),
			ai: profile.ai
				? {
						baseUrl: profile.ai.baseUrl,
						defaultModel: profile.ai.defaultModel,
						webSearch: profile.ai.webSearch,
						keyGiven: !!profile.ai.apiKey
					}
				: null,
			aiChecked: false
		};
		saveSetting(app, KEY, record, now);
		return { user, token, record };
	})();
}

/**
 * Run the tool-calling check on the profile's default model and, when it passes, make it the model
 * that runs the AI actions. Tried at each start until it has passed once, unless an admin has chosen
 * a default model in the meantime. Null when there is nothing to do.
 */
export async function checkProfileModel(
	app: AppDatabase,
	opts: { fetch?: FetchLike; env?: Record<string, string | undefined>; now?: Date } = {}
): Promise<AiModel | null> {
	const record = appliedProfile(app);
	if (!record?.ai || record.aiChecked) return null;
	const done = () => saveSetting(app, KEY, { ...record, aiChecked: true }, opts.now);
	if (getAiSettings(app, opts.env).assignments.default) {
		done();
		return null;
	}
	const actor: Actor = { userId: record.firstAdmin.id, channel: 'ui' };
	const model = await checkModel(app, actor, record.ai.defaultModel, opts);
	if (model.check?.ok) {
		assignModels(app, actor, { default: model.id });
		done();
	}
	return model;
}
