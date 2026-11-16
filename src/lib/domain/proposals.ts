import type { AppDatabase } from '#lib/db/client.ts';
import { getEngagement } from './engagements';
import { NotFoundError, ValidationError } from './errors';
import { confirmLink, listLinks, removeLink } from './execution';
import { acceptProposal, listFindings, rejectProposal } from './findings';
import { requireHuman } from './guards';
import {
	acceptInternal,
	acceptRecheckProposal,
	getInternal,
	keepInternal,
	listInternal,
	rejectInternal,
	rejectRecheckProposal,
	removeAfterRecheck
} from './internal';
import { acceptPerson, listPeople, rejectPerson } from './people';
import {
	acceptEvent,
	acceptEvidence,
	listEvents,
	listEvidence,
	rejectEvent,
	removeEvidence
} from './planning';
import { listAssessmentUnits } from './selection';
import { acceptRisk, listRisks, rejectRisk } from './risks';
import type { Actor } from './write';

/**
 * Everything AI proposed in an engagement and nobody has reviewed yet, across screens: roles, internal
 * requirements, drafted events and evidence, evidence links and findings. Accepting and rejecting go
 * through each item's own domain function, so the rules stay where they are.
 */

export { PROPOSAL_LABELS, PROPOSAL_TYPES, type ProposalType } from '../proposal-types';
import { PROPOSAL_TYPES, RECEIVED_SOURCE, type ProposalType } from '../proposal-types';

const ENTITY: Record<ProposalType, string> = {
	role: 'person',
	risk: 'risk',
	internal: 'requirement',
	recheck: 'requirement',
	event: 'event',
	evidence: 'evidence_item',
	link: 'evidence_link',
	finding: 'finding'
};

export interface ProposalItem {
	type: ProposalType;
	id: string;
	/** The item's entity type, for history and the item sheet. */
	entityType: string;
	title: string;
	detail: string | null;
	/** Where the item is edited, relative to /e/:e. */
	path: string;
	/** What produced it: an in-app action's name, or the MCP agent. */
	source: string;
	version: number;
}

export interface ProposalSummary {
	count: number;
	byType: Record<ProposalType, { count: number; sources: string[] }>;
}

export function isProposalType(value: unknown): value is ProposalType {
	return typeof value === 'string' && (PROPOSAL_TYPES as readonly string[]).includes(value);
}

/** The action or agent behind each item's latest AI write, for many items of one type in one query. */
function sourcesOf(app: AppDatabase, entityType: string, ids: string[]): Map<string, string> {
	const out = new Map<string, string>();
	for (let i = 0; i < ids.length; i += 500) {
		const chunk = ids.slice(i, i + 500);
		const rows = app.sqlite
			.prepare(
				`SELECT entity_id, channel, author_agent, note FROM revision
				  WHERE entity_type = ? AND entity_id IN (${chunk.map(() => '?').join(',')})
				    AND (channel != 'ui' OR note LIKE 'Received document:%')
				  ORDER BY version DESC`
			)
			.all(entityType, ...chunk) as {
			entity_id: string;
			channel: string;
			author_agent: string | null;
			note: string | null;
		}[];
		for (const row of rows) {
			if (out.has(row.entity_id)) continue;
			out.set(
				row.entity_id,
				// Links the app proposes itself when a planned item matches a received document (#83).
				row.channel === 'ui'
					? RECEIVED_SOURCE
					: row.channel === 'ai'
						? (row.note ?? `${row.author_agent ?? 'AI'} in the app`)
						: `${row.author_agent ?? 'AI'} through MCP`
			);
		}
	}
	return out;
}

export function listProposals(app: AppDatabase, engagementId: string, type?: ProposalType): ProposalItem[] {
	const e = getEngagement(app, engagementId);
	const want = (t: ProposalType) => !type || type === t;
	const out: Omit<ProposalItem, 'source' | 'entityType'>[] = [];
	// Internal requirements feed two types (proposed, and needs review): read them once.
	let internalRows: ReturnType<typeof listInternal> | null = null;
	const internal = () => (internalRows ??= listInternal(app, e.id));

	if (want('role'))
		for (const p of listPeople(app, e.auditeeId).filter((p) => p.status === 'proposed'))
			out.push({
				type: 'role',
				id: p.id,
				title: p.name ? `${p.role}: ${p.name}` : p.role,
				detail: p.sourceDocument
					? `From ${p.sourceDocument}${p.sourceSection ? ` § ${p.sourceSection}` : ''}`
					: null,
				path: '/setup/auditee',
				version: p.version
			});
	if (want('risk'))
		for (const r of listRisks(app, e.id).filter((r) => r.proposed))
			out.push({
				type: 'risk',
				id: r.id,
				title: r.title,
				detail: [
					`${r.level.replace(/^./, (c) => c.toUpperCase())} level`,
					r.origin === 'auditee_register'
						? 'from the auditee register'
						: r.origin === 'research'
							? 'found by research, not in the register'
							: 'auditor view',
					r.requirementIds.length
						? `affects ${r.requirementIds.length} ${r.requirementIds.length === 1 ? 'requirement' : 'requirements'}`
						: ''
				]
					.filter(Boolean)
					.join(' · '),
				path: '/setup/risks',
				version: r.version
			});
	if (want('internal'))
		for (const r of internal().filter(
			(r) => r.status === 'proposed' && !r.carriedOver && r.recheck !== 'needs_review'
		))
			out.push({
				type: 'internal',
				id: r.id,
				title: `${r.refCode} ${r.title}`,
				detail: [
					r.previous ? 'Changes an accepted requirement' : '',
					`${r.sourceTitle}${r.section ? ` § ${r.section}` : ''}`,
					r.implements.length ? `implements ${r.implements.map((l) => l.other.refCode).join(', ')}` : ''
				]
					.filter(Boolean)
					.join(' · '),
				path: '/setup/documents',
				version: r.version
			});
	if (want('recheck'))
		for (const r of internal().filter((r) => r.recheck === 'needs_review' && !r.carriedOver))
			out.push({
				type: 'recheck',
				id: r.id,
				title: `${r.refCode} ${r.title}`,
				detail: (r.recheckProposal
					? [
							r.recheckProposal === 'remove'
								? 'Proposed: remove it'
								: `Proposed: update it${r.quote ? ` to “${r.quote.slice(0, 160)}”` : ''}${r.section ? ` § ${r.section}` : ''}`,
							r.recheckReason ?? ''
						]
					: [
							r.quote ? `Quote not found in ${r.sourceTitle}` : `No quote to check against ${r.sourceTitle}`,
							r.recheckPassage ? `closest: “${r.recheckPassage.slice(0, 160)}”` : ''
						]
				)
					.filter(Boolean)
					.join(' · '),
				path: '/setup/documents',
				version: r.version
			});
	const events = want('event') || want('evidence') ? listEvents(app, e.id) : [];
	const eventTitle = new Map(events.map((ev) => [ev.id, ev.title]));
	const draftedEvents = new Set(events.filter((ev) => ev.proposed).map((ev) => ev.id));
	if (want('event'))
		for (const ev of events.filter((x) => x.proposed))
			out.push({
				type: 'event',
				id: ev.id,
				title: ev.title,
				detail: [ev.format.replace('_', ' '), ev.date, `${ev.evidence.total} evidence`]
					.filter(Boolean)
					.join(' · '),
				path: `/plan/events?event=${ev.id}`,
				version: ev.version
			});
	if (want('evidence'))
		// Evidence drafted with a drafted event is reviewed with that event.
		for (const x of listEvidence(app, e.id).filter((x) => x.proposed && !draftedEvents.has(x.eventId)))
			out.push({
				type: 'evidence',
				id: x.id,
				title: x.text,
				detail: `${eventTitle.get(x.eventId) ?? 'Event'} · ${x.criticality}`,
				path: `/plan/events?event=${x.eventId}`,
				version: x.version
			});
	if (want('link')) {
		const evidence = new Map(listEvidence(app, e.id).map((x) => [x.id, x]));
		for (const l of listLinks(app, e.id).filter((l) => l.status === 'proposed')) {
			const eventId = evidence.get(l.evidenceItemId)?.eventId;
			out.push({
				type: 'link',
				id: l.id,
				title: `${l.artifactTitle} → ${l.evidenceText}`,
				detail: [l.sufficiency, l.locator].filter(Boolean).join(' · '),
				path: eventId ? `/run/events/${eventId}` : '/run/events',
				version: l.version
			});
		}
	}
	if (want('finding')) {
		const proposed = listFindings(app, e.id).filter((f) => f.status === 'proposed');
		// Only the unit's reference and title are shown; full finding cards would be far too slow here.
		const units = new Map(proposed.length ? listAssessmentUnits(app, e.id).map((u) => [u.id, u]) : []);
		for (const f of proposed) {
			const u = units.get(f.unitId);
			out.push({
				type: 'finding',
				id: f.id,
				title: `${u ? `${u.refCode} ${u.title}` : 'Unit'}: ${f.value?.label ?? 'no value'}`,
				detail: f.rationale,
				path: '/findings/matrix',
				version: f.version
			});
		}
	}
	const sources = new Map<string, Map<string, string>>();
	for (const t of new Set(out.map((o) => ENTITY[o.type])))
		sources.set(
			t,
			sourcesOf(
				app,
				t,
				out.filter((o) => ENTITY[o.type] === t).map((o) => o.id)
			)
		);
	return out.map((o) => ({
		...o,
		entityType: ENTITY[o.type],
		source: sources.get(ENTITY[o.type])?.get(o.id) ?? 'AI'
	}));
}

export function proposalSummary(app: AppDatabase, engagementId: string): ProposalSummary {
	const byType = Object.fromEntries(
		PROPOSAL_TYPES.map((t) => [t, { count: 0, sources: [] as string[] }])
	) as ProposalSummary['byType'];
	const items = listProposals(app, engagementId);
	for (const p of items) {
		byType[p.type].count++;
		if (!byType[p.type].sources.includes(p.source)) byType[p.type].sources.push(p.source);
	}
	return { count: items.length, byType };
}

/**
 * One SQL check that an item still waits for review in this engagement, matching what
 * `listProposals` shows for that type. Bulk review calls this per id, so it must not build the list.
 */
const WAITING: Record<ProposalType, string> = {
	role: `SELECT 1 FROM person p JOIN engagement e ON e.auditee_id = p.auditee_id
	        WHERE e.id = ? AND p.id = ? AND p.deleted = 0 AND p.status = 'proposed'`,
	risk: `SELECT 1 FROM risk WHERE engagement_id = ? AND id = ? AND deleted = 0 AND proposed = 1`,
	internal: `SELECT 1 FROM requirement r JOIN source s ON s.id = r.source_id
	            WHERE s.engagement_id = ? AND r.id = ? AND r.deleted = 0 AND s.deleted = 0
	              AND r.origin = 'internal' AND r.status = 'proposed' AND coalesce(r.recheck, '') <> 'needs_review'`,
	recheck: `SELECT 1 FROM requirement r JOIN source s ON s.id = r.source_id
	           WHERE s.engagement_id = ? AND r.id = ? AND r.deleted = 0 AND s.deleted = 0
	             AND r.origin = 'internal' AND r.recheck = 'needs_review'`,
	event: `SELECT 1 FROM event WHERE engagement_id = ? AND id = ? AND deleted = 0 AND proposed = 1`,
	// Evidence drafted with a drafted event is reviewed with that event.
	evidence: `SELECT 1 FROM evidence_item x
	            WHERE x.engagement_id = ? AND x.id = ? AND x.deleted = 0 AND x.proposed = 1
	              AND NOT EXISTS (SELECT 1 FROM event ev WHERE ev.id = x.event_id AND ev.deleted = 0 AND ev.proposed = 1)`,
	link: `SELECT 1 FROM evidence_link WHERE engagement_id = ? AND id = ? AND deleted = 0 AND status = 'proposed'`,
	finding: `SELECT 1 FROM finding WHERE engagement_id = ? AND id = ? AND deleted = 0 AND status = 'proposed'`
};

function find(app: AppDatabase, engagementId: string, type: ProposalType, id: string): void {
	getEngagement(app, engagementId);
	if (!app.sqlite.prepare(WAITING[type]).get(engagementId, id))
		throw new NotFoundError('This proposal was already reviewed or is not in this engagement.');
}

export function acceptProposalItem(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	type: ProposalType,
	id: string
): void {
	requireHuman(actor, 'Accepting a proposal');
	find(app, engagementId, type, id);
	switch (type) {
		case 'role':
			acceptPerson(app, actor, id);
			break;
		case 'risk':
			acceptRisk(app, actor, engagementId, id);
			break;
		case 'internal':
			acceptInternal(app, actor, engagementId, id);
			break;
		case 'recheck':
			// With AI's proposal, accept it; without, keep the requirement as it is.
			if (getInternal(app, engagementId, id).recheckProposal)
				acceptRecheckProposal(app, actor, engagementId, id);
			else keepInternal(app, actor, engagementId, id);
			break;
		case 'event':
			acceptEvent(app, actor, engagementId, id);
			break;
		case 'evidence':
			acceptEvidence(app, actor, engagementId, id);
			break;
		case 'link':
			confirmLink(app, actor, engagementId, id);
			break;
		case 'finding':
			acceptProposal(app, actor, engagementId, id);
			break;
	}
}

export function rejectProposalItem(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	type: ProposalType,
	id: string
): void {
	find(app, engagementId, type, id);
	switch (type) {
		case 'role':
			rejectPerson(app, actor, id);
			break;
		case 'risk':
			rejectRisk(app, actor, engagementId, id);
			break;
		case 'internal':
			rejectInternal(app, actor, engagementId, id);
			break;
		case 'recheck':
			// With AI's proposal, reject it (the requirement still needs review); without, remove it.
			if (getInternal(app, engagementId, id).recheckProposal)
				rejectRecheckProposal(app, actor, engagementId, id);
			else removeAfterRecheck(app, actor, engagementId, id);
			break;
		case 'event':
			rejectEvent(app, actor, engagementId, id);
			break;
		case 'evidence':
			removeEvidence(app, actor, engagementId, id);
			break;
		case 'link':
			removeLink(app, actor, engagementId, id);
			break;
		case 'finding':
			rejectProposal(app, actor, engagementId, id);
			break;
	}
}

/** Accept every proposal, or every proposal of one type. Findings become drafts; approval stays separate. */
export function acceptAllProposals(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	type?: ProposalType
): number {
	requireHuman(actor, 'Accepting proposals');
	if (type !== undefined && !isProposalType(type)) throw new ValidationError('Unknown proposal type.');
	return app.sqlite.transaction(() => {
		const items = listProposals(app, engagementId, type);
		for (const p of items) {
			// Accepting an event also accepts its evidence; skip what an earlier accept already took.
			if (p.type === 'evidence' && !listProposals(app, engagementId, 'evidence').some((x) => x.id === p.id))
				continue;
			acceptProposalItem(app, actor, engagementId, p.type, p.id);
		}
		return items.length;
	})();
}

export interface BulkResult {
	done: number;
	/** Items no longer waiting (reviewed meanwhile) or refused by their own rules. */
	skipped: { id: string; reason: string }[];
}

/**
 * Accept or reject several proposals of one type at once: each goes through its own accept or
 * reject function, in its own transaction, so one that cannot be reviewed does not undo the others.
 */
export function reviewProposalItems(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	type: ProposalType,
	ids: string[],
	verdict: 'accept' | 'reject'
): BulkResult {
	requireHuman(actor, 'Reviewing proposals');
	if (!isProposalType(type)) throw new ValidationError('Unknown proposal type.');
	const unique = [...new Set(ids.filter(Boolean))];
	if (unique.length === 0) throw new ValidationError('Select at least one proposal.');
	const result: BulkResult = { done: 0, skipped: [] };
	for (const id of unique) {
		try {
			app.sqlite.transaction(() =>
				verdict === 'accept'
					? acceptProposalItem(app, actor, engagementId, type, id)
					: rejectProposalItem(app, actor, engagementId, type, id)
			)();
			result.done++;
		} catch (e) {
			if (!(e instanceof Error) || !('code' in e)) throw e;
			result.skipped.push({ id, reason: e.message });
		}
	}
	return result;
}

/** "3 accepted." / "3 accepted. 1 skipped: already reviewed." */
export function bulkMessage(
	r: BulkResult,
	verdict: 'accept' | 'reject',
	words: [string, string] = ['accepted', 'rejected']
): string {
	const verb = verdict === 'accept' ? words[0] : words[1];
	const head = `${r.done} ${verb}.`;
	if (!r.skipped.length) return head;
	return `${head} ${r.skipped.length} skipped: ${[...new Set(r.skipped.map((s) => s.reason))].join(' ')}`;
}
