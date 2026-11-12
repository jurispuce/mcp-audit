import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { AppDatabase } from '#lib/db/client.ts';
import { buildAuditPlan, exportAuditPlan } from '#lib/domain/audit-plan.ts';
import { getEngagement, listScopes, type Engagement } from '#lib/domain/engagements.ts';
import { NotFoundError, ValidationError } from '#lib/domain/errors.ts';
import { assertAiAllowed, assertCanReadRequirement } from '#lib/domain/guards.ts';
import { resolveRequirementRef } from '#lib/domain/library.ts';
import { listPeople } from '#lib/domain/people.ts';
import {
	addEvent,
	addEvidence,
	coverage,
	EVENT_FORMATS,
	EVIDENCE_KINDS,
	EVIDENCE_STATUSES,
	listEvents,
	listEvidence,
	updateEvent,
	updateEvidence,
	type EventInput,
	type EvidenceInput
} from '#lib/domain/planning.ts';
import { criticalityOf } from '#lib/domain/risks.ts';
import { CRITICALITY } from '#lib/domain/selection.ts';
import type { Actor } from '#lib/domain/write.ts';
import { loadConfig } from '#lib/server/config.ts';

type Run = (fn: () => unknown) => CallToolResult;
type RunAsync = (fn: () => Promise<unknown>) => Promise<CallToolResult>;

const engagementId = z.string().min(1).describe('Engagement id from list_engagements.');
const reqRef = z
	.string()
	.min(1)
	.describe('Requirement id, or "<source code>:<reference>" such as "nis2:Art. 21(2)(b)".');
const defined = <T extends object>(o: T) =>
	Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/**
 * Planning tools (#51): events, planned evidence, coverage and the plan document. Everything AI writes
 * is a draft (proposed) until the auditor accepts it on Plan, Events. Plan status is not a tool.
 */
export function registerPlanTools(
	server: McpServer,
	app: AppDatabase,
	actor: Actor,
	run: Run,
	runAsync: RunAsync
) {
	const engagement = (id: string): Engagement => {
		const e = getEngagement(app, id);
		assertAiAllowed(e, actor);
		return e;
	};
	const requirement = (e: Engagement, ref: string) => {
		const id = resolveRequirementRef(app, ref);
		assertCanReadRequirement(app, id, { auditeeId: e.auditeeId });
		return id;
	};
	const people = (e: Engagement, names: string[]) => {
		const all = listPeople(app, e.auditeeId);
		return names.map((n) => {
			const p = all.find((x) => x.id === n || x.role.toLowerCase() === n.toLowerCase());
			if (!p)
				throw new ValidationError(
					`No role "${n}" for this auditee. Record it with upsert_people first, or put it in participants_note.`
				);
			return p.id;
		});
	};

	server.registerTool(
		'list_events',
		{
			title: 'List events',
			description:
				"The engagement's events in date order, each with participants, requirements, its planned evidence and whether it is still a draft.",
			inputSchema: { engagement_id: engagementId },
			annotations: { readOnlyHint: true }
		},
		({ engagement_id }) =>
			run(() => {
				const e = engagement(engagement_id);
				const evidence = listEvidence(app, e.id);
				return {
					events: listEvents(app, e.id).map((x) => ({
						id: x.id,
						title: x.title,
						format: x.format,
						date: x.date,
						start_time: x.startTime,
						duration_min: x.durationMin,
						participants: x.participantsLine,
						requirements: x.requirements.map((r) => r.refCode),
						status: x.status,
						proposed: x.proposed,
						version: x.version,
						evidence: evidence
							.filter((v) => v.eventId === x.id)
							.map((v) => ({
								id: v.id,
								text: v.text,
								kind: v.kind,
								criticality: v.criticality,
								status: v.status,
								requirements: v.requirementRefs,
								proposed: v.proposed
							}))
					}))
				};
			})
	);

	server.registerTool(
		'upsert_events',
		{
			title: 'Draft events',
			description:
				'Add or update events, matched by id, else by title. Participants are role names (or person ids) recorded for the auditee; anyone else goes in participants_note. Requirements must be selected in the engagement. Everything you write is a draft for the auditor to accept.',
			inputSchema: {
				engagement_id: engagementId,
				events: z
					.array(
						z.object({
							id: z.string().optional(),
							title: z.string().min(1),
							format: z.enum(EVENT_FORMATS).optional(),
							date: z.string().nullable().optional().describe('YYYY-MM-DD'),
							start_time: z.string().nullable().optional().describe('HH:MM'),
							duration_min: z.number().int().min(5).max(1440).optional(),
							participants: z.array(z.string()).optional(),
							participants_note: z.string().nullable().optional(),
							requirements: z.array(reqRef).optional(),
							location: z.string().nullable().optional()
						})
					)
					.min(1)
					.max(100)
			}
		},
		({ engagement_id, events }) =>
			run(() => {
				const e = engagement(engagement_id);
				return {
					events: app.sqlite.transaction(() =>
						events.map((ev) => {
							const existing = listEvents(app, e.id).find((x) =>
								ev.id ? x.id === ev.id : x.title.toLowerCase() === ev.title.toLowerCase()
							);
							if (ev.id && !existing) throw new NotFoundError(`No event ${ev.id} in this engagement.`);
							// Matched by title: keep the title as the auditor wrote it.
							const title =
								existing && existing.title.toLowerCase() === ev.title.toLowerCase()
									? existing.title
									: ev.title;
							const input: EventInput = defined({
								title,
								format: ev.format,
								date: ev.date,
								start_time: ev.start_time,
								duration_min: ev.duration_min,
								participant_ids: ev.participants ? people(e, ev.participants) : undefined,
								participants_note: ev.participants_note,
								requirement_ids: ev.requirements?.map((r) => requirement(e, r)),
								location: ev.location
							});
							const saved = existing
								? updateEvent(app, actor, e.id, existing.id, existing.version, input)
								: addEvent(app, actor, e.id, input);
							return { id: saved.id, title: saved.title, proposed: saved.proposed, created: !existing };
						})
					)()
				};
			})
	);

	server.registerTool(
		'upsert_evidence_items',
		{
			title: 'Plan evidence',
			description:
				'Add or update planned evidence on events, matched by id, else by event and text. Phrase each item as something concrete to receive. Criticality left out takes the highest linked risk level of its requirements. Scope is a scope name or id; leave it out for all scopes.',
			inputSchema: {
				engagement_id: engagementId,
				items: z
					.array(
						z.object({
							id: z.string().optional(),
							event_id: z.string().min(1),
							text: z.string().min(1),
							kind: z.enum(EVIDENCE_KINDS).optional(),
							criticality: z.enum(CRITICALITY).optional(),
							requirements: z.array(reqRef).optional(),
							scope: z.string().nullable().optional(),
							status: z.enum(EVIDENCE_STATUSES).optional(),
							promised_by: z.string().nullable().optional(),
							promised_due: z.string().nullable().optional()
						})
					)
					.min(1)
					.max(300)
			}
		},
		({ engagement_id, items }) =>
			run(() => {
				const e = engagement(engagement_id);
				const scopes = listScopes(app, e.id);
				return {
					items: app.sqlite.transaction(() =>
						items.map((it) => {
							const existing = listEvidence(app, e.id).find((x) =>
								it.id
									? x.id === it.id
									: x.eventId === it.event_id && x.text.toLowerCase() === it.text.toLowerCase()
							);
							if (it.id && !existing)
								throw new NotFoundError(`No planned evidence ${it.id} in this engagement.`);
							let scope_id: string | null | undefined;
							if (it.scope !== undefined) {
								if (it.scope === null || it.scope === '' || it.scope.toLowerCase() === 'all') scope_id = null;
								else {
									const s = scopes.find(
										(x) => x.id === it.scope || x.name.toLowerCase() === it.scope!.toLowerCase()
									);
									if (!s) throw new ValidationError(`No scope "${it.scope}" in this engagement.`);
									scope_id = s.id;
								}
							}
							const input: EvidenceInput = defined({
								text: it.text,
								kind: it.kind,
								criticality: it.criticality,
								requirement_ids: it.requirements?.map((r) => requirement(e, r)),
								scope_id,
								status: it.status,
								promised_by: it.promised_by,
								promised_due: it.promised_due
							});
							const saved = existing
								? updateEvidence(app, actor, e.id, existing.id, existing.version, input)
								: addEvidence(app, actor, e.id, it.event_id, input);
							return {
								id: saved.id,
								event_id: saved.eventId,
								criticality: saved.criticality,
								proposed: saved.proposed,
								created: !existing
							};
						})
					)()
				};
			})
	);

	server.registerTool(
		'get_coverage',
		{
			title: 'Get coverage',
			description:
				'Per selected requirement, the events that include it (drafts marked), with its criticality. Uncovered requirements come first and must be fixed before the plan is sent.',
			inputSchema: { engagement_id: engagementId },
			annotations: { readOnlyHint: true }
		},
		({ engagement_id }) =>
			run(() => {
				const e = engagement(engagement_id);
				const c = coverage(app, e.id);
				const crit = criticalityOf(app, e.id);
				return {
					covered: c.covered,
					total: c.total,
					uncovered: c.rows.filter((r) => !r.events.length).map((r) => `${r.sourceCode}:${r.refCode}`),
					requirements: c.rows.map((r) => ({
						ref: `${r.sourceCode}:${r.refCode}`,
						title: r.title,
						criticality: crit.get(r.requirementId)?.level,
						events: r.events.map((x) => ({ id: x.id, title: x.title, date: x.date, proposed: x.proposed }))
					}))
				};
			})
	);

	server.registerTool(
		'render_audit_plan',
		{
			title: 'Render the audit plan',
			description:
				"The audit plan for the auditee from the plan-builder template, in the report language. format markdown returns the text to show the auditor; docx or pdf also saves the file with the engagement's documents. Drafts nobody accepted are left out, as are criticality and risks.",
			inputSchema: { engagement_id: engagementId, format: z.enum(['markdown', 'docx', 'pdf']).optional() }
		},
		({ engagement_id, format }) =>
			runAsync(async () => {
				const e = engagement(engagement_id);
				const plan = buildAuditPlan(app, e.id);
				const notes = {
					uncovered: plan.uncovered,
					drafts_left_out: plan.drafts,
					language: plan.language,
					template_translated: plan.translated
				};
				if (!format || format === 'markdown') return { markdown: plan.markdown, ...notes };
				const a = await exportAuditPlan(app, actor, loadConfig().filesDir, e.id, format);
				return { artifact_id: a.id, filename: a.filename, ...notes };
			})
	);
}
