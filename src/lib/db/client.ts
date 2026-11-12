import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import * as schema from './schema';
import { runMigrations } from './migrate';

export type Schema = typeof schema;
export type Drizzle = BetterSQLite3Database<Schema>;

export interface AppDatabase {
	/** Raw better-sqlite3 handle, for pragmas, FTS5 and backups. */
	sqlite: Database.Database;
	/** Typed Drizzle handle. */
	db: Drizzle;
	path: string;
	close(): void;
}

export interface OpenOptions {
	/** File path, or ":memory:" for a throwaway database. */
	path: string;
	/** Run pending migrations after opening. Default true. */
	migrate?: boolean;
	migrationsDir?: string;
}

/**
 * Open the SQLite database with the settings every connection must have:
 * WAL journal (file databases), foreign keys on, a busy timeout for concurrent writers.
 */
export function openDatabase(options: OpenOptions): AppDatabase {
	const isMemory = options.path === ':memory:';
	if (!isMemory) mkdirSync(path.dirname(path.resolve(options.path)), { recursive: true });

	const sqlite = new Database(options.path);
	if (!isMemory) sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	sqlite.pragma('busy_timeout = 5000');
	sqlite.pragma('synchronous = NORMAL');

	const db = drizzle(sqlite, { schema });
	if (options.migrate !== false) runMigrations(db, options.migrationsDir);

	return { sqlite, db, path: options.path, close: () => sqlite.close() };
}
