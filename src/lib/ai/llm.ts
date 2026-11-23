/**
 * A small client for an OpenAI-compatible chat API, which is what a LiteLLM gateway exposes for every
 * model behind it (Claude, other providers, local models). Only the parts the job runner needs:
 * chat completions with tools, the model list, and the tool-calling check.
 */

export interface Gateway {
	baseUrl: string;
	apiKey: string | null;
}

export interface ToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

export type ChatMessage =
	| { role: 'system' | 'user'; content: string }
	// Other fields the gateway returns (for example LiteLLM's thinking_blocks) are passed back as they came.
	| { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; [extra: string]: unknown }
	| { role: 'tool'; tool_call_id: string; content: string };

export interface ToolDefinition {
	type: 'function';
	function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatResult {
	content: string | null;
	toolCalls: ToolCall[];
	finishReason: string | null;
	/**
	 * The assistant message exactly as the gateway returned it. Models that think before calling tools
	 * (Claude, through LiteLLM's thinking_blocks) need it sent back unchanged on the next request.
	 */
	message: Extract<ChatMessage, { role: 'assistant' }>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Raised for anything the gateway or model got wrong, with a message a person can act on. */
export class LlmError extends Error {}

/**
 * Refusals that are about this instance's allowance at the gateway, not about the request (#95):
 * said in words, because the person pressing an AI button can do nothing about a status code.
 */
export const AI_BUDGET_USED_UP =
	'The AI budget of this instance is used up for now. An admin can see on Settings, AI when it resets; the person who runs the instance can raise it.';
export const AI_SWITCHED_OFF =
	'AI is switched off for this instance by the person who runs it. Everything else works as usual.';

/**
 * Whether a gateway's refusal is one of those. LiteLLM marks a used-up budget with the type
 * `budget_exceeded` (status 422 in LiteLLM 1.110; 400 or 429 in other versions), and answers 401
 * "Key is blocked" for a key that was switched off.
 */
export function allowanceProblem(
	status: number,
	error: { message?: string; type?: string; litellm_error_type?: string } | string | undefined
): string | null {
	const e = typeof error === 'string' ? { message: error } : (error ?? {});
	const said = e.message ?? '';
	if (
		e.type === 'budget_exceeded' ||
		e.litellm_error_type === 'budget_exceeded' ||
		/budget has been exceeded|exceeded (?:the |its |your )?(?:max(?:imum)? )?budget/i.test(said)
	)
		return AI_BUDGET_USED_UP;
	if (status === 401 && /\bblocked\b/i.test(said)) return AI_SWITCHED_OFF;
	return null;
}

/** A long agent turn can take minutes; the gateway itself may time out sooner. */
const DEFAULT_TIMEOUT_MS = 600_000;

/**
 * Calls a person waits for in a request (Settings, AI), not in a background job. Behind Cloudflare a
 * request must start answering within 100 seconds (#92), so these give up well before that.
 */
export const MODEL_LIST_TIMEOUT_MS = 20_000;
export const MODEL_CHECK_TIMEOUT_MS = 60_000;

/** `https://gw` and `https://gw/v1` both work: LiteLLM serves the OpenAI paths under /v1. */
export function endpoint(gw: Gateway, path: string): string {
	const base = gw.baseUrl.trim().replace(/\/+$/, '');
	return base.endsWith('/v1') ? `${base}${path}` : `${base}/v1${path}`;
}

function headers(gw: Gateway): Record<string, string> {
	const h: Record<string, string> = { 'content-type': 'application/json' };
	if (gw.apiKey) h.authorization = `Bearer ${gw.apiKey}`;
	return h;
}

async function request(
	gw: Gateway,
	path: string,
	init: RequestInit,
	opts: { fetch?: FetchLike; signal?: AbortSignal; timeoutMs?: number }
): Promise<unknown> {
	const doFetch = opts.fetch ?? fetch;
	const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
	let res: Response;
	try {
		res = await doFetch(endpoint(gw, path), { ...init, headers: headers(gw), signal });
	} catch (e) {
		if (opts.signal?.aborted) throw new LlmError('Cancelled.');
		if (timeout.aborted) throw new LlmError('The AI gateway did not answer in time.');
		throw new LlmError(`Could not reach the AI gateway at ${gw.baseUrl}: ${(e as Error).message}`);
	}
	const text = await res.text();
	if (!res.ok) {
		let detail = text.slice(0, 300);
		try {
			const body = JSON.parse(text) as { error?: { message?: string; type?: string } | string };
			const allowance = allowanceProblem(res.status, body.error);
			if (allowance) throw new LlmError(allowance);
			detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? detail);
		} catch (e) {
			if (e instanceof LlmError) throw e;
			// not JSON: keep the text
		}
		const hint = res.status === 401 || res.status === 403 ? ' Check the gateway key.' : '';
		throw new LlmError(`The AI gateway answered ${res.status}: ${detail}${hint}`);
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new LlmError('The AI gateway answered with something that is not JSON.');
	}
}

/** What a gateway key has used of its budget (#95). LiteLLM answers this for the key that asks. */
export interface KeyUsage {
	spend: number;
	/** Null: no limit on this key. */
	budget: number | null;
	/** When the spend goes back to zero, if the gateway says. */
	resetsAt: string | null;
	blocked: boolean;
}

/**
 * Ask the gateway what this key has used. Null when there is no key, the gateway is not LiteLLM, or
 * it does not say: the figure is a courtesy, never something an action waits for.
 */
export async function keyUsage(gw: Gateway, opts: { fetch?: FetchLike } = {}): Promise<KeyUsage | null> {
	if (!gw.apiKey) return null;
	const root = gw.baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
	try {
		const res = await (opts.fetch ?? fetch)(`${root}/key/info`, {
			headers: headers(gw),
			signal: AbortSignal.timeout(4_000)
		});
		const body = (await res.json().catch(() => ({}))) as {
			info?: Record<string, unknown>;
			error?: { message?: string } | string;
		};
		// A key that is switched off is refused here as well: say so, without figures.
		if (allowanceProblem(res.status, body.error) === AI_SWITCHED_OFF)
			return { spend: 0, budget: null, resetsAt: null, blocked: true };
		if (!res.ok) return null;
		const info = body.info;
		if (!info || typeof info.spend !== 'number') return null;
		return {
			spend: info.spend,
			budget: typeof info.max_budget === 'number' ? info.max_budget : null,
			resetsAt: typeof info.budget_reset_at === 'string' ? info.budget_reset_at : null,
			blocked: info.blocked === true
		};
	} catch {
		return null;
	}
}

/** One chat completion. Returns the first choice's text and tool calls. */
export async function chat(
	gw: Gateway,
	body: {
		model: string;
		messages: ChatMessage[];
		tools?: ToolDefinition[];
		max_tokens?: number;
		/** OpenAI-style web search; LiteLLM passes it on to models that can search. */
		web_search_options?: { search_context_size?: 'low' | 'medium' | 'high' };
	},
	opts: { fetch?: FetchLike; signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ChatResult> {
	const payload: Record<string, unknown> = { ...body };
	if (body.tools?.length) payload.tool_choice = 'auto';
	else delete payload.tools;
	const json = (await request(
		gw,
		'/chat/completions',
		{ method: 'POST', body: JSON.stringify(payload) },
		opts
	)) as {
		choices?: {
			message?: { content?: string | null; tool_calls?: ToolCall[]; [extra: string]: unknown };
			finish_reason?: string;
		}[];
	};
	const choice = json.choices?.[0];
	if (!choice?.message) throw new LlmError('The model returned no answer.');
	const toolCalls = (choice.message.tool_calls ?? []).filter((c) => c?.function?.name);
	const message: ChatResult['message'] = {
		...choice.message,
		role: 'assistant',
		content: choice.message.content ?? null
	};
	if (toolCalls.length) message.tool_calls = toolCalls;
	else delete message.tool_calls;
	return {
		content: message.content,
		toolCalls,
		finishReason: choice.finish_reason ?? null,
		message
	};
}

/** Model names the gateway offers, for picking from a list. */
export async function listGatewayModels(gw: Gateway, opts: { fetch?: FetchLike } = {}): Promise<string[]> {
	const json = (await request(
		gw,
		'/models',
		{ method: 'GET' },
		{ ...opts, timeoutMs: MODEL_LIST_TIMEOUT_MS }
	)) as {
		data?: { id?: string }[];
	};
	return (json.data ?? [])
		.map((m) => m.id)
		.filter((id): id is string => typeof id === 'string' && id.length > 0)
		.sort();
}

export const CHECK_TOOL = 'record_check';

/**
 * The tool-calling check: ask the model to call one tool with a given argument. In-app actions are agent
 * loops, so a model that cannot call tools reliably cannot run them.
 */
export async function checkToolCalling(
	gw: Gateway,
	model: string,
	opts: { fetch?: FetchLike } = {}
): Promise<{ ok: boolean; message: string }> {
	const word = 'audit-check-ok';
	try {
		const res = await chat(
			gw,
			{
				model,
				// Room to reason first: some models (Claude Opus 5.5) always think before they answer.
				max_tokens: 4000,
				messages: [
					{ role: 'system', content: 'You are being tested for tool use. Answer only by calling the tool.' },
					{ role: 'user', content: `Call the ${CHECK_TOOL} tool with value "${word}".` }
				],
				tools: [
					{
						type: 'function',
						function: {
							name: CHECK_TOOL,
							description: 'Records the result of the check.',
							parameters: {
								type: 'object',
								properties: { value: { type: 'string' } },
								required: ['value']
							}
						}
					}
				]
			},
			{ ...opts, timeoutMs: MODEL_CHECK_TIMEOUT_MS }
		);
		const call = res.toolCalls.find((c) => c.function.name === CHECK_TOOL);
		if (!call) return { ok: false, message: 'The model answered without calling the tool.' };
		let args: { value?: unknown };
		try {
			args = JSON.parse(call.function.arguments || '{}');
		} catch {
			return { ok: false, message: 'The model called the tool with arguments that are not JSON.' };
		}
		if (args.value !== word) {
			return { ok: false, message: 'The model called the tool but with the wrong argument.' };
		}
		return { ok: true, message: 'The model called the tool correctly.' };
	} catch (e) {
		return { ok: false, message: e instanceof Error ? e.message : String(e) };
	}
}
