import { describe, expect, it } from 'vitest';
import {
	backupStamp,
	backupTime,
	isoWeek,
	main,
	removalDate,
	removalDue,
	retention
} from '../../scripts/backup-retention.mjs';

/** #96: which of a tenant's backups are kept, and when a deleted tenant's backups go. */

const day = (iso: string, hour = 2) =>
	`acme-${backupStamp(new Date(`${iso}T${String(hour).padStart(2, '0')}:00:00Z`))}.mcpa`;
/** One backup a night for `count` nights, ending on `last`. */
function nightly(last: string, count: number): string[] {
	const end = new Date(`${last}T02:00:00Z`).getTime();
	return Array.from({ length: count }, (_, i) => `acme-${backupStamp(new Date(end - i * 86_400_000))}.mcpa`);
}

describe('a backup’s time comes from its name', () => {
	it('reads <tenant>-YYYYMMDDTHHMMSSZ.mcpa, also for names with hyphens', () => {
		expect(backupStamp(new Date('2026-11-23T02:15:09.123Z'))).toBe('20261123T021509Z');
		expect(backupTime('acme-20261123T021509Z.mcpa')).toEqual(new Date('2026-11-23T02:15:09Z'));
		expect(backupTime('acme-audit-co-20261123T021509Z.mcpa')).toEqual(new Date('2026-11-23T02:15:09Z'));
		for (const other of [
			'README.txt',
			'acme-2026-11-23.mcpa',
			'acme-20261123T021509Z.mcpa.part',
			'.passphrase'
		])
			expect(backupTime(other)).toBeNull();
	});

	it('knows ISO weeks across a year’s end', () => {
		expect(isoWeek(new Date('2026-11-23T00:00:00Z'))).toBe('2026-W48');
		expect(isoWeek(new Date('2026-11-22T23:59:59Z'))).toBe('2026-W47');
		expect(isoWeek(new Date('2027-01-03T12:00:00Z'))).toBe('2026-W53');
		expect(isoWeek(new Date('2027-01-04T12:00:00Z'))).toBe('2027-W01');
	});
});

/** The moment the rules are applied: right after the night's backup of 23 November. */
const NOW = new Date('2026-11-23T02:05:00Z');
/** Without the rule for recent backups, to see the others on their own. */
const old = { recentHours: 0 };

describe('retention: 7 daily, 4 weekly, 6 monthly', () => {
	it('keeps everything while there is little', () => {
		const few = nightly('2026-11-23', 5);
		expect(retention(few, {}, NOW)).toEqual({ keep: few, remove: [] });
		expect(retention([], {}, NOW)).toEqual({ keep: [], remove: [] });
	});

	it('after a year of nights keeps the last 7 days, 4 weeks and 6 months', () => {
		const all = nightly('2026-11-23', 365);
		const { keep, remove } = retention(all, {}, NOW);
		expect(keep.length + remove.length).toBe(365);
		const kept = keep.map((n) => backupTime(n)!.toISOString().slice(0, 10));
		expect(kept).toEqual([
			// the last 7 days (the newest is also this week's and this month's)
			'2026-11-23',
			'2026-11-22', // also the newest of the week before
			'2026-11-21',
			'2026-11-20',
			'2026-11-19',
			'2026-11-18',
			'2026-11-17',
			// the newest of the two weeks before those
			'2026-11-15',
			'2026-11-08',
			// the newest of the five months before this one
			'2026-10-31',
			'2026-09-30',
			'2026-08-31',
			'2026-07-31',
			'2026-06-30'
		]);
	});

	it('keeps the newest of a day when there are several, and counts days that have backups', () => {
		const names = [
			day('2026-11-23', 2),
			day('2026-11-23', 14),
			day('2026-11-23', 9),
			day('2026-11-20'),
			day('2026-11-01')
		];
		const { keep, remove } = retention(
			names,
			{ daily: 2, weekly: 0, monthly: 0, ...old },
			new Date('2026-11-24T00:00:00Z')
		);
		// Two days that have a backup: the 23rd (its newest) and the 20th. The 21st and 22nd have none.
		expect(keep).toEqual([day('2026-11-23', 14), day('2026-11-20')]);
		expect(remove).toEqual([day('2026-11-23', 9), day('2026-11-23', 2), day('2026-11-01')]);
	});

	it('always keeps the newest, and never lists a file that is not a backup', () => {
		const names = [day('2026-11-23'), day('2026-11-22'), 'README.txt', 'acme-export.tar', '.passphrase'];
		expect(retention(names, { daily: 0, weekly: 0, monthly: 0, ...old }, NOW)).toEqual({
			keep: [day('2026-11-23')],
			remove: [day('2026-11-22')]
		});
	});

	it('is the same whatever order the names come in', () => {
		const all = nightly('2026-11-23', 120);
		const shuffled = [...all].sort((a, b) => (a.slice(-9) < b.slice(-9) ? -1 : 1)).reverse();
		expect(retention(shuffled, {}, NOW)).toEqual(retention(all, {}, NOW));
	});
});

describe('recent backups', () => {
	it('are all kept for 48 hours: one made by hand, or before a restore, is still there the next morning', () => {
		const names = [
			day('2026-11-23', 2), // tonight's
			day('2026-11-22', 16), // before a restore yesterday afternoon
			day('2026-11-22', 15), // made by hand an hour earlier
			day('2026-11-22', 2), // yesterday's nightly
			day('2026-11-21', 9), // by hand two days ago, in the morning
			day('2026-11-21', 1) // more than 48 hours ago, and not that day's newest
		];
		const { keep, remove } = retention(names, { daily: 1, weekly: 0, monthly: 0 }, NOW);
		expect(keep).toEqual(names.slice(0, 5));
		expect(remove).toEqual([day('2026-11-21', 1)]);
		// Two days on, only what the daily rule keeps is left.
		const later = retention(names, { daily: 1, weekly: 0, monthly: 0 }, new Date('2026-11-25T02:05:00Z'));
		expect(later.keep).toEqual([day('2026-11-23', 2)]);
	});
});

describe('a deleted tenant’s backups', () => {
	it('are due a stated number of days after the deletion', () => {
		expect(removalDate('2026-11-23T10:00:00Z', 30)).toEqual(new Date('2026-12-23T10:00:00Z'));
		expect(removalDue('2026-11-23T10:00:00Z', 30, new Date('2026-12-23T09:59:59Z'))).toBe(false);
		expect(removalDue('2026-11-23T10:00:00Z', 30, new Date('2026-12-23T10:00:00Z'))).toBe(true);
		expect(removalDue('2026-11-23T10:00:00Z', 0, new Date('2026-11-23T10:00:00Z'))).toBe(true);
		expect(() => removalDate('soon', 30)).toThrow('is not a date');
		expect(() => removalDate('2026-11-23T10:00:00Z', -1)).toThrow('is not a number of days');
	});
});

describe('the command', () => {
	it('prints what may be removed, and the removal date', () => {
		const names = nightly('2026-11-23', 10);
		const at = ['--now', NOW.toISOString()];
		expect(
			main(
				['prune', '--daily', '3', '--weekly', '0', '--monthly', '0', '--recent-hours', '0', ...at],
				names.join('\n')
			)
		).toEqual(names.slice(3));
		expect(main(['prune', ...at], names.join('\n'))).toEqual(retention(names, {}, NOW).remove);
		expect(main(['after', '2026-11-23T10:00:00Z', '30'])).toEqual(['2026-12-23T10:00:00Z']);
		expect(main(['due', '2026-11-23T10:00:00Z', '30', '2027-01-01T00:00:00Z'])).toEqual(['yes']);
		expect(main(['due', '2026-11-23T10:00:00Z', '30', '2026-11-24T00:00:00Z'])).toEqual(['no']);
		expect(() => main(['prune', '--yearly', '1'])).toThrow('Usage');
		expect(() => main(['forget'])).toThrow('Usage');
	});
});
