import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from './client';
import { indexText, removeFromIndex, searchText, toFtsQuery } from './fts';
import { migrationStatus } from './migrate';
import { createTestDatabase } from './test-db';

const opened: AppDatabase[] = [];
const dirs: string[] = [];
afterEach(() => {
	opened.splice(0).forEach((d) => d.close());
	dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

function fileDb(): AppDatabase {
	const dir = mkdtempSync(path.join(tmpdir(), 'mcpa-db-'));
	dirs.push(dir);
	const d = openDatabase({ path: path.join(dir, 'app.db') });
	opened.push(d);
	return d;
}

describe('openDatabase', () => {
	it('opens a file database in WAL mode with foreign keys on', () => {
		const d = fileDb();
		expect(d.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
		expect(d.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
	});

	it('runs migrations at open and reports nothing pending', () => {
		const d = fileDb();
		const status = migrationStatus(d.sqlite);
		expect(status.available).toBeGreaterThan(0);
		expect(status.pending).toBe(0);
		expect(status.applied).toBe(status.available);
	});

	it('is safe to open twice: migrations are not reapplied', () => {
		const first = fileDb();
		const again = openDatabase({ path: first.path });
		opened.push(again);
		expect(migrationStatus(again.sqlite).pending).toBe(0);
	});

	it('creates an in-memory test database with the schema applied', () => {
		const d = createTestDatabase();
		opened.push(d);
		const tables = d.sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name")
			.all() as { name: string }[];
		expect(tables.map((t) => t.name)).toContain('app_setting');
		expect(tables.map((t) => t.name)).toContain('search_index');
	});
});

describe('full-text search', () => {
	it('finds text by word prefix and returns the entity', () => {
		const d = createTestDatabase();
		opened.push(d);
		indexText(
			d.sqlite,
			'requirement',
			'r1',
			'text',
			'Policies on risk analysis and information system security'
		);
		indexText(d.sqlite, 'requirement', 'r2', 'text', 'Incident handling');
		const hits = searchText(d.sqlite, 'secur');
		expect(hits.map((h) => h.entityId)).toEqual(['r1']);
		expect(hits[0]?.snippet).toContain('[security]');
	});

	it('folds Latvian diacritics in both directions', () => {
		const d = createTestDatabase();
		opened.push(d);
		indexText(d.sqlite, 'requirement', 'lv', 'text', 'Piekļuves kontroles politika');
		expect(searchText(d.sqlite, 'piekluves').map((h) => h.entityId)).toEqual(['lv']);
		expect(searchText(d.sqlite, 'piekļuves').map((h) => h.entityId)).toEqual(['lv']);
	});

	it('handles reference codes with punctuation without query errors', () => {
		const d = createTestDatabase();
		opened.push(d);
		indexText(d.sqlite, 'requirement', 'a515', 'ref_code', 'A.5.15');
		indexText(d.sqlite, 'requirement', 'nis', 'ref_code', 'Art. 21(2)(a)');
		expect(searchText(d.sqlite, 'A.5.15').map((h) => h.entityId)).toEqual(['a515']);
		expect(() => searchText(d.sqlite, '21(2) "AND OR')).not.toThrow();
	});

	it('replaces an entity field on reindex and removes it on demand', () => {
		const d = createTestDatabase();
		opened.push(d);
		indexText(d.sqlite, 'artifact', 'x', 'extracted_text', 'old words');
		indexText(d.sqlite, 'artifact', 'x', 'extracted_text', 'new words');
		expect(searchText(d.sqlite, 'old')).toHaveLength(0);
		expect(searchText(d.sqlite, 'new')).toHaveLength(1);
		removeFromIndex(d.sqlite, 'artifact', 'x');
		expect(searchText(d.sqlite, 'new')).toHaveLength(0);
	});

	it('filters by entity type', () => {
		const d = createTestDatabase();
		opened.push(d);
		indexText(d.sqlite, 'event', 'e', 'title', 'Access review interview');
		indexText(d.sqlite, 'requirement', 'r', 'title', 'Access control');
		expect(searchText(d.sqlite, 'access', { entityTypes: ['event'] }).map((h) => h.entityId)).toEqual(['e']);
	});

	it('returns no query for blank input', () => {
		expect(toFtsQuery('   ')).toBeNull();
		expect(toFtsQuery('a "b"')).toBe('"a"* "b"*');
	});
});
