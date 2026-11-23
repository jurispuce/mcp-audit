import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupStamp } from '../../scripts/backup-retention.mjs';
import { makeHost } from '../fixtures/tenant-host';

/**
 * #98: the operator's overview. The command is the real shell script; docker is scripted
 * (tests/fixtures/fake-docker.sh) and answers for each instance's operator endpoint, and `df` is
 * scripted too, so how full the disk is does not depend on the machine the tests run on.
 */
let h: ReturnType<typeof makeHost>;
beforeEach(() => {
	h = makeHost();
});
afterEach(() => h.cleanup());

const ATTENTION = 3;
/** A backup file of some hours ago, as the nightly run would have left it. */
function backupOf(name: string, hoursAgo: number) {
	const dir = path.join(h.backupsDir, name);
	mkdirSync(dir, { recursive: true });
	const file = `${name}-${backupStamp(new Date(Date.now() - hoursAgo * 3_600_000))}.mcpa`;
	writeFileSync(path.join(dir, file), 'MCPABK1 a backup');
	return file;
}
const row = (out: string, name: string) => out.split('\n').find((l) => l.startsWith(`${name} `)) ?? '';
const stop = (name: string) => writeFileSync(path.join(h.state, `mcp-audit-tenant-${name}`), 'stopped');
const metaAdd = (name: string, line: string) =>
	writeFileSync(path.join(h.hostDir, 'registry', `${name}.meta`), `${h.meta(name)}${line}\n`);

describe('tenant status --all', () => {
	it('shows each tenant’s state, version, backup, restore check, data, people, last sign-in and AI', () => {
		h.create('acme');
		h.create('bolt');
		backupOf('acme', 5);
		backupOf('bolt', 5);
		metaAdd('acme', 'restore_checked=2026-11-01T02:10:00Z ok acme-20261101T020000Z.mcpa');
		const r = h.tenant(['status', '--all']);
		expect(r.err).toBe('');
		expect(r.code).toBe(0);
		const lines = r.out.trim().split('\n');
		expect(lines[0]).toMatch(/^Tenants on this host at \d{4}-.*Z\. The host is on v1\.2\.3\.$/);
		expect(lines[1]).toMatch(
			/^NAME\s+STATE\s+VERSION\s+BACKUP\s+RESTORE CHECK\s+DATA\s+PEOPLE\s+LAST SIGN-IN\s+AI$/
		);
		expect(row(r.out, 'acme')).toMatch(
			/^acme\s+up\s+v1\.2\.3\s+\d{4}-\d\d-\d\d \d\d:\d\d\s+ok 2026-11-01\s+5\.2 MB\s+3 \(\+1 invited\)\s+2026-11-22 08:30\s+no AI gateway in host\.env$/
		);
		expect(row(r.out, 'bolt')).toMatch(
			/^bolt\s+up\s+v1\.2\.3\s+\d{4}-\d\d-\d\d \d\d:\d\d\s+not yet\s+5\.2 MB/
		);
		expect(r.out).toContain('Disk: /srv 41% full.');
		expect(lines.at(-1)).toBe('All well.');
	});

	it('asks each instance inside its own container, with that tenant’s own token, never on a command line', () => {
		h.create('acme');
		h.create('bolt');
		const tokenA = h.envOf('acme').OPERATOR_TOKEN!;
		const tokenB = h.envOf('bolt').OPERATOR_TOKEN!;
		expect(tokenA).toMatch(/^[\w-]{43}$/);
		expect(tokenA).not.toBe(tokenB);
		expect(tokenA).not.toBe(h.envOf('acme').BACKUP_PASSPHRASE);
		backupOf('acme', 1);
		backupOf('bolt', 1);
		h.tenant(['status', '--all']);
		const calls = h.dockerCalls().join('\n');
		expect(calls).toMatch(/^exec mcp-audit-tenant-acme node -e .*\/api\/operator\/status/m);
		expect(calls).toMatch(/^exec mcp-audit-tenant-bolt node -e .*\/api\/operator\/status/m);
		expect(calls).not.toContain(tokenA);
		expect(calls).not.toContain(tokenB);
		// The token is not in the registry or the profile either.
		expect(h.meta('acme')).not.toContain(tokenA);
		expect(readFileSync(path.join(h.tenantsDir, 'acme/tenant-profile.yaml'), 'utf8')).not.toContain(tokenA);
	});

	it('reports a stopped tenant and a missing backup, and ends with a non-zero exit code', () => {
		h.create('acme');
		h.create('bolt');
		backupOf('acme', 2);
		stop('acme');
		const r = h.tenant(['status', '--all']);
		expect(r.code).toBe(ATTENTION);
		expect(row(r.out, 'acme')).toMatch(/^acme\s+DOWN\s+v1\.2\.3\s+\S+ \S+\s+not yet\s+-\s+-\s+-\s/);
		expect(row(r.out, 'bolt')).toMatch(/^bolt\s+up\s+v1\.2\.3\s+none\s/);
		expect(r.out).toContain('Needs attention (2):');
		expect(r.out).toContain('  - acme: the instance is not up (exited).');
		expect(r.out).toContain('  - bolt: it has no backup.');
		expect(r.out).not.toContain('All well.');
	});

	it('a suspended tenant is not a problem: it is shown as suspended, without numbers', () => {
		h.create('acme');
		backupOf('acme', 2);
		h.tenant(['suspend', 'acme']);
		const r = h.tenant(['status', '--all']);
		expect(r.code).toBe(0);
		expect(row(r.out, 'acme')).toMatch(/^acme\s+suspended\s/);
	});

	it('flags a backup older than a day, a failed backup and a failed restore check', () => {
		h.create('acme');
		h.create('bolt');
		h.create('core');
		backupOf('acme', 30);
		backupOf('bolt', 25);
		backupOf('core', 1);
		metaAdd('bolt', 'last_backup_failed=2026-11-23T02:00:05Z');
		metaAdd('core', 'restore_checked=2026-11-01T02:10:00Z failed core-20261101T020000Z.mcpa');
		const r = h.tenant(['status', '--all']);
		expect(r.code).toBe(ATTENTION);
		expect(r.out).toMatch(/- acme: its last backup is 30 hours old \(\d{4}-\d\d-\d\d \d\d:\d\d\)\./);
		// 25 hours is still within the night's run; the failed attempt is what is reported.
		expect(r.out).not.toContain('bolt: its last backup is');
		expect(r.out).toContain('- bolt: a backup failed at 2026-11-23T02:00:05Z.');
		expect(row(r.out, 'core')).toMatch(/\sFAILED 2026-11-01\s/);
		expect(r.out).toContain(
			'- core: the restore check of core-20261101T020000Z.mcpa failed. Its backups may not restore.'
		);
		expect(r.out).toContain('Needs attention (3):');
		// The limit is the host's to set.
		h.hostEnv(['BACKUP_ALERT_HOURS=48']);
		expect(h.tenant(['status', '--all']).out).not.toContain('acme: its last backup is');
	});

	it('flags a disk that is nearly full', () => {
		h.create('acme');
		backupOf('acme', 1);
		const full = h.tenant(['status', '--all'], { env: { FAKE_DF_PERCENT: '91' } });
		expect(full.code).toBe(ATTENTION);
		expect(full.out).toContain('Disk: /srv 91% full.');
		expect(full.out).toContain('- The disk at /srv is 91% full.');
		expect(h.tenant(['status', '--all'], { env: { FAKE_DF_PERCENT: '84' } }).code).toBe(0);
		h.hostEnv(['DISK_ALERT_PERCENT=95']);
		expect(h.tenant(['status', '--all'], { env: { FAKE_DF_PERCENT: '91' } }).code).toBe(0);
	});

	it('flags an instance that is up but does not give its numbers, and notes one that has none to give', () => {
		h.create('acme');
		backupOf('acme', 1);
		const refused = h.tenant(['status', '--all'], { env: { FAKE_DOCKER_NUMBERS: 'status-401' } });
		expect(refused.code).toBe(ATTENTION);
		expect(refused.out).toContain('- acme: it is up but did not give its numbers (status-401).');
		// An instance from before the endpoint, or without a token: said, and not a problem.
		const none = h.tenant(['status', '--all'], { env: { FAKE_DOCKER_NUMBERS: 'status-404' } });
		expect(none.code).toBe(0);
		expect(none.out).toContain('Note: acme: it gives no numbers');
		expect(row(none.out, 'acme')).toMatch(/^acme\s+up\s.*\s-\s+-\s+-\s/);
	});

	it('flags a nightly run that had failures, and a tenant left on the "being upgraded" page', () => {
		h.create('acme');
		backupOf('acme', 1);
		writeFileSync(
			path.join(h.hostDir, 'registry/nightly.status'),
			'finished=2026-11-23T02:20:00Z\nfailures=1\nfailed=copy off the server\n'
		);
		writeFileSync(path.join(h.tenantsDir, 'acme/upgrading'), '');
		const r = h.tenant(['status', '--all']);
		expect(r.code).toBe(ATTENTION);
		expect(r.out).toContain('- The last nightly run had failures.');
		expect(r.out).toContain('- acme: its address shows the "being upgraded" page.');
	});

	it('shows one tenant’s numbers in its own status too', () => {
		h.create('acme');
		const status = h.tenant(['status', 'acme']).out;
		expect(status).toContain('People:     3 (+1 invited), last sign-in 2026-11-22 08:30');
		expect(status).toContain('Holds:      2 engagement(s), 5.2 MB, last change 2026-11-22 09:15');
		expect(h.tenant(['status', 'acme', '--all']).err).toContain("Give a tenant's name or --all, not both.");
	});
});
