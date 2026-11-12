import type { AppDatabase } from '#lib/db/client.ts';
import { fillTemplate, readTemplate } from '#lib/reports/template.ts';
import { planWords } from '#lib/reports/i18n.ts';
import { markdownToDocx, markdownToPdf } from '#lib/reports/render.ts';
import { listArtifacts, registerGeneratedArtifact, type Artifact } from './artifacts';
import { getEngagement, listMembers, listScopes } from './engagements';
import { listEvents, listEvidence } from './planning';
import { listSelected } from './selection';
import { listUsers } from './users';
import type { Actor } from './write';

/**
 * The audit plan for the auditee, filled from skills/audit-plan-builder/assets/audit-plan-template.md
 * in the engagement's report language. It holds events, formats, times, participants, requirements
 * and what to prepare. It never holds criticality, risks or the auditor's reasoning, and AI drafts
 * that nobody accepted yet are left out.
 */

export const PLAN_TEMPLATE = { skill: 'audit-plan-builder', file: 'audit-plan-template.md' } as const;

export interface AuditPlanDocument {
	markdown: string;
	language: string;
	/** False when the report language has no translation of the template, so English was used. */
	translated: boolean;
	/** Selected requirements in no accepted event, for the screen (never in the document). */
	uncovered: string[];
	drafts: number;
	previous: { at: Date; title: string } | null;
}

function previousExport(app: AppDatabase, engagementId: string): Artifact | null {
	const list = listArtifacts(app, engagementId).filter(
		(a) => a.kind === 'generated_report' && (a.filename ?? '').startsWith('audit-plan')
	);
	return list.at(-1) ?? null;
}

function changesSince(app: AppDatabase, engagementId: string, since: Date) {
	const rows = app.sqlite
		.prepare(
			`SELECT e.id, e.title, e.deleted, e.proposed, min(r.version) AS first_version
			   FROM revision r JOIN event e ON e.id = r.entity_id
			  WHERE r.entity_type = 'event' AND e.engagement_id = ? AND r.created_at > ?
			  GROUP BY e.id ORDER BY e.title`
		)
		.all(engagementId, since.getTime()) as {
		id: string;
		title: string;
		deleted: number;
		proposed: number;
		first_version: number;
	}[];
	return {
		added: rows.filter((r) => r.first_version === 1 && !r.deleted && !r.proposed).map((r) => r.title),
		removed: rows.filter((r) => r.deleted && r.first_version > 1).map((r) => r.title),
		changed: rows.filter((r) => r.first_version > 1 && !r.deleted && !r.proposed).map((r) => r.title)
	};
}

export function buildAuditPlan(
	app: AppDatabase,
	engagementId: string,
	today = new Date()
): AuditPlanDocument {
	const e = getEngagement(app, engagementId);
	const { words, lines, translated } = planWords(e.reportLanguage);
	const allEvents = listEvents(app, e.id);
	const events = allEvents.filter((x) => !x.proposed);
	const evidence = listEvidence(app, e.id).filter((x) => !x.proposed);
	const selected = listSelected(app, e.id);
	const scopes = listScopes(app, e.id);
	const members = listMembers(app, e.id);
	const lead = members.find((m) => m.role === 'lead_auditor');
	const leadEmail = lead ? listUsers(app).find((u) => u.id === lead.userId)?.email : undefined;

	// Sources and their selected references, in selection order.
	const bySource = new Map<string, string[]>();
	for (const s of selected) bySource.set(s.sourceTitle, [...(bySource.get(s.sourceTitle) ?? []), s.refCode]);
	const sources = [...bySource.keys()].join('; ');
	const criteria = [...bySource].map(([title, refs]) => `${title}: ${refs.join(', ')}`).join('; ');

	const previous = previousExport(app, e.id);
	let changes = escapeLine(words.firstVersion);
	if (previous) {
		const c = changesSince(app, e.id, previous.createdAt);
		const parts = [
			...c.added.map((t) => `- ${words.added}: ${escapeLine(t)}`),
			...c.changed.map((t) => `- ${words.changed}: ${escapeLine(t)}`),
			...c.removed.map((t) => `- ${words.removed}: ${escapeLine(t)}`)
		];
		changes = parts.length
			? `${escapeLine(words.since(previous.createdAt.toISOString().slice(0, 10)))}\n\n${parts.join('\n')}`
			: escapeLine(words.nothing);
	}

	const markdown = fillTemplate(readTemplate(PLAN_TEMPLATE.skill, PLAN_TEMPLATE.file), {
		translations: lines,
		values: {
			'engagement name': e.name,
			auditee: e.auditeeName,
			'start date': e.startDate,
			'end date': e.endDate ?? words.noEndDate,
			auditors: members.map((m) => m.name).join(', '),
			date: today.toISOString().slice(0, 10),
			'draft | sent for agreement | agreed': words.status[e.planStatus],
			'sources and the selected requirements, by reference': criteria,
			'yes / no / to be agreed': words.toBeAgreed,
			contact: lead ? `${lead.name}${leadEmail ? ` <${leadEmail}>` : ''}` : words.toBeAgreed,
			'lead auditor': lead?.name ?? words.toBeAgreed
		},
		blocks: {
			'Purpose and basis': escapeLine(words.purpose(e.auditeeName, sources || '—')),
			Scope:
				e.scopeMode === 'single' || scopes.length < 2
					? escapeLine(words.singleScope(e.auditeeName))
					: scopes
							.map((s) => `- ${escapeLine(s.name)}${s.description ? `: ${escapeLine(s.description)}` : ''}`)
							.join('\n'),
			'Changes since the previous version': changes
		},
		rows: {
			Schedule: events.map((x) => ({
				date: x.date ?? words.noDate,
				time: x.startTime ?? '',
				title: x.title,
				format: words.formats[x.format] ?? x.formatLabel,
				minutes: String(x.durationMin),
				roles: x.participantsLine,
				'reference codes': x.requirements.map((r) => r.refCode).join(', ')
			}))
		},
		sections: {
			'What to prepare': events
				.map((x) => ({ x, items: evidence.filter((v) => v.eventId === x.id).map((v) => v.text) }))
				.filter((s) => s.items.length)
				.map(({ x, items }) => ({ values: { 'event title': x.title, date: x.date ?? words.noDate }, items }))
		}
	});

	const covered = new Set(events.flatMap((x) => x.requirementIds));
	return {
		markdown,
		language: e.reportLanguage,
		translated,
		uncovered: selected.filter((s) => !covered.has(s.requirementId)).map((s) => s.refCode),
		drafts: allEvents.length - events.length,
		previous: previous ? { at: previous.createdAt, title: previous.displayName } : null
	};
}

/** Escape a sentence for Markdown without touching its words. */
function escapeLine(s: string): string {
	return s.replace(/[\\`*_[\]<>|#]/g, (c) => `\\${c}`);
}

export type PlanFormat = 'docx' | 'pdf';
const MIME: Record<PlanFormat, string> = {
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	pdf: 'application/pdf'
};

/** Render the plan to DOCX or PDF and keep it as an artifact of kind generated report. */
export async function exportAuditPlan(
	app: AppDatabase,
	actor: Actor,
	filesDir: string,
	engagementId: string,
	format: PlanFormat,
	today = new Date()
): Promise<Artifact> {
	const e = getEngagement(app, engagementId);
	const plan = buildAuditPlan(app, engagementId, today);
	const title = `${plan.markdown.split('\n')[0]!.replace(/^#\s*/, '')}: ${e.name}`;
	const bytes =
		format === 'docx'
			? await markdownToDocx(plan.markdown, { title, language: e.reportLanguage })
			: await markdownToPdf(plan.markdown, { title, language: e.reportLanguage });
	const date = today.toISOString().slice(0, 10);
	return registerGeneratedArtifact(app, actor, filesDir, e.id, {
		title: `${title} (${date})`,
		filename: `audit-plan-${date}.${format}`,
		mimeType: MIME[format],
		bytes: new Uint8Array(bytes),
		text: plan.markdown,
		language: e.reportLanguage
	});
}
