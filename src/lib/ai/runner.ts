import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AppDatabase } from '#lib/db/client.ts';
import { AI_ACTIONS, resolveModel, type AiAction } from '#lib/domain/ai-settings.ts';
import { getEngagement } from '#lib/domain/engagements.ts';
import {
	addJobStep,
	createJob,
	finishJob,
	getJob,
	isCancelRequested,
	requestCancel,
	type Job,
	type JobContext
} from '#lib/domain/jobs.ts';
import { getUser } from '#lib/domain/users.ts';
import type { Actor } from '#lib/domain/write.ts';
import { createMcpServer } from '#lib/mcp/server.ts';
import { SKILLS_DIR } from '#lib/reports/template.ts';
import { APP_VERSION } from '#lib/version.ts';
import { chat, LlmError, type ChatMessage, type FetchLike, type ToolDefinition } from './llm';

/**
 * The in-app AI job runner. A job is an agent loop: the skill's instructions and the internal tool list
 * go to the model through the gateway, and each tool call it returns runs through the same MCP tools
 * (and so the same domain functions and guard rails) as an outside MCP client. Writes are made by the
 * user who pressed the button with the model as agent on channel `ai`, so they read "<model> on behalf
 * of <user>" and land as proposals.
 */

const MAX_TURNS = 30;
const MAX_TOOL_RESULT = 30_000;

/** The tools each action may use: reads it needs plus the proposal writes of its skill. */
export const ACTION_TOOLS: Record<AiAction, string[]> = {
	derive_roles: ['get_engagement_overview', 'list_artifacts', 'get_artifact_text', 'upsert_people'],
	extract_internal: [
		'get_engagement_overview',
		'list_artifacts',
		'get_artifact_text',
		'list_internal_requirements',
		'upsert_internal_requirements',
		'search_requirements',
		'get_requirement'
	],
	draft_plan: [
		'get_engagement_overview',
		'get_coverage',
		'list_events',
		'upsert_events',
		'upsert_evidence_items',
		'list_internal_requirements',
		'list_artifacts',
		'search_requirements',
		'get_requirement'
	],
	process_event: [
		'get_event_status',
		'list_events',
		'list_artifacts',
		'get_artifact_text',
		'upsert_notes',
		'link_evidence',
		'get_requirement'
	],
	propose_findings: [
		'list_assessment_units',
		'get_assessment_unit',
		'propose_finding',
		'get_event_status',
		'list_artifacts',
		'get_artifact_text'
	],
	library_extract: [
		'list_library_documents',
		'get_library_document_text',
		'upsert_sources',
		'upsert_requirements',
		'list_library_proposals',
		'search_requirements',
		'get_requirement'
	],
	library_mapping: ['search_requirements', 'get_requirement', 'list_library_proposals', 'link_requirements']
};

/** What the button asks for, in words, with the ids the model needs. */
export function taskText(action: AiAction, ctx: JobContext): string {
	switch (action) {
		case 'derive_roles':
			return "Derive the auditee's roles from the engagement's documents. Read the documents, then propose each role with upsert_people, naming the source document and section it was found in.";
		case 'extract_internal':
			return ctx.artifact_id
				? `Extract the internal requirements from the document ${ctx.artifact_id}. Propose them with upsert_internal_requirements (pass artifact_id) and map each to the engagement's selected requirements it implements, where that is clear.`
				: "Extract internal requirements from the auditee's documents that have not been analysed yet. Propose them with upsert_internal_requirements (pass artifact_id) and map each to the engagement's selected requirements it implements, where that is clear.";
		case 'draft_plan':
			return 'Draft the audit plan. Check coverage first, then propose events grouping the selected requirements (upsert_events) and the evidence to collect at each (upsert_evidence_items), so that every requirement is covered.';
		case 'process_event':
			return `Process the materials of event ${ctx.event_id}. Read its status, notes and the documents captured for it, then propose evidence links with locators (link_evidence) and record any promises or issues you find as notes (upsert_notes).`;
		case 'propose_findings':
			return ctx.unit_id
				? `Propose a finding for assessment unit ${ctx.unit_id}, with rationale citing the evidence. Missing evidence means no reasonable assurance, never a non-conformity.`
				: 'Propose a finding for each assessment unit that has none yet, with rationale citing the evidence. Missing evidence means no reasonable assurance, never a non-conformity.';
		case 'library_extract':
			return `Extract the requirements from library document ${ctx.document_id} into a source${ctx.source_code ? ` with code "${ctx.source_code}"` : ''}${ctx.source_title ? ` titled "${ctx.source_title}"` : ''}. Create the source with upsert_sources (pass document_id), then add the requirements with upsert_requirements, keeping the document's hierarchy and its exact reference codes and wording.`;
		case 'library_mapping':
			return `Propose links from the requirements of source "${ctx.from_source}" to the source "${ctx.to_source}" with link_requirements. Give each link a one-line note; start it with "Low confidence:" where that applies. Do not invent links where nothing matches.`;
	}
}

/** The skill's instructions without the YAML front matter. */
export function skillInstructions(action: AiAction): string {
	const file = path.join(SKILLS_DIR(), AI_ACTIONS[action].skill, 'SKILL.md');
	try {
		return readFileSync(file, 'utf8')
			.replace(/^---\n[\s\S]*?\n---\n/, '')
			.trim();
	} catch {
		return '';
	}
}

function systemPrompt(job: Job): string {
	const scope = job.engagementId
		? `Work only on engagement ${job.engagementId}; pass that engagement_id to the tools.`
		: 'Work only on the shared requirements library.';
	const skill = skillInstructions(job.action);
	return `You are running inside mcp-audit as the in-app AI action "${job.label}", started by ${job.userName}.
Nobody can answer questions during the run: use the tools, make your proposals, and finish with a short summary (two to five sentences) of what you proposed and what the auditor should check. State any assumptions in that summary.
Everything you write is versioned as "${job.model} on behalf of ${job.userName}" and stored as proposed for the auditor to accept, edit or reject. You cannot approve findings or change plan status. ${scope}
Follow the skill below in app mode. Where it mentions files mode, asking the user, or tools you were not given, skip that part.

${skill}`.trim();
}

function textOf(result: Record<string, unknown>): string {
	const parts = Array.isArray(result.content) ? result.content : [];
	const text = parts
		.map((p: { type?: string; text?: string }) => (p?.type === 'text' ? (p.text ?? '') : ''))
		.join('\n');
	return text.length > MAX_TOOL_RESULT ? `${text.slice(0, MAX_TOOL_RESULT)}\n[cut: ask for less]` : text;
}

const running = new Map<string, AbortController>();

export interface RunDeps {
	fetch?: FetchLike;
	env?: Record<string, string | undefined>;
}

/** Start an action: record the job and run it in the background. Returns at once with the job. */
export function startJob(
	app: AppDatabase,
	actor: Actor,
	input: { action: string; context: Record<string, unknown> },
	deps: RunDeps = {}
): { job: Job; done: Promise<void> } {
	const job = createJob(app, actor, input, deps.env);
	const controller = new AbortController();
	running.set(job.id, controller);
	const done = runJob(app, job.id, controller.signal, deps)
		.catch((e) => {
			finishJob(app, job.id, 'failed', { error: `The action stopped unexpectedly: ${(e as Error).message}` });
		})
		.finally(() => running.delete(job.id));
	return { job, done };
}

/** Cancel a running job: recorded at once, and the model call in flight is aborted. */
export function cancelJob(app: AppDatabase, actor: Actor, id: string): Job {
	const job = requestCancel(app, actor, id);
	running.get(id)?.abort();
	return job;
}

async function runJob(app: AppDatabase, jobId: string, signal: AbortSignal, deps: RunDeps): Promise<void> {
	const job = getJob(app, jobId);
	const engagement = job.engagementId ? getEngagement(app, job.engagementId) : null;
	const { gateway } = resolveModel(app, job.action, engagement, deps.env);
	const user = getUser(app, job.userId);
	const actor: Actor = { userId: user.id, agent: job.model, channel: 'ai', note: job.label };

	const server = createMcpServer(
		app,
		{ id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: false },
		actor
	);
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'mcp-audit-job', version: APP_VERSION });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	const cancelled = () => signal.aborted || isCancelRequested(app, jobId);
	const stopCancelled = () => {
		addJobStep(app, jobId, { kind: 'info', text: 'Cancelled. Proposals made so far stay for review.' });
		finishJob(app, jobId, 'cancelled', { summary: null });
	};

	try {
		const allowed = new Set(ACTION_TOOLS[job.action]);
		const listed = (await client.listTools()).tools.filter((t) => allowed.has(t.name));
		const titles = new Map(listed.map((t) => [t.name, t.title ?? t.name]));
		const takesEngagement = new Set(
			listed
				.filter((t) =>
					Object.hasOwn((t.inputSchema as { properties?: object }).properties ?? {}, 'engagement_id')
				)
				.map((t) => t.name)
		);
		const tools: ToolDefinition[] = listed.map((t) => ({
			type: 'function',
			function: {
				name: t.name,
				description: t.description ?? t.title ?? t.name,
				parameters: t.inputSchema as Record<string, unknown>
			}
		}));

		const messages: ChatMessage[] = [
			{ role: 'system', content: systemPrompt(job) },
			{
				role: 'user',
				content: `Action: ${job.action}\nContext: ${JSON.stringify(job.context)}\n\n${taskText(job.action, job.context)}`
			}
		];

		for (let turn = 0; turn < MAX_TURNS; turn++) {
			if (cancelled()) return stopCancelled();
			addJobStep(app, jobId, {
				kind: 'model',
				text: turn === 0 ? 'Asking the model.' : 'Asking the model again.'
			});
			let res;
			try {
				res = await chat(
					gateway,
					// Generous: models that think before acting spend part of this on reasoning.
					{ model: job.model, messages, tools, max_tokens: 16_000 },
					{ fetch: deps.fetch, signal }
				);
			} catch (e) {
				if (cancelled()) return stopCancelled();
				throw e;
			}
			// Sent back exactly as received, including any thinking blocks the gateway returned.
			messages.push(res.message);
			if (res.toolCalls.length === 0 && res.finishReason === 'content_filter') {
				throw new LlmError(
					"The model declined to continue (its provider's safety filter). Proposals made so far stay for review."
				);
			}
			if (res.toolCalls.length === 0 && res.finishReason === 'length') {
				throw new LlmError(
					'The model ran out of output tokens before finishing. Try again, or use another model.'
				);
			}
			if (res.toolCalls.length === 0) {
				const summary = res.content?.trim() || 'The model finished without a summary.';
				addJobStep(app, jobId, { kind: 'info', text: 'Finished.' });
				finishJob(app, jobId, 'succeeded', { summary });
				return;
			}
			for (const call of res.toolCalls) {
				if (cancelled()) return stopCancelled();
				const name = call.function.name;
				let content: string;
				let ok = true;
				let args: Record<string, unknown> = {};
				try {
					args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
					if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error();
				} catch {
					ok = false;
				}
				if (!allowed.has(name)) {
					ok = false;
					content = `forbidden: the tool ${name} is not available to this action.`;
				} else if (!ok) {
					content = 'validation: the arguments are not a JSON object.';
				} else if (job.engagementId && args.engagement_id && args.engagement_id !== job.engagementId) {
					ok = false;
					content = `forbidden: this action works only on engagement ${job.engagementId}.`;
				} else if (!job.engagementId && args.engagement_id) {
					ok = false;
					content = 'forbidden: this action works only on the shared library.';
				} else {
					if (job.engagementId && takesEngagement.has(name)) args.engagement_id = job.engagementId;
					const result = await client.callTool({ name, arguments: args });
					ok = !result.isError;
					content = textOf(result);
				}
				addJobStep(app, jobId, {
					kind: 'tool',
					text: ok ? `${titles.get(name) ?? name}` : `${titles.get(name) ?? name}: ${content.slice(0, 200)}`,
					ok
				});
				messages.push({ role: 'tool', tool_call_id: call.id, content });
			}
		}
		finishJob(app, jobId, 'failed', {
			error: `The model did not finish within ${MAX_TURNS} rounds. Proposals made so far stay for review.`
		});
	} catch (e) {
		const message = e instanceof LlmError ? e.message : `Unexpected error: ${(e as Error).message}`;
		addJobStep(app, jobId, { kind: 'info', text: message, ok: false });
		finishJob(app, jobId, 'failed', { error: message });
	} finally {
		await client.close().catch(() => {});
		await server.close().catch(() => {});
	}
}
