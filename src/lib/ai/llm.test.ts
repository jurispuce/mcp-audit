import { describe, expect, it } from 'vitest';
import {
	AI_BUDGET_USED_UP,
	AI_SWITCHED_OFF,
	LlmError,
	allowanceProblem,
	chat,
	keyUsage,
	type FetchLike
} from './llm';

// What LiteLLM 1.110.2 answered when it was tried for #95, word for word.
const BUDGET_EXCEEDED = {
	error: {
		message:
			'Budget has been exceeded! Key=mcp-audit-tenant-acme (sk-...bVfg) Current cost: 0.05000000000000284, Max budget: 0.05',
		type: 'budget_exceeded',
		param: null,
		code: '422'
	}
};
const KEY_BLOCKED = {
	error: {
		message: "Authentication Error, Key is blocked. Update via `/key/unblock` if you're an admin.",
		type: 'auth_error',
		param: null,
		code: '401'
	}
};
const UNKNOWN_KEY = {
	error: {
		message: 'Authentication Error, Invalid API key provided.',
		type: 'token_not_found_in_db',
		param: 'key',
		code: '401'
	}
};
const KEY_INFO = {
	key: '7478468fdf7598cedb2606e46c921db37822dbdd159e843ca340790fbdee14f4',
	info: {
		key_name: 'sk-...IxBw',
		key_alias: 'mcp-audit-tenant-acme',
		spend: 0.05,
		models: ['claude'],
		blocked: null,
		max_budget: 20,
		budget_duration: '30d',
		budget_reset_at: '2026-12-01T00:00:00+00:00'
	}
};

const gw = { baseUrl: 'http://gateway.test:4000/v1', apiKey: 'sk-tenant' };
const answering =
	(status: number, body: unknown, seen: string[] = []): FetchLike =>
	async (input) => {
		seen.push(input);
		return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	};
const ask = (f: FetchLike) =>
	chat(gw, { model: 'claude', messages: [{ role: 'user', content: 'hello' }] }, { fetch: f });

describe('a refusal about the instance’s allowance (#95)', () => {
	it('is told apart from any other refusal', () => {
		expect(allowanceProblem(422, BUDGET_EXCEEDED.error)).toBe(AI_BUDGET_USED_UP);
		expect(allowanceProblem(401, KEY_BLOCKED.error)).toBe(AI_SWITCHED_OFF);
		expect(allowanceProblem(401, UNKNOWN_KEY.error)).toBeNull();
		expect(allowanceProblem(500, { message: 'Internal error' })).toBeNull();
		expect(allowanceProblem(429, { message: 'Rate limit reached', type: 'rate_limit_error' })).toBeNull();
		expect(allowanceProblem(200, undefined)).toBeNull();
	});

	it('is known by its type whatever status the gateway’s version gives', () => {
		for (const status of [400, 422, 429])
			expect(allowanceProblem(status, { type: 'budget_exceeded', message: 'x' })).toBe(AI_BUDGET_USED_UP);
		// On the Anthropic-style routes the type is in another field.
		expect(allowanceProblem(400, { litellm_error_type: 'budget_exceeded' })).toBe(AI_BUDGET_USED_UP);
		// And by its words where a version gives no type.
		expect(allowanceProblem(400, 'Budget has been exceeded! Current cost: 20, Max budget: 20')).toBe(
			AI_BUDGET_USED_UP
		);
	});

	it('reaches the person in words, without a status code or a key', async () => {
		const used = await ask(answering(422, BUDGET_EXCEEDED)).catch((e) => e);
		expect(used).toBeInstanceOf(LlmError);
		expect(used.message).toBe(AI_BUDGET_USED_UP);
		expect(used.message).not.toMatch(/422|sk-|Key=/);

		const off = await ask(answering(401, KEY_BLOCKED)).catch((e) => e);
		expect(off.message).toBe(AI_SWITCHED_OFF);

		// A wrong key stays what it was: a gateway problem for the admin.
		const wrong = await ask(answering(401, UNKNOWN_KEY)).catch((e) => e);
		expect(wrong.message).toContain('The AI gateway answered 401');
		expect(wrong.message).toContain('Check the gateway key.');
	});
});

describe('what a key has used of its budget (#95)', () => {
	it('is read from the gateway’s key management, beside the model routes', async () => {
		const seen: string[] = [];
		expect(await keyUsage(gw, { fetch: answering(200, KEY_INFO, seen) })).toEqual({
			spend: 0.05,
			budget: 20,
			resetsAt: '2026-12-01T00:00:00+00:00',
			blocked: false
		});
		expect(seen).toEqual(['http://gateway.test:4000/key/info']);
	});

	it('says no limit where the key has none', async () => {
		const noLimit = { info: { ...KEY_INFO.info, max_budget: null, budget_reset_at: null } };
		expect(await keyUsage(gw, { fetch: answering(200, noLimit) })).toEqual({
			spend: 0.05,
			budget: null,
			resetsAt: null,
			blocked: false
		});
	});

	it('says switched off for a key that is blocked, which the gateway refuses here too', async () => {
		expect(await keyUsage(gw, { fetch: answering(401, KEY_BLOCKED) })).toEqual({
			spend: 0,
			budget: null,
			resetsAt: null,
			blocked: true
		});
	});

	it('is nothing, and never an error, where the gateway does not tell', async () => {
		expect(
			await keyUsage({ baseUrl: gw.baseUrl, apiKey: '' }, { fetch: answering(200, KEY_INFO) })
		).toBeNull();
		expect(await keyUsage(gw, { fetch: answering(401, UNKNOWN_KEY) })).toBeNull();
		expect(await keyUsage(gw, { fetch: answering(404, { detail: 'Not Found' }) })).toBeNull();
		expect(await keyUsage(gw, { fetch: answering(200, { models: [] }) })).toBeNull();
		expect(
			await keyUsage(gw, {
				fetch: async () => {
					throw new Error('connect ECONNREFUSED');
				}
			})
		).toBeNull();
	});
});
