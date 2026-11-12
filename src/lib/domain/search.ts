import type { AppDatabase } from '#lib/db/client.ts';
import { searchText } from '#lib/db/fts.ts';
import { getEngagement } from './engagements';
import { listInternal } from './internal';
import { entityDefinition } from './registry';
import { listAssessmentUnits, listSelected } from './selection';
import { readRow, type Row } from './write';

/**
 * One search field for the whole engagement: requirements by code or text (selected ones and the
 * auditee's internal rules), events, planned evidence, documents and their text, notes and findings.
 * Nothing from another engagement or another auditee is returned.
 */

export interface SearchResult {
	type: string;
	id: string;
	label: string;
	refLine: string;
	snippet: string;
	group: 'Requirements' | 'Events' | 'Planned evidence' | 'Documents' | 'Notes' | 'Findings';
}

const GROUP: Record<string, SearchResult['group']> = {
	requirement: 'Requirements',
	event: 'Events',
	evidence_item: 'Planned evidence',
	artifact: 'Documents',
	note: 'Notes',
	finding: 'Findings'
};

export function searchEngagement(
	app: AppDatabase,
	engagementId: string,
	query: string,
	limit = 40
): SearchResult[] {
	const e = getEngagement(app, engagementId);
	const requirements = new Set([
		...listSelected(app, e.id).map((s) => s.requirementId),
		...listInternal(app, e.id).map((r) => r.id)
	]);
	const units = new Map(listAssessmentUnits(app, e.id).map((u) => [u.id, u]));
	const seen = new Set<string>();
	const out: SearchResult[] = [];
	for (const hit of searchText(app.sqlite, query, { entityTypes: Object.keys(GROUP), limit: 200 })) {
		const key = `${hit.entityType}:${hit.entityId}`;
		if (seen.has(key)) continue;
		const def = entityDefinition(hit.entityType);
		const row = readRow(app, def, hit.entityId) as Row | null;
		if (!row || Number(row.deleted) === 1) continue;
		if (hit.entityType === 'requirement' ? !requirements.has(hit.entityId) : row.engagement_id !== e.id)
			continue;
		seen.add(key);
		let label = def.label(row);
		let refLine = def.refLine?.(row) ?? '';
		if (hit.entityType === 'finding') {
			const u = units.get(String(row.assessment_unit_id));
			label = u ? `${u.refCode} ${u.title}` : label;
			refLine = `Finding · ${row.status}${u && e.scopeMode === 'multiple' ? ` · ${u.scopeName}` : ''}`;
		}
		out.push({
			type: hit.entityType,
			id: hit.entityId,
			label,
			refLine,
			snippet: hit.snippet,
			group: GROUP[hit.entityType]!
		});
		if (out.length >= limit) break;
	}
	return out;
}
