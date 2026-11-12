import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '#lib/db/client.ts';
import { AI_ACTIONS, isAiAction, resolveModel, type AiAction } from './ai-settings';
import { getEngagement } from './engagements';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { isHuman } from './guards';
import { getSourceByCode } from './library';
import { assertLibraryDocument } from './library-documents';
import { getEvent } from './planning';
import { isAdmin } from './users';
import type { Actor } from './write';

/**
 * In-app AI jobs: the record of each button press, its progress and outcome. The agent loop itself
 * lives in src/lib/ai/runner.ts; this module owns the `ai_job` table and the rules for starting one.
 */

export type JobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobStep {
	at: string;
	kind: 'model' | 'tool' | 'info';
	text: string;
	ok?: boolean;
}

export interface JobContext {
	engagement_id?: string;
	event_id?: string;
	artifact_id?: string;
	unit_id?: string;
	document_id?: string;
	source_code?: string;
	source_title?: string;
	from_source?: string;
	to_source?: string;
}

export interface Job {
	id: string;
	action: AiAction;
	label: string;
	engagementId: string | null;
	userId: string;
	userName: string;
	model: string;
	status: JobStatus;
	context: JobContext;
	steps: JobStep[];
	summary: string | null;
	error: string | null;
	cancelRequested: boolean;
	createdAt: Date;
	finishedAt: Date | null;
}

type JobRow = Record<string, unknown>;

function parse<T>(value: unknown, fallback: T): T {
	if (typeof value !== 'string') return (value as T) ?? fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

function toJob(r: JobRow): Job {
	const action = String(r.action) as AiAction;
	return {
		id: String(r.id),
		action,
		label: AI_ACTIONS[action]?.label ?? action,
		engagementId: (r.engagement_id as string | null) ?? null,
		userId: String(r.user_id),
		userName: String(r.user_name ?? r.user_id),
		model: String(r.model),
		status: r.status as JobStatus,
		context: parse<JobContext>(r.context, {}),
		steps: parse<JobStep[]>(r.steps, []),
		summary: (r.summary as string | null) ?? null,
		error: (r.error as string | null) ?? null,
		cancelRequested: Number(r.cancel_requested) === 1,
		createdAt: new Date(Number(r.created_at)),
		finishedAt: r.finished_at == null ? null : new Date(Number(r.finished_at))
	};
}

const SELECT = `SELECT j.*, u.name AS user_name FROM ai_job j LEFT JOIN "user" u ON u.id = j.user_id`;

export function getJob(app: AppDatabase, id: string): Job {
	const row = app.sqlite.prepare(`${SELECT} WHERE j.id = ?`).get(id) as JobRow | undefined;
	if (!row) throw new NotFoundError('AI job not found');
	return toJob(row);
}

/** Jobs of an engagement, or of the library when `engagementId` is null; newest first. */
export function listJobs(
	app: AppDatabase,
	scope: { engagementId: string | null },
	opts: { action?: AiAction; limit?: number } = {}
): Job[] {
	const where = [scope.engagementId ? 'j.engagement_id = ?' : 'j.engagement_id IS NULL'];
	const args: unknown[] = scope.engagementId ? [scope.engagementId] : [];
	if (opts.action) {
		where.push('j.action = ?');
		args.push(opts.action);
	}
	args.push(opts.limit ?? 20);
	return (
		app.sqlite
			.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY j.created_at DESC LIMIT ?`)
			.all(...args) as JobRow[]
	).map(toJob);
}

function str(v: unknown): string | undefined {
	return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Check what an action needs to know and return only those fields. */
function validContext(app: AppDatabase, action: AiAction, input: Record<string, unknown>): JobContext {
	const ctx: JobContext = {};
	if (AI_ACTIONS[action].scope === 'engagement') {
		const id = str(input.engagement_id);
		if (!id) throw new ValidationError('An engagement is required.');
		ctx.engagement_id = getEngagement(app, id).id;
	}
	switch (action) {
		case 'process_event': {
			const ev = str(input.event_id);
			if (!ev) throw new ValidationError('Choose the event to process.');
			ctx.event_id = getEvent(app, ctx.engagement_id!, ev).id;
			break;
		}
		case 'extract_internal':
			if (str(input.artifact_id)) ctx.artifact_id = str(input.artifact_id);
			break;
		case 'propose_findings':
			if (str(input.unit_id)) ctx.unit_id = str(input.unit_id);
			break;
		case 'library_extract': {
			const doc = str(input.document_id);
			if (!doc) throw new ValidationError('Choose the library document to extract from.');
			assertLibraryDocument(app, doc);
			ctx.document_id = doc;
			const code = str(input.source_code);
			if (code) {
				if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(code)) {
					throw new ValidationError('A source code uses letters, digits, dots and dashes.', {
						source_code: 'Letters, digits, dots and dashes, for example mk397.'
					});
				}
				ctx.source_code = code;
			}
			if (str(input.source_title)) ctx.source_title = str(input.source_title)!.slice(0, 200);
			break;
		}
		case 'library_mapping': {
			const from = str(input.from_source);
			const to = str(input.to_source);
			if (!from || !to) throw new ValidationError('Choose the source to map and the source to map it to.');
			if (from === to) throw new ValidationError('Map a source to a different source.');
			for (const code of [from, to]) {
				if (!getSourceByCode(app, code)) throw new NotFoundError(`No source ${code}.`);
			}
			ctx.from_source = from;
			ctx.to_source = to;
			break;
		}
	}
	return ctx;
}

/**
 * Record a new job, after checking that a person started it, AI is allowed on the engagement, a checked
 * model is set for the action and the same action is not already running there.
 */
export function createJob(
	app: AppDatabase,
	actor: Actor,
	input: { action: string; context: Record<string, unknown> },
	env: Record<string, string | undefined> = process.env,
	now = new Date()
): Job {
	if (!isHuman(actor)) throw new ForbiddenError('Only a person can start an AI action.');
	if (!isAiAction(input.action)) throw new ValidationError(`Unknown AI action ${String(input.action)}.`);
	const action = input.action;
	const ctx = validContext(app, action, input.context);
	const engagement = ctx.engagement_id ? getEngagement(app, ctx.engagement_id) : null;
	if (engagement && !engagement.aiAllowed) {
		throw new ForbiddenError(
			'AI is switched off for this engagement. Switch it on in the engagement details.'
		);
	}
	const { model } = resolveModel(app, action, engagement, env);

	const running = listJobs(app, { engagementId: engagement?.id ?? null }, { action, limit: 5 }).find(
		(j) => j.status === 'running'
	);
	if (running) throw new ValidationError(`"${AI_ACTIONS[action].label}" is already running here.`);

	const id = randomUUID();
	const at = now.getTime();
	const steps: JobStep[] = [{ at: now.toISOString(), kind: 'info', text: `Started with ${model}.` }];
	app.sqlite
		.prepare(
			`INSERT INTO ai_job (id, action, engagement_id, user_id, model, status, context, steps, cancel_requested, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'running', ?, ?, 0, ?, ?)`
		)
		.run(
			id,
			action,
			engagement?.id ?? null,
			actor.userId,
			model,
			JSON.stringify(ctx),
			JSON.stringify(steps),
			at,
			at
		);
	return getJob(app, id);
}

/** Append a progress step. Keeps the newest 200. */
export function addJobStep(app: AppDatabase, id: string, step: Omit<JobStep, 'at'>, now = new Date()): void {
	const job = getJob(app, id);
	const steps = [...job.steps, { at: now.toISOString(), ...step, text: step.text.slice(0, 500) }].slice(-200);
	app.sqlite
		.prepare('UPDATE ai_job SET steps = ?, updated_at = ? WHERE id = ?')
		.run(JSON.stringify(steps), now.getTime(), id);
}

export function finishJob(
	app: AppDatabase,
	id: string,
	status: Exclude<JobStatus, 'running'>,
	result: { summary?: string | null; error?: string | null } = {},
	now = new Date()
): void {
	app.sqlite
		.prepare(
			`UPDATE ai_job SET status = ?, summary = ?, error = ?, updated_at = ?, finished_at = ?
			  WHERE id = ? AND status = 'running'`
		)
		.run(
			status,
			result.summary?.slice(0, 4000) ?? null,
			result.error?.slice(0, 2000) ?? null,
			now.getTime(),
			now.getTime(),
			id
		);
}

/** Ask a running job to stop. The person who started it, or an admin, may cancel. */
export function requestCancel(app: AppDatabase, actor: Actor, id: string): Job {
	const job = getJob(app, id);
	if (job.userId !== actor.userId && !isAdmin(app, actor)) {
		throw new ForbiddenError('Only the person who started this AI action, or an admin, can cancel it.');
	}
	if (job.status !== 'running') return job;
	app.sqlite
		.prepare('UPDATE ai_job SET cancel_requested = 1, updated_at = ? WHERE id = ?')
		.run(Date.now(), id);
	return getJob(app, id);
}

export function isCancelRequested(app: AppDatabase, id: string): boolean {
	const row = app.sqlite.prepare('SELECT cancel_requested FROM ai_job WHERE id = ?').get(id) as
		{ cancel_requested: number } | undefined;
	return Number(row?.cancel_requested) === 1;
}

/** After a restart nothing is running any more: close jobs the previous process left open. */
export function failInterruptedJobs(app: AppDatabase, now = new Date()): number {
	return app.sqlite
		.prepare(
			`UPDATE ai_job SET status = 'failed', error = 'The app restarted while this action ran. Start it again.',
			        updated_at = ?, finished_at = ? WHERE status = 'running'`
		)
		.run(now.getTime(), now.getTime()).changes;
}
