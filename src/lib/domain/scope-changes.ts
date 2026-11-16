import type { AppDatabase } from '#lib/db/client.ts';
import { getEngagement } from './engagements';
import { ValidationError } from './errors';
import { requireHuman } from './guards';
import { riskDefinition, listRisks } from './risks';
import { deselectRequirements, listSelected } from './selection';
import { updateEntity, type Actor } from './write';

/**
 * Changing the audit scope while planning (#82) or after the Statement of Applicability check (#81):
 * the auditor removes selected requirements, with a reason kept in their history. Work already done is
 * never lost silently: a requirement still in an event, in planned evidence or with a finding stays.
 */
export function removeFromScope(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	requirementIds: string[],
	reason: string
): { removed: number } {
	requireHuman(actor, 'Changing the audit scope');
	const why = reason.trim();
	if (!why)
		throw new ValidationError('Say why the requirement leaves the audit scope.', { reason: 'Required' });
	const e = getEngagement(app, engagementId);
	const ids = [...new Set(requirementIds.filter(Boolean))];
	if (!ids.length) throw new ValidationError('Choose at least one requirement.');
	const selected = new Map(listSelected(app, e.id).map((s) => [s.requirementId, s]));
	const blocked: string[] = [];
	for (const rid of ids) {
		const s = selected.get(rid);
		if (!s) continue;
		const inEvents = app.sqlite
			.prepare(
				`SELECT title FROM event WHERE engagement_id = ? AND deleted = 0
				   AND EXISTS (SELECT 1 FROM json_each(event.requirement_ids) WHERE value = ?)`
			)
			.all(e.id, rid) as { title: string }[];
		const inEvidence = app.sqlite
			.prepare(
				`SELECT count(*) AS n FROM evidence_item WHERE engagement_id = ? AND deleted = 0
				   AND EXISTS (SELECT 1 FROM json_each(evidence_item.requirement_ids) WHERE value = ?)`
			)
			.get(e.id, rid) as { n: number };
		const findings = app.sqlite
			.prepare(
				`SELECT count(*) AS n FROM finding f JOIN assessment_unit u ON u.id = f.assessment_unit_id
				  WHERE u.engagement_requirement_id = ? AND u.deleted = 0 AND f.deleted = 0`
			)
			.get(s.id) as { n: number };
		if (inEvents.length)
			blocked.push(
				`${s.refCode} is in ${inEvents.map((x) => `"${x.title}"`).join(', ')}; take it out of the event first.`
			);
		else if (inEvidence.n) blocked.push(`${s.refCode} has planned evidence; remove that first.`);
		else if (findings.n) blocked.push(`${s.refCode} already has a finding; it stays in scope.`);
	}
	if (blocked.length) throw new ValidationError(blocked.join(' '));
	return app.sqlite.transaction(() => {
		// A risk may only point at selected requirements: take the removed ones off it.
		for (const r of listRisks(app, e.id).filter((r) => r.requirementIds.some((id) => ids.includes(id))))
			updateEntity(
				app,
				actor,
				riskDefinition,
				r.id,
				r.version,
				{ requirement_ids: r.requirementIds.filter((id) => !ids.includes(id)) },
				`Requirement removed from scope: ${why}`
			);
		return deselectRequirements(app, actor, e.id, ids, `Removed from scope: ${why}`);
	})();
}
