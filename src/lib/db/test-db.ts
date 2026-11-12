import { openDatabase, type AppDatabase } from './client';

/** A fresh in-memory database with every migration applied. For unit tests. */
export function createTestDatabase(): AppDatabase {
	return openDatabase({ path: ':memory:' });
}
