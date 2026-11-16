import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import './entities';
import { createEngagement, findingScaleOf, type Engagement } from './engagements';
import { addNote } from './execution';
import { proposeFinding, unitCard, unitCards } from './findings';
import { addInternal, listInternal } from './internal';
import { importSourceYaml } from './library-import';
import { addEvent, addEvidence } from './planning';
import { listProposals, proposalSummary, reviewProposalItems } from './proposals';
import { listAssessmentUnits, selectRequirements } from './selection';
import { createFirstAdmin } from './users';
import type { Actor } from './write';

/**
 * Engagement screens load the proposal count on every request, and the server is single-threaded:
 * slow domain reads block every other request (#77). An engagement the size of a real one must stay
 * fast. Limits leave room for a slow CI machine; the measured times are a small fraction of them.
 */

const UNITS = 150;
const INTERNAL = 170;

let app: AppDatabase;
let human: Actor;
let ai: Actor;
let e: Engagement;
let requirementIds: string[];

function timed<T>(f: () => T): { ms: number; result: T } {
	const start = performance.now();
	const result = f();
	return { ms: performance.now() - start, result };
}

beforeAll(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Juris',
		email: 'juris@example.test',
		password: 'correct horse battery'
	});
	human = { userId: a.id, channel: 'ui' };
	ai = { userId: a.id, agent: 'Claude', channel: 'mcp' };
	let yaml = 'id: perf\ntitle: Performance standard\ntype: standard\nlanguage: en\nrequirements:\n';
	for (let i = 1; i <= UNITS; i++)
		yaml += `  - id: 'C.${i}'\n    title: Control ${i}\n    text: The organisation shall do thing ${i}.\n`;
	importSourceYaml(app, human, yaml, { fileName: 'perf.yaml' });
	requirementIds = (
		app.sqlite
			.prepare("SELECT r.id FROM requirement r JOIN source s ON s.id = r.source_id WHERE s.code = 'perf'")
			.all() as { id: string }[]
	).map((r) => r.id);
	e = createEngagement(app, human, { name: 'Big audit', auditeeName: 'Big SIA', startDate: '2026-11-16' });
	selectRequirements(app, human, e.id, requirementIds);
	const req = (i: number) => requirementIds[i % requirementIds.length]!;
	for (let i = 0; i < INTERNAL; i++)
		addInternal(app, i < 20 ? human : ai, e.id, {
			title: `Internal rule ${i}`,
			quote: `Quoted policy text for rule ${i}. `.repeat(5),
			section: `${i}.1`,
			implements: [
				{ requirementId: req(i), coverage: 'partial' },
				{ requirementId: req(i * 7 + 3), coverage: 'full' }
			]
		});
	for (let k = 0; k < 10; k++) {
		const ev = addEvent(app, human, e.id, {
			title: `Interview ${k}`,
			requirement_ids: requirementIds.slice(k * 15, k * 15 + 15)
		});
		for (let j = 0; j < 10; j++)
			addEvidence(app, human, e.id, ev.id, {
				text: `Evidence ${k}.${j}`,
				requirement_ids: [req(k * 15 + j)]
			});
		for (let j = 0; j < 2; j++)
			addNote(app, human, e.id, ev.id, {
				type: 'issue',
				text: `Issue ${k}.${j}`,
				mentions: [{ type: 'requirement', id: req(k * 15 + j), label: `C.${k * 15 + j + 1}` }]
			});
	}
	const na = findingScaleOf(app, e.id).find((v) => v.code === 'na')!.id;
	for (const u of listAssessmentUnits(app, e.id).slice(0, 50))
		proposeFinding(app, ai, e.id, u.id, { findingValueId: na, rationale: 'No evidence yet.' });
}, 120_000);

afterAll(() => app.close());

describe('engagement reads stay fast on a real-size engagement (#77)', () => {
	it('builds the data it measures', () => {
		expect(listAssessmentUnits(app, e.id)).toHaveLength(UNITS);
		expect(listInternal(app, e.id)).toHaveLength(INTERNAL);
		expect(proposalSummary(app, e.id).byType).toMatchObject({
			internal: { count: INTERNAL - 20 },
			finding: { count: 50 }
		});
		expect(unitCards(app, e.id).filter((c) => c.suspectedIssues.length)).toHaveLength(20);
	});

	it('the proposal count (every engagement request) takes under 200 ms', () => {
		const { ms } = timed(() => proposalSummary(app, e.id));
		expect(ms).toBeLessThan(200);
	});

	it('all Findings cards take under 500 ms, one card far less', () => {
		const all = timed(() => unitCards(app, e.id));
		expect(all.ms).toBeLessThan(500);
		const unitId = all.result[UNITS - 1]!.unitId;
		const one = timed(() => unitCard(app, e.id, unitId));
		expect(one.result).toEqual(all.result[UNITS - 1]);
		expect(one.ms).toBeLessThan(200);
	});

	it('accepting 150 selected internal requirements and 50 findings takes under 2 s each', () => {
		const internal = listProposals(app, e.id, 'internal').map((p) => p.id);
		expect(internal).toHaveLength(150);
		const a = timed(() => reviewProposalItems(app, human, e.id, 'internal', internal, 'accept'));
		expect(a.result).toEqual({ done: 150, skipped: [] });
		expect(a.ms).toBeLessThan(2000);

		const findings = listProposals(app, e.id, 'finding').map((p) => p.id);
		expect(findings).toHaveLength(50);
		const f = timed(() => reviewProposalItems(app, human, e.id, 'finding', findings, 'accept'));
		expect(f.result).toEqual({ done: 50, skipped: [] });
		expect(f.ms).toBeLessThan(2000);
		expect(proposalSummary(app, e.id).count).toBe(0);
	});
});
