// Which of a tenant's backups to keep (#96), and when a deleted tenant's backups go.
//
//   ls backups/acme | node scripts/backup-retention.mjs prune --daily 7 --weekly 4 --monthly 6
//       prints the file names that may be removed, one per line
//   node scripts/backup-retention.mjs after <deleted at> <days>
//       prints when a deleted tenant's backups are due for removal
//   node scripts/backup-retention.mjs due <deleted at> <days> [now]
//       prints yes or no
//
// On the tenant host it runs in the app's image, which has Node. A backup's time is read from its
// name, <tenant>-YYYYMMDDTHHMMSSZ.mcpa, so copying or touching a file does not change its age.

export const DEFAULT_KEEP = { daily: 7, weekly: 4, monthly: 6 };
/**
 * A backup younger than this is always kept: one made by hand, or just before a restore, is still
 * there the next morning even though a newer one exists from the same day.
 */
export const DEFAULT_RECENT_HOURS = 48;

const NAME = /-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.mcpa$/;

/** @param {Date} at */
export function backupStamp(at) {
	return at
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d+Z$/, 'Z');
}

/** When a backup was made, from its file name; null for a file that is not a backup. @param {string} name */
export function backupTime(name) {
	const m = name.match(NAME);
	if (!m) return null;
	const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
	const at = new Date(Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0));
	return Number.isNaN(at.getTime()) ? null : at;
}

/** ISO week as "2026-W47": weeks start on Monday, and week 1 holds the year's first Thursday. @param {Date} at */
export function isoWeek(at) {
	const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
	const day = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - day);
	const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
	const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
	return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * The backups to keep and to remove. Kept: the newest backup of each of the last `daily` days that
 * have one, of each of the last `weekly` weeks and of each of the last `monthly` months, every
 * backup younger than `recentHours`, and always the newest of all. Files that are not backups are
 * never listed for removal.
 * @param {string[]} names
 * @param {{ daily?: number, weekly?: number, monthly?: number, recentHours?: number }} [keep]
 * @param {Date} [now]
 * @returns {{ keep: string[], remove: string[] }}
 */
export function retention(names, keep = {}, now = new Date()) {
	const rule = { ...DEFAULT_KEEP, recentHours: DEFAULT_RECENT_HOURS, ...keep };
	const backups = names
		.map((name) => ({ name, at: backupTime(name) }))
		.filter((b) => b.at !== null)
		.sort((a, b) => /** @type {Date} */ (b.at).getTime() - /** @type {Date} */ (a.at).getTime());
	const kept = new Set();
	if (backups[0]) kept.add(backups[0].name);
	const recent = now.getTime() - rule.recentHours * 3_600_000;
	for (const b of backups) if (/** @type {Date} */ (b.at).getTime() >= recent) kept.add(b.name);
	/** @param {(at: Date) => string} period @param {number} count */
	const newestOfEach = (period, count) => {
		const seen = new Set();
		for (const b of backups) {
			const key = period(/** @type {Date} */ (b.at));
			if (seen.has(key)) continue;
			if (seen.size >= count) break;
			seen.add(key);
			kept.add(b.name);
		}
	};
	newestOfEach((at) => at.toISOString().slice(0, 10), rule.daily);
	newestOfEach(isoWeek, rule.weekly);
	newestOfEach((at) => at.toISOString().slice(0, 7), rule.monthly);
	return {
		keep: backups.filter((b) => kept.has(b.name)).map((b) => b.name),
		remove: backups.filter((b) => !kept.has(b.name)).map((b) => b.name)
	};
}

/** When the backups of a tenant deleted at `deletedAt` are removed. @param {string | Date} deletedAt @param {number} days */
export function removalDate(deletedAt, days) {
	const at = new Date(deletedAt);
	if (Number.isNaN(at.getTime())) throw new Error(`"${deletedAt}" is not a date.`);
	if (!Number.isFinite(days) || days < 0) throw new Error(`"${days}" is not a number of days.`);
	return new Date(at.getTime() + days * 86_400_000);
}

/** @param {string | Date} deletedAt @param {number} days @param {Date} [now] */
export function removalDue(deletedAt, days, now = new Date()) {
	return now.getTime() >= removalDate(deletedAt, days).getTime();
}

/** @param {string[]} argv @param {string} input @returns {string[]} lines to print */
export function main(argv, input = '') {
	const [command = '', ...rest] = argv;
	if (command === 'prune') {
		/** @type {Record<string, number>} */
		const keep = {};
		let now = new Date();
		for (let i = 0; i < rest.length; i += 2) {
			const key = String(rest[i]).replace(/^--/, '');
			if (key === 'now') {
				now = new Date(String(rest[i + 1]));
				continue;
			}
			const name = key === 'recent-hours' ? 'recentHours' : key;
			const n = Number(rest[i + 1]);
			if (!(name in DEFAULT_KEEP || name === 'recentHours') || !Number.isInteger(n) || n < 0)
				throw new Error(
					'Usage: backup-retention.mjs prune [--daily N] [--weekly N] [--monthly N] [--recent-hours N]'
				);
			keep[name] = n;
		}
		return retention(
			input
				.split('\n')
				.map((l) => l.trim())
				.filter(Boolean),
			keep,
			now
		).remove;
	}
	if (command === 'after')
		return [
			removalDate(String(rest[0]), Number(rest[1]))
				.toISOString()
				.replace(/\.\d+Z$/, 'Z')
		];
	if (command === 'due')
		return [
			removalDue(String(rest[0]), Number(rest[1]), rest[2] ? new Date(rest[2]) : new Date()) ? 'yes' : 'no'
		];
	throw new Error('Usage: backup-retention.mjs prune|after|due …');
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		const { readFileSync } = await import('node:fs');
		const argv = process.argv.slice(2);
		const lines = main(argv, argv[0] === 'prune' ? readFileSync(0, 'utf8') : '');
		if (lines.length) console.log(lines.join('\n'));
	} catch (e) {
		console.error(e instanceof Error ? e.message : e);
		process.exit(1);
	}
}
