import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupStamp } from '../../scripts/backup-retention.mjs';
import { makeHost } from '../fixtures/tenant-host';

/**
 * #96: backups, restores and exports of tenants. The commands are the real shell scripts; docker is
 * scripted (tests/fixtures/fake-docker.sh), and stands in for the app's own backup and restore,
 * which have their own tests. The rules for which backups to keep run for real.
 */
let h: ReturnType<typeof makeHost>;
beforeEach(() => {
	h = makeHost();
});
afterEach(() => h.cleanup());

const backupsOf = (name: string) =>
	existsSync(path.join(h.backupsDir, name))
		? readdirSync(path.join(h.backupsDir, name))
				.filter((f) => f.endsWith('.mcpa'))
				.sort()
		: [];
const restoredInto = (container: string) => readFileSync(path.join(h.state, `restored-${container}`), 'utf8');
const mode = (file: string) => statSync(file).mode & 0o777;
/** A backup file from the past, as the nightly run would have left it. */
function oldBackup(name: string, daysAgo: number) {
	const dir = path.join(h.backupsDir, name);
	mkdirSync(dir, { recursive: true });
	const file = `${name}-${backupStamp(new Date(Date.now() - daysAgo * 86_400_000))}.mcpa`;
	writeFileSync(path.join(dir, file), `MCPABK1 old backup ${daysAgo}`);
	return file;
}

describe('tenant backup', () => {
	it('makes an encrypted backup with the tenant’s own passphrase, readable by the operator only', () => {
		h.create('acme');
		expect(h.tenant(['backup', 'acme', '--dry-run']).out).toContain('Nothing was changed (--dry-run).');
		expect(backupsOf('acme')).toEqual([]);

		const r = h.tenant(['backup', 'acme']);
		expect(r.err).toBe('');
		expect(r.code).toBe(0);
		const [file] = backupsOf('acme');
		expect(file).toMatch(/^acme-\d{8}T\d{6}Z\.mcpa$/);
		expect(r.out).toContain(`Backed up "acme": ${path.join(h.backupsDir, 'acme', file!)}`);
		// Made inside the running container, which holds the passphrase: none is handed over.
		expect(readFileSync(path.join(h.backupsDir, 'acme', file!), 'utf8')).toBe(
			'MCPABK1 fake backup of mcp-audit-tenant-acme how=exec key=own\n'
		);
		expect(h.dockerCalls()).toContain('exec mcp-audit-tenant-acme node scripts/backup.mjs --out -');
		expect(mode(path.join(h.backupsDir, 'acme'))).toBe(0o700);
		expect(mode(path.join(h.backupsDir, 'acme', file!))).toBe(0o600);
		expect(h.meta('acme')).toMatch(/last_backup=\d{4}-/);
		expect(h.events()).toContain(`acme backup ${file}`);
		expect(h.tenant(['backups', 'acme']).out).toContain(file!);
	});

	it('backs up a suspended tenant too, and reports a backup that fails', () => {
		h.create('acme');
		h.tenant(['suspend', 'acme']);
		expect(h.tenant(['backup', 'acme']).code).toBe(0);
		expect(readFileSync(path.join(h.backupsDir, 'acme', backupsOf('acme')[0]!), 'utf8')).toContain(
			'how=compose'
		);

		const failed = h.tenant(['backup', 'acme'], { env: { FAKE_DOCKER_FAIL: 'backup.mjs' } });
		expect(failed.code).toBe(1);
		expect(failed.err).toContain('The backup of "acme" failed.');
		expect(backupsOf('acme')).toHaveLength(1);
		// No half-written file is left behind.
		expect(readdirSync(path.join(h.backupsDir, 'acme'))).toHaveLength(1);
		expect(h.meta('acme')).toMatch(/last_backup_failed=\d{4}-/);
		expect(h.tenant(['backup', 'nobody']).err).toContain('There is no tenant "nobody".');
	});
});

describe('tenant restore', () => {
	it('in place: asks for the name, backs up the current state first, and records it', () => {
		h.create('acme');
		const file = oldBackup('acme', 3);
		const dry = h.tenant(['restore', 'acme', '--from', file, '--dry-run']);
		expect(dry.out).toContain('would: back up the current state first');
		expect(dry.out).toContain('Nothing was changed (--dry-run).');
		const wrong = h.tenant(['restore', 'acme', '--from', file], { input: 'acme2\n' });
		expect(wrong.code).toBe(1);
		expect(wrong.err).toContain('That is not "acme". Nothing was restored.');
		expect(existsSync(path.join(h.state, 'restored-mcp-audit-tenant-acme'))).toBe(false);

		const r = h.tenant(['restore', 'acme', '--from', file], { input: 'acme\n' });
		expect(r.err).toBe('');
		expect(r.code).toBe(0);
		expect(r.out).toContain(`"acme" is restored from ${file}.`);
		// The state before the restore is kept as a backup of its own.
		expect(backupsOf('acme')).toHaveLength(2);
		// The tenant's own passphrase opens its own backup; existing data is replaced on purpose.
		const restored = restoredInto('mcp-audit-tenant-acme');
		expect(restored).toContain(`key=given:${h.envOf('acme').BACKUP_PASSPHRASE}`);
		expect(restored).toContain('force=yes');
		expect(restored).toContain('MCPABK1 old backup 3');
		// Stopped for the restore, started after it.
		const calls = h.dockerCalls();
		const stop = calls.lastIndexOf('compose stop');
		const restore = calls.findIndex((c) => c.includes('scripts/restore.mjs'));
		expect(stop).toBeGreaterThan(-1);
		expect(restore).toBeGreaterThan(stop);
		expect(calls.lastIndexOf('compose up -d')).toBeGreaterThan(restore);
		// The passphrase is never on a command line.
		expect(calls.join('\n')).not.toContain(h.envOf('acme').BACKUP_PASSPHRASE);
		expect(h.meta('acme')).toContain(`from ${file}`);
		expect(h.events()).toContain(`acme restored ${file}`);
	});

	it('"latest" is the newest backup; a restore that fails leaves the data and brings the instance back', () => {
		h.create('acme');
		oldBackup('acme', 9);
		const newest = oldBackup('acme', 1);
		expect(h.tenant(['restore', 'acme', '--from', 'latest', '--dry-run']).out).toContain(`from ${newest}`);
		expect(h.tenant(['restore', 'acme', '--from', 'no-such.mcpa']).err).toContain(
			'There is no backup "no-such.mcpa".'
		);

		const r = h.tenant(['restore', 'acme', '--from', 'latest'], {
			input: 'acme\n',
			env: { FAKE_DOCKER_FAIL: 'restore.mjs' }
		});
		expect(r.code).toBe(1);
		expect(r.err).toContain('The backup was not restored; the data is as it was.');
		expect(h.dockerCalls().at(-1)).toMatch(/^inspect -f/);
		expect(h.tenant(['status', 'acme']).out).toContain('running, healthy');
		expect(h.events()).toContain(`acme restore-failed ${newest}`);
	});

	it('--as makes a new tenant from the backup, with secrets of its own', () => {
		h.create('acme');
		const file = oldBackup('acme', 2);
		const dry = h.tenant(['restore', 'acme', '--from', file, '--as', 'acme-check', '--dry-run']);
		expect(dry.out).toContain(`would: restore ${file} of "acme" into its data`);
		expect(existsSync(path.join(h.tenantsDir, 'acme-check'))).toBe(false);

		const r = h.tenant(['restore', 'acme', '--from', file, '--as', 'acme-check']);
		expect(r.err).toBe('');
		expect(r.code).toBe(0);
		expect(r.out).toContain('Tenant "acme-check" is running at https://mcpaudit-acme-check.example.test');
		expect(r.out).toContain('People of "acme" sign in at the copy with a code by email');
		// No invitation: the people are in the backup.
		expect(r.out).not.toContain('has emailed the first admin');
		// Opened with the source's passphrase; the copy has another of its own.
		const source = h.envOf('acme').BACKUP_PASSPHRASE!;
		const copy = h.envOf('acme-check').BACKUP_PASSPHRASE!;
		expect(copy).not.toBe(source);
		const restored = restoredInto('mcp-audit-tenant-acme-check');
		expect(restored).toContain(`key=given:${source}`);
		expect(restored).toContain('force=no');
		expect(restored).toContain('MCPABK1 old backup 2');
		// The data goes in before the first start.
		const calls = h.dockerCalls();
		const restore = calls.findIndex((c) => c.includes('scripts/restore.mjs'));
		expect(calls.indexOf('compose up -d', restore)).toBeGreaterThan(restore);
		expect(h.meta('acme-check')).toContain(`restored_from=acme ${file}`);
		expect(h.meta('acme-check')).toContain('title=acme audit (restored copy)');
		expect(h.meta('acme-check')).toContain('version=v1.2.3');
		// The original is untouched.
		expect(h.meta('acme')).toContain('state=active');
		expect(existsSync(path.join(h.state, 'restored-mcp-audit-tenant-acme'))).toBe(false);
	});

	it('--as leaves nothing behind when the backup cannot be opened', () => {
		h.create('acme');
		const file = oldBackup('acme', 2);
		const r = h.tenant(['restore', 'acme', '--from', file, '--as', 'acme-check'], {
			env: { FAKE_DOCKER_FAIL: 'restore.mjs' }
		});
		expect(r.code).toBe(1);
		expect(r.err).toContain(`Create failed at: restore ${file} of "acme" into its data.`);
		expect(existsSync(path.join(h.tenantsDir, 'acme-check'))).toBe(false);
		expect(existsSync(path.join(h.hostDir, 'registry/acme-check.meta'))).toBe(false);
	});
});

describe('tenant export', () => {
	it('writes an archive with a readme, encrypted with a passphrase of its own that is shown once', () => {
		h.create('acme');
		expect(h.tenant(['export', 'acme', '--dry-run']).out).toContain('Nothing was changed (--dry-run).');
		expect(existsSync(h.exportsDir)).toBe(false);

		const r = h.tenant(['export', 'acme']);
		expect(r.err).toBe('');
		const archive = /Export of "acme": (\S+\.tar)/.exec(r.out)![1]!;
		const passphrase = /^ {4}([A-Za-z0-9_-]{43})$/m.exec(r.out)![1]!;
		expect(path.dirname(archive)).toBe(h.exportsDir);
		expect(mode(archive)).toBe(0o600);
		expect(passphrase).not.toBe(h.envOf('acme').BACKUP_PASSPHRASE);

		const names = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split('\n').sort();
		expect(names).toEqual(['README.txt', path.basename(archive, '.tar') + '.mcpa'].sort());
		const read = (name: string) => execFileSync('tar', ['-xOf', archive, name], { encoding: 'utf8' });
		// Not the tenant's backup passphrase: the tenant can be given this one without learning that one.
		expect(read(names.find((n) => n.endsWith('.mcpa'))!)).toBe(
			`MCPABK1 fake backup of mcp-audit-tenant-acme how=exec key=given:${passphrase}\n`
		);
		const readme = read('README.txt');
		expect(readme).toContain('Your data from acme audit');
		expect(readme).toContain('https://mcpaudit-acme.example.test');
		expect(readme).toContain('node scripts/restore.mjs --in /backups/');
		expect(readme).not.toContain(passphrase);
		// Stored nowhere on the host.
		const kept = [h.meta('acme'), readFileSync(path.join(h.hostDir, 'registry/events.tsv'), 'utf8')].join(
			'\n'
		);
		expect(kept).not.toContain(passphrase);
		expect(h.dockerCalls().join('\n')).not.toContain(passphrase);
		expect(readdirSync(h.exportsDir)).toEqual([path.basename(archive)]);

		const out = path.join(h.root, 'elsewhere');
		expect(h.tenant(['export', 'acme', '--out', out]).out).toContain(`Export of "acme": ${out}/acme-export-`);
	});
});

describe('tenant delete, with backups', () => {
	it('makes a final export, removes the data, and keeps the backups for a stated time', () => {
		h.create('acme');
		h.tenant(['backup', 'acme']);
		const passphrase = h.envOf('acme').BACKUP_PASSPHRASE!;

		const dry = h.tenant(['delete', 'acme', '--dry-run']);
		expect(dry.out).toContain(`would: make a final encrypted export in ${h.exportsDir}`);
		expect(dry.out).toContain('would: keep its backups for 30 days, then remove them');

		const r = h.tenant(['delete', 'acme'], { input: 'acme\n' });
		expect(r.err).toBe('');
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/Export of "acme": \S+acme-export-\d{8}T\d{6}Z\.tar/);
		expect(r.out).toMatch(/Tenant "acme" is deleted\. Its backups are removed after \d{4}-\d\d-\d\dT/);
		// The export was made while the instance still existed.
		const calls = h.dockerCalls();
		expect(
			calls.findIndex((c) => c.includes('-e BACKUP_PASSPHRASE mcp-audit-tenant-acme node scripts/backup.mjs'))
		).toBeLessThan(calls.indexOf('compose down -v --remove-orphans'));
		expect(existsSync(path.join(h.tenantsDir, 'acme'))).toBe(false);
		// The backups stay, and what opens them stays too, apart from them and for the operator only.
		expect(backupsOf('acme')).toHaveLength(1);
		const kept = path.join(h.tenantsDir, '.deleted/acme');
		expect(h.envOf('acme', kept).BACKUP_PASSPHRASE).toBe(passphrase);
		expect(mode(path.join(kept, '.env'))).toBe(0o600);
		expect(readdirSync(path.join(h.backupsDir, 'acme')).join()).not.toContain('.env');
		const record = readFileSync(path.join(h.hostDir, 'registry/deleted.tsv'), 'utf8').trim().split('\n');
		expect(record[0]).toBe('name\ttitle\taddress\tcreated\tdeleted\tbackups_kept_until');
		expect(record[1]!.split('\t')[5]).toMatch(/^\d{4}-\d\d-\d\dT/);
		expect(record.join('\n')).not.toContain(passphrase);

		// Within that time a backup can still be brought back, as a new tenant.
		const back = h.tenant(['restore', 'acme', '--from', 'latest', '--as', 'acme-back']);
		expect(back.code).toBe(0);
		expect(restoredInto('mcp-audit-tenant-acme-back')).toContain(`key=given:${passphrase}`);
	});

	it('deletes nothing when the final export fails; --without-export skips it', () => {
		h.create('acme');
		const r = h.tenant(['delete', 'acme'], { input: 'acme\n', env: { FAKE_DOCKER_FAIL: 'backup.mjs' } });
		expect(r.code).toBe(1);
		expect(r.err).toContain('The final export failed, so nothing was deleted.');
		expect(h.meta('acme')).toContain('state=active');
		expect(h.dockerCalls().some((c) => c.startsWith('compose down'))).toBe(false);

		const skipped = h.tenant(['delete', 'acme', '--without-export'], { input: 'acme\n' });
		expect(skipped.code).toBe(0);
		expect(skipped.out).toContain('skipped: the final export (--without-export)');
		// The export that failed left nothing behind, and none was made this time.
		expect(readdirSync(h.exportsDir)).toEqual([]);
		// No backups were ever made, so nothing is kept.
		expect(existsSync(path.join(h.tenantsDir, '.deleted'))).toBe(false);
		expect(skipped.out).toContain('Tenant "acme" is deleted.\n');
	});
});

describe('tenant nightly', () => {
	it('backs up every tenant, keeps the last days, weeks and months, and copies off the server', () => {
		const target = path.join(h.root, 'offsite');
		h.hostEnv([
			'BACKUP_KEEP_DAILY=3',
			'BACKUP_KEEP_WEEKLY=0',
			'BACKUP_KEEP_MONTHLY=0',
			`BACKUP_COPY_COMMAND=cp -r {dir} ${target}`
		]);
		h.create('acme');
		h.create('bolt');
		h.tenant(['suspend', 'bolt']);
		const old = [1, 2, 3, 4, 40].map((d) => oldBackup('acme', d));

		expect(h.tenant(['nightly', '--dry-run']).out).toContain('would: back up "acme"');
		expect(backupsOf('acme')).toHaveLength(5);

		const r = h.tenant(['nightly']);
		expect(r.err).toBe('');
		expect(r.code).toBe(0);
		expect(r.out).toContain('acme: backed up');
		expect(r.out).toContain('bolt: backed up');
		expect(r.out).toContain('acme: 3 old backups removed');
		expect(r.out).toContain('Nightly run finished.');
		// Tonight's and the two days before it stay; the rest is gone.
		const kept = backupsOf('acme');
		expect(kept).toHaveLength(3);
		expect(kept).toEqual(expect.arrayContaining([old[0], old[1]]));
		for (const gone of [old[2], old[3], old[4]]) expect(kept).not.toContain(gone);
		expect(backupsOf('bolt')).toHaveLength(1);
		// Off the server: the same files.
		expect(readdirSync(path.join(target, 'acme')).sort()).toEqual(kept);
		expect(readFileSync(path.join(h.hostDir, 'registry/nightly.status'), 'utf8')).toMatch(
			/^time=\S+\nfailures=0\n$/
		);
		expect(h.events()).toContain('acme backups-pruned 3');
	});

	it('checks once a month that the newest backup restores into a working instance', () => {
		h.create('acme');
		const first = h.tenant(['nightly']);
		expect(first.out).toContain("acme: this month's restore check passed");
		const calls = h.dockerCalls();
		// Restored into a throwaway volume and started without any network, then removed.
		expect(
			calls.some((c) =>
				/^run --rm -i -e BACKUP_PASSPHRASE -v mcp-audit-check-acme:\/data .* restore$/.test(
					c.replace(/sh -c .* restore$/, 'sh -c x restore')
				)
			)
		).toBe(true);
		expect(
			calls.some((c) =>
				c.startsWith('run -d --name mcp-audit-check-acme --network none -v mcp-audit-check-acme:/data')
			)
		).toBe(true);
		expect(calls.filter((c) => c === 'rm -f mcp-audit-check-acme').length).toBeGreaterThanOrEqual(2);
		expect(calls).toContain('volume rm -f mcp-audit-check-acme');
		expect(restoredInto('mcp-audit-check-acme')).toContain(`key=given:${h.envOf('acme').BACKUP_PASSPHRASE}`);
		expect(h.meta('acme')).toMatch(/restore_checked=\S+ ok acme-\d{8}T\d{6}Z\.mcpa/);

		// Not again in the same month.
		const before = h.dockerCalls().length;
		const second = h.tenant(['nightly']);
		expect(second.out).not.toContain('restore check');
		expect(
			h
				.dockerCalls()
				.slice(before)
				.some((c) => c.includes('mcp-audit-check-acme'))
		).toBe(false);
	});

	it('reports what failed, for each tenant, and goes on with the others', () => {
		h.create('acme');
		h.create('bolt');
		const r = h.tenant(['nightly'], {
			env: { FAKE_DOCKER_FAIL: 'exec mcp-audit-tenant-acme node scripts/backup' }
		});
		expect(r.code).toBe(1);
		expect(r.out).toContain('acme: BACKUP FAILED');
		expect(r.out).toContain('bolt: backed up');
		expect(r.out).toContain('Nightly run finished with 1 failure(s): acme: backup');
		expect(readFileSync(path.join(h.hostDir, 'registry/nightly.status'), 'utf8')).toContain(
			'failed=acme: backup'
		);

		const check = h.tenant(['check-backup', 'bolt'], { env: { FAKE_DOCKER_UNHEALTHY: '1' } });
		expect(check.code).toBe(1);
		expect(check.err).toContain('The newest backup of "bolt" did NOT restore into a working instance');
		expect(h.meta('bolt')).toMatch(/restore_checked=\S+ failed /);
		expect(h.tenant(['nightly'], { env: { FAKE_DOCKER_FAIL: 'no-such-thing' } }).out).toContain(
			'no copy off the server: BACKUP_COPY_COMMAND is not set'
		);
	});

	it('removes a deleted tenant’s backups, and what opens them, once the stated days have passed', () => {
		h.create('acme');
		h.tenant(['backup', 'acme']);
		h.tenant(['delete', 'acme', '--without-export'], { input: 'acme\n' });
		// 30 days by default: not yet.
		expect(h.tenant(['nightly']).out).not.toContain('backups of the deleted tenant removed');
		expect(backupsOf('acme')).toHaveLength(1);

		h.hostEnv(['DELETED_BACKUPS_DAYS=0']);
		expect(h.tenant(['nightly', '--dry-run']).out).toContain(
			'would: remove the backups of deleted tenant "acme"'
		);
		expect(backupsOf('acme')).toHaveLength(1);
		const r = h.tenant(['nightly']);
		expect(r.out).toContain('acme: backups of the deleted tenant removed');
		expect(existsSync(path.join(h.backupsDir, 'acme'))).toBe(false);
		expect(existsSync(path.join(h.tenantsDir, '.deleted/acme'))).toBe(false);
		// The registry records when.
		expect(h.events().some((e) => /^acme backups-removed deleted \S+, kept 0 days$/.test(e))).toBe(true);
		expect(h.tenant(['restore', 'acme', '--from', 'latest', '--as', 'acme-back']).err).toContain(
			'has no backups'
		);
	});
});
