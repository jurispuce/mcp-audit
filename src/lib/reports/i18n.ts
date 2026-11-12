/**
 * Report-language versions of the template lines and the words the app fills in. A language without
 * an entry falls back to English, and the screen says so. Content (titles, evidence, names) is never
 * translated: it is shown as the auditor wrote it.
 */

export interface PlanWords {
	status: Record<'draft' | 'sent' | 'agreed', string>;
	formats: Record<string, string>;
	noEndDate: string;
	noDate: string;
	toBeAgreed: string;
	firstVersion: string;
	purpose: (auditee: string, sources: string) => string;
	singleScope: (auditee: string) => string;
	allScopes: string;
	added: string;
	changed: string;
	removed: string;
	since: (date: string) => string;
	nothing: string;
	notCovered: string;
}

const EN: PlanWords = {
	status: { draft: 'draft', sent: 'sent for agreement', agreed: 'agreed' },
	formats: {
		interview: 'Interview',
		walkthrough: 'Walkthrough',
		document_review: 'Document review',
		technical_test: 'Technical test',
		site_visit: 'Site visit',
		other: 'Other'
	},
	noEndDate: 'end date to be agreed',
	noDate: 'date to be agreed',
	toBeAgreed: 'to be agreed',
	firstVersion: 'First version.',
	purpose: (a, s) => `This audit assesses how ${a} meets the selected requirements of ${s}.`,
	singleScope: (a) => `The audit covers ${a} as a whole.`,
	allScopes: 'All scopes',
	added: 'Added',
	changed: 'Changed',
	removed: 'Removed',
	since: (d) => `Compared with the version of ${d}:`,
	nothing: 'No changes to events since the previous version.',
	notCovered: 'not yet in any event'
};

const LV: PlanWords = {
	status: { draft: 'melnraksts', sent: 'nosūtīts saskaņošanai', agreed: 'saskaņots' },
	formats: {
		interview: 'Intervija',
		walkthrough: 'Procesa apskate',
		document_review: 'Dokumentu pārbaude',
		technical_test: 'Tehniskā pārbaude',
		site_visit: 'Apmeklējums uz vietas',
		other: 'Cits'
	},
	noEndDate: 'beigu datums jāsaskaņo',
	noDate: 'datums jāsaskaņo',
	toBeAgreed: 'jāvienojas',
	firstVersion: 'Pirmā versija.',
	purpose: (a, s) => `Audits novērtē, kā ${a} izpilda izvēlētās prasības: ${s}.`,
	singleScope: (a) => `Audits aptver ${a} kopumā.`,
	allScopes: 'Visi tvērumi',
	added: 'Pievienots',
	changed: 'Mainīts',
	removed: 'Izņemts',
	since: (d) => `Salīdzinājumā ar ${d} versiju:`,
	nothing: 'Kopš iepriekšējās versijas pasākumi nav mainīti.',
	notCovered: 'vēl nav iekļauta nevienā pasākumā'
};

/** audit-plan-template.md, line by line. */
const PLAN_LINES_LV: Record<string, string> = {
	'# Audit plan': '# Audita plāns',
	'**Engagement:** {{engagement name}}': '**Audits:** {{engagement name}}',
	'**Auditee:** {{auditee}}': '**Auditējamā organizācija:** {{auditee}}',
	'**Audit period:** {{start date}} to {{end date}}': '**Audita periods:** {{start date}} līdz {{end date}}',
	'**Auditors:** {{auditors}}': '**Auditori:** {{auditors}}',
	'**Plan version:** {{date}} ({{draft | sent for agreement | agreed}})':
		'**Plāna versija:** {{date}} ({{draft | sent for agreement | agreed}})',
	'## Purpose and basis': '## Mērķis un pamats',
	'Audit criteria: {{sources and the selected requirements, by reference}}':
		'Audita kritēriji: {{sources and the selected requirements, by reference}}',
	'## Scope': '## Tvērums',
	'## Schedule': '## Grafiks',
	'| Date | Time | Event | Format | Duration | Participants (roles) | Requirements covered |':
		'| Datums | Laiks | Pasākums | Formāts | Ilgums | Dalībnieki (lomas) | Aptvertās prasības |',
	'## What to prepare': '## Kas jāsagatavo',
	'For each event, the records and documents the auditors expect to see. Having them ready keeps each session within its planned time.':
		'Katram pasākumam: ieraksti un dokumenti, ko auditori vēlas redzēt. Ja tie ir sagatavoti iepriekš, katra tikšanās iekļaujas plānotajā laikā.',
	'## Practical arrangements': '## Praktiskā informācija',
	"- Sessions may be recorded for the auditors' notes only: {{yes / no / to be agreed}}":
		'- Tikšanās var ierakstīt tikai auditoru piezīmēm: {{yes / no / to be agreed}}',
	'- Documents can be sent in advance to: {{contact}}': '- Dokumentus iepriekš var nosūtīt: {{contact}}',
	'- Changes to dates or participants: please tell {{lead auditor}} as early as possible.':
		'- Par izmaiņām datumos vai dalībniekos, lūdzu, iespējami agrāk informējiet: {{lead auditor}}.',
	'## Changes since the previous version': '## Izmaiņas kopš iepriekšējās versijas'
};

export function planWords(language: string): {
	words: PlanWords;
	lines: Record<string, string>;
	translated: boolean;
} {
	if (language === 'lv') return { words: LV, lines: PLAN_LINES_LV, translated: true };
	return { words: EN, lines: {}, translated: language === 'en' };
}

// ---- Post-event report (audit-event-debrief/assets/post-event-report-template.md)

export interface EventWords {
	formats: Record<string, string>;
	form: Record<string, string>;
	notProvided: string;
	partlyProvided: string;
	noDate: string;
	noDateAgreed: string;
	nothing: string;
	nextEvent: (title: string, when: string) => string;
	sendTo: (who: string) => string;
}

const EVENT_EN: EventWords = {
	formats: EN.formats,
	form: {
		rule: 'document',
		record: 'record',
		observation: 'shown',
		technical: 'screen shown',
		testimony: 'explanation'
	},
	notProvided: 'not yet provided',
	partlyProvided: 'partly provided',
	noDate: 'date to be agreed',
	noDateAgreed: 'no date agreed',
	nothing: 'None.',
	nextEvent: (t, w) => `Next: ${t} (${w}). Please send outstanding items before then.`,
	sendTo: (w) => `Please send outstanding items to ${w}.`
};
const EVENT_LV: EventWords = {
	formats: LV.formats,
	form: {
		rule: 'dokuments',
		record: 'ieraksts',
		observation: 'parādīts',
		technical: 'parādīts ekrānā',
		testimony: 'skaidrojums'
	},
	notProvided: 'vēl nav iesniegts',
	partlyProvided: 'iesniegts daļēji',
	noDate: 'datums jāsaskaņo',
	noDateAgreed: 'datums nav saskaņots',
	nothing: 'Nav.',
	nextEvent: (t, w) => `Nākamais: ${t} (${w}). Lūdzu, iesniedziet trūkstošo līdz tam.`,
	sendTo: (w) => `Lūdzu, trūkstošo nosūtiet: ${w}.`
};
const EVENT_LINES_LV: Record<string, string> = {
	'# Post-event report': '# Pārskats pēc tikšanās',
	'**Engagement:** {{engagement name}}': '**Audits:** {{engagement name}}',
	'**Event:** {{event title}} ({{format}})': '**Pasākums:** {{event title}} ({{format}})',
	'**Date and time:** {{date}} {{time}}': '**Datums un laiks:** {{date}} {{time}}',
	'**Participants:** {{roles, names if recorded}}': '**Dalībnieki:** {{roles, names if recorded}}',
	'**Auditors:** {{auditors}}': '**Auditori:** {{auditors}}',
	'## Topics covered': '## Aplūkotās tēmas',
	'## Received during the event': '## Saņemts tikšanās laikā',
	'| Item | Provided by | Form |': '| Pozīcija | Iesniedza | Veids |',
	'## Still outstanding': '## Vēl trūkst',
	'| Item | Needed for | Status |': '| Pozīcija | Nepieciešams | Statuss |',
	'## Agreed follow-ups': '## Norunātie turpmākie soļi',
	'| What | Who | By when |': '| Kas | Kurš | Līdz kad |',
	'## Next steps': '## Nākamie soļi',
	'*This report records what was covered and exchanged. It contains no audit findings; those are issued in the audit report.*':
		'*Šis pārskats fiksē aplūkoto un iesniegto. Tajā nav audita konstatējumu; tie tiek sniegti audita ziņojumā.*'
};

export function eventWords(language: string) {
	if (language === 'lv') return { words: EVENT_LV, lines: EVENT_LINES_LV, translated: true };
	return { words: EVENT_EN, lines: {}, translated: language === 'en' };
}

// ---- Findings report (audit-assurance-review/assets/findings-report-template.md)

export interface FindingsWords {
	draft: string;
	draftMark: string;
	noEndDate: string;
	major: string;
	minor: string;
	positiveNote: string;
	auditorNote: string;
	summary: (n: {
		units: number;
		requirements: number;
		auditee: string;
		nc: number;
		na: number;
		conform: number;
	}) => string;
	scopesAll: (scopes: string) => string;
	perScope: (refs: string) => string;
	method: (events: string, documents: number) => string;
	noneObtained: string;
	limitations: (missing: number) => string;
	none: string;
}

const FINDINGS_EN: FindingsWords = {
	draft: '(DRAFT)',
	draftMark: ' (draft)',
	noEndDate: 'open',
	major: 'Major',
	minor: 'Minor',
	positiveNote: 'positive note',
	auditorNote: 'auditor note',
	summary: (n) =>
		`The audit assessed ${n.requirements} requirements of ${n.auditee} in ${n.units} assessment units. ${n.conform} were found to conform, ${n.nc} are non-conformities and ${n.na} could not be given reasonable assurance.`,
	scopesAll: (s) =>
		`${s}; every requirement was assessed once for the whole organisation unless listed per scope.`,
	perScope: (r) => `Assessed per scope: ${r}.`,
	method: (e, d) => `${e || 'no events held'}; ${d} documents reviewed.`,
	noneObtained: 'evidence not obtained',
	limitations: (m) =>
		`${m} planned evidence items were not obtained. The audit relied on records supplied by the auditee; sampling was used where noted in the evidence.`,
	none: 'None.'
};
const FINDINGS_LV: FindingsWords = {
	draft: '(MELNRAKSTS)',
	draftMark: ' (melnraksts)',
	noEndDate: 'nav noteikts',
	major: 'Būtiska',
	minor: 'Nebūtiska',
	positiveNote: 'pozitīva piezīme',
	auditorNote: 'auditora piezīme',
	summary: (n) =>
		`Audits novērtēja ${n.requirements} prasības organizācijā ${n.auditee}, ${n.units} novērtējuma vienībās. Atbilstība konstatēta ${n.conform} gadījumos, neatbilstības: ${n.nc}, pietiekama pārliecība nav gūta: ${n.na}.`,
	scopesAll: (s) =>
		`${s}; katra prasība novērtēta vienreiz visai organizācijai, ja vien nav norādīts pa tvērumiem.`,
	perScope: (r) => `Novērtēts pa tvērumiem: ${r}.`,
	method: (e, d) => `${e || 'pasākumi nav notikuši'}; pārskatīti ${d} dokumenti.`,
	noneObtained: 'pierādījumi nav iegūti',
	limitations: (m) =>
		`${m} plānotie pierādījumi netika iegūti. Audits balstījās uz auditējamās organizācijas sniegtajiem ierakstiem; izlase izmantota, kur tas norādīts pierādījumos.`,
	none: 'Nav.'
};
const FINDINGS_LINES_LV: Record<string, string> = {
	'# Audit findings report {{(DRAFT) if not all findings are approved}}':
		'# Audita konstatējumu ziņojums {{(DRAFT) if not all findings are approved}}',
	'**Engagement:** {{engagement name}}': '**Audits:** {{engagement name}}',
	'**Auditee:** {{auditee}}': '**Auditējamā organizācija:** {{auditee}}',
	'**Audit period:** {{start date}} to {{end date}}': '**Audita periods:** {{start date}} līdz {{end date}}',
	'**Auditors:** {{auditors}}': '**Auditori:** {{auditors}}',
	'**Report date:** {{date}}': '**Ziņojuma datums:** {{date}}',
	'## Summary': '## Kopsavilkums',
	'| Finding | Count |': '| Konstatējums | Skaits |',
	'## Basis and scope': '## Pamats un tvērums',
	'Audit criteria: {{sources and selected requirements}}':
		'Audita kritēriji: {{sources and selected requirements}}',
	'Scopes: {{scopes, and which requirements were assessed per scope}}':
		'Tvērumi: {{scopes, and which requirements were assessed per scope}}',
	'Method: {{events held, by format and count; documents reviewed, count}}':
		'Metode: {{events held, by format and count; documents reviewed, count}}',
	'## Non-conformities': '## Neatbilstības',
	'### {{requirement reference}} {{title}}, {{scope}}: {{Major | Minor}} non-conformity':
		'### {{requirement reference}} {{title}}, {{scope}}: {{Major | Minor}} neatbilstība',
	'**Requirement:** {{what the requirement asks, one or two sentences}}':
		'**Prasība:** {{what the requirement asks, one or two sentences}}',
	'**Finding:** {{the fact observed}}': '**Konstatējums:** {{the fact observed}}',
	'**Evidence:** {{what was examined and what it showed, with references}}':
		'**Pierādījumi:** {{what was examined and what it showed, with references}}',
	'**Why this classification:** {{one or two sentences}}':
		'**Klasifikācijas pamatojums:** {{one or two sentences}}',
	'## Conformities with notes': '## Atbilstība ar piezīmēm',
	'## Requirements without reasonable assurance': '## Prasības bez pietiekamas pārliecības',
	'| Requirement | Scope | What was missing |': '| Prasība | Tvērums | Kas trūka |',
	'## Full results': '## Visi rezultāti',
	'| Requirement | Scope | Finding |': '| Prasība | Tvērums | Konstatējums |',
	'## Limitations': '## Ierobežojumi'
};

export function findingsWords(language: string) {
	if (language === 'lv') return { words: FINDINGS_LV, lines: FINDINGS_LINES_LV, translated: true };
	return { words: FINDINGS_EN, lines: {}, translated: language === 'en' };
}
