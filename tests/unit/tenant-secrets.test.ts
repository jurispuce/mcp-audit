import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHost } from '../fixtures/tenant-host';

/**
 * #99: no two tenants share a secret. The check is the real shell script; it reads the environment
 * files that `tenant create` wrote.
 */
let h: ReturnType<typeof makeHost>;
beforeEach(() => {
	h = makeHost(['AI_GATEWAY_MASTER_KEY_FOR_TEST=sk-host-master-key-0123456789']);
});
afterEach(() => h.cleanup());

const envFile = (name: string) => path.join(h.tenantsDir, name, '.env');
const setIn = (name: string, key: string, value: string) => {
	const lines = readFileSync(envFile(name), 'utf8')
		.split('\n')
		.filter((l) => !l.startsWith(`${key}=`));
	writeFileSync(envFile(name), [...lines.filter(Boolean), `${key}=${value}`].join('\n') + '\n');
};

describe('tenant check-secrets', () => {
	it('passes for tenants as the command creates them, and names the one secret that is shared on purpose', () => {
		for (const t of ['acme', 'bolt', 'core']) h.create(t);
		const r = h.tenant(['check-secrets']);
		expect(r.err).toBe('');
		expect(r.code).toBe(0);
		expect(r.out).toContain('Compared the environment files of 3 tenant(s)');
		expect(r.out).toContain('No secret is shared between tenants, and no tenant holds a secret of the host.');
		expect(r.out).toContain('The same for all tenants, on purpose: SMTP_PASSWORD');
		// What it compared: every tenant has secrets of its own, all different.
		const secrets = ['acme', 'bolt', 'core'].flatMap((t) => [
			h.envOf(t).BACKUP_PASSPHRASE,
			h.envOf(t).OPERATOR_TOKEN
		]);
		expect(new Set(secrets).size).toBe(6);
		// The mail account's password is the same for all, as said.
		expect(h.envOf('acme').SMTP_PASSWORD).toBe(h.envOf('bolt').SMTP_PASSWORD);
	});

	it('finds a secret copied from one tenant to another, under the same name or another, without printing it', () => {
		for (const t of ['acme', 'bolt', 'core']) h.create(t);
		const copied = h.envOf('acme').BACKUP_PASSPHRASE!;
		setIn('bolt', 'BACKUP_PASSPHRASE', copied);
		setIn('core', 'OPERATOR_TOKEN', h.envOf('acme').OPERATOR_TOKEN!);
		setIn('core', 'LITELLM_API_KEY', copied);
		const r = h.tenant(['check-secrets']);
		expect(r.code).toBe(1);
		expect(r.out).toContain('  - BACKUP_PASSPHRASE of "bolt" is the same as BACKUP_PASSPHRASE of "acme".');
		expect(r.out).toContain('  - OPERATOR_TOKEN of "core" is the same as OPERATOR_TOKEN of "acme".');
		expect(r.out).toContain('  - LITELLM_API_KEY of "core" is the same as BACKUP_PASSPHRASE of "acme".');
		expect(r.out + r.err).not.toContain(copied);
		// The overview says so too.
		const overview = h.tenant(['status', '--all']);
		expect(overview.code).toBe(3);
		expect(overview.out).toContain(
			'A secret is shared where it should not be. See: bin/tenant check-secrets'
		);
	});

	it('finds a tenant that holds a secret of the host, and an environment file others can read', () => {
		h.create('acme');
		setIn('acme', 'LITELLM_API_KEY', 'sk-host-master-key-0123456789');
		chmodSync(envFile('acme'), 0o644);
		const r = h.tenant(['check-secrets']);
		expect(r.code).toBe(1);
		expect(r.out).toContain(
			'"acme" holds a secret of the host: its LITELLM_API_KEY is the host\'s AI_GATEWAY_MASTER_KEY_FOR_TEST.'
		);
		expect(r.out).toContain(
			'The environment file of "acme" can be read by others on this server (mode 644, not 600).'
		);
		expect(r.out).not.toContain('sk-host-master-key');
	});
});
