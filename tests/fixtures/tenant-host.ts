import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * A tenant host in a temporary directory, for tests of the host's commands (#94, #96): a copy of
 * deploy/host, and a scripted `docker` on the PATH (tests/fixtures/fake-docker.sh) that records every
 * call and fails where a test asks it to. The commands themselves are the real shell scripts.
 */
export const REPO = path.resolve(import.meta.dirname, '../..');

export function makeHost(extraEnv: string[] = []) {
	const root = mkdtempSync(path.join(tmpdir(), 'tenant-host-'));
	const hostDir = path.join(root, 'host');
	const tenantsDir = path.join(root, 'tenants');
	const backupsDir = path.join(root, 'backups');
	const exportsDir = path.join(root, 'exports');
	const log = path.join(root, 'docker.log');
	const state = path.join(root, 'state');
	cpSync(path.join(REPO, 'deploy/host'), hostDir, { recursive: true });
	rmSync(path.join(hostDir, 'registry'), { recursive: true, force: true });
	rmSync(path.join(hostDir, 'host.env'), { force: true });
	for (const f of readdirSync(path.join(hostDir, 'tenants')))
		if (f.endsWith('.caddy')) rmSync(path.join(hostDir, 'tenants', f));
	mkdirSync(path.join(root, 'bin'));
	chmodSync(path.join(REPO, 'tests/fixtures/fake-docker.sh'), 0o755);
	symlinkSync(path.join(REPO, 'tests/fixtures/fake-docker.sh'), path.join(root, 'bin/docker'));
	writeFileSync(log, '');

	const base = [
		'TENANT_ADDRESS_PATTERN=mcpaudit-{tenant}.example.test',
		'MCP_AUDIT_TAG=v1.2.3',
		'TENANT_SOURCES=nis2',
		'TENANT_SMTP_HOST=smtp.example.test',
		'TENANT_SMTP_USER=operator',
		'TENANT_SMTP_PASSWORD=smtp-secret',
		'TENANT_SMTP_FROM={title} <audit@example.test>',
		`TENANTS_DIR=${tenantsDir}`,
		`BACKUPS_DIR=${backupsDir}`
	];
	const hostEnv = (extra: string[] = []) =>
		writeFileSync(path.join(hostDir, 'host.env'), [...base, ...extraEnv, ...extra].join('\n') + '\n');
	hostEnv();

	function tenant(args: string[], opts: { env?: Record<string, string>; input?: string } = {}) {
		const r = spawnSync('bash', [path.join(hostDir, 'bin/tenant'), ...args], {
			encoding: 'utf8',
			input: opts.input ?? '',
			env: {
				PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
				HOME: root,
				FAKE_DOCKER_LOG: log,
				FAKE_DOCKER_STATE: state,
				FAKE_DOCKER_REPO: REPO,
				TENANT_POLL_SECONDS: '0',
				...opts.env
			}
		});
		return { code: r.status, out: r.stdout, err: r.stderr };
	}

	return {
		root,
		hostDir,
		tenantsDir,
		backupsDir,
		exportsDir,
		state,
		hostEnv,
		tenant,
		create: (name: string, extra: string[] = [], opts = {}) =>
			tenant(
				['create', name, '--title', `${name} audit`, '--admin-email', `admin@${name}.example.test`, ...extra],
				opts
			),
		dockerCalls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
		envOf: (name: string, dir = path.join(tenantsDir, name)): Record<string, string> =>
			Object.fromEntries(
				readFileSync(path.join(dir, '.env'), 'utf8')
					.split('\n')
					.filter((l) => l && !l.startsWith('#'))
					.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
			),
		meta: (name: string) => readFileSync(path.join(hostDir, 'registry', `${name}.meta`), 'utf8'),
		events: () =>
			readFileSync(path.join(hostDir, 'registry/events.tsv'), 'utf8')
				.trim()
				.split('\n')
				.slice(1)
				.map((l) => l.split('\t').slice(1).join(' ').trim()),
		cleanup: () => rmSync(root, { recursive: true, force: true })
	};
}
