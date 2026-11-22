/**
 * The guide's content (#84): what to do in each step of an audit and how to connect an AI assistant.
 * One source for the in-app guide (/guide), the first-time welcome and the standalone page
 * (standalone.ts), so they cannot drift apart. Plain data: no imports, and only type syntax that
 * Node strips, so scripts can load it too.
 *
 * Text may mark **bold** spans, and {mcp} stands for the instance's MCP address.
 */

export interface GuideScreen {
	/** "Set-up, Requirements": destination and tab as the app names them. */
	label: string;
	/** Path below /e/:e. */
	path: string;
}

export interface GuideStep {
	key: 'setup' | 'rules' | 'plan' | 'run' | 'conclude';
	number: number;
	title: string;
	/** One line under the title. */
	summary: string;
	/** Numbers of the Home checklist's phases this step covers. */
	phases: number[];
	you: string[];
	ai: string[];
	decide: string;
	done: string;
	tip?: string;
	screens: GuideScreen[];
}

export const GUIDE_INTRO =
	'AI does the groundwork and you make the calls. An audit runs in five steps; open any of them at any time.';

export const RULES: { title: string; text: string }[] = [
	{
		title: 'AI only proposes',
		text: 'Roles, risks, internal requirements, drafted meetings, evidence links and findings arrive as proposals. You accept, edit or reject each one.'
	},
	{
		title: 'Everything is versioned',
		text: 'Every change records who made it and on whose behalf. Nothing is overwritten: open History on any item to see or revert it.'
	},
	{
		title: 'Evidence before conclusions',
		text: 'Missing evidence means no reasonable assurance, never a non-conformity. Only a person approves a finding.'
	}
];

export interface PrepareItem {
	text: string;
	/** Only an admin can do it. */
	admin?: boolean;
	/** Where in the app, outside an engagement. */
	link?: { label: string; href: string };
}

export const PREPARE: { title: string; summary: string; items: PrepareItem[] } = {
	title: 'Before you start',
	summary: 'Once per instance: people, the library and AI.',
	items: [
		{
			text: 'Add your colleagues. Each person signs in as themselves, so the history shows who did what.',
			admin: true,
			link: { label: 'Settings, Users', href: '/settings/users' }
		},
		{
			text: 'Check that the library holds the laws and standards you audit against. Import others from a document or a YAML file.',
			link: { label: 'Library', href: '/library' }
		},
		{
			text: 'Connect the in-app AI to a model: a cloud model, or a local one when documents must stay on your own infrastructure. Without it the AI buttons stay off; everything else works by hand or through your own assistant.',
			admin: true,
			link: { label: 'Settings, AI', href: '/settings/ai' }
		},
		{
			text: 'Connect your own assistant, Claude or ChatGPT, so it can work on the same records.',
			link: { label: 'Connect your AI', href: '/guide/connect' }
		}
	]
};

export const STEPS: GuideStep[] = [
	{
		key: 'setup',
		number: 1,
		title: 'Set up',
		summary: 'Say what is audited, and against what.',
		phases: [1, 2, 3, 4],
		you: [
			'Create the engagement: the auditee, the dates, the working language and the report language.',
			'Select the requirements from the library, for example NIS 2 Article 21 or ISO 27001 Annex A.',
			'Choose one scope or several. With several, say per requirement whether it gets one finding or one per scope.',
			"Record the auditee's roles and at least one risk. Risks set how critical each requirement is."
		],
		ai: [
			"**Derive roles from documents** proposes the auditee's roles with the document each was found in.",
			'**Extract risks** reads an uploaded risk register (PDF, Excel, Word, CSV or Markdown). With web search on, it also proposes recent risks the register lacks.',
			'For ISO 27001 and 27701, **Check scope against SoA** flags selected controls the Statement of Applicability excludes or does not list.'
		],
		decide: 'Which requirements and scopes are in the audit, and which proposed roles and risks you accept.',
		done: 'Requirements are selected, at least one role and one risk are recorded, and scope handling is set.',
		screens: [
			{ label: 'Set-up, Requirements', path: '/setup/requirements' },
			{ label: 'Set-up, Scopes', path: '/setup/scopes' },
			{ label: 'Set-up, Auditee', path: '/setup/auditee' },
			{ label: 'Set-up, Risks', path: '/setup/risks' }
		]
	},
	{
		key: 'rules',
		number: 2,
		title: "The auditee's own rules",
		summary: 'Turn their policies and procedures into rules you can test.',
		phases: [5],
		you: [
			"Upload the auditee's policies, procedures and registers. Title and kind can be added afterwards.",
			'Review each proposed internal requirement: its quote, its section and the requirement it implements. Accept, edit or reject; select several to decide together.',
			'When the auditee sends a new version, use **Upload new version** on the old document, so its rules are checked against the new text.'
		],
		ai: [
			'**Extract requirements** proposes the rules the auditee set for itself, each with an exact quote and section.',
			'After a new version, **Recheck against new version** compares every rule that needs review and proposes an update or a removal, with the reason.'
		],
		decide: 'Which rules are real obligations worth testing. A rule counts only after you accept it.',
		done: 'At least one internal requirement is confirmed.',
		tip: 'Audited this auditee before? **Carry them over** brings in the accepted rules of the earlier engagement.',
		screens: [{ label: 'Set-up, Documents', path: '/setup/documents' }]
	},
	{
		key: 'plan',
		number: 3,
		title: 'Plan',
		summary: 'Agree who you meet, when, and what you need to see.',
		phases: [6],
		you: [
			'Enter the planning inputs first: fieldwork days, working hours, lunch, about how many meetings, and exceptions.',
			'Review the drafted events and the evidence planned for each. Edit, accept or remove them.',
			'On Coverage, make sure every requirement is in an event, or remove it from the audit scope with a reason.',
			'Export the audit plan as Word or PDF, send it, and mark the plan as sent, then agreed.'
		],
		ai: [
			'**Draft plan** fits the meetings into the fieldwork time: an opening meeting, a closing meeting, daily summaries and ten minutes for notes after each meeting, with the evidence to collect at each.',
			'Documents you already have are linked to the evidence they answer, so the plan asks the auditee only for what is missing.'
		],
		decide: 'The plan and its status (draft, sent, agreed). No AI can change the plan status.',
		done: 'The plan is agreed and evidence is planned.',
		screens: [
			{ label: 'Plan, Events', path: '/plan/events' },
			{ label: 'Plan, Coverage', path: '/plan/coverage' },
			{ label: 'Plan, Audit plan', path: '/plan/document' }
		]
	},
	{
		key: 'run',
		number: 4,
		title: 'Run',
		summary: 'Collect the evidence, meeting by meeting. Built for a phone.',
		phases: [7],
		you: [
			'Open the event and choose **Mark held** when it starts.',
			'Take notes as you go. Type / for a promise, a suspected issue or a document, and @ to mention a requirement, a role, a document or planned evidence.',
			'Add files and photos, and set each planned evidence item to received, partial, promised or missing.',
			'Export the post-event report for the people who attended: what was received, what is outstanding, who promised what.'
		],
		ai: [
			'**Process event materials** links notes, files and transcripts to the planned evidence, with the place in the document.',
			'Through your own assistant, bring in the transcript from your meeting or recording tool; it lands in Run, Inbox.'
		],
		decide:
			'Whether each link really supports the evidence: supports, partly supports or contradicts. Suspected issues stay with you and never appear in what the auditee receives.',
		done: 'No planned evidence is still waiting in status planned.',
		screens: [
			{ label: 'Run, Today', path: '/run/today' },
			{ label: 'Run, All events', path: '/run/events' },
			{ label: 'Run, Inbox', path: '/run/inbox' }
		]
	},
	{
		key: 'conclude',
		number: 5,
		title: 'Conclude',
		summary: 'Decide what the evidence shows, requirement by requirement.',
		phases: [8],
		you: [
			'Open Findings: one card per requirement and scope, with its evidence, internal rules and suspected issues.',
			'Review each proposed finding and its rationale. Accept it as a draft, edit it or reject it.',
			'Approve each finding. Approval locks it; reopen it if something changes.',
			'Export the findings report. It holds approved findings only.'
		],
		ai: [
			'**Propose findings** drafts a finding with a rationale that cites the evidence, for one requirement or for all that have none.'
		],
		decide: 'Every finding. Only a person approves, and only in the app.',
		done: 'Every requirement and scope has an approved finding.',
		tip: 'Evidence incomplete? The honest finding is **No reasonable assurance**. A suspected issue blocks a proposal of conformity.',
		screens: [
			{ label: 'Findings, Matrix', path: '/findings/matrix' },
			{ label: 'Findings, To approve', path: '/findings/to-approve' },
			{ label: 'Findings, Conclusions', path: '/findings/conclusions' }
		]
	}
];

/** The steps in one line, for the welcome. */
export const STEPS_LINE = STEPS.map((s) => s.title).join(' → ');

export interface ClientStep {
	text: string;
	/** A command or configuration to copy; {mcp} is replaced. */
	code?: string;
}

export interface GuideClient {
	key: 'claude' | 'chatgpt' | 'claude-code' | 'claude-desktop';
	label: string;
	/** `public`: the assistant's servers call the app, so it needs a public https address and signs in. `token`: runs on your computer with an access token. */
	needs: 'public' | 'token';
	summary: string;
	/** Shown as a warning badge and sentence, for steps not tried on a real account. */
	unverified?: string;
	steps: ClientStep[];
	notes: string[];
}

export const TOKEN_STEP =
	'In mcp-audit, open **Settings, Access tokens** and choose **Create token**. Name it after the place it is used and copy it: it is shown once.';

export const CLIENTS: GuideClient[] = [
	{
		key: 'claude',
		label: 'Claude',
		needs: 'public',
		summary: 'claude.ai, Claude Desktop and the mobile apps, as a custom connector. You sign in; no token.',
		steps: [
			{ text: 'In Claude, open **Settings, Connectors** and choose **Add custom connector**.' },
			{
				text: 'Name it mcp-audit and enter the address below. Leave the advanced OAuth fields empty: Claude registers itself.',
				code: '{mcp}'
			},
			{
				text: 'Choose **Connect**. A window opens on mcp-audit: sign in if asked, check the name, and choose **Allow access**.'
			},
			{ text: 'The mcp-audit tools now appear in Claude. The mobile apps use connectors added on the web.' }
		],
		notes: ['On Team and Enterprise plans, an organization Owner may need to add the connector first.']
	},
	{
		key: 'chatgpt',
		label: 'ChatGPT',
		needs: 'public',
		summary: 'ChatGPT with a custom MCP server. You sign in; no token.',
		unverified:
			"Not yet verified with ChatGPT. These steps follow OpenAI's documentation of November 2026; menu names may differ on your account.",
		steps: [
			{
				text: 'In ChatGPT, open **Plugins**, choose the plus button, then **Add custom MCP server**. On an older account: Settings, Connectors, Advanced, **Developer mode**, then create a connector.'
			},
			{
				text: 'Name it mcp-audit, enter the address below and choose **OAuth** as the authentication. Leave client ID and secret empty: ChatGPT registers itself.',
				code: '{mcp}'
			},
			{
				text: 'Accept the risk notice and create it. A window opens on mcp-audit: sign in if asked and choose **Allow access**.'
			},
			{ text: 'Install it, start a new chat and type @mcp-audit to use it.' }
		],
		notes: [
			'OpenAI limits who can add a custom MCP server. On Business, only admins and owners; on Enterprise and Edu, an admin grants **Create plugins with MCPs**; on personal plans, tools that change data may not be available.',
			'ChatGPT asks you to confirm each action that changes data.',
			"The audit skills are packaged for Claude. In ChatGPT, download a skill on Settings, Skills and paste its SKILL.md into a project's instructions.",
			'If the connection stops working after a while, connect again.'
		]
	},
	{
		key: 'claude-code',
		label: 'Claude Code',
		needs: 'token',
		summary: 'In the terminal, with an access token. Works on a private network or VPN.',
		steps: [
			{ text: TOKEN_STEP },
			{
				text: 'Add the server, with your token in place of mcpa_yourtoken.',
				code: 'claude mcp add --transport http mcp-audit {mcp} --header "Authorization: Bearer mcpa_yourtoken"'
			},
			{ text: 'Check it with the command below, or /mcp inside a session.', code: 'claude mcp list' }
		],
		notes: ['Add --scope user to make it available in all your projects.']
	},
	{
		key: 'claude-desktop',
		label: 'Claude Desktop, private network',
		needs: 'token',
		summary:
			'When mcp-audit is only on your LAN or VPN: a small bridge on your computer, with an access token. Needs Node.js.',
		steps: [
			{ text: TOKEN_STEP },
			{
				text: 'Add this to claude_desktop_config.json (macOS: ~/Library/Application Support/Claude, Windows: %APPDATA%\\Claude), with your token in place of mcpa_yourtoken.',
				code: '{desktop-config}'
			},
			{ text: 'Restart Claude Desktop.' }
		],
		notes: ['Make one token per place, so you can revoke one without the others.']
	}
];

/** The Claude Desktop bridge configuration; --allow-http only for a plain http address. */
export function desktopConfig(mcpUrl: string): string {
	const args = ['mcp-remote', mcpUrl, '--header', 'Authorization:${AUTH_HEADER}'];
	if (!/^https:/i.test(mcpUrl)) args.push('--allow-http');
	return JSON.stringify(
		{
			mcpServers: {
				'mcp-audit': { command: 'npx', args, env: { AUTH_HEADER: 'Bearer mcpa_yourtoken' } }
			}
		},
		null,
		2
	);
}

/** Fill {mcp} and {desktop-config} in a step's text or code. */
export function fill(text: string, mcpUrl: string): string {
	return text.replaceAll('{desktop-config}', desktopConfig(mcpUrl)).replaceAll('{mcp}', mcpUrl);
}

/**
 * What the window an assistant opens asks for (#93). An instance that signs in with passkeys never
 * mentions a password; a copy of the guide that belongs to no instance names every way.
 */
export function signInNote(method?: 'password' | 'passkey'): string {
	if (method === 'passkey')
		return 'When the window asks you to sign in: choose **Sign in with a passkey**, or **Email me a sign-in code** on a device that has no passkey yet. Then you come back to **Allow access**.';
	if (method === 'password')
		return 'When the window asks you to sign in: sign in the way you do in the app, with your email and password, a passkey, or a code by email. Then you come back to **Allow access**.';
	return 'When the window asks you to sign in: sign in the way you do in the app (a passkey, a code by email, or a password where the instance has them). Then you come back to **Allow access**.';
}

/** A custom connector is called from the assistant's servers: it needs https. */
export function connectorReady(mcpUrl: string): boolean {
	return /^https:\/\//i.test(mcpUrl.trim());
}

export const NOT_PUBLIC_NOTE =
	'Claude and ChatGPT connectors call mcp-audit from their own servers, so they need a public https address. This address is not https: use Claude Code or Claude Desktop with a token, or put the app on a public https address first.';

export const AFTER: { title: string; text: string; link?: { label: string; href: string } }[] = [
	{
		title: 'Check the connection',
		text: 'Ask: “List my engagements in mcp-audit and tell me what is missing next.” The assistant should name your engagements.'
	},
	{
		title: 'Load the audit skills',
		text: 'The seven audit skills tell your assistant how to run each step. Download them and add them to Claude under Settings, Capabilities, Skills, or pick one from the connector’s prompts.',
		link: { label: 'Settings, Skills', href: '/settings/skills' }
	},
	{
		title: 'Reuse what you already have',
		text: 'With your meeting tool connected to the same assistant, ask it to take the transcript of an interview and store it in mcp-audit for that event. It lands in Run, Inbox, ready to link to evidence.'
	},
	{
		title: 'What it can never do',
		text: 'Approve a finding, change the plan status or delete a file. Everything it writes is recorded as the assistant on your behalf, and judgement arrives as proposals. Disconnect it any time under Connected apps.',
		link: { label: 'Settings, Access tokens', href: '/settings/tokens' }
	}
];

/** Split text on **bold** marks: [{ text, bold }]. */
export function rich(text: string): { text: string; bold: boolean }[] {
	return text
		.split('**')
		.map((part, i) => ({ text: part, bold: i % 2 === 1 }))
		.filter((p) => p.text);
}

export type StepState = 'done' | 'current' | 'todo';

/** Each step's state and facts, from the Home checklist's phases. */
export function stepProgress(
	phases: { number: number; title: string; fact: string; done: boolean }[]
): Map<GuideStep['key'], { state: StepState; facts: { title: string; fact: string; done: boolean }[] }> {
	const out = new Map<
		GuideStep['key'],
		{ state: StepState; facts: { title: string; fact: string; done: boolean }[] }
	>();
	let currentTaken = false;
	for (const step of STEPS) {
		const own = phases.filter((p) => step.phases.includes(p.number));
		const done = own.length > 0 && own.every((p) => p.done);
		const state: StepState = done ? 'done' : currentTaken ? 'todo' : 'current';
		if (state === 'current') currentTaken = true;
		out.set(step.key, { state, facts: own.map((p) => ({ title: p.title, fact: p.fact, done: p.done })) });
	}
	return out;
}
