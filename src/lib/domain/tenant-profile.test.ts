import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { fakeLlmFetch } from '../../../e2e/fake-llm.mjs';
import './entities';
import { getAiSettings, removeModel, saveResearch } from './ai-settings';
import type { MailTransport } from './email';
import { joinWithoutPasskey, readInvitation } from './invitations';
import { getItemHistory } from './items';
import { getSourceByCode, listSources } from './library';
import { needsSetup } from './setup';
import { StartupError, prepareInstance } from './startup';
import { ProfileError, appliedProfile, loadProfile, parseProfile } from './tenant-profile';
import { listUsers } from './users';

/** #91: an instance that sets itself up from a profile at its first start. */

let app: AppDatabase;
let dir: string;
let file: string;
const ORIGIN = 'https://baltic.example.test';
const ENV = { SMTP_HOST: 'mail.example.test', SMTP_FROM: 'audit@example.test', ORIGIN };
const T0 = new Date('2026-11-23T08:00:00Z');
const PROFILE = {
	instance_name: 'Baltic Audit',
	sign_in_method: 'passkey',
	first_admin: { name: 'Tia Tenant', email: 'Tia@Baltic.example.test' },
	library_sources: ['nis2'],
	ai: {
		base_url: 'http://gateway.test/',
		api_key: 'sk-tenant-secret',
		default_model: 'fake-tools',
		web_search: true
	}
};

let sent: Parameters<MailTransport['sendMail']>[0][];
const transport: MailTransport = {
	async sendMail(mail) {
		sent.push(mail);
	}
};
let lines: string[];
const fetch = fakeLlmFetch();
const write = (profile: unknown, name = 'tenant.json') => {
	file = path.join(dir, name);
	writeFileSync(file, typeof profile === 'string' ? profile : JSON.stringify(profile));
	return file;
};
function start(env: Record<string, string | undefined> = { ...ENV, TENANT_PROFILE: file }, now = T0) {
	return prepareInstance(app, { env, deps: { transport }, fetch, log: (l) => lines.push(l), now });
}
const linkIn = (text: unknown) =>
	/https:\/\/baltic\.example\.test\/join\?t=([\w-]+)/.exec(String(text))?.[1] ?? '';

beforeEach(() => {
	app = createTestDatabase();
	dir = mkdtempSync(path.join(tmpdir(), 'profile-'));
	sent = [];
	lines = [];
	write(PROFILE);
});
afterEach(() => {
	vi.unstubAllEnvs();
	app.close();
	rmSync(dir, { recursive: true, force: true });
});

describe('applying a profile at the first start', () => {
	it('loads the library, saves and checks AI, invites the first admin, and records what it did', async () => {
		const env: Record<string, string | undefined> = { ...ENV, TENANT_PROFILE: file };
		await start(env);

		// The instance's name and sign-in method, for everything that reads the settings.
		expect(env.INSTANCE_NAME).toBe('Baltic Audit');
		expect(env.SIGN_IN_METHOD).toBe('passkey');

		// The first admin: invited, not created with a password or a code from the log.
		const [tia] = listUsers(app);
		expect(tia).toMatchObject({
			name: 'Tia Tenant',
			email: 'tia@baltic.example.test',
			role: 'admin',
			invited: true
		});
		expect(sent).toHaveLength(1);
		expect(sent[0]!.to).toBe('tia@baltic.example.test');
		expect(String(sent[0]!.subject)).toContain('(Baltic Audit)');
		expect(String(sent[0]!.text)).toContain('Baltic Audit was set up with you as its first admin');
		expect(readInvitation(app, linkIn(sent[0]!.text), T0)).toMatchObject({ state: 'open', first: true });

		// The library source, written through the domain as the first admin on set-up.
		const nis2 = getSourceByCode(app, 'nis2')!;
		expect(nis2).toBeTruthy();
		expect(getItemHistory(app, 'source', nis2.id).at(-1)).toMatchObject({ authorName: 'Tia Tenant' });

		// AI: gateway saved, the key never shown, the default model checked and running the actions.
		const ai = getAiSettings(app, {});
		expect(ai).toMatchObject({
			baseUrl: 'http://gateway.test',
			baseUrlFrom: 'settings',
			hasKey: true,
			webSearch: true,
			assignments: { default: 'fake-tools' }
		});
		expect(ai.models).toEqual([{ id: 'fake-tools', check: expect.objectContaining({ ok: true }) }]);

		// What was applied, and when; never the key.
		const record = appliedProfile(app)!;
		expect(record).toEqual({
			appliedAt: T0.toISOString(),
			file,
			instanceName: 'Baltic Audit',
			signInMethod: 'passkey',
			firstAdmin: { id: tia!.id, name: 'Tia Tenant', email: 'tia@baltic.example.test' },
			librarySources: ['nis2'],
			ai: { baseUrl: 'http://gateway.test', defaultModel: 'fake-tools', webSearch: true, keyGiven: true },
			aiChecked: true
		});
		expect(JSON.stringify(record)).not.toContain('sk-tenant-secret');
		expect(lines.join('\n')).not.toContain('sk-tenant-secret');
		expect(lines[0]).toContain(`Applied the tenant profile ${file}: instance "Baltic Audit"`);
		expect(lines.join('\n')).toContain('AI: fake-tools passed the tool-calling check');
	});

	it('leaves no set-up page: with a profile nobody claims the instance with a code from the log', async () => {
		write({ ...PROFILE, sign_in_method: 'password' });
		await start();
		expect(needsSetup(app)).toBe(false);
		// An instance with passwords gets its first admin by invitation too.
		expect(listUsers(app)[0]).toMatchObject({ invited: true, role: 'admin' });
		expect(sent).toHaveLength(1);
	});

	it('is applied once: a restart and a later edit of the file change nothing', async () => {
		await start();
		const tia = listUsers(app)[0]!;
		joinWithoutPasskey(app, linkIn(sent[0]!.text), { env: { SIGN_IN_METHOD: 'passkey' }, now: T0 });
		// The tenant's admin changes what the profile set.
		const actor = { userId: tia.id, channel: 'ui' as const };
		saveResearch(app, actor, { webSearch: false });
		removeModel(app, actor, 'fake-tools');
		const before = appliedProfile(app);

		write({
			...PROFILE,
			instance_name: 'Another name',
			first_admin: { name: 'Someone Else', email: 'else@example.test' },
			library_sources: [],
			ai: { ...PROFILE.ai, default_model: 'fake-notools', web_search: true }
		});
		lines = [];
		const env: Record<string, string | undefined> = { ...ENV, TENANT_PROFILE: file };
		await start(env, new Date(T0.getTime() + 86_400_000));

		expect(lines).toEqual([]);
		expect(sent).toHaveLength(1);
		expect(listUsers(app).map((u) => u.email)).toEqual(['tia@baltic.example.test']);
		expect(appliedProfile(app)).toEqual(before);
		const ai = getAiSettings(app, {});
		expect(ai.webSearch).toBe(false);
		expect(ai.models).toEqual([]);
		// The name and the sign-in method stay what was applied, not what the file says now.
		expect(env.INSTANCE_NAME).toBe('Baltic Audit');
		expect(env.SIGN_IN_METHOD).toBe('passkey');
		// And they stay even when the file is no longer named.
		const bare: Record<string, string | undefined> = { ...ENV };
		await start(bare);
		expect(bare.INSTANCE_NAME).toBe('Baltic Audit');
	});

	it('lets the environment decide the name and the sign-in method where it sets them', async () => {
		const env: Record<string, string | undefined> = {
			...ENV,
			TENANT_PROFILE: file,
			INSTANCE_NAME: 'Named by the operator',
			SIGN_IN_METHOD: 'password'
		};
		await start(env);
		expect(env.INSTANCE_NAME).toBe('Named by the operator');
		expect(env.SIGN_IN_METHOD).toBe('password');
		expect(String(sent[0]!.subject)).toContain('(Named by the operator)');
	});

	it('is not applied to an instance that already has people', async () => {
		await start({ INITIAL_ADMIN_EMAIL: 'ada@example.test', INITIAL_ADMIN_PASSWORD: 'correct horse battery' });
		lines = [];
		await start({ ...ENV, TENANT_PROFILE: file, SIGN_IN_METHOD: 'password' });
		expect(lines[0]).toContain('already has people');
		expect(appliedProfile(app)).toBeNull();
		expect(listSources(app)).toHaveLength(0);
		expect(listUsers(app)).toHaveLength(1);
	});

	it('tries the AI check again at a later start until it has passed once', async () => {
		write({ ...PROFILE, ai: { ...PROFILE.ai, default_model: 'fake-notools' } });
		await start();
		expect(lines.join('\n')).toContain('AI: fake-notools did not pass the tool-calling check');
		expect(appliedProfile(app)!.aiChecked).toBe(false);
		expect(getAiSettings(app, {}).assignments.default).toBeUndefined();
		// The same model answers properly later (here: the gateway does).
		const working = fakeLlmFetch();
		const passes: typeof working = (url, init) =>
			working(url, {
				...init,
				body: String((init as { body?: unknown } | undefined)?.body).replace('fake-notools', 'fake-tools')
			});
		lines = [];
		await prepareInstance(app, {
			env: { ...ENV, TENANT_PROFILE: file },
			deps: { transport },
			fetch: passes,
			log: (l) => lines.push(l),
			now: T0
		});
		expect(appliedProfile(app)!.aiChecked).toBe(true);
		expect(getAiSettings(app, {}).assignments.default).toBe('fake-notools');
	});
});

describe('a profile with an error', () => {
	const refused = async (profile: unknown, ...messages: string[]) => {
		write(profile);
		const error = await start().then(
			() => null,
			(e: unknown) => e
		);
		expect(error).toBeInstanceOf(StartupError);
		for (const m of messages) expect((error as Error).message).toContain(m);
		// Nothing is half-applied.
		expect(listUsers(app)).toHaveLength(0);
		expect(listSources(app)).toHaveLength(0);
		expect(getAiSettings(app, {}).configured).toBe(false);
		expect(appliedProfile(app)).toBeNull();
		expect(sent).toHaveLength(0);
	};

	it('stops the start and names the field', async () => {
		await refused(
			{ ...PROFILE, library_sources: ['nis2', 'iso27001'] },
			'library_sources.1: "iso27001" is not a source that ships with the app. Known: nis2'
		);
		await refused({ ...PROFILE, first_admin: { name: 'Tia Tenant' } }, 'first_admin.email: is missing');
		await refused(
			{ ...PROFILE, first_admin: { name: 'Tia', email: 'not-an-address' } },
			'first_admin.email: is not an email address'
		);
		await refused({ ...PROFILE, instance_name: '  ' }, 'instance_name: is empty');
		await refused({ ...PROFILE, sign_in_method: 'sso' }, 'sign_in_method: must be "password" or "passkey"');
		await refused(
			{ ...PROFILE, ai: { ...PROFILE.ai, base_url: 'gateway.test' } },
			'ai.base_url: must be an http or https address'
		);
		await refused({ ...PROFILE, ai: { base_url: 'http://gateway.test' } }, 'ai.default_model: is missing');
		await refused({ ...PROFILE, instanse_name: 'typo' }, 'instanse_name: is not a field of a tenant profile');
	});

	it('reports every problem at once', async () => {
		await refused(
			{ sign_in_method: 'passkey', first_admin: { email: 'x' }, library_sources: ['nope'] },
			'instance_name: is missing',
			'first_admin.name: is missing',
			'first_admin.email: is not an email address',
			'library_sources.0: "nope"'
		);
	});

	it('says so for a file that is missing or not a profile', async () => {
		file = path.join(dir, 'missing.yaml');
		await expect(start()).rejects.toThrow('cannot be read (ENOENT)');
		await refused('instance_name: [unclosed', 'is not valid YAML or JSON');
		await refused('just some words', 'must hold the profile fields');
	});

	it('names the settings a profile needs around it', async () => {
		await expect(start({ TENANT_PROFILE: file, ORIGIN })).rejects.toThrow('SMTP_HOST and SMTP_FROM');
		write({ ...PROFILE, sign_in_method: 'password' });
		await expect(start({ TENANT_PROFILE: file })).rejects.toThrow(
			/TENANT_PROFILE needs email.*\n.*TENANT_PROFILE needs ORIGIN/
		);
		expect(listUsers(app)).toHaveLength(0);
	});
});

describe('the file', () => {
	it('is YAML, with only the name and the first admin required', () => {
		write(
			[
				'instance_name: Baltic Audit',
				'first_admin:',
				'  name: Tia Tenant',
				'  email: tia@baltic.example.test',
				''
			].join('\n'),
			'tenant.yaml'
		);
		expect(loadProfile(file)).toEqual({
			instanceName: 'Baltic Audit',
			signInMethod: null,
			firstAdmin: { name: 'Tia Tenant', email: 'tia@baltic.example.test' },
			librarySources: [],
			ai: null
		});
		expect(() => parseProfile([], file)).toThrow(ProfileError);
	});
});
