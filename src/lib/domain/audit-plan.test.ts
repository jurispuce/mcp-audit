import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { extractText, getArtifactText, listArtifacts } from './artifacts';
import { buildAuditPlan, exportAuditPlan } from './audit-plan';
import './entities';
import { createEngagement, updateEngagement, type Engagement } from './engagements';
import { findRequirement, getSourceByCode } from './library';
import { importBuiltInSource } from './library-import';
import { addPerson } from './people';
import { addEvent, addEvidence, removeEvent, updateEvent } from './planning';
import { addRisk } from './risks';
import { addScope, selectRequirements, setScopeMode } from './selection';
import { createFirstAdmin } from './users';
import type { Actor } from './write';
import { fillTemplate, md } from '#lib/reports/template.ts';
import { markdownToHtml } from '#lib/reports/render.ts';

let app: AppDatabase;
let human: Actor;
let e: Engagement;
let files: string;
const req = (p: string) => findRequirement(app, getSourceByCode(app, 'nis2')!.id, `Art. 21(2)(${p})`)!.id;

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Juris Pūce',
		email: 'juris@example.test',
		password: 'correct horse battery'
	});
	human = { userId: a.id, channel: 'ui' };
	importBuiltInSource(
		app,
		human,
		'nis2-art21.yaml',
		path.resolve(import.meta.dirname, '../../../seed/library')
	);
	e = createEngagement(app, human, {
		name: 'NIS 2 audit, Riga office',
		auditeeName: 'Baltic Freight SIA',
		startDate: '2026-11-16',
		endDate: '2026-11-20'
	});
	selectRequirements(app, human, e.id, [req('b'), req('i'), req('j')]);
	files = mkdtempSync(path.join(tmpdir(), 'mcpa-plan-'));
});
afterEach(() => {
	app.close();
	rmSync(files, { recursive: true, force: true });
});

function samplePlan() {
	const head = addPerson(app, human, e.auditeeId, { role: 'Head of IT', name: 'Ilze Kalniņa' });
	addRisk(app, human, e.id, {
		title: 'Leaver accounts stay active',
		level: 'high',
		requirement_ids: [req('i')]
	});
	const ev = addEvent(app, human, e.id, {
		title: 'Access and identity interview',
		date: '2026-11-17',
		start_time: '10:00',
		duration_min: 60,
		participant_ids: [head.id],
		requirement_ids: [req('i'), req('j')]
	});
	addEvidence(app, human, e.id, ev.id, {
		text: 'Leaver list for 2026 | with dates',
		requirement_ids: [req('i')]
	});
	addEvent(app, { ...human, channel: 'mcp', agent: 'Claude' }, e.id, {
		title: 'Drafted, not accepted',
		requirement_ids: [req('b')]
	});
	return ev;
}

describe('template filling', () => {
	it('fills values, repeats table rows and blocks, swaps translated lines and escapes content', () => {
		const out = fillTemplate(
			'# Title\n\n**Name:** {{name}}\n\n## Rows\n\n| A | B |\n| --- | --- |\n| {{a}} | {{b}} |\n\n## Blocks\n\n### {{t}}\n\n- {{item}}\n\n## Text\n\n{{explain}}\n',
			{
				values: { name: 'Acme <script> | *x*' },
				rows: {
					Rows: [
						{ a: '1', b: 'x|y' },
						{ a: '2', b: 'z' }
					]
				},
				sections: { Blocks: [{ values: { t: 'One' }, items: ['first', 'second'] }] },
				blocks: { Text: 'Free text.' },
				translations: { '# Title': '# Virsraksts' }
			}
		);
		expect(out).toContain('# Virsraksts');
		expect(out).toContain('**Name:** Acme \\<script\\> \\| \\*x\\*');
		expect(out).toContain('| 1 | x\\|y |\n| 2 | z |');
		expect(out).toContain('### One\n\n- first\n- second');
		expect(out).toContain('Free text.');
		expect(markdownToHtml(out)).not.toContain('<script>');
		expect(md('a\nb')).toBe('a b');
	});
});

describe('audit plan export (#50)', () => {
	it('holds events, formats, times, participants, requirements and what to prepare; never criticality, risks or drafts', () => {
		samplePlan();
		const plan = buildAuditPlan(app, e.id, new Date('2026-11-12T10:00:00Z'));
		const m = plan.markdown;
		expect(m).toContain('# Audit plan');
		expect(m).toContain('**Auditee:** Baltic Freight SIA');
		expect(m).toContain('**Audit period:** 2026-11-16 to 2026-11-20');
		expect(m).toContain('**Plan version:** 2026-11-12 (draft)');
		expect(m).toContain('NIS 2 Directive (EU) 2022/2555: Art. 21(2)(b), Art. 21(2)(i), Art. 21(2)(j)');
		expect(m).toContain(
			'| 2026-11-17 | 10:00 | Access and identity interview | Interview | 60 min | Head of IT (Ilze Kalniņa) | Art. 21(2)(i), Art. 21(2)(j) |'
		);
		expect(m).toContain('### Access and identity interview (2026-11-17)');
		expect(m).toContain('- Leaver list for 2026 \\| with dates');
		expect(m).toContain('First version.');
		for (const banned of [
			'High',
			'high',
			'Leaver accounts stay active',
			'criticality',
			'Drafted, not accepted'
		])
			expect(m).not.toContain(banned);
		expect(m).not.toMatch(/\{\{/);
		expect(plan).toMatchObject({ uncovered: ['Art. 21(2)(b)'], drafts: 1, translated: true });
	});

	it('renders in the report language', () => {
		samplePlan();
		updateEngagement(app, human, e.id, e.version, { report_language: 'lv' });
		const m = buildAuditPlan(app, e.id).markdown;
		expect(m).toContain('# Audita plāns');
		expect(m).toContain(
			'| Datums | Laiks | Pasākums | Formāts | Ilgums | Dalībnieki (lomas) | Aptvertās prasības |'
		);
		expect(m).toContain('| Intervija |');
		expect(m).toContain('## Kas jāsagatavo');
		expect(m).toContain('Pirmā versija.');
		updateEngagement(app, human, e.id, e.version + 1, { report_language: 'de' });
		expect(buildAuditPlan(app, e.id).translated).toBe(false);
	});

	it('lists scopes for a multi-scope audit', () => {
		const now = setScopeMode(app, human, e.id, e.version, 'multiple');
		addScope(app, human, e.id, { name: 'Warehouse', description: 'Second site' });
		void now;
		const m = buildAuditPlan(app, e.id).markdown;
		expect(m).toContain('- Baltic Freight SIA\n- Warehouse: Second site');
	});

	it('exports DOCX and PDF as generated-report artifacts with readable text, and lists changes since the last export', async () => {
		const ev = samplePlan();
		const docx = await exportAuditPlan(app, human, files, e.id, 'docx', new Date('2026-11-12T10:00:00Z'));
		expect(docx).toMatchObject({
			kind: 'generated_report',
			origin: 'generated',
			filename: 'audit-plan-2026-11-12.docx'
		});
		const zip = await JSZip.loadAsync(readStored(docx.fileHash!));
		const xml = await zip.file('word/document.xml')!.async('string');
		expect(xml).toContain('Access and identity interview');
		expect(xml).toContain('Ilze Kalniņa');

		updateEngagement(app, human, e.id, e.version, { report_language: 'lv' });
		await new Promise((r) => setTimeout(r, 5));
		updateEvent(app, human, e.id, ev.id, ev.version, { start_time: '11:00' });
		const other = addEvent(app, human, e.id, {
			title: 'Incident walkthrough',
			format: 'walkthrough',
			requirement_ids: [req('b')]
		});
		removeEvent(app, human, e.id, other.id);
		const pdf = await exportAuditPlan(app, human, files, e.id, 'pdf', new Date('2026-11-13T10:00:00Z'));
		const bytes = readStored(pdf.fileHash!);
		expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
		const text = await extractText(new Uint8Array(bytes), 'plan.pdf');
		expect(text.status).toBe('extracted');
		expect(text.text).toContain('Audita plāns');
		expect(text.text).toContain('Kalniņa');
		const stored = getArtifactText(app, pdf.id).text;
		expect(stored).toContain('Salīdzinājumā ar 2026-11-12 versiju:');
		expect(stored).toContain('- Mainīts: Access and identity interview');
		expect(stored).not.toContain('Incident walkthrough');
		expect(listArtifacts(app, e.id).map((a) => a.filename)).toEqual([
			'audit-plan-2026-11-12.docx',
			'audit-plan-2026-11-13.pdf'
		]);
	});
});

import { readFileSync } from 'node:fs';
function readStored(hash: string): Buffer {
	return readFileSync(path.join(files, hash.slice(0, 2), hash));
}
