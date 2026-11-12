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
	| { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
	| { role: 'tool'; tool_call_id: string; content: string };

export interface ToolDefinition {
	type: 'function';
	function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatResult {
	content: string | null;
	toolCalls: ToolCall[];
	finishReason: string | null;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Raised for anything the gateway or model got wrong, with a message a person can act on. */
export class LlmError extends Error {}

const DEFAULT_TIMEOUT_MS = 120_000;

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
			const body = JSON.parse(text) as { error?: { message?: string } | string };
			detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? detail);
		} catch {
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

/** One chat completion. Returns the first choice's text and tool calls. */
export async function chat(
	gw: Gateway,
	body: { model: string; messages: ChatMessage[]; tools?: ToolDefinition[]; max_tokens?: number },
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
		choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[];
	};
	const choice = json.choices?.[0];
	if (!choice?.message) throw new LlmError('The model returned no answer.');
	return {
		content: choice.message.content ?? null,
		toolCalls: (choice.message.tool_calls ?? []).filter((c) => c?.function?.name),
		finishReason: choice.finish_reason ?? null
	};
}

/** Model names the gateway offers, for picking from a list. */
export async function listGatewayModels(gw: Gateway, opts: { fetch?: FetchLike } = {}): Promise<string[]> {
	const json = (await request(gw, '/models', { method: 'GET' }, { ...opts, timeoutMs: 20_000 })) as {
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
				max_tokens: 200,
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
			{ ...opts, timeoutMs: 60_000 }
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
