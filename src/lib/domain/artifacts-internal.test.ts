import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { searchText } from '#lib/db/fts.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { makeDocx, makePdf } from '../../../tests/fixtures/make-docs';
import './entities';
import {
	addMentionedDocument,
	extractText,
	filePath,
	getArtifact,
	getArtifactText,
	listArtifacts,
	registerTextArtifact,
	removeArtifact,
	sha256,
	updateArtifact,
	uploadArtifacts
} from './artifacts';
import { uploadNewVersion } from './document-versions';
import { createEngagement, getEngagement, updateEngagement } from './engagements';
import { ForbiddenError, ValidationError } from './errors';
import { assertCanReadRequirement, assertItemReadable } from './guards';
import {
	acceptAllInternal,
	acceptInternal,
	addInternal,
	carryOverCandidates,
	getInternal,
	listInternal,
	rejectInternal,
	setImplements,
	updateInternal
} from './internal';
import { addLink, findRequirement, getSourceByCode, listSources, searchRequirements } from './library';
import { importBuiltInSource } from './library-import';
import { getItemHistory as getHistory } from './items';
import { selectRequirements } from './selection';
import { createFirstAdmin } from './users';
import type { Actor } from './write';

let app: AppDatabase;
let human: Actor;
let ai: Actor;
let files: string;

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	human = { userId: a.id, channel: 'ui' };
	ai = { userId: a.id, agent: 'Claude', channel: 'mcp' };
	importBuiltInSource(
		app,
		human,
		'nis2-art21.yaml',
		path.resolve(import.meta.dirname, '../../../seed/library')
	);
	files = mkdtempSync(path.join(tmpdir(), 'mcpa-files-'));
});
afterEach(() => {
	app.close();
	rmSync(files, { recursive: true, force: true });
});

const nis2 = (point: string) =>
	findRequirement(app, getSourceByCode(app, 'nis2')!.id, `Art. 21(2)(${point})`)!;
const engagement = (auditeeName = 'Baltic Freight SIA', name = 'NIS 2 audit') =>
	createEngagement(app, human, { name, auditeeName, startDate: '2026-11-16' });
const text = (s: string) => new TextEncoder().encode(s);

describe('document upload and text extraction (#41)', () => {
	it('stores each file once under its SHA-256 and reports duplicates instead of adding them', async () => {
		const e = engagement();
		const bytes = text('Backups are made daily.');
		const [first, second] = await uploadArtifacts(app, human, files, e.id, [
			{ name: 'backup.txt', type: 'text/plain', bytes },
			{ name: 'notes.md', type: '', bytes: text('# Notes\nNothing yet.') }
		]);
		expect(first!.artifact).toMatchObject({
			filename: 'backup.txt',
			title: null,
			kind: null,
			state: 'received',
			textStatus: 'extracted'
		});
		expect(second!.artifact!.textStatus).toBe('extracted');
		const hash = sha256(bytes);
		expect(first!.artifact!.fileHash).toBe(hash);
		expect(readFileSync(filePath(files, hash), 'utf8')).toBe('Backups are made daily.');

		const [dup] = await uploadArtifacts(app, human, files, e.id, [
			{ name: 'copy.txt', type: 'text/plain', bytes }
		]);
		expect(dup).toMatchObject({ artifact: null, duplicateOf: { id: first!.artifact!.id } });
		expect(listArtifacts(app, e.id)).toHaveLength(2);

		// The same file in another engagement is a new artifact pointing at the same stored file.
		const other = engagement('Other Client SIA', 'Other audit');
		const [again] = await uploadArtifacts(app, human, files, other.id, [
			{ name: 'b.txt', type: 'text/plain', bytes }
		]);
		expect(again!.artifact!.fileHash).toBe(hash);
	});

	it('extracts PDF text with page locators, DOCX text, and marks other files', async () => {
		const pdf = await extractText(
			makePdf(['Access is reviewed every six months.', 'Leavers are disabled within one day.']),
			'policy.pdf'
		);
		expect(pdf.status).toBe('extracted');
		expect(pdf.text).toContain('six months');
		expect(pdf.pageStarts).toHaveLength(2);
		const docx = await extractText(
			await makeDocx(['Backup procedure', 'A restore test is done once a year.']),
			'backup.docx'
		);
		expect(docx).toMatchObject({ status: 'extracted' });
		expect(docx.text).toContain('restore test');
		expect((await extractText(new Uint8Array([1, 2, 3]), 'photo.jpg')).status).toBe('unsupported');
		expect((await extractText(text('not a pdf'), 'broken.pdf')).status).toBe('failed');
	});

	it('reads long text in slices with a page locator, and full-text search finds words in it', async () => {
		const e = engagement();
		const pages = [
			'First page about access control.',
			'Second page about leavers and accounts.',
			'Third page about backups.'
		];
		const [r] = await uploadArtifacts(app, human, files, e.id, [
			{ name: 'policy.pdf', type: 'application/pdf', bytes: makePdf(pages) }
		]);
		const id = r!.artifact!.id;
		const whole = getArtifactText(app, id);
		expect(whole).toMatchObject({ offset: 0, nextOffset: null, locator: 'p. 1-3' });
		const page2 = getArtifactText(app, id, whole.text.indexOf('Second'), 500);
		expect(page2.locator.startsWith('p. 2')).toBe(true);
		expect(
			searchText(app.sqlite, 'leavers').some((h) => h.entityType === 'artifact' && h.entityId === id)
		).toBe(true);
	});

	it('edits title, kind, version and approval date as versions; mentions a document not yet received', async () => {
		const e = engagement();
		const [r] = await uploadArtifacts(app, human, files, e.id, [
			{ name: 'acp.txt', type: 'text/plain', bytes: text('x') }
		]);
		const a = updateArtifact(app, human, r!.artifact!.id, 1, {
			title: 'Access control policy',
			kind: 'policy',
			version_label: '2.1',
			approval_date: '2026-02-10'
		});
		expect(a).toMatchObject({ displayName: 'Access control policy', kind: 'policy', version: 2 });
		expect(() => updateArtifact(app, human, a.id, 2, { kind: 'poem' })).toThrow(ValidationError);
		expect(() => updateArtifact(app, human, a.id, 2, { approval_date: '10.02.2026' })).toThrow(
			ValidationError
		);

		const m = addMentionedDocument(app, human, e.id, 'Supplier register');
		expect(m).toMatchObject({ state: 'mentioned', fileHash: null, textStatus: 'none' });
		expect(() => getArtifactText(app, m.id)).toThrow(/mentioned/);
		removeArtifact(app, human, a.id);
		expect(listArtifacts(app, e.id).map((x) => x.displayName)).toEqual(['Supplier register']);
		expect(existsSync(filePath(files, r!.artifact!.fileHash!))).toBe(true);
	});

	it('registers text from MCP as an artifact recorded with user and agent', () => {
		const e = engagement();
		const a = registerTextArtifact(app, ai, files, e.id, {
			title: 'Interview transcript',
			text: 'The CISO said backups are tested.',
			kind: 'transcript'
		});
		expect(a).toMatchObject({ origin: 'mcp', textStatus: 'extracted', kind: 'transcript' });
		expect(getHistory(app, 'artifact', a.id)[0]).toMatchObject({ authorAgent: 'Claude' });
	});
});

describe('new versions of a document (#76)', () => {
	it('uploads a new version that records what it replaces; the old one stays, marked replaced', async () => {
		const e = engagement();
		const [r] = await uploadArtifacts(app, human, files, e.id, [
			{ name: 'policy-v1.txt', type: 'text/plain', bytes: text('Passwords have 8 characters.') }
		]);
		const v1 = updateArtifact(app, human, r!.artifact!.id, r!.artifact!.version, {
			kind: 'policy',
			language: 'lv'
		});
		const { artifact: v2 } = await uploadNewVersion(app, human, files, e.id, v1.id, {
			name: 'policy-v2.txt',
			type: 'text/plain',
			bytes: text('Passwords have 12 characters.')
		});
		expect(v2).toMatchObject({ supersedesId: v1.id, kind: 'policy', language: 'lv', replacedBy: null });
		expect(getArtifact(app, v1.id).replacedBy).toEqual({ id: v2.id, displayName: 'policy-v2.txt' });
		expect(listArtifacts(app, e.id).map((a) => a.id)).toEqual([v1.id, v2.id]);
		expect(getHistory(app, 'artifact', v1.id)).toHaveLength(2);

		// Refused: the same file again, a file already in the engagement, and a second successor.
		await expect(
			uploadNewVersion(app, human, files, e.id, v2.id, {
				name: 'again.txt',
				type: 'text/plain',
				bytes: text('Passwords have 12 characters.')
			})
		).rejects.toThrow('This is the same file as policy-v2.txt; nothing changed.');
		await expect(
			uploadNewVersion(app, human, files, e.id, v2.id, {
				name: 'old.txt',
				type: 'text/plain',
				bytes: text('Passwords have 8 characters.')
			})
		).rejects.toThrow('This file is already in the engagement as policy-v1.txt.');
		await expect(
			uploadNewVersion(app, human, files, e.id, v1.id, {
				name: 'v3.txt',
				type: 'text/plain',
				bytes: text('Passwords have 14 characters.')
			})
		).rejects.toThrow(/already replaced by policy-v2\.txt; upload the new version there/);
		const mentioned = addMentionedDocument(app, human, e.id, 'Backup plan');
		await expect(
			uploadNewVersion(app, human, files, e.id, mentioned.id, {
				name: 'b.txt',
				type: 'text/plain',
				bytes: text('x')
			})
		).rejects.toThrow(ValidationError);
		const other = engagement('Other Client SIA', 'Other audit');
		await expect(
			uploadNewVersion(app, human, files, other.id, v2.id, {
				name: 'c.txt',
				type: 'text/plain',
				bytes: text('y')
			})
		).rejects.toThrow('Document not found');

		// Removing the new version makes the old one current again.
		removeArtifact(app, human, v2.id);
		expect(getArtifact(app, v1.id).replacedBy).toBeNull();
	});

	it('register_artifact text can be a new version too, written as the AI', () => {
		const e = engagement();
		const v1 = registerTextArtifact(app, human, files, e.id, { title: 'Access policy', text: 'Old rules.' });
		const v2 = registerTextArtifact(app, ai, files, e.id, {
			title: 'Access policy 2026',
			text: 'New rules.',
			supersedesId: v1.id
		});
		expect(v2.supersedesId).toBe(v1.id);
		expect(getArtifact(app, v1.id).replacedBy?.id).toBe(v2.id);
		expect(() =>
			registerTextArtifact(app, ai, files, e.id, { title: 'Same', text: 'New rules.', supersedesId: v2.id })
		).toThrow(/same file/);
	});
});

describe('internal requirements and client isolation (#42)', () => {
	it('has text, quote, document, section, status and implements links with coverage', async () => {
		const e = engagement();
		const [r] = await uploadArtifacts(app, human, files, e.id, [
			{
				name: 'acp.txt',
				type: 'text/plain',
				bytes: text('4.2 Accounts of leavers are disabled within one working day.')
			}
		]);
		const internal = addInternal(app, human, e.id, {
			title: 'Leaver accounts disabled within one day',
			text: 'Accounts of leavers are disabled within one working day.',
			quote: 'Accounts of leavers are disabled within one working day.',
			section: '4.2',
			artifactId: r!.artifact!.id,
			implements: [{ requirementId: nis2('i').id, coverage: 'partial' }]
		});
		expect(internal).toMatchObject({
			refCode: 'INT-1',
			status: 'confirmed',
			section: '4.2',
			artifactId: r!.artifact!.id,
			sourceTitle: 'acp.txt'
		});
		expect(internal.implements.map((l) => `${l.other.refCode} ${l.coverage}`)).toEqual([
			'Art. 21(2)(i) partial'
		]);
		setImplements(app, human, e.id, internal.id, { requirementId: nis2('i').id, coverage: 'full' });
		expect(getInternal(app, e.id, internal.id).implements[0]!.coverage).toBe('full');
		expect(() =>
			setImplements(app, human, e.id, internal.id, { requirementId: internal.id, coverage: 'full' })
		).toThrow(/external/);

		const second = addInternal(app, human, e.id, {
			title: 'MFA for remote access',
			section: '5.1',
			artifactId: r!.artifact!.id
		});
		expect(second.refCode).toBe('INT-2');
		expect(second.sourceId).toBe(internal.sourceId);
		expect(updateInternal(app, human, e.id, second.id, second.version, { section: '5.1(a)' }).section).toBe(
			'5.1(a)'
		);
		// Internal sources stay out of the shared library and its search.
		expect(listSources(app).map((s) => s.code)).toEqual(['nis2']);
		expect(searchRequirements(app, 'leavers').map((x) => x.refCode)).not.toContain('INT-1');
		expect(() => selectRequirements(app, human, e.id, [internal.id])).toThrow(/criteria for external/);
	});

	it('adds by hand; AI proposes; a person accepts, rejects or accepts all', () => {
		const e = engagement();
		const hand = addInternal(app, human, e.id, { title: 'By hand' });
		expect(hand).toMatchObject({ status: 'confirmed', sourceTitle: 'Added by hand' });
		const p1 = addInternal(app, ai, e.id, { title: 'Proposal 1' });
		const p2 = addInternal(app, ai, e.id, { title: 'Proposal 2' });
		addInternal(app, ai, e.id, { title: 'Proposal 3' });
		expect(p1.status).toBe('proposed');
		expect(() => acceptInternal(app, ai, e.id, p1.id)).toThrow(ForbiddenError);
		expect(() => acceptAllInternal(app, ai, e.id)).toThrow(ForbiddenError);
		expect(acceptInternal(app, human, e.id, p1.id).status).toBe('confirmed');
		rejectInternal(app, human, e.id, p2.id);
		expect(acceptAllInternal(app, human, e.id)).toBe(1);
		expect(listInternal(app, e.id).map((r) => `${r.refCode}:${r.status}`)).toEqual([
			'INT-1:confirmed',
			'INT-2:confirmed',
			'INT-4:confirmed'
		]);
	});

	it('rejecting an AI change to an accepted requirement restores what was accepted, links included (#76)', () => {
		const e = engagement();
		const r = addInternal(app, human, e.id, {
			title: 'Leavers disabled within a day',
			quote: 'Accounts of leavers are disabled within one working day.',
			section: '4.2',
			implements: [{ requirementId: nis2('i').id, coverage: 'partial' }]
		});
		expect(r.previous).toBeNull();
		// AI changes the wording and coverage and adds a link: all of it waits for review.
		const changed = updateInternal(app, ai, e.id, r.id, r.version, {
			title: 'Leavers disabled within a week',
			quote: 'Accounts of leavers are disabled within five working days.'
		});
		setImplements(app, ai, e.id, r.id, { requirementId: nis2('i').id, coverage: 'full' });
		setImplements(app, ai, e.id, r.id, { requirementId: nis2('b').id, coverage: 'partial' });
		const proposed = getInternal(app, e.id, r.id);
		expect(changed.status).toBe('proposed');
		expect(proposed.previous).toEqual({
			title: 'Leavers disabled within a day',
			text: null,
			quote: 'Accounts of leavers are disabled within one working day.',
			section: '4.2'
		});

		rejectInternal(app, human, e.id, r.id);
		const back = getInternal(app, e.id, r.id);
		expect(back).toMatchObject({
			status: 'confirmed',
			title: 'Leavers disabled within a day',
			quote: 'Accounts of leavers are disabled within one working day.',
			previous: null
		});
		expect(back.implements.map((l) => [l.other.refCode, l.coverage, l.status])).toEqual([
			['Art. 21(2)(i)', 'partial', 'confirmed']
		]);
		expect(back.version).toBeGreaterThan(proposed.version);
		expect(getHistory(app, 'requirement', r.id)[0]).toMatchObject({ note: 'Change rejected' });

		// A requirement that was never accepted is still removed.
		const fresh = addInternal(app, ai, e.id, { title: 'Brand new proposal' });
		rejectInternal(app, human, e.id, fresh.id);
		expect(listInternal(app, e.id).map((x) => x.id)).toEqual([r.id]);
	});

	it('refuses reads, links and writes across auditees', () => {
		const mine = engagement('Baltic Freight SIA');
		const theirs = engagement('Other Client SIA', 'Other audit');
		const secret = addInternal(app, human, theirs.id, { title: 'Their secret rule' });
		const own = addInternal(app, human, mine.id, { title: 'Our rule' });

		expect(() => getInternal(app, mine.id, secret.id)).toThrow(ForbiddenError);
		expect(() => updateInternal(app, human, mine.id, secret.id, 1, { title: 'x' })).toThrow(ForbiddenError);
		expect(() => rejectInternal(app, human, mine.id, secret.id)).toThrow(ForbiddenError);
		expect(() => assertCanReadRequirement(app, secret.id, { auditeeId: mine.auditeeId })).toThrow(
			ForbiddenError
		);
		expect(() => assertItemReadable(app, 'requirement', secret.id, { auditeeId: mine.auditeeId })).toThrow(
			ForbiddenError
		);
		expect(() => assertItemReadable(app, 'requirement', secret.id, {})).toThrow(ForbiddenError);
		expect(() => addLink(app, human, { fromId: own.id, toId: secret.id, type: 'details' })).toThrow(
			/different auditees/
		);
		expect(() => selectRequirements(app, human, mine.id, [secret.id])).toThrow(/not found/);
		expect(listInternal(app, mine.id).map((r) => r.title)).toEqual(['Our rule']);
		expect(carryOverCandidates(app, mine.id)).toEqual([]);
	});

	it('carry-over offers the same auditee’s earlier internal requirements and records who chose it', () => {
		const earlier = engagement('Baltic Freight SIA', '2025 audit');
		addInternal(app, human, earlier.id, { title: 'Leavers disabled within one day' });
		addInternal(app, ai, earlier.id, { title: 'Still a proposal' });
		const now = engagement('Baltic Freight SIA', '2026 audit');
		expect(listInternal(app, now.id)).toEqual([]);
		expect(carryOverCandidates(app, now.id).map((r) => r.title)).toEqual(['Leavers disabled within one day']);

		expect(() => updateEngagement(app, ai, now.id, now.version, { carry_over_internal: true })).toThrow(
			ForbiddenError
		);
		const on = updateEngagement(app, human, now.id, now.version, { carry_over_internal: true });
		expect(on.carryOverInternal).toBe(true);
		const [rev] = getHistory(app, 'engagement', now.id);
		expect(rev).toMatchObject({ authorName: 'Ada', authorAgent: null });
		const carried = listInternal(app, now.id).filter((r) => r.carriedOver);
		expect(carried.map((r) => r.title)).toContain('Leavers disabled within one day');
		expect(() => rejectInternal(app, human, now.id, carried[0]!.id)).toThrow(/carry-over off/);
		// Codes keep counting for the auditee.
		expect(addInternal(app, human, now.id, { title: 'New rule' }).refCode).toBe('INT-3');
		expect(getEngagement(app, now.id).carryOverInternal).toBe(true);
	});
});
