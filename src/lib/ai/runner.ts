import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AppDatabase } from '#lib/db/client.ts';
import { AI_ACTIONS, resolveModel, webSearchFor, type AiAction } from '#lib/domain/ai-settings.ts';
import { getEngagement } from '#lib/domain/engagements.ts';
import { planningBrief } from '#lib/domain/plan-inputs.ts';
import { linkReceivedDocuments } from '#lib/domain/received-documents.ts';
import { effectiveSkill, withoutFrontMatter } from '#lib/domain/skills.ts';
import { listSelected } from '#lib/domain/selection.ts';
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
	recheck_internal: [
		'compare_with_new_version',
		'get_artifact_text',
		'list_internal_requirements',
		'propose_recheck'
	],
	extract_risks: [
		'get_engagement_overview',
		'list_artifacts',
		'get_artifact_text',
		'upsert_risks',
		'search_requirements',
		'get_requirement'
	],
	check_soa: [
		'get_engagement_overview',
		'list_artifacts',
		'get_artifact_text',
		'search_requirements',
		'record_soa',
		'get_soa_check'
	],
	draft_plan: [
		'get_engagement_overview',
		'get_coverage',
		'link_received_documents',
		'link_evidence',
		'get_artifact_text',
		'list_internal_requirements',
		'list_events',
		'upsert_events',
		'upsert_evidence_items',
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
	library_roles: [
		'list_library_documents',
		'get_library_document_text',
		'upsert_sources',
		'list_library_proposals'
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
export function taskText(
	action: AiAction,
	ctx: JobContext,
	opts: { webSearch?: boolean; planningBrief?: string } = {}
): string {
	switch (action) {
		case 'derive_roles':
			return "Derive the auditee's roles from the engagement's documents. Read the documents, then propose each role with upsert_people, naming the source document and section it was found in.";
		case 'extract_internal':
			return ctx.artifact_id
				? `Extract the internal requirements from the document ${ctx.artifact_id}.${ctx.sections ? ` It is a new version; its internal requirements were already checked against it, and only these sections hold none yet: ${ctx.sections}. Extract from those sections only and leave the existing internal requirements as they are.` : ''} Propose them with upsert_internal_requirements (pass artifact_id) and map each to the engagement's selected requirements it implements, where that is clear.`
				: "Extract internal requirements from the auditee's documents that have not been analysed yet. Propose them with upsert_internal_requirements (pass artifact_id) and map each to the engagement's selected requirements it implements, where that is clear.";
		case 'recheck_internal':
			return `Recheck the internal requirements that need review after a new version of their document${ctx.artifact_id ? ` (the new version is document ${ctx.artifact_id}; pass it as artifact_id)` : ''}. Call compare_with_new_version, then decide for each requirement: the rule is still there in other words (propose an update with propose_recheck: a quote copied exactly from the new version, and a new title or text if the rule changed), or the new version no longer has it (propose removing it). Give each a reason citing the new version. Do not add new requirements here.`;
		case 'extract_risks': {
			const register = ctx.artifact_id
				? `Extract the risks from the auditee's risk register, document ${ctx.artifact_id}. Read all of it with get_artifact_text, then propose each risk with upsert_risks: origin auditee_register, the register's rating mapped to high, medium or low, its reference, owner and treatment in the description, and the engagement's selected requirements it affects where that is clear.`
				: "Find the auditee's risk register among the documents (kind risk_register) and extract its risks: read it with get_artifact_text, then propose each risk with upsert_risks (origin auditee_register, the rating mapped to high, medium or low, its reference, owner and treatment in the description, and the selected requirements it affects where that is clear).";
			const research = opts.webSearch
				? ' Then research: from the engagement overview and documents, work out who the auditee is (sector, country, size, the services and technology it depends on), search the web for threats, incidents, vulnerabilities and regulatory changes from the last 12 months that are relevant to such an organisation, and compare them with the register. Propose each relevant risk the register does not cover with origin research, a level, the selected requirements it affects, and in the description why it applies and its sources (title, URL and date). Do not repeat risks the register already has.'
				: ' Web search is not available in this run: skip researching current risks and say so in your summary.';
			return register + research;
		}
		case 'check_soa':
			return `Read the auditee's Statement of Applicability${ctx.artifact_id ? `, document ${ctx.artifact_id},` : ' (the document of kind statement_of_applicability)'} in full with get_artifact_text and record every Annex control it lists with record_soa: whether it is applicable, the justification and implementation status as written, and the row or page. Then call get_soa_check and summarise the conflicts with the audit scope. Do not change the audit scope: the auditor decides.`;
		case 'draft_plan':
			return `Draft the audit plan. Check coverage first, then propose events grouping the selected requirements (upsert_events) and the evidence to collect at each (upsert_evidence_items), so that every requirement is covered. Fit the events into the fieldwork time below, with dates and start times.${opts.planningBrief ? `\n\n${opts.planningBrief}` : ''}`;
		case 'process_event':
			return `Process the materials of event ${ctx.event_id}. Read its status, notes and the documents captured for it, then propose evidence links with locators (link_evidence) and record any promises or issues you find as notes (upsert_notes).`;
		case 'propose_findings':
			return ctx.unit_id
				? `Propose a finding for assessment unit ${ctx.unit_id}, with rationale citing the evidence. Missing evidence means no reasonable assurance, never a non-conformity.`
				: 'Propose a finding for each assessment unit that has none yet, with rationale citing the evidence. Missing evidence means no reasonable assurance, never a non-conformity.';
		case 'library_roles':
			return `Find whom library document ${ctx.document_id} applies to. Read its subject matter, scope and definitions, and the headings of the provisions that set obligations; skim the rest. Then create or update the source${ctx.source_code ? ` with code "${ctx.source_code}"` : ''}${ctx.source_title ? ` titled "${ctx.source_title}"` : ''} with upsert_sources (pass document_id) and its roles: each kind of organisation or person the document sets auditable obligations for, labelled as the document names them, with a one-line description citing where it is defined. If it addresses only one kind, record that one role. Do not add requirements: the auditor chooses which roles to import.`;
		case 'library_extract': {
			const roles = ctx.roles
				? `Import only the requirements for these roles of the source: ${ctx.roles.split(',').join(', ')} (see list_library_documents for their labels). Give each requirement the keys of the roles it applies to; where one provision sets different obligations for different roles, make one requirement per role.`
				: 'If the source lists roles (list_library_documents), give each requirement the keys of the roles it applies to; where one provision sets different obligations for different roles, make one requirement per role.';
			return `Extract the auditable requirements from library document ${ctx.document_id} into a source${ctx.source_code ? ` with code "${ctx.source_code}"` : ''}${ctx.source_title ? ` titled "${ctx.source_title}"` : ''}. ${roles} Create or update the source with upsert_sources (pass document_id), then add the requirements with upsert_requirements in document order: the reference exactly as written, a short title, a self-contained text, the original passage as source_text where the text is reworded, and parent to keep the chapter and article headings that hold auditable requirements. Skip provisions that are not auditable, and list them with the reason in your summary.`;
		}
		case 'library_mapping':
			return `Propose links from the requirements of source "${ctx.from_source}" to the source "${ctx.to_source}" with link_requirements. Give each link a one-line note; start it with "Low confidence:" where that applies. Do not invent links where nothing matches.`;
	}
}

/** For Draft plan: the auditor's planning inputs and the schedule rules, in words (#79). */
function planBriefFor(app: AppDatabase, job: { action: AiAction; context: JobContext }): string | undefined {
	if (job.action !== 'draft_plan' || !job.context.engagement_id) return undefined;
	const e = getEngagement(app, job.context.engagement_id);
	return e.planInputs ? planningBrief(e.planInputs, listSelected(app, e.id).length) : undefined;
}

/** The in-app skill for an action (as edited in Settings, Skills, else the default), without front matter. */
export function skillInstructions(app: AppDatabase, action: AiAction): string {
	try {
		return withoutFrontMatter(effectiveSkill(app, 'app', AI_ACTIONS[action].skill));
	} catch {
		return '';
	}
}

function systemPrompt(app: AppDatabase, job: Job): string {
	const scope = job.engagementId
		? `Work only on engagement ${job.engagementId}; pass that engagement_id to the tools.`
		: 'Work only on the shared requirements library.';
	const skill = skillInstructions(app, job.action);
	return `You are running inside mcp-audit as the in-app AI action "${job.label}", started by ${job.userName}.
Nobody can answer questions during the run: use the tools, make your proposals, and finish with a short summary (two to five sentences) of what you proposed and what the auditor should check. State any assumptions in that summary.
Everything you write is versioned as "${job.model} on behalf of ${job.userName}" and stored as proposed for the auditor to accept, edit or reject. You cannot approve findings or change plan status. ${scope}
Follow the instructions below. Where they mention a tool you were not given, skip that part.

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

		const webSearch = webSearchFor(app, job.action);
		const planningBrief = planBriefFor(app, job);
		if (webSearch) addJobStep(app, jobId, { kind: 'info', text: 'Web search is on for this action.' });
		const messages: ChatMessage[] = [
			{ role: 'system', content: systemPrompt(app, job) },
			{
				role: 'user',
				content: `Action: ${job.action}\nContext: ${JSON.stringify(job.context)}\n\n${taskText(job.action, job.context, { webSearch, planningBrief })}`
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
					{
						model: job.model,
						messages,
						tools,
						max_tokens: 16_000,
						...(webSearch ? { web_search_options: { search_context_size: 'medium' as const } } : {})
					},
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
				let summary = res.content?.trim() || 'The model finished without a summary.';
				// After drafting, documents already received are linked to the rule evidence they hold (#83).
				if (job.action === 'draft_plan' && job.context.engagement_id) {
					const linked = linkReceivedDocuments(app, actor, job.context.engagement_id);
					if (linked.length) {
						const text = `${linked.length} planned evidence ${linked.length === 1 ? 'link' : 'links'} to documents already received proposed.`;
						addJobStep(app, jobId, { kind: 'info', text });
						summary = `${summary}\n\n${text}`;
					}
				}
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
