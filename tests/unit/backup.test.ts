import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '#lib/db/client.ts';
import { addComment } from '#lib/domain/comments.ts';
import { createFirstAdmin } from '#lib/domain/users.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PASS = 'a long backup passphrase';

function run(script: string, args: string[], env: Record<string, string>) {
	return new Promise<{ code: number; stderr: string }>((resolve) => {
		const child = spawn(process.execPath, [path.join(ROOT, 'scripts', script), ...args], {
			env: { ...process.env, ...env },
			stdio: ['ignore', 'ignore', 'pipe']
		});
		let stderr = '';
		child.stderr.on('data', (d) => (stderr += d));
		child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
	});
}

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

let dir: string;
let source: string;
let app: AppDatabase;
let adminId: string;

beforeEach(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'mcpa-backup-test-'));
	source = path.join(dir, 'source');
	app = openDatabase({ path: path.join(source, 'app.db') });
	adminId = (
		await createFirstAdmin(app, { name: 'Ada', email: 'ada@example.test', password: 'correct horse battery' })
	).id;
	mkdirSync(path.join(source, 'files', 'ab'), { recursive: true });
	writeFileSync(path.join(source, 'files', 'ab', 'abcdef'), 'evidence file contents');
});

afterEach(() => {
	app.close();
	rmSync(dir, { recursive: true, force: true });
});

describe('backup and restore (#22)', () => {
	it('backs up while the app keeps writing, and restores into an empty data directory', async () => {
		const archive = path.join(dir, 'backup.mcpa');
		const actor = { userId: adminId, channel: 'ui' as const };
		let writes = 0;
		const writer = setInterval(() => {
			addComment(app, actor, 'user', adminId, `note ${writes++}`);
		}, 2);

		const backup = await run('backup.mjs', ['--out', archive], { DATA_DIR: source, BACKUP_PASSPHRASE: PASS });
		clearInterval(writer);
		expect(backup.code, backup.stderr).toBe(0);
		expect(writes).toBeGreaterThan(0);
		expect(readFileSync(archive).subarray(0, 8).toString()).toBe('MCPABK1\n');
		expect(readFileSync(archive).includes(Buffer.from('evidence file contents'))).toBe(false);

		const target = path.join(dir, 'target');
		const restore = await run('restore.mjs', ['--in', archive], {
			DATA_DIR: target,
			BACKUP_PASSPHRASE: PASS
		});
		expect(restore.code, restore.stderr).toBe(0);

		const restored = openDatabase({ path: path.join(target, 'app.db') });
		try {
			expect(restored.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
			expect(restored.sqlite.prepare('SELECT email FROM "user"').all()).toEqual([
				{ email: 'ada@example.test' }
			]);
			const comments = (restored.sqlite.prepare('SELECT count(*) AS n FROM comment').get() as { n: number })
				.n;
			expect(comments).toBeGreaterThanOrEqual(0);
			expect(comments).toBeLessThanOrEqual(writes);
		} finally {
			restored.close();
		}
		expect(sha(path.join(target, 'files', 'ab', 'abcdef'))).toBe(
			sha(path.join(source, 'files', 'ab', 'abcdef'))
		);
	});

	it('refuses a wrong passphrase and an altered file', async () => {
		const archive = path.join(dir, 'backup.mcpa');
		expect(
			(await run('backup.mjs', ['--out', archive], { DATA_DIR: source, BACKUP_PASSPHRASE: PASS })).code
		).toBe(0);
		const wrong = await run('restore.mjs', ['--in', archive], {
			DATA_DIR: path.join(dir, 't1'),
			BACKUP_PASSPHRASE: 'another long passphrase'
		});
		expect(wrong.code).toBe(1);
		expect(wrong.stderr).toContain('wrong BACKUP_PASSPHRASE');

		const bytes = readFileSync(archive);
		bytes.writeUInt8(bytes.readUInt8(bytes.length - 40) ^ 0xff, bytes.length - 40);
		const altered = path.join(dir, 'altered.mcpa');
		writeFileSync(altered, bytes);
		const tampered = await run('restore.mjs', ['--in', altered], {
			DATA_DIR: path.join(dir, 't2'),
			BACKUP_PASSPHRASE: PASS
		});
		expect(tampered.code).toBe(1);
		expect(existsSync(path.join(dir, 't2', 'app.db'))).toBe(false);
	});

	it('needs a passphrase of at least 12 characters', async () => {
		const res = await run('backup.mjs', ['--out', path.join(dir, 'x.mcpa')], {
			DATA_DIR: source,
			BACKUP_PASSPHRASE: 'short'
		});
		expect(res.code).toBe(1);
		expect(res.stderr).toContain('BACKUP_PASSPHRASE');
	});

	it('does not overwrite existing data without --force, and keeps the old data aside with it', async () => {
		const archive = path.join(dir, 'backup.mcpa');
		expect(
			(await run('backup.mjs', ['--out', archive], { DATA_DIR: source, BACKUP_PASSPHRASE: PASS })).code
		).toBe(0);
		app.close();
		const refused = await run('restore.mjs', ['--in', archive], {
			DATA_DIR: source,
			BACKUP_PASSPHRASE: PASS
		});
		expect(refused.code).toBe(1);
		expect(refused.stderr).toContain('--force');

		const forced = await run('restore.mjs', ['--in', archive, '--force'], {
			DATA_DIR: source,
			BACKUP_PASSPHRASE: PASS
		});
		expect(forced.code, forced.stderr).toBe(0);
		const aside = readdirSync(source).filter((n) => n.startsWith('pre-restore-'));
		expect(aside).toHaveLength(1);
		expect(existsSync(path.join(source, aside[0]!, 'app.db'))).toBe(true);
		app = openDatabase({ path: path.join(source, 'app.db') });
	});
});
