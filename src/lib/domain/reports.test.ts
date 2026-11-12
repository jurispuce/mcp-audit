import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { extractText, uploadArtifacts } from './artifacts';
import { findingScaleOf, updateEngagement, type Engagement } from './engagements';
import { addEvidenceLink, addNote } from './execution';
import { approveFinding, saveDraft, unitCards } from './findings';
import { listEvents, listEvidence, updateEvidence } from './planning';
import {
	buildFindingsReport,
	buildPostEventReport,
	exportFindingsReport,
	exportPostEventReport
} from './reports';
import { seedTestData } from './seed';
import type { Actor } from './write';

let app: AppDatabase;
let human: Actor;
let e: Engagement;
let dir: string;
const value = (code: string) => findingScaleOf(app, e.id).find((v) => v.code === code)!.id;

beforeEach(async () => {
	app = createTestDatabase();
	dir = mkdtempSync(path.join(tmpdir(), 'mcpa-rep-'));
	const seeded = await seedTestData(app, { TEST_SEED_ENABLED: 'true', DATA_DIR: dir });
	human = { userId: seeded.users[0]!.id, channel: 'ui' };
	// The sample reports in Latvian; these tests read the English template first.
	e = updateEngagement(app, human, seeded.engagement.id, seeded.engagement.version, {
		report_language: 'en'
	});
});
afterEach(() => {
	app.close();
	rmSync(dir, { recursive: true, force: true });
});

describe('post-event report (#56)', () => {
	it('lists received, outstanding and agreed follow-ups; no suspected issues, sufficiency or criticality', async () => {
		const ev = listEvents(app, e.id)[0]!;
		const items = listEvidence(app, e.id, { eventId: ev.id });
		const leavers = items.find((x) => x.text.startsWith('Leaver'));
		const reviews = items.find((x) => x.text.startsWith('Access review'));
		const [up] = await uploadArtifacts(
			app,
			human,
			path.join(dir, 'files'),
			e.id,
			[{ name: 'review.csv', type: 'text/csv', bytes: new TextEncoder().encode('a,b') }],
			{ eventId: ev.id }
		);
		addEvidenceLink(app, human, e.id, {
			artifactId: up!.artifact!.id,
			evidenceItemId: leavers!.id,
			sufficiency: 'contradicts'
		});
		updateEvidence(app, human, e.id, reviews!.id, reviews!.version, {
			status: 'promised',
			promised_by: 'Head of IT',
			promised_due: '2026-11-20'
		});
		addNote(app, human, e.id, ev.id, {
			type: 'issue',
			text: 'Three leavers still active SECRET',
			mentions: []
		});
		const r = buildPostEventReport(app, e.id, ev.id);
		const m = r.markdown;
		expect(m).toContain('# Post-event report');
		expect(m).toContain('**Event:** Access and identity interview (Interview)');
		expect(m).toMatch(
			/\| Leaver list for 2026 with account disable dates \| Head of IT \(Ilze Kalniņa\) \| record \|/
		);
		expect(m).toContain('| Access review records for the last two cycles | Head of IT | 2026-11-20 |');
		expect(m).toContain('- Art. 21(2)(i)');
		for (const banned of ['SECRET', 'contradicts', 'Contradicts', 'High', 'high', 'criticality'])
			expect(m).not.toContain(banned);
		updateEngagement(app, human, e.id, e.version, { report_language: 'lv' });
		expect(buildPostEventReport(app, e.id, ev.id).markdown).toContain('# Pārskats pēc tikšanās');
		const pdf = await exportPostEventReport(app, human, path.join(dir, 'files'), e.id, ev.id, 'pdf');
		expect(pdf).toMatchObject({ kind: 'generated_report' });
		expect(pdf.filename).toMatch(/^post-event-report-/);
	});
});

describe('findings report (#59)', () => {
	it('includes only approved findings unless a draft is asked for, which says DRAFT', async () => {
		const cards = unitCards(app, e.id);
		const i = cards.find((c) => c.refCode === 'Art. 21(2)(i)')!;
		const leavers = i.evidence[0]!;
		updateEvidence(
			app,
			human,
			e.id,
			leavers.id,
			listEvidence(app, e.id).find((x) => x.id === leavers.id)!.version,
			{ status: 'received' }
		);
		const nc = saveDraft(app, human, e.id, i.unitId, {
			findingValueId: value('major'),
			rationale: 'Three leaver accounts were still active after 30 days.',
			evidenceItemIds: [leavers.id]
		});
		approveFinding(app, human, e.id, nc.id);
		const a = cards.find((c) => c.refCode === 'Art. 21(2)(a)')!;
		saveDraft(app, human, e.id, a.unitId, {
			findingValueId: value('cp'),
			rationale: 'Risk analysis is reviewed every quarter.'
		});
		const b = cards.find((c) => c.refCode === 'Art. 21(2)(b)')!;
		approveFinding(
			app,
			human,
			e.id,
			saveDraft(app, human, e.id, b.unitId, {
				findingValueId: value('na'),
				rationale: 'No incident log provided.'
			}).id
		);

		const approvedOnly = buildFindingsReport(app, e.id);
		expect(approvedOnly.markdown).toMatch(/^# Audit findings report\n/);
		expect(approvedOnly.markdown).toContain('### Art. 21(2)(i) ');
		expect(approvedOnly.markdown).toContain(': Major non-conformity');
		expect(approvedOnly.markdown).toContain(
			'**Finding:** Three leaver accounts were still active after 30 days.'
		);
		expect(approvedOnly.markdown).not.toContain('Risk analysis is reviewed');
		expect(approvedOnly.markdown).toContain('## Conformities with notes\n\nNone.');
		expect(approvedOnly.markdown).toMatch(/\| Art\. 21\(2\)\(b\) .*\| No reasonable assurance \|/);
		expect(approvedOnly).toMatchObject({ approved: 2, drafts: 1, draft: false });

		const draft = buildFindingsReport(app, e.id, { includeDrafts: true });
		expect(draft.markdown).toMatch(/^# Audit findings report \(DRAFT\)/);
		expect(draft.markdown).toContain('positive note');
		expect(draft.markdown).toContain('Conformity with positive note (draft)');
		const docx = await exportFindingsReport(app, human, path.join(dir, 'files'), e.id, 'docx', {
			includeDrafts: true
		});
		expect(docx.filename).toMatch(/^findings-report-draft-.*\.docx$/);
		const pdf = await exportFindingsReport(app, human, path.join(dir, 'files'), e.id, 'pdf');
		const bytes = readFileSync(path.join(dir, 'files', pdf.fileHash!.slice(0, 2), pdf.fileHash!));
		expect((await extractText(new Uint8Array(bytes), 'r.pdf')).text).toContain('Major non-conformity');
	});
});
