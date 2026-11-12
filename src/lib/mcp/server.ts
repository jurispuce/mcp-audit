import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { AppDatabase } from '#lib/db/client.ts';
import { mcpActor, type SessionUser } from '#lib/domain/auth.ts';
import { addComment } from '#lib/domain/comments.ts';
import { DomainError, NotFoundError } from '#lib/domain/errors.ts';
import { assertCanReadRequirement, assertItemReadable } from '#lib/domain/guards.ts';
import { authorshipLabel } from '#lib/domain/history.ts';
import { getItemHistory, revertItem } from '#lib/domain/items.ts';
import {
	addLink,
	criteriaOf,
	getRequirement,
	getSourceByCode,
	LINK_TYPES,
	linksOf,
	requirementTree,
	resolveRequirementRef,
	searchRequirements,
	setCriteria,
	setGuidance,
	getGuidance,
	translationsOf,
	upsertSources
} from '#lib/domain/library.ts';
import { upsertRequirements } from '#lib/domain/library-import.ts';
import { entityTypes } from '#lib/domain/registry.ts';
import type { Actor } from '#lib/domain/write.ts';
import '#lib/domain/entities.ts';
import { APP_VERSION } from '#lib/version.ts';

/**
 * The MCP server: the domain layer exposed as tools, in the app's own process. Every write is made by
 * the token's owner as user and the AI as agent, on channel MCP, so it reads "Claude on behalf of <user>".
 * Tools are thin: validation, permissions and guard rails all live in the domain layer.
 */

export const AGENT_NAME = process.env.MCP_AGENT_NAME?.trim() || 'Claude';

const INSTRUCTIONS = `mcp-audit is an audit planning and running database. You act on behalf of the signed-in auditor.
Rules: every change you make is versioned and shown as "${AGENT_NAME} on behalf of <auditor>". Judgement writes (internal requirements, evidence links, findings, drafted events, roles) are stored as proposed for a person to accept. You cannot approve findings, change plan status or delete files. Results are compact JSON and include ids; pass ids back to other tools.
Library: search_requirements and get_requirement read; upsert_sources, upsert_requirements, link_requirements, set_guidance and set_criteria write. A requirement can be named by its id or as "<source code>:<reference>", for example "nis2:Art. 21(2)(b)".`;

type Json = Record<string, unknown> | unknown[];

function ok(data: Json): CallToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

/** Domain errors become tool errors the model can read and act on; anything else is a server fault. */
function run(fn: () => Json): CallToolResult {
	try {
		return ok(fn());
	} catch (e) {
		if (e instanceof DomainError) {
			const fields =
				'fields' in e && e.fields && Object.keys(e.fields as object).length
					? ` ${JSON.stringify(e.fields)}`
					: '';
			return { isError: true, content: [{ type: 'text', text: `${e.code}: ${e.message}${fields}` }] };
		}
		throw e;
	}
}

const reqRef = z
	.string()
	.min(1)
	.describe('Requirement id, or "<source code>:<reference>" such as "nis2:Art. 21(2)(b)".');
const entityType = z
	.string()
	.min(1)
	.describe('Item type, for example requirement, source, guidance, criterion, requirement_link.');

export function createMcpServer(app: AppDatabase, user: SessionUser): McpServer {
	const actor: Actor = mcpActor(user, AGENT_NAME);
	const server = new McpServer({ name: 'mcp-audit', version: APP_VERSION }, { instructions: INSTRUCTIONS });
	const lib = { auditeeId: null }; // library tools read from outside any engagement

	// ---- Orientation

	server.registerTool(
		'list_engagements',
		{
			title: 'List engagements',
			description:
				'Engagements the auditor can work on, with ids. Start here to find the engagement to work in.',
			annotations: { readOnlyHint: true }
		},
		() =>
			run(() => ({
				engagements: [],
				note: 'This version of mcp-audit has no engagements yet; the library is available.'
			}))
	);

	server.registerTool(
		'get_engagement_overview',
		{
			title: 'Engagement overview',
			description: 'Phase progress, counts and what is missing next for one engagement.',
			inputSchema: { engagement_id: z.string().min(1) },
			annotations: { readOnlyHint: true }
		},
		({ engagement_id }) =>
			run(() => {
				throw new NotFoundError(
					`Engagement ${engagement_id} not found. This version of mcp-audit has no engagements yet.`
				);
			})
	);

	// ---- Library: read

	server.registerTool(
		'search_requirements',
		{
			title: 'Search requirements',
			description:
				'Full-text search over reference code, title and text across the library (or one source). Diacritics are ignored.',
			inputSchema: {
				query: z.string().min(1),
				source: z.string().optional().describe('Limit to one source code, for example "nis2".'),
				limit: z.number().int().min(1).max(50).optional()
			},
			annotations: { readOnlyHint: true }
		},
		({ query, source, limit }) =>
			run(() => {
				const src = source ? getSourceByCode(app, source) : null;
				if (source && !src) throw new NotFoundError(`No source ${source}.`);
				return {
					results: searchRequirements(app, query, { sourceId: src?.id, limit: limit ?? 20 }).map((r) => ({
						id: r.id,
						ref: r.refCode,
						title: r.title,
						source: r.sourceCode,
						language: r.language,
						snippet: r.snippet
					}))
				};
			})
	);

	server.registerTool(
		'get_requirement',
		{
			title: 'Get requirement',
			description:
				'One requirement with its text, parent and children, links in both directions, guidance, general criteria and language versions.',
			inputSchema: { requirement: reqRef },
			annotations: { readOnlyHint: true }
		},
		({ requirement }) =>
			run(() => {
				const id = resolveRequirementRef(app, requirement);
				assertCanReadRequirement(app, id, lib);
				const r = getRequirement(app, id);
				const parent = r.parentId ? getRequirement(app, r.parentId) : null;
				const children = findChildren(app, r.sourceId, r.id);
				const guidance = getGuidance(app, id);
				return {
					id: r.id,
					ref: r.refCode,
					title: r.title,
					text: r.text,
					language: r.language,
					source: { code: r.sourceCode, title: r.sourceTitle },
					status: r.status,
					version: r.version,
					parent: parent && { id: parent.id, ref: parent.refCode, title: parent.title },
					children,
					guidance: guidance && { body: guidance.body, version: guidance.version },
					criteria: criteriaOf(app, id).map((c) => ({
						id: c.id,
						text: c.text,
						expected_evidence: c.expectedEvidence,
						version: c.version
					})),
					links: linksOf(app, id).map((l) => ({
						id: l.id,
						relation: l.label,
						type: l.type,
						direction: l.direction,
						coverage: l.coverage,
						note: l.note,
						other: { id: l.other.id, ref: l.other.refCode, source: l.other.sourceCode, title: l.other.title }
					})),
					translations: translationsOf(app, id).map((t) => ({
						id: t.id,
						language: t.language,
						ref: t.refCode,
						title: t.title
					}))
				};
			})
	);

	// ---- Library: write

	server.registerTool(
		'upsert_sources',
		{
			title: 'Create or update sources',
			description:
				'Create sources (laws, standards) or update them, matched by code. Only external sources; internal ones belong to an engagement.',
			inputSchema: {
				sources: z
					.array(
						z.object({
							code: z.string().min(1).describe('Stable short key, for example "nis2" or "iso27001-2022".'),
							title: z.string().min(1),
							type: z.enum(['law', 'standard']).optional(),
							edition: z.string().optional(),
							language: z
								.string()
								.optional()
								.describe('Language code, for example "en" or "lv". Default en.'),
							licence_note: z.string().optional()
						})
					)
					.min(1)
					.max(50)
			}
		},
		({ sources }) => run(() => ({ sources: upsertSources(app, actor, sources) }))
	);

	server.registerTool(
		'upsert_requirements',
		{
			title: 'Create or update requirements',
			description:
				'Create or update requirements of one source in bulk, matched by reference. Only the fields given change. Store full text of licensed standards (ISO) only when the auditor confirms the licence allows it.',
			inputSchema: {
				source: z.string().min(1).describe('Source code.'),
				requirements: z
					.array(
						z.object({
							ref: z.string().min(1).describe('Reference code, for example "Art. 21(2)(b)" or "A.5.15".'),
							title: z.string().optional().describe('Required for a new requirement.'),
							text: z.string().nullable().optional(),
							parent: z
								.string()
								.nullable()
								.optional()
								.describe('Reference code of the parent in the same source.'),
							locator: z.string().nullable().optional(),
							language: z.string().optional(),
							translation_of: z
								.string()
								.nullable()
								.optional()
								.describe('"<source code>:<reference>" of the same requirement in another language.')
						})
					)
					.min(1)
					.max(500)
			}
		},
		({ source, requirements }) =>
			run(() => {
				const report = upsertRequirements(app, actor, source, requirements, `Upserted by ${AGENT_NAME}`);
				return { source: report.source.code, requirements: report.requirements, warnings: report.warnings };
			})
	);

	server.registerTool(
		'link_requirements',
		{
			title: 'Link requirements',
			description:
				'Add typed, directional links between requirements, within or across sources: details, explains, implements (needs coverage full or partial), equivalent, conflicts. An existing identical link is reported, not duplicated.',
			inputSchema: {
				links: z
					.array(
						z.object({
							from: reqRef,
							to: reqRef,
							type: z.enum(LINK_TYPES),
							coverage: z.enum(['full', 'partial']).optional(),
							note: z.string().optional()
						})
					)
					.min(1)
					.max(200)
			}
		},
		({ links }) =>
			run(() => {
				const results = app.sqlite.transaction(() =>
					links.map((l) => {
						const from = resolveRequirementRef(app, l.from);
						const to = resolveRequirementRef(app, l.to);
						assertCanReadRequirement(app, from, lib);
						assertCanReadRequirement(app, to, lib);
						const existing = linksOf(app, from).find(
							(x) => x.direction === 'out' && x.other.id === to && x.type === l.type
						);
						if (existing) return { id: existing.id, from, to, type: l.type, status: 'exists' };
						const row = addLink(app, actor, {
							fromId: from,
							toId: to,
							type: l.type,
							coverage: l.coverage ?? null,
							note: l.note ?? null
						}).row;
						return { id: String(row.id), from, to, type: l.type, status: 'created' };
					})
				)();
				return { links: results };
			})
	);

	server.registerTool(
		'set_guidance',
		{
			title: 'Set guidance',
			description:
				"Replace a requirement's guidance (how to audit it). Guidance is versioned apart from the requirement text. Give base_version from get_requirement when editing existing guidance.",
			inputSchema: {
				requirement: reqRef,
				body: z.string().max(20000),
				base_version: z.number().int().optional()
			}
		},
		({ requirement, body, base_version }) =>
			run(() => {
				const id = resolveRequirementRef(app, requirement);
				assertCanReadRequirement(app, id, lib);
				const res = setGuidance(app, actor, id, body, base_version);
				return { id: String(res.row.id), requirement: id, version: res.version, changed: res.changed };
			})
	);

	server.registerTool(
		'set_criteria',
		{
			title: 'Set general criteria',
			description:
				"Set a requirement's general criteria: what evidence must show. mode replace (default) keeps criteria with the same text, updates their expected evidence, adds new ones and removes the rest; mode add only adds.",
			inputSchema: {
				requirement: reqRef,
				criteria: z
					.array(z.object({ text: z.string().min(1), expected_evidence: z.array(z.string()).optional() }))
					.max(50),
				mode: z.enum(['replace', 'add']).optional()
			}
		},
		({ requirement, criteria, mode }) =>
			run(() => {
				const id = resolveRequirementRef(app, requirement);
				assertCanReadRequirement(app, id, lib);
				return { requirement: id, ...setCriteria(app, actor, id, criteria, mode ?? 'replace') };
			})
	);

	// ---- Cross-cutting: any item

	server.registerTool(
		'add_comment',
		{
			title: 'Add comment',
			description: 'Add a comment to any item. Comments are append-only: they cannot be edited or deleted.',
			inputSchema: {
				entity_type: entityType,
				entity_id: z.string().min(1),
				body: z.string().min(1).max(10000)
			}
		},
		({ entity_type, entity_id, body }) =>
			run(() => {
				assertItemReadable(app, entity_type, entity_id, lib);
				const c = addComment(app, actor, entity_type, entity_id, body);
				return { id: c.id, entity_type, entity_id, created_at: c.createdAt.toISOString() };
			})
	);

	server.registerTool(
		'get_history',
		{
			title: 'Get history',
			description:
				'Versions of any item, newest first: who (and which agent) changed what, when and through which channel.',
			inputSchema: {
				entity_type: entityType,
				entity_id: z.string().min(1),
				limit: z.number().int().min(1).max(100).optional()
			},
			annotations: { readOnlyHint: true }
		},
		({ entity_type, entity_id, limit }) =>
			run(() => {
				assertItemReadable(app, entity_type, entity_id, lib);
				return {
					versions: getItemHistory(app, entity_type, entity_id)
						.slice(0, limit ?? 20)
						.map((h) => ({
							version: h.version,
							current: h.isCurrent,
							summary: h.summary,
							author: authorshipLabel(h.authorName, h.authorAgent),
							channel: h.channel,
							at: h.createdAt.toISOString(),
							reverted_from: h.revertedFrom,
							changes: h.changes.map((c) => ({ field: c.field, from: c.from, to: c.to }))
						}))
				};
			})
	);

	server.registerTool(
		'revert',
		{
			title: 'Revert item',
			description:
				'Revert any item to an earlier version. Creates a new version that copies it; nothing is lost. base_version is the current version (from get_history). The same rules apply as for any AI write.',
			inputSchema: {
				entity_type: entityType,
				entity_id: z.string().min(1),
				to_version: z.number().int().min(1),
				base_version: z.number().int().min(1)
			}
		},
		({ entity_type, entity_id, to_version, base_version }) =>
			run(() => {
				assertItemReadable(app, entity_type, entity_id, lib);
				const res = revertItem(app, actor, entity_type, entity_id, base_version, to_version);
				return { entity_type, entity_id, version: res.version, reverted_from: to_version };
			})
	);

	return server;
}

function findChildren(app: AppDatabase, sourceId: string, id: string) {
	const walk = (
		nodes: ReturnType<typeof requirementTree>
	): { id: string; ref: string; title: string }[] | null => {
		for (const n of nodes) {
			if (n.id === id) return n.children.map((c) => ({ id: c.id, ref: c.refCode, title: c.title }));
			const found = walk(n.children);
			if (found) return found;
		}
		return null;
	};
	return walk(requirementTree(app, sourceId)) ?? [];
}

/** Every item type the cross-cutting tools accept. */
export function itemTypes(): string[] {
	return entityTypes();
}
