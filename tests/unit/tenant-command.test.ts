import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseProfile } from '#lib/domain/tenant-profile.ts';

/**
 * #94: the tenant command, run for real (it is a shell script) against a scripted stand-in for
 * docker that records every call and fails where a test asks it to.
 */

const REPO = path.resolve(import.meta.dirname, '../..');
let root: string;
let hostDir: string;
let tenantsDir: string;
let log: string;

const HOST_ENV = [
	'TENANT_ADDRESS_PATTERN=mcpaudit-{tenant}.example.test',
	'MCP_AUDIT_TAG=v1.2.3',
	'TENANT_SOURCES=nis2',
	'TENANT_SMTP_HOST=smtp.example.test',
	'TENANT_SMTP_USER=operator',
	'TENANT_SMTP_PASSWORD=smtp-secret',
	'TENANT_SMTP_FROM={title} <audit@example.test>'
];
const CLOUDFLARE = [
	'CLOUDFLARE_API_TOKEN=cf-token',
	'CLOUDFLARE_ZONE_ID=zone',
	'CLOUDFLARE_TUNNEL_ID=tunnel'
];

function hostEnv(extra: string[] = []) {
	writeFileSync(
		path.join(hostDir, 'host.env'),
		[...HOST_ENV, `TENANTS_DIR=${tenantsDir}`, `BACKUPS_DIR=${path.join(root, 'backups')}`, ...extra].join(
			'\n'
		) + '\n'
	);
}

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'tenant-cmd-'));
	hostDir = path.join(root, 'host');
	tenantsDir = path.join(root, 'tenants');
	log = path.join(root, 'docker.log');
	cpSync(path.join(REPO, 'deploy/host'), hostDir, { recursive: true });
	rmSync(path.join(hostDir, 'registry'), { recursive: true, force: true });
	for (const f of readdirSync(path.join(hostDir, 'tenants')))
		if (f.endsWith('.caddy')) rmSync(path.join(hostDir, 'tenants', f));
	mkdirSync(path.join(root, 'bin'));
	symlinkSync(path.join(REPO, 'tests/fixtures/fake-docker.sh'), path.join(root, 'bin/docker'));
	chmodSync(path.join(REPO, 'tests/fixtures/fake-docker.sh'), 0o755);
	writeFileSync(log, '');
	hostEnv();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function tenant(args: string[], opts: { env?: Record<string, string>; input?: string } = {}) {
	const r = spawnSync('bash', [path.join(hostDir, 'bin/tenant'), ...args], {
		encoding: 'utf8',
		input: opts.input ?? '',
		env: {
			PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
			HOME: root,
			FAKE_DOCKER_LOG: log,
			FAKE_DOCKER_STATE: path.join(root, 'state'),
			FAKE_DOCKER_REPO: REPO,
			TENANT_POLL_SECONDS: '0',
			...opts.env
		}
	});
	return { code: r.status, out: r.stdout, err: r.stderr };
}
const dockerCalls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);
const create = (name: string, extra: string[] = [], opts = {}) =>
	tenant(
		['create', name, '--title', `${name} audit`, '--admin-email', `admin@${name}.example.test`, ...extra],
		opts
	);
const envOf = (name: string) =>
	Object.fromEntries(
		readFileSync(path.join(tenantsDir, name, '.env'), 'utf8')
			.split('\n')
			.filter((l) => l && !l.startsWith('#'))
			.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
	);
const meta = (name: string) => readFileSync(path.join(hostDir, 'registry', `${name}.meta`), 'utf8');
const nothingLeft = (name: string) => {
	expect(existsSync(path.join(tenantsDir, name))).toBe(false);
	expect(existsSync(path.join(hostDir, 'registry', `${name}.meta`))).toBe(false);
	expect(existsSync(path.join(hostDir, 'tenants', `${name}.caddy`))).toBe(false);
};

describe('tenant create', () => {
	it('checks the name before anything else', () => {
		const cases: [string, string][] = [
			['Acme', 'lower-case letters, digits or hyphens'],
			['acme-', 'lower-case letters, digits or hyphens'],
			['acme_co', 'lower-case letters, digits or hyphens'],
			['a'.repeat(33), 'lower-case letters, digits or hyphens'],
			['www', '"www" is a reserved name'],
			['admin', '"admin" is a reserved name'],
			['mail', '"mail" is a reserved name']
		];
		for (const [name, message] of cases) {
			const r = create(name);
			expect(r.code, name).not.toBe(0);
			expect(r.err, name).toContain(message);
		}
		expect(create('acme').code).toBe(0);
		const again = create('acme');
		expect(again.code).not.toBe(0);
		expect(again.err).toContain('There is already a tenant "acme" (active).');
		// Refusals touch nothing: only the one real create called docker.
		expect(dockerCalls().filter((c) => c.startsWith('compose up'))).toHaveLength(1);
		expect(readdirSync(tenantsDir)).toEqual(['acme']);
	});

	it('checks what it is given, and what the host must have', () => {
		expect(tenant(['create', 'acme', '--admin-email', 'a@b.test']).err).toContain(
			'The title (--title) is empty.'
		);
		expect(tenant(['create', 'acme', '--title', 'x'.repeat(61), '--admin-email', 'a@b.test']).err).toContain(
			'longer than 60'
		);
		expect(tenant(['create', 'acme', '--title', 'Acme', '--admin-email', 'not-an-address']).err).toContain(
			'--admin-email is not an email address'
		);
		expect(create('acme', ['--version', 'no spaces']).err).toContain('--version is not an image tag');
		expect(create('acme', ['--sources', 'NIS2;rm']).err).toContain('--sources is a comma-separated list');
		writeFileSync(
			path.join(hostDir, 'host.env'),
			`TENANT_ADDRESS_PATTERN=mcpaudit-{tenant}.example.test\nTENANTS_DIR=${tenantsDir}\n`
		);
		expect(create('acme').err).toContain('Set TENANT_SMTP_HOST and TENANT_SMTP_FROM in host.env');
		expect(dockerCalls()).toEqual([]);
		expect(existsSync(tenantsDir)).toBe(false);
	});

	it('writes the directory, starts the instance, routes it and says where it is', () => {
		hostEnv(CLOUDFLARE);
		const r = tenant([
			'create',
			'acme',
			'--title',
			'Acme "Audit" & Co: Rīga',
			'--admin-email',
			'Ina@Acme.example.test',
			'--admin-name',
			'Ina Bērziņa',
			'--sources',
			'nis2'
		]);
		expect(r.err).toBe('');
		expect(r.code).toBe(0);
		expect(r.out).toContain('Tenant "acme" is running at https://mcpaudit-acme.example.test');
		expect(r.out).toContain("The instance has emailed the first admin's invitation to Ina@Acme.example.test");
		expect(r.out).toContain('skipped: the AI key and budget (#95 is not built yet)');

		const dir = path.join(tenantsDir, 'acme');
		// Readable by the operator only; the profile is read by the container and holds no secret.
		expect(statSync(dir).mode & 0o777).toBe(0o700);
		expect(statSync(path.join(dir, '.env')).mode & 0o777).toBe(0o600);
		expect(statSync(path.join(dir, 'tenant-profile.yaml')).mode & 0o777).toBe(0o644);
		expect(readFileSync(path.join(dir, 'docker-compose.yml'), 'utf8')).toBe(
			readFileSync(path.join(REPO, 'deploy/host/tenant/docker-compose.yml'), 'utf8')
		);
		expect(envOf('acme')).toMatchObject({
			TENANT: 'acme',
			TENANT_HOST: 'mcpaudit-acme.example.test',
			MCP_AUDIT_TAG: 'v1.2.3',
			SMTP_HOST: 'smtp.example.test',
			SMTP_FROM: 'Acme Audit & Co: Rīga <audit@example.test>'
		});
		// The instance accepts the profile as written, whatever is in the title.
		const profile = parseProfile(
			parseYaml(readFileSync(path.join(dir, 'tenant-profile.yaml'), 'utf8')),
			'tenant-profile.yaml'
		);
		expect(profile).toMatchObject({
			instanceName: 'Acme "Audit" & Co: Rīga',
			signInMethod: 'passkey',
			firstAdmin: { name: 'Ina Bērziņa', email: 'ina@acme.example.test' },
			ai: null
		});
		expect(profile.librarySources.map((s) => s.code)).toEqual(['nis2']);

		// In order: start, wait, route, DNS. The command never runs anything inside the instance.
		const calls = dockerCalls();
		const at = (re: RegExp) => calls.findIndex((c) => re.test(c));
		expect(at(/^compose up -d$/)).toBe(0);
		expect(at(/^inspect -f .* mcp-audit-tenant-acme$/)).toBeGreaterThan(0);
		expect(at(/caddy reload/)).toBeGreaterThan(at(/^inspect/));
		expect(at(/cloudflare-dns\.mjs add mcpaudit-acme\.example\.test$/)).toBeGreaterThan(at(/caddy reload/));
		expect(calls.some((c) => c.startsWith('exec mcp-audit-tenant-acme'))).toBe(false);
		expect(readFileSync(path.join(hostDir, 'tenants/acme.caddy'), 'utf8')).toContain(
			'import tenant mcp-audit-tenant-acme'
		);
	});

	it('gives every tenant its own secrets, and keeps them out of the registry', () => {
		expect(create('acme').code).toBe(0);
		expect(create('bolt', ['--version', 'v2.0.0']).code).toBe(0);
		const a = envOf('acme').BACKUP_PASSPHRASE!;
		const b = envOf('bolt').BACKUP_PASSPHRASE!;
		expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(b).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(a).not.toBe(b);
		expect(envOf('bolt').MCP_AUDIT_TAG).toBe('v2.0.0');

		const registry = readdirSync(path.join(hostDir, 'registry'))
			.filter((f) => !f.startsWith('.'))
			.map((f) => readFileSync(path.join(hostDir, 'registry', f), 'utf8'))
			.join('\n');
		for (const secret of [a, b, 'smtp-secret', 'admin@acme.example.test'])
			expect(registry).not.toContain(secret);
		expect(meta('acme')).toMatch(
			/^name=acme\ntitle=acme audit\nhost=mcpaudit-acme\.example\.test\nversion=v1\.2\.3\ncreated=\d{4}-\d\d-\d\dT[\d:]+Z\nstate=active\n$/
		);
	});

	it('--dry-run prints what it would do and changes nothing', () => {
		hostEnv(CLOUDFLARE);
		const r = create('acme', ['--dry-run']);
		expect(r.code).toBe(0);
		expect(r.out).toContain(
			'Creating tenant "acme" (acme audit) at https://mcpaudit-acme.example.test, version v1.2.3'
		);
		expect(r.out).toContain('would: write');
		expect(r.out).toContain('would: start the container mcp-audit-tenant-acme and wait until it is healthy');
		expect(r.out).toContain('would: add the route in the internal proxy');
		expect(r.out).toContain('would: add the DNS record mcpaudit-acme.example.test');
		expect(r.out).toContain('Nothing was changed (--dry-run).');
		expect(dockerCalls()).toEqual([]);
		expect(existsSync(tenantsDir)).toBe(false);
		expect(existsSync(path.join(hostDir, 'registry', 'acme.meta'))).toBe(false);
	});

	describe('a failed create leaves nothing half-made, and names the step', () => {
		const failures: [string, Record<string, string>, string, boolean][] = [
			[
				'starting the container',
				{ FAKE_DOCKER_FAIL: '^compose up' },
				'start the container mcp-audit-tenant-acme and wait until it is healthy',
				true
			],
			[
				'the instance not becoming healthy',
				{ FAKE_DOCKER_UNHEALTHY: '1' },
				'start the container mcp-audit-tenant-acme and wait until it is healthy',
				true
			],
			[
				'the proxy refusing the route',
				{ FAKE_DOCKER_FAIL: 'caddy reload' },
				'add the route in the internal proxy',
				true
			],
			[
				'Cloudflare refusing the DNS record',
				{ FAKE_DOCKER_FAIL: 'cloudflare-dns.mjs add' },
				'add the DNS record mcpaudit-acme.example.test',
				true
			]
		];
		for (const [what, env, step, started] of failures) {
			it(what, () => {
				hostEnv(CLOUDFLARE);
				const r = create('acme', [], { env });
				expect(r.code).toBe(1);
				expect(r.err).toContain(`Create failed at: ${step}. Removing what was made.`);
				expect(r.err).toContain(`Nothing of "acme" is left. The step that failed: ${step}.`);
				expect(r.out).not.toContain('is running at');
				nothingLeft('acme');
				if (started) expect(dockerCalls()).toContain('compose down -v --remove-orphans');
				expect(existsSync(path.join(root, 'state', 'mcp-audit-tenant-acme'))).toBe(false);
				// The name is free again.
				expect(create('acme').code).toBe(0);
			});
		}

		it('the instance’s own reason is shown when it refuses to start', () => {
			const r = create('acme', ['--sources', 'nope'], { env: { FAKE_DOCKER_UNHEALTHY: '1' } });
			expect(r.err).toContain('The instance did not become healthy. Its last lines:');
			expect(r.err).toContain('library_sources.0: "nope" is not a source that ships with the app.');
			nothingLeft('acme');
		});

		it('writing the directory', () => {
			// The tenants directory cannot be made: its parent is a file.
			writeFileSync(path.join(root, 'blocked'), '');
			writeFileSync(
				path.join(hostDir, 'host.env'),
				[...HOST_ENV, `TENANTS_DIR=${path.join(root, 'blocked', 'tenants')}`].join('\n') + '\n'
			);
			const r = create('acme');
			expect(r.code).toBe(1);
			expect(r.err).toContain('Create failed at: write');
			expect(existsSync(path.join(hostDir, 'registry', 'acme.meta'))).toBe(false);
			expect(dockerCalls().some((c) => c.startsWith('compose up'))).toBe(false);
		});

		it('a DNS record that was added is removed again when a later step fails', () => {
			// Nothing comes after DNS today, so the removal is shown through the delete path below;
			// here: a DNS failure never leaves a record, because none was made.
			hostEnv(CLOUDFLARE);
			create('acme', [], { env: { FAKE_DOCKER_FAIL: 'cloudflare-dns.mjs add' } });
			expect(dockerCalls().some((c) => /cloudflare-dns\.mjs remove/.test(c))).toBe(false);
		});
	});
});

describe('tenant list and status', () => {
	it('show names, titles, addresses, versions, states and dates', () => {
		create('acme');
		create('bolt', ['--version', 'v2.0.0']);
		tenant(['suspend', 'bolt']);
		const list = tenant(['list']);
		expect(list.code).toBe(0);
		const rows = list.out.trim().split('\n');
		expect(rows[0]).toMatch(/^NAME\s+TITLE\s+ADDRESS\s+VERSION\s+STATE\s+CREATED$/);
		expect(rows[1]).toMatch(
			/^acme\s+acme audit\s+https:\/\/mcpaudit-acme\.example\.test\s+v1\.2\.3\s+active\s+\d{4}-\d\d-\d\d$/
		);
		expect(rows[2]).toMatch(
			/^bolt\s+bolt audit\s+https:\/\/mcpaudit-bolt\.example\.test\s+v2\.0\.0\s+suspended\s+\d{4}-\d\d-\d\d$/
		);

		const status = tenant(['status', 'acme']).out;
		expect(status).toContain('Address:    https://mcpaudit-acme.example.test');
		expect(status).toContain('State:      active');
		expect(status).toContain(
			'Container:  mcp-audit-tenant-acme, running, healthy, image ghcr.io/jurispuce/mcp-audit:main'
		);
		expect(status).toContain('Route:      to the instance');
		expect(tenant(['status', 'bolt']).out).toContain('Route:      the suspended page');
		expect(tenant(['status', 'nobody']).err).toContain('There is no tenant "nobody".');
	});
});

describe('tenant suspend and resume', () => {
	it('stops the instance, shows a plain page at its address, and brings it back', () => {
		create('acme');
		const before = dockerCalls().length;
		expect(tenant(['suspend', 'acme', '--dry-run']).out).toContain('Nothing was changed (--dry-run).');
		expect(dockerCalls()).toHaveLength(before);
		expect(meta('acme')).toContain('state=active');

		const s = tenant(['suspend', 'acme']);
		expect(s.code).toBe(0);
		expect(dockerCalls()).toContain('compose stop');
		expect(meta('acme')).toContain('state=suspended');
		const route = readFileSync(path.join(hostDir, 'tenants/acme.caddy'), 'utf8');
		expect(route).toContain('respond "This instance is suspended.');
		expect(route).toContain('503');
		expect(route).not.toContain('import tenant');
		// The data stays.
		expect(existsSync(path.join(tenantsDir, 'acme', '.env'))).toBe(true);
		expect(dockerCalls().some((c) => c.startsWith('compose down'))).toBe(false);
		expect(tenant(['suspend', 'acme']).out).toContain('"acme" is already suspended.');

		expect(tenant(['resume', 'acme', '--dry-run']).out).toContain('Nothing was changed (--dry-run).');
		expect(meta('acme')).toContain('state=suspended');
		const r = tenant(['resume', 'acme']);
		expect(r.code).toBe(0);
		expect(r.out).toContain('"acme" is running again at https://mcpaudit-acme.example.test');
		expect(meta('acme')).toContain('state=active');
		expect(readFileSync(path.join(hostDir, 'tenants/acme.caddy'), 'utf8')).toContain(
			'import tenant mcp-audit-tenant-acme'
		);
		expect(existsSync(path.join(tenantsDir, 'acme', 'suspended'))).toBe(false);
	});

	it('a tenant that does not come back stays suspended', () => {
		create('acme');
		tenant(['suspend', 'acme']);
		const r = tenant(['resume', 'acme'], { env: { FAKE_DOCKER_UNHEALTHY: '1' } });
		expect(r.code).toBe(1);
		expect(r.err).toContain('"acme" stays suspended');
		expect(meta('acme')).toContain('state=suspended');
		expect(readFileSync(path.join(hostDir, 'tenants/acme.caddy'), 'utf8')).toContain('suspended');
	});
});

describe('tenant delete', () => {
	it('asks for the name again before anything is removed', () => {
		hostEnv(CLOUDFLARE);
		create('acme');
		const passphrase = envOf('acme').BACKUP_PASSPHRASE!;
		const dry = tenant(['delete', 'acme', '--without-export', '--dry-run']);
		expect(dry.out).toContain('would: remove the container mcp-audit-tenant-acme and its data volume');
		expect(dry.out).toContain('Nothing was changed (--dry-run).');
		for (const typed of ['', 'acme2\n', 'ACME\n']) {
			const r = tenant(['delete', 'acme', '--without-export'], { input: typed });
			expect(r.code).toBe(1);
			expect(r.err).toContain('That is not "acme". Nothing was deleted.');
		}
		expect(existsSync(path.join(tenantsDir, 'acme'))).toBe(true);
		expect(dockerCalls().some((c) => c.startsWith('compose down'))).toBe(false);

		const r = tenant(['delete', 'acme', '--without-export'], { input: 'acme\n' });
		expect(r.code).toBe(0);
		expect(r.out).toContain('Tenant "acme" is deleted.');
		nothingLeft('acme');
		const calls = dockerCalls();
		expect(calls).toContain('compose down -v --remove-orphans');
		// The proxy leaves the tenant's network first, or the network could not be removed.
		expect(calls.indexOf('network disconnect mcp-audit-tenant-acme mcp-audit-proxy')).toBeGreaterThan(0);
		expect(calls.indexOf('network disconnect mcp-audit-tenant-acme mcp-audit-proxy')).toBeLessThan(
			calls.indexOf('compose down -v --remove-orphans')
		);
		expect(calls.some((c) => /cloudflare-dns\.mjs remove mcpaudit-acme\.example\.test$/.test(c))).toBe(true);
		// A record stays: who and when, nothing of the tenant's content and no secret.
		const record = readFileSync(path.join(hostDir, 'registry/deleted.tsv'), 'utf8').trim().split('\n');
		expect(record[0]).toBe('name\ttitle\taddress\tcreated\tdeleted\tbackups_kept_until');
		expect(record[1]).toMatch(/^acme\tacme audit\thttps:\/\/mcpaudit-acme\.example\.test\t\S+Z\t\S+Z\t?$/);
		expect(record.join('\n')).not.toContain(passphrase);
		expect(tenant(['list']).out).not.toContain('acme');
		// The name can be used again.
		expect(create('acme').code).toBe(0);
	});

	it('deletes nothing when the DNS record cannot be removed', () => {
		hostEnv(CLOUDFLARE);
		create('acme');
		const r = tenant(['delete', 'acme', '--without-export'], {
			input: 'acme\n',
			env: { FAKE_DOCKER_FAIL: 'cloudflare-dns.mjs remove' }
		});
		expect(r.code).toBe(1);
		expect(r.err).toContain('The DNS record could not be removed, so nothing was deleted.');
		expect(existsSync(path.join(tenantsDir, 'acme', '.env'))).toBe(true);
		expect(meta('acme')).toContain('state=active');
	});
});

describe('the command itself', () => {
	it('explains itself, and refuses what it does not know', () => {
		expect(tenant(['help']).out).toContain('bin/tenant create <name> --title "<firm>" --admin-email <email>');
		expect(tenant(['rename', 'acme']).code).toBe(2);
		expect(tenant([]).code).toBe(2);
		expect(create('acme', ['--force']).err).toContain('Unknown option --force');
	});
});
