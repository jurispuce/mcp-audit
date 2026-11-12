#!/usr/bin/env node
// Consistent, encrypted backup of the data volume while the app runs.
//
//   node scripts/backup.mjs --out /backups/mcp-audit-2026-11-12.mcpa
//   docker compose exec -T app node scripts/backup.mjs --out - > mcp-audit-$(date +%F).mcpa
//
// Needs BACKUP_PASSPHRASE. The database is copied with SQLite's online backup API (safe while the
// app writes), then the files folder. Files are written before the database row that points to
// them, so every file the copied database refers to is in the backup.
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encryptFile, passphraseFromEnv } from './backup-format.mjs';

/** @param {string} name */
function arg(name) {
	const i = process.argv.indexOf(name);
	return i > -1 ? process.argv[i + 1] : undefined;
}

/** @param {string} dir @returns {number} */
function countFiles(dir) {
	if (!existsSync(dir)) return 0;
	let n = 0;
	for (const name of readdirSync(dir)) {
		const full = path.join(dir, name);
		n += statSync(full).isDirectory() ? countFiles(full) : 1;
	}
	return n;
}

const dataDir = path.resolve(process.env.DATA_DIR ?? 'data');
const out = arg('--out') ?? (process.stdout.isTTY ? undefined : '-');
if (!out) {
	console.error('Give --out <file>, or --out - to write to standard output.');
	process.exit(2);
}

try {
	const passphrase = passphraseFromEnv();
	const dbPath = path.join(dataDir, 'app.db');
	if (!existsSync(dbPath)) throw new Error(`No database at ${dbPath}. Is DATA_DIR right?`);

	const work = mkdtempSync(path.join(tmpdir(), 'mcpa-backup-'));
	try {
		const stage = path.join(work, 'stage');
		mkdirSync(stage);

		const source = new Database(dbPath, { readonly: true, fileMustExist: true });
		source.pragma('busy_timeout = 10000');
		await source.backup(path.join(stage, 'app.db'));
		const migrations = (() => {
			try {
				const row = /** @type {{ n: number }} */ (
					source.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()
				);
				return row.n;
			} catch {
				return 0;
			}
		})();
		source.close();

		const filesDir = path.join(dataDir, 'files');
		if (existsSync(filesDir)) cpSync(filesDir, path.join(stage, 'files'), { recursive: true });
		else mkdirSync(path.join(stage, 'files'));

		const manifest = {
			format: 'mcp-audit-backup/1',
			createdAt: new Date().toISOString(),
			appVersion: process.env.APP_VERSION ?? 'dev',
			migrations,
			files: countFiles(path.join(stage, 'files'))
		};
		writeFileSync(path.join(stage, 'backup.json'), JSON.stringify(manifest, null, 2));

		const tarball = path.join(work, 'backup.tar.gz');
		execFileSync('tar', ['-czf', tarball, '-C', stage, 'backup.json', 'app.db', 'files']);
		await encryptFile(tarball, out === '-' ? process.stdout : out, passphrase);
		console.error(
			`Backup written${out === '-' ? ' to standard output' : ` to ${out}`}: ${manifest.files} files, ${migrations} migrations, ${manifest.createdAt}`
		);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
} catch (e) {
	console.error(`Backup failed: ${e instanceof Error ? e.message : e}`);
	process.exit(1);
}
