import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppDatabase } from '#lib/db/client.ts';
import {
	addMentionedDocument,
	ARTIFACT_KINDS,
	getArtifact,
	getArtifactText,
	listArtifacts,
	registerTextArtifact
} from '#lib/domain/artifacts.ts';
import { getEngagement, listEngagements, listScopes, type Engagement } from '#lib/domain/engagements.ts';
import { NotFoundError, ValidationError } from '#lib/domain/errors.ts';
import { assertAiAllowed, assertCanReadRequirement } from '#lib/domain/guards.ts';
import {
	addInternal,
	getInternal,
	listInternal,
	setImplements,
	updateInternal
} from '#lib/domain/internal.ts';
import { resolveRequirementRef } from '#lib/domain/library.ts';
import { engagementOverview } from '#lib/domain/overview.ts';
import { addPerson, listPeople, updatePerson, type PersonInput } from '#lib/domain/people.ts';
import {
	addRisk,
	criticalityOf,
	listRisks,
	RISK_LEVELS,
	RISK_ORIGINS,
	updateRisk
} from '#lib/domain/risks.ts';
import {
	addScope,
	countUnits,
	deselectRequirements,
	listSelected,
	removeScope,
	selectRequirements,
	setScopeHandling,
	setScopeMode,
	unitsInScope,
	updateScope
} from '#lib/domain/selection.ts';
import type { Actor } from '#lib/domain/write.ts';
import { loadConfig } from '#lib/server/config.ts';

type Run = (fn: () => unknown) => import('@modelcontextprotocol/sdk/types.js').CallToolResult;

const engagementId = z.string().min(1).describe('Engagement id from list_engagements.');
const reqRef = z
	.string()
	.min(1)
	.describe('Requirement id, or "<source code>:<reference>" such as "nis2:Art. 21(2)(b)".');

/**
 * Set-up and artifact tools (#43). Every tool works inside one engagement: it refuses when AI is
 * switched off there, and reads only that engagement's auditee's internal requirements.
 */
export function registerSetupTools(server: McpServer, app: AppDatabase, actor: Actor, run: Run) {
	/** The engagement, after checking AI may work on it. */
	const engagement = (id: string): Engagement => {
		const e = getEngagement(app, id);
		assertAiAllowed(e, actor);
		return e;
	};
	/** A requirement reference readable from this engagement (external, or this auditee's internal). */
	const requirement = (e: Engagement, ref: string) => {
		const id = resolveRequirementRef(app, ref);
		assertCanReadRequirement(app, id, { auditeeId: e.auditeeId });
		return id;
	};
	const scopeIds = (e: Engagement, names: string[] | undefined) => {
		const scopes = listScopes(app, e.id);
		return (names ?? []).map((n) => {
			const s = scopes.find((x) => x.id === n || x.name.toLowerCase() === n.toLowerCase());
			if (!s) throw new ValidationError(`No scope "${n}" in this engagement.`);
			return s.id;
		});
	};

	// ---- Orientation

	server.registerTool(
		'list_engagements',
		{
			title: 'List engagements',
			description:
				'Engagements the auditor can work on, with ids, auditee, dates, plan status and whether AI may work on them. Start here.',
			annotations: { readOnlyHint: true }
		},
		() =>
			run(() => ({
				engagements: listEngagements(app).map((e) => ({
					id: e.id,
					name: e.name,
					auditee: e.auditeeName,
					start_date: e.startDate,
					end_date: e.endDate,
					plan_status: e.planStatus,
					ai_allowed: e.aiAllowed
				}))
			}))
	);

	server.registerTool(
		'get_engagement_overview',
		{
			title: 'Engagement overview',
			description:
				'One engagement: the eight phases with done/next and one fact each, counts, scopes, selected requirements with criticality, roles, risks and documents. Use it to see what is missing next.',
			inputSchema: { engagement_id: engagementId },
			annotations: { readOnlyHint: true }
		},
		({ engagement_id }) =>
			run(() => {
				const e = engagement(engagement_id);
				const o = engagementOverview(app, e.id);
				const crit = criticalityOf(app, e.id);
				return {
					engagement: {
						id: e.id,
						name: e.name,
						auditee: { id: e.auditeeId, name: e.auditeeName },
						start_date: e.startDate,
						end_date: e.endDate,
						working_language: e.workingLanguage,
						report_language: e.reportLanguage,
						scope_mode: e.scopeMode,
						plan_status: e.planStatus,
						carry_over_internal: e.carryOverInternal,
						version: e.version
					},
					phases: o.phases.map((p) => ({ number: p.number, title: p.title, state: p.state, fact: p.fact })),
					next: o.current ? `Phase ${o.current.number}: ${o.current.title}` : 'All phases done',
					counts: o.counts,
					scopes: listScopes(app, e.id).map((s) => ({
						id: s.id,
						name: s.name,
						units: unitsInScope(app, s.id)
					})),
					requirements: listSelected(app, e.id).map((s) => ({
						id: s.requirementId,
						ref: `${s.sourceCode}:${s.refCode}`,
						title: s.pinned.title,
						pinned_version: s.pinned.version,
						newer_version: s.newerVersion,
						scope_handling: s.scopeHandling,
						criticality: crit.get(s.requirementId)?.level,
						criticality_from: crit.get(s.requirementId)?.from
					})),
					people: listPeople(app, e.auditeeId).map((p) => ({
						id: p.id,
						role: p.role,
						name: p.name,
						unit: p.unit,
						status: p.status
					})),
					risks: listRisks(app, e.id).map((r) => ({
						id: r.id,
						title: r.title,
						level: r.level,
						requirements: r.requirementIds.length
					})),
					documents: listArtifacts(app, e.id).map((a) => ({
						id: a.id,
						title: a.displayName,
						state: a.state,
						text: a.textStatus
					}))
				};
			})
	);

	// ---- Set-up

	server.registerTool(
		'select_requirements',
		{
			title: 'Select requirements',
			description:
				'Select requirements for the engagement (pinned at the current library version) and/or deselect others. Selecting a parent does not select its children: list each one. Assessment units are regenerated.',
			inputSchema: {
				engagement_id: engagementId,
				select: z.array(reqRef).max(500).optional(),
				deselect: z.array(reqRef).max(500).optional()
			}
		},
		({ engagement_id, select, deselect }) =>
			run(() => {
				const e = engagement(engagement_id);
				return app.sqlite.transaction(() => {
					const sel = select?.length
						? selectRequirements(
								app,
								actor,
								e.id,
								select.map((r) => requirement(e, r))
							)
						: { selected: 0, already: 0 };
					const de = deselect?.length
						? deselectRequirements(
								app,
								actor,
								e.id,
								deselect.map((r) => requirement(e, r))
							)
						: { removed: 0 };
					return { ...sel, deselected: de.removed, assessment_units: countUnits(app, e.id) };
				})();
			})
	);

	server.registerTool(
		'upsert_scopes',
		{
			title: 'Create or update scopes',
			description:
				'Set single or multiple scope mode, and add, rename or drop scopes (matched by id or name). Dropping a scope that has assessment units needs confirm_units_lost: true. There is always at least one scope.',
			inputSchema: {
				engagement_id: engagementId,
				mode: z.enum(['single', 'multiple']).optional(),
				scopes: z
					.array(
						z.object({
							id: z.string().optional(),
							name: z.string().min(1).describe('New name, or the name to match when no id is given.'),
							description: z.string().nullable().optional(),
							drop: z.boolean().optional().describe('Take this scope out of the engagement.'),
							confirm_units_lost: z.boolean().optional()
						})
					)
					.max(50)
					.optional()
			}
		},
		({ engagement_id, mode, scopes }) =>
			run(() => {
				const e = engagement(engagement_id);
				return app.sqlite.transaction(() => {
					if (mode && mode !== e.scopeMode) setScopeMode(app, actor, e.id, e.version, mode);
					const results = (scopes ?? []).map((s) => {
						const existing = listScopes(app, e.id).find((x) =>
							s.id ? x.id === s.id : x.name.toLowerCase() === s.name.toLowerCase()
						);
						if (s.drop) {
							if (!existing) throw new NotFoundError(`No scope ${s.id ?? s.name}.`);
							const units = unitsInScope(app, existing.id);
							if (units && !s.confirm_units_lost)
								throw new ValidationError(
									`Scope ${existing.name} has ${units} assessment units; ask the auditor, then pass confirm_units_lost: true.`
								);
							removeScope(app, actor, existing.id, existing.version);
							return { id: existing.id, name: existing.name, status: 'dropped' };
						}
						if (existing) {
							const res = updateScope(app, actor, existing.id, existing.version, {
								name: s.name,
								...(s.description !== undefined ? { description: s.description } : {})
							});
							return { id: existing.id, name: s.name, status: res.changed ? 'updated' : 'unchanged' };
						}
						const row = addScope(app, actor, e.id, { name: s.name, description: s.description ?? null });
						return { id: String(row.id), name: s.name, status: 'created' };
					});
					return {
						mode: getEngagement(app, e.id).scopeMode,
						scopes: results,
						assessment_units: countUnits(app, e.id)
					};
				})();
			})
	);

	server.registerTool(
		'set_scope_handling',
		{
			title: 'Set scope handling',
			description:
				'Per selected requirement: common (one finding for all scopes) or per_scope (a finding per scope). Only matters with multiple scopes. Assessment units are regenerated; existing units are kept.',
			inputSchema: {
				engagement_id: engagementId,
				items: z
					.array(z.object({ requirement: reqRef, handling: z.enum(['common', 'per_scope']) }))
					.min(1)
					.max(500)
			}
		},
		({ engagement_id, items }) =>
			run(() => {
				const e = engagement(engagement_id);
				const res = setScopeHandling(
					app,
					actor,
					e.id,
					items.map((i) => ({ requirementId: requirement(e, i.requirement), scopeHandling: i.handling }))
				);
				return { ...res, assessment_units: countUnits(app, e.id) };
			})
	);

	server.registerTool(
		'upsert_people',
		{
			title: 'Propose roles',
			description:
				"Add or update the auditee's roles (people to engage with). Role is required; name, email and unit are optional. Matched by id, else by role. Everything written is proposed for the auditor to accept. Give the source document and section a role was found in.",
			inputSchema: {
				engagement_id: engagementId,
				people: z
					.array(
						z.object({
							id: z.string().optional(),
							role: z.string().min(1),
							name: z.string().nullable().optional(),
							email: z.string().nullable().optional(),
							unit: z.string().nullable().optional(),
							responsibilities: z.array(z.string()).optional(),
							source_document: z.string().nullable().optional(),
							source_section: z.string().nullable().optional()
						})
					)
					.min(1)
					.max(100)
			}
		},
		({ engagement_id, people }) =>
			run(() => {
				const e = engagement(engagement_id);
				return {
					people: app.sqlite.transaction(() =>
						people.map((p) => {
							const existing = listPeople(app, e.auditeeId).find((x) =>
								p.id ? x.id === p.id : x.role.toLowerCase() === p.role.toLowerCase()
							);
							if (p.id && !existing) throw new NotFoundError(`No role ${p.id} for this auditee.`);
							const { id: _id, ...rest } = p;
							const input = Object.fromEntries(
								Object.entries(rest).filter(([, v]) => v !== undefined)
							) as unknown as PersonInput;
							// Matched by role: keep the role as the auditor wrote it.
							if (existing && existing.role.toLowerCase() === p.role.toLowerCase())
								input.role = existing.role;
							const person = existing
								? updatePerson(app, actor, existing.id, existing.version, input)
								: addPerson(app, actor, e.auditeeId, input);
							return { id: person.id, role: person.role, status: person.status, created: !existing };
						})
					)()
				};
			})
	);

	server.registerTool(
		'upsert_risks',
		{
			title: 'Create or update risks',
			description:
				'Add or update risks, matched by id, else by title. Each risk has a level (high, medium, low), an origin (auditee_register or auditor) and the selected requirements it affects; optional scopes by name or id. The highest linked level becomes the default criticality of a requirement.',
			inputSchema: {
				engagement_id: engagementId,
				risks: z
					.array(
						z.object({
							id: z.string().optional(),
							title: z.string().min(1),
							description: z.string().nullable().optional(),
							level: z.enum(RISK_LEVELS).optional(),
							origin: z.enum(RISK_ORIGINS).optional(),
							requirements: z.array(reqRef).optional(),
							scopes: z.array(z.string()).optional()
						})
					)
					.min(1)
					.max(100)
			}
		},
		({ engagement_id, risks }) =>
			run(() => {
				const e = engagement(engagement_id);
				return {
					risks: app.sqlite.transaction(() =>
						risks.map((r) => {
							const existing = listRisks(app, e.id).find((x) =>
								r.id ? x.id === r.id : x.title.toLowerCase() === r.title.toLowerCase()
							);
							if (r.id && !existing) throw new NotFoundError(`No risk ${r.id} in this engagement.`);
							const input = {
								title: r.title,
								...(r.description !== undefined ? { description: r.description } : {}),
								...(r.level ? { level: r.level } : {}),
								...(r.origin ? { origin: r.origin } : {}),
								...(r.requirements ? { requirement_ids: r.requirements.map((x) => requirement(e, x)) } : {}),
								...(r.scopes ? { scope_ids: scopeIds(e, r.scopes) } : {})
							};
							const risk = existing
								? updateRisk(app, actor, existing.id, existing.version, input)
								: addRisk(app, actor, e.id, input);
							return { id: risk.id, title: risk.title, level: risk.level, created: !existing };
						})
					)()
				};
			})
	);

	// ---- Artifacts

	server.registerTool(
		'list_artifacts',
		{
			title: 'List documents',
			description:
				"The engagement's documents and other artifacts with ids, kind, state (received or mentioned) and whether their text could be read.",
			inputSchema: { engagement_id: engagementId },
			annotations: { readOnlyHint: true }
		},
		({ engagement_id }) =>
			run(() => ({
				artifacts: listArtifacts(app, engagement(engagement_id).id).map((a) => ({
					id: a.id,
					title: a.displayName,
					filename: a.filename,
					kind: a.kind,
					state: a.state,
					text: a.textStatus,
					text_length: a.textLength,
					version_label: a.versionLabel,
					approval_date: a.approvalDate,
					language: a.language
				}))
			}))
	);

	server.registerTool(
		'get_artifact_text',
		{
			title: 'Read document text',
			description:
				'Read a document\'s extracted text in pages. Each page has a locator ("p. 3" for PDFs, otherwise a character range) to cite. Continue with offset = next_offset until it is null.',
			inputSchema: {
				engagement_id: engagementId,
				artifact_id: z.string().min(1),
				offset: z.number().int().min(0).optional(),
				max_chars: z.number().int().min(500).max(20000).optional()
			},
			annotations: { readOnlyHint: true }
		},
		({ engagement_id, artifact_id, offset, max_chars }) =>
			run(() => {
				const e = engagement(engagement_id);
				if (!listArtifacts(app, e.id).some((a) => a.id === artifact_id))
					throw new NotFoundError('Document not found in this engagement.');
				const page = getArtifactText(app, artifact_id, offset ?? 0, max_chars ?? 8000);
				return {
					artifact_id: page.artifactId,
					title: page.title,
					locator: page.locator,
					offset: page.offset,
					next_offset: page.nextOffset,
					total_length: page.totalLength,
					text: page.text
				};
			})
	);

	server.registerTool(
		'register_artifact',
		{
			title: 'Register an artifact',
			description:
				'Store text as an artifact of the engagement: an interview transcript, meeting notes, or a document fetched from another system. With mentioned: true and no text, record a document that was named but not received yet.',
			inputSchema: {
				engagement_id: engagementId,
				title: z.string().min(1),
				text: z.string().max(2_000_000).optional(),
				mentioned: z.boolean().optional(),
				kind: z.enum(ARTIFACT_KINDS).optional(),
				language: z.string().optional(),
				received_from: z.string().optional().describe('Who or which system it came from.'),
				filename: z.string().optional()
			}
		},
		({ engagement_id, title, text, mentioned, kind, language, received_from, filename }) =>
			run(() => {
				const e = engagement(engagement_id);
				const a = mentioned
					? addMentionedDocument(app, actor, e.id, title, { kind: kind ?? null })
					: registerTextArtifact(app, actor, loadConfig().filesDir, e.id, {
							title,
							text: text ?? '',
							kind: kind ?? null,
							language: language ?? null,
							receivedFrom: received_from ?? null,
							filename: filename ?? null
						});
				return { id: a.id, title: a.displayName, state: a.state, text: a.textStatus };
			})
	);

	// ---- Internal requirements

	server.registerTool(
		'list_internal_requirements',
		{
			title: 'List internal requirements',
			description:
				"The auditee's internal requirements in this engagement (and carried over ones), with what they implement and their status.",
			inputSchema: { engagement_id: engagementId },
			annotations: { readOnlyHint: true }
		},
		({ engagement_id }) =>
			run(() => ({
				internal_requirements: listInternal(app, engagement(engagement_id).id).map((r) => ({
					id: r.id,
					ref: r.refCode,
					title: r.title,
					section: r.section,
					document: r.artifactId ? { id: r.artifactId, title: r.sourceTitle } : null,
					status: r.status,
					carried_over: r.carriedOver,
					implements: r.implements.map((l) => ({
						ref: `${l.other.sourceCode}:${l.other.refCode}`,
						coverage: l.coverage
					})),
					version: r.version
				}))
			}))
	);

	server.registerTool(
		'upsert_internal_requirements',
		{
			title: 'Propose internal requirements',
			description:
				"Propose requirements the auditee set for itself in one of its documents, each with a short quote in the original language, the section, and the external requirements it implements (coverage full or partial). Give ref (INT-n) to update one. Everything written is proposed for the auditor to accept. Never use another auditee's documents.",
			inputSchema: {
				engagement_id: engagementId,
				artifact_id: z.string().optional().describe('The document they come from.'),
				requirements: z
					.array(
						z.object({
							ref: z.string().optional().describe('INT-n of an existing one to update.'),
							title: z.string().min(1).describe('Short statement of the rule.'),
							text: z.string().nullable().optional(),
							quote: z.string().nullable().optional(),
							section: z.string().nullable().optional(),
							language: z.string().optional(),
							implements: z
								.array(z.object({ requirement: reqRef, coverage: z.enum(['full', 'partial']) }))
								.optional()
						})
					)
					.min(1)
					.max(200)
			}
		},
		({ engagement_id, artifact_id, requirements }) =>
			run(() => {
				const e = engagement(engagement_id);
				if (
					artifact_id &&
					getArtifact(app, artifact_id) &&
					!listArtifacts(app, e.id).some((a) => a.id === artifact_id)
				)
					throw new NotFoundError('Document not found in this engagement.');
				return {
					internal_requirements: app.sqlite.transaction(() =>
						requirements.map((r) => {
							const implementsIds = (r.implements ?? []).map((l) => ({
								requirementId: requirement(e, l.requirement),
								coverage: l.coverage
							}));
							if (r.ref) {
								const existing = listInternal(app, e.id).find((x) => x.refCode === r.ref && !x.carriedOver);
								if (!existing)
									throw new NotFoundError(`No internal requirement ${r.ref} in this engagement.`);
								const patch = Object.fromEntries(
									Object.entries({
										title: r.title,
										text: r.text,
										quote: r.quote,
										section: r.section,
										language: r.language
									}).filter(([, v]) => v !== undefined)
								);
								updateInternal(app, actor, e.id, existing.id, existing.version, patch);
								for (const l of implementsIds) setImplements(app, actor, e.id, existing.id, l);
								const now = getInternal(app, e.id, existing.id);
								return { id: now.id, ref: now.refCode, status: now.status, created: false };
							}
							const created = addInternal(app, actor, e.id, {
								title: r.title,
								text: r.text ?? null,
								quote: r.quote ?? null,
								section: r.section ?? null,
								language: r.language ?? null,
								artifactId: artifact_id ?? null,
								implements: implementsIds
							});
							return { id: created.id, ref: created.refCode, status: created.status, created: true };
						})
					)()
				};
			})
	);
}
