import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	factsFrom,
	main,
	missingFacts,
	noteText,
	WHAT_IT_IS,
	periodWords,
	statementHtml,
	statementSections
} from '../../scripts/onboarding-pack.mjs';
import { makeHost } from '../fixtures/tenant-host';

/**
 * #100: the onboarding pack. The documents are made by scripts/onboarding-pack.mjs; the tenant
 * command (the real shell script, with docker scripted) fills in the facts and writes the files.
 */
const OPERATOR = {
	OPERATOR_NAME: 'Peak Audit Hosting',
	OPERATOR_CONTACT: 'hosting@peak.example.test',
	OPERATOR_HOSTING: 'our own server in Riga, Latvia',
	OPERATOR_BACKUP_COPY: 'an encrypted copy with Hetzner in Helsinki, Finland',
	OPERATOR_EMAIL_SERVICE: 'Resend (USA)',
	OPERATOR_MODEL_PROVIDER: 'Anthropic (USA), through its API'
};
const ENV = {
	...OPERATOR,
	PACK_TITLE: 'Acme Audit & Co',
	PACK_ADDRESS: 'https://mcpaudit-acme.example.test/',
	PACK_SENDER: 'Acme Audit & Co <audit@example.test>',
	PACK_AI: 'on',
	PACK_AI_BUDGET: '20',
	PACK_AI_PERIOD: '30d',
	PACK_DATE: '2026-11-23'
};
const PROFILE =
	'instance_name: "Acme Audit & Co"\nfirst_admin:\n  name: "Ina Bērziņa"\n  email: "ina@acme.example.test"\n';

describe('the statement a tenant can keep', () => {
	const f = factsFrom(ENV, PROFILE);
	const text = statementSections(f)
		.flatMap((s) => [s.title, ...s.text])
		.join('\n');

	it('says where the data is stored and how it is backed up', () => {
		expect(text).toContain(
			'Acme Audit & Co has its own instance of mcp-audit at https://mcpaudit-acme.example.test: a separate database and separate files, on our own server in Riga, Latvia.'
		);
		expect(text).toContain('We keep the last 7 daily, 4 weekly and 6 monthly backups.');
		expect(text).toContain(
			'A copy is kept off the server: an encrypted copy with Hetzner in Helsinki, Finland.'
		);
		expect(text).toContain('with a passphrase that is used for your instance only');
	});

	it('says what the operator can and cannot see', () => {
		expect(text).toContain('What Peak Audit Hosting can and cannot see');
		expect(text).toContain('Numbers and dates: not who, and not what.');
		expect(text).toContain('we have no account in your instance');
		expect(text).toContain('We do that only when you ask us in writing, or when the law obliges us');
	});

	it('says that traffic goes through Cloudflare, which sees it unencrypted at its edge', () => {
		expect(text).toContain('reached through Cloudflare, Inc.');
		expect(text).toContain('at its own edge Cloudflare sees the traffic unencrypted');
	});

	it('says what goes to the AI gateway and the model provider, and how to keep material from it', () => {
		expect(text).toContain('go through our AI gateway to Anthropic (USA), through its API');
		expect(text).toContain('Our gateway keeps how much was spent, not what was asked or answered.');
		expect(text).toContain('Your budget is $20 for each 30 days.');
		expect(text).toContain('switch off "AI may work on this engagement"');
		expect(text).toContain('set a gateway and model of your own on Settings, AI');
		expect(text).toContain('does not go through our gateway');
	});

	it('says how to get an export, what deletion removes, and when', () => {
		expect(text).toContain('Ask us for an export at any time');
		expect(text).toContain(
			'delete the instance, its data and its AI key at once. The backups are deleted 30 days later.'
		);
	});

	it('follows the host’s own settings', () => {
		const other = factsFrom(
			{
				...ENV,
				BACKUP_KEEP_DAILY: '14',
				DELETED_BACKUPS_DAYS: '90',
				PACK_AI_PERIOD: '1mo',
				TENANT_AI_WEB_SEARCH: 'true'
			},
			PROFILE
		);
		const t = statementSections(other)
			.flatMap((s) => s.text)
			.join('\n');
		expect(t).toContain('the last 14 daily');
		expect(t).toContain('deleted 90 days later');
		expect(t).toContain('for each month.');
		expect(t).toContain('the search questions go there too');
		expect(periodWords('7d')).toBe('7 days');
	});

	it('for a tenant without AI says so, and does not ask for a model provider', () => {
		const none = factsFrom({ ...ENV, PACK_AI: '', OPERATOR_MODEL_PROVIDER: '' }, PROFILE);
		expect(missingFacts(none)).toEqual([]);
		const t = statementSections(none)
			.flatMap((s) => s.text)
			.join('\n');
		expect(t).toContain('No AI is set up for your instance by us.');
		expect(t).not.toContain('AI gateway to');
	});

	it('is one self-contained page that prints on A4, with text shown as text', () => {
		const html = statementHtml(f);
		expect(html).toContain('<title>Acme Audit &amp; Co: where your data is and who can see it</title>');
		expect(html).toContain('@page { size: A4;');
		expect(html).toContain(
			'Acme Audit &amp; Co · https://mcpaudit-acme.example.test · run by Peak Audit Hosting · 2026-11-23'
		);
		// Nothing is loaded from anywhere, and nothing runs.
		expect(html).not.toMatch(/<script|<link|<img|src=|url\(/);
		// Short enough for one page: rendered with long real-world facts it fills about four fifths of A4.
		const words = html
			.replace(/<style>[\s\S]*<\/style>/, '')
			.replace(/<[^>]+>/g, ' ')
			.trim()
			.split(/\s+/).length;
		expect(words).toBeLessThan(680);
		const hostile = statementHtml(factsFrom({ ...ENV, PACK_TITLE: '<script>alert(1)</script>' }, PROFILE));
		expect(hostile).not.toContain('<script>alert(1)');
	});
});

describe('the note the operator sends by hand', () => {
	it('names the person, the address, the sender and subject of the invitation, and the guide', () => {
		const note = noteText(factsFrom(ENV, PROFILE));
		expect(note).toContain('Subject: Your mcp-audit instance for Acme Audit & Co');
		expect(note).toContain('Hello Ina Bērziņa,');
		expect(note).toContain('at https://mcpaudit-acme.example.test.');
		expect(note).toContain(
			'You get an email from Acme Audit & Co <audit@example.test> with the subject "Your instance is ready (Acme Audit & Co)".'
		);
		expect(note).toContain('The guide is at https://mcpaudit-acme.example.test/welcome/guide.');
		expect(note).toContain('Peak Audit Hosting\nhosting@peak.example.test');
	});

	it('says what mcp-audit is, in three sentences, since the invitation leads with Join alone', () => {
		const note = noteText(factsFrom(ENV, PROFILE));
		expect(note).toContain(`It is yours alone, at https://mcpaudit-acme.example.test.\n\n${WHAT_IT_IS}\n`);
		expect(WHAT_IT_IS.split(/(?<=\.)\s+/)).toHaveLength(3);
		expect(WHAT_IT_IS).toMatch(/^mcp-audit is an app for planning and running audits/);
		// What the note says of the invitation is what the invitation holds (#103).
		expect(note).toContain(
			'That is the invitation: press Join in it to start. Below the button it says what is already set up.'
		);
		expect(note).not.toContain('it says what mcp-audit is');
	});
});

describe('facts that are not set', () => {
	it('are listed by their setting, and marked in a draft', () => {
		const f = factsFrom({ ...ENV, OPERATOR_HOSTING: '', OPERATOR_MODEL_PROVIDER: ' ' }, PROFILE);
		expect(missingFacts(f).map((m) => m.setting)).toEqual(['OPERATOR_HOSTING', 'OPERATOR_MODEL_PROVIDER']);
		expect(main(['missing'], { ...ENV, OPERATOR_HOSTING: '' }, PROFILE)).toMatch(
			/^OPERATOR_HOSTING: whose server it is/
		);
		expect(statementHtml(f)).toContain('[TO FILL IN: OPERATOR_HOSTING]');
		expect(main(['missing'], ENV, PROFILE)).toBe('');
		expect(() => main(['statement'], { ...ENV, PACK_TITLE: '' }, PROFILE)).toThrow('PACK_TITLE');
	});
});

describe('tenant pack', () => {
	let h: ReturnType<typeof makeHost>;
	const operatorEnv = Object.entries(OPERATOR).map(([k, v]) => `${k}=${v}`);
	beforeEach(() => {
		h = makeHost(operatorEnv);
	});
	afterEach(() => h.cleanup());

	it('writes the statement and the note for a tenant, readable by the operator only', () => {
		const created = h.create('acme', ['--admin-name', 'Ina Bērziņa']);
		expect(created.out).toContain('Then: bin/tenant pack acme');
		expect(h.tenant(['pack', 'acme', '--dry-run']).out).toContain('Nothing was changed (--dry-run).');
		const dir = path.join(h.hostDir, 'packs/acme');
		expect(existsSync(dir)).toBe(false);

		const r = h.tenant(['pack', 'acme']);
		expect(r.err).toBe('');
		expect(r.code).toBe(0);
		expect(r.out).toContain(`The pack for "acme" is in ${dir}:`);
		expect(r.out).toContain('https://mcpaudit-acme.example.test/welcome/guide');
		expect(statSync(dir).mode & 0o777).toBe(0o700);
		const statement = readFileSync(path.join(dir, 'statement.html'), 'utf8');
		expect(statement).toContain(
			'acme audit has its own instance of mcp-audit at https://mcpaudit-acme.example.test'
		);
		expect(statement).toContain('on our own server in Riga, Latvia');
		expect(statement).not.toContain('TO FILL IN');
		// The host in these tests has no AI gateway: the statement says so.
		expect(statement).toContain('No AI is set up for your instance by us.');
		const note = readFileSync(path.join(dir, 'note.txt'), 'utf8');
		expect(note).toContain('Hello Ina Bērziņa,');
		expect(note).toContain('You get an email from acme audit <audit@example.test>');
		// Made in the app's image, from the tenant's own profile; the instance is not asked anything.
		const calls = h.dockerCalls().filter((c) => c.includes('onboarding-pack.mjs'));
		// Once to ask what is missing for the dry run, then that again and the two documents.
		expect(calls).toHaveLength(4);
		expect(calls.every((c) => c.startsWith('run --rm -i '))).toBe(true);
		expect(
			h.dockerCalls().some((c) => c.startsWith('exec mcp-audit-tenant-acme') && c.includes('pack'))
		).toBe(false);
	});

	it('tells the instance who runs it, for the first admin’s welcome', () => {
		h.create('acme');
		const profile = readFileSync(path.join(h.tenantsDir, 'acme/tenant-profile.yaml'), 'utf8');
		expect(profile).toContain(
			'operator:\n  name: "Peak Audit Hosting"\n  contact: "hosting@peak.example.test"'
		);
	});

	it('refuses to make a pack with facts missing, names them, and makes a marked draft on request', () => {
		h.cleanup();
		h = makeHost(['OPERATOR_NAME=Peak Audit Hosting']);
		h.create('acme');
		const r = h.tenant(['pack', 'acme']);
		expect(r.code).toBe(1);
		expect(r.err).toContain('The pack for "acme" is not ready to send. Set these in host.env first:');
		expect(r.err).toContain('  - OPERATOR_CONTACT: how a tenant reaches you');
		expect(r.err).toContain('  - OPERATOR_HOSTING:');
		expect(r.err).not.toContain('OPERATOR_NAME:');
		expect(existsSync(path.join(h.hostDir, 'packs/acme'))).toBe(false);

		const draft = h.tenant(['pack', 'acme', '--draft']);
		expect(draft.code).toBe(0);
		expect(draft.out).toContain('DRAFT: do not send it.');
		expect(readFileSync(path.join(h.hostDir, 'packs/acme/statement.html'), 'utf8')).toContain(
			'[TO FILL IN: OPERATOR_HOSTING]'
		);
		expect(h.tenant(['pack', 'nobody']).err).toContain('There is no tenant "nobody".');
	});
});
