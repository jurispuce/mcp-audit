import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { AppDatabase } from '#lib/db/client.ts';
import { findingScaleOf, getEngagement, type Engagement } from '#lib/domain/engagements.ts';
import { NotFoundError, ValidationError } from '#lib/domain/errors.ts';
import {
	addEvidenceLink,
	addNote,
	listLinks,
	listNotes,
	MENTION_TYPES,
	SUFFICIENCY,
	type Mention
} from '#lib/domain/execution.ts';
import { proposeFinding, unitCard, unitCards } from '#lib/domain/findings.ts';
import { assertAiAllowed } from '#lib/domain/guards.ts';
import { getEvent, listEvidence } from '#lib/domain/planning.ts';
import { criteriaOf } from '#lib/domain/library.ts';
import { listRisks } from '#lib/domain/risks.ts';
import {
	buildFindingsReport,
	buildPostEventReport,
	exportFindingsReport,
	exportPostEventReport
} from '#lib/domain/reports.ts';
import type { Actor } from '#lib/domain/write.ts';
import { loadConfig } from '#lib/server/config.ts';

type Run = (fn: () => unknown) => CallToolResult;
type RunAsync = (fn: () => Promise<unknown>) => Promise<CallToolResult>;
const engagementId = z.string().min(1).describe('Engagement id from list_engagements.');

/**
 * Execution and conclusion tools (#60). Evidence links and findings written here are proposals; no
 * tool confirms a link, approves a finding or shares a suspected issue.
 */
export function registerRunTools(
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

	server.registerTool(
		'get_event_status',
		{
			title: 'Event status',
			description:
				'One event: its planned evidence with status, promises and links (proposed or confirmed), its notes, and the artifacts captured at it.',
			inputSchema: { engagement_id: engagementId, event_id: z.string().min(1) },
			annotations: { readOnlyHint: true }
		},
		({ engagement_id, event_id }) =>
			run(() => {
				const e = engagement(engagement_id);
				const ev = getEvent(app, e.id, event_id);
				const links = listLinks(app, e.id, { eventId: ev.id });
				return {
					event: {
						id: ev.id,
						title: ev.title,
						date: ev.date,
						start_time: ev.startTime,
						status: ev.status,
						participants: ev.participantsLine,
						requirements: ev.requirements.map((r) => r.refCode)
					},
					evidence: listEvidence(app, e.id, { eventId: ev.id }).map((x) => ({
						id: x.id,
						text: x.text,
						kind: x.kind,
						criticality: x.criticality,
						status: x.status,
						promised_by: x.promisedBy,
						promised_due: x.promisedDue,
						requirements: x.requirementRefs,
						links: links
							.filter((l) => l.evidenceItemId === x.id)
							.map((l) => ({
								id: l.id,
								artifact: l.artifactTitle,
								sufficiency: l.sufficiency,
								status: l.status,
								locator: l.locator
							}))
					})),
					notes: listNotes(app, e.id, { eventId: ev.id }).map((n) => ({
						id: n.id,
						type: n.type,
						text: n.text,
						at: n.at.toISOString(),
						mentions: n.mentions
					}))
				};
			})
	);

	server.registerTool(
		'upsert_notes',
		{
			title: 'Write notes',
			description:
				'Add auditor notes to an event, for example from a transcript: type note, promise or issue, with mentions ({type, id, label}; types requirement, internal_requirement, artifact, person, evidence_item). A promise mentioning planned evidence sets it to promised by the mentioned person. An artifact mention with an empty id records a document named but not received. Say in the text when you inferred a promise or issue.',
			inputSchema: {
				engagement_id: engagementId,
				event_id: z.string().min(1),
				notes: z
					.array(
						z.object({
							type: z.enum(['note', 'promise', 'issue']).optional(),
							text: z.string().min(1),
							mentions: z
								.array(z.object({ type: z.enum(MENTION_TYPES), id: z.string(), label: z.string() }))
								.optional(),
							at: z
								.string()
								.optional()
								.describe('ISO time the note refers to, for example from a transcript timestamp.'),
							due: z.string().optional().describe('For a promise: YYYY-MM-DD.')
						})
					)
					.min(1)
					.max(200)
			}
		},
		({ engagement_id, event_id, notes }) =>
			run(() => {
				const e = engagement(engagement_id);
				return {
					notes: app.sqlite.transaction(() =>
						notes.map((n) => {
							const r = addNote(app, actor, e.id, event_id, {
								type: n.type,
								text: n.text,
								mentions: (n.mentions ?? []) as Mention[],
								at: n.at ? Date.parse(n.at) : undefined,
								due: n.due ?? null
							});
							return { id: r.note.id, type: r.note.type, effects: r.effects };
						})
					)()
				};
			})
	);

	server.registerTool(
		'link_evidence',
		{
			title: 'Propose evidence links',
			description:
				'Propose that an artifact shows planned evidence: where in it (locator: page, row, timestamp), a short excerpt, and sufficiency (supports, partial, contradicts). Links are proposed; the auditor confirms them, which marks the evidence received.',
			inputSchema: {
				engagement_id: engagementId,
				links: z
					.array(
						z.object({
							artifact_id: z.string().min(1),
							evidence_item_id: z.string().min(1),
							locator: z.string().optional(),
							excerpt: z.string().max(1000).optional(),
							sufficiency: z.enum(SUFFICIENCY)
						})
					)
					.min(1)
					.max(200)
			}
		},
		({ engagement_id, links }) =>
			run(() => {
				const e = engagement(engagement_id);
				return {
					links: app.sqlite.transaction(() =>
						links.map((l) => {
							const existing = listLinks(app, e.id).find(
								(x) => x.artifactId === l.artifact_id && x.evidenceItemId === l.evidence_item_id
							);
							if (existing) return { id: existing.id, status: existing.status, created: false };
							const r = addEvidenceLink(app, actor, e.id, {
								artifactId: l.artifact_id,
								evidenceItemId: l.evidence_item_id,
								locator: l.locator ?? null,
								excerpt: l.excerpt ?? null,
								sufficiency: l.sufficiency
							});
							return { id: r.id, status: r.status, created: true };
						})
					)()
				};
			})
	);

	server.registerTool(
		'render_post_event_report',
		{
			title: 'Render the post-event report',
			description:
				"The report for the event's attendees, from the debrief template in the report language: received, outstanding, agreed follow-ups. Never holds suspected issues, sufficiency or criticality. format markdown returns text; docx or pdf saves it with the engagement's documents.",
			inputSchema: {
				engagement_id: engagementId,
				event_id: z.string().min(1),
				format: z.enum(['markdown', 'docx', 'pdf']).optional()
			}
		},
		({ engagement_id, event_id, format }) =>
			runAsync(async () => {
				const e = engagement(engagement_id);
				if (!format || format === 'markdown')
					return { markdown: buildPostEventReport(app, e.id, event_id).markdown };
				const a = await exportPostEventReport(app, actor, loadConfig().filesDir, e.id, event_id, format);
				return { artifact_id: a.id, filename: a.filename };
			})
	);

	server.registerTool(
		'list_assessment_units',
		{
			title: 'List assessment units',
			description:
				'Every requirement-by-scope unit with its evidence counts, suspected issue count and current finding (value and status).',
			inputSchema: { engagement_id: engagementId },
			annotations: { readOnlyHint: true }
		},
		({ engagement_id }) =>
			run(() => {
				const e = engagement(engagement_id);
				return {
					finding_scale: findingScaleOf(app, e.id).map((v) => ({
						code: v.code,
						label: v.label,
						nonconformity: v.isNonconformity
					})),
					units: unitCards(app, e.id).map((c) => ({
						id: c.unitId,
						ref: `${c.sourceCode}:${c.refCode}`,
						title: c.title,
						scope: c.scopeName,
						criticality: c.criticality,
						evidence: c.evidenceSummary,
						suspected_issues: c.suspectedIssues.length,
						finding: c.finding && {
							id: c.finding.id,
							value: c.finding.value?.code ?? null,
							status: c.finding.status
						}
					}))
				};
			})
	);

	server.registerTool(
		'get_assessment_unit',
		{
			title: 'Get an assessment unit',
			description:
				"Everything to reach a finding for one unit: the pinned requirement text, criticality, planned evidence with status and links (locator, excerpt, sufficiency), the auditee's internal rules, suspected issues, and the current finding.",
			inputSchema: { engagement_id: engagementId, unit_id: z.string().min(1) },
			annotations: { readOnlyHint: true }
		},
		({ engagement_id, unit_id }) =>
			run(() => {
				const e = engagement(engagement_id);
				const c = unitCard(app, e.id, unit_id);
				return {
					id: c.unitId,
					requirement: { ref: `${c.sourceCode}:${c.refCode}`, title: c.title, text: c.text },
					scope: c.scopeName,
					criticality: c.criticality,
					evidence: c.evidence.map((x) => ({
						id: x.id,
						text: x.text,
						kind: x.kind,
						criticality: x.criticality,
						status: x.status,
						links: x.links
					})),
					criteria: [...criteriaOf(app, c.requirementId), ...criteriaOf(app, c.requirementId, e.id)].map(
						(x) => ({
							text: x.text,
							expected_evidence: x.expectedEvidence
						})
					),
					risks: listRisks(app, e.id)
						.filter(
							(r) =>
								r.requirementIds.includes(c.requirementId) &&
								(!r.scopeIds.length || !c.scopeId || r.scopeIds.includes(c.scopeId))
						)
						.map((r) => ({ title: r.title, level: r.level })),
					internal_rules: c.internalRules,
					suspected_issues: c.suspectedIssues.map((n) => n.text),
					finding: c.finding && {
						id: c.finding.id,
						value: c.finding.value?.code ?? null,
						rationale: c.finding.rationale,
						status: c.finding.status,
						evidence_item_ids: c.finding.evidenceItemIds,
						version: c.finding.version
					},
					finding_scale: findingScaleOf(app, e.id).map((v) => ({
						code: v.code,
						label: v.label,
						nonconformity: v.isNonconformity
					}))
				};
			})
	);

	server.registerTool(
		'propose_finding',
		{
			title: 'Propose a finding',
			description:
				"Propose the finding for one assessment unit: a value code from the engagement's finding scale, the rationale, the evidence relied on and confidence. Missing or incomplete evidence gives no reasonable assurance (na), never a non-conformity. A suspected issue blocks proposing conformity. Proposals wait for the auditor; approval happens only in the app.",
			inputSchema: {
				engagement_id: engagementId,
				unit_id: z.string().min(1),
				value: z.string().min(1).describe('Finding value code, for example na, c, cp, cn, minor, major.'),
				rationale: z.string().min(1).max(5000),
				evidence_item_ids: z.array(z.string()).optional(),
				confidence: z.enum(['high', 'medium', 'low']).optional()
			}
		},
		({ engagement_id, unit_id, value, rationale, evidence_item_ids, confidence }) =>
			run(() => {
				const e = engagement(engagement_id);
				const v = findingScaleOf(app, e.id).find((x) => x.code === value || x.id === value);
				if (!v) throw new ValidationError(`No finding value "${value}" in this engagement's scale.`);
				if (!unitCards(app, e.id).some((c) => c.unitId === unit_id))
					throw new NotFoundError('Assessment unit not found');
				const f = proposeFinding(app, actor, e.id, unit_id, {
					findingValueId: v.id,
					rationale,
					evidenceItemIds: evidence_item_ids,
					confidence: confidence ?? null
				});
				return { id: f.id, unit_id, value: v.code, status: f.status };
			})
	);

	server.registerTool(
		'render_findings_report',
		{
			title: 'Render the findings report',
			description:
				"The audit report from the assurance-review template in the report language. Only approved findings, unless include_drafts, which marks the report DRAFT. format markdown returns text; docx or pdf saves it with the engagement's documents.",
			inputSchema: {
				engagement_id: engagementId,
				include_drafts: z.boolean().optional(),
				format: z.enum(['markdown', 'docx', 'pdf']).optional()
			}
		},
		({ engagement_id, include_drafts, format }) =>
			runAsync(async () => {
				const e = engagement(engagement_id);
				const options = { includeDrafts: include_drafts ?? false };
				if (!format || format === 'markdown') {
					const r = buildFindingsReport(app, e.id, options);
					return { markdown: r.markdown, approved: r.approved, drafts: r.drafts, units: r.units };
				}
				const a = await exportFindingsReport(app, actor, loadConfig().filesDir, e.id, format, options);
				return { artifact_id: a.id, filename: a.filename };
			})
	);
}
