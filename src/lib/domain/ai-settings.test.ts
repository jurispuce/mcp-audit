import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { checkToolCalling, endpoint } from '#lib/ai/llm.ts';
import { fakeLlmFetch } from '../../../e2e/fake-llm.mjs';
import './entities';
import {
	aiAvailable,
	assignModels,
	checkModel,
	gatewayModels,
	gatewayOf,
	getAiSettings,
	removeModel,
	resolveModel,
	saveGateway
} from './ai-settings';
import { createEngagement, getEngagement, updateEngagement } from './engagements';
import { createFirstAdmin, createUser } from './users';
import type { Actor } from './write';

let app: AppDatabase;
let admin: Actor;
let auditor: Actor;
const fetch = fakeLlmFetch();
const env = {};

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Juris',
		email: 'juris@example.test',
		password: 'correct horse battery'
	});
	admin = { userId: a.id, channel: 'ui' };
	const { user } = await createUser(app, admin, {
		name: 'Anna',
		email: 'anna@example.test',
		role: 'auditor'
	});
	auditor = { userId: user.id, channel: 'ui' };
});
afterEach(() => app.close());

describe('gateway client', () => {
	it('builds the OpenAI path with or without /v1 in the address', () => {
		expect(endpoint({ baseUrl: 'http://gw:4000/', apiKey: null }, '/models')).toBe(
			'http://gw:4000/v1/models'
		);
		expect(endpoint({ baseUrl: 'https://gw/v1', apiKey: null }, '/models')).toBe('https://gw/v1/models');
	});

	it('the tool-calling check passes a model that calls the tool and fails one that does not', async () => {
		const gw = { baseUrl: 'http://fake', apiKey: 'k' };
		expect(await checkToolCalling(gw, 'fake-tools', { fetch })).toMatchObject({ ok: true });
		expect(await checkToolCalling(gw, 'fake-notools', { fetch })).toMatchObject({
			ok: false,
			message: 'The model answered without calling the tool.'
		});
		const missing = await checkToolCalling(gw, 'nope', { fetch });
		expect(missing.ok).toBe(false);
		expect(missing.message).toContain('404');
	});
});

describe('AI settings (#63)', () => {
	it('saves the gateway; the key is write-only and environment values are defaults', () => {
		expect(
			getAiSettings(app, { LITELLM_BASE_URL: 'http://env:4000', LITELLM_API_KEY: 'sk-env' })
		).toMatchObject({
			baseUrl: 'http://env:4000',
			baseUrlFrom: 'environment',
			hasKey: true,
			keyFrom: 'environment',
			configured: true
		});
		saveGateway(app, admin, { baseUrl: 'http://litellm:4000/', apiKey: 'sk-secret' });
		const s = getAiSettings(app, env);
		expect(s).toMatchObject({ baseUrl: 'http://litellm:4000', baseUrlFrom: 'settings', hasKey: true });
		expect(JSON.stringify(s)).not.toContain('sk-secret');
		expect(gatewayOf(app, env)).toEqual({ baseUrl: 'http://litellm:4000', apiKey: 'sk-secret' });

		saveGateway(app, admin, { baseUrl: 'http://litellm:4000', apiKey: '' });
		expect(gatewayOf(app, env)?.apiKey).toBe('sk-secret');
		saveGateway(app, admin, { baseUrl: 'http://litellm:4000', clearKey: true });
		expect(gatewayOf(app, env)?.apiKey).toBeNull();

		expect(() => saveGateway(app, admin, { baseUrl: 'ftp://x' })).toThrow(/http or https/);
	});

	it('only an admin changes AI settings', async () => {
		expect(() => saveGateway(app, auditor, { baseUrl: 'http://x' })).toThrow(/admin/);
		await expect(checkModel(app, auditor, 'fake-tools', { fetch, env })).rejects.toThrow(/admin/);
		expect(() => assignModels(app, auditor, { default: 'fake-tools' })).toThrow(/admin/);
	});

	it('lists the gateway models and stores each model with its tool-calling check', async () => {
		saveGateway(app, admin, { baseUrl: 'http://fake' });
		expect(await gatewayModels(app, admin, { fetch, env })).toEqual([
			'fake-broken',
			'fake-notools',
			'fake-slow',
			'fake-tools'
		]);
		const good = await checkModel(app, admin, 'fake-tools', { fetch, env });
		const bad = await checkModel(app, admin, 'fake-notools', { fetch, env });
		expect(good.check?.ok).toBe(true);
		expect(bad.check).toMatchObject({ ok: false, message: 'The model answered without calling the tool.' });
		expect(getAiSettings(app, env).models.map((m) => m.id)).toEqual(['fake-notools', 'fake-tools']);
		expect(aiAvailable(app, env)).toBe(true);
	});

	it('a model that failed the check cannot be assigned to an action', async () => {
		saveGateway(app, admin, { baseUrl: 'http://fake' });
		await checkModel(app, admin, 'fake-tools', { fetch, env });
		await checkModel(app, admin, 'fake-notools', { fetch, env });
		expect(() => assignModels(app, admin, { draft_plan: 'fake-notools' })).toThrow(/tool-calling check/);
		expect(() => assignModels(app, admin, { draft_plan: 'never-checked' })).toThrow(/tool-calling check/);
		assignModels(app, admin, { default: 'fake-tools', draft_plan: 'fake-tools' });
		expect(getAiSettings(app, env).assignments).toEqual({ default: 'fake-tools', draft_plan: 'fake-tools' });
	});

	it('resolves the model per action, falling back to the default', async () => {
		expect(() => resolveModel(app, 'draft_plan', null, env)).toThrow(/not set up/);
		saveGateway(app, admin, { baseUrl: 'http://fake' });
		expect(() => resolveModel(app, 'draft_plan', null, env)).toThrow(/No model is set for "Draft plan"/);
		await checkModel(app, admin, 'fake-tools', { fetch, env });
		await checkModel(app, admin, 'fake-slow', { fetch, env });
		assignModels(app, admin, { default: 'fake-tools', propose_findings: 'fake-slow' });
		expect(resolveModel(app, 'draft_plan', null, env).model).toBe('fake-tools');
		expect(resolveModel(app, 'propose_findings', null, env).model).toBe('fake-slow');
	});

	it("an engagement's llm_profile limits it to one checked model", async () => {
		saveGateway(app, admin, { baseUrl: 'http://fake' });
		await checkModel(app, admin, 'fake-tools', { fetch, env });
		await checkModel(app, admin, 'fake-slow', { fetch, env });
		await checkModel(app, admin, 'fake-notools', { fetch, env });
		assignModels(app, admin, { default: 'fake-tools' });
		const e = createEngagement(app, admin, {
			auditeeName: 'Baltic Freight SIA',
			name: 'NIS 2 audit',
			startDate: '2026-11-01'
		});
		expect(() => updateEngagement(app, admin, e.id, e.version, { llm_profile: 'fake-notools' })).toThrow(
			/tool-calling check/
		);
		const limited = updateEngagement(app, admin, e.id, e.version, { llm_profile: 'fake-slow' });
		expect(resolveModel(app, 'draft_plan', limited, env).model).toBe('fake-slow');

		// Removing the model it is limited to stops AI on that engagement rather than falling back.
		removeModel(app, admin, 'fake-slow');
		expect(() => resolveModel(app, 'draft_plan', getEngagement(app, e.id), env)).toThrow(
			/limited to the model fake-slow/
		);
	});

	it('a model that fails a re-check loses its actions', async () => {
		saveGateway(app, admin, { baseUrl: 'http://fake' });
		await checkModel(app, admin, 'fake-tools', { fetch, env });
		assignModels(app, admin, { default: 'fake-tools', draft_plan: 'fake-tools' });
		const failing = (async () =>
			new Response(JSON.stringify({ choices: [{ message: { content: 'no tools today' } }] }), {
				status: 200
			})) as typeof globalThis.fetch;
		await checkModel(app, admin, 'fake-tools', { fetch: failing, env });
		expect(getAiSettings(app, env).assignments).toEqual({});
		expect(aiAvailable(app, env)).toBe(false);
	});
});
