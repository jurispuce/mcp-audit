import type { AppDatabase } from '#lib/db/client.ts';

/**
 * Settings of the instance itself (the AI gateway, what a tenant profile applied): one JSON value per
 * key in `app_setting`. Not audit data, so not versioned. This is the only place that writes the table.
 */

export function readSetting<T>(app: AppDatabase, key: string, fallback: T): T {
	const row = app.sqlite.prepare('SELECT value FROM app_setting WHERE key = ?').get(key) as
		{ value: string } | undefined;
	if (!row) return fallback;
	try {
		return JSON.parse(row.value) as T;
	} catch {
		return fallback;
	}
}

export function saveSetting(app: AppDatabase, key: string, value: unknown, now = new Date()): void {
	app.sqlite
		.prepare(
			`INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
		)
		.run(key, JSON.stringify(value), now.getTime());
}
