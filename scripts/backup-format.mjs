// Shared by backup.mjs and restore.mjs: the encrypted archive format.
//
//   "MCPABK1\n" (8 bytes) | salt (16) | iv (12) | AES-256-GCM ciphertext of a .tar.gz | auth tag (16)
//
// The key is scrypt(passphrase, salt). The archive holds app.db, files/ and backup.json.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { closeSync, createReadStream, createWriteStream, fstatSync, openSync, readSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export const MAGIC = Buffer.from('MCPABK1\n');
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

export function passphraseFromEnv() {
	const p = process.env.BACKUP_PASSPHRASE ?? '';
	if (p.length < 12) {
		throw new Error(
			'Set BACKUP_PASSPHRASE (at least 12 characters). Keep it outside the server, for example in a password manager.'
		);
	}
	return p;
}

/**
 * Encrypt `inputPath` into `output` (a path or a writable stream).
 * @param {string} inputPath
 * @param {string | NodeJS.WritableStream} output
 * @param {string} passphrase
 */
export async function encryptFile(inputPath, output, passphrase) {
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const key = scryptSync(passphrase, salt, 32, SCRYPT);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const out = typeof output === 'string' ? createWriteStream(output, { mode: 0o600 }) : output;
	out.write(Buffer.concat([MAGIC, salt, iv]));
	await pipeline(createReadStream(inputPath), cipher, out, { end: false });
	await /** @type {Promise<void>} */ (
		new Promise((resolve, reject) => out.write(cipher.getAuthTag(), (e) => (e ? reject(e) : resolve())))
	);
	if (out !== process.stdout) await /** @type {Promise<void>} */ (new Promise((resolve) => out.end(resolve)));
}

/**
 * Decrypt an archive file into `outputPath`. Throws if the passphrase is wrong or the file was altered.
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {string} passphrase
 */
export async function decryptFile(inputPath, outputPath, passphrase) {
	const fd = openSync(inputPath, 'r');
	const size = fstatSync(fd).size;
	const header = Buffer.alloc(MAGIC.length + 28);
	const tag = Buffer.alloc(16);
	try {
		if (size < header.length + tag.length) throw new Error('This is not an mcp-audit backup (too short).');
		readSync(fd, header, 0, header.length, 0);
		readSync(fd, tag, 0, 16, size - 16);
	} finally {
		closeSync(fd);
	}
	if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('This is not an mcp-audit backup.');
	const salt = header.subarray(MAGIC.length, MAGIC.length + 16);
	const iv = header.subarray(MAGIC.length + 16, MAGIC.length + 28);
	const key = scryptSync(passphrase, salt, 32, SCRYPT);
	const decipher = createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(tag);
	try {
		await pipeline(
			createReadStream(inputPath, { start: header.length, end: size - 17 }),
			decipher,
			createWriteStream(outputPath, { mode: 0o600 })
		);
	} catch {
		throw new Error(
			'Could not decrypt the backup: wrong BACKUP_PASSPHRASE, or the file is damaged or was altered.'
		);
	}
}
