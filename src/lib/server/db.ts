import { mkdirSync } from 'node:fs';
import { openDatabase, type AppDatabase } from '#lib/db/client.ts';
import { loadConfig } from './config';

let instance: AppDatabase | undefined;

/** The app's database, opened and migrated once per process. All state lives under DATA_DIR. */
export function appDatabase(): AppDatabase {
	if (!instance) {
		const config = loadConfig();
		mkdirSync(config.filesDir, { recursive: true });
		instance = openDatabase({ path: config.databasePath });
	}
	return instance;
}
