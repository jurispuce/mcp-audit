import type { AppDatabase } from '#lib/db/client.ts';
import { eventWords, findingsWords } from '#lib/reports/i18n.ts';
import { markdownToDocx, markdownToPdf } from '#lib/reports/render.ts';
import { fillTemplate, readTemplate } from '#lib/reports/template.ts';
import { listArtifacts, registerGeneratedArtifact, type Artifact } from './artifacts';
import { getEngagement, listMembers, listScopes } from './engagements';
import { listNotes } from './execution';
import { unitCards } from './findings';
import { getEvent, listEvents, listEvidence } from './planning';
import { listSelected } from './selection';
import { listUsers } from './users';
import type { Actor } from './write';

/**
 * The post-event report (shared with attendees) and the findings report (the audit report), filled
 * from the skills' templates in the report language. Neither holds suspected issues, sufficiency
 * judgements or criticality; the findings report holds approved findings only unless a draft is asked
 * for, and then it says DRAFT.
 */

export type ReportFormat = 'docx' | 'pdf';
const MIME: Record<ReportFormat, string> = {
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	pdf: 'application/pdf'
};
const esc = (s: string) => s.replace(/[\\`*_[\]<>|#]/g, (c) => `\\${c}`);

export interface ReportDocument {
	markdown: string;
	language: string;
	translated: boolean;
}

async function store(
	app: AppDatabase,
	actor: Actor,
	filesDir: string,
	engagementId: string,
	doc: ReportDocument,
	format: ReportFormat,
	base: string,
	today: Date
): Promise<Artifact> {
	const title = doc.markdown.split('\n')[0]!.replace(/^#\s*/, '').replace(/\\/g, '');
	const bytes =
		format === 'docx'
			? await markdownToDocx(doc.markdown, { title, language: doc.language })
			: await markdownToPdf(doc.markdown, { title, language: doc.language });
	const date = today.toISOString().slice(0, 10);
	return registerGeneratedArtifact(app, actor, filesDir, engagementId, {
		title: `${title} (${date})`,
		filename: `${base}-${date}.${format}`,
		mimeType: MIME[format],
		bytes: new Uint8Array(bytes),
		text: doc.markdown,
		language: doc.language
	});
}

function auditors(app: AppDatabase, engagementId: string) {
	const members = listMembers(app, engagementId);
	const lead = members.find((m) => m.role === 'lead_auditor');
	const email = lead ? listUsers(app).find((u) => u.id === lead.userId)?.email : undefined;
	return {
		names: members.map((m) => m.name).join(', '),
		contact: lead ? `${lead.name}${email ? ` <${email}>` : ''}` : ''
	};
}

// ---- Post-event report

export function buildPostEventReport(
	app: AppDatabase,
	engagementId: string,
	eventId: string
): ReportDocument {
	const e = getEngagement(app, engagementId);
	const ev = getEvent(app, engagementId, eventId);
	const { words, lines, translated } = eventWords(e.reportLanguage);
	const evidence = listEvidence(app, engagementId, { eventId }).filter((x) => !x.proposed);
	const who = auditors(app, engagementId);
	const providers = ev.participants.map((p) => p.label).join(', ') || ev.participantsNote || '';
	const next = listEvents(app, engagementId).find(
		(x) =>
			!x.proposed &&
			x.id !== ev.id &&
			x.date &&
			(!ev.date || x.date > ev.date) &&
			x.participantIds.some((p) => ev.participantIds.includes(p))
	);
	const promiseNotes = listNotes(app, engagementId, { eventId, type: 'promise' }).filter(
		(n) => !n.mentions.some((m) => m.type === 'evidence_item')
	);
	const promised = evidence.filter((x) => x.status === 'promised');
	const markdown = fillTemplate(readTemplate('audit-event-debrief', 'post-event-report-template.md'), {
		translations: lines,
		values: {
			'engagement name': e.name,
			'event title': ev.title,
			format: words.formats[ev.format] ?? ev.formatLabel,
			date: ev.date ?? words.noDate,
			time: ev.startTime ?? '',
			'roles, names if recorded': [ev.participantsLine].filter(Boolean).join(''),
			auditors: who.names
		},
		blocks: {
			'Topics covered': ev.requirements.length
				? ev.requirements.map((r) => `- ${esc(r.refCode)} ${esc(r.title)}`).join('\n')
				: esc(words.nothing),
			'Next steps': esc(
				next
					? words.nextEvent(next.title, [next.date, next.startTime].filter(Boolean).join(' '))
					: words.sendTo(who.contact || '—')
			)
		},
		rows: {
			'Received during the event': evidence
				.filter((x) => x.status === 'received')
				.map((x) => ({
					'evidence item': x.text,
					role: providers,
					'document / record / screen shown / explanation': words.form[x.kind] ?? x.kind
				})),
			'Still outstanding': evidence
				.filter((x) => ['planned', 'missing', 'partial'].includes(x.status))
				.map((x) => ({
					'evidence item': x.text,
					'requirement reference': x.requirementRefs.join(', '),
					'not yet provided / partly provided':
						x.status === 'partial' ? words.partlyProvided : words.notProvided
				})),
			'Agreed follow-ups': [
				...promised.map((x) => ({
					promise: x.text,
					role: x.promisedBy ?? '',
					'date or "no date agreed"': x.promisedDue ?? words.noDateAgreed
				})),
				...promiseNotes.map((n) => ({
					promise: n.text,
					role: n.mentions
						.filter((m) => m.type === 'person')
						.map((m) => m.label)
						.join(', '),
					'date or "no date agreed"': /\b(\d{4}-\d{2}-\d{2})\b/.exec(n.text)?.[1] ?? words.noDateAgreed
				}))
			]
		}
	});
	return { markdown, language: e.reportLanguage, translated };
}

export async function exportPostEventReport(
	app: AppDatabase,
	actor: Actor,
	filesDir: string,
	engagementId: string,
	eventId: string,
	format: ReportFormat,
	today = new Date()
) {
	return store(
		app,
		actor,
		filesDir,
		engagementId,
		buildPostEventReport(app, engagementId, eventId),
		format,
		`post-event-report`,
		today
	);
}

// ---- Findings report

export interface FindingsReport extends ReportDocument {
	approved: number;
	drafts: number;
	units: number;
	draft: boolean;
}

export function buildFindingsReport(
	app: AppDatabase,
	engagementId: string,
	options: { includeDrafts?: boolean } = {},
	today = new Date()
): FindingsReport {
	const e = getEngagement(app, engagementId);
	const { words, lines, translated } = findingsWords(e.reportLanguage);
	const cards = unitCards(app, engagementId);
	const included = cards.filter(
		(c) =>
			c.finding &&
			c.finding.value &&
			(c.finding.status === 'approved' || (options.includeDrafts && c.finding.status === 'draft'))
	);
	const draftCount = cards.filter((c) => c.finding?.status === 'draft').length;
	const isDraft = !!options.includeDrafts && included.some((c) => c.finding!.status !== 'approved');
	const mark = (c: (typeof cards)[number]) => (c.finding!.status === 'approved' ? '' : words.draftMark);
	const selected = listSelected(app, engagementId);
	const scopes = listScopes(app, engagementId);
	const multi = e.scopeMode === 'multiple' && scopes.length > 1;
	const scopeOf = (c: (typeof cards)[number]) =>
		c.scopeId ? c.scopeName : multi ? scopes.map((s) => s.name).join(', ') : c.scopeName;

	const bySource = new Map<string, string[]>();
	for (const s of selected) bySource.set(s.sourceTitle, [...(bySource.get(s.sourceTitle) ?? []), s.refCode]);
	const events = listEvents(app, engagementId).filter((x) => !x.proposed && x.status === 'held');
	const byFormat = new Map<string, number>();
	for (const x of events) byFormat.set(x.formatLabel, (byFormat.get(x.formatLabel) ?? 0) + 1);
	const documents = listArtifacts(app, engagementId).filter(
		(a) => a.kind !== 'generated_report' && a.state === 'received'
	).length;
	const perScope = selected.filter((s) => s.scopeHandling === 'per_scope').map((s) => s.refCode);

	const nc = included.filter((c) => c.finding!.value!.isNonconformity);
	const na = included.filter((c) => c.finding!.value!.code === 'na');
	const noted = included.filter(
		(c) =>
			!c.finding!.value!.isNonconformity &&
			c.finding!.value!.code !== 'na' &&
			c.finding!.value!.code !== 'c' &&
			c.finding!.rationale
	);
	const conform = included.length - nc.length - na.length;
	const scale = new Map<string, number>();
	for (const c of included) scale.set(c.finding!.value!.label, (scale.get(c.finding!.value!.label) ?? 0) + 1);
	const missingItems = listEvidence(app, engagementId).filter(
		(x) => !x.proposed && ['missing', 'planned', 'promised'].includes(x.status)
	).length;
	const examined = (c: (typeof cards)[number]) =>
		c.evidence
			.filter((x) => c.finding!.evidenceItemIds.includes(x.id) || !c.finding!.evidenceItemIds.length)
			.filter((x) => x.status === 'received' || x.status === 'partial')
			.map(
				(x) =>
					`${x.text}${x.links
						.filter((l) => l.status === 'confirmed')
						.map((l) => ` (${l.artifactTitle}${l.locator ? `, ${l.locator}` : ''})`)
						.join('')}`
			)
			.join('; ');

	const markdown = fillTemplate(readTemplate('audit-assurance-review', 'findings-report-template.md'), {
		translations: lines,
		values: {
			'(DRAFT) if not all findings are approved': isDraft ? words.draft : '',
			'engagement name': e.name,
			auditee: e.auditeeName,
			'start date': e.startDate,
			'end date': e.endDate ?? words.noEndDate,
			auditors: auditors(app, engagementId).names,
			date: today.toISOString().slice(0, 10),
			'sources and selected requirements': [...bySource]
				.map(([t, refs]) => `${t}: ${refs.join(', ')}`)
				.join('; '),
			'scopes, and which requirements were assessed per scope': `${words.scopesAll(scopes.map((s) => s.name).join(', '))}${multi && perScope.length ? ` ${words.perScope(perScope.join(', '))}` : ''}`,
			'events held, by format and count; documents reviewed, count': words.method(
				[...byFormat].map(([f, n]) => `${f} ${n}`).join(', '),
				documents
			)
		},
		blocks: {
			Summary: esc(
				words.summary({
					units: included.length,
					requirements: new Set(included.map((c) => c.requirementId)).size,
					auditee: e.auditeeName,
					nc: nc.length,
					na: na.length,
					conform
				})
			),
			'Non-conformities': esc(words.none),
			'Conformities with notes': esc(words.none),
			Limitations: esc(words.limitations(missingItems))
		},
		rows: {
			Summary: [...scale].map(([label, n]) => ({ 'finding scale label': label, n: String(n) })),
			'Requirements without reasonable assurance': na.map((c) => ({
				'reference and title': `${c.refCode} ${c.title}${mark(c)}`,
				scope: scopeOf(c),
				'evidence not obtained':
					c.evidence
						.filter((x) => x.status !== 'received')
						.map((x) => x.text)
						.join('; ') || words.noneObtained
			})),
			'Full results': included.map((c) => ({
				'reference and title': `${c.refCode} ${c.title}`,
				scope: scopeOf(c),
				'finding label': `${c.finding!.value!.label}${mark(c)}`
			}))
		},
		sections: {
			'Non-conformities': nc.map((c) => ({
				values: {
					'requirement reference': c.refCode,
					title: `${c.title}${mark(c)}`,
					scope: scopeOf(c),
					'Major | Minor':
						c.finding!.value!.code === 'major'
							? words.major
							: c.finding!.value!.code === 'minor'
								? words.minor
								: c.finding!.value!.label,
					'what the requirement asks, one or two sentences': c.text ?? c.title,
					'the fact observed': c.finding!.rationale ?? '',
					'what was examined and what it showed, with references': examined(c),
					'one or two sentences': c.finding!.value!.label
				},
				items: []
			})),
			'Conformities with notes': noted.map((c) => ({
				values: {
					'requirement reference': c.refCode,
					title: `${c.title}${mark(c)}`,
					scope: scopeOf(c),
					'positive note | auditor note':
						c.finding!.value!.code === 'cp' ? words.positiveNote : words.auditorNote,
					'The note, two or three sentences, with the evidence it rests on.': c.finding!.rationale ?? ''
				},
				items: []
			}))
		}
	});
	// Sections with no entries keep the "None." block instead of an empty heading list.
	const tidy = markdown
		.replace(/(## (?:Non-conformities|Neatbilstības)\n\n)(?=## )/, `$1${esc(words.none)}\n\n`)
		.replace(
			/(## (?:Conformities with notes|Atbilstība ar piezīmēm)\n\n)(?=## )/,
			`$1${esc(words.none)}\n\n`
		);
	return {
		markdown: tidy,
		language: e.reportLanguage,
		translated,
		approved: cards.filter((c) => c.finding?.status === 'approved').length,
		drafts: draftCount,
		units: cards.length,
		draft: isDraft
	};
}

export async function exportFindingsReport(
	app: AppDatabase,
	actor: Actor,
	filesDir: string,
	engagementId: string,
	format: ReportFormat,
	options: { includeDrafts?: boolean } = {},
	today = new Date()
) {
	const r = buildFindingsReport(app, engagementId, options, today);
	return store(
		app,
		actor,
		filesDir,
		engagementId,
		r,
		format,
		r.draft ? 'findings-report-draft' : 'findings-report',
		today
	);
}
