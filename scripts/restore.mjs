#!/usr/bin/env node
// Restore a backup made by backup.mjs into DATA_DIR. Stop the app first.
//
//   docker compose stop app
//   docker compose run --rm -v "$PWD/backups:/backups" app node scripts/restore.mjs --in /backups/x.mcpa --force
//   docker compose start app
//
// Needs BACKUP_PASSPHRASE. Refuses to overwrite existing data unless --force is given; the data it
// replaces is moved to DATA_DIR/pre-restore-<time>/ rather than deleted.
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { decryptFile, passphraseFromEnv } from './backup-format.mjs';

/** @param {string} name */
function arg(name) {
	const i = process.argv.indexOf(name);
	return i > -1 ? process.argv[i + 1] : undefined;
}

const dataDir = path.resolve(process.env.DATA_DIR ?? 'data');
const input = arg('--in');
const force = process.argv.includes('--force');

if (!input) {
	console.error('Give --in <backup file>.');
	process.exit(2);
}

try {
	const passphrase = passphraseFromEnv();
	if (!existsSync(input)) throw new Error(`No file at ${input}.`);
	mkdirSync(dataDir, { recursive: true });
	const hasData = existsSync(path.join(dataDir, 'app.db'));
	if (hasData && !force) {
		throw new Error(`${dataDir} already holds data. Stop the app and run again with --force to replace it.`);
	}

	// Work inside the data volume so the final move is a rename on one filesystem.
	const work = mkdtempSync(path.join(dataDir, '.restore-'));
	try {
		const tarball = path.join(work, 'backup.tar.gz');
		await decryptFile(input, tarball, passphrase);
		const stage = path.join(work, 'stage');
		mkdirSync(stage);
		execFileSync('tar', ['-xzf', tarball, '-C', stage, '--no-same-owner']);

		const manifest = JSON.parse(readFileSync(path.join(stage, 'backup.json'), 'utf8'));
		if (manifest.format !== 'mcp-audit-backup/1')
			throw new Error(`Unknown backup format ${manifest.format}.`);
		const check = new Database(path.join(stage, 'app.db'), { readonly: true });
		const integrity = check.pragma('integrity_check', { simple: true });
		check.close();
		if (integrity !== 'ok')
			throw new Error(`The database in the backup failed its integrity check: ${integrity}`);

		if (hasData) {
			const aside = path.join(dataDir, `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`);
			mkdirSync(aside);
			for (const name of ['app.db', 'app.db-wal', 'app.db-shm', 'files']) {
				if (existsSync(path.join(dataDir, name)))
					renameSync(path.join(dataDir, name), path.join(aside, name));
			}
			console.error(`Previous data moved to ${aside}`);
		}
		renameSync(path.join(stage, 'app.db'), path.join(dataDir, 'app.db'));
		renameSync(path.join(stage, 'files'), path.join(dataDir, 'files'));
		console.error(
			`Restored backup from ${manifest.createdAt} (app ${manifest.appVersion}, ${manifest.files} files) into ${dataDir}. Start the app; newer migrations run automatically.`
		);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
} catch (e) {
	console.error(`Restore failed: ${e instanceof Error ? e.message : e}`);
	process.exit(1);
}
