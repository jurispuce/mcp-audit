import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Where the generated SQL migrations live. Override with MIGRATIONS_DIR (the Docker image sets it). */
export function migrationsFolder(dir?: string): string {
	const folder = path.resolve(dir ?? process.env.MIGRATIONS_DIR ?? 'drizzle');
	if (!existsSync(path.join(folder, 'meta', '_journal.json'))) {
		throw new Error(`Migrations not found in ${folder}. Set MIGRATIONS_DIR.`);
	}
	return folder;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function runMigrations(db: BetterSQLite3Database<any>, dir?: string): void {
	migrate(db, { migrationsFolder: migrationsFolder(dir) });
}

export interface MigrationStatus {
	applied: number;
	available: number;
	pending: number;
	latest: string | null;
}

/** Compare applied migrations with the ones shipped in the migrations folder. */
export function migrationStatus(
	sqlite: { prepare(sql: string): { get(): unknown } },
	dir?: string
): MigrationStatus {
	const journal = JSON.parse(
		readFileSync(path.join(migrationsFolder(dir), 'meta', '_journal.json'), 'utf8')
	) as {
		entries: { tag: string }[];
	};
	let applied: number;
	try {
		const row = sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number };
		applied = row.n;
	} catch {
		applied = 0; // migrations table does not exist yet
	}
	const available = journal.entries.length;
	return {
		applied,
		available,
		pending: Math.max(available - applied, 0),
		latest: journal.entries.at(-1)?.tag ?? null
	};
}
