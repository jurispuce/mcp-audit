// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- an untyped JavaScript test double
// @ts-nocheck: a plain JavaScript test double; its callers are typed.
// A scripted stand-in for a LiteLLM gateway (OpenAI-compatible), for tests only. It never calls a
// real model. The job runner's first user message carries "Action: <key>" and a "Context: {json}"
// line; each action has a short script that calls the app's real tools in order and then answers.
//
// Models:
//   fake-tools    passes the tool-calling check and runs the scripts
//   fake-notools  answers in text only, so it fails the check
//   fake-slow     like fake-tools but waits 1.5 s per answer and never finishes (to test cancel)
//   fake-broken   passes the check, then fails every agent call with a gateway error
//
// Run on its own: `node e2e/fake-llm.mjs` (PORT, default 4999). Tests import `fakeLlmFetch`.

import http from 'node:http';

const MODELS = ['fake-broken', 'fake-notools', 'fake-slow', 'fake-tools'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let callSeq = 0;
function toolCall(name, args) {
	callSeq += 1;
	return { id: `call_${callSeq}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function parseJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** Results of earlier tool calls, oldest first, parsed from the tool messages. */
function toolResults(messages) {
	return messages.filter((m) => m.role === 'tool').map((m) => parseJson(m.content) ?? { error: m.content });
}

function contextOf(messages) {
	const user = messages.find((m) => m.role === 'user')?.content ?? '';
	const action = /Action:\s*([a-z_]+)/.exec(user)?.[1] ?? '';
	const ctx = parseJson(/Context:\s*(\{.*\})/.exec(user)?.[1] ?? '{}') ?? {};
	return { action, ctx };
}

const SCRIPTS = {
	derive_roles: [
		({ ctx }) => [toolCall('list_artifacts', { engagement_id: ctx.engagement_id })],
		({ ctx, results }) => [
			toolCall('upsert_people', {
				engagement_id: ctx.engagement_id,
				people: [
					{
						role: 'Backup administrator',
						name: 'Ilze Kalniņa',
						source_document: results[0]?.artifacts?.[0]?.title ?? null,
						source_section: '3.1'
					}
				]
			})
		]
	],
	extract_internal: [
		({ ctx }) => [toolCall('list_artifacts', { engagement_id: ctx.engagement_id })],
		({ ctx, results }) => {
			const docs = results[0]?.artifacts ?? [];
			const doc = docs.find((d) => d.id === ctx.artifact_id) ?? docs[0];
			return [
				toolCall('upsert_internal_requirements', {
					engagement_id: ctx.engagement_id,
					...(doc ? { artifact_id: doc.id } : {}),
					requirements: [{ title: 'Backups are restored as a test every quarter', section: '4.2' }]
				})
			];
		}
	],
	draft_plan: [
		({ ctx }) => [toolCall('get_coverage', { engagement_id: ctx.engagement_id })],
		({ ctx }) => [
			toolCall('upsert_events', {
				engagement_id: ctx.engagement_id,
				events: [{ title: 'Backup restore walkthrough', format: 'walkthrough', duration_min: 60 }]
			})
		]
	],
	process_event: [
		({ ctx }) => [
			toolCall('get_event_status', { engagement_id: ctx.engagement_id, event_id: ctx.event_id }),
			toolCall('list_artifacts', { engagement_id: ctx.engagement_id })
		],
		({ ctx, results }) => {
			const item = results[0]?.evidence?.find((x) => !x.links?.length) ?? results[0]?.evidence?.[0];
			const artifact = results[1]?.artifacts?.[0];
			if (!item || !artifact) return null;
			return [
				toolCall('link_evidence', {
					engagement_id: ctx.engagement_id,
					links: [
						{
							artifact_id: artifact.id,
							evidence_item_id: item.id,
							locator: 'p. 1',
							sufficiency: 'supports'
						}
					]
				})
			];
		}
	],
	propose_findings: [
		({ ctx }) => [toolCall('list_assessment_units', { engagement_id: ctx.engagement_id })],
		({ ctx, results }) => {
			const unit = results[0]?.units?.find((u) => !u.finding) ?? results[0]?.units?.[0];
			if (!unit) return null;
			return [
				toolCall('propose_finding', {
					engagement_id: ctx.engagement_id,
					unit_id: unit.id,
					value: 'na',
					rationale: 'No evidence has been received yet, so there is no reasonable assurance.',
					confidence: 'medium'
				})
			];
		}
	],
	library_extract: [
		({ ctx }) => [toolCall('get_library_document_text', { document_id: ctx.document_id })],
		({ ctx }) => [
			toolCall('upsert_sources', {
				sources: [
					{
						code: ctx.source_code || 'fake-extract',
						title: ctx.source_title || 'Extracted by the test model',
						type: 'law',
						language: 'en',
						document_id: ctx.document_id
					}
				]
			})
		],
		({ ctx }) => [
			toolCall('upsert_requirements', {
				source: ctx.source_code || 'fake-extract',
				requirements: [
					{ ref: '1', title: 'Manage information security risk' },
					{ ref: '2', title: 'Test backups regularly' }
				]
			})
		]
	],
	library_mapping: [
		({ ctx }) => [
			toolCall('search_requirements', { query: ctx.query || 'risk', source: ctx.from_source, limit: 1 }),
			toolCall('search_requirements', { query: ctx.query || 'risk', source: ctx.to_source, limit: 1 })
		],
		({ results }) => {
			const from = results[0]?.results?.[0];
			const to = results[1]?.results?.[0];
			if (!from || !to) return null;
			return [
				toolCall('link_requirements', {
					links: [
						{ from: from.id, to: to.id, type: 'implements', coverage: 'partial', note: 'Same topic: risk.' }
					]
				})
			];
		}
	]
};

function reply(content, toolCalls) {
	return {
		id: `chatcmpl-${Date.now()}`,
		object: 'chat.completion',
		choices: [
			{
				index: 0,
				message: { role: 'assistant', content, ...(toolCalls?.length ? { tool_calls: toolCalls } : {}) },
				finish_reason: toolCalls?.length ? 'tool_calls' : 'stop'
			}
		]
	};
}

async function completion(body) {
	const { model, messages = [], tools = [] } = body;
	if (!MODELS.includes(model))
		return { status: 404, json: { error: { message: `Model ${model} not found` } } };
	const names = tools.map((t) => t.function?.name);

	if (names.includes('record_check')) {
		if (model === 'fake-notools') return { status: 200, json: reply('The value is audit-check-ok.') };
		const value = /value "([^"]+)"/.exec(messages.at(-1)?.content ?? '')?.[1] ?? '';
		return { status: 200, json: reply(null, [toolCall('record_check', { value })]) };
	}
	if (model === 'fake-notools') return { status: 200, json: reply('I cannot use tools.') };
	if (model === 'fake-broken')
		return { status: 500, json: { error: { message: 'Upstream model exploded' } } };
	if (model === 'fake-slow') {
		await sleep(1500);
		const { ctx } = contextOf(messages);
		return {
			status: 200,
			json: reply(null, [toolCall('get_engagement_overview', { engagement_id: ctx.engagement_id })])
		};
	}

	const { action, ctx } = contextOf(messages);
	const script = SCRIPTS[action];
	if (!script) return { status: 200, json: reply(`No script for action "${action}".`) };
	const results = toolResults(messages);
	// Each script step makes one round of calls; the step is how many assistant turns came before.
	const step = messages.filter((m) => m.role === 'assistant').length;
	const fn = script[step];
	if (!fn) return { status: 200, json: reply(`Done: ${action} made its proposals for review.`) };
	// Results of the previous round only, so a script step reads what it just asked for.
	const prevAssistant = messages.filter((m) => m.role === 'assistant').at(-1);
	const lastRound = prevAssistant?.tool_calls?.length ? results.slice(-prevAssistant.tool_calls.length) : [];
	const calls = fn({ ctx, results: lastRound });
	if (!calls) return { status: 200, json: reply('Nothing to propose.') };
	const unknown = calls.find((c) => !names.includes(c.function.name));
	if (unknown) return { status: 200, json: reply(`The tool ${unknown.function.name} was not offered.`) };
	return { status: 200, json: reply(null, calls) };
}

/** Handle one gateway request. */
export async function handleFakeLlm(method, pathname, body) {
	const path = pathname.replace(/^\/v1/, '');
	if (method === 'GET' && path === '/models') {
		return { status: 200, json: { object: 'list', data: MODELS.map((id) => ({ id, object: 'model' })) } };
	}
	if (method === 'POST' && path === '/chat/completions') return completion(body ?? {});
	return { status: 404, json: { error: { message: `No route ${method} ${pathname}` } } };
}

/** A fetch function that answers as the fake gateway, for unit tests. */
export function fakeLlmFetch() {
	return async (input, init = {}) => {
		const url = new URL(String(input));
		if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		const res = await handleFakeLlm(
			init.method ?? 'GET',
			url.pathname,
			init.body ? JSON.parse(String(init.body)) : null
		);
		return new Response(JSON.stringify(res.json), {
			status: res.status,
			headers: { 'content-type': 'application/json' }
		});
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const port = Number(process.env.PORT ?? 4999);
	http
		.createServer(async (req, res) => {
			let raw = '';
			for await (const chunk of req) raw += chunk;
			const out = await handleFakeLlm(
				req.method ?? 'GET',
				new URL(req.url ?? '/', 'http://x').pathname,
				parseJson(raw)
			);
			res.writeHead(out.status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(out.json));
		})
		.listen(port, () => console.log(`fake LLM gateway on http://127.0.0.1:${port}`));
}
