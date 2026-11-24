// The onboarding pack for a tenant (#100): what the operator sends a new tenant's first admin
// besides the invitation the instance itself emails.
//
//   node scripts/onboarding-pack.mjs statement   a one-page statement the tenant can keep (HTML)
//   node scripts/onboarding-pack.mjs note        a short note from the operator, to send by hand (text)
//   node scripts/onboarding-pack.mjs missing     the facts about the operator that are not set yet
//
// The facts come from the environment (the tenant command passes them from host.env and its
// registry); the tenant's profile comes on standard input, for the first admin's name. Nothing is
// read from an instance. On the tenant host it runs in the app's image, which has Node.
import { parse as parseYaml } from 'yaml';

/**
 * @typedef {object} PackFacts
 * @property {string} title        the tenant's title
 * @property {string} address      https://… of its instance
 * @property {string} adminName    the first admin, from the profile
 * @property {string} operator     who runs the instance
 * @property {string} contact      how to reach them
 * @property {string} hosting      where the server is, and whose it is
 * @property {string} backupCopy   where the copy of the backups off the server is kept
 * @property {string} emailService the service that sends the instance's email
 * @property {string} modelProvider the company behind the AI model; empty when the tenant has no AI
 * @property {string} sender       the address the instance's email comes from
 * @property {boolean} ai          the tenant has AI through the operator's gateway
 * @property {string} aiBudget     e.g. "20"
 * @property {string} aiPeriod     e.g. "30d"
 * @property {boolean} webSearch
 * @property {number} keepDaily
 * @property {number} keepWeekly
 * @property {number} keepMonthly
 * @property {number} deletedDays  how long a deleted tenant's backups are kept
 * @property {string} date         YYYY-MM-DD
 */

/** The operator's own facts: the setting in host.env, and what it is asked for. */
export const OPERATOR_FACTS = [
	['OPERATOR_NAME', 'operator', 'who runs the instances: your firm’s name'],
	['OPERATOR_CONTACT', 'contact', 'how a tenant reaches you: an email address or a phone number'],
	[
		'OPERATOR_HOSTING',
		'hosting',
		'whose server it is and where, for example "our own server in Riga, Latvia"'
	],
	[
		'OPERATOR_BACKUP_COPY',
		'backupCopy',
		'where the copy of the backups off the server is kept, for example "an encrypted copy with Hetzner, Finland"'
	],
	['OPERATOR_EMAIL_SERVICE', 'emailService', 'the service that sends the email, for example "Resend (USA)"'],
	[
		'OPERATOR_MODEL_PROVIDER',
		'modelProvider',
		'the company behind the AI model, for example "Anthropic (USA), through its API"'
	]
];

const number = (/** @type {string | undefined} */ v, /** @type {number} */ fallback) => {
	const n = Number((v ?? '').trim());
	return Number.isInteger(n) && n >= 0 && (v ?? '').trim() !== '' ? n : fallback;
};

/** @param {Record<string, string | undefined>} env @param {string} profileText @returns {PackFacts} */
export function factsFrom(env, profileText = '') {
	const val = (/** @type {string} */ k) => (env[k] ?? '').trim();
	let adminName = '';
	try {
		const profile = profileText.trim() ? parseYaml(profileText) : null;
		adminName = String(profile?.first_admin?.name ?? '').trim();
	} catch {
		// A profile that cannot be read leaves the greeting without a name.
	}
	return {
		title: val('PACK_TITLE'),
		address: val('PACK_ADDRESS').replace(/\/+$/, ''),
		adminName,
		operator: val('OPERATOR_NAME'),
		contact: val('OPERATOR_CONTACT'),
		hosting: val('OPERATOR_HOSTING'),
		backupCopy: val('OPERATOR_BACKUP_COPY'),
		emailService: val('OPERATOR_EMAIL_SERVICE'),
		modelProvider: val('OPERATOR_MODEL_PROVIDER'),
		sender: val('PACK_SENDER'),
		ai: val('PACK_AI') === 'on',
		aiBudget: val('PACK_AI_BUDGET'),
		aiPeriod: val('PACK_AI_PERIOD') || '30d',
		webSearch: val('TENANT_AI_WEB_SEARCH') === 'true',
		keepDaily: number(env.BACKUP_KEEP_DAILY, 7),
		keepWeekly: number(env.BACKUP_KEEP_WEEKLY, 4),
		keepMonthly: number(env.BACKUP_KEEP_MONTHLY, 6),
		deletedDays: number(env.DELETED_BACKUPS_DAYS, 30),
		date: val('PACK_DATE') || new Date().toISOString().slice(0, 10)
	};
}

/** The settings still to fill in before the pack can be sent. The model provider only where there is AI. */
export function missingFacts(/** @type {PackFacts} */ f) {
	return OPERATOR_FACTS.filter(([setting, key]) => {
		if (setting === 'OPERATOR_MODEL_PROVIDER' && !f.ai) return false;
		return !f[/** @type {keyof PackFacts} */ (key)];
	}).map(([setting, , what]) => ({ setting, what }));
}

const gap = (/** @type {string} */ value, /** @type {string} */ setting) =>
	value || `[TO FILL IN: ${setting}]`;
const esc = (/** @type {string} */ s) =>
	s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
/** "30d" → "30 days", "1mo" → "month" */
export function periodWords(/** @type {string} */ p) {
	const m = p.trim().match(/^(\d+)(d|mo|h)$/);
	if (!m) return p;
	const n = Number(m[1]);
	const unit = m[2] === 'd' ? 'day' : m[2] === 'mo' ? 'month' : 'hour';
	return n === 1 ? unit : `${n} ${unit}s`;
}

/**
 * The statement, as sections of plain sentences. Every point the tenant must be told is here once:
 * where the data is, the backups, what the operator sees, Cloudflare, the AI, email, export and
 * deletion. @param {PackFacts} f
 */
export function statementSections(f) {
	const operator = gap(f.operator, 'OPERATOR_NAME');
	const sections = [
		{
			title: 'Where your data is',
			text: [
				`${f.title} has its own instance of mcp-audit at ${f.address}: a separate database and separate files, on ${gap(f.hosting, 'OPERATOR_HOSTING')}. No other firm's data is in it, and yours is in no other instance.`
			]
		},
		{
			title: 'Backups',
			text: [
				`Every night an encrypted backup of your instance is made, with a passphrase that is used for your instance only. We keep the last ${f.keepDaily} daily, ${f.keepWeekly} weekly and ${f.keepMonthly} monthly backups. A copy is kept off the server: ${gap(f.backupCopy, 'OPERATOR_BACKUP_COPY')}. Once a month the newest backup is restored into a throwaway copy, to see that it can be.`
			]
		},
		{
			title: `What ${operator} can and cannot see`,
			text: [
				'We see whether your instance is running and on which version, when it was last backed up, how much space it uses, how many people and engagements it has, when someone last signed in, and how much of the AI budget is used. Numbers and dates: not who, and not what.',
				'We do not see your auditees, engagements, documents, notes, evidence, findings or reports, and we have no account in your instance. If you want our help inside it, your admin invites one of us like any other person and removes them afterwards; what they do is in the history under their name.',
				'Because the server and the backups are ours to run, we are able to open your data by restoring a backup. We do that only when you ask us in writing, or when the law obliges us, and we keep a record each time.'
			]
		},
		{
			title: 'How your instance is reached',
			text: [
				'Your address is reached through Cloudflare, Inc., which carries the traffic between you and our server. The connection is encrypted on both sides of Cloudflare; at its own edge Cloudflare sees the traffic unencrypted. Our server accepts no connection from the internet except through it.'
			]
		},
		f.ai
			? {
					title: 'AI',
					text: [
						`When someone presses an AI button, the instructions for that action and what it reads of the engagement (for example the text of documents, requirements, notes and findings) go through our AI gateway to ${gap(f.modelProvider, 'OPERATOR_MODEL_PROVIDER')}, and the answers come back the same way.${f.webSearch ? ' Where an action searches the web, the search questions go there too.' : ''} Our gateway keeps how much was spent, not what was asked or answered.${f.aiBudget ? ` Your budget is $${f.aiBudget} for each ${periodWords(f.aiPeriod)}.` : ''}`,
						'Everything the AI writes is a proposal that a person accepts or rejects. To keep an engagement away from the model, switch off "AI may work on this engagement" in its details. An admin can also set a gateway and model of your own on Settings, AI; ours is then not used. Your own Claude or ChatGPT connected through MCP does not go through our gateway: that is between you and your AI provider.'
					]
				}
			: {
					title: 'AI',
					text: [
						'No AI is set up for your instance by us. An admin can set a gateway and model of your own on Settings, AI. Your own Claude or ChatGPT connected through MCP is between you and your AI provider.'
					]
				},
		{
			title: 'Email',
			text: [
				`Invitations, sign-in codes and security notices are sent through ${gap(f.emailService, 'OPERATOR_EMAIL_SERVICE')}${f.sender ? `, from ${f.sender}` : ''}. That service sees the recipient's address and the message. The messages hold no audit content.`
			]
		},
		{
			title: 'Export and deletion',
			text: [
				`Ask us for an export at any time: you get one encrypted file with your database and files, and the passphrase for it another way. It opens in an mcp-audit of your own. When you leave, we make a final export for you, then delete the instance, its data and its AI key at once. The backups are deleted ${f.deletedDays} days later.`
			]
		},
		{
			title: 'Contact',
			text: [`${operator}: ${gap(f.contact, 'OPERATOR_CONTACT')}.`]
		}
	];
	return sections;
}

/** One page, to print or keep as a file. @param {PackFacts} f */
export function statementHtml(f) {
	const sections = statementSections(f);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(f.title)}: where your data is and who can see it</title>
<style>
@page { size: A4; margin: 13mm 15mm; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 46rem; padding: 1.5rem 1.25rem; color: #14181d; background: #fff; font: 9.6pt/1.36 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
h1 { margin: 0 0 .1rem; font-size: 14pt; line-height: 1.25; }
.sub { margin: 0 0 .6rem; color: #4f5966; font-size: 9pt; }
h2 { margin: .5rem 0 .1rem; font-size: 9.8pt; }
p { margin: 0 0 .22rem; }
footer { margin-top: .6rem; padding-top: .35rem; border-top: 1px solid #d5d9df; color: #4f5966; font-size: 8.2pt; }
@media print { body { padding: 0; max-width: none; } }
</style>
</head>
<body>
<h1>Where your data is and who can see it</h1>
<p class="sub">${esc(f.title)} · ${esc(f.address)} · run by ${esc(gap(f.operator, 'OPERATOR_NAME'))} · ${esc(f.date)}</p>
${sections.map((s) => `<h2>${esc(s.title)}</h2>\n${s.text.map((t) => `<p>${esc(t)}</p>`).join('\n')}`).join('\n')}
<footer>This describes how the instance is run on ${esc(f.date)}. It is information, not a contract; where an agreement between us says otherwise, the agreement holds. The guide to the app is at ${esc(f.address)}/welcome/guide.</footer>
</body>
</html>
`;
}

/**
 * mcp-audit in three sentences, for someone who has never seen it. The invitation itself leads with
 * Join and nothing else (#103), so the note the operator sends says what the app is (#100).
 */
export const WHAT_IT_IS =
	'mcp-audit is an app for planning and running audits: the requirements of laws and standards, the auditee’s documents, the plan, the meetings, the evidence and the findings are kept in one place. An AI can do the reading and the drafting, and everything it writes is a proposal that an auditor accepts or rejects. Every change is kept in a history, so it is always clear who decided what.';

/** A short note in the operator's own name, to send by hand next to the invitation. @param {PackFacts} f */
export function noteText(f) {
	return [
		`Subject: Your mcp-audit instance for ${f.title}`,
		'',
		`Hello${f.adminName ? ` ${f.adminName}` : ''},`,
		'',
		`I have set up an mcp-audit instance for ${f.title}. It is yours alone, at ${f.address}.`,
		'',
		WHAT_IT_IS,
		'',
		`You get an email${f.sender ? ` from ${f.sender}` : ''} with the subject "Your instance is ready (${f.title})". That is the invitation: press Join in it to start. Below the button it says what is already set up. The link works once, for 7 days. If you cannot find the email, look in the spam folder, then tell me and I send a new one.`,
		'',
		`The guide is at ${f.address}/welcome/guide. It shows the five steps of an audit and how to connect your own Claude or ChatGPT.`,
		'',
		'Attached is one page on where your data is stored and who can see it. Please read it before you upload a client’s documents.',
		'',
		gap(f.operator, 'OPERATOR_NAME'),
		gap(f.contact, 'OPERATOR_CONTACT'),
		''
	].join('\n');
}

/** @param {string[]} argv @param {Record<string, string | undefined>} env @param {string} input */
export function main(argv, env = process.env, input = '') {
	const f = factsFrom(env, input);
	const [command] = argv;
	if (!f.title || !f.address) throw new Error('PACK_TITLE and PACK_ADDRESS are not set.');
	if (command === 'statement') return statementHtml(f);
	if (command === 'note') return noteText(f);
	if (command === 'missing')
		return missingFacts(f)
			.map((m) => `${m.setting}: ${m.what}`)
			.join('\n');
	throw new Error('Usage: onboarding-pack.mjs statement|note|missing');
}

if (import.meta.url === `file://${process.argv[1]}`) {
	let input = '';
	if (!process.stdin.isTTY) for await (const chunk of process.stdin) input += chunk;
	try {
		const out = main(process.argv.slice(2), process.env, input);
		if (out) console.log(out);
	} catch (e) {
		console.error(e instanceof Error ? e.message : e);
		process.exit(1);
	}
}
