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
// Keys and budgets (#95), as LiteLLM's key management does them:
//   POST /key/generate, /key/update, /key/block, /key/unblock, /key/delete and GET /key/info, with the
//   master key (FAKE_MASTER_KEY, default sk-master). A key made here is charged 0.25 per completion,
//   refused with 422 `budget_exceeded` once its spend reaches its budget, and with 401 "Key is blocked"
//   while it is blocked. Any other key is let through uncounted, as before. Two fixed keys answer
//   the same way without set-up: sk-budget-used and sk-switched-off.
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
	extract_risks: [
		({ ctx }) => [
			toolCall('list_artifacts', { engagement_id: ctx.engagement_id }),
			toolCall('get_engagement_overview', { engagement_id: ctx.engagement_id })
		],
		({ ctx, results }) => {
			const docs = results[0]?.artifacts ?? [];
			const doc = docs.find((d) => d.id === ctx.artifact_id) ?? docs.find((d) => d.kind === 'risk_register');
			if (!doc) return null;
			return [toolCall('get_artifact_text', { engagement_id: ctx.engagement_id, artifact_id: doc.id })];
		},
		({ ctx, results }) => {
			const text = results.at(-1)?.text ?? '';
			const selected = results[1]?.requirements ?? [];
			// One risk per register line that starts with an id such as R-1.
			const risks = [...text.matchAll(/^(R-\d+) \| ([^|]+) \| (\d+) \| (\d+)/gm)].map((m, i) => {
				const score = Number(m[3]) * Number(m[4]);
				return {
					title: m[2].trim(),
					level: score >= 15 ? 'high' : score >= 6 ? 'medium' : 'low',
					origin: 'auditee_register',
					description: `${m[1]}, likelihood ${m[3]} × impact ${m[4]}`,
					requirements: i === 0 && selected[0] ? [selected[0].id] : []
				};
			});
			if (!risks.length) return null;
			return [toolCall('upsert_risks', { engagement_id: ctx.engagement_id, risks })];
		}
	],
	recheck_internal: [
		({ ctx }) => [
			toolCall('compare_with_new_version', {
				engagement_id: ctx.engagement_id,
				...(ctx.artifact_id ? { artifact_id: ctx.artifact_id } : {})
			})
		],
		({ ctx, results }) => {
			const items = (results[0]?.requirements ?? []).map((r) =>
				r.closest_passage
					? {
							ref: r.ref,
							action: 'update',
							quote: r.closest_passage,
							reason: `Reworded in the new version${r.closest_section ? `, section ${r.closest_section}` : ''}.`
						}
					: { ref: r.ref, action: 'remove', reason: 'The new version no longer has this rule.' }
			);
			return items.length ? [toolCall('propose_recheck', { engagement_id: ctx.engagement_id, items })] : null;
		}
	],
	check_soa: [
		({ ctx }) => [
			toolCall('list_artifacts', { engagement_id: ctx.engagement_id }),
			toolCall('get_engagement_overview', { engagement_id: ctx.engagement_id })
		],
		({ ctx, results }) => {
			const docs = results[0]?.artifacts ?? [];
			const doc =
				docs.find((d) => d.id === ctx.artifact_id) ??
				docs.find((d) => d.kind === 'statement_of_applicability');
			if (!doc) return null;
			return [
				toolCall('get_artifact_text', { engagement_id: ctx.engagement_id, artifact_id: doc.id }),
				toolCall('get_engagement_overview', { engagement_id: ctx.engagement_id })
			];
		},
		({ ctx, results }) => {
			const docId = ctx.artifact_id ?? results[0]?.artifact_id;
			const text = results[0]?.text ?? '';
			// The source of the selected controls, from the overview: "<code>:<ref>".
			const source = (results[1]?.requirements ?? [])
				.map((r) => r.ref)
				.find((r) => /:A\./.test(r))
				?.split(':')[0];
			if (!source) return null;
			// One entry per line such as "A.5.1 | Control 5.1 | Yes | justification".
			const entries = [...text.matchAll(/^(A\.[\d.]+) \| [^|]* \| (Yes|No) \| ([^\n]*)$/gm)].map((m, i) => ({
				requirement: `${source}:${m[1]}`,
				applicable: m[2] === 'Yes',
				justification: m[3].trim() || null,
				locator: `row ${i + 2}`
			}));
			if (!entries.length) return null;
			if (!docId) return null;
			return [toolCall('record_soa', { engagement_id: ctx.engagement_id, artifact_id: docId, entries })];
		},
		({ ctx }) => [toolCall('get_soa_check', { engagement_id: ctx.engagement_id })]
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
	// Whom the document applies to (#108): two roles, no requirements.
	library_roles: [
		({ ctx }) => [toolCall('get_library_document_text', { document_id: ctx.document_id })],
		({ ctx }) => [
			toolCall('upsert_sources', {
				sources: [
					{
						code: ctx.source_code || 'fake-extract',
						title: ctx.source_title || 'Extracted by the test model',
						type: 'law',
						language: 'en',
						document_id: ctx.document_id,
						roles: [
							{ key: 'essential', label: 'Essential entity', description: 'As defined in point 1.' },
							{ key: 'important', label: 'Important entity', description: 'As defined in point 2.' },
							// What the auditor asked to look for (#112): a supplier role when they name suppliers.
							...(/supplier/i.test(ctx.hint ?? '')
								? [{ key: 'supplier', label: 'Supplier', description: 'Named in point 5.' }]
								: [])
						]
					}
				]
			})
		]
	],
	// With chosen roles (#108), only their requirements, each with its role and the original passage.
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
		({ ctx }) => {
			const chosen = ctx.roles ? ctx.roles.split(',') : null;
			const all = [
				{
					ref: '1',
					title: 'Manage information security risk',
					...(chosen
						? {
								roles: ['essential'],
								text: 'The entity identifies, assesses and treats the risks to its network and information systems.',
								source_text: 'The entity manages the risks referred to in point 3.'
							}
						: {})
				},
				{ ref: '2', title: 'Test backups regularly', ...(chosen ? { roles: ['important'] } : {}) }
			];
			const requirements = chosen ? all.filter((r) => r.roles.some((k) => chosen.includes(k))) : all;
			return [toolCall('upsert_requirements', { source: ctx.source_code || 'fake-extract', requirements })];
		}
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
		],
		// What a real model reports; a gateway in front of this one counts its cost from it.
		usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 }
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

// ---- Keys and budgets, as LiteLLM answers
const MASTER = process.env.FAKE_MASTER_KEY ?? 'sk-master';
const COST = 0.25;
/** The keys made here, by their value. */
const keys = new Map();
/** Keys that were revoked: they are refused from then on. */
const revoked = new Set();
let keySeq = 0;

// The answers below are what LiteLLM 1.110 gives, word for word.
const budgetExceeded = (spend, max, alias = 'a-key') => ({
	status: 422,
	json: {
		error: {
			message: `Budget has been exceeded! Key=${alias} (sk-...abcd) Current cost: ${spend}, Max budget: ${max}`,
			type: 'budget_exceeded',
			param: null,
			code: '422'
		}
	}
});
const keyBlocked = () => ({
	status: 401,
	json: {
		error: {
			message: "Authentication Error, Key is blocked. Update via `/key/unblock` if you're an admin.",
			type: 'auth_error',
			param: null,
			code: '401'
		}
	}
});
const unknownKey = () => ({
	status: 401,
	json: {
		error: {
			message: 'Authentication Error, Invalid API key provided.',
			type: 'token_not_found_in_db',
			param: 'key',
			code: '401'
		}
	}
});
const notAdmin = (path) => ({
	status: 401,
	json: {
		error: {
			message: `Authentication Error, Only proxy admin can be used to generate, delete, update info for new keys/users/teams. Route=${path}. Your role=unknown. Your user_id=*******`,
			type: 'auth_error',
			param: null,
			code: '401'
		}
	}
});
const notYourKey = () => ({
	status: 403,
	json: {
		error: {
			message: "You are not allowed to access this key's info. Your role=internal_user",
			type: 'auth_error',
			param: null,
			code: '403'
		}
	}
});
/** LiteLLM starts a "30d" budget again at midnight on the 1st of the next month. */
const nextReset = () => {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
		.toISOString()
		.replace('.000Z', '+00:00');
};

/** Forget every key: for tests that start from nothing. */
export function resetFakeKeys() {
	keys.clear();
	revoked.clear();
	keySeq = 0;
}

/** Whether the caller's key may run a completion; null when it may, and the spend is counted. */
function charge(bearer) {
	if (bearer === 'sk-budget-used') return budgetExceeded(20, 20);
	if (bearer === 'sk-switched-off') return keyBlocked();
	if (revoked.has(bearer)) return unknownKey();
	const k = keys.get(bearer);
	if (!k) return null;
	if (k.blocked) return keyBlocked();
	if (k.max_budget !== null && k.spend >= k.max_budget)
		return budgetExceeded(k.spend, k.max_budget, k.key_alias);
	k.spend = Math.round((k.spend + COST) * 100) / 100;
	return null;
}

function keyManagement(method, path, body, bearer, query) {
	const info = (key) => ({ status: 200, json: { key, info: { ...keys.get(key) } } });
	// A key may read its own figures; everything else is for the master key.
	if (method === 'GET' && path === '/key/info') {
		const asked = query.get('key');
		if (bearer === MASTER) return asked && keys.has(asked) ? info(asked) : unknownKey();
		if (!keys.has(bearer)) return unknownKey();
		if (asked && asked !== bearer) return notYourKey();
		// A key that is switched off is refused here too.
		return keys.get(bearer).blocked ? keyBlocked() : info(bearer);
	}
	if (bearer !== MASTER) return keys.has(bearer) ? notAdmin(path) : unknownKey();
	const target = body?.key;
	if (path === '/key/generate') {
		keySeq += 1;
		const key = `sk-fake-${keySeq}-${Math.random().toString(36).slice(2, 10)}`;
		const reset = body?.budget_duration ? nextReset() : null;
		keys.set(key, {
			key_alias: body?.key_alias ?? '',
			spend: 0,
			max_budget: typeof body?.max_budget === 'number' ? body.max_budget : null,
			budget_duration: body?.budget_duration ?? null,
			budget_reset_at: reset,
			models: body?.models ?? [],
			blocked: false
		});
		return { status: 200, json: { key, ...keys.get(key) } };
	}
	if (path === '/key/delete') {
		const gone = (body?.keys ?? []).filter((k) => keys.has(k));
		for (const k of gone) {
			keys.delete(k);
			revoked.add(k);
		}
		return { status: 200, json: { deleted_keys: gone } };
	}
	if (!keys.has(target)) return { status: 404, json: { error: { message: `Key not found: ${target}` } } };
	const k = keys.get(target);
	if (path === '/key/update') {
		if (typeof body.max_budget === 'number') k.max_budget = body.max_budget;
		if (Array.isArray(body.models)) k.models = body.models;
		return { status: 200, json: { key: target, ...k } };
	}
	if (path === '/key/block' || path === '/key/unblock') {
		k.blocked = path === '/key/block';
		return { status: 200, json: { token: target, blocked: k.blocked } };
	}
	return { status: 404, json: { error: { message: `No route ${method} ${path}` } } };
}

/** Handle one gateway request. `bearer` is the caller's key; `query` the address's query string. */
export async function handleFakeLlm(method, pathname, body, bearer = '', query = new URLSearchParams()) {
	const path = pathname.replace(/^\/v1/, '');
	if (path.startsWith('/key/')) return keyManagement(method, path, body, bearer, query);
	if (method === 'GET' && path === '/models') {
		return { status: 200, json: { object: 'list', data: MODELS.map((id) => ({ id, object: 'model' })) } };
	}
	if (method === 'POST' && path === '/chat/completions') return charge(bearer) ?? completion(body ?? {});
	return { status: 404, json: { error: { message: `No route ${method} ${pathname}` } } };
}

const bearerOf = (value) => /^Bearer\s+(\S+)$/i.exec(String(value ?? ''))?.[1] ?? '';

/** A fetch function that answers as the fake gateway, for unit tests. */
export function fakeLlmFetch() {
	return async (input, init = {}) => {
		const url = new URL(String(input));
		if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		const res = await handleFakeLlm(
			init.method ?? 'GET',
			url.pathname,
			init.body ? JSON.parse(String(init.body)) : null,
			bearerOf(new Headers(init.headers).get('authorization')),
			url.searchParams
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
			const url = new URL(req.url ?? '/', 'http://x');
			const out = await handleFakeLlm(
				req.method ?? 'GET',
				url.pathname,
				parseJson(raw),
				bearerOf(req.headers.authorization),
				url.searchParams
			);
			res.writeHead(out.status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(out.json));
		})
		.listen(port, () => console.log(`fake LLM gateway on http://127.0.0.1:${port}`));
}
