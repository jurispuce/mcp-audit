import type { AppDatabase } from '#lib/db/client.ts';
import { getEngagement, listScopes, type Engagement } from './engagements';

/**
 * The eight-phase checklist on Home (docs/workflow-and-screens.md). Phases are guidance, not gates:
 * each gets a state and one fact, computed from counts. Phases 6 to 8 grow real facts as planning,
 * running and findings arrive in later milestones.
 */

export type PhaseState = 'done' | 'current' | 'todo';

export interface Phase {
	number: number;
	title: string;
	/** The verb phrase for the Continue button. */
	next: string;
	fact: string;
	done: boolean;
	state: PhaseState;
	/** Path below /e/:e. */
	href: string;
}

export interface Overview {
	engagement: Engagement;
	counts: {
		selected: number;
		units: number;
		scopes: number;
		people: number;
		proposedPeople: number;
		risks: number;
		documents: number;
		internalConfirmed: number;
		internalProposed: number;
	};
	phases: Phase[];
	/** The first phase not done, or null when all are. */
	current: Phase | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function tableExists(app: AppDatabase, name: string): boolean {
	return !!app.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

export function engagementOverview(app: AppDatabase, engagementId: string): Overview {
	const e = getEngagement(app, engagementId);
	const n = (sql: string, ...args: unknown[]) => (app.sqlite.prepare(sql).get(...args) as { n: number }).n;
	const scopes = listScopes(app, e.id).length;
	const counts = {
		selected: n(
			'SELECT count(*) AS n FROM engagement_requirement WHERE engagement_id = ? AND deleted = 0',
			e.id
		),
		units: n(
			`SELECT count(*) AS n FROM assessment_unit u JOIN engagement_requirement er ON er.id = u.engagement_requirement_id
			  WHERE er.engagement_id = ? AND u.deleted = 0 AND er.deleted = 0`,
			e.id
		),
		scopes,
		people: n(
			`SELECT count(*) AS n FROM person WHERE auditee_id = ? AND deleted = 0 AND status = 'confirmed'`,
			e.auditeeId
		),
		proposedPeople: n(
			`SELECT count(*) AS n FROM person WHERE auditee_id = ? AND deleted = 0 AND status = 'proposed'`,
			e.auditeeId
		),
		risks: n('SELECT count(*) AS n FROM risk WHERE engagement_id = ? AND deleted = 0', e.id),
		documents: n('SELECT count(*) AS n FROM artifact WHERE engagement_id = ? AND deleted = 0', e.id),
		internalConfirmed: 0,
		internalProposed: 0
	};
	const internal = app.sqlite
		.prepare(
			`SELECT r.status, count(*) AS n FROM requirement r JOIN source s ON s.id = r.source_id
			  WHERE r.deleted = 0 AND s.deleted = 0 AND r.origin = 'internal' AND s.auditee_id = ?
			    AND (s.engagement_id = ? OR ?) GROUP BY r.status`
		)
		.all(e.auditeeId, e.id, e.carryOverInternal ? 1 : 0) as { status: string; n: number }[];
	for (const row of internal) {
		if (row.status === 'confirmed') counts.internalConfirmed = row.n;
		else counts.internalProposed = row.n;
	}

	const events = tableExists(app, 'event')
		? n('SELECT count(*) AS n FROM event WHERE engagement_id = ? AND deleted = 0', e.id)
		: 0;

	const raw: Omit<Phase, 'state'>[] = [
		{
			number: 1,
			title: 'Define the engagement',
			next: 'define the engagement',
			fact: `${e.auditeeName} · from ${e.startDate}`,
			done: true,
			href: ''
		},
		{
			number: 2,
			title: 'Select requirements',
			next: 'select requirements',
			fact: counts.selected ? plural(counts.selected, 'requirement') + ' selected' : 'None selected',
			done: counts.selected > 0,
			href: '/setup/requirements'
		},
		{
			number: 3,
			title: 'Understand the auditee',
			next: 'understand the auditee',
			fact: `${plural(counts.people, 'role')}, ${plural(counts.risks, 'risk')}${counts.proposedPeople ? ` · ${counts.proposedPeople} proposed` : ''}`,
			done: counts.people > 0 && counts.risks > 0,
			href: counts.people > 0 && counts.risks === 0 ? '/setup/risks' : '/setup/auditee'
		},
		{
			number: 4,
			title: 'Set scope handling',
			next: 'set scope handling',
			fact:
				e.scopeMode === 'single'
					? `Single scope · ${plural(counts.units, 'assessment unit')}`
					: `${plural(scopes, 'scope')} · ${plural(counts.units, 'assessment unit')}`,
			done: e.scopeMode === 'single' || scopes >= 2,
			href: '/setup/scopes'
		},
		{
			number: 5,
			title: 'Extract internal requirements',
			next: 'extract internal requirements',
			fact: `${plural(counts.documents, 'document')} · ${counts.internalConfirmed} confirmed${counts.internalProposed ? `, ${counts.internalProposed} proposed` : ''}`,
			done: counts.internalConfirmed > 0,
			href: '/setup/documents'
		},
		{
			number: 6,
			title: 'Plan events',
			next: 'plan events',
			fact: `${plural(events, 'event')} · plan ${e.planStatus === 'sent' ? 'sent to auditee' : e.planStatus}`,
			done: e.planStatus === 'agreed' && events > 0,
			href: '/plan/events'
		},
		{
			number: 7,
			title: 'Run events',
			next: 'run events',
			fact: events ? `${plural(events, 'event')} to run` : 'Nothing planned yet',
			done: false,
			href: '/run/today'
		},
		{
			number: 8,
			title: 'Conclude',
			next: 'conclude',
			fact: `0 of ${plural(counts.units, 'assessment unit')} concluded`,
			done: false,
			href: '/findings/to-approve'
		}
	];
	const firstOpen = raw.find((p) => !p.done) ?? null;
	const phases: Phase[] = raw.map((p) => ({
		...p,
		state: p.done ? 'done' : p === firstOpen ? 'current' : 'todo'
	}));
	return {
		engagement: e,
		counts,
		phases,
		current: phases.find((p) => p.state === 'current') ?? null
	};
}
