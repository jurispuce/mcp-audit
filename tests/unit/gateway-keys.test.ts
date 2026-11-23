import { beforeEach, describe, expect, it } from 'vitest';
import { fakeLlmFetch, resetFakeKeys } from '../../e2e/fake-llm.mjs';
import {
	AI_BUDGET_USED_UP,
	AI_SWITCHED_OFF,
	LlmError,
	allowanceProblem,
	chat,
	keyUsage
} from '#lib/ai/llm.ts';
import {
	amount,
	configFromEnv,
	createKey,
	describe as describeKey,
	keyInfo,
	main,
	revokeKey,
	setBlocked,
	setBudget
} from '../../scripts/gateway-keys.mjs';

/**
 * #95: a key and a budget per tenant at the shared gateway, against the scripted gateway that
 * answers as LiteLLM's key management does; and the words the app has for a gateway that says no.
 */
const fetch = fakeLlmFetch();
const cfg = { url: 'http://gateway.test', masterKey: 'sk-master', fetch };
const ENV = { AI_GATEWAY_URL: 'http://gateway.test/v1/', AI_GATEWAY_MASTER_KEY: 'sk-master' };
const ask = (apiKey: string) =>
	chat(
		{ baseUrl: 'http://gateway.test', apiKey },
		{ model: 'fake-tools', messages: [{ role: 'user', content: 'hello' }] },
		{ fetch }
	);
const refusal = (apiKey: string) =>
	ask(apiKey).then(
		() => null,
		(e: unknown) => e as Error
	);

beforeEach(() => resetFakeKeys());

describe('a tenant’s key', () => {
	it('is made with a budget that starts again each period, and the models it may use', async () => {
		const key = await createKey(cfg, { tenant: 'acme', budget: 20, models: ['fake-tools'] });
		expect(key).toMatch(/^sk-/);
		expect(await keyInfo(cfg, key)).toEqual({
			spend: 0,
			budget: 20,
			period: '30d',
			resetsAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
			blocked: false,
			models: ['fake-tools']
		});
		expect(await createKey(cfg, { tenant: 'bolt', budget: 5, period: '1mo' })).not.toBe(key);
		await expect(createKey(cfg, { tenant: 'Not A Name', budget: 5 })).rejects.toThrow('is not a tenant');
	});

	it('counts what one tenant uses on that tenant only', async () => {
		const acme = await createKey(cfg, { tenant: 'acme', budget: 20 });
		const bolt = await createKey(cfg, { tenant: 'bolt', budget: 20 });
		await ask(acme);
		await ask(acme);
		expect((await keyInfo(cfg, acme)).spend).toBe(0.5);
		expect((await keyInfo(cfg, bolt)).spend).toBe(0);
		expect(describeKey(await keyInfo(cfg, acme))).toMatch(
			/^\$0\.50 of \$20\.00 used, \$19\.50 left, resets \d{4}-\d\d-\d\d$/
		);
	});

	it('stops at its budget, goes on when the budget is raised, and can be switched off and on', async () => {
		const key = await createKey(cfg, { tenant: 'acme', budget: 0.5 });
		await ask(key);
		await ask(key);
		expect((await refusal(key))?.message).toBe(AI_BUDGET_USED_UP);
		expect(describeKey(await keyInfo(cfg, key))).toContain('USED UP');

		await setBudget(cfg, key, 10);
		await ask(key);
		expect((await keyInfo(cfg, key)).budget).toBe(10);

		await setBlocked(cfg, key, true);
		expect((await refusal(key))?.message).toBe(AI_SWITCHED_OFF);
		expect(describeKey(await keyInfo(cfg, key))).toContain('SWITCHED OFF');
		// Off costs nothing and counts nothing.
		expect((await keyInfo(cfg, key)).spend).toBe(0.75);
		await setBlocked(cfg, key, false);
		await ask(key);
	});

	it('is refused for good once revoked', async () => {
		const key = await createKey(cfg, { tenant: 'acme', budget: 20 });
		await revokeKey(cfg, key);
		const error = await refusal(key);
		expect(error).toBeInstanceOf(LlmError);
		expect(error?.message).toContain('The AI gateway answered 401');
		expect(error?.message).toContain('Check the gateway key.');
		await expect(keyInfo(cfg, key)).rejects.toThrow('The AI gateway refused');
		// Revoking again is no error: the key is gone either way.
		await revokeKey(cfg, key);
	});

	it('needs the master key, and never repeats a key in a message', async () => {
		await expect(
			createKey({ ...cfg, masterKey: 'sk-wrong-master-key' }, { tenant: 'acme', budget: 1 })
		).rejects.toThrow('The AI gateway refused');
		const error = await setBudget(cfg, 'sk-unknown-key-123', 5).catch((e: Error) => e);
		expect((error as Error).message).toBe('The AI gateway refused: Key not found: sk-…');
		const down: typeof fetch = async () => {
			throw new Error('connect ECONNREFUSED');
		};
		await expect(createKey({ ...cfg, fetch: down }, { tenant: 'acme', budget: 1 })).rejects.toThrow(
			'Could not reach the AI gateway at http://gateway.test'
		);
	});
});

describe('the command', () => {
	it('prints the new key and nothing else, and takes other keys from the environment only', async () => {
		const key = await main(
			['create', 'acme', '--budget', '20', '--models', 'fake-tools, fake-slow'],
			ENV,
			fetch
		);
		expect(key).toMatch(/^sk-\S+$/);
		const env = { ...ENV, TENANT_AI_KEY: key };
		expect(await main(['info'], env, fetch)).toMatch(/^\$0\.00 of \$20\.00 used, \$20\.00 left/);
		expect(await main(['budget', '50'], env, fetch)).toMatch(/^\$0\.00 of \$50\.00 used/);
		expect(await main(['off'], env, fetch)).toContain('SWITCHED OFF');
		expect(await main(['on'], env, fetch)).not.toContain('SWITCHED OFF');
		expect(await main(['revoke'], env, fetch)).toBe('revoked');

		await expect(main(['info'], ENV, fetch)).rejects.toThrow('Give the key in TENANT_AI_KEY.');
		await expect(main(['rotate'], env, fetch)).rejects.toThrow('Usage');
		await expect(main(['create', 'acme'], ENV, fetch)).rejects.toThrow('is not a budget');
		await expect(main(['budget', 'lots'], env, fetch)).rejects.toThrow('"lots" is not a budget');
	});

	it('names the settings it needs', () => {
		expect(() => configFromEnv({})).toThrow('Set AI_GATEWAY_URL and AI_GATEWAY_MASTER_KEY (host.env).');
		expect(() => configFromEnv({ AI_GATEWAY_URL: 'gateway', AI_GATEWAY_MASTER_KEY: 'k' })).toThrow(
			'is not an http'
		);
		// What tenants use and where the keys are managed can differ; /v1 is not part of either.
		expect(configFromEnv({ ...ENV, AI_GATEWAY_ADMIN_URL: 'http://127.0.0.1:4010' }).url).toBe(
			'http://127.0.0.1:4010'
		);
		expect(configFromEnv(ENV).url).toBe('http://gateway.test');
		expect(amount('0')).toBe(0);
		expect(() => amount('-1')).toThrow('is not a budget');
		expect(() => amount('')).toThrow('is not a budget');
	});
});

describe('what the app says when the gateway says no (#95)', () => {
	it('knows a used-up budget by its type, whatever status the gateway’s version uses', () => {
		const said = {
			message: 'Budget has been exceeded! Current cost: 20.1, Max budget: 20',
			type: 'budget_exceeded'
		};
		for (const status of [400, 422, 429]) expect(allowanceProblem(status, said)).toBe(AI_BUDGET_USED_UP);
		// On the Anthropic routes the type is Anthropic's, and LiteLLM's own is in another field.
		expect(
			allowanceProblem(429, {
				message: 'rate limited',
				type: 'rate_limit_error',
				litellm_error_type: 'budget_exceeded'
			})
		).toBe(AI_BUDGET_USED_UP);
		expect(allowanceProblem(400, 'ExceededBudget: Budget has been exceeded for this key')).toBe(
			AI_BUDGET_USED_UP
		);
	});

	it('knows a key that was switched off, and leaves other refusals as they are', () => {
		expect(
			allowanceProblem(401, {
				message: "Authentication Error, Key is blocked. Update via `/key/unblock` if you're admin."
			})
		).toBe(AI_SWITCHED_OFF);
		expect(
			allowanceProblem(401, { message: 'Authentication Error, Invalid proxy server token passed.' })
		).toBeNull();
		expect(
			allowanceProblem(429, { message: 'Rate limit reached for requests', type: 'rate_limit_error' })
		).toBeNull();
		expect(allowanceProblem(500, { message: 'A request was blocked upstream' })).toBeNull();
		expect(allowanceProblem(400, undefined)).toBeNull();
	});

	it('says it in words a person can act on, without a status code or the gateway’s own text', async () => {
		for (const [key, words] of [
			['sk-budget-used', AI_BUDGET_USED_UP],
			['sk-switched-off', AI_SWITCHED_OFF]
		] as const) {
			const error = await refusal(key);
			expect(error).toBeInstanceOf(LlmError);
			expect(error?.message).toBe(words);
			expect(error?.message).not.toMatch(/\d{3}|exceeded|blocked/i);
		}
	});
});

describe('what an instance sees of its own budget', () => {
	it('asks the gateway with its own key, and shows nothing when the gateway does not say', async () => {
		const key = await createKey(cfg, { tenant: 'acme', budget: 20 });
		await ask(key);
		expect(await keyUsage({ baseUrl: 'http://gateway.test/v1', apiKey: key }, { fetch })).toEqual({
			spend: 0.25,
			budget: 20,
			resetsAt: expect.stringMatching(/^\d{4}-/),
			blocked: false
		});
		// A key reads its own figures only.
		const other = await createKey(cfg, { tenant: 'bolt', budget: 5 });
		const res = await fetch(`http://gateway.test/key/info?key=${other}`, {
			headers: { authorization: `Bearer ${key}` }
		});
		expect(res.status).toBe(403);
		// No key, a gateway that is not LiteLLM, or one that is down: no figure, and no error.
		expect(await keyUsage({ baseUrl: 'http://gateway.test', apiKey: null }, { fetch })).toBeNull();
		expect(
			await keyUsage({ baseUrl: 'http://gateway.test', apiKey: 'sk-not-from-here' }, { fetch })
		).toBeNull();
		const down: typeof fetch = async () => {
			throw new Error('down');
		};
		expect(await keyUsage({ baseUrl: 'http://gateway.test', apiKey: key }, { fetch: down })).toBeNull();
	});
});
