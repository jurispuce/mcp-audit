import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHost } from '../fixtures/tenant-host';

/**
 * #97: upgrades across tenants. The command is the real shell script; docker is scripted
 * (tests/fixtures/fake-docker.sh): it remembers which version each started container runs, lets a
 * test make a version that never becomes healthy, and stands in for the app's backup and restore.
 * The host in these tests is on v1.2.3 (MCP_AUDIT_TAG), which is what a new tenant gets.
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
const route = (name: string) => readFileSync(path.join(h.hostDir, 'tenants', `${name}.caddy`), 'utf8');
const marker = (name: string) => existsSync(path.join(h.tenantsDir, name, 'upgrading'));
const versionOf = (name: string) => /^version=(.*)$/m.exec(h.meta(name))![1];
const restoredInto = (name: string) =>
	readFileSync(path.join(h.state, `restored-mcp-audit-tenant-${name}`), 'utf8');
/** The version the container was last started with. */
const running = (name: string) =>
	readFileSync(path.join(h.state, `version-mcp-audit-tenant-${name}`), 'utf8').trim();
const broken = (pattern: string) => ({ env: { FAKE_DOCKER_UNHEALTHY_TAG: pattern } });

describe('tenant list, with versions', () => {
	it('shows each tenant’s version and which are behind the version the host is on', () => {
		h.create('acme');
		h.create('bolt', ['--version', 'v1.2.10']);
		h.create('core', ['--version', 'main']);
		h.hostEnv(['MCP_AUDIT_TAG=v1.3.0']);
		const rows = h.tenant(['list']).out.trim().split('\n');
		expect(rows[1]).toMatch(/^acme\s.*\sv1\.2\.3 \(behind\)\s+active\s/);
		// Compared number by number: 1.2.10 is newer than 1.2.3, and still behind 1.3.0.
		expect(rows[2]).toMatch(/^bolt\s.*\sv1\.2\.10 \(behind\)\s+active\s/);
		// A name that is no released version cannot be older or newer: it only differs.
		expect(rows[3]).toMatch(/^core\s.*\smain \(differs\)\s+active\s/);
		expect(rows[4]).toBe('Behind v1.3.0: 2. Upgrade them with: bin/tenant upgrade --all');
		expect(rows[5]).toBe('Not on v1.3.0, the version in host.env: 1.');
		expect(h.tenant(['status', 'acme']).out).toContain('Version:    v1.2.3 (behind; the host is on v1.3.0)');

		h.hostEnv(['MCP_AUDIT_TAG=v1.2.5']);
		expect(h.tenant(['list']).out).toMatch(/\sv1\.2\.10 \(ahead\)\s/);
	});

	it('starts each tenant on its own version, whatever the host is on', () => {
		// Compose lets a value in the environment win over the tenant's own file: the host's
		// version must not reach it, or a restart would move a tenant to the host's version.
		h.create('acme', ['--version', 'v1.1.0']);
		expect(running('acme')).toBe('v1.1.0');
		h.hostEnv(['MCP_AUDIT_TAG=v1.3.0']);
		h.tenant(['suspend', 'acme']);
		h.tenant(['resume', 'acme']);
		expect(running('acme')).toBe('v1.1.0');
		h.tenant(['backup', 'acme']);
		expect(h.tenant(['restore', 'acme', '--from', 'latest'], { input: 'acme\n' }).code).toBe(0);
		expect(running('acme')).toBe('v1.1.0');
		expect(versionOf('acme')).toBe('v1.1.0');
	});

	it('says so when a tenant is created on a name that moves', () => {
		expect(h.create('acme').out).not.toContain('not a released version');
		const moving = h.create('bolt', ['--version', 'main']);
		expect(moving.code).toBe(0);
		expect(moving.out).toContain('Note: "main" is not a released version (such as v0.4.0).');
	});
});

describe('tenant upgrade <name>', () => {
	it('backs the tenant up, starts the new version, and checks that it is healthy and says its version', () => {
		h.create('acme');
		const dry = h.tenant(['upgrade', 'acme', '--to', 'v1.3.0', '--dry-run']);
		expect(dry.out).toContain('would: back up the current state');
		expect(dry.out).toContain('Nothing was changed (--dry-run).');
		expect(versionOf('acme')).toBe('v1.2.3');
		expect(backupsOf('acme')).toEqual([]);

		const r = h.tenant(['upgrade', 'acme', '--to', 'v1.3.0']);
		expect(r.err).toBe('');
		expect(r.code).toBe(0);
		expect(r.out).toContain('Upgrading "acme" from v1.2.3 to v1.3.0.');
		const [backup] = backupsOf('acme');
		expect(r.out).toContain(
			`"acme" is on v1.3.0 (the instance reports v1.3.0). The state before is in ${backup}.`
		);

		// The tenant's own environment file names the version; nothing else in it changed.
		const env = h.envOf('acme');
		expect(env.MCP_AUDIT_TAG).toBe('v1.3.0');
		expect(env.BACKUP_PASSPHRASE).toMatch(/^[\w-]{43}$/);
		expect(running('acme')).toBe('v1.3.0');
		expect(versionOf('acme')).toBe('v1.3.0');
		expect(h.meta('acme')).toMatch(/^upgraded=\d{4}-.* from v1\.2\.3$/m);
		expect(h.events()).toEqual(
			expect.arrayContaining([`acme backup ${backup}`, 'acme upgraded v1.2.3 to v1.3.0'])
		);
		expect(h.tenant(['status', 'acme']).out).toMatch(/Upgraded: {3}\d{4}-.* from v1\.2\.3/);

		// In order: the image, the page, the backup of the running instance, stop, start, the version asked.
		const calls = h
			.dockerCalls()
			.slice(h.dockerCalls().lastIndexOf('image inspect ghcr.io/jurispuce/mcp-audit:v1.3.0'));
		const at = (re: RegExp) => calls.findIndex((c) => re.test(c));
		expect(at(/caddy reload/)).toBeGreaterThan(0);
		expect(at(/^exec mcp-audit-tenant-acme node scripts\/backup\.mjs/)).toBeGreaterThan(at(/caddy reload/));
		expect(at(/^compose stop$/)).toBeGreaterThan(at(/backup\.mjs/));
		expect(at(/^compose up -d$/)).toBeGreaterThan(at(/^compose stop$/));
		expect(at(/^exec mcp-audit-tenant-acme node -e .*\/health/)).toBeGreaterThan(at(/^compose up -d$/));
		// Nothing was restored, and the address leads to the instance again.
		expect(existsSync(path.join(h.state, 'restored-mcp-audit-tenant-acme'))).toBe(false);
		expect(marker('acme')).toBe(false);
		expect(route('acme')).toContain('import tenant mcp-audit-tenant-acme');
	});

	it('goes to the host’s version when none is named, and does nothing for a tenant already on it', () => {
		h.create('acme');
		expect(h.tenant(['upgrade', 'acme']).out).toContain('"acme" is already on v1.2.3.');
		expect(backupsOf('acme')).toEqual([]);
		h.hostEnv(['MCP_AUDIT_TAG=v1.4.0']);
		expect(h.tenant(['upgrade', 'acme']).code).toBe(0);
		expect(versionOf('acme')).toBe('v1.4.0');
	});

	it('shows a "being upgraded" page at the tenant’s address while it runs', () => {
		h.create('acme');
		// What the upgrade does first: a marker in the tenant's directory, and the proxy's routes made again.
		execFileSync('touch', [path.join(h.tenantsDir, 'acme', 'upgrading')]);
		execFileSync('bash', [path.join(h.hostDir, 'bin/proxy-sync')], {
			env: {
				PATH: `${path.join(h.root, 'bin')}:${process.env.PATH}`,
				FAKE_DOCKER_LOG: path.join(h.root, 'docker.log'),
				FAKE_DOCKER_STATE: h.state
			}
		});
		expect(route('acme')).toContain('respond "This instance is being upgraded. Try again in a minute." 503');
		expect(route('acme')).toContain('header Retry-After 30');
		expect(route('acme')).not.toContain('import tenant');
		expect(h.tenant(['status', 'acme']).out).toContain('Route:      the "being upgraded" page');
	});

	it('changes nothing when the image cannot be fetched or the backup fails', () => {
		h.create('acme');
		const noImage = h.tenant(['upgrade', 'acme', '--to', 'v9.0.0'], {
			env: { FAKE_DOCKER_NO_IMAGE: 'v9\\.0\\.0', FAKE_DOCKER_FAIL: '^pull ' }
		});
		expect(noImage.code).toBe(1);
		expect(noImage.err).toContain(
			'The image ghcr.io/jurispuce/mcp-audit:v9.0.0 could not be fetched. Nothing was changed for "acme".'
		);
		expect(h.dockerCalls()).not.toContain('compose stop');

		const noBackup = h.tenant(['upgrade', 'acme', '--to', 'v1.3.0'], {
			env: { FAKE_DOCKER_FAIL: 'backup\\.mjs' }
		});
		expect(noBackup.code).toBe(1);
		expect(noBackup.err).toContain(
			'"acme" could not be backed up, so it was not upgraded. Nothing was changed.'
		);
		expect(h.dockerCalls()).not.toContain('compose stop');
		expect(versionOf('acme')).toBe('v1.2.3');
		expect(h.envOf('acme').MCP_AUDIT_TAG).toBe('v1.2.3');
		expect(marker('acme')).toBe(false);
		expect(route('acme')).toContain('import tenant mcp-audit-tenant-acme');
	});

	it('refuses a suspended tenant, a tenant that does not exist and a version that is no image tag', () => {
		h.create('acme');
		h.tenant(['suspend', 'acme']);
		const suspended = h.tenant(['upgrade', 'acme', '--to', 'v1.3.0']);
		expect(suspended.code).toBe(1);
		expect(suspended.err).toContain('"acme" is suspended. Resume it first, then upgrade it.');
		expect(h.tenant(['upgrade', 'nobody', '--to', 'v1.3.0']).err).toContain('There is no tenant "nobody".');
		expect(h.tenant(['upgrade', 'acme', '--to', 'v1;rm']).err).toContain('--to is not an image tag');
		expect(h.tenant(['upgrade', 'acme', '--all']).err).toContain("Give a tenant's name or --all, not both.");
	});
});

describe('an upgrade that fails', () => {
	it('puts back the old version and the backup made just before, and says what failed', () => {
		h.create('acme');
		const r = h.tenant(['upgrade', 'acme', '--to', 'v1.3.0'], broken('acme:v1\\.3\\.0'));
		expect(r.code).toBe(1);
		expect(r.err).toContain('The upgrade of "acme" to v1.3.0 failed: version v1.3.0 did not become healthy.');
		// The instance's own last lines are shown.
		expect(r.err).toContain('The instance did not become healthy. Its last lines:');
		expect(r.out).toContain('Putting back version v1.2.3 and the backup made just before the upgrade.');
		expect(r.err).toContain('"acme" is back on v1.2.3, with its data as it was before the upgrade.');

		// The backup made just before went back in, replacing whatever the new version did to the data.
		const [backup] = backupsOf('acme');
		expect(backupsOf('acme')).toHaveLength(1);
		expect(restoredInto('acme')).toContain('force=yes');
		expect(restoredInto('acme')).toContain('MCPABK1 fake backup of mcp-audit-tenant-acme how=exec key=own');
		// The old version runs again, and everything says so.
		expect(running('acme')).toBe('v1.2.3');
		expect(h.envOf('acme').MCP_AUDIT_TAG).toBe('v1.2.3');
		expect(versionOf('acme')).toBe('v1.2.3');
		expect(h.meta('acme')).not.toContain('upgraded=');
		expect(h.events()).toContain(
			'acme upgrade-failed to v1.3.0: version v1.3.0 did not become healthy; back on v1.2.3'
		);
		expect(h.events()).toContain(`acme backup ${backup}`);
		expect(marker('acme')).toBe(false);
		expect(route('acme')).toContain('import tenant mcp-audit-tenant-acme');
		// The restore ran with the old version's image, after the new one was stopped.
		const calls = h.dockerCalls();
		const restore = calls.findIndex((c) => c.includes('scripts/restore.mjs'));
		expect(calls.lastIndexOf('compose stop')).toBeLessThan(restore);
		expect(calls.lastIndexOf('compose up -d')).toBeGreaterThan(restore);
		// The passphrase is never on a command line.
		expect(calls.join('\n')).not.toContain(h.envOf('acme').BACKUP_PASSPHRASE);
	});

	it('is rolled back when the instance is healthy but reports another version', () => {
		h.create('acme');
		const r = h.tenant(['upgrade', 'acme', '--to', 'v1.3.0'], { env: { FAKE_DOCKER_REPORTS: 'v1.2.9' } });
		expect(r.code).toBe(1);
		expect(r.err).toContain(
			'The upgrade of "acme" to v1.3.0 failed: the instance reports version v1.2.9, not v1.3.0.'
		);
		expect(versionOf('acme')).toBe('v1.2.3');
		expect(running('acme')).toBe('v1.2.3');
	});

	it('takes what the instance says for a version that is not a released one', () => {
		h.create('acme');
		const r = h.tenant(['upgrade', 'acme', '--to', 'main'], { env: { FAKE_DOCKER_REPORTS: 'a1b2c3d' } });
		expect(r.code).toBe(0);
		expect(r.out).toContain('Note: "main" is not a released version');
		expect(r.out).toContain('"acme" is on main (the instance reports a1b2c3d).');
	});

	it('says so plainly when the tenant could not be put back, and leaves the page up', () => {
		h.create('acme');
		const r = h.tenant(['upgrade', 'acme', '--to', 'v1.3.0'], {
			env: { FAKE_DOCKER_UNHEALTHY_TAG: 'acme:v1\\.3\\.0', FAKE_DOCKER_FAIL: 'restore\\.mjs' }
		});
		expect(r.code).toBe(2);
		const [backup] = backupsOf('acme');
		expect(r.err).toContain(
			'"acme" could NOT be put back on v1.2.3. Its address shows the "being upgraded" page.'
		);
		expect(r.err).toContain(`bin/tenant restore acme --from ${backup}`);
		expect(marker('acme')).toBe(true);
		expect(route('acme')).toContain('being upgraded');
		expect(h.events().some((e) => e.includes('NOT put back'))).toBe(true);
		// The registry still names the version whose data the backup holds.
		expect(versionOf('acme')).toBe('v1.2.3');
	});
});

describe('tenant upgrade --all', () => {
	it('goes one tenant at a time, the operator’s own first, then by name', () => {
		for (const t of ['acme', 'bolt', 'zeta']) h.create(t);
		h.hostEnv(['OPERATOR_TENANT=zeta']);
		const dry = h.tenant(['upgrade', '--all', '--to', 'v1.3.0', '--dry-run']);
		expect(dry.out).toContain('Upgrading to v1.3.0, one tenant at a time: zeta acme bolt');
		expect(versionOf('zeta')).toBe('v1.2.3');

		const r = h.tenant(['upgrade', '--all', '--to', 'v1.3.0']);
		expect(r.err).toBe('');
		expect(r.code).toBe(0);
		const order = [...r.out.matchAll(/^Upgrading "(\w+)" from/gm)].map((m) => m[1]);
		expect(order).toEqual(['zeta', 'acme', 'bolt']);
		for (const t of ['acme', 'bolt', 'zeta']) {
			expect(versionOf(t)).toBe('v1.3.0');
			expect(backupsOf(t)).toHaveLength(1);
		}
		expect(r.out).toContain('All tenants are on v1.3.0.');
		// New tenants would still get the old version: the command says what to set.
		expect(r.out).toContain('New tenants still get v1.2.3: set MCP_AUDIT_TAG=v1.3.0 in host.env.');
		// One tenant is finished before the next is touched.
		const stops = h.dockerCalls().filter((c) => c === 'compose stop' || /\/health/.test(c));
		expect(stops.map((c) => (c === 'compose stop' ? 'stop' : 'check'))).toEqual([
			'stop',
			'check',
			'stop',
			'check',
			'stop',
			'check'
		]);
	});

	it('stops at the first failure: that tenant is put back, the ones after it are not touched', () => {
		for (const t of ['acme', 'bolt', 'core', 'zeta']) h.create(t);
		h.hostEnv(['OPERATOR_TENANT=zeta']);
		const r = h.tenant(['upgrade', '--all', '--to', 'v1.3.0'], broken('bolt:v1\\.3\\.0'));
		expect(r.code).toBe(1);
		expect(r.err).toContain('The upgrade of "bolt" to v1.3.0 failed: version v1.3.0 did not become healthy.');
		expect(r.err).toContain('"bolt" is back on v1.2.3, with its data as it was before the upgrade.');
		expect(r.err).toContain(
			'Stopped at "bolt". Upgraded before it: zeta acme. Not reached, still on their version: core.'
		);
		expect(versionOf('zeta')).toBe('v1.3.0');
		expect(versionOf('acme')).toBe('v1.3.0');
		expect(versionOf('bolt')).toBe('v1.2.3');
		expect(running('bolt')).toBe('v1.2.3');
		// Not reached: no backup, no restart, the version it had.
		expect(versionOf('core')).toBe('v1.2.3');
		expect(running('core')).toBe('v1.2.3');
		expect(backupsOf('core')).toEqual([]);
		expect(h.tenant(['list']).out).toMatch(/^core\s.*\sv1\.2\.3\s+active/m);
	});

	it('stops at once when the operator’s own instance fails: no tenant is touched', () => {
		for (const t of ['acme', 'ours']) h.create(t);
		h.hostEnv(['OPERATOR_TENANT=ours']);
		const r = h.tenant(['upgrade', '--all', '--to', 'v1.3.0'], broken('ours:v1\\.3\\.0'));
		expect(r.code).toBe(1);
		expect(r.err).toContain(
			'Stopped at "ours". Upgraded before it: none. Not reached, still on their version: acme.'
		);
		expect(versionOf('acme')).toBe('v1.2.3');
		expect(backupsOf('acme')).toEqual([]);
	});

	it('leaves suspended tenants on their version and skips the ones already there', () => {
		for (const t of ['acme', 'bolt', 'core']) h.create(t);
		h.tenant(['suspend', 'bolt']);
		h.tenant(['upgrade', 'core', '--to', 'v1.3.0']);
		const r = h.tenant(['upgrade', '--all', '--to', 'v1.3.0']);
		expect(r.code).toBe(0);
		expect(r.out).toContain('No OPERATOR_TENANT in host.env: this does not upgrade your own instance.');
		expect(r.out).toContain('"bolt" is suspended: it stays on v1.2.3. Upgrade it after it is resumed.');
		expect(r.out).toContain('"core" is already on v1.3.0.');
		expect(r.out).toContain('All tenants are on v1.3.0, but for the suspended: bolt.');
		expect(versionOf('acme')).toBe('v1.3.0');
		expect(versionOf('bolt')).toBe('v1.2.3');
		expect(backupsOf('core')).toHaveLength(1);
	});

	it('refuses an operator’s tenant that does not exist', () => {
		h.create('acme');
		h.hostEnv(['OPERATOR_TENANT=ours']);
		const r = h.tenant(['upgrade', '--all', '--to', 'v1.3.0']);
		expect(r.code).toBe(1);
		expect(r.err).toContain('OPERATOR_TENANT in host.env names "ours", which is no tenant here.');
		expect(versionOf('acme')).toBe('v1.2.3');
	});
});
