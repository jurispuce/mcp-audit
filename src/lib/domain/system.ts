import type { AppDatabase } from '#lib/db/client.ts';
import { migrationStatus, type MigrationStatus } from '#lib/db/migrate.ts';
import { APP_VERSION } from '#lib/version.ts';

export interface SystemStatus {
	status: 'ok' | 'error';
	version: string;
	database: 'ok' | 'error';
	migrations: MigrationStatus | null;
	error?: string;
}

/** What /health reports: app version, whether the database answers, and migration state. */
export function systemStatus(app: AppDatabase): SystemStatus {
	try {
		app.sqlite.prepare('SELECT 1').get();
		const migrations = migrationStatus(app.sqlite);
		return {
			status: migrations.pending === 0 ? 'ok' : 'error',
			version: APP_VERSION,
			database: 'ok',
			migrations
		};
	} catch (e) {
		return {
			status: 'error',
			version: APP_VERSION,
			database: 'error',
			migrations: null,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}
