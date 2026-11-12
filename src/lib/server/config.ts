import path from 'node:path';

/** Runtime configuration. Everything comes from environment variables; see .env.example. */
export interface Config {
	dataDir: string;
	databasePath: string;
	filesDir: string;
	testSeedEnabled: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const dataDir = path.resolve(env.DATA_DIR ?? 'data');
	return {
		dataDir,
		databasePath: path.join(dataDir, 'app.db'),
		filesDir: path.join(dataDir, 'files'),
		testSeedEnabled: env.TEST_SEED_ENABLED === 'true'
	};
}
