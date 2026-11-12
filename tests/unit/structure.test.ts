import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Rule 1 of CLAUDE.md, enforced by structure: every create, update, delete and revert of audit data
 * goes through the domain write function. Routes, MCP tools, jobs and components never touch tables.
 */

const ROOT = path.resolve(import.meta.dirname, '../..');

function files(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = path.join(dir, name);
		if (statSync(full).isDirectory()) out.push(...files(full));
		else if (/\.(ts|js|mjs|svelte)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
	}
	return out;
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');
const SOURCES = [...files(path.join(ROOT, 'src')), ...files(path.join(ROOT, 'scripts'))].map((f) => ({
	file: rel(f),
	text: readFileSync(f, 'utf8')
}));

/** Only these may open the database or import the low-level database modules. */
const DB_LAYER = /^src\/lib\/(db|domain)\//;
const DB_OPENERS = new Set(['src/lib/server/db.ts']);

/**
 * Domain files allowed to issue SQL writes, and the tables each may write.
 * `*` means any entity table: that is the write function itself.
 */
const WRITERS: Record<string, string[]> = {
	'src/lib/domain/write.ts': ['*', 'revision'],
	'src/lib/domain/test-entities.ts': []
};

const SQL_WRITE =
	/\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+["`]?([a-z_]+|\$\{[^}]+\})["`]?/g;
const DRIZZLE_WRITE = /\.(insert|update|delete)\(\s*[a-zA-Z_]+\s*\)/g;
const RAW_ACCESS = /\.(prepare|exec)\(/;
const LOW_LEVEL_IMPORT = /from\s+['"](drizzle-orm[^'"]*|better-sqlite3|#lib\/db\/[^'"]+)['"]/;

describe('no direct table writes outside the domain layer', () => {
	it('finds source files to check', () => {
		expect(SOURCES.length).toBeGreaterThan(5);
	});

	it('routes, components, MCP and scripts do not import database modules or run SQL', () => {
		const offenders = SOURCES.filter((s) => !DB_LAYER.test(s.file) && !DB_OPENERS.has(s.file))
			.filter((s) => {
				const importsLowLevel = s.text
					.split('\n')
					.some((line) => LOW_LEVEL_IMPORT.test(line) && !/^\s*import\s+type\b/.test(line));
				return importsLowLevel || RAW_ACCESS.test(s.text) || DRIZZLE_WRITE.test(s.text);
			})
			.map((s) => s.file);
		expect(offenders).toEqual([]);
	});

	it('inside the domain layer, only allowed files write, and only their own tables', () => {
		const problems: string[] = [];
		for (const s of SOURCES.filter((x) => x.file.startsWith('src/lib/domain/'))) {
			const allowed = WRITERS[s.file];
			const sqlTargets = [...s.text.matchAll(SQL_WRITE)]
				.filter(
					(m) => !/^\s*(\*|\/\/|\/\*)/.test(s.text.slice(s.text.lastIndexOf('\n', m.index) + 1, m.index))
				)
				.map((m) => m[1]!);
			const drizzleWrites = [...s.text.matchAll(DRIZZLE_WRITE)].map((m) => m[0]);
			if (!allowed) {
				if (sqlTargets.length || drizzleWrites.length) {
					problems.push(`${s.file} writes ${[...sqlTargets, ...drizzleWrites].join(', ')}`);
				}
				continue;
			}
			for (const t of sqlTargets) {
				const isDynamic = t.startsWith('${');
				if (isDynamic ? !allowed.includes('*') : !allowed.includes(t)) {
					problems.push(`${s.file} writes table ${t}`);
				}
			}
			if (drizzleWrites.length) problems.push(`${s.file} uses Drizzle writes ${drizzleWrites.join(', ')}`);
		}
		expect(problems).toEqual([]);
	});

	it('the check catches a direct write when one is added', () => {
		const route = `import { appDatabase } from '#lib/server/db.ts';\nappDatabase().sqlite.prepare('UPDATE x SET y=1').run();`;
		expect(RAW_ACCESS.test(route)).toBe(true);
		const domain = "app.sqlite.prepare('DELETE FROM finding WHERE id = ?')";
		expect([...domain.matchAll(SQL_WRITE)].map((m) => m[1])).toEqual(['finding']);
	});
});
