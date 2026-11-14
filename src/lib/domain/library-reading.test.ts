import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import './entities';
import { createEngagement } from './engagements';
import { addInternal } from './internal';
import { findRequirement, getSourceByCode, requirementForReading, setGuidance } from './library';
import { importBuiltInSource } from './library-import';
import { createFirstAdmin } from './users';
import type { Actor } from './write';

let app: AppDatabase;
let human: Actor;

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Juris',
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
});
afterEach(() => app.close());

describe('reading a requirement side by side (mapping)', () => {
	it('gives the full text, where it sits in its source, and its audit guidance', () => {
		const src = getSourceByCode(app, 'nis2')!;
		const r = findRequirement(app, src.id, 'Art. 21(2)(b)')!;
		setGuidance(app, human, r.id, 'Ask for the incident log.');
		const read = requirementForReading(app, r.id);
		expect(read).toMatchObject({
			refCode: 'Art. 21(2)(b)',
			sourceTitle: src.title,
			guidance: 'Ask for the incident log.'
		});
		expect(read.text).toBeTruthy();
		expect(read.path.length).toBeGreaterThan(0);
		expect(read.path.map((p) => p.refCode)).not.toContain('Art. 21(2)(b)');
	});

	it("does not read an auditee's internal requirements from the library", () => {
		const e = createEngagement(app, human, {
			auditeeName: 'Baltic Freight SIA',
			name: 'Audit',
			startDate: '2026-11-01'
		});
		const internal = addInternal(app, human, e.id, { title: 'Backups are tested quarterly' });
		expect(() => requirementForReading(app, internal.id)).toThrow(/another auditee/);
		expect(() => requirementForReading(app, 'nope')).toThrow(/not found/i);
	});
});
